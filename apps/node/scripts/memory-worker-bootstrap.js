// memory_worker 启动脚本：同时启动主应用和 departure-duration 独立 worker
const { spawn } = require('child_process');
const path = require('path');

let mainApp = null;
let durationWorker = null;

function startMainApp() {
  console.log('[memory-worker-bootstrap] starting main application...');
  mainApp = spawn('node', [path.join(__dirname, '..', 'bootstrap.js')], {
    stdio: 'inherit',
    env: process.env,
  });

  mainApp.on('exit', (code) => {
    console.log(`[memory-worker-bootstrap] main application exited with code ${code}`);
    shutdown(code || 0);
  });

  mainApp.on('error', (err) => {
    console.error('[memory-worker-bootstrap] main application error:', err);
  });
}

function startDurationWorker() {
  console.log('[memory-worker-bootstrap] starting departure-duration worker...');
  durationWorker = spawn('node', [path.join(__dirname, 'departure-duration-worker.js')], {
    stdio: 'inherit',
    env: process.env,
  });

  durationWorker.on('exit', (code) => {
    console.log(`[memory-worker-bootstrap] departure-duration worker exited with code ${code}, restarting in 5s...`);
    setTimeout(startDurationWorker, 5000);
  });

  durationWorker.on('error', (err) => {
    console.error('[memory-worker-bootstrap] departure-duration worker error:', err);
  });
}

function shutdown(code) {
  console.log('[memory-worker-bootstrap] shutting down...');
  if (mainApp) mainApp.kill('SIGTERM');
  if (durationWorker) durationWorker.kill('SIGTERM');
  setTimeout(() => process.exit(code), 5000);
}

// 信号处理
process.on('SIGTERM', () => shutdown(0));
process.on('SIGINT', () => shutdown(0));

// 启动主应用
startMainApp();

// 延迟启动 departure-duration 独立 worker（等待主应用初始化）
setTimeout(startDurationWorker, 20000);
