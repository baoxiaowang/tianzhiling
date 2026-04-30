import { existsSync, readFileSync } from 'fs';

export function loadEnvFileIfExists(envPath: string): void {
  if (!existsSync(envPath)) {
    return;
  }

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

export function readStringFrom(names: string[], fallback: string): string {
  for (const name of names) {
    const raw = process.env[name];

    if (raw != null) {
      return raw;
    }
  }

  return fallback;
}

export function readNumberFrom(names: string[], fallback: number): number {
  for (const name of names) {
    const raw = process.env[name];

    if (!raw) {
      continue;
    }

    const parsed = Number(raw);

    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return fallback;
}

export function readBooleanFrom(names: string[], fallback: boolean): boolean {
  for (const name of names) {
    const raw = process.env[name];

    if (!raw) {
      continue;
    }

    return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
  }

  return fallback;
}
