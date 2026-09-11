/**
 * 聊天导入群聊误判回填脚本
 *
 * 用途：对因群聊误判导致导入失败的 batch，重新执行识别和导入。
 * 背景：之前 recognizeScreenshot 把二人私聊误判为 group 并抛异常，
 *       导致识别结果未保存，batch 状态为 failed。
 *
 * 安全设计：
 * - 只回填特定错误类型（CHAT_IMPORT_NO_MESSAGES / CHAT_IMPORT_RECOGNITION_FAILED 且详情含群聊关键词）
 * - 支持 --dry-run 预览模式
 * - 支持 --limit 限制总数
 * - 支持 --user-id 只回填特定用户
 * - 分批限速处理，避免 API 限流
 * - 记录详细日志，可追溯
 *
 * 用法：
 *   node scripts/backfill-chat-import-group-misjudgment.js --dry-run
 *   node scripts/backfill-chat-import-group-misjudgment.js --limit 20
 *   node scripts/backfill-chat-import-group-misjudgment.js --user-id 6aa2823f7ba14c4a0c135743
 *   node scripts/backfill-chat-import-group-misjudgment.js --since 2026-09-01 --batch-size 5 --delay 10
 */

const { existsSync, readFileSync, writeFileSync } = require('fs');
const { resolve } = require('path');
const { MongoClient, ObjectId } = require('mongodb');
const { Queue } = require('bullmq');

loadLocalEnv();

// 解析命令行参数
const args = parseArgs();
const DRY_RUN = args['dry-run'] === true;
const LIMIT = parseInt(args['limit'] || '0', 10) || 0; // 0 = 不限制
const USER_ID = args['user-id'] || '';
const SINCE = args['since'] || ''; // YYYY-MM-DD
const BATCH_SIZE = parseInt(args['batch-size'] || '10', 10);
const DELAY_SECONDS = parseInt(args['delay'] || '5', 10);

const QUEUE_NAME = 'conversation-chat-import';
const LOG_FILE = resolve(__dirname, `../../logs/backfill-chat-import-${Date.now()}.log`);

let logLines = [];

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}`;
  console.log(line);
  logLines.push(line);
}

function saveLog() {
  try {
    writeFileSync(LOG_FILE, logLines.join('\n'), 'utf8');
    console.log(`\n日志已保存到: ${LOG_FILE}`);
  } catch (e) {
    console.error('保存日志失败:', e.message);
  }
}

function parseArgs() {
  const result = {};
  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = process.argv[i + 1];
      if (next && !next.startsWith('--')) {
        result[key] = next;
        i++;
      } else {
        result[key] = true;
      }
    }
  }
  return result;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  log('=== 聊天导入群聊误判回填开始 ===');
  log(`模式: ${DRY_RUN ? 'DRY-RUN（预览，不实际执行）' : '实际执行'}`);
  log(`限制: ${LIMIT ? `最多 ${LIMIT} 个 batch` : '不限制'}`);
  log(`用户: ${USER_ID || '全部用户'}`);
  log(`时间: ${SINCE ? `${SINCE} 之后` : '全部时间'}`);
  log(`批大小: ${BATCH_SIZE}, 批间延迟: ${DELAY_SECONDS}秒`);

  const mongoClient = new MongoClient(buildMongoConnectionString());
  await mongoClient.connect();

  const queue = new Queue(QUEUE_NAME, {
    connection: {
      host: readEnv(['NODE_REDIS_HOST', 'REDIS_HOST'], '127.0.0.1'),
      port: parseInt(readEnv(['NODE_REDIS_PORT', 'REDIS_PORT'], '6379'), 10),
      db: parseInt(readEnv(['NODE_REDIS_DB', 'REDIS_DB'], '0'), 10),
      password: readEnv(['NODE_REDIS_PASSWORD', 'REDIS_PASSWORD'], '') || undefined,
    },
    prefix: readEnv(['NODE_BULLMQ_PREFIX'], '{tzl-bullmq}'),
  });

  try {
    const db = mongoClient.db(readEnv(['NODE_MONGO_DB', 'MONGO_DB'], 'tzl'));
    const batchCollection = db.collection('conversation_chat_import_batch');

    // 构建查询条件
    const query = {
      status: 'failed',
      $or: [
        { errorCode: 'CHAT_IMPORT_NO_MESSAGES' },
        {
          errorCode: 'CHAT_IMPORT_RECOGNITION_FAILED',
          errorDetail: /群聊|两个人|two_person|unsupported/i,
        },
      ],
    };

    if (USER_ID) {
      query.userId = new ObjectId(USER_ID);
    }
    if (SINCE) {
      query.createdAt = { $gte: new Date(SINCE + 'T00:00:00Z') };
    }

    // 查询待回填的 batch
    const candidates = await batchCollection
      .find(query)
      .sort({ createdAt: 1 })
      .toArray();

    log(`\n找到 ${candidates.length} 个待回填 batch`);

    if (candidates.length === 0) {
      log('没有需要回填的 batch，退出。');
      return;
    }

    // 统计涉及的用户数
    const uniqueUsers = new Set(candidates.map(b => b.userId.toString()));
    log(`涉及 ${uniqueUsers.size} 个用户`);

    // 应用 limit
    let toProcess = candidates;
    if (LIMIT > 0 && candidates.length > LIMIT) {
      toProcess = candidates.slice(0, LIMIT);
      log(`应用限制，只处理前 ${LIMIT} 个 batch`);
    }

    // 预览模式：只展示，不执行
    if (DRY_RUN) {
      log('\n=== DRY-RUN 预览（不实际执行）===');
      toProcess.forEach((b, idx) => {
        log(`${idx + 1}. batch=${b._id.toString().substring(0, 12)} ` +
          `user=${b.userId.toString().substring(0, 12)} ` +
          `error=${b.errorCode} ` +
          `detail="${(b.errorDetail || '').substring(0, 40)}" ` +
          `createdAt=${b.createdAt.toISOString()}`);
      });
      log(`\n预览完成，共 ${toProcess.length} 个 batch 将被回填。`);
      log('去掉 --dry-run 参数即可实际执行。');
      return;
    }

    // 实际执行：分批处理
    log('\n=== 开始实际回填 ===');
    let successCount = 0;
    let failCount = 0;
    let skipCount = 0;

    for (let i = 0; i < toProcess.length; i += BATCH_SIZE) {
      const batch = toProcess.slice(i, i + BATCH_SIZE);
      log(`\n--- 处理第 ${i + 1}-${Math.min(i + BATCH_SIZE, toProcess.length)} 个（共 ${toProcess.length} 个）---`);

      for (const b of batch) {
        try {
          // 检查是否已经有 items（可能被其他进程处理了）
          const itemCount = await db.collection('conversation_chat_import_item')
            .countDocuments({ batchId: b._id });
          if (itemCount > 0) {
            log(`  跳过 batch=${b._id.toString().substring(0, 12)}：已有 ${itemCount} 个 items，可能已被处理`);
            skipCount++;
            continue;
          }

          // 重置 batch 状态为 queued
          const now = new Date();
          const assets = (b.assets || []).map(asset => ({
            ...asset,
            status: 'pending',
            errorCode: undefined,
            errorDetail: undefined,
            updatedAt: now,
          }));

          await batchCollection.updateOne(
            { _id: b._id },
            {
              $set: {
                status: 'queued',
                retryCount: (b.retryCount || 0) + 1,
                recognizedCount: 0,
                confirmedCount: 0,
                failedCount: 0,
                assets,
                updatedAt: now,
              },
              $unset: {
                errorCode: '',
                errorDetail: '',
              },
            }
          );

          // 入队
          const jobId = `chat-import:recognize:${b._id.toString()}`;
          await queue.add(
            'recognize',
            {
              operation: 'recognize',
              batchId: b._id.toString(),
            },
            {
              jobId,
              attempts: 3,
              removeOnComplete: true,
              removeOnFail: true,
              backoff: { type: 'exponential', delay: 3000 },
            }
          );

          log(`  成功入队 batch=${b._id.toString().substring(0, 12)} ` +
            `user=${b.userId.toString().substring(0, 12)} ` +
            `jobId=${jobId}`);
          successCount++;
        } catch (error) {
          log(`  失败 batch=${b._id.toString().substring(0, 12)}: ${error.message}`);
          failCount++;
        }
      }

      // 批间延迟
      if (i + BATCH_SIZE < toProcess.length) {
        log(`  等待 ${DELAY_SECONDS} 秒后继续...`);
        await sleep(DELAY_SECONDS * 1000);
      }
    }

    log('\n=== 回填完成 ===');
    log(`成功入队: ${successCount}`);
    log(`失败: ${failCount}`);
    log(`跳过: ${skipCount}`);
    log(`总计: ${toProcess.length}`);
    log('\n注意：入队后由 worker 异步处理识别和导入，处理完成需要一些时间。');
    log('可以通过查询 conversation_chat_import_batch 集合查看处理结果。');
  } finally {
    await queue.close();
    await mongoClient.close();
    saveLog();
  }
}

function buildMongoConnectionString() {
  const host = readEnv(['NODE_MONGO_HOST', 'MONGO_HOST'], '127.0.0.1');
  const port = readEnv(['NODE_MONGO_PORT', 'MONGO_PORT'], '17271');
  const database = readEnv(['NODE_MONGO_DB', 'MONGO_DB'], 'tzl');
  const authSource = readEnv(
    ['NODE_MONGO_AUTH_SOURCE', 'MONGO_AUTH_SOURCE'],
    'admin'
  );
  const username = encodeURIComponent(
    readEnv(['NODE_MONGO_USERNAME', 'MONGO_USERNAME'], 'admin')
  );
  const password = encodeURIComponent(
    readEnv(['NODE_MONGO_PASSWORD', 'MONGO_PASSWORD'], 'qwerasdf')
  );

  return `mongodb://${username}:${password}@${host}:${port}/${database}?authSource=${authSource}`;
}

function readEnv(keys, fallback) {
  for (const key of keys) {
    const value = String(process.env[key] || '').trim();
    if (value) {
      return value;
    }
  }
  return fallback;
}

function loadLocalEnv() {
  const envPaths = [
    resolve(process.cwd(), '.env.local'),
    resolve(process.cwd(), '.env'),
    resolve(__dirname, '../../../.env.local'),
    resolve(__dirname, '../../../.env'),
  ];
  const seen = new Set();

  for (const envPath of envPaths) {
    if (seen.has(envPath) || !existsSync(envPath)) {
      continue;
    }
    seen.add(envPath);

    for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }
      const index = trimmed.indexOf('=');
      if (index <= 0) {
        continue;
      }
      const key = trimmed.slice(0, index).trim();
      const value = trimmed.slice(index + 1).trim();
      if (key && process.env[key] == null) {
        process.env[key] = value;
      }
    }
  }
}

main().catch((err) => {
  console.error('回填失败:', err);
  process.exit(1);
});
