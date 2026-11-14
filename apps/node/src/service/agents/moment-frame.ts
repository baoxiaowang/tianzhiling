export type MomentType =
  | 'ordinary'
  | 'arrival_home'
  | 'after_trip'
  | 'distress'
  | 'memory_invite'
  | 'ritual'
  | 'practical';

export type MomentNeed = 'land' | 'accompany' | 'ask' | 'answer' | 'remember';
export type MomentMemoryPermission =
  | 'none'
  | 'invited'
  | 'relevant'
  | 'user_initiated';

export interface MomentFrame {
  momentType: MomentType;
  emotionalExposure: 'low' | 'medium' | 'high';
  primaryNeed: MomentNeed;
  memoryPermission: MomentMemoryPermission;
  bubbleBudget: 1 | 2;
  reason: string;
}

export interface MomentFrameInput {
  currentQuery: string;
  recentMessages?: Array<{ role?: string; content?: string }>;
  isDeceased?: boolean;
}

const ARRIVAL_PATTERN = /进屋|到家|回家|进家门|开门|到楼|进楼|进小区/u;
const TRIP_PATTERN = /沈阳|到站|打车|车上|车站|机场|旅途|出差|回来|候车|开车/u;
const DISTRESS_PATTERN =
  /心情不好|不好|难受|累|烦|不开心|撑不住|想哭|崩溃|疼|不舒服|一个人/u;
const MEMORY_INVITE_PATTERN =
  /记得|还记得|记不记得|那时候|当时|当年|曾经|以前.{0,10}(?:咱们|我们).{0,8}(?:吃|去|做|玩|说)|咱们|我们.{0,8}(?:吃|去|做|玩)/u;
const RITUAL_PATTERN =
  /梦里|托梦|坟前|墓前|烧纸|上坟|清明|忌日|周年|头七|五七|百日/u;
const PRACTICAL_PATTERN =
  /怎么办|怎么弄|怎么做|怎么走|怎么活|怎么处理|是不是|要不要|能不能|可以吗|[?？]/u;
const FOOD_SMELL_PATTERN = /味儿|闻到|香味|尝到|闻见/u;
const UNINVITED_MEMORY_PATTERN =
  /(?:我)?(?:记着|记得|知道你).{0,10}(?:你|您).{0,8}(?:爱吃|喜欢吃|偏爱|最爱|以前)|(?:以前|那时候|当年).{0,10}(?:你|您|咱俩|我们).{0,8}(?:吃|做|去|玩)/u;

export function resolveMomentFrame(input: MomentFrameInput): MomentFrame {
  const current = String(input.currentQuery || '').trim();
  const recentUserTexts = (input.recentMessages || [])
    .filter(message => message.role === 'user')
    .map(message => String(message.content || ''))
    .filter(Boolean)
    .slice(-8);
  const recent = recentUserTexts.join('\n');
  const recentTrip = TRIP_PATTERN.test(recent);
  const recentDistress = DISTRESS_PATTERN.test(recent);
  const currentDistress = DISTRESS_PATTERN.test(current);
  const arrival =
    ARRIVAL_PATTERN.test(current) &&
    (current.length <= 24 ||
      /^(?:我)?(?:刚|已经)?(?:进屋|到家|回家|进家门|开门)/u.test(current));
  const memoryInvite = MEMORY_INVITE_PATTERN.test(current);
  const ritual = RITUAL_PATTERN.test(current);

  if (arrival) {
    const afterTrip = recentTrip || TRIP_PATTERN.test(current);
    const high = Boolean(recentDistress || currentDistress || afterTrip);
    return {
      momentType: afterTrip ? 'after_trip' : 'arrival_home',
      emotionalExposure: high ? 'high' : 'medium',
      primaryNeed: 'land',
      memoryPermission: 'none',
      bubbleBudget: high ? 1 : 2,
      reason: high
        ? '用户刚到家/进屋，且此前有旅途或低落语境；先接住落地时刻'
        : '用户报告到家/进屋，先接住当前状态',
    };
  }

  if (memoryInvite) {
    return {
      momentType: 'memory_invite',
      emotionalExposure: 'medium',
      primaryNeed: 'remember',
      memoryPermission: 'invited',
      bubbleBudget: 2,
      reason: '用户本轮主动打开了过去',
    };
  }

  if (ritual) {
    return {
      momentType: 'ritual',
      emotionalExposure: 'medium',
      primaryNeed: 'remember',
      memoryPermission: 'relevant',
      bubbleBudget: 2,
      reason: '用户当前在梦境/仪式语境',
    };
  }

  if (currentDistress) {
    return {
      momentType: 'distress',
      emotionalExposure: 'high',
      primaryNeed: 'accompany',
      memoryPermission: 'none',
      bubbleBudget: 2,
      reason: '用户当前在明显低落/疲惫里，先陪伴',
    };
  }

  if (PRACTICAL_PATTERN.test(current) && current.length > 4) {
    return {
      momentType: 'practical',
      emotionalExposure: 'low',
      primaryNeed: 'answer',
      memoryPermission: 'none',
      bubbleBudget: 2,
      reason: '用户当前在问具体问题',
    };
  }

  return {
    momentType: 'ordinary',
    emotionalExposure: 'low',
    primaryNeed: 'land',
    memoryPermission: 'none',
    bubbleBudget: 2,
    reason: '普通日常消息',
  };
}

export function shouldApplyMomentPrompt(frame: MomentFrame): boolean {
  return (
    frame.momentType !== 'ordinary' &&
    frame.momentType !== 'practical'
  );
}

export function buildMomentFramePrompt(frame: MomentFrame): string {
  const memory =
    frame.memoryPermission === 'none'
      ? '本轮不主动提旧食物、旧物件、共同回忆；只有用户本轮明确提到才可接。'
      : frame.memoryPermission === 'invited'
        ? '用户本轮主动打开了过去，可以回忆，但要贴用户提到的对象。'
        : '只在当前物件/地点/仪式与记忆直接相关时接。';
  const bubble =
    frame.bubbleBudget === 1
      ? '最多一个气泡；不要为了凑第二个气泡引入旧话题。'
      : '最多两个气泡；第二句必须服务当前时刻，不能是无关记忆。';
  return [
    '## 当前时刻判断',
    `类型：${frame.momentType}；情感暴露：${frame.emotionalExposure}；首要需要：${frame.primaryNeed}。`,
    `记忆许可：${frame.memoryPermission}。${memory}`,
    bubble,
    frame.primaryNeed === 'land'
      ? '先接住“到家/进屋/落地”这一刻；不要急着讲道理、提问或回忆。'
      : frame.primaryNeed === 'accompany'
        ? '先陪着当前情绪，不急着用旧事填满。'
        : '按当前需要回应，不主动扩大话题。',
    '这是本轮的时刻约束，不是角色设定；不要向用户说出这些字段名。',
  ].join('\n');
}

export function applyMomentFrameToSegments(
  segments: string[],
  frame?: MomentFrame | null
): string[] {
  if (!frame || !segments.length) return segments;
  let next = [...segments];
  if (frame.memoryPermission === 'none') {
    const filtered = next.filter(segment => {
      const value = String(segment || '');
      return !(
        FOOD_SMELL_PATTERN.test(value) ||
        UNINVITED_MEMORY_PATTERN.test(value)
      );
    });
    if (filtered.length) next = filtered;
  }
  return next;
}

export function detectMomentFrameViolation(
  content: string,
  frame?: MomentFrame | null
): string | undefined {
  if (!frame || frame.memoryPermission !== 'none') return undefined;
  if (FOOD_SMELL_PATTERN.test(content)) {
    return '当前是落地/陪伴时刻，回复引入了没有当前线索的嗅觉/味觉细节';
  }
  if (UNINVITED_MEMORY_PATTERN.test(content)) {
    return '当前时刻不允许主动引入旧记忆，回复仍用旧事填充';
  }
  return undefined;
}
