/**
 * P02 本地原型：顺序回放入口（fake / real 两种模式）+ 离线验证。
 *
 * 用法：
 *   # 假客户端（默认，不访问网络）
 *   npx ts-node --transpile-only -P scripts/return-extract-v2/tsconfig.json \
 *     scripts/return-extract-v2/event-replay/run.ts --mode fake --out <目录>
 *
 *   # 模拟某一点失败（仍是假客户端）
 *   ... --mode fake --simulate-failure TR-05#2
 *
 *   # 真实模式（本轮不执行；只保留入口）
 *   ... --mode real --out <目录>
 *
 * 约束：
 * - real 模式不加载任何脚本化答案；参考只用于检查点选择与事后审核，不进入请求。
 * - 每个检查点最多一次请求，无自动重试；SDK 层重试也关闭（maxRetries: 0）。
 * - 请求与原始返回按点落盘（追加写），中途异常不丢已完成的证据。
 * - 原话只写入 <out>/private/。
 */
import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import {
  createModelInvoker,
  redactSecrets,
  type ChatClient,
  type ModelRequest,
} from '../request-boundary';
import {
  REPLAY_PROTOCOL,
  REPLAY_SCHEMA,
  parseReplayOutput,
  type ReplaySnapshot,
  type VisibleMessage,
} from './protocol';
import {
  applyReplayOperations,
  emptySnapshot,
  type ApplyOptions,
} from './lifecycle';
import { REPLAY_SYSTEM_PROMPT, buildReplayUserPayload } from './input';

const REPO_ROOT = path.resolve(__dirname, '../../../../..');
const DEFAULT_DATA_DIR = path.join(
  REPO_ROOT,
  '.task-evidence/return-extraction-v2/pilot/private'
);
const DEFAULT_OUT = path.join(
  REPO_ROOT,
  '.task-evidence/return-extraction-v2/pilot/p02-prototype-v2'
);
// real 模式使用独立的新目录，避免与 fake 产物互相覆盖。
const DEFAULT_REAL_OUT = path.join(
  REPO_ROOT,
  '.task-evidence/return-extraction-v2/pilot/p02-real-trial'
);
const TARGETS = ['TR-03', 'TR-05', 'TR-09', 'TR-S01'];
const CANDIDATE_MODEL = 'qwen-plus';
/** 既有该服务的兼容地址；real 模式只允许发到这里。 */
const EXPECTED_REAL_BASE_URL_HOST = 'dashscope.aliyuncs.com';

interface CheckpointRef {
  checkpointId: string;
  cutoffIndex: number;
}

interface CheckpointRecord {
  trajectoryId: string;
  anonymousUser: string;
  checkpointId: string;
  ordinal: number;
  coldStart: boolean;
  cutoffIndex: number;
  mode: string;
  requestStatus: 'succeeded' | 'failed';
  finishReason: string | null;
  usage: unknown;
  truncated: boolean;
  error?: string;
  upstreamFailure: boolean;
  request: any;
  before: ReplaySnapshot;
  parsed: any;
  outcomes: any[];
  currentTurnIntents: any[];
  rejected: any[];
  after: ReplaySnapshot;
}

interface TrajectoryReplay {
  trajectoryId: string;
  anonymousUser: string;
  records: CheckpointRecord[];
  finalSnapshot: ReplaySnapshot;
}

function readJsonl(file: string): any[] {
  if (!fs.existsSync(file)) throw new Error(`missing file: ${file}`);
  return fs
    .readFileSync(file, 'utf-8')
    .split('\n')
    .filter(line => line.trim())
    .map(line => JSON.parse(line));
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function fileHash(file: string): string {
  return sha256(fs.readFileSync(file, 'utf-8'));
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function parseArgs() {
  const args = process.argv.slice(2);
  const value = (flag: string, fallback: string) => {
    const index = args.indexOf(flag);
    return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
  };
  const mode = value('--mode', 'fake');
  if (mode !== 'fake' && mode !== 'real') {
    throw new Error(`unknown mode: ${mode}`);
  }
  const failures = args.includes('--simulate-failure')
    ? value('--simulate-failure', '').split(',').filter(Boolean)
    : [];
  return {
    mode,
    failures,
    out:
      args.indexOf('--out') >= 0 && args[args.indexOf('--out') + 1]
        ? args[args.indexOf('--out') + 1]
        : mode === 'real'
        ? DEFAULT_REAL_OUT
        : DEFAULT_OUT,
    dataDir:
      args.indexOf('--data-dir') >= 0 && args[args.indexOf('--data-dir') + 1]
        ? args[args.indexOf('--data-dir') + 1]
        : DEFAULT_DATA_DIR,
  };
}

function loadRepoEnv(): Record<string, string> {
  const file = path.join(REPO_ROOT, '.env');
  const map: Record<string, string> = {};
  if (!fs.existsSync(file)) return map;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const index = trimmed.indexOf('=');
    map[trimmed.slice(0, index).trim()] = trimmed.slice(index + 1).trim();
  }
  return map;
}

interface RealTarget {
  label: string;
  baseURL: string;
  apiKey: string;
  model: string;
}

function resolveRealTarget(): RealTarget {
  const env = loadRepoEnv();
  const value = (key: string) => process.env[key] || env[key] || '';
  const apiKey = value('NODE_EMBEDDING_API_KEY');
  if (!apiKey) throw new Error('missing NODE_EMBEDDING_API_KEY for real mode');
  const baseURL = value('NODE_EMBEDDING_BASE_URL');
  // 不在缺地址时误发到 SDK 默认服务：地址缺失或不是既有服务地址就停止。
  if (!baseURL) {
    throw new Error('missing NODE_EMBEDDING_BASE_URL for real mode');
  }
  if (!baseURL.includes(EXPECTED_REAL_BASE_URL_HOST)) {
    throw new Error(
      `real mode baseURL 不是既有服务地址（期望包含 ${EXPECTED_REAL_BASE_URL_HOST}）`
    );
  }
  // 模型名固定为 qwen-plus，不接受环境变量覆盖。
  const model = CANDIDATE_MODEL;
  if (model !== 'qwen-plus') {
    throw new Error(`real mode 只允许 qwen-plus，实际解析为 ${model}`);
  }
  return {
    label: 'qwen-plus@dashscope',
    baseURL,
    apiKey,
    model,
  };
}

/** fake 模式下才动态加载脚本化答案；real 分支不会 import 它。 */
async function buildClient(
  mode: string,
  failKeys: string[]
): Promise<{ client: ChatClient; model: string }> {
  if (mode === 'fake') {
    const mod = await import('./fake-client');
    const scripted = mod.createScriptedClient(mod.buildScript(), failKeys);
    return { client: scripted.client, model: 'fake-model-1' };
  }
  const target = resolveRealTarget();
  const OpenAI = (await import('openai')).default;
  const client = new OpenAI({
    apiKey: target.apiKey,
    baseURL: target.baseURL,
    maxRetries: 0,
  });
  return { client: client as unknown as ChatClient, model: target.model };
}

function selectCheckpoints(reference: any[]): Record<string, CheckpointRef[]> {
  const out: Record<string, CheckpointRef[]> = {};
  for (const trajectoryId of TARGETS) {
    const rows = reference
      .filter(row => row.trajectoryId === trajectoryId && row.variantOf == null)
      .sort((a, b) => a.cutoff.index - b.cutoff.index);
    if (rows.length !== 3) {
      throw new Error(`${trajectoryId} 期望 3 个常规检查点，实际 ${rows.length}`);
    }
    out[trajectoryId] = rows.map(row => ({
      checkpointId: row.checkpointId,
      cutoffIndex: row.cutoff.index,
    }));
  }
  return out;
}

function toVisible(message: any): VisibleMessage {
  return {
    messageId: message.id,
    role: message.role,
    content: message.content,
    at: message.at,
    index: message.index,
  };
}

async function replayAll(options: {
  client: ChatClient;
  model: string;
  mode: string;
  trajectories: any[];
  checkpoints: Record<string, CheckpointRef[]>;
  persistDir?: string;
  requestFile?: string;
  rawFile?: string;
  checkpointFile?: string;
}): Promise<TrajectoryReplay[]> {
  const invoker = createModelInvoker({ client: options.client, sourceCommit: null });
  const replays: TrajectoryReplay[] = [];
  let writtenRequests = 0;

  for (const trajectory of options.trajectories) {
    if (!TARGETS.includes(trajectory.trajectoryId)) continue;
    for (const message of trajectory.messages) {
      if (typeof message.content !== 'string') {
        throw new Error(
          `${trajectory.trajectoryId} 消息缺 content，请确认使用带内容的 trajectories-v2`
        );
      }
    }
    const messages: any[] = trajectory.messages;
    let snapshot: ReplaySnapshot = emptySnapshot();
    let prevCutoff = -1;
    let eventSeq = 0;
    let restrictionSeq = 0;
    let upstreamFailureSeen = false;
    const appliedSignatures = new Set<string>();
    const records: CheckpointRecord[] = [];

    for (let i = 0; i < options.checkpoints[trajectory.trajectoryId].length; i += 1) {
      const checkpoint = options.checkpoints[trajectory.trajectoryId][i];
      const ordinal = i + 1;
      const cutoff = checkpoint.cutoffIndex;
      const coldStart = i === 0;
      const visible = messages
        .filter(message => message.index <= cutoff)
        .map(toVisible);
      const newMessages = messages
        .filter(message => message.index > prevCutoff && message.index <= cutoff)
        .map(toVisible);
      const contextMessages = coldStart
        ? []
        : messages
            .filter(message => message.index <= prevCutoff)
            .map(toVisible);
      const user = buildReplayUserPayload({
        trajectoryId: trajectory.trajectoryId,
        anonymousUser: trajectory.anonymousUser,
        checkpointId: checkpoint.checkpointId,
        ordinal,
        coldStart,
        visibleMessages: visible,
        newMessages,
        contextMessages,
        snapshot,
        model: options.model,
      });
      const request: ModelRequest = {
        fragmentId: trajectory.trajectoryId,
        mode: `event_replay_${options.mode}`,
        protocol: REPLAY_PROTOCOL,
        inputMode: coldStart ? 'visible_prefix' : 'new_messages+context+snapshot',
        step: ordinal,
        model: options.model,
        params: { temperature: 0, topP: 1, maxTokens: 1500 },
        system: REPLAY_SYSTEM_PROMPT,
        user,
        messageIds: newMessages.map(message => message.messageId),
        promptSource: 'return-extract-v2/event-replay/input.ts',
      };

      const before = JSON.parse(JSON.stringify(snapshot)) as ReplaySnapshot;
      let response: { raw: string; finishReason: string; usage: unknown } | null = null;
      let failure: string | null = null;
      try {
        response = await invoker.invoke(request);
      } catch (error) {
        // 统一使用已脱敏值，避免绕过调用边界的脱敏。
        failure = redactSecrets(
          error instanceof Error ? error.message : String(error)
        ).slice(0, 200);
      }
      const entry = invoker.all().slice(-1)[0];

      // 请求按点落盘。
      if (options.requestFile) {
        fs.appendFileSync(options.requestFile, JSON.stringify(entry) + '\n');
        writtenRequests += 1;
      }

      let parsed: any = { operations: [], unresolved: [], rejected: [], rawOperationCount: 0 };
      let outcomes: any[] = [];
      let currentTurnIntents: any[] = [];
      let after = before;
      const rawRecord: Record<string, unknown> = {
        trajectoryId: trajectory.trajectoryId,
        checkpointId: checkpoint.checkpointId,
        ordinal,
        status: failure ? 'failed' : 'succeeded',
        model: options.model,
        finishReason: response?.finishReason ?? null,
        usage: response?.usage ?? null,
        truncated: response ? response.finishReason === 'length' : false,
        error: failure || entry?.error || null,
        upstreamFailureSeenBefore: upstreamFailureSeen,
      };
      if (response) {
        const knownEventIds = before.events.map(event => event.eventId);
        const knownRestrictionIds = before.restrictions.map(
          restriction => restriction.restrictionId
        );
        parsed = parseReplayOutput(
          response.raw,
          visible,
          knownEventIds,
          knownRestrictionIds
        );
        const messageTimes: Record<string, string> = {};
        for (const message of messages) messageTimes[message.id] = message.at;
        const applyOptions: ApplyOptions = {
          messageTimes,
          allowedMessageIds: visible.map(message => message.messageId),
          eventIdFactory: () => `ev-${trajectory.trajectoryId}-${(eventSeq += 1)}`,
          restrictionIdFactory: () =>
            `res-${trajectory.trajectoryId}-${(restrictionSeq += 1)}`,
          appliedOperationSignatures: appliedSignatures,
        };
        const applied = applyReplayOperations(before, parsed, applyOptions);
        after = applied.snapshot;
        outcomes = applied.outcomes;
        currentTurnIntents = applied.currentTurnIntents;
        for (const signature of applied.appliedOperationSignatures) {
          appliedSignatures.add(signature);
        }
        rawRecord.raw = response.raw;
        rawRecord.parsedOperationCount = parsed.operations.length;
        rawRecord.rejectedCount = parsed.rejected.length;
      } else {
        upstreamFailureSeen = true;
        rawRecord.afterUnchanged = true;
      }
      if (options.rawFile) {
        fs.appendFileSync(options.rawFile, JSON.stringify(rawRecord) + '\n');
      }

      const record: CheckpointRecord = {
        trajectoryId: trajectory.trajectoryId,
        anonymousUser: trajectory.anonymousUser,
        checkpointId: checkpoint.checkpointId,
        ordinal,
        coldStart,
        cutoffIndex: cutoff,
        mode: options.mode,
        requestStatus: failure ? 'failed' : 'succeeded',
        finishReason: response?.finishReason ?? null,
        usage: response?.usage ?? null,
        truncated: response ? response.finishReason === 'length' : false,
        error: failure || undefined,
        upstreamFailure: upstreamFailureSeen,
        request: {
          system: request.system,
          user: request.user,
          messageIds: request.messageIds,
          inputMode: request.inputMode,
          step: request.step,
        },
        before,
        parsed: {
          operations: parsed.operations,
          unresolved: parsed.unresolved,
          rejected: parsed.rejected,
          rawOperationCount: parsed.rawOperationCount,
        },
        outcomes,
        currentTurnIntents,
        rejected: parsed.rejected,
        after,
      };
      records.push(record);
      if (options.checkpointFile) {
        fs.appendFileSync(options.checkpointFile, JSON.stringify(record) + '\n');
      }
      snapshot = after;
      prevCutoff = cutoff;
    }
    replays.push({
      trajectoryId: trajectory.trajectoryId,
      anonymousUser: trajectory.anonymousUser,
      records,
      finalSnapshot: snapshot,
    });
  }
  void writtenRequests;
  return replays;
}

function byKey(replays: TrajectoryReplay[]): Map<string, CheckpointRecord> {
  const map = new Map<string, CheckpointRecord>();
  for (const replay of replays) {
    for (const record of replay.records) {
      map.set(`${record.trajectoryId}#${record.ordinal}`, record);
    }
  }
  return map;
}

// ---------------------------------------------------------------- unit helpers

const UNIT_VISIBLE: VisibleMessage[] = [
  { messageId: 'u1', role: 'user', content: '父亲明天检查，我后天出差' },
  { messageId: 'u2', role: 'user', content: '嗯' },
  { messageId: 'a1', role: 'assistant', content: '你要去复查吗' },
];
const UNIT_TIMES: Record<string, string> = {
  u1: '2026-09-01T10:00:00+00:00',
  u2: '2026-09-01T10:01:00+00:00',
  a1: '2026-09-01T10:02:00+00:00',
};

function unitApply(
  operations: any[],
  snapshot: ReplaySnapshot,
  signatures: Set<string>,
  schemaVersion = REPLAY_SCHEMA
) {
  const parse = parseReplayOutput(
    JSON.stringify({ schemaVersion, operations }),
    UNIT_VISIBLE,
    snapshot.events.map(event => event.eventId),
    snapshot.restrictions.map(restriction => restriction.restrictionId)
  );
  let seq = snapshot.events.length;
  let rseq = snapshot.restrictions.length;
  const result = applyReplayOperations(snapshot, parse, {
    messageTimes: UNIT_TIMES,
    allowedMessageIds: UNIT_VISIBLE.map(message => message.messageId),
    eventIdFactory: () => `ev-u-${(seq += 1)}`,
    restrictionIdFactory: () => `res-u-${(rseq += 1)}`,
    appliedOperationSignatures: signatures,
  });
  return { parse, result };
}

async function main() {
  const { mode, failures, out, dataDir } = parseArgs();
  const privateDir = path.join(out, 'private');
  const examplesDir = path.join(privateDir, 'examples');
  fs.mkdirSync(examplesDir, { recursive: true });
  fs.mkdirSync(privateDir, { recursive: true });

  const trajectoriesFile = path.join(dataDir, 'trajectories-v2.jsonl');
  const referenceFile = path.join(dataDir, 'reference-draft-v2.jsonl');
  const trajectories = readJsonl(trajectoriesFile);
  const reference = readJsonl(referenceFile);
  const checkpoints = selectCheckpoints(reference);

  const dataHashes = {
    trajectoriesFile: path.basename(trajectoriesFile),
    trajectoriesSha256: fileHash(trajectoriesFile),
    referenceFile: path.basename(referenceFile),
    referenceSha256: fileHash(referenceFile),
  };

  const selectedReference = reference.filter(
    row => TARGETS.includes(row.trajectoryId) && row.variantOf == null
  );
  fs.writeFileSync(
    path.join(privateDir, 'reference-selected.jsonl'),
    selectedReference.map(row => JSON.stringify(row)).join('\n') + '\n'
  );
  fs.writeFileSync(
    path.join(out, 'reference-hashes.json'),
    JSON.stringify(
      {
        note: '所选参考的原始记录 hash；仅留档与事后审核，不进入模型输入',
        records: selectedReference.map(row => ({
          trajectoryId: row.trajectoryId,
          checkpointId: row.checkpointId,
          cutoffIndex: row.cutoff.index,
          sha256: sha256(JSON.stringify(row)),
        })),
        combinedSha256: sha256(
          selectedReference.map(row => JSON.stringify(row)).join('\n')
        ),
      },
      null,
      1
    ) + '\n'
  );
  fs.writeFileSync(
    path.join(out, 'input-hashes.json'),
    JSON.stringify(
      {
        note: '冻结的是 system、协议、源消息与检查点边界；不冻结假客户端生成的事件快照',
        systemPromptSha256: sha256(REPLAY_SYSTEM_PROMPT),
        protocol: REPLAY_PROTOCOL,
        schemaVersion: REPLAY_SCHEMA,
        ...dataHashes,
      },
      null,
      1
    ) + '\n'
  );
  fs.writeFileSync(
    path.join(out, 'run-meta.json'),
    JSON.stringify(
      {
        mode,
        simulateFailures: failures,
        candidateModel: CANDIDATE_MODEL,
        sdkRetriesDisabled: true,
        checkpointCount: 12,
        dataHashes,
      },
      null,
      1
    ) + '\n'
  );

  const requestFile = path.join(privateDir, 'requests.jsonl');
  const rawFile = path.join(privateDir, 'raw-responses.jsonl');
  const checkpointFile = path.join(privateDir, 'checkpoints.jsonl');
  for (const file of [requestFile, rawFile, checkpointFile]) {
    if (fs.existsSync(file)) fs.rmSync(file);
  }

  const { client, model } = await buildClient(mode, failures);
  const replays = await replayAll({
    client,
    model,
    mode,
    trajectories,
    checkpoints,
    persistDir: privateDir,
    requestFile,
    rawFile,
    checkpointFile,
  });

  fs.writeFileSync(
    path.join(examplesDir, 'system.txt'),
    REPLAY_SYSTEM_PROMPT + '\n'
  );
  for (const replay of replays) {
    for (const record of replay.records) {
      fs.writeFileSync(
        path.join(examplesDir, `user-${replay.trajectoryId}-cp${record.ordinal}.json`),
        record.request.user + '\n'
      );
    }
  }

  // 假客户端的失败模拟与脚本化断言只在 fake 模式进行；real 模式不加载假答案。
  let simFailures: string[] = [];
  let simReplays: TrajectoryReplay[] = [];
  if (mode === 'fake') {
    const simulatedDir = path.join(privateDir, 'simulated-failure');
    fs.mkdirSync(simulatedDir, { recursive: true });
    const simRequestFile = path.join(simulatedDir, 'requests.jsonl');
    const simRawFile = path.join(simulatedDir, 'raw-responses.jsonl');
    const simCheckpointFile = path.join(simulatedDir, 'checkpoints.jsonl');
    for (const file of [simRequestFile, simRawFile, simCheckpointFile]) {
      if (fs.existsSync(file)) fs.rmSync(file);
    }
    simFailures = failures.length ? failures : ['TR-05#2'];
    const simMod = await import('./fake-client');
    const simClient = simMod.createScriptedClient(simMod.buildScript(), simFailures);
    simReplays = await replayAll({
      client: simClient.client,
      model: 'fake-model-1',
      mode: 'fake-simulated-failure',
      trajectories,
      checkpoints,
      persistDir: simulatedDir,
      requestFile: simRequestFile,
      rawFile: simRawFile,
      checkpointFile: simCheckpointFile,
    });
  }

  // ---------------------------------------------------------------- verification
  const findings: Array<{ check: string; ok: boolean; skipped?: boolean; detail: string }> = [];
  const check = (name: string, ok: boolean, detail = '', skipped = false) =>
    findings.push({
      check: name,
      ok: skipped ? true : Boolean(ok),
      skipped: skipped || undefined,
      detail: skipped ? `[skipped in ${mode} mode] ${detail}` : detail,
    });
  /** 只对脚本化答案成立的断言：real 模式跳过，不用假答案评判真实模型。 */
  const fakeOnly = (name: string, ok: boolean, detail = '') =>
    check(name, ok, detail, mode !== 'fake');

  const map = byKey(replays);
  const allRecords = replays.flatMap(replay => replay.records);

  // ---- 结构检查（fake / real 都跑；只查程序行为，不评判模型该输出什么）----
  {
    let ok = true;
    const details: string[] = [];
    for (const record of allRecords) {
      const payload = JSON.parse(record.request.user);
      const listed = [
        ...(payload.visibleMessages || []),
        ...(payload.newMessages || []),
        ...(payload.contextBeforeCheckpoint || []),
      ];
      const visibleIds = new Set(listed.map((message: any) => message.messageId));
      for (const operation of record.parsed.operations) {
        for (const evidence of operation.evidence || []) {
          if (!visibleIds.has(evidence.messageId)) {
            ok = false;
            details.push(`${record.checkpointId}:evidence_not_visible:${evidence.messageId}`);
          }
        }
      }
      for (const event of record.after.events) {
        for (const id of event.evidenceIds) {
          if (!visibleIds.has(id)) {
            ok = false;
            details.push(`${record.checkpointId}:event_evidence_not_visible:${id}`);
          }
        }
      }
    }
    check(
      'evidence_within_visible_range',
      ok,
      details.slice(0, 3).join('; ') || `${allRecords.length} 点证据均在可见范围`
    );
  }
  {
    let ok = true;
    const details: string[] = [];
    for (const record of allRecords) {
      if (!record.before || !record.after || !record.requestStatus) {
        ok = false;
        details.push(`${record.checkpointId}:missing_fields`);
      }
      if (
        record.requestStatus === 'failed' &&
        !deepEqual(record.before, record.after)
      ) {
        ok = false;
        details.push(`${record.checkpointId}:failed_after_changed`);
      }
      if (record.requestStatus === 'succeeded' && record.finishReason === null) {
        ok = false;
        details.push(`${record.checkpointId}:missing_finishReason`);
      }
    }
    check(
      'record_integrity',
      ok,
      details.slice(0, 3).join('; ') || '每点含 before/after/状态；失败点 after 不变'
    );
  }
  {
    const leak1 = redactSecrets('failed with sk-abcdef1234567890');
    const leak2 = redactSecrets('api_key=supersecretvalue123');
    check(
      'redaction_fake_key',
      !leak1.includes('abcdef1234567890') &&
        leak1.includes('sk-***') &&
        !leak2.includes('supersecretvalue123'),
      `${leak1} | ${leak2}`
    );
  }

  // V1 同一事件跨检查点保持 ID、后续累积、状态来自前次实际应用结果。
  {
    const cp2 = map.get('TR-03#2')!;
    const cp3 = map.get('TR-03#3')!;
    const created = cp2.after.events.find(event => event.state.includes('监考'));
    const after = cp3.after.events.find(event => event.eventId === created?.eventId);
    fakeOnly(
      'same_event_id_across_checkpoints',
      Boolean(created && after && after.status === 'completed'),
      `id=${created?.eventId} status=${after?.status} evidence=${after?.evidenceIds.length}`
    );
    fakeOnly(
      'replay_state_from_previous_applied_result',
      deepEqual(cp3.before, cp2.after),
      'cp3.before 与 cp2.after 逐字一致'
    );
  }

  // V2 无变化可返回空操作，程序不强制生成事件。
  {
    const cp2 = map.get('TR-09#2')!;
    fakeOnly(
      'empty_operations_allowed',
      cp2.parsed.rawOperationCount === 0 &&
        cp2.parsed.operations.length === 0 &&
        deepEqual(cp2.before, cp2.after),
      `rawCount=${cp2.parsed.rawOperationCount} events=${cp2.after.events.length}`
    );
    const cp1 = map.get('TR-09#1')!;
    fakeOnly(
      'no_forced_event_per_message',
      cp1.after.events.length === 2 && cp2.after.events.length === 2,
      `cp1 events=${cp1.after.events.length} cp2 events=${cp2.after.events.length}`
    );
  }

  // V3 完成后保留事实历史；部分改善不自动变痊愈。
  {
    const cp3 = map.get('TR-03#3')!;
    const done = cp3.after.events.find(event => event.state.includes('监考'));
    const history = (done?.stateHistory || []).map(item => item.state);
    fakeOnly(
      'completed_keeps_fact_history',
      done?.status === 'completed' &&
        history.includes('created') &&
        history.includes('resolved'),
      `history=${history.join('>')}`
    );
    const throat = map
      .get('TR-05#3')!
      .after.events.find(event => event.state.includes('嗓子'));
    fakeOnly(
      'partial_improvement_not_auto_cured',
      throat?.status === 'open' &&
        (throat?.state || '').includes('改善') &&
        (throat?.uncertainty || '').includes('痊愈'),
      `status=${throat?.status} uncertainty=${throat?.uncertainty}`
    );
  }

  // V4 新对话不改变之前保存的快照；输入不含未来消息。
  {
    let ok = true;
    const details: string[] = [];
    for (const replay of replays) {
      for (let i = 0; i < replay.records.length; i += 1) {
        const record = replay.records[i];
        if (i > 0 && !deepEqual(record.before, replay.records[i - 1].after)) {
          ok = false;
          details.push(`${record.checkpointId}:before!=prev.after`);
        }
        const payload = JSON.parse(record.request.user);
        const listed = [
          ...(payload.visibleMessages || []),
          ...(payload.newMessages || []),
          ...(payload.contextBeforeCheckpoint || []),
        ];
        if (listed.some((message: any) => message.index > record.cutoffIndex)) {
          ok = false;
          details.push(`${record.checkpointId}:future_message_present`);
        }
      }
    }
    check('no_future_input_and_stable_snapshot', ok, details.join('; ') || '12 点均无未来消息、快照延续一致');
  }

  // V5 无效引用、错误目标可追踪，不静默改写。
  {
    const cp1 = map.get('TR-05#1')!;
    const rejectedTarget = cp1.rejected.find(item => item.opId === 'op-5-invalid-target');
    const bogus = cp1.after.events.find(event => event.state.includes('故意指向不存在'));
    fakeOnly(
      'invalid_target_traceable',
      rejectedTarget?.reason === 'unknown_target_event' && !bogus,
      `rejected=${rejectedTarget?.reason}`
    );
  }

  // V6 拒谈限制关联到目标事件；事实状态不因拒谈变成取消；新安排继承后也受限。
  {
    const cp2 = map.get('TR-S01#2')!;
    const cp3 = map.get('TR-S01#3')!;
    const restriction = cp2.after.restrictions[0];
    const beforeEvent = cp2.before.events.find(event => event.state.includes('复查'));
    const afterEvent = cp2.after.events.find(
      event => event.eventId === beforeEvent?.eventId
    );
    const newArrangement = cp3.after.events.find(event =>
      event.state.includes('再去复查')
    );
    fakeOnly(
      'restrict_links_to_target_event',
      Boolean(
        restriction &&
          afterEvent &&
          afterEvent.restrictionRefs.includes(restriction.restrictionId) &&
          afterEvent.proactiveAllowed === false &&
          afterEvent.effectiveProactiveAllowed === false &&
          afterEvent.status === beforeEvent?.status
      ),
      `refs=${afterEvent?.restrictionRefs.join(',')} effective=${afterEvent?.effectiveProactiveAllowed} status=${afterEvent?.status}`
    );
    fakeOnly(
      'inherited_restriction_keeps_new_arrangement_restricted',
      Boolean(
        newArrangement &&
          newArrangement.proactiveAllowed === false &&
          newArrangement.effectiveProactiveAllowed === false &&
          newArrangement.restrictionRefs.includes(restriction?.restrictionId) &&
          cp3.after.restrictions[0]?.active === true
      ),
      `newRefs=${newArrangement?.restrictionRefs.join(',')}`
    );
  }

  // V7 助手话不能单独作为用户事实证据；与用户确认联合可溯源。
  {
    const visible: VisibleMessage[] = [
      { messageId: 'a1', role: 'assistant', content: '你想去复查吗' },
      { messageId: 'u1', role: 'user', content: '嗯' },
    ];
    const assistantOnly = JSON.stringify({
      schemaVersion: REPLAY_SCHEMA,
      operations: [
        {
          opId: 'x1',
          action: 'create',
          kind: 'open_event',
          state: '用户要去复查',
          evidence: [{ messageId: 'a1', quote: '你想去复查吗' }],
          reason: 'assistant-only',
        },
      ],
    });
    const rejected = parseReplayOutput(assistantOnly, visible, [], []);
    const joint = parseReplayOutput(
      JSON.stringify({
        schemaVersion: REPLAY_SCHEMA,
        operations: [
          {
            opId: 'x2',
            action: 'create',
            kind: 'open_event',
            state: '用户确认要去复查',
            evidence: [
              { messageId: 'a1', quote: '你想去复查吗' },
              { messageId: 'u1', quote: '嗯' },
            ],
            reason: 'assistant question + user confirmation',
          },
        ],
      }),
      visible,
      [],
      []
    );
    check(
      'assistant_only_evidence_rejected',
      rejected.rejected.some(item => item.reason === 'assistant_only_evidence') &&
        joint.operations.length === 1,
      `rejected=${rejected.rejected.map(item => item.reason).join(',')}`
    );
  }

  // V8 归属不明单独保留，不覆盖已确定事件。
  {
    const cp1 = map.get('TR-05#1')!;
    fakeOnly(
      'unresolved_kept_separately',
      cp1.after.unresolved.length >= 1 &&
        cp1.after.events.length === 2 &&
        cp1.outcomes.some(item => item.action === 'unclear' && item.applied),
      `unresolved=${cp1.after.unresolved.length} events=${cp1.after.events.length}`
    );
  }

  // V9 当前轮意图不进持久快照。
  {
    const cp2 = map.get('TR-03#2')!;
    fakeOnly(
      'current_turn_intent_not_persisted',
      cp2.currentTurnIntents.length >= 1 &&
        !JSON.stringify(cp2.after).includes('不建立现实待办'),
      `intents=${cp2.currentTurnIntents.length}`
    );
  }

  // V10 输入不含参考答案：冷启动快照为空，且任何请求都不出现参考 eventId。
  {
    const referenceIds = selectedReference.flatMap(row =>
      [...(row.before || []), ...(row.after || [])].map((event: any) => event.eventId)
    );
    let ok = true;
    const details: string[] = [];
    for (const record of allRecords) {
      if (referenceIds.some(id => record.request.user.includes(id))) {
        ok = false;
        details.push(`${record.checkpointId}:reference_eventId_in_input`);
      }
      if (record.coldStart) {
        const payload = JSON.parse(record.request.user);
        if (
          (payload.eventSnapshot?.events || []).length !== 0 ||
          payload.contextBeforeCheckpoint !== undefined
        ) {
          ok = false;
          details.push(`${record.checkpointId}:cold_start_not_empty`);
        }
      }
    }
    check(
      'input_has_no_reference_answer',
      ok,
      details.join('; ') || `coldStart 快照为空；${allRecords.length} 个请求均无参考 eventId`
    );
  }

  // V11 同一引文的两个不同事件都保留（不再按证据包含判重）。
  {
    const sigs = new Set<string>();
    const { result } = unitApply(
      [
        {
          opId: 's1',
          action: 'create',
          kind: 'open_event',
          eventId: null,
          state: '父亲明天检查',
          evidence: [{ messageId: 'u1', quote: '父亲明天检查' }],
          reason: '同一句里的第一件事',
        },
        {
          opId: 's2',
          action: 'create',
          kind: 'open_event',
          eventId: null,
          state: '用户后天出差',
          evidence: [{ messageId: 'u1', quote: '我后天出差' }],
          reason: '同一句里的第二件事',
        },
      ],
      emptySnapshot(),
      sigs
    );
    check(
      'shared_evidence_two_events_kept',
      result.snapshot.events.length === 2,
      `events=${result.snapshot.events.length}`
    );
  }

  // V12 同一操作重放不重复写。
  {
    const sigs = new Set<string>();
    const ops = [
      {
        opId: 'd1',
        action: 'create',
        kind: 'open_event',
        eventId: null,
        state: '用户后天出差',
        evidence: [{ messageId: 'u1', quote: '我后天出差' }],
        reason: '同一操作',
      },
    ];
    const first = unitApply(ops, emptySnapshot(), sigs);
    const second = unitApply(
      [{ ...ops[0], opId: 'd1-again' }],
      first.result.snapshot,
      sigs
    );
    check(
      'replayed_operation_not_double_written',
      first.result.snapshot.events.length === 1 &&
        second.result.snapshot.events.length === 1 &&
        second.result.outcomes.some(
          item => item.reason === 'duplicate_operation_noop'
        ),
      `events=${second.result.snapshot.events.length} outcome=${second.result.outcomes[0]?.reason}`
    );
  }

  // V13 重叠证据但有新细节的有效更新不被丢弃。
  {
    const sigs = new Set<string>();
    const created = unitApply(
      [
        {
          opId: 'o1',
          action: 'create',
          kind: 'open_event',
          eventId: null,
          state: '用户后天出差',
          evidence: [{ messageId: 'u1', quote: '我后天出差' }],
          reason: '初始',
        },
      ],
      emptySnapshot(),
      sigs
    );
    const updated = unitApply(
      [
        {
          opId: 'o2',
          action: 'update',
          eventId: created.result.snapshot.events[0].eventId,
          state: '用户后天出差，已订票',
          details: ['已订票'],
          evidence: [{ messageId: 'u1', quote: '我后天出差' }],
          reason: '重叠证据 + 新细节',
        },
      ],
      created.result.snapshot,
      sigs
    );
    const event = updated.result.snapshot.events[0];
    check(
      'overlapping_evidence_with_new_details_applies',
      updated.result.outcomes[0]?.applied === true &&
        event.state.includes('已订票') &&
        event.details.includes('已订票'),
      `applied=${updated.result.outcomes[0]?.applied} state=${event.state}`
    );
  }

  // V14 同范围限制复用到另一个明确目标时也要关联该目标。
  {
    const step1 = unitApply(
      [
        {
          opId: 'r1',
          action: 'create',
          kind: 'open_event',
          eventId: null,
          state: '复查安排',
          evidence: [{ messageId: 'u1', quote: '父亲明天检查' }],
          reason: '目标一',
          proactiveAllowed: true,
        },
        {
          opId: 'r2',
          action: 'create',
          kind: 'open_event',
          eventId: null,
          state: '另一件检查事项',
          evidence: [{ messageId: 'u1', quote: '我后天出差' }],
          reason: '目标二',
          proactiveAllowed: true,
        },
      ],
      emptySnapshot(),
      new Set<string>()
    );
    const [eventOne, eventTwo] = step1.result.snapshot.events;
    const step2 = unitApply(
      [
        {
          opId: 'r3',
          action: 'restrict',
          eventId: eventOne.eventId,
          restrictionScope: 'topic:检查',
          evidence: [{ messageId: 'u2', quote: '嗯' }],
          reason: '限制目标一',
        },
      ],
      step1.result.snapshot,
      new Set<string>()
    );
    const step3 = unitApply(
      [
        {
          opId: 'r4',
          action: 'restrict',
          eventId: eventTwo.eventId,
          restrictionScope: 'topic:检查',
          evidence: [{ messageId: 'u2', quote: '嗯' }],
          reason: '同范围限制复用到目标二',
        },
      ],
      step2.result.snapshot,
      new Set<string>()
    );
    const two = step3.result.snapshot.events.find(
      event => event.eventId === eventTwo.eventId
    );
    check(
      'same_scope_restriction_links_second_target',
      two?.restrictionRefs.length === 1 &&
        two?.proactiveAllowed === false &&
        two?.effectiveProactiveAllowed === false &&
        step3.result.snapshot.restrictions.length === 1,
      `refs=${two?.restrictionRefs.length} restrictions=${step3.result.snapshot.restrictions.length}`
    );
  }

  // V15 首次看到就已完成：initialStatus 生效；默认 open_event 仍为 open。
  {
    const sigs = new Set<string>();
    const { result } = unitApply(
      [
        {
          opId: 'c1',
          action: 'create',
          kind: 'open_event',
          eventId: null,
          state: '用户已完成的事',
          evidence: [{ messageId: 'u1', quote: '父亲明天检查' }],
          reason: '首次看到就已完成',
          initialStatus: 'completed',
        },
        {
          opId: 'c2',
          action: 'create',
          kind: 'open_event',
          eventId: null,
          state: '默认开放事件',
          evidence: [{ messageId: 'u1', quote: '我后天出差' }],
          reason: '默认',
        },
      ],
      emptySnapshot(),
      sigs
    );
    const [completed, open] = result.snapshot.events;
    check(
      'initial_status_completed_supported',
      completed?.status === 'completed' && open?.status === 'open',
      `first=${completed?.status} second=${open?.status}`
    );
  }

  // V16 显式权限更新生效，但被限制覆盖。
  {
    const sigs = new Set<string>();
    const step1 = unitApply(
      [
        {
          opId: 'p1',
          action: 'create',
          kind: 'open_event',
          eventId: null,
          state: '待跟进事项',
          evidence: [{ messageId: 'u1', quote: '父亲明天检查' }],
          reason: '初始',
          proactiveAllowed: false,
        },
      ],
      emptySnapshot(),
      sigs
    );
    const eventId = step1.result.snapshot.events[0].eventId;
    const step2 = unitApply(
      [
        {
          opId: 'p2',
          action: 'update',
          eventId,
          proactiveAllowed: true,
          evidence: [{ messageId: 'u2', quote: '嗯' }],
          reason: '显式允许',
        },
      ],
      step1.result.snapshot,
      sigs
    );
    const step3 = unitApply(
      [
        {
          opId: 'p3',
          action: 'restrict',
          eventId,
          restrictionScope: 'topic:检查',
          evidence: [{ messageId: 'u2', quote: '嗯' }],
          reason: '随后限制',
        },
      ],
      step2.result.snapshot,
      sigs
    );
    const event = step3.result.snapshot.events[0];
    check(
      'explicit_permission_update_then_restriction_overrides',
      step2.result.snapshot.events[0].effectiveProactiveAllowed === true &&
        event.proactiveAllowed === false &&
        event.effectiveProactiveAllowed === false,
      `afterUpdate=${step2.result.snapshot.events[0].effectiveProactiveAllowed} afterRestrict=${event.effectiveProactiveAllowed}`
    );
  }

  // V17 schemaVersion 不匹配整批拒绝。
  {
    const sigs = new Set<string>();
    const { parse, result } = unitApply(
      [
        {
          opId: 'z1',
          action: 'create',
          kind: 'open_event',
          eventId: null,
          state: '不应执行',
          evidence: [{ messageId: 'u1', quote: '父亲明天检查' }],
          reason: 'schema 错误',
        },
      ],
      emptySnapshot(),
      sigs,
      'wrong_schema'
    );
    check(
      'schema_mismatch_rejects_whole_batch',
      parse.rejected.some(item => item.reason === 'schema_version_mismatch') &&
        parse.operations.length === 0 &&
        result.snapshot.events.length === 0,
      `ops=${parse.operations.length} events=${result.snapshot.events.length}`
    );
  }

  // V18 模拟第二点失败：第一点记录保留、后续输入没有假快照/参考补答案（仅 fake）。
  if (mode === 'fake') {
    const simMap = byKey(simReplays);
    const first = simMap.get('TR-05#1')!;
    const failed = simMap.get('TR-05#2')!;
    const third = simMap.get('TR-05#3')!;
    const thirdPayload = JSON.parse(third.request.user);
    const thirdEventIds = (thirdPayload.eventSnapshot?.events || []).map(
      (event: any) => event.eventId
    );
    const firstEventIds = first.after.events.map(event => event.eventId);
    const referenceIds = selectedReference.flatMap(row =>
      [...(row.before || []), ...(row.after || [])].map((event: any) => event.eventId)
    );
    fakeOnly(
      'simulated_point_failure_keeps_earlier_and_no_fakes',
      first.requestStatus === 'succeeded' &&
        failed.requestStatus === 'failed' &&
        deepEqual(failed.before, failed.after) &&
        deepEqual(third.before, first.after) &&
        JSON.stringify(thirdEventIds) === JSON.stringify(firstEventIds) &&
        !referenceIds.some(id => third.request.user.includes(id)),
      `first=${first.requestStatus} failed=${failed.requestStatus} thirdSnap=${thirdEventIds.length}`
    );
  }

  const allPassed = findings.every(item => item.ok);
  const summary = {
    note: '本轮只跑假客户端（或模拟失败）：这些结果只证明回放与状态应用正确，不能证明模型理解口语，也不是抽取能力成绩',
    mode,
    simulatedFailures: simFailures,
    checkpointCount: allRecords.length,
    dataHashes,
    allPassed,
    checks: findings,
    trajectories: replays.map(replay => ({
      trajectoryId: replay.trajectoryId,
      anonymousUser: replay.anonymousUser,
      checkpoints: replay.records.map(record => ({
        checkpointId: record.checkpointId,
        ordinal: record.ordinal,
        requestStatus: record.requestStatus,
        finishReason: record.finishReason,
        truncated: record.truncated,
        operations: record.parsed.operations.length,
        rejected: record.parsed.rejected.length,
        applied: record.outcomes.filter((outcome: any) => outcome.applied).length,
        eventsAfter: record.after.events.length,
        restrictionsAfter: record.after.restrictions.length,
        unresolvedAfter: record.after.unresolved.length,
      })),
    })),
  };
  fs.writeFileSync(
    path.join(out, 'verification.json'),
    JSON.stringify(summary, null, 1) + '\n'
  );
  fs.writeFileSync(
    path.join(out, 'summary.json'),
    JSON.stringify(
      {
        note: summary.note,
        mode,
        simulatedFailures: simFailures,
        checkpointCount: allRecords.length,
        allPassed,
      },
      null,
      1
    ) + '\n'
  );

  for (const item of findings) {
    console.log(`${item.ok ? 'PASS' : 'FAIL'} ${item.check} - ${item.detail}`);
  }
  console.log(allPassed ? 'ALL PASSED' : 'SOME FAILED');
  console.log(`mode=${mode} out=${out}`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
