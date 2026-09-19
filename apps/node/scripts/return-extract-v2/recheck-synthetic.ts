/**
 * N00：对"合成集动作 8/8"做语义 + 最终状态的重审（不调用模型，复用已保存的 raw 记录）。
 * 与旧口径的差别：不只看"证据 ID 命中"，而是把模型输出真正走一遍生命周期，检查
 *   ① 必收事件有没有对应操作；② 需要动作的事件最终状态对不对；③ 禁收证据有没有被记；
 *   ④ meaningful_update 有没有被当成待办。
 * 用法：npx ts-node --transpile-only -P scripts/return-extract-v2/tsconfig.json \
 *        scripts/return-extract-v2/recheck-synthetic.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import { parseExtractionOutputV2 } from '../../src/service/memory/return-extract-v2/validate-v2';
import {
  applyOperations,
  ItemView,
} from '../../src/service/memory/return-extract-v2/lifecycle';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const EVIDENCE = path.join(REPO_ROOT, '.task-evidence/return-extraction-v2');
const RUN = path.join(EVIDENCE, 'runs/R02-v2-scenarios');
const FIXTURE = path.join(EVIDENCE, 'fixtures/scenarios-E01-E24.json');

async function main() {
  const fixture = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  const records: any[] = fs
    .readFileSync(path.join(RUN, 'records.jsonl'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line));
  const raws: Record<string, string> = {};
  for (const line of fs
    .readFileSync(path.join(RUN, 'raw.jsonl'), 'utf8')
    .split('\n')) {
    if (!line.trim()) continue;
    const row = JSON.parse(line);
    raws[row.fragmentId] = row.raw || '';
  }

  const results: any[] = [];
  for (const scenario of fixture.scenarios) {
    const record = records.find(
      item => item.fragmentId === scenario.scenarioId
    );
    if (!record) continue;
    const messages = scenario.messages.map((message: any) => ({
      messageId: message.id,
      content: message.content,
      role: message.role,
    }));
    const seeded: ItemView[] = (scenario.existingItems || []).map(
      (item: any) => ({
        itemId: item.itemId,
        kind: item.kind,
        state: item.state as ItemView['state'],
        description: item.summary,
        subjectLabel: item.subject,
        evidenceIds: item.evidenceIds,
        stateHistory: [],
      })
    );
    const parsed = parseExtractionOutputV2(
      raws[scenario.scenarioId] || '',
      messages,
      seeded.map(item => item.itemId)
    );
    const messageTimes: Record<string, string> = {};
    scenario.messages.forEach(
      (message: any) => (messageTimes[message.id] = message.at)
    );
    const messageSeq: Record<string, number> = {};
    scenario.messages.forEach(
      (message: any, index: number) => (messageSeq[message.id] = index + 1)
    );
    const { items, outcomes } = applyOperations(parsed.operations, seeded, {
      messageTimes,
      messageSeq,
    });

    const expected = scenario.expected || {};
    const problems: string[] = [];
    let mandatoryHit = 0;
    for (const event of expected.mandatory || []) {
      const evidenceIds: string[] = event.evidenceIds || [];
      const wantCalendar = event.kind === 'calendar';
      const operation = parsed.operations.find(
        op =>
          op.evidence.some(item => evidenceIds.includes(item.messageId)) &&
          (op.kind === 'calendar') === wantCalendar
      );
      if (!operation) {
        problems.push(
          `必收事件没有对应操作：${String(event.description).slice(0, 24)}`
        );
        continue;
      }
      mandatoryHit += 1;
      if (event.action) {
        const target = items.find(item => item.itemId === event.targetItemId);
        const expectedState =
          event.action === 'resolve' || event.action === 'resolve_or_update'
            ? ['resolved', 'awaiting_result']
            : event.action === 'cancel'
            ? ['cancelled']
            : event.action === 'dismiss'
            ? ['dismissed']
            : ['awaiting_result'];
        if (!target || !expectedState.includes(target.state)) {
          problems.push(
            `动作后状态不对：${event.action} → 实际 ${
              target ? target.state : '找不到对象'
            }`
          );
        }
      }
    }
    for (const event of expected.forbidden || []) {
      const evidenceIds = event.evidenceIds || [];
      if (!evidenceIds.length) continue;
      const hit = parsed.operations.some(op =>
        op.evidence.some(item => evidenceIds.includes(item.messageId))
      );
      if (hit)
        problems.push(
          `禁收证据被记：${String(event.description).slice(0, 24)}`
        );
    }
    for (const item of items) {
      if (
        item.kind === 'meaningful_update' &&
        item.state === 'awaiting_result'
      ) {
        problems.push('meaningful_update 被当成待办');
      }
    }
    results.push({
      scenarioId: scenario.scenarioId,
      operations: parsed.operations.length,
      outcomes: outcomes.length,
      mandatory: (expected.mandatory || []).length,
      mandatoryHit,
      problems,
      passed: problems.length === 0,
    });
  }

  const failed = results.filter(row => !row.passed);
  const summary = {
    scenarios: results.length,
    passed: results.length - failed.length,
    mandatoryTotal: results.reduce((sum, row) => sum + row.mandatory, 0),
    mandatoryHit: results.reduce((sum, row) => sum + row.mandatoryHit, 0),
    failedScenarios: failed.map(row => ({
      scenarioId: row.scenarioId,
      problems: row.problems,
    })),
  };
  fs.mkdirSync(path.join(EVIDENCE, 'review-N00'), { recursive: true });
  fs.writeFileSync(
    path.join(EVIDENCE, 'review-N00/recheck-synthetic.json'),
    JSON.stringify({ summary, results }, null, 2) + '\n'
  );
  console.log(JSON.stringify(summary, null, 2));
}

main().catch(error => {
  console.error('RECHECK_FAILED', error);
  process.exit(1);
});
