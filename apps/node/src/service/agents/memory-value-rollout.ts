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
  return users.includes(id) ? mode : 'off';
}
