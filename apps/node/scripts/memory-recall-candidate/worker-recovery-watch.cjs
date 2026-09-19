/**
 * 记忆 worker 恢复对照（聊天稳定优先）。
 * 只启动 tzl_memory_worker，不动聊天进程/配置/并发；不部署代码；不再清积压。
 * 自动停止条件：聊天时延或回复队列或 load 或聊天 CPU 连续两次恶化。
 *
 * 用法：node apps/node/scripts/memory-recall-candidate/worker-recovery-watch.cjs
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { MongoClient } = require('../../node_modules/mongodb');
const Redis = require('../../node_modules/ioredis');

const HOST = 'root@1.13.18.200';
const KEY = '~/.ssh/id_ed25519';
const EVID = path.resolve(__dirname, '..', '..', '..', '..', '.task-evidence/cpu-recall-20260915/worker-recovery');
const MONGO = 'mongodb://admin:qwerasdf@1.13.18.200:17271/tzl?authSource=admin&directConnection=true';
const REDIS = { host: '1.13.18.200', port: 17380 };
const PFX = '{tzl-bullmq}:memory-pipeline:';
const BASH = { encoding: 'utf8', timeout: 30000 };

function ssh(cmd) {
  return execSync(`ssh -o BatchMode=yes -o ConnectTimeout=8 -i ${KEY} ${HOST} ${JSON.stringify(cmd)}`, BASH).toString();
}

const STOP = { healthMs: 1500, replyWait: 10, load1: 8, nodeCpu: 200, consecutive: 2 };

fs.mkdirSync(EVID, { recursive: true });
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const logFile = path.join(EVID, `watch-${runId}.jsonl`);

async function sample(mc, r, phase, startedAt) {
  const host = ssh('cat /proc/loadavg; docker stats --no-stream --format "{{.Name}} {{.CPUPerc}} {{.MemUsage}}" | grep -E "tzl_node|tzl_memory_worker"');
  const load1 = Number(host.trim().split(/\s+/)[0]);
  const nodeLine = host.split('\n').find(l => l.startsWith('tzl_node')) || '';
  const workerLine = host.split('\n').find(l => l.startsWith('tzl_memory_worker')) || '';
  const parse = line => {
    const m = line.match(/cpu=([\d.]+)%\s+mem=([\d.]+)(MiB|GiB)/);
    return m ? { cpu: Number(m[1]), mem: m[3] === 'GiB' ? Number(m[2]) * 1024 : Number(m[2]) } : null;
  };
  let healthMs = null;
  try {
    healthMs = Number(execSync('curl -o /dev/null -s -w "%{time_total}" --max-time 20 https://tianzhiling.chat/api/system/health', BASH).toString()) * 1000;
  } catch { healthMs = null; }
  const col = mc.db('tzl').collection('memory_pipeline_task');
  const tasks = mc.db('tzl').collection('chat_trace');
  const since = new Date(Date.now() - 60000);
  const replies = await tasks.countDocuments({ status: 'completed', updatedAt: { $gte: since } });
  const S = {
    t: new Date().toISOString(),
    phase,
    load1,
    nodeCpu: parse(nodeLine)?.cpu ?? null,
    nodeMemMB: parse(nodeLine)?.mem ?? null,
    workerCpu: parse(workerLine)?.cpu ?? null,
    workerMemMB: parse(workerLine)?.mem ?? null,
    healthMs: healthMs ? Math.round(healthMs) : null,
    replyWait: await r.llen('{tzl-bullmq}:conversation-reply:wait'),
    replyActive: await r.llen('{tzl-bullmq}:conversation-reply:active'),
    repliesLastMin: replies,
    memPending: await col.countDocuments({ status: 'pending' }),
    memProcessing: await col.countDocuments({ status: 'processing' }),
    memCompletedSinceStart: await col.countDocuments({ status: 'completed', completedAt: { $gte: startedAt } }),
    memFailedSinceStart: await col.countDocuments({ status: 'failed', attemptCount: { $lt: 6 }, updatedAt: { $gte: startedAt } }),
    abandoned: await col.countDocuments({ status: 'failed', attemptCount: 6, backlogClearRunId: { $exists: true } }),
    abandonedAttemptGt6: await col.countDocuments({ backlogClearRunId: { $exists: true }, attemptCount: { $gt: 6 } }),
    queuePrio: await r.zcard(PFX + 'prioritized'),
    queueActive: await r.llen(PFX + 'active'),
  };
  // 最近完成任务的耗时与类型
  const recent = await col.find({ status: 'completed', completedAt: { $gte: startedAt } }, { projection: { kind: 1, messageIds: 1 } }).limit(40).toArray();
  const byKind = {};
  for (const t of recent) {
    const h = await r.hgetall(PFX + 'memory-' + t._id.toString());
    const proc = h.processedOn && h.finishedOn ? Number(h.finishedOn) - Number(h.processedOn) : null;
    const k = t.kind;
    byKind[k] = byKind[k] || { tasks: 0, messages: 0, dur: [] };
    byKind[k].tasks += 1;
    byKind[k].messages += Array.isArray(t.messageIds) ? t.messageIds.length : 1;
    if (proc != null) byKind[k].dur.push(proc);
  }
  S.byKind = Object.fromEntries(Object.entries(byKind).map(([k, v]) => [k, {
    tasks: v.tasks, messages: v.messages,
    avgProcMs: v.dur.length ? Math.round(v.dur.reduce((a, b) => a + b, 0) / v.dur.length) : null,
    maxProcMs: v.dur.length ? Math.max(...v.dur) : null,
  }]));
  return S;
}

function breaches(s) {
  const out = [];
  if (s.healthMs != null && s.healthMs > STOP.healthMs) out.push(`health>${STOP.healthMs}`);
  if (s.replyWait > STOP.replyWait) out.push(`replyWait>${STOP.replyWait}`);
  if (s.load1 > STOP.load1) out.push(`load1>${STOP.load1}`);
  if (s.nodeCpu != null && s.nodeCpu > STOP.nodeCpu) out.push(`nodeCpu>${STOP.nodeCpu}`);
  return out;
}

async function captureEvidence(tag) {
  const out = [];
  out.push(`===== evidence ${tag} ${new Date().toISOString()} =====`);
  try { out.push(ssh('docker ps -a --format "{{.Names}} {{.Status}}" | grep -E "tzl_node|memory_worker"')); } catch {}
  try { out.push('--- docker top tzl_memory_worker ---\n' + ssh('docker top tzl_memory_worker -o pid,pcpu,pmem,etime,args 2>&1 | head -8')); } catch {}
  try { out.push('--- logs tail ---\n' + ssh('docker logs --tail 40 tzl_memory_worker 2>&1 | tail -40')); } catch {}
  return out.join('\n');
}

async function main() {
  const mc = new MongoClient(MONGO, { serverSelectionTimeoutMS: 8000 });
  const r = new Redis({ ...REDIS, maxRetriesPerRequest: 3, retryStrategy: () => null });
  await mc.connect(); await r.ping();
  const worker = await r.exists(PFX + 'memory-' + 'x').catch(() => 0); void worker;

  // 基线（worker 停止中）
  const pre = await sample(mc, r, 'pre', new Date());
  fs.appendFileSync(logFile, JSON.stringify(pre) + '\n');
  console.log('PRE', JSON.stringify(pre));

  const startedAt = new Date();
  ssh('docker start tzl_memory_worker');
  console.log('worker started at', startedAt.toISOString());
  fs.appendFileSync(logFile, JSON.stringify({ phase: 'start', startedAt: startedAt.toISOString(), concurrency: 1 }) + '\n');

  let consecutive = 0; let stopped = false; const samples = [];
  for (let i = 0; i < 34; i++) {
    const everyMs = i < 10 ? 30000 : 60000; // 前 5 分钟每 30s，之后每 60s
    await new Promise(x => setTimeout(x, everyMs));
    const s = await sample(mc, r, 'watch', startedAt);
    samples.push(s);
    fs.appendFileSync(logFile, JSON.stringify(s) + '\n');
    console.log(JSON.stringify({ t: s.t.slice(11, 19), load1: s.load1, nodeCpu: s.nodeCpu, workerCpu: s.workerCpu, healthMs: s.healthMs, replyWait: s.replyWait, replies: s.repliesLastMin, memPending: s.memPending, done: s.memCompletedSinceStart, byKind: s.byKind }));
    const b = breaches(s);
    if (b.length) { consecutive += 1; console.log('BREACH', b.join(','), 'consecutive', consecutive); }
    else consecutive = 0;
    if (consecutive >= STOP.consecutive) {
      const ev = await captureEvidence('before-stop');
      fs.appendFileSync(logFile, JSON.stringify({ phase: 'stop-condition', breaches: b, sample: s }) + '\n');
      fs.writeFileSync(path.join(EVID, `stop-evidence-${runId}.txt`), ev + '\n');
      console.log('STOP CONDITION MET -> stopping memory worker');
      ssh('docker stop tzl_memory_worker');
      stopped = true;
      const after = await sample(mc, r, 'post-stop', startedAt);
      fs.appendFileSync(logFile, JSON.stringify(after) + '\n');
      console.log('POST-STOP', JSON.stringify(after));
      break;
    }
  }
  const summary = { runId, startedAt: startedAt.toISOString(), stopped, samples: samples.length, first: samples[0], last: samples[samples.length - 1] };
  fs.writeFileSync(path.join(EVID, `summary-${runId}.json`), JSON.stringify(summary, null, 2) + '\n');
  console.log('SUMMARY', JSON.stringify({ runId, stopped, samples: samples.length }));
  await r.quit().catch(() => {}); await mc.close().catch(() => {});
}

main().catch(e => { console.error(e); process.exit(1); });
