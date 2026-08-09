export function getRevokedAccessTokenRedisKey(nonce: string): string {
  return `auth:revoked-token:${nonce}`;
}

export function getRevokedUserRedisKey(userId: string): string {
  return `auth:revoked-user:${userId}`;
}

export function getUserAccountStatusRedisKey(userId: string): string {
  return `auth:user-status:${userId}`;
}

export function getRemainingTokenTtlSeconds(
  exp: number,
  nowMilliseconds = Date.now()
): number {
  return Math.max(0, exp - Math.floor(nowMilliseconds / 1000));
}
