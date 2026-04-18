const { existsSync, readFileSync } = require('fs');
const { resolve } = require('path');
const { MongoClient } = require('mongodb');

loadLocalEnv();

async function main() {
  const connectionString = buildMongoConnectionString();
  const client = new MongoClient(connectionString);

  await client.connect();

  try {
    const db = client.db(process.env.MONGO_DB || 'tzl');
    const collection = db.collection('post');
    const cursor = collection.find(
      { images: { $exists: true, $type: 'array', $ne: [] } },
      { projection: { images: 1 } }
    );

    let scanned = 0;
    let updated = 0;

    while (await cursor.hasNext()) {
      const post = await cursor.next();
      scanned += 1;

      const rawImages = Array.isArray(post.images) ? post.images : [];
      const normalizedImages = rawImages.map(normalizeForStorage);
      const changed =
        rawImages.length === normalizedImages.length &&
        rawImages.some((image, index) => image !== normalizedImages[index]);

      if (!changed) {
        continue;
      }

      await collection.updateOne(
        { _id: post._id },
        { $set: { images: normalizedImages, updatedAt: new Date() } }
      );

      updated += 1;
      console.log(
        `[migrate-post-image-object-keys] updated post=${String(post._id)}`
      );
    }

    console.log(
      `[migrate-post-image-object-keys] completed scanned=${scanned} updated=${updated}`
    );
  } finally {
    await client.close();
  }
}

function normalizeForStorage(rawValue) {
  const value = typeof rawValue === 'string' ? rawValue.trim() : '';

  if (!value) {
    return '';
  }

  return (
    extractObjectKeyByHosts(value, getTencentKnownHosts()) ||
    extractObjectKeyByHosts(value, getOssKnownHosts()) ||
    value
  );
}

function extractObjectKeyByHosts(value, hosts) {
  if (!/^https?:\/\//i.test(value) || hosts.length === 0) {
    return '';
  }

  try {
    const url = new URL(value);

    if (!hosts.includes(url.host.toLowerCase())) {
      return '';
    }

    return decodeURIComponent(url.pathname.replace(/^\/+/, ''));
  } catch {
    return '';
  }
}

function getTencentKnownHosts() {
  const hosts = new Set();
  const bucket = (process.env.TENCENT_COS_BUCKET || '').trim();
  const region = (process.env.TENCENT_COS_REGION || '').trim();

  appendHost(hosts, process.env.TENCENT_COS_DOMAIN || '');
  appendHost(hosts, process.env.TENCENT_COS_PUBLIC_BASE_URL || '');

  if (bucket && region) {
    hosts.add(`${bucket}.cos.${region}.myqcloud.com`.toLowerCase());
  }

  return Array.from(hosts);
}

function getOssKnownHosts() {
  const hosts = new Set();
  const bucket = (process.env.OSS_BUCKET || '').trim();
  const region = (process.env.OSS_REGION || '').trim();
  const endpoint = (process.env.OSS_ENDPOINT || '').trim();

  appendHost(hosts, process.env.OSS_PUBLIC_BASE_URL || '');
  appendHost(hosts, endpoint);

  if (bucket && region) {
    hosts.add(`${bucket}.oss-${region.replace(/^oss-/, '')}.aliyuncs.com`);
    hosts.add(`${bucket}.oss.${region}.aliyuncs.com`);
  }

  return Array.from(hosts).map(host => host.toLowerCase());
}

function appendHost(target, value) {
  const trimmed = String(value || '').trim();

  if (!trimmed) {
    return;
  }

  try {
    const url = /^https?:\/\//i.test(trimmed)
      ? new URL(trimmed)
      : new URL(`https://${trimmed}`);
    target.add(url.host.toLowerCase());
  } catch {
    // Ignore invalid host strings.
  }
}

function buildMongoConnectionString() {
  const host = process.env.MONGO_HOST || '127.0.0.1';
  const port = process.env.MONGO_PORT || '17271';
  const database = process.env.MONGO_DB || 'tzl';
  const authSource = process.env.MONGO_AUTH_SOURCE || 'admin';
  const username = encodeURIComponent(process.env.MONGO_USERNAME || 'admin');
  const password = encodeURIComponent(process.env.MONGO_PASSWORD || 'qwerasdf');

  return `mongodb://${username}:${password}@${host}:${port}/${database}?authSource=${authSource}`;
}

function loadLocalEnv() {
  const envPaths = [
    resolve(process.cwd(), '.env'),
    resolve(__dirname, '../.env'),
  ];
  const seen = new Set();

  for (const envPath of envPaths) {
    if (seen.has(envPath) || !existsSync(envPath)) {
      continue;
    }

    seen.add(envPath);
    const raw = readFileSync(envPath, 'utf8');

    for (const line of raw.split(/\r?\n/)) {
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

      if (!key || process.env[key] != null) {
        continue;
      }

      process.env[key] = value;
    }
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
