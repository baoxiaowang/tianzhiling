export function getRevokedAccessTokenRedisKey(nonce: string): string {
  return `auth:revoked-token:${nonce}`;
}

export function getRemainingTokenTtlSeconds(
  exp: number,
  nowMilliseconds = Date.now()
): number {
  return Math.max(0, exp - Math.floor(nowMilliseconds / 1000));
}
