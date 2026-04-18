import { AppError } from './errors';

export function truncateForLog(value: string, maxLength: number = 240): string {
  const normalized = value.trim();

  if (!normalized) {
    return '<empty>';
  }

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength)}...`;
}

export function describeErrorForLog(error: unknown): string {
  if (error instanceof AppError) {
    return `code=${error.code} status=${error.status} message=${error.message}`;
  }

  if (error instanceof Error) {
    const details: string[] = [];
    const status = (error as { status?: unknown }).status;
    const code = (error as { code?: unknown }).code;
    const type = (error as { type?: unknown }).type;
    const cause = (error as { cause?: unknown }).cause;

    if (typeof status === 'number') {
      details.push(`status=${status}`);
    }

    if (typeof code === 'string' && code) {
      details.push(`code=${code}`);
    }

    if (typeof type === 'string' && type) {
      details.push(`type=${type}`);
    }

    if (typeof cause === 'string' && cause) {
      details.push(`cause=${cause}`);
    }

    details.push(`message=${error.message}`);
    return details.join(' ');
  }

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}
