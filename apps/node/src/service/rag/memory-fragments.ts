/**
 * 有界连续对话片段：把检索命中扩成“以命中为中心”的短片段，供上下文构造作为候选材料使用。
 * 程序只按原始顺序提供上下文，不判断是否同一事件，也不递归扩到整段历史。
 * 时间线由调用方保证：同一用户、已按截止过滤、同一会话。
 */
// ---------------------------------------------------------------- 有界连续对话片段
export interface TimelineMessage { sourceMessageId: string; role: string; occurredAt: string; text: string }
export interface HitRef { sourceMessageId: string; score?: number | null }
export interface FragmentBuildOptions {
  radius?: number;          // 命中前后各取几条（默认 2）
  maxMessages?: number;     // 单个片段最多几条（默认 5）
  maxTokens?: number;       // 单个片段字符估算上限（默认 300 估算 token）
  maxFragments?: number;    // 最多几个片段（默认 3）
  maxTotalMessages?: number; // 全部片段合计消息上限（默认 12）
  maxTotalTokens?: number;   // 全部片段合计估算上限（默认 600）
  maxGapMs?: number;        // 片段内相邻消息最大时间间隔（默认 6h，避免跨明显断点）
}
export interface FragmentResult {
  messages: TimelineMessage[];
  hitIds: string[];
  hits: Array<{ sourceMessageId: string; rank: number }>;
  truncated: boolean;
  droppedByCount: number;
  droppedByTokens: number;
  hitCovered: boolean;
}
export interface FragmentHitLedger { sourceMessageId: string; rank: number; fragmentIndex: number | null; reason?: string }
export interface FragmentPack {
  fragments: FragmentResult[];
  notLoaded: Array<{ hitIds: string[]; reason: string }>;
  hits: FragmentHitLedger[];
  method: string;
}
/** 字符估算（不是精确 token 计数）。 */
export const estimateTokensByChars = (text: string) => Math.ceil((text || '').length / 1.5) + 4;

function windowTouches(a: { start: number; end: number }, b: { start: number; end: number }) {
  return b.start <= a.end + 1 && a.start <= b.end + 1;
}
function buildWindow(centerPos: number, timeline: TimelineMessage[], radius: number, maxMessages: number, maxTokens: number) {
  let start = Math.max(0, centerPos - radius);
  let end = Math.min(timeline.length - 1, centerPos + radius);
  let droppedByCount = 0;
  // 裁剪时始终保留命中位置（先裁离命中远的一侧）
  while (end - start + 1 > maxMessages) {
    if (centerPos - start >= end - centerPos) start++; else end--;
    droppedByCount++;
  }
  const kept: TimelineMessage[] = []; const seen = new Set<string>();
  let tokens = 0; let droppedByTokens = 0;
  for (let i = start; i <= end; i++) {
    const m = timeline[i];
    if (seen.has(m.sourceMessageId)) continue;
    const t = estimateTokensByChars(m.text);
    if (tokens + t > maxTokens) { droppedByTokens++; continue; }
    seen.add(m.sourceMessageId); tokens += t; kept.push(m);
  }
  return { start, end, kept, tokens, droppedByCount, droppedByTokens, seen };
}

/**
 * 按检索排名依次处理命中：每个命中先生成“以命中为中心”的有界片段，再做去重与总预算装载。
 * 只有“合并后仍保留双方命中且不超预算”的重叠片段才合并；否则保留分开窗口。
 * 不会先把多个窗口串成大区间再从中间截，避免原命中消失。排名只用于分配有限空间。
 * 时间线由调用方保证：同一用户、已按截止过滤、同一会话。
 */
export function buildContiguousFragments(
  hits: Array<HitRef | string>,
  timeline: TimelineMessage[],
  opts: FragmentBuildOptions = {}
): FragmentPack {
  const radius = Math.max(0, opts.radius ?? 2);
  const maxMessages = Math.max(1, opts.maxMessages ?? 5);
  const maxTokens = Math.max(1, opts.maxTokens ?? 300);
  const maxFragments = Math.max(1, opts.maxFragments ?? 3);
  const maxTotalMessages = Math.max(1, opts.maxTotalMessages ?? 12);
  const maxTotalTokens = Math.max(1, opts.maxTotalTokens ?? 600);
  const pos = new Map<string, number>();
  timeline.forEach((m, i) => { if (!pos.has(m.sourceMessageId)) pos.set(m.sourceMessageId, i); });
  const ranked: Array<{ id: string; rank: number }> = [];
  hits.forEach((h, idx) => {
    const id = typeof h === 'string' ? h : String((h as HitRef).sourceMessageId || '');
    if (!id || ranked.some(r => r.id === id)) return;
    ranked.push({ id, rank: idx });
  });
  const ledger: FragmentHitLedger[] = ranked.map(r => ({ sourceMessageId: r.id, rank: r.rank, fragmentIndex: null }));
  const fragments: Array<{ start: number; end: number; hitIds: string[]; kept: TimelineMessage[]; tokens: number; droppedByCount: number; droppedByTokens: number }> = [];
  const notLoaded: Array<{ hitIds: string[]; reason: string }> = [];

  for (const hit of ranked) {
    const center = pos.get(hit.id);
    const entry = ledger[hit.rank === undefined ? 0 : ledger.findIndex(l => l.sourceMessageId === hit.id)];
    if (center === undefined) { if (entry) entry.reason = 'not_in_timeline'; continue; }
    const win = buildWindow(center, timeline, radius, maxMessages, maxTokens);
    // 只在“合并后仍保留双方命中且不超预算”时合并
    let merged = false;
    for (let i = 0; i < fragments.length; i++) {
      const f = fragments[i];
      if (!windowTouches(f, win)) continue;
      const unionStart = Math.min(f.start, win.start); const unionEnd = Math.max(f.end, win.end);
      // 合并后的消息集合 = 两个片段各自“已保留集合”的并集（不是重新按区间切），
      // 这样之前被条数/长度上限截断的消息不会被合并重新带回来；并对合并结果重新计量。
      const unionKept: TimelineMessage[] = []; const seen = new Set<string>();
      for (const m of [...f.kept, ...win.kept]) {
        if (!seen.has(m.sourceMessageId)) { seen.add(m.sourceMessageId); unionKept.push(m); }
      }
      unionKept.sort((a, b) => (pos.get(a.sourceMessageId) ?? 0) - (pos.get(b.sourceMessageId) ?? 0));
      const unionTok = unionKept.reduce((n, m) => n + estimateTokensByChars(m.text), 0);
      if (unionKept.length > maxMessages || unionTok > maxTokens) continue;
      const keepsAll = [...f.hitIds, hit.id].every(id => seen.has(id));
      if (!keepsAll) continue;
      fragments[i] = { start: unionStart, end: unionEnd, hitIds: [...new Set([...f.hitIds, hit.id])], kept: unionKept, tokens: unionTok, droppedByCount: f.droppedByCount + win.droppedByCount, droppedByTokens: f.droppedByTokens + win.droppedByTokens };
      const le = ledger.find(l => l.sourceMessageId === hit.id); if (le) le.fragmentIndex = i;
      merged = true; break;
    }
    if (!merged) {
      fragments.push({ start: win.start, end: win.end, hitIds: [hit.id], kept: win.kept, tokens: win.tokens, droppedByCount: win.droppedByCount, droppedByTokens: win.droppedByTokens });
      const le = ledger.find(l => l.sourceMessageId === hit.id); if (le) le.fragmentIndex = fragments.length - 1;
    }
  }

  // 按创建顺序（即排名顺序）装入总预算；装不下的整段记录为未装入，不串窗口。
  const packed: FragmentResult[] = [];
  const indexMap: Record<number, number> = {};
  let totalMessages = 0; let totalTokens = 0;
  for (let i = 0; i < fragments.length; i++) {
    const f = fragments[i];
    const overFragments = packed.length >= maxFragments;
    const overMessages = totalMessages + f.kept.length > maxTotalMessages;
    const overTokens = totalTokens + f.tokens > maxTotalTokens;
    if (overFragments || overMessages || overTokens) {
      notLoaded.push({ hitIds: f.hitIds, reason: overFragments ? 'max_fragments' : overMessages ? 'total_messages' : 'total_tokens' });
      continue;
    }
    indexMap[i] = packed.length;
    totalMessages += f.kept.length; totalTokens += f.tokens;
    packed.push({ messages: f.kept, hitIds: f.hitIds, hits: f.hitIds.map(id => ({ sourceMessageId: id, rank: ledger.find(l => l.sourceMessageId === id)?.rank ?? -1 })), truncated: f.droppedByCount > 0 || f.droppedByTokens > 0, droppedByCount: f.droppedByCount, droppedByTokens: f.droppedByTokens, hitCovered: f.hitIds.every(id => f.kept.some(m => m.sourceMessageId === id)) });
  }
  for (const l of ledger) {
    if (l.fragmentIndex === null) continue;
    const mapped = indexMap[l.fragmentIndex];
    if (mapped === undefined) { l.fragmentIndex = null; if (!l.reason) l.reason = 'not_loaded_budget'; continue; }
    l.fragmentIndex = mapped;
    // 片段装入了，但命中本身被条数/长度上限裁掉 → 明确记录，不假装命中还在
    if (!packed[mapped].messages.some(m => m.sourceMessageId === l.sourceMessageId)) l.reason = 'hit_dropped_by_limit';
  }
  return { fragments: packed, notLoaded, hits: ledger, method: 'rank_order_per_hit_window;conditional_merge;char_estimate_not_exact_tokens' };
}

