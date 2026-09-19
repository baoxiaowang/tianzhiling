/**
 * 对"留档改造之前"的历史 run 做**确定性重建**请求，并明确标注来源。
 * 只做本地重建，不调用模型：同一片段 + 同一输入模式 + 同一提示词 ⇒ 文本可复现。
 * 用法：npx ts-node --transpile-only -P scripts/return-extract-v2/tsconfig.json \
 *        scripts/return-extract-v2/reconstruct-requests.ts <runDir> <protocol> <fragmentIds|file>
 */
import * as fs from 'fs';
import * as path from 'path';
import { buildExtractorInputV2 } from '../../src/service/memory/return-extract-v2/input';
import {
  buildNarrowPrompt,
  NARROW_SYSTEM_PROMPT,
} from '../../src/service/memory/return-extract-v2/prompt-narrow';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const EVIDENCE = path.join(REPO_ROOT, '.task-evidence/return-extraction-v2');

function main() {
  const [runRel, protocol, idsArg] = process.argv.slice(2);
  const runDir = path.resolve(REPO_ROOT, runRel);
  const ids = fs
    .readFileSync(path.resolve(REPO_ROOT, idsArg), 'utf8')
    .split(/[\n,]/)
    .map(value => value.trim())
    .filter(Boolean);
  const fragments: Record<string, any> = {};
  for (const line of fs
    .readFileSync(path.join(EVIDENCE, 'private/fragments.jsonl'), 'utf8')
    .split('\n')) {
    if (!line.trim()) continue;
    const row = JSON.parse(line);
    fragments[row.fragmentId] = row;
  }
  const lines: string[] = [];
  for (const fragmentId of ids) {
    const fragment = fragments[fragmentId];
    if (!fragment) continue;
    const now = new Date(fragment.now);
    const rows = fragment.messages.map((message: any) => ({
      id: message.id,
      role: message.role === 'assistant' ? 'assistant' : 'user',
      occurredAt: new Date(message.at).toISOString(),
      content: message.content,
      sourceType: 'text' as const,
    }));
    const built = buildExtractorInputV2(rows, { now });
    const user =
      protocol === 'narrow'
        ? buildNarrowPrompt(built, [])
        : JSON.stringify(built);
    const system = protocol === 'narrow' ? NARROW_SYSTEM_PROMPT : '';
    lines.push(
      JSON.stringify({
        fragmentId,
        source: 'reconstructed_deterministic',
        note: '本 run 早于请求留档改造；此处用同一片段/同一输入模式/同一提示词确定性重建，非调用点抓取',
        mode: path.basename(runDir),
        protocol,
        inputMode: 'v2',
        step: 0,
        system,
        user,
        messageIds: built.segments.flatMap(segment =>
          segment.messages.map(message => message.id)
        ),
        chars: user.length,
      })
    );
  }
  fs.writeFileSync(
    path.join(runDir, 'requests-reconstructed.jsonl'),
    lines.join('\n') + '\n'
  );
  fs.writeFileSync(
    path.join(runDir, 'PROVENANCE.json'),
    JSON.stringify(
      {
        requests: 'reconstructed_deterministic',
        capturedAtCall: false,
        note: 'inputs.jsonl 是旧版用 v1 构造器重建的，对 v2/narrow 模式不作为"真正发送的请求"；以 requests-reconstructed.jsonl 为参考',
      },
      null,
      2
    ) + '\n'
  );
  console.log('reconstructed', lines.length, 'requests ->', runDir);
}

main();
