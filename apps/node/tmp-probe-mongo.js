const fs = require('fs');
const path = require('path');

const envPath = path.resolve(__dirname, '../../.env');
for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const idx = trimmed.indexOf('=');
  if (idx <= 0) continue;
  const key = trimmed.slice(0, idx).trim();
  let value = trimmed.slice(idx + 1).trim();
  value = value.replace(/^["']/, '').replace(/["']$/, '');
  if (process.env[key] === undefined) process.env[key] = value;
}

const modelKeys = Object.keys(process.env)
  .filter(k => /OPENAI|DASHSCOPE|QWEN|MEMORY_MODEL|MODEL_(API|NAME|BASE)|BAILIAN|ARK/i.test(k))
  .sort();
console.log('MODEL_KEYS=' + modelKeys.map(k => `${k}:${process.env[k] ? 'set' : 'empty'}`).join(', '));

const { MongoClient } = require('mongodb');
const host = process.env.NODE_MONGO_HOST || process.env.MONGO_HOST || '127.0.0.1';
const port = process.env.NODE_MONGO_PORT || process.env.MONGO_PORT || '17271';
const user = encodeURIComponent(process.env.NODE_MONGO_USERNAME || process.env.MONGO_USERNAME || 'admin');
const pass = encodeURIComponent(process.env.NODE_MONGO_PASSWORD || process.env.MONGO_PASSWORD || 'qwerasdf');
const auth = process.env.NODE_MONGO_AUTH_SOURCE || process.env.MONGO_AUTH_SOURCE || 'admin';
const uri = `mongodb://${user}:${pass}@${host}:${port}/?authSource=${auth}`;

(async () => {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
  await client.connect();
  const dbs = (await client.db().admin().listDatabases()).databases.map(d => d.name);
  console.log('LOCAL_DBS=' + dbs.join(', '));
  const tzl = client.db('tzl');
  const users = await tzl.collection('user').countDocuments();
  const msgs = await tzl.collection('message').countDocuments();
  console.log(`LOCAL_TZL users=${users} messages=${msgs}`);
  await client.close();
})().catch(error => {
  console.error('PROBE_ERR=' + error.message);
  process.exit(1);
});
