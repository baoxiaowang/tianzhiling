import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

const PROJECT_ROOT = resolve(__dirname, '../../../..');
const APP_ROOT = resolve(__dirname, '../..');

export function loadEnvFiles(): void {
  const envPaths = [
    resolve(PROJECT_ROOT, '.env'),
    resolve(APP_ROOT, '.env'),
    resolve(process.cwd(), '.env'),
  ];
  const seen = new Set<string>();

  for (const envPath of envPaths) {
    if (seen.has(envPath) || !existsSync(envPath)) {
      continue;
    }

    seen.add(envPath);
    loadEnvFile(envPath);
  }
}

function loadEnvFile(envPath: string): void {
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

    process.env[key] = stripOuterQuotes(value);
  }
}

function stripOuterQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}
