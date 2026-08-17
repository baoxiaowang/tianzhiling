const { existsSync, readFileSync } = require('fs');
const { resolve } = require('path');
const COS = require('cos-nodejs-sdk-v5');

const OBJECT_KEY = 'weapp/messenger-avatar-20260817.png';
const DEFAULT_SOURCE = resolve(
  __dirname,
  '../../weapp/src/assets/images/messenger/messenger-avatar.png'
);

loadLocalEnv();

async function main() {
  const sourcePath = process.argv[2]
    ? resolve(process.argv[2])
    : DEFAULT_SOURCE;

  if (!existsSync(sourcePath)) {
    throw new Error(`source image not found: ${sourcePath}`);
  }

  const secretId = requireEnv('NODE_TENCENT_COS_SECRET_ID');
  const secretKey = requireEnv('NODE_TENCENT_COS_SECRET_KEY');
  const bucket = requireEnv('NODE_TENCENT_COS_BUCKET');
  const region = requireEnv('NODE_TENCENT_COS_REGION');
  const publicBaseUrl = readEnv(['NODE_TENCENT_COS_PUBLIC_BASE_URL'], '');
  const body = readFileSync(sourcePath);

  const cos = new COS({ SecretId: secretId, SecretKey: secretKey });

  await new Promise((resolvePut, rejectPut) => {
    cos.putObject(
      {
        Bucket: bucket,
        Region: region,
        Key: OBJECT_KEY,
        Body: body,
        ContentType: 'image/png',
        CacheControl: 'public, max-age=31536000, immutable',
      },
      (error, data) => {
        if (error) {
          rejectPut(error);
          return;
        }
        resolvePut(data);
      }
    );
  });

  const publicUrl = publicBaseUrl.replace(/\/$/, '') + '/' + OBJECT_KEY;
  console.log(
    `[upload-messenger-avatar] done objectKey=${OBJECT_KEY} bytes=${body.length} url=${publicUrl}`
  );
}

function requireEnv(key) {
  const value = readEnv([key], '');
  if (!value) {
    throw new Error(`missing env: ${key}`);
  }
  return value;
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

main().catch(error => {
  console.error(error);
  process.exit(1);
});
