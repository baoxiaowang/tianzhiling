/**
 * 回归记忆抽取专项（R00 起）本地实验台。
 *
 * 只做本地：读本地片段/合成场景 → 组装与生产一致的输入 → 调既有可用模型 →
 * 保存 raw → 用仓库现有解析与归并逻辑投影 → 产出对照指标。
 * 不写生产库、不改生产配置、不发布。
 *
 * 用法：
 *   npx ts-node --transpile-only -P scripts/return-extract-v2/tsconfig.json \
 *     scripts/return-extract-v2/harness.ts run --mode v1 --dataset real --split dev \
 *     --out ../../.task-evidence/return-extraction-v2/runs/R00-baseline --limit 5
 */
import { createHash } from 'crypto';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import OpenAI from 'openai';
import { MongoObjectId } from '@tzl/entities';
import { MemoryEventEngine } from '../../src/service/memory/memory-event.engine';
import {
  OPEN_ITEM_EXTRACTION_SYSTEM_PROMPT,
  buildOpenItemExtractionPrompt,
  parseOpenItemExtractionOutput,
  selectOpenItemExtractionWindow,
  type OpenItemExtractionMessage,
} from '../../src/service/memory/memory-open-item-extraction';
import { isFactBearingUtterance } from '../../src/service/agents/memory-value';
import { parseExtractionOutputStrict } from '../../src/service/memory/return-extract-v2/validate';
import {
  buildExtractorInputV2,
  renderMessagesForLegacyPrompt,
} from '../../src/service/memory/return-extract-v2/input';
import {
  RETURN_EXTRACT_SYSTEM_PROMPT,
  buildV2Prompt,
} from '../../src/service/memory/return-extract-v2/prompt';
import {
  NARROW_SYSTEM_PROMPT,
  buildNarrowPrompt,
} from '../../src/service/memory/return-extract-v2/prompt-narrow';
import {
  CONCRETE_SYSTEM_PROMPT,
  DISCOVERY_SYSTEM_PROMPT,
  buildConcretePrompt,
  buildDiscoveryPrompt,
  buildReviewPrompt,
} from '../../src/service/memory/return-extract-v2/prompt-n03';
import {
  operationsToScorable,
  parseExtractionOutputV2,
} from '../../src/service/memory/return-extract-v2/validate-v2';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
// 两步模式的第二步系统提示（与 prompt-n03 的 REVIEW_SYSTEM_PROMPT 一致）
const REVIEW_SYSTEM_PROTOCOL_FALLBACK = (() => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('../../src/service/memory/return-extract-v2/prompt-n03')
    .REVIEW_SYSTEM_PROMPT;
})();
const EVIDENCE_ROOT = path.join(
  REPO_ROOT,
  '.task-evidence/return-extraction-v2'
);
const WINDOW_DAYS = 30;
const MAX_INPUT_MESSAGES = 60;
const MAX_OUTPUT_TOKENS = 4000;

// ---------------------------------------------------------------- env / model

function loadEnv() {
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

const ENV = loadEnv();
const envValue = (key: string) => process.env[key] || ENV[key] || '';

interface ModelTarget {
  label: string;
  baseURL: string;
  apiKey: string;
  model: string;
}

function resolveModel(name: string): ModelTarget {
  if (name === 'qwen-plus') {
    return {
      label: 'qwen-plus@dashscope',
      baseURL: envValue('NODE_EMBEDDING_BASE_URL'),
      apiKey: envValue('NODE_EMBEDDING_API_KEY'),
      model: envValue('NODE_MEMORY_OPEN_ITEM_MODEL') || 'qwen-plus',
    };
  }
  if (name === 'doubao-seed-character') {
    return {
      label: 'doubao-seed-character@ark',
      baseURL: envValue('NODE_CHAT_BASE_URL'),
      apiKey: envValue('NODE_CHAT_API_KEY'),
      model: envValue('NODE_CHAT_MODEL') || 'doubao-seed-character-260628',
    };
  }
  if (name === 'deepseek-v4-flash') {
    return {
      label: 'deepseek-v4-flash@deepseek',
      baseURL:
        envValue('NODE_CHAT_FALLBACK_BASE_URL') || 'https://api.deepseek.com',
      apiKey: envValue('NODE_CHAT_FALLBACK_API_KEY'),
      model: envValue('NODE_CHAT_FALLBACK_MODEL') || 'deepseek-v4-flash',
    };
  }
  throw new Error(`unknown model: ${name}`);
}

let cachedClient: { target: ModelTarget; client: OpenAI } | undefined;
let requestInvoker:
  | ReturnType<typeof import('./request-boundary').createModelInvoker>
  | undefined;

export function buildRequest(options: {
  fragmentId: string;
  mode: string;
  protocol: string;
  inputMode: string;
  step: number;
  model: string;
  system: string;
  user: string;
  messageIds: string[];
  promptSource: string;
}): ModelRequest {
  return {
    fragmentId: options.fragmentId,
    mode: options.mode,
    protocol: options.protocol,
    inputMode: options.inputMode,
    step: options.step,
    model: options.model,
    params: { temperature: 0, topP: 0.1, maxTokens: MAX_OUTPUT_TOKENS },
    system: options.system,
    user: options.user,
    messageIds: options.messageIds,
    promptSource: options.promptSource,
  };
}

// ---------------------------------------------------------------- in-memory repo

type Doc = Record<string, any>;

function matches(row: Doc, where: Doc): boolean {
  for (const [key, value] of Object.entries(where)) {
    if (key === '$expr') return false;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const operator = value as Doc;
      if ('$in' in operator) {
        const list = (operator.$in as unknown[]).map(item => String(item));
        if (list.indexOf(String(row[key])) === -1) return false;
        continue;
      }
      if ('$ne' in operator) {
        if (String(row[key]) === String(operator.$ne)) return false;
        continue;
      }
    }
    if (String(row[key]) !== String(value)) return false;
  }
  return true;
}

class FakeRepo {
  rows: Doc[] = [];
  private seq = 0;
  async find(options?: {
    where?: Doc;
    order?: Doc;
    take?: number;
  }): Promise<Doc[]> {
    let rows = this.rows.filter(row => matches(row, options?.where || {}));
    if (typeof options?.take === 'number') rows = rows.slice(0, options.take);
    return rows;
  }
  async findOne(options: { where: Doc }): Promise<Doc | undefined> {
    return this.rows.find(row => matches(row, options.where));
  }
  async save(entity: Doc): Promise<Doc> {
    const row = { ...entity };
    if (!row.id) {
      this.seq += 1;
      row.id = new MongoObjectId(String(this.seq).padStart(24, '0'));
    }
    const index = this.rows.findIndex(
      item => String(item.id) === String(row.id)
    );
    if (index === -1) this.rows.push(row);
    else this.rows[index] = row;
    return row;
  }
  async delete(criteria: Doc): Promise<{ affected: number }> {
    const before = this.rows.length;
    this.rows = this.rows.filter(row => !matches(row, criteria));
    return { affected: before - this.rows.length };
  }
}

// ---------------------------------------------------------------- dataset

interface Fragment {
  fragmentId: string;
  sourceType: string;
  userId: string;
  kind: string;
  gapHours?: number | null;
  now: string;
  messages: Array<{
    id: string;
    at: string;
    content: string;
    role: string;
    archived?: boolean;
    foreignUser?: boolean;
  }>;
  expected?: any;
  existingItems?: ExistingItem[];
  scenarioId?: string;
  repeat?: number;
  deletedMessageIds?: string[];
}

interface ExistingItem {
  itemId: string;
  kind: string;
  topicKey: string;
  subject: string;
  summary: string;
  state: string;
  evidenceIds: string[];
}

function loadFragments(dataset: string, split: string): Fragment[] {
  if (dataset === 'scenarios' || dataset === 'stress') {
    const file =
      dataset === 'scenarios'
        ? path.join(EVIDENCE_ROOT, 'fixtures/scenarios-E01-E24.json')
        : path.join(EVIDENCE_ROOT, 'fixtures/stress-S01-S08.json');
    const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
    return doc.scenarios.map((scenario: any) => ({
      fragmentId: scenario.scenarioId,
      scenarioId: scenario.scenarioId,
      sourceType: 'synthetic',
      userId: '6aa000000000000000000001',
      kind: 'session',
      gapHours: null,
      now: scenario.messages[scenario.messages.length - 1].at,
      messages: scenario.messages,
      expected: scenario.expected,
      existingItems: scenario.existingItems || [],
      repeat: scenario.repeat || scenario.replay || 1,
      deletedMessageIds: scenario.deletedMessageIds || [],
    }));
  }
  const file = path.join(EVIDENCE_ROOT, 'private/fragments.jsonl');
  const rows: Fragment[] = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const row = JSON.parse(line) as Fragment;
    if (
      split !== 'all' &&
      row.sourceType !== 'real_dialogue' &&
      row.kind !== 'dialogue'
    ) {
      if (row['split'] !== split) continue;
    }
    rows.push(row);
  }
  return rows;
}

/** v1：与生产完全一致的输入构造（近 30 天、最多 60 条、>40 条做事实型过滤）。 */
function buildV1Input(fragment: Fragment, now: Date) {
  const since = new Date(now.getTime() - WINDOW_DAYS * 24 * 3600 * 1000);
  const deleted = new Set(fragment.deletedMessageIds || []);
  const rows = fragment.messages
    .filter(message => !deleted.has(message.id))
    .filter(message => message.role === 'user')
    .filter(message => !message.archived)
    .filter(message => !message.foreignUser)
    .filter(message => new Date(message.at).getTime() >= since.getTime())
    .sort(
      (left, right) =>
        new Date(right.at).getTime() - new Date(left.at).getTime()
    )
    .slice(0, MAX_INPUT_MESSAGES);
  const picked = selectOpenItemExtractionWindow(
    rows
      .slice()
      .sort(
        (left, right) =>
          new Date(left.at).getTime() - new Date(right.at).getTime()
      ),
    {
      textOf: message => message.content,
      isFactBearing: text => isFactBearingUtterance(text),
    }
  );
  const messages: OpenItemExtractionMessage[] = picked.map(message => ({
    messageId: message.id,
    content: message.content,
    occurredAt: new Date(message.at).toISOString(),
  }));
  return {
    messages,
    droppedByWindow: fragment.messages.filter(
      message =>
        message.role === 'user' && !picked.some(item => item.id === message.id)
    ).length,
    prompt: messages.length ? buildOpenItemExtractionPrompt(messages) : '',
  };
}

/** R01：新的取数口径（无 30 天限制、不预删短句、带覆盖账本），仍复用旧提示词模板。 */
function buildV2InputForProtocol(fragment: Fragment, now: Date) {
  const rows = fragment.messages.map(message => ({
    id: message.id,
    role: (message.role === 'assistant' ? 'assistant' : 'user') as
      | 'user'
      | 'assistant',
    occurredAt: new Date(message.at).toISOString(),
    content: message.content,
    sourceType: 'text' as const,
    archived: message.archived,
    foreignUser: message.foreignUser,
  }));
  const deleted = new Set(fragment.deletedMessageIds || []);
  const usable = rows.filter(
    row => !deleted.has(row.id) && !row.archived && !row.foreignUser
  );
  const built = buildExtractorInputV2(usable, { now });
  const existing = (fragment.existingItems || []).map(item => ({
    itemId: item.itemId,
    kind: item.kind,
    subject: item.subject,
    description: item.summary,
    state: item.state,
  }));
  const prompt = buildV2Prompt(built, existing);
  return { built, prompt, existing };
}

function buildV2Input(fragment: Fragment, now: Date) {
  const rows = fragment.messages.map(message => ({
    id: message.id,
    role: (message.role === 'assistant' ? 'assistant' : 'user') as
      | 'user'
      | 'assistant',
    occurredAt: new Date(message.at).toISOString(),
    content: message.content,
    sourceType: 'text' as const,
    archived: message.archived,
    foreignUser: message.foreignUser,
  }));
  const deleted = new Set(fragment.deletedMessageIds || []);
  const usable = rows.filter(
    row => !deleted.has(row.id) && !row.archived && !row.foreignUser
  );
  const built = buildExtractorInputV2(usable, { now });
  const messages: OpenItemExtractionMessage[] =
    renderMessagesForLegacyPrompt(built);
  return {
    messages,
    droppedByWindow:
      built.coverage.legacyDroppedMessages -
      built.coverage.legacyFilteredByFact,
    prompt: messages.length ? buildOpenItemExtractionPrompt(messages) : '',
    coverage: built.coverage,
  };
}

// ---------------------------------------------------------------- raw audit

/** 直接审模型原始输出里的引文/ID 是否自洽（解析器之前的那一层）。 */
function auditRaw(raw: string, messages: OpenItemExtractionMessage[]) {
  const result = {
    jsonValid: false,
    itemsDeclared: 0,
    quoteExactInDeclaredId: 0,
    quoteFoundInOtherMessageOnly: 0,
    quoteNotFound: 0,
    relocatedExamples: [] as Array<{
      declared: string;
      foundIn: string;
      quote: string;
    }>,
  };
  let parsed: any;
  try {
    parsed = JSON.parse(
      (raw || '')
        .trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/u, '')
    );
  } catch {
    return result;
  }
  result.jsonValid = true;
  const items = Array.isArray(parsed?.items) ? parsed.items : [];
  result.itemsDeclared = items.length;
  const normalize = (value: string) =>
    (value || '').replace(/[^\p{Script=Han}\p{L}\p{N}]/gu, '');
  for (const item of items) {
    const quote = String(item?.quote || '').trim();
    const declared = String(item?.messageId || '').trim();
    if (!quote) continue;
    const declaredMessage = messages.find(
      message => message.messageId === declared
    );
    if (
      declaredMessage &&
      normalize(declaredMessage.content).includes(normalize(quote))
    ) {
      result.quoteExactInDeclaredId += 1;
      continue;
    }
    const other = messages.find(message =>
      normalize(message.content).includes(normalize(quote))
    );
    if (other) {
      result.quoteFoundInOtherMessageOnly += 1;
      if (result.relocatedExamples.length < 5) {
        result.relocatedExamples.push({
          declared,
          foundIn: other.messageId,
          quote: quote.slice(0, 24),
        });
      }
      continue;
    }
    result.quoteNotFound += 1;
  }
  return result;
}

// ---------------------------------------------------------------- run

interface RunOptions {
  mode: string;
  dataset: string;
  split: string;
  out: string;
  limit: number;
  model: string;
  concurrency: number;
  only: string[];
  tag: string;
  input: string;
  parse: string;
  protocol: string;
  reuseRaw: string;
  fakeModel: boolean;
  failStep: number;
}

function parseArgs(argv: string[]): RunOptions {
  const get = (flag: string, fallback: string) => {
    const index = argv.indexOf(flag);
    return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
  };
  return {
    mode: get('--mode', 'v1'),
    dataset: get('--dataset', 'real'),
    split: get('--split', 'dev'),
    out: get('--out', ''),
    limit: Number(get('--limit', '0')),
    model: get('--model', 'qwen-plus'),
    concurrency: Number(get('--concurrency', '2')),
    only: get('--only', '') ? get('--only', '').split(',') : [],
    tag: get('--tag', ''),
    input: get('--input', 'v1'),
    parse: get('--parse', 'v1'),
    protocol: get('--protocol', 'v1'),
    reuseRaw: get('--reuse-raw', ''),
    fakeModel: argv.includes('--fake-model'),
    failStep: Number(get('--fail-step', '0')) || 0,
  };
}

/** R02/R06：新协议操作的确定性生命周期（共享实现，见 src/service/memory/return-extract-v2/lifecycle.ts）。 */
function projectOperationsV2(operations: any[], seededItems: any[]) {
  const messageTimes: Record<string, string> = {};
  const items = seededItems.map(item => ({
    itemId: String(item.id),
    kind: item.kind,
    state: item.state,
    description: item.summary,
    subjectLabel: item.subjectRef || null,
    evidenceIds: item.sourceMessageIds || [],
    stateHistory: [{ state: item.state }],
  }));
  for (const item of items) {
    for (const id of item.evidenceIds)
      messageTimes[String(id)] = new Date('2026-09-10T12:00:00Z').toISOString();
  }
  const {
    applyOperations,
  } = require('../../src/service/memory/return-extract-v2/lifecycle');
  const result = applyOperations(operations, items, { messageTimes });
  return {
    items: result.items.map((item: any) => ({
      id: item.itemId,
      kind: item.kind,
      state: item.state,
      summary: item.description,
      subjectRef: item.subjectLabel,
      sourceMessageIds: item.evidenceIds,
      stateHistory: item.stateHistory,
    })),
    outcomes: result.outcomes.map((outcome: any) => ({
      opId: outcome.opId,
      action: outcome.action,
      applied: outcome.applied,
      reason: outcome.reason,
    })),
  };
}

async function runOne(
  fragment: Fragment,
  options: RunOptions,
  seeded: Map<string, ExistingItem[]>,
  reuseRaw?: Map<string, string>
): Promise<any> {
  const now = new Date(fragment.now);
  const n03Mode =
    options.protocol === 'concrete' || options.protocol === 'two-step';
  const useLegacyProtocol = !['v2', 'concrete', 'two-step', 'narrow'].includes(
    options.protocol
  );
  const protocolInput = useLegacyProtocol
    ? null
    : buildV2InputForProtocol(fragment, now);
  const built = protocolInput
    ? null
    : options.input === 'v2'
    ? buildV2Input(fragment, now)
    : buildV1Input(fragment, now);
  const record: any = {
    fragmentId: fragment.fragmentId,
    scenarioId: fragment.scenarioId || null,
    split: fragment['split'] || fragment.sourceType,
    kind: fragment.kind,
    gapHours: fragment.gapHours ?? null,
    inputMessageIds: protocolInput
      ? protocolInput.built.segments.flatMap(segment =>
          segment.messages.map(message => message.id)
        )
      : built!.messages.map(message => message.messageId),
    droppedByWindow: protocolInput
      ? protocolInput.built.coverage.legacyDroppedMessages
      : built!.droppedByWindow,
    inputChars: protocolInput
      ? protocolInput.prompt.length
      : built!.prompt.length,
  };
  if (
    protocolInput
      ? !protocolInput.built.segments.length
      : !built!.messages.length
  ) {
    record.status = 'empty_input';
    return record;
  }
  const startedAt = Date.now();
  const messageIds = protocolInput
    ? protocolInput.built.segments.flatMap(segment =>
        segment.messages.map(message => message.id)
      )
    : built!.messages.map(message => message.messageId);
  /** 所有分支都走统一边界：调用前登记 attempted，成功/失败再落状态，失败也保留记录。 */
  const invoke = async (
    step: number,
    system: string,
    user: string,
    promptSource: string
  ) => {
    const request = buildRequest({
      fragmentId: fragment.fragmentId,
      mode: options.mode,
      protocol: options.protocol,
      inputMode: options.input,
      step,
      model: options.model,
      system,
      user,
      messageIds,
      promptSource,
    });
    return requestInvoker!.invoke(request);
  };
  let call: { raw: string; finishReason: string; usage: unknown };
  if (reuseRaw) {
    call = {
      raw: reuseRaw.get(fragment.fragmentId) || '',
      finishReason: 'reused',
      usage: null,
    };
    requestInvoker!.markNotSent({
      fragmentId: fragment.fragmentId,
      mode: options.mode,
      protocol: options.protocol,
      inputMode: options.input,
      model: options.model,
      params: { temperature: 0, topP: 0.1, maxTokens: MAX_OUTPUT_TOKENS },
      promptSource: 'reused_raw',
    });
  } else {
    try {
      if (options.protocol === 'narrow' && protocolInput) {
        const user = buildNarrowPrompt(
          protocolInput.built,
          protocolInput.existing
        );
        call = await invoke(0, NARROW_SYSTEM_PROMPT, user, 'prompt-narrow');
      } else if (options.protocol === 'concrete' && protocolInput) {
        const user = buildConcretePrompt(
          protocolInput.built,
          protocolInput.existing
        );
        call = await invoke(0, CONCRETE_SYSTEM_PROMPT, user, 'prompt-n03');
      } else if (options.protocol === 'two-step' && protocolInput) {
        const discoveryUser = buildDiscoveryPrompt(
          protocolInput.built,
          protocolInput.existing
        );
        const step1 = await invoke(
          0,
          DISCOVERY_SYSTEM_PROMPT,
          discoveryUser,
          'prompt-n03-discovery'
        );
        let candidates: unknown = [];
        try {
          candidates = JSON.parse(
            (step1.raw || '')
              .trim()
              .replace(/^```(?:json)?\s*/i, '')
              .replace(/\s*```$/u, '')
          );
        } catch {
          candidates = { parseFailed: true, rawChars: step1.raw.length };
        }
        const reviewUser = buildReviewPrompt({
          input: protocolInput.built,
          existingItems: protocolInput.existing,
          candidates,
        });
        call = await invoke(
          1,
          REVIEW_SYSTEM_PROTOCOL_FALLBACK,
          reviewUser,
          'prompt-n03-review'
        );
      } else {
        call = await invoke(
          0,
          protocolInput
            ? RETURN_EXTRACT_SYSTEM_PROMPT
            : OPEN_ITEM_EXTRACTION_SYSTEM_PROMPT,
          protocolInput ? protocolInput.prompt : built!.prompt,
          protocolInput ? 'prompt-v2' : 'memory-open-item-extraction'
        );
      }
    } catch (error) {
      record.status = 'model_failed';
      record.error = error instanceof Error ? error.message : String(error);
      record.requests = requestInvoker!.forFragment(fragment.fragmentId);
      return record;
    }
  }
  record.latencyMs = Date.now() - startedAt;
  record.finishReason = call.finishReason;
  record.usage = call.usage;
  record.rawChars = call.raw.length;
  record.rawText = call.raw;
  if (
    protocolInput &&
    (options.protocol === 'v2' || n03Mode || options.protocol === 'narrow')
  ) {
    const parsedV2 = parseExtractionOutputV2(
      call.raw,
      protocolInput.built.segments.flatMap(segment =>
        segment.messages.map(message => ({
          messageId: message.id,
          content: message.content,
          role: message.role,
        }))
      ),
      protocolInput.existing.map(item => item.itemId)
    );
    record.operations = parsedV2.operations;
    record.unresolvedReferences = parsedV2.unresolvedReferences;
    record.rejectedOperations = parsedV2.rejected;
    record.rawOperationCount = parsedV2.rawOperationCount;
    record.candidates = operationsToScorable(parsedV2.operations);
    record.rejected = parsedV2.rejected.map(item => ({ reason: item.reason }));
    record.coverage = protocolInput.built.coverage;
  } else if (options.parse === 'v2') {
    const strict = parseExtractionOutputStrict(call.raw, built.messages);
    record.candidates = strict.candidates;
    record.rejected = strict.rejected.map(item => ({ reason: item.reason }));
    record.truncated = strict.truncated;
    record.droppedItems = strict.droppedItems;
  } else {
    const parsed = parseOpenItemExtractionOutput(call.raw, built.messages);
    record.candidates = parsed.candidates;
    record.rejected = parsed.rejected.map(item => ({ reason: item.reason }));
  }

  // 存储投影：用仓库现有引擎 + 内存仓储（预置已有事项）
  const engine = new MemoryEventEngine();
  const items = new FakeRepo();
  (engine as any).itemModel = items;
  (engine as any).groupModel = new FakeRepo();
  (engine as any).messageModel = new FakeRepo();
  const existing = seeded.get(fragment.fragmentId) || [];
  if (protocolInput && record.operations) {
    const seededForV2 = existing.map(item => ({
      id: item.itemId,
      kind: item.kind,
      subjectRef: item.subject,
      summary: item.summary,
      state: item.state,
      sourceMessageIds: item.evidenceIds,
    }));
    const projected = projectOperationsV2(record.operations, seededForV2);
    record.actionOutcomes = projected.outcomes;
    record.written = {
      created: projected.outcomes.filter(
        item => item.action === 'create' && item.applied
      ).length,
      updated: projected.outcomes.filter(
        item => item.action === 'update' && item.applied
      ).length,
      skipped: projected.outcomes.filter(item => !item.applied).length,
    };
    record.storageItems = projected.items.map(item => ({
      id: String(item.id),
      topicKey: item.kind === 'calendar' ? '纪念日' : item.kind,
      subjectRef: item.subjectRef || null,
      summary: item.summary,
      state: item.state,
      evidenceCount: (item.sourceMessageIds || []).length,
      stateHistoryLength: (item.stateHistory || []).length,
    }));
    record.status = 'ok';
    return record;
  }
  const seededIds: Record<string, string> = {};
  for (const item of existing) {
    const itemHex = createHash('md5')
      .update(`${fragment.fragmentId}:${item.itemId}`)
      .digest('hex')
      .slice(0, 24);
    seededIds[item.itemId] = itemHex;
    await items.save({
      id: new MongoObjectId(itemHex),
      engine: 'event_v1',
      userId: new MongoObjectId(fragment.userId),
      conversationId: new MongoObjectId('6aa000000000000000000010'),
      agentId: new MongoObjectId('6aa000000000000000000011'),
      topicKey: item.topicKey,
      ...(item.subject && item.subject !== '未知'
        ? { subjectRef: item.subject }
        : {}),
      summary: item.summary,
      state: item.state,
      stateHistory: [
        { state: item.state, changedAt: now, source: 'offline_extraction' },
      ],
      importance: item.kind === 'calendar' ? 1 : 2,
      raisedCount: 0,
      sourceMessageIds: item.evidenceIds
        .filter(id => /^[0-9a-f]{24}$/.test(id))
        .map(id => new MongoObjectId(id)),
      fingerprint: `seed-${fragment.fragmentId}-${item.itemId}`,
      createdAt: now,
      updatedAt: now,
    });
  }
  const byMessage = new Map(
    protocolInput
      ? protocolInput.built.segments.flatMap(segment =>
          segment.messages.map(
            message =>
              [
                message.id,
                {
                  messageId: message.id,
                  content: message.content,
                  occurredAt: message.occurredAt,
                },
              ] as [string, any]
          )
        )
      : built!.messages.map(
          message => [message.messageId, message] as [string, any]
        )
  );
  const parsedCandidates = record.candidates || [];
  const candidatesWithTime = parsedCandidates
    .filter(candidate => byMessage.has(candidate.messageId))
    .map(candidate => ({
      ...candidate,
      occurredAt: new Date(byMessage.get(candidate.messageId)!.occurredAt),
    }));
  const repeat = Math.max(1, fragment.repeat || 1);
  let written = { created: 0, updated: 0, skipped: 0 };
  for (let round = 0; round < repeat; round += 1) {
    const pass = candidatesWithTime.length
      ? await engine.applyExtractedOpenItems({
          userId: fragment.userId,
          conversationId: '6aa000000000000000000010',
          agentId: '6aa000000000000000000011',
          candidates: candidatesWithTime,
          now,
        })
      : { created: 0, updated: 0, skipped: 0 };
    written = {
      created: written.created + pass.created,
      updated: written.updated + pass.updated,
      skipped: written.skipped + pass.skipped,
    };
  }
  record.repeat = repeat;
  record.written = written;
  record.seededIds = seededIds;
  record.storageItems = items.rows.map(row => ({
    id: String(row.id),
    topicKey: row.topicKey,
    subjectRef: row.subjectRef || null,
    summary: row.summary,
    state: row.state,
    evidenceCount: (row.sourceMessageIds || []).length,
    stateHistoryLength: (row.stateHistory || []).length,
  }));
  if (built && built.coverage) record.coverage = built.coverage;
  record.requests = requestInvoker!.forFragment(fragment.fragmentId);
  record.status = 'ok';
  return record;
}

async function scoreOnly() {
  const options = parseArgs(process.argv.slice(3));
  if (!options.out) throw new Error('--out required');
  const outDir = path.resolve(REPO_ROOT, options.out);
  const fragments = loadFragments(options.dataset, options.split);
  const results = fs
    .readFileSync(path.join(outDir, 'records.jsonl'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line));
  const summary = scoreResults(fragments, results, {
    mode: options.mode,
    model: options.model,
    dataset: options.dataset,
    split: options.split,
    tag: options.tag,
    outDir,
  });
  fs.writeFileSync(
    path.join(outDir, 'summary.json'),
    JSON.stringify(summary, null, 2) + '\n'
  );
  fs.writeFileSync(path.join(outDir, 'diff.md'), summary.diffMarkdown);
  process.stdout.write(JSON.stringify(summary.metrics, null, 2) + '\n');
}

function scoreResults(
  fragments: Fragment[],
  results: any[],
  meta: {
    mode: string;
    model: string;
    dataset: string;
    split: string;
    tag: string;
    outDir: string;
  }
) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { scoreRun } = require('./score');
  return scoreRun(fragments, results, meta);
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  const fragments = loadFragments(options.dataset, options.split)
    .filter(
      fragment =>
        !options.only.length || options.only.includes(fragment.fragmentId)
    )
    .slice(0, options.limit > 0 ? options.limit : undefined);
  const outDir = options.out
    ? path.resolve(REPO_ROOT, options.out)
    : path.join(EVIDENCE_ROOT, 'runs', `adhoc-${Date.now()}`);
  fs.mkdirSync(outDir, { recursive: true });
  const { createModelInvoker, createFakeClient } = await import(
    './request-boundary'
  );
  if (!options.fakeModel) {
    const target = resolveModel(options.model);
    if (!target.apiKey) throw new Error(`missing api key for ${options.model}`);
    cachedClient = {
      target,
      client: new OpenAI({ apiKey: target.apiKey, baseURL: target.baseURL }),
    };
  }
  let sourceCommit: string | null = null;
  try {
    sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: REPO_ROOT,
    })
      .toString()
      .trim();
  } catch {
    sourceCommit = null;
  }
  requestInvoker = createModelInvoker({
    sourceCommit,
    client: options.fakeModel
      ? createFakeClient({ failAtStep: options.failStep })
      : (cachedClient!
          .client as unknown as import('./request-boundary').ChatClient),
  });
  const seeded = new Map<string, ExistingItem[]>();
  for (const fragment of fragments)
    seeded.set(fragment.fragmentId, fragment.existingItems || []);
  let reuseRaw: Map<string, string> | undefined;
  if (options.reuseRaw) {
    const sourceDir = path.resolve(REPO_ROOT, options.reuseRaw);
    const rawPath = path.join(sourceDir, 'raw.jsonl');
    if (!fs.existsSync(rawPath))
      throw new Error(`reuse-raw: missing ${rawPath}`);
    reuseRaw = new Map<string, string>();
    for (const line of fs.readFileSync(rawPath, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      const row = JSON.parse(line);
      reuseRaw.set(row.fragmentId, row.raw || '');
    }
  }

  const results: any[] = [];
  const queue = fragments.slice();
  const workers = Array.from(
    { length: Math.max(1, options.concurrency) },
    async () => {
      while (queue.length) {
        const fragment = queue.shift();
        if (!fragment) break;
        const record = await runOne(fragment, options, seeded, reuseRaw);
        // 所有 return 分支（含 v2/narrow/concrete/two-step 的提前返回与失败）都要带上留档
        record.requests = requestInvoker!.forFragment(fragment.fragmentId);
        results.push(record);
        process.stderr.write(
          `[${results.length}/${fragments.length}] ${fragment.fragmentId} ${record.status} ` +
            `cand=${(record.candidates || []).length} rej=${
              (record.rejected || []).length
            }\n`
        );
      }
    }
  );
  await Promise.all(workers);

  const summary = scoreResults(fragments, results, {
    mode: options.mode,
    model: options.model,
    dataset: options.dataset,
    split: options.split,
    tag: options.tag,
    outDir,
  });

  fs.writeFileSync(
    path.join(outDir, 'records.jsonl'),
    results.map(record => JSON.stringify(record)).join('\n') + '\n'
  );
  // 精确输入与模型原始输出（含原话，落在 .gitignore 覆盖的文件里，不进仓库）
  // 权威请求留档：直接来自调用点抓取的 requestLog（不再用 buildV1Input 重建）
  const requestLines: string[] = [];
  const inputLines: string[] = [];
  const rawLines: string[] = [];
  const parsedLines: string[] = [];
  for (const record of results) {
    for (const request of record.requests || []) {
      requestLines.push(JSON.stringify(request));
    }
    const lastRequest = (record.requests || [])[0] || null;
    inputLines.push(
      JSON.stringify({
        fragmentId: record.fragmentId,
        source:
          lastRequest && lastRequest.status !== 'not_sent'
            ? 'captured_at_call'
            : 'not_sent',
        ...(lastRequest
          ? {
              status: lastRequest.status,
              mode: lastRequest.mode,
              protocol: lastRequest.protocol,
              model: lastRequest.model,
              resolvedModel: lastRequest.resolvedModel,
              requestHash: lastRequest.requestHash,
              promptSource: lastRequest.promptSource,
              system: lastRequest.system,
              user: lastRequest.user,
              messageIds: lastRequest.messageIds,
            }
          : {}),
      })
    );
    rawLines.push(
      JSON.stringify({
        fragmentId: record.fragmentId,
        raw: record.rawText || '',
      })
    );
    parsedLines.push(
      JSON.stringify({
        fragmentId: record.fragmentId,
        candidates: record.candidates || [],
        rejected: record.rejected || [],
        storageItems: record.storageItems || [],
      })
    );
  }
  fs.writeFileSync(
    path.join(outDir, 'requests.jsonl'),
    requestLines.join('\n') + (requestLines.length ? '\n' : '')
  );
  // inputs.jsonl 是 requests.jsonl 的兼容投影（source 标明是调用点抓取还是未发送）
  fs.writeFileSync(
    path.join(outDir, 'inputs.jsonl'),
    inputLines.join('\n') + '\n'
  );
  fs.writeFileSync(
    path.join(outDir, 'parsed.jsonl'),
    parsedLines.join('\n') + '\n'
  );
  fs.writeFileSync(
    path.join(outDir, 'summary.json'),
    JSON.stringify(summary, null, 2) + '\n'
  );
  fs.writeFileSync(path.join(outDir, 'diff.md'), summary.diffMarkdown);
  process.stdout.write(JSON.stringify(summary.metrics, null, 2) + '\n');
  process.stdout.write(`artifacts: ${outDir}\n`);
}

const command = process.argv[2];
(command === 'score' ? scoreOnly() : run()).catch(error => {
  console.error('HARNESS_FAILED', error);
  process.exit(1);
});
