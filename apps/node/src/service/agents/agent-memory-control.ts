export interface AgentMemoryControlResult {
  action: 'remember' | 'forget';
  target: string;
  affectedCount: number;
  succeeded: boolean;
}

const FORGET_MEMORY_PATTERN =
  /^(?:(?:请|麻烦你)?(?:帮我|给我)?(?:忘掉|删掉|删除|不要再记|别再记|不要记|别记|不要再提|别再提)|(?:请|麻烦你)(?:帮我|给我)?忘记|(?:请|麻烦你)?(?:你)?把[^，。！？!?]{1,48}(?:忘掉|忘记|删掉|删除|不要再记|别再记|不要记|别记|不要再提|别再提)|(?:(?:刚才|刚刚|之前|前面)(?:说的|聊的)?|这|那)(?:这|那)?(?:件事|回事|条记忆|个信息|个事情)[^。！？!?]{0,24}(?:忘掉|忘记|删掉|删除|不要再记|别再记|不要记|别记|不要再提|别再提))/;

const FORGET_COMMAND_PATTERN =
  /^(?:请|麻烦你|你|帮我|给我)?(?:把)?(?:这条|这个|那条|那个|关于)?\s*/;

const FORGET_VERB_PATTERN =
  /(?:这条|这个|那条|那个)?(?:记忆|信息|事情|事)?(?:给我)?(?:忘掉|忘记|删掉|删除|不要再记|别再记|不要记|别记|不要再提|别再提)(?:了|吧)?|(?:忘掉|忘记|删掉|删除|不要再记|别再记|不要记|别记|不要再提|别再提)(?:这条|这个|那条|那个)?(?:记忆|信息|事情|事)?(?:了|吧)?/g;

const DEICTIC_FORGET_MEMORY_PATTERN =
  /^(?:(?:刚才|刚刚|之前|前面)(?:说的|聊的)?|这|那)(?:这|那)?(?:件事|回事|条记忆|个信息|个事情)/;

export function isForgetMemoryRequest(value: string): boolean {
  return FORGET_MEMORY_PATTERN.test(normalizeMemoryControlText(value));
}

export function isDeicticForgetMemoryRequest(value: string): boolean {
  const normalized = normalizeMemoryControlText(value);

  return (
    isForgetMemoryRequest(normalized) &&
    DEICTIC_FORGET_MEMORY_PATTERN.test(normalized)
  );
}

export function extractForgetMemoryTarget(value: string): string {
  const normalized = normalizeMemoryControlText(value);

  if (!isForgetMemoryRequest(normalized)) {
    return '';
  }

  if (isDeicticForgetMemoryRequest(normalized)) {
    return '刚才那件事';
  }

  return normalized
    .replace(FORGET_COMMAND_PATTERN, '')
    .replace(FORGET_VERB_PATTERN, '')
    .replace(/(?:这件事|这回事|这一点|这条记忆|这个信息)$/g, '')
    .replace(/^关于/, '')
    .replace(/的(?:记忆|信息)$/g, '')
    .replace(/^[：:，,\s]+|[。！？!?，,\s]+$/g, '')
    .trim()
    .slice(0, 120);
}

export function isExplicitRememberRequest(value: string): boolean {
  const normalized = normalizeMemoryControlText(value);

  if (
    /记住.{0,8}(?:我爱你|我想你|爱你|想你)(?:[。！？!?，,\s]|$)/.test(
      normalized
    ) &&
    !/(?:我是|我叫|你有|我们有|咱们有|排行|上面有|下面有|这件事|这个事实)/.test(
      normalized
    )
  ) {
    return false;
  }

  return /(?:^|[，,。；;\s])(?:(?:妈妈|妈|爸爸|爸|爷爷|奶奶|姥姥|姥爷|外婆|外公|老公|老婆)[呀啊呢哦嘛]*[，,\s]*)?(?:请|你|一定要|帮我|给我)?记住(?:了|啦)?(?:[：:，,\s]|$)|以后(?:要)?记得(?:[：:，,\s]|$)/.test(
    normalized
  );
}

export function shouldArchiveMemoryValue(
  target: string,
  memoryValue: string
): boolean {
  const normalizedTarget = normalizeComparableText(target);
  const normalizedMemory = normalizeComparableText(memoryValue);

  if (!normalizedTarget || !normalizedMemory) {
    return false;
  }

  if (
    normalizedMemory.includes(normalizedTarget) ||
    normalizedTarget.includes(normalizedMemory)
  ) {
    return true;
  }

  const targetTokens = buildChineseBigrams(normalizedTarget);
  const memoryTokens = new Set(buildChineseBigrams(normalizedMemory));
  const overlap = targetTokens.filter(token => memoryTokens.has(token)).length;

  return overlap >= Math.min(3, Math.max(1, targetTokens.length));
}

function buildChineseBigrams(value: string): string[] {
  const tokens = new Set<string>();

  for (let index = 0; index < value.length - 1; index += 1) {
    tokens.add(value.slice(index, index + 2));
  }

  return [...tokens];
}

function normalizeComparableText(value: string): string {
  return value
    .toLowerCase()
    .replace(/失眠/g, '睡眠不好')
    .replace(/当前角色|当前智能体|用户|禁止说|不要主动提|用户纠正/g, '')
    .replace(/[^\u4e00-\u9fffa-z0-9]/g, '');
}

function normalizeMemoryControlText(value: string): string {
  return value?.replace(/\s+/g, ' ').trim() || '';
}
