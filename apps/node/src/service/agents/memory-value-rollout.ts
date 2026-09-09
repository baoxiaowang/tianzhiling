import { readFileSync, statSync } from 'fs';
import { createHash } from 'crypto';
import { gunzipSync } from 'zlib';

let cohortCache: { key: string; checkedAt: number; users: Set<string> };
function frozenCohortIncludes(id: string): boolean {
  const path = process.env.NODE_MEMORY_VALUE_COHORT_FILE;
  const digest = process.env.NODE_MEMORY_VALUE_COHORT_SHA256;
  if (!digest || !/^[a-f0-9]{64}$/.test(digest)) return false;
  const key = `${path || 'env'}:${digest}`;
  if (cohortCache?.key === key && Date.now() - cohortCache.checkedAt < 5000)
    return cohortCache.users.has(id);
  const users = new Set<string>();
  try {
    let bytes: Buffer;
    if (path) {
      if (statSync(path).size > 4 * 1024 * 1024)
        throw new Error('cohort too large');
      bytes = readFileSync(path);
    } else {
      const encoded = Array.from(
        { length: 16 },
        (_, i) => process.env[`NODE_MEMORY_VALUE_COHORT_GZIP_${i}`] || ''
      ).join('');
      if (!encoded || encoded.length > 1024 * 1024)
        throw new Error('invalid compressed scope');
      bytes = gunzipSync(Buffer.from(encoded, 'base64'), {
        maxOutputLength: 4 * 1024 * 1024,
      });
    }
    if (createHash('sha256').update(bytes).digest('hex') !== digest)
      throw new Error('cohort changed');
    const data = JSON.parse(bytes.toString('utf8'));
    if (
      data.version !== 1 ||
      data.activeDays !== 30 ||
      Date.parse(data.until) - Date.parse(data.since) !== 30 * 86400000 ||
      !Array.isArray(data.userIds) ||
      data.userIds.length > 100000 ||
      data.userIds.some(
        (v: unknown) => typeof v !== 'string' || !/^[a-f0-9]{24}$/.test(v)
      )
    )
      throw new Error('invalid frozen cohort');
    for (const userId of data.userIds) users.add(userId);
  } catch {
    // Missing/malformed/modified scope never enables additional accounts.
  }
  cohortCache = { key, checkedAt: Date.now(), users };
  return users.has(id);
}

/** Operational rollout only: never classifies message semantics. Empty scope is off. */
export function memoryValueModeForUser(
  userId?: unknown
): 'off' | 'shadow' | 'active' {
  const mode = process.env.NODE_MEMORY_VALUE_MODE;
  if (mode !== 'shadow' && mode !== 'active') return 'off';
  const id = String(userId || '').toLowerCase();
  if (!/^[a-f0-9]{24}$/.test(id)) return 'off';
  const users = (process.env.NODE_MEMORY_VALUE_USER_IDS || '')
    .split(',')
    .map(v => v.trim().toLowerCase());
  return users.includes(id) || frozenCohortIncludes(id) ? mode : 'off';
}
