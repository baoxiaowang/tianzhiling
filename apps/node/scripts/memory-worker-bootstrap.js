// memory_worker 启动脚本：同时启动主应用和 departure-duration 独立 worker。
//
// 除托管之外，它还负责在**主应用**堆涨到危险水位之前把它重启掉：
// 2026-09-18 实测记忆 worker 主应用堆涨到约 3GB（上限 4GB）后会陷入 GC 病态，
// 完成吞吐从约 500/h 掉到 280/h，进而让 structured_memory 积压、新用户记忆为空。
// 重启只换主应用进程，不动容器，也不影响 departure-duration worker。
// 进程中途退出可能留下 processing 状态的任务，路由侧有 10 分钟兜底回收，可安全重跑。
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

let mainApp = null;
let durationWorker = null;
let mainStartedAt = 0;
let restartPending = false;

function readPositiveInt(name, fallback) {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback;
}

const MAIN_RESTART_INTERVAL_MS = readPositiveInt(
  'NODE_MEMORY_WORKER_MAIN_RESTART_INTERVAL_MS',
  4 * 60 * 60 * 1000
);
const MAIN_RESTART_RSS_MB = readPositiveInt(
  'NODE_MEMORY_WORKER_MAIN_RESTART_RSS_MB',
  3400
);
const MAIN_RESTART_MIN_UPTIME_MS = readPositiveInt(
  'NODE_MEMORY_WORKER_MAIN_RESTART_MIN_UPTIME_MS',
  30 * 60 * 1000
);
const MAIN_RESTART_CHECK_INTERVAL_MS = readPositiveInt(
  'NODE_MEMORY_WORKER_MAIN_RESTART_CHECK_INTERVAL_MS',
  60 * 1000
);
const MAIN_RESTART_KILL_GRACE_MS = readPositiveInt(
  'NODE_MEMORY_WORKER_MAIN_RESTART_KILL_GRACE_MS',
  15000
);

/**
 * 纯策略：返回 'interval' | 'rss' | null。抽成纯函数是为了可单测。
 */
function resolveRestartReason(options) {
  const uptimeMs = Number(options && options.uptimeMs);
  const minUptimeMs = Number(options && options.minUptimeMs);
  const intervalMs = Number(options && options.intervalMs);
  const rssMb = Number(options && options.rssMb);
  const rssLimitMb = Number(options && options.rssLimitMb);

  if (!Number.isFinite(uptimeMs) || uptimeMs < minUptimeMs) return null;
  if (Number.isFinite(rssMb) && rssMb >= rssLimitMb) return 'rss';
  if (intervalMs > 0 && uptimeMs >= intervalMs) return 'interval';
  return null;
}

function readMainRssMb() {
  if (!mainApp || !mainApp.pid) return null;
  try {
    const status = fs.readFileSync(`/proc/${mainApp.pid}/status`, 'utf8');
    const matched = /VmRSS:\s+(\d+)\s+kB/.exec(status);
    return matched ? Math.round(Number(matched[1]) / 1024) : null;
  } catch {
    return null;
  }
}

function startMainApp() {
  console.log('[memory-worker-bootstrap] starting main application...');
  mainStartedAt = Date.now();
  mainApp = spawn('node', [path.join(__dirname, '..', 'bootstrap.js')], {
    stdio: 'inherit',
    env: process.env,
  });

  mainApp.on('exit', (code) => {
    // 自愈重启：只重启主应用，容器与 departure-duration worker 都不动。
    if (restartPending) {
      restartPending = false;
      console.log(
        '[memory-worker-bootstrap] main application stopped for maintenance restart, respawning...'
      );
      setTimeout(startMainApp, 2000);
      return;
    }
    console.log(
      `[memory-worker-bootstrap] main application exited with code ${code}`
    );
    shutdown(code || 0);
  });

  mainApp.on('error', (err) => {
    console.error('[memory-worker-bootstrap] main application error:', err);
  });
}

function restartMainApp(reason, detail) {
  if (restartPending || !mainApp || !mainApp.pid) return;
  restartPending = true;
  console.log(
    `[memory-worker-bootstrap] maintenance restart requested, reason=${reason}, ${detail}`
  );
  const target = mainApp;
  target.kill('SIGTERM');
  setTimeout(() => {
    if (restartPending && target && target.exitCode === null) {
      console.warn(
        '[memory-worker-bootstrap] main application ignored SIGTERM, sending SIGKILL'
      );
      target.kill('SIGKILL');
    }
  }, MAIN_RESTART_KILL_GRACE_MS).unref?.();
}

function startMainRestartWatchdog() {
  const timer = setInterval(() => {
    if (!mainApp || restartPending) return;
    const uptimeMs = Date.now() - mainStartedAt;
    const rssMb = readMainRssMb();
    const reason = resolveRestartReason({
      uptimeMs,
      rssMb,
      intervalMs: MAIN_RESTART_INTERVAL_MS,
      rssLimitMb: MAIN_RESTART_RSS_MB,
      minUptimeMs: MAIN_RESTART_MIN_UPTIME_MS,
    });
    if (!reason) return;
    restartMainApp(
      reason,
      `uptimeMin=${Math.round(uptimeMs / 60000)} rssMb=${
        rssMb === null ? 'unknown' : rssMb
      } limits(intervalMin=${Math.round(
        MAIN_RESTART_INTERVAL_MS / 60000
      )} rssMb=${MAIN_RESTART_RSS_MB})`
    );
  }, MAIN_RESTART_CHECK_INTERVAL_MS);
  timer.unref?.();
  return timer;
}

function startDurationWorker() {
  console.log(
    '[memory-worker-bootstrap] starting departure-duration worker...'
  );
  durationWorker = spawn(
    'node',
    [path.join(__dirname, 'departure-duration-worker.js')],
    {
      stdio: 'inherit',
      env: process.env,
    }
  );

  durationWorker.on('exit', (code) => {
    console.log(
      `[memory-worker-bootstrap] departure-duration worker exited with code ${code}, restarting in 5s...`
    );
    setTimeout(startDurationWorker, 5000);
  });

  durationWorker.on('error', (err) => {
    console.error(
      '[memory-worker-bootstrap] departure-duration worker error:',
      err
    );
  });
}

function shutdown(code) {
  console.log('[memory-worker-bootstrap] shutting down...');
  if (mainApp) mainApp.kill('SIGTERM');
  if (durationWorker) durationWorker.kill('SIGTERM');
  setTimeout(() => process.exit(code), 5000);
}

function main() {
  // 信号处理
  process.on('SIGTERM', () => shutdown(0));
  process.on('SIGINT', () => shutdown(0));

  // 启动主应用
  startMainApp();

  // 主应用自愈重启看门狗
  startMainRestartWatchdog();

  // 延迟启动 departure-duration 独立 worker（等待主应用初始化）
  setTimeout(startDurationWorker, 20000);
}

module.exports = { resolveRestartReason, readPositiveInt };

if (require.main === module) {
  main();
}
