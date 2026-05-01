import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';

export function hashAdminPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');

  return `scrypt$${salt}$${hash}`;
}

export function verifyAdminPassword(
  plainPassword: string,
  storedPassword: string
): boolean {
  if (!storedPassword) {
    return false;
  }

  if (storedPassword.startsWith('scrypt$')) {
    const [, salt, expectedHash] = storedPassword.split('$');

    if (!salt || !expectedHash) {
      return false;
    }

    return safeCompareText(
      scryptSync(plainPassword, salt, 64).toString('hex'),
      expectedHash
    );
  }

  return safeCompareText(plainPassword, storedPassword);
}

function safeCompareText(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}
