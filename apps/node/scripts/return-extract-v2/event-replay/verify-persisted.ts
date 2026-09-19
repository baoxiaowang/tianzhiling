/**
 * P02 真实试跑：对已落盘的检查点记录做结构验证（不发送任何请求）。
 *
 * 用途：real 模式只保存真实结果与结构检查；本脚本读取
 * <out>/private/checkpoints.jsonl，检查程序行为（证据可见、快照延续、无未来输入、
 * 无参考答案、失败点 after 不变、脱敏），并输出观察到的每点操作/拒绝/状态。
 * 它不评判模型该输出什么。
 */
import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { redactSecrets } from '../request-boundary';
import { REPLAY_SCHEMA } from './protocol';

const REPO_ROOT = path.resolve(__dirname, '../../../../..');
const DEFAULT_OUT = path.join(
  REPO_ROOT,
  '.task-evidence/return-extraction-v2/pilot/p02-real-trial'
);

function readJsonl(file: string): any[] {
  return fs
    .readFileSync(file, 'utf-8')
    .split('\n')
    .filter(line => line.trim())
    .map(line => JSON.parse(line));
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function main() {
  const args = process.argv.slice(2);
  const value = (flag: string, fallback: string) => {
    const index = args.indexOf(flag);
    return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
  };
  const out = value('--out', DEFAULT_OUT);
  const checkpointFile = path.join(out, 'private/checkpoints.jsonl');
  const records = readJsonl(checkpointFile);

  const findings: Array<{ check: string; ok: boolean; detail: string }> = [];
  const check = (name: string, ok: boolean, detail = '') =>
    findings.push({ check: name, ok: Boolean(ok), detail });

  const byTrajectory = new Map<string, any[]>();
  for (const record of records) {
    if (!byTrajectory.has(record.trajectoryId)) byTrajectory.set(record.trajectoryId, []);
    byTrajectory.get(record.trajectoryId)!.push(record);
  }
  for (const list of byTrajectory.values()) list.sort((a, b) => a.ordinal - b.ordinal);

  // 1. before == 上一检查点 after
  {
    let ok = true;
    const details: string[] = [];
    for (const [tid, list] of byTrajectory) {
      for (let i = 1; i < list.length; i += 1) {
        if (!deepEqual(list[i].before, list[i - 1].after)) {
          ok = false;
          details.push(`${tid}#${list[i].ordinal}`);
        }
      }
    }
    check('before_equals_previous_after', ok, details.join(',') || '快照延续一致');
  }

  // 2. 无未来消息
  {
    let ok = true;
    const details: string[] = [];
    for (const record of records) {
      const payload = JSON.parse(record.request.user);
      const listed = [
        ...(payload.visibleMessages || []),
        ...(payload.newMessages || []),
        ...(payload.contextBeforeCheckpoint || []),
      ];
      if (listed.some((message: any) => message.index > record.cutoffIndex)) {
        ok = false;
        details.push(record.checkpointId);
      }
    }
    check('no_future_input', ok, details.join(',') || `${records.length} 点均无未来消息`);
  }

  // 3. 证据可见（操作与事件证据都在该点可见集合内）
  {
    let ok = true;
    const details: string[] = [];
    for (const record of records) {
      const payload = JSON.parse(record.request.user);
      const listed = [
        ...(payload.visibleMessages || []),
        ...(payload.newMessages || []),
        ...(payload.contextBeforeCheckpoint || []),
      ];
      const visible = new Set(listed.map((message: any) => message.messageId));
      for (const operation of record.parsed.operations || []) {
        for (const evidence of operation.evidence || []) {
          if (!visible.has(evidence.messageId)) {
            ok = false;
            details.push(`${record.checkpointId}:${evidence.messageId}`);
          }
        }
      }
      for (const event of record.after.events || []) {
        for (const id of event.evidenceIds) {
          if (!visible.has(id)) {
            ok = false;
            details.push(`${record.checkpointId}:${id}`);
          }
        }
      }
    }
    check('evidence_within_visible_range', ok, details.slice(0, 5).join(',') || '全部证据可见');
  }

  // 4. 冷启动快照为空；请求不含参考 eventId
  {
    const referenceFile = path.join(
      REPO_ROOT,
      '.task-evidence/return-extraction-v2/pilot/private/reference-draft-v2.jsonl'
    );
    const referenceIds = readJsonl(referenceFile).flatMap(row =>
      [...(row.before || []), ...(row.after || [])].map((event: any) => event.eventId)
    );
    let ok = true;
    const details: string[] = [];
    for (const record of records) {
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
      if (referenceIds.some(id => record.request.user.includes(id))) {
        ok = false;
        details.push(`${record.checkpointId}:reference_eventId`);
      }
    }
    check('input_has_no_reference_answer', ok, details.join(',') || '冷启动为空且无参考 eventId');
  }

  // 5. 记录完整性与失败点处理
  {
    let ok = true;
    const details: string[] = [];
    for (const record of records) {
      if (!record.before || !record.after || !record.requestStatus) {
        ok = false;
        details.push(`${record.checkpointId}:missing_fields`);
      }
      if (record.requestStatus === 'failed' && !deepEqual(record.before, record.after)) {
        ok = false;
        details.push(`${record.checkpointId}:failed_after_changed`);
      }
      if (record.requestStatus === 'succeeded' && record.finishReason === null) {
        ok = false;
        details.push(`${record.checkpointId}:missing_finishReason`);
      }
    }
    check('record_integrity', ok, details.join(',') || '每点字段齐全；失败点 after 不变');
  }

  // 6. 脱敏反例（本地，不涉网络）
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

  // 观察项（不作通过/失败判断）：每点的操作、拒绝、事件与限制数量。
  const observations = [...byTrajectory.entries()].map(([trajectoryId, list]) => ({
    trajectoryId,
    anonymousUser: list[0]?.anonymousUser,
    checkpoints: list.map(record => ({
      checkpointId: record.checkpointId,
      ordinal: record.ordinal,
      requestStatus: record.requestStatus,
      finishReason: record.finishReason,
      truncated: record.truncated,
      operationCount: (record.parsed.operations || []).length,
      unresolvedCount: (record.parsed.unresolved || []).length,
      rejected: (record.parsed.rejected || []).map((item: any) => item.reason),
      outcomes: (record.outcomes || []).map((item: any) => ({
        opId: item.opId,
        action: item.action,
        applied: item.applied,
        reason: item.reason || null,
      })),
      eventsAfter: (record.after.events || []).map((event: any) => ({
        eventId: event.eventId,
        kind: event.kind,
        subject: event.subject,
        status: event.status,
        effectiveProactiveAllowed: event.effectiveProactiveAllowed,
        restrictionRefs: event.restrictionRefs,
      })),
      restrictionsAfter: (record.after.restrictions || []).map((item: any) => ({
        restrictionId: item.restrictionId,
        scope: item.scope,
        active: item.active,
      })),
      unresolvedAfter: record.after.unresolved || [],
    })),
  }));

  const result = {
    note: '真实试跑的结构验证：只检查程序行为，不评判模型语义；不发送任何请求',
    checkpointCount: records.length,
    allPassed: findings.every(item => item.ok),
    checks: findings,
    observations,
    checkpointFileSha256: sha256(fs.readFileSync(checkpointFile, 'utf-8')),
    schemaVersion: REPLAY_SCHEMA,
  };
  fs.writeFileSync(
    path.join(out, 'structural-verification.json'),
    JSON.stringify(result, null, 1) + '\n'
  );
  for (const item of findings) {
    console.log(`${item.ok ? 'PASS' : 'FAIL'} ${item.check} - ${item.detail}`);
  }
  console.log(result.allPassed ? 'ALL PASSED' : 'SOME FAILED');
}

main();
