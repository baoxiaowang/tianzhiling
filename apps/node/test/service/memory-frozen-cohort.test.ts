import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createHash } from 'crypto';
import { gzipSync } from 'zlib';
import { memoryValueModeForUser } from '../../src/service/agents/memory-value-rollout';
describe('immutable 30-day memory cohort', () => {
  const original = { ...process.env };
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'memory-cohort-test-'));
    process.env.NODE_MEMORY_VALUE_MODE = 'active';
    process.env.NODE_MEMORY_VALUE_USER_IDS = '';
  });
  afterEach(() => {
    for (const k of [
      'NODE_MEMORY_VALUE_MODE',
      'NODE_MEMORY_VALUE_USER_IDS',
      'NODE_MEMORY_VALUE_COHORT_FILE',
      'NODE_MEMORY_VALUE_COHORT_SHA256',
      'NODE_MEMORY_VALUE_COHORT_GZIP_0',
    ]) {
      if (original[k] === undefined) delete process.env[k];
      else process.env[k] = original[k];
    }
    rmSync(dir, { recursive: true });
  });
  const id = '665000000000000000000001';
  function file(data: any, digest?: string) {
    const path = join(dir, `${Math.random()}.json`);
    const body = JSON.stringify(data);
    writeFileSync(path, body);
    process.env.NODE_MEMORY_VALUE_COHORT_FILE = path;
    process.env.NODE_MEMORY_VALUE_COHORT_SHA256 =
      digest || createHash('sha256').update(body).digest('hex');
  }
  const valid = () => ({
    version: 1,
    activeDays: 30,
    since: '2026-08-10T00:00:00Z',
    until: '2026-09-09T00:00:00Z',
    userIds: [id],
  });
  it('enables only listed IDs in a digest-verified exact 30-day scope', () => {
    file(valid());
    expect(memoryValueModeForUser(id)).toBe('active');
    expect(memoryValueModeForUser('665000000000000000000099')).toBe('off');
  });
  it('supports bounded compressed exact IDs without a new production volume or wildcard', () => {
    delete process.env.NODE_MEMORY_VALUE_COHORT_FILE;
    const bytes = Buffer.from(JSON.stringify(valid()));
    process.env.NODE_MEMORY_VALUE_COHORT_GZIP_0 =
      gzipSync(bytes).toString('base64');
    process.env.NODE_MEMORY_VALUE_COHORT_SHA256 = createHash('sha256')
      .update(bytes)
      .digest('hex');
    expect(memoryValueModeForUser(id)).toBe('active');
    expect(memoryValueModeForUser('665000000000000000000099')).toBe('off');
  });
  it('fails closed for changed bytes, invalid IDs, wildcards, or a 90-day scope', () => {
    for (const data of [
      { ...valid(), userIds: ['*'] },
      { ...valid(), activeDays: 90 },
      { ...valid(), since: '2026-06-11T00:00:00Z' },
    ]) {
      file(data);
      expect(memoryValueModeForUser(id)).toBe('off');
    }
    file(valid(), '0'.repeat(64));
    expect(memoryValueModeForUser(id)).toBe('off');
  });
});
