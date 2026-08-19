const { readFileSync } = require('fs');
const { resolve } = require('path');

const repositoryRoot = resolve(__dirname, '../../../..');
const protectedFiles = [
  '.env.example',
  'docker-compose.yml',
  'apps/node/src/config/config.default.ts',
  'apps/node/src/config/config.online.ts',
  'apps/node/src/config/config.prod.ts',
  'apps/admin-node/src/config/config.default.ts',
  'apps/admin-node/src/config/config.prod.ts',
  'apps/admin-node/src/scripts/init-admin.ts',
  'apps/transfer/src/runtime.ts',
  'apps/node/scripts/archive-memory-noise.js',
  'apps/node/scripts/audit-memory-facts.js',
  'apps/node/scripts/ensure-agent-relationship-signal-indexes.js',
  'apps/node/scripts/ensure-chat-trace-indexes.js',
  'apps/node/scripts/ensure-messenger-call-event-indexes.js',
  'apps/node/scripts/ensure-post-pinning-index.js',
  'apps/node/scripts/migrate-messenger-avatar.js',
  'apps/node/scripts/migrate-post-image-object-keys.js',
  'apps/node/scripts/provision-user-messengers.js',
  'apps/node/scripts/report-messenger-usage.js',
  'apps/node/scripts/sync-agent-profile-memory-sources.js',
];

describe('repository secret policy', () => {
  it.each(protectedFiles)(
    '%s contains no embedded database credential',
    file => {
      const content = readFileSync(resolve(repositoryRoot, file), 'utf8');

      expect(content).not.toMatch(/mongodb:\/\/(?!\$\{)[^/:@\s]+:[^@\s]+@/u);
      expect(content).not.toMatch(/\$\{MONGO_PASSWORD:-[^}]+\}/u);
      expect(content).not.toMatch(
        /ONLINE_MONGO_PASSWORD\s*=\s*['"][^'"]+['"]/u
      );
      expect(content).not.toMatch(
        /MONGO_PASSWORD['"]?\]\s*,\s*['"][^'"]+['"]/u
      );
    }
  );

  it('keeps examples explicit and non-operational', () => {
    const example = readFileSync(
      resolve(repositoryRoot, '.env.example'),
      'utf8'
    );

    expect(example).toContain(
      'MONGO_PASSWORD=replace-with-a-strong-random-password'
    );
    expect(example).toContain(
      'MINIO_ROOT_PASSWORD=replace-with-a-strong-random-password'
    );
  });
});
