import { readFileSync } from 'fs';
import { getHeapStatistics } from 'v8';
import { freemem } from 'os';

export function memoryBudgetSnapshot() {
  let available = freemem();
  try {
    const match = /^MemAvailable:\s+(\d+) kB$/m.exec(
      readFileSync('/proc/meminfo', 'utf8')
    );
    if (match) available = Number(match[1]) * 1024;
  } catch {
    /* Non-Linux local evaluation. */
  }
  const usage = process.memoryUsage();
  const heapLimit = getHeapStatistics().heap_size_limit;
  const minAvailable =
    Number(process.env.NODE_MEMORY_MIN_AVAILABLE_MB || 2048) * 1048576;
  const maxRss = Number(process.env.NODE_MEMORY_MAX_RSS_MB || 1792) * 1048576;
  return {
    available,
    rss: usage.rss,
    heap: usage.heapUsed,
    heapLimit,
    allowed:
      Number.isFinite(minAvailable) &&
      Number.isFinite(maxRss) &&
      minAvailable > 0 &&
      maxRss > 0 &&
      available >= minAvailable &&
      usage.rss < maxRss &&
      usage.heapUsed < heapLimit * 0.8,
  };
}
