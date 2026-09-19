/**
 * 清空当前积压的"待执行"任务（用户已授权）。
 *
 * 约束：
 * - 清理前固定范围：status=pending 且 createdAt <= CUTOFF；不含 processing/active。
 * - 保留正在执行的任务与 CUTOFF 之后新产生的任务。
 * - 不删除聊天原文、已有记忆或向量数据；不删除任务文档，只把它们标为 failed（非成功）+ 标记。
 * - 同步处理 DB 与队列：清掉对应的 waiting/prioritized/delayed job（不碰 active），
 *   清掉未落库的 structured_memory 批量缓冲与待执行的 flush job，防止协调器/兜底再生成旧任务。
 * - 防止协调器重新入队：attemptCount 置 6（getDueTasks 的上限）+ nextAttemptAt 远期。
 * - 不自动回填本次放弃的历史任务。
 *
 * 用法：
 *   node apps/node/scripts/memory-recall-candidate/clear-backlog.cjs --dry-run
 *   node apps/node/scripts/memory-recall-candidate/clear-backlog.cjs --apply
 */
const fs = require('fs');
const path = require('path');
const { MongoClient } = require('../../node_modules/mongodb');
const Redis = require('../../node_modules/ioredis');
const { Queue } = require('../../node_modules/bullmq');

const MONGO = 'mongodb://admin:qwerasdf@1.13.18.200:17271/tzl?authSource=admin&directConnection=true';
const REDIS = { host: '1.13.18.200', port: 17380 };
const QUEUE_NAME = 'memory-pipeline';
const PREFIX = '{tzl-bullmq}';
const EVID = path.resolve(__dirname, '..', '..', '..', '..', '.task-evidence/cpu-recall-20260915');
const BATCH_KEY_PATTERN = 'memory-pipeline:batch:structured_memory:*';
const FLUSH_PREFIX = 'memory-flush-structured_memory-';

const APPLY = process.argv.includes('--apply');
const DRY = !APPLY;

async function main() {
  const cutoff = new Date();
  const runId = cutoff.toISOString().replace(/[:.]/g, '-');
  fs.mkdirSync(EVID, { recursive: true });

  const mc = new MongoClient(MONGO, { serverSelectionTimeoutMS: 10000 });
  const redis = new Redis({ ...REDIS, maxRetriesPerRequest: null });
  const queue = new Queue(QUEUE_NAME, { connection: REDIS, prefix: PREFIX });

  const report = {
    mode: APPLY ? 'apply' : 'dry-run',
    cutoff: cutoff.toISOString(),
    scope: 'memory_pipeline_task: status=pending AND createdAt<=cutoff（不含 processing/active）',
    counts: {},
    removed: {},
    skipped: {},
    errors: [],
    abandonedStatus: 'failed (attemptCount=6, nextAttemptAt=2099-01-01) — 非成功',
  };

  try {
    await mc.connect();
    await redis.ping();

    const col = mc.db('tzl').collection('memory_pipeline_task');
    const scopeFilter = { status: 'pending', createdAt: { $lte: cutoff } };
    const scoped = await col
      .find(scopeFilter, {
        projection: {
          kind: 1, status: 1, messageId: 1, messageIds: 1, conversationId: 1,
          userId: 1, agentId: 1, attemptCount: 1, nextAttemptAt: 1, createdAt: 1, sourceHash: 1,
        },
      })
      .toArray();
    report.counts.scopedPending = scoped.length;
    report.counts.scopedByKind = scoped.reduce((acc, t) => {
      acc[t.kind] = (acc[t.kind] || 0) + 1;
      return acc;
    }, {});
    report.counts.processingNow = await col.countDocuments({ status: 'processing' });
    report.counts.pendingAfterCutoff = await col.countDocuments({
      status: 'pending',
      createdAt: { $gt: cutoff },
    });

    // 备份（受限目录）：任务文档（只有 id/状态，无聊天原文）
    const backupFile = path.join(EVID, `backlog-backup-${runId}.jsonl`);
    fs.writeFileSync(backupFile, scoped.map(t => JSON.stringify(t)).join('\n') + '\n');
    report.backupFile = backupFile;

    // Redis：批量缓冲 + flush job（先记录，再按 --apply 清理）
    const batchKeys = await redis.keys(BATCH_KEY_PATTERN);
    const flushIds = new Set();
    for (const z of ['prioritized', 'delayed', 'wait']) {
      const members =
        z === 'wait'
          ? await redis.lrange(`${PREFIX}:${QUEUE_NAME}:wait`, 0, -1)
          : await redis.zrange(`${PREFIX}:${QUEUE_NAME}:${z}`, 0, -1);
      for (const m of members) if (m.startsWith(FLUSH_PREFIX)) flushIds.add(m);
    }
    report.counts.batchKeys = batchKeys.length;
    report.counts.flushJobs = flushIds.size;

    // 任务 job：只清非 active
    const scopedIds = scoped.map(t => t._id.toString());
    let removedJobs = 0;
    let activeSkipped = 0;
    let missingJobs = 0;
    let removeErrors = 0;

    if (APPLY) {
      // 1) 先清批量缓冲与 flush job，避免之后又生成旧任务
      if (batchKeys.length) await redis.del(...batchKeys);
      report.removed.batchKeys = batchKeys.length;
      for (const id of flushIds) {
        try {
          const job = await queue.getJob(id);
          if (!job) continue;
          const state = await job.getState();
          if (state === 'active') { activeSkipped += 1; continue; }
          await job.remove();
          removedJobs += 1;
        } catch (e) { removeErrors += 1; report.errors.push(`flush ${id}: ${String(e.message).slice(0,80)}`); }
      }
      report.removed.flushJobs = removedJobs;

      // 2) 清任务 job（并发 20）
      removedJobs = 0;
      const concurrency = 20;
      for (let i = 0; i < scopedIds.length; i += concurrency) {
        const chunk = scopedIds.slice(i, i + concurrency);
        await Promise.all(chunk.map(async id => {
          try {
            const job = await queue.getJob(`memory-${id}`);
            if (!job) { missingJobs += 1; return; }
            const state = await job.getState();
            if (state === 'active') { activeSkipped += 1; return; }
            await job.remove();
            removedJobs += 1;
          } catch (e) { removeErrors += 1; report.errors.push(`task ${id}: ${String(e.message).slice(0,80)}`); }
        }));
      }
      report.removed.taskJobs = removedJobs;

      // 3) DB：标记为 failed（非成功），并阻止协调器再入队
      const update = await col.updateMany(scopeFilter, {
        $set: {
          status: 'failed',
          attemptCount: 6,
          nextAttemptAt: new Date('2099-01-01T00:00:00.000Z'),
          lastError: 'backlog-clear-20260915: NOT executed; backlog cleared by operator; no auto backfill',
          backlogClearedAt: cutoff,
          backlogClearRunId: runId,
        },
        $unset: { processingStartedAt: '' },
      });
      report.updated = { matched: update.matchedCount, modified: update.modifiedCount };
    } else {
      report.removed.batchKeys = `(dry-run ${batchKeys.length})`;
      report.removed.flushJobs = `(dry-run ${flushIds.size})`;
      report.removed.taskJobs = `(dry-run ~${scopedIds.length})`;
      report.updated = '(dry-run)';
    }

    report.skipped = { activeJobs: activeSkipped, missingJobs, removeErrors };

    // 清理后核对
    report.after = {
      pending: await col.countDocuments({ status: 'pending' }),
      processing: await col.countDocuments({ status: 'processing' }),
      failed: await col.countDocuments({ status: 'failed' }),
      completed: await col.countDocuments({ status: 'completed' }),
      pendingByKind: await col.aggregate([
        { $match: { status: 'pending' } },
        { $group: { _id: '$kind', n: { $sum: 1 } } },
      ]).toArray(),
      queuePrioritized: await redis.zcard(`${PREFIX}:${QUEUE_NAME}:prioritized`),
      queueActive: await redis.llen(`${PREFIX}:${QUEUE_NAME}:active`),
      queueDelayed: await redis.zcard(`${PREFIX}:${QUEUE_NAME}:delayed`),
      batchKeys: (await redis.keys(BATCH_KEY_PATTERN)).length,
    };

    const outFile = path.join(EVID, `backlog-clear-${runId}.json`);
    fs.writeFileSync(outFile, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
    console.log(`written ${outFile}`);
    if (DRY) console.log('DRY-RUN：未做任何修改；确认后用 --apply 执行');
  } finally {
    await queue.close().catch(() => {});
    await redis.quit().catch(() => {});
    await mc.close().catch(() => {});
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
