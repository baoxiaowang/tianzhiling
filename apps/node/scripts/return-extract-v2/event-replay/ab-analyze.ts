/**
 * P02 A/B 对照：对已落盘输出做程序侧解析（不发送任何请求）。
 * - A：用 event_replay_v1 校验器解析，区分"格式/字段被拒"与"语义归属错误"。
 * - B：自由文本，只统计长度与是否为空。
 */
import * as fs from 'fs';
import * as path from 'path';
import { parseReplayOutput, type VisibleMessage } from './protocol';

const REPO_ROOT = path.resolve(__dirname, '../../../../..');
const FIRST_RUN = path.join(
  REPO_ROOT,
  '.task-evidence/return-extraction-v2/pilot/p02-real-trial'
);
const AB_DIR = path.join(
  REPO_ROOT,
  '.task-evidence/return-extraction-v2/pilot/p02-ab-contrast'
);

function readJsonl(file: string): any[] {
  return fs
    .readFileSync(file, 'utf-8')
    .split('\n')
    .filter(line => line.trim())
    .map(line => JSON.parse(line));
}

function visibleOf(record: any): VisibleMessage[] {
  const payload = JSON.parse(record.request.user);
  const rows = [
    ...(payload.visibleMessages || []),
    ...(payload.newMessages || []),
    ...(payload.contextBeforeCheckpoint || []),
  ];
  const byId = new Map<string, VisibleMessage>();
  for (const row of rows) {
    byId.set(row.messageId, {
      messageId: row.messageId,
      role: row.role,
      content: row.content,
      at: row.at,
      index: row.index,
    });
  }
  return [...byId.values()];
}

function main() {
  const records = readJsonl(path.join(FIRST_RUN, 'private/checkpoints.jsonl'));
  const raws = readJsonl(path.join(AB_DIR, 'private/ab-raw.jsonl'));
  const out: any[] = [];
  for (const row of raws) {
    const record = records.find(item => item.checkpointId === row.checkpointId);
    const visible = visibleOf(record);
    if (row.arm === 'A') {
      const parsed = parseReplayOutput(
        row.raw || '',
        visible,
        record.before.events.map((event: any) => event.eventId),
        record.before.restrictions.map((item: any) => item.restrictionId)
      );
      out.push({
        checkpointId: row.checkpointId,
        arm: 'A',
        requestHash: row.requestHash,
        usage: row.usage,
        finishReason: row.finishReason,
        truncated: row.truncated,
        programRejected: parsed.rejected.map(item => item.reason),
        operationCount: parsed.operations.length,
        operations: parsed.operations.map(operation => ({
          opId: operation.opId,
          action: operation.action,
          target: operation.eventId,
          kind: operation.kind,
          state: operation.state,
          proactiveAllowed: operation.proactiveAllowed,
          initialStatus: operation.initialStatus,
          inheritsRestriction: operation.inheritsRestriction,
          restrictionScope: operation.restrictionScope,
          evidence: operation.evidence.map(item => item.messageId),
        })),
      });
    } else {
      out.push({
        checkpointId: row.checkpointId,
        arm: 'B',
        requestHash: row.requestHash,
        usage: row.usage,
        finishReason: row.finishReason,
        truncated: row.truncated,
        rawChars: (row.raw || '').length,
        empty: !(row.raw || '').trim(),
      });
    }
  }
  fs.writeFileSync(
    path.join(AB_DIR, 'ab-analysis.json'),
    JSON.stringify(
      {
        note: '程序侧解析（无模型调用）：A 看是否被校验拒绝，B 只看是否为空；语义判断见 ab-comparison.md',
        items: out,
      },
      null,
      1
    ) + '\n'
  );
  for (const item of out) {
    if (item.arm === 'A') {
      console.log(
        `${item.checkpointId} A ops=${item.operationCount} rejected=${item.programRejected.join(',') || 'none'}`
      );
    } else {
      console.log(`${item.checkpointId} B chars=${item.rawChars} empty=${item.empty}`);
    }
  }
}

main();
