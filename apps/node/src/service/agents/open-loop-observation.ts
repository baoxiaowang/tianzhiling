import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import { join } from 'path';

// One bounded diagnostic round. No model calls, database writes or reply edits.
const UNTIL = Date.parse('2026-11-18T04:00:00Z');
const DIRECTORY = '/tmp/tzl-open-loop-observation-v1';
const MAX_BYTES = 256 * 1024;

export function createOpenLoopObserver(options: {
  directory: string;
  until: number;
  selectedSlots?: number;
  controlSlots?: number;
  now?: () => number;
}) {
  const now = options.now || Date.now;
  const exhausted = new Set<string>();
  let pending = 0;
  return {
    begin(key: string, selected: boolean, input: unknown) {
      try {
        const group = selected ? 'selected' : 'control';
        if (now() >= options.until || exhausted.has(group) || pending >= 2) {
          return undefined;
        }
        const hash = createHash('sha256').update(key).digest('hex');
        // 50% of selected turns, 0.5% controls; separate caps prevent starvation.
        if (parseInt(hash.slice(0, 8), 16) / 0x100000000 >= (selected ? 0.5 : 0.005)) {
          return undefined;
        }
        const inputJson = JSON.stringify(input);
        if (!inputJson || Buffer.byteLength(inputJson) > MAX_BYTES / 2) {
          return undefined;
        }
        const capturedAt = new Date(now()).toISOString();
        let finished = false;
        return (output: unknown): void => {
          if (finished) return;
          finished = true;
          try {
            if (now() >= options.until || pending >= 2) return;
            const body = JSON.stringify({
              version: 1,
              capturedAt,
              completedAt: new Date(now()).toISOString(),
              expiresAt: new Date(options.until).toISOString(),
              releaseVersion: process.env.RELEASE_VERSION || 'unknown',
              group,
              input: JSON.parse(inputJson),
              output,
              scope: 'initial context and processed reply; not transport payload or delivery proof',
            });
            if (Buffer.byteLength(body) > MAX_BYTES) return;
            pending++;
            // Persistence is detached; errors and storage saturation never reject chat.
            setImmediate(() => {
              void (async () => {
                await fs.mkdir(options.directory, { recursive: true, mode: 0o700 });
                try {
                  await fs.access(join(options.directory, 'STOP'));
                  return;
                } catch (error) {
                  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return;
                }
                const cap = selected
                  ? options.selectedSlots ?? 48
                  : options.controlSlots ?? 16;
                for (let i = 0; i < cap; i++) {
                  try {
                    await fs.writeFile(
                      join(options.directory, `${group}-${i}.json`),
                      body,
                      { flag: 'wx', mode: 0o600 }
                    );
                    return;
                  } catch (error) {
                    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') return;
                  }
                }
                exhausted.add(group);
              })().catch(() => undefined).finally(() => { pending--; });
            });
          } catch {
            // Observation is optional even when serialization fails.
          }
        };
      } catch {
        return undefined;
      }
    },
  };
}

export const openLoopObserver = createOpenLoopObserver({
  directory: DIRECTORY,
  until: UNTIL,
});
