/**
 * N02：真实原话顺序切分下的"更新能力"实验（不依赖生产 item 快照）。
 * A 模式：T1 的 existingItems 由**参考标注**在 T0 截止点重建（测更新能力本身）。
 * B 模式：先只跑 T0（上一段会话），用抽取器自己的 T0 输出当 T1 的 existingItems（测端到端误差传播）。
 * 硬约束：T1 的输入不得包含 T2（本实验里 T2 就是"当前会话里在 T1 之后的消息"，用输入上界裁掉）。
 * 用法：npx ts-node --transpile-only -P scripts/return-extract-v2/tsconfig.json \
 *        scripts/return-extract-v2/n02-update-experiment.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import OpenAI from 'openai';
import { buildExtractorInputV2 } from '../../src/service/memory/return-extract-v2/input';
import {
  buildV2Prompt,
  RETURN_EXTRACT_SYSTEM_PROMPT,
} from '../../src/service/memory/return-extract-v2/prompt';
import { parseExtractionOutputV2 } from '../../src/service/memory/return-extract-v2/validate-v2';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const EVIDENCE = path.join(REPO_ROOT, '.task-evidence/return-extraction-v2');
const OUT_DIR = path.join(EVIDENCE, 'review-N00/runs/N02-update');
const SOURCE_GAP_HOURS = 6;

function loadEnv(): Record<string, string> {
  const map: Record<string, string> = {};
  for (const line of fs
    .readFileSync(path.join(REPO_ROOT, '.env'), 'utf8')
    .split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const index = trimmed.indexOf('=');
    map[trimmed.slice(0, index).trim()] = trimmed.slice(index + 1).trim();
  }
  return map;
}
const ENV = loadEnv();

async function callModel(
  systemPrompt: string,
  userPrompt: string
): Promise<string> {
  const client = new OpenAI({
    apiKey: process.env.NODE_EMBEDDING_API_KEY || ENV.NODE_EMBEDDING_API_KEY,
    baseURL: process.env.NODE_EMBEDDING_BASE_URL || ENV.NODE_EMBEDDING_BASE_URL,
  });
  const completion = await client.chat.completions.create({
    model: ENV.NODE_MEMORY_OPEN_ITEM_MODEL || 'qwen-plus',
    temperature: 0,
    top_p: 0.1,
    max_tokens: 4000,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  });
  return completion.choices?.[0]?.message?.content || '';
}

function main() {
  const config = JSON.parse(
    fs.readFileSync(
      path.join(EVIDENCE, 'review-N00/private/n02-trajectories.json'),
      'utf8'
    )
  );
  void config;
}

/** 按用户消息 6 小时间隔切段（与 input.ts 一致）。 */
function splitSessions(messages: any[]) {
  const sessions: any[][] = [];
  let current: any[] = [];
  let lastUserAt: number | undefined;
  for (const message of messages) {
    if (message.role === 'user' || !message.role) {
      const at = new Date(message.at).getTime();
      if (
        lastUserAt !== undefined &&
        (at - lastUserAt) / 3600000 >= SOURCE_GAP_HOURS
      ) {
        sessions.push(current);
        current = [];
      }
      lastUserAt = at;
    }
    current.push(message);
  }
  if (current.length) sessions.push(current);
  return sessions;
}

async function run() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const fragments: Record<string, any> = {};
  for (const line of fs
    .readFileSync(path.join(EVIDENCE, 'private/fragments.jsonl'), 'utf8')
    .split('\n')) {
    if (!line.trim()) continue;
    const row = JSON.parse(line);
    fragments[row.fragmentId] = row;
  }
  const labels: Record<string, any> = {};
  for (const file of fs.readdirSync(path.join(EVIDENCE, 'private/labels'))) {
    if (!file.startsWith('labels-') || !file.endsWith('.jsonl')) continue;
    for (const line of fs
      .readFileSync(path.join(EVIDENCE, 'private/labels', file), 'utf8')
      .split('\n')) {
      if (!line.trim()) continue;
      const row = JSON.parse(line);
      labels[row.fragmentId] = row;
    }
  }
  const trajectoryIds: string[] = JSON.parse(
    fs.readFileSync(
      path.join(EVIDENCE, 'review-N00/private/n02-trajectories.json'),
      'utf8'
    )
  ).trajectoryIds;
  const results: any[] = [];
  for (const fragmentId of trajectoryIds) {
    const fragment = fragments[fragmentId];
    const label = labels[fragmentId];
    if (!fragment || !label) continue;
    const sessions = splitSessions(fragment.messages);
    if (sessions.length < 2) continue;
    const previous = sessions[sessions.length - 2];
    const current = sessions[sessions.length - 1];
    const currentStartId = current.find(
      message => (message.role || 'user') === 'user'
    )?.id;
    const rows = fragment.messages.map((message: any) => ({
      id: message.id,
      role: (message.role === 'assistant' ? 'assistant' : 'user') as
        | 'user'
        | 'assistant',
      occurredAt: new Date(message.at).toISOString(),
      content: message.content,
      sourceType: 'text' as const,
    }));
    const previousIds = new Set(previous.map(message => message.id));
    const referenceExisting = (label.mandatory || [])
      .filter((item: any) =>
        (item.evidence || []).every((e: any) => previousIds.has(e.messageId))
      )
      .map((item: any, index: number) => ({
        itemId: `ref-${index}`,
        kind: item.kind,
        subject: (item.subject || {}).label || '未知',
        description: item.description,
        state: 'awaiting_result',
      }));
    const messageTimes: Record<string, string> = {};
    rows.forEach(row => (messageTimes[row.id] = row.occurredAt));
    const buildInput = (upperBoundId: string) =>
      buildExtractorInputV2(rows, {
        now: new Date(messageTimes[upperBoundId] || new Date().toISOString()),
        inputUpperBound: messageTimes[upperBoundId],
        currentSessionStartId: upperBoundId,
      });

    // ---- A 模式：参考重建 T0 状态 → T1 更新
    const inputA = buildInput(currentStartId);
    const promptA = buildV2Prompt(inputA, referenceExisting);
    const rawA = await callModel(RETURN_EXTRACT_SYSTEM_PROMPT, promptA);
    const parsedA = parseExtractionOutputV2(
      rawA,
      inputA.segments.flatMap(segment =>
        segment.messages.map(message => ({
          messageId: message.id,
          content: message.content,
          role: message.role,
        }))
      ),
      referenceExisting.map(item => item.itemId)
    );

    // ---- B 模式：先只跑 T0，用抽取器自己的输出当 T1 的 existingItems
    const t0Start = previous.find(
      message => (message.role || 'user') === 'user'
    )?.id;
    const inputT0 = buildInput(t0Start);
    const rawT0 = await callModel(
      RETURN_EXTRACT_SYSTEM_PROMPT,
      buildV2Prompt(inputT0, [])
    );
    const parsedT0 = parseExtractionOutputV2(
      rawT0,
      inputT0.segments.flatMap(segment =>
        segment.messages.map(message => ({
          messageId: message.id,
          content: message.content,
          role: message.role,
        }))
      ),
      []
    );
    const selfExisting = parsedT0.operations
      .filter(operation => operation.action === 'create')
      .map((operation, index) => ({
        itemId: `self-${index}`,
        kind: operation.kind,
        subject: operation.subject.sourceLabel || '未知',
        description: operation.description,
        state: 'awaiting_result',
      }));
    const promptB = buildV2Prompt(inputA, selfExisting);
    const rawB = await callModel(RETURN_EXTRACT_SYSTEM_PROMPT, promptB);
    const parsedB = parseExtractionOutputV2(
      rawB,
      inputA.segments.flatMap(segment =>
        segment.messages.map(message => ({
          messageId: message.id,
          content: message.content,
          role: message.role,
        }))
      ),
      selfExisting.map(item => item.itemId)
    );

    results.push({
      fragmentId,
      previousSessionIds: [...previousIds],
      currentSessionIds: current.map(message => message.id),
      referenceExisting,
      selfExisting,
      modeA: {
        operations: parsedA.operations,
        rejected: parsedA.rejected.map(item => item.reason),
      },
      modeB: {
        t0Operations: parsedT0.operations,
        t1Operations: parsedB.operations,
        rejected: parsedB.rejected.map(item => item.reason),
      },
    });
    process.stderr.write(
      `[N02] ${fragmentId} A=${parsedA.operations.length} B(t0=${parsedT0.operations.length},t1=${parsedB.operations.length})\n`
    );
  }
  fs.writeFileSync(
    path.join(OUT_DIR, 'experiment.json'),
    JSON.stringify(results, null, 2) + '\n'
  );
  fs.writeFileSync(
    path.join(OUT_DIR, 'experiment-summary.json'),
    JSON.stringify(
      {
        trajectories: results.length,
        modeAOperations: results.reduce(
          (sum, row) => sum + row.modeA.operations.length,
          0
        ),
        modeAUpdateLike: results.reduce(
          (sum, row) =>
            sum +
            row.modeA.operations.filter((op: any) => op.action !== 'create')
              .length,
          0
        ),
        modeBT1Operations: results.reduce(
          (sum, row) => sum + row.modeB.t1Operations.length,
          0
        ),
        modeBT1UpdateLike: results.reduce(
          (sum, row) =>
            sum +
            row.modeB.t1Operations.filter((op: any) => op.action !== 'create')
              .length,
          0
        ),
      },
      null,
      2
    ) + '\n'
  );
  console.log('done', results.length);
}

void main;
run().catch(error => {
  console.error('N02_FAILED', error);
  process.exit(1);
});
