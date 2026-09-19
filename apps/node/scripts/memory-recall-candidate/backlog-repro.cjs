/**
 * 记忆积压：隔离队列复现 + 最小修复验证（本地 Redis，独立前缀，不碰生产）。
 *
 * 复现生产代码里的这条链：
 *   memory-pipeline.processor.ts  processTask: 资源门槛 !allowed 时不领取直接 return
 *   memory-pipeline-task.service.ts enqueueTaskJob: jobId = `memory-<taskId>`，removeOnComplete/Fail = 1000
 *   memory-pipeline-task.service.ts requeueDueTask: 协调任务用同一 jobId 重新入队
 *
 * 验证到最终状态，而不是只看代码：
 *   1) 门槛拒绝 → Bull 任务完成、DB 任务仍 pending；
 *   2) 协调重排同 jobId 被"已保留的完成记录"挡住 → 任务不再执行；
 *   3) 修好后（重排前清掉终态 job 记录）任务能重新执行；
 *   4) 重复协调不会重复执行同一业务任务；
 *   5) 执行失败仍可恢复；
 *   6) 全程不删除任务、不把任务标完成来"清积压"。
 *
 * 用法：node apps/node/scripts/memory-recall-candidate/backlog-repro.cjs
 */
const Redis = require('../../node_modules/ioredis');
const { Queue, Worker } = require('../../node_modules/bullmq');
const fs = require('fs');
const path = require('path');

const PREFIX = `{tzl-diag-${Date.now()}}`;
const QUEUE_NAME = 'memory-pipeline-diag';
const connection = { host: '127.0.0.1', port: 17380 };

const store = new Map(); // taskId -> { status, attemptCount }
const runs = new Map(); // taskId -> 执行次数
const failFirst = new Set();
const holds = new Map(); // taskId -> Promise，用来把 job 卡在 active
let budgetAllows = false;

function task(id) {
  if (!store.has(id)) store.set(id, { status: 'pending', attemptCount: 0 });
  return store.get(id);
}
function bumpRun(id) {
  runs.set(id, (runs.get(id) || 0) + 1);
}

async function enqueue(queue, taskId, priority = 1000) {
  return queue.add(
    'task',
    { taskId },
    {
      jobId: `memory-${taskId}`,
      attempts: 1,
      priority,
      removeOnComplete: 1000,
      removeOnFail: 1000,
    }
  );
}

// 生产当前实现：协调任务直接重排
async function requeueCurrent(queue, taskId) {
  return enqueue(queue, taskId);
}

// 最小修复：重排前，如果同 jobId 已在终态（completed/failed），先移除该终态记录再入队；
// 仍在 waiting/active/delayed 则跳过，避免重复执行。
async function requeueFixed(queue, taskId) {
  const existing = await queue.getJob(`memory-${taskId}`);
  if (existing) {
    const state = await existing.getState();
    if (state === 'completed' || state === 'failed') {
      await existing.remove();
    } else {
      return { skipped: true, state };
    }
  }
  return enqueue(queue, taskId);
}

async function waitFor(fn, timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await fn()) return true;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  return false;
}

async function main() {
  const redis = new Redis({ ...connection, maxRetriesPerRequest: null });
  const queue = new Queue(QUEUE_NAME, { connection, prefix: PREFIX });
  const worker = new Worker(
    QUEUE_NAME,
    async job => {
      const id = job.data.taskId;
      if (holds.has(id)) await holds.get(id);
      // 生产：门槛不允许时，不领取任务直接返回 —— 任务保持 pending、attemptCount 不变。
      if (!budgetAllows) return { skipped: 'budget' };
      const record = task(id);
      record.status = 'processing';
      record.attemptCount += 1;
      if (failFirst.has(id)) {
        record.status = 'pending';
        throw new Error('simulated_execution_failure');
      }
      bumpRun(id);
      record.status = 'completed';
      return { ok: true };
    },
    { connection, prefix: PREFIX, concurrency: 1 }
  );
  await worker.waitUntilReady();

  const assertions = [];
  const assert = (name, ok, detail) => assertions.push({ name, ok: Boolean(ok), detail });

  // ---- 1) 门槛拒绝：Bull 任务完成，DB 任务仍 pending ----
  task('T1');
  budgetAllows = false;
  await enqueueCurrentReconcile(queue, 'T1');
  await waitFor(async () => (await queue.getJob(`memory-T1`)) === undefined); // completed 仍在，getJob 有值
  await waitFor(async () => (await queue.getJobState(`memory-T1`)) === 'completed');
  assert('门槛拒绝后 Bull 任务完成、DB 任务仍 pending', task('T1').status === 'pending' && task('T1').attemptCount === 0, JSON.stringify(task('T1')));

  // ---- 2) 协调重排同 jobId 被完成记录挡住 ----
  const before = await queue.getJobCounts('waiting', 'active', 'completed', 'failed');
  const readd = await requeueCurrent(queue, 'T1');
  const after = await queue.getJobCounts('waiting', 'active', 'completed', 'failed');
  const stillCompleted = await queue.getJobState(`memory-T1`);
  await new Promise(r => setTimeout(r, 500));
  assert(
    '同 jobId 重排被保留的完成记录挡住（未新增可执行 job、任务未再跑）',
    readd.id === 'memory-T1' &&
      stillCompleted === 'completed' &&
      JSON.stringify(before) === JSON.stringify(after) &&
      task('T1').status === 'pending' &&
      (runs.get('T1') || 0) === 0,
    JSON.stringify({ state: stillCompleted, before, after, runs: runs.get('T1') || 0 })
  );

  // ---- 3) 门槛恢复后，当前实现仍无法自愈 ----
  budgetAllows = true;
  await requeueCurrent(queue, 'T1');
  await new Promise(r => setTimeout(r, 800));
  assert('门槛恢复后当前实现仍不执行（缺陷成立）', task('T1').status === 'pending' && (runs.get('T1') || 0) === 0, JSON.stringify(task('T1')));

  // ---- 4) 最小修复：终态记录清除后可重新执行 ----
  await requeueFixed(queue, 'T1');
  const t1Done = await waitFor(() => task('T1').status === 'completed');
  assert('修复后门槛恢复即可重新执行', t1Done && task('T1').attemptCount === 1 && (runs.get('T1') || 0) === 1, JSON.stringify(task('T1')));

  // ---- 5) job 正在跑时，多次协调不重复执行 ----
  task('T2');
  budgetAllows = true;
  let releaseT2;
  holds.set('T2', new Promise(resolve => { releaseT2 = resolve; }));
  await enqueue(queue, 'T2', 1);
  await waitFor(async () => (await queue.getJobState('memory-T2')) === 'active');
  const dup1 = await requeueFixed(queue, 'T2');
  const dup2 = await requeueFixed(queue, 'T2');
  releaseT2();
  const t2Done = await waitFor(() => task('T2').status === 'completed');
  assert(
    'job 在跑时多次协调不重复执行同一业务任务',
    t2Done && (runs.get('T2') || 0) === 1 && dup1.skipped === true && dup2.skipped === true,
    JSON.stringify({ runs: runs.get('T2'), dup1: dup1.skipped, dup2: dup2.skipped })
  );

  // ---- 6) 执行失败仍可恢复 ----
  task('T3');
  failFirst.add('T3');
  budgetAllows = true;
  await enqueue(queue, 'T3');
  const t3Failed = await waitFor(async () => (await queue.getJobState('memory-T3')) === 'failed');
  const afterFail = JSON.stringify(task('T3'));
  failFirst.delete('T3');
  await requeueFixed(queue, 'T3');
  const t3Done = await waitFor(() => task('T3').status === 'completed');
  assert('执行失败仍可恢复', t3Failed && task('T3').status === 'completed' && task('T3').attemptCount === 2, JSON.stringify({ afterFail, now: task('T3') }));

  // ---- 7) 没有靠删除任务/标完成清积压：所有任务记录仍在，且是执行后才 completed ----
  const allPresent = ['T1', 'T2', 'T3'].every(id => store.has(id) && store.get(id).status === 'completed');
  assert('未删除任务、未提前标完成', allPresent, JSON.stringify([...store.entries()]));

  const output = {
    date: new Date().toISOString(),
    prefix: PREFIX,
    scope: '隔离本地 Redis + BullMQ，模拟生产 processTask/enqueueTaskJob/requeueDueTask 分支',
    assertions,
    taskStates: Object.fromEntries(store),
    runs: Object.fromEntries(runs),
    allPassed: assertions.every(a => a.ok),
  };
  fs.writeFileSync(path.join(__dirname, 'backlog-repro-result.json'), JSON.stringify(output, null, 2) + '\n');
  for (const a of assertions) console.log(`${a.ok ? 'PASS' : 'FAIL'} ${a.name} :: ${a.detail}`);
  console.log(output.allPassed ? 'ALL PASSED' : 'SOME FAILED');

  await worker.close();
  await queue.obliterate({ force: true }).catch(() => {});
  await queue.close();
  await redis.quit();
}

// 把"协调任务重排"写成一个可读步骤，保持与生产同义
async function enqueueCurrentReconcile(queue, taskId) {
  return requeueCurrent(queue, taskId);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
