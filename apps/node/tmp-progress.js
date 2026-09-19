const fs = require('fs');
const path = require('path');
const { MongoClient, ObjectId } = require('mongodb');

const envPath = path.resolve(__dirname, '../../.env');
for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith('#')) continue;
  const i = t.indexOf('=');
  if (i <= 0) continue;
  const k = t.slice(0, i).trim();
  const v = t.slice(i + 1).trim().replace(/^["']|["']$/g, '');
  if (process.env[k] === undefined) process.env[k] = v;
}
const runId = process.argv[2] || 'memory_rebuild_canary_01';
const host = '127.0.0.1';
const port = process.env.NODE_MONGO_PORT || process.env.MONGO_PORT || '17271';
const user = encodeURIComponent(process.env.NODE_MONGO_USERNAME || 'admin');
const pass = encodeURIComponent(process.env.NODE_MONGO_PASSWORD || 'qwerasdf');
const auth = process.env.NODE_MONGO_AUTH_SOURCE || 'admin';
const uri = `mongodb://${user}:${pass}@${host}:${port}/?authSource=${auth}`;

(async () => {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
  await client.connect();
  const stage = client.db(runId);
  const accounts = await stage.collection('accounts').find({}).toArray();
  console.log(
    'STAGE_ACCOUNTS=' +
      JSON.stringify(
        accounts.map(a => ({
          id: String(a._id),
          status: a.status,
          processed: a.processed,
          total: a.total,
          error: a.errorCode || '',
        }))
      )
  );
  const run = await stage.collection('runs').findOne({ _id: runId });
  console.log(
    'RUN=' +
      JSON.stringify({
        status: run && run.status,
        calls: run && run.modelCalls,
        tokens: run && run.modelTokens,
        waiting: run && run.waitingForLiveTraffic,
        heartbeat: run && run.heartbeatAt,
      })
  );
  const mirror = client.db('tzl_mirror');
  console.log('SOURCE_FACTS=' + (await mirror.collection('agent_profile_fact').countDocuments()));
  await client.close();
})().catch(e => {
  console.error('PROGRESS_ERR=' + e.message);
  process.exit(1);
});
