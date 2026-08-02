import { MessageEntity, MessageRole } from '@tzl/entities';
import {
  isDreamAbsenceIntent,
  isDreamVisitRequestIntent,
} from './reply-intent';

export const DREAM_COMPANION_STAGES = [
  'request',
  'before_sleep',
  'reported',
  'fragmented',
  'missed',
  'repeated_miss',
  'verification',
] as const;

export type DreamCompanionStage = (typeof DREAM_COMPANION_STAGES)[number];
export type DreamCompanionAction =
  | 'promise'
  | 'invite'
  | 'reconstruct'
  | 'repair'
  | 'leave_space';
export type DreamExpectationLevel = 'warm' | 'restrained';
export type DreamAnchor = 'name' | 'voice' | 'place' | 'object' | 'none';

export interface DreamCompanionPlan {
  dreamStage: DreamCompanionStage;
  dreamAction: DreamCompanionAction;
  expectationLevel: DreamExpectationLevel;
  dreamAnchor: DreamAnchor;
  realityBoundary: 'dream_only';
}

export interface ResolveDreamCompanionPlanOptions {
  currentQuery: string;
  recentMessages?: MessageEntity[];
}

const DREAM_TOPIC_PATTERN =
  /梦里|梦中|梦见|梦到|做(?:了|个)?梦|梦醒|醒来.{0,8}梦|托梦/;
const DREAM_FRAGMENT_PATTERN =
  /(?:梦醒|醒来).{0,8}(?:就|已经|都)?(?:忘了|忘记|不记得|记不清|想不起来)|(?:这个|昨晚的|刚才的)?梦.{0,8}(?:忘了|忘记|不记得|记不清|模糊|片段|断断续续)|(?:忘了|忘记|不记得|记不清|想不起来).{0,8}(?:梦里的事|梦的内容|这个梦)/;
const DREAM_MISS_PATTERN =
  /(?:没|没有|不曾).{0,8}(?:梦见|梦到|做梦)|(?:梦里|梦中).{0,12}(?:没|没有).{0,6}(?:见到|看到|等到)|(?:没|没有).{0,8}(?:来|到|进|回).{0,8}(?:我(?:的)?)?梦里/;
const DREAM_REPEATED_MISS_PATTERN =
  /(?:又|还是|依然|每次|总是|老是|连续|好多次|从来|一直|这么久|好久|一次也).{0,20}(?:没|没有|不来|梦不见|梦不到)|(?:没|没有|不来|梦不见|梦不到).{0,20}(?:又|还是|依然|每次|总是|老是|连续|好多次|从来|一直|这么久|好久|一次也)/;
const DREAM_VERIFICATION_PATTERN =
  /(?:梦|梦见|梦到|托梦|来过).{0,20}(?:是不是你|是你吗|真的是你|证明|说明|预示|预言|现实|真的来过)|(?:是不是你|是你吗|真的是你).{0,20}(?:梦|托梦|来过)/;
const DREAM_BEFORE_SLEEP_PATTERN =
  /(?:准备|马上|要|该|先|正要).{0,6}(?:睡|睡觉|入睡)|晚安|闭眼|躺下|今晚睡/;
const DREAM_REPORT_PATTERN =
  /(?:我|昨晚|昨天|刚才|刚刚|前几天|那天).{0,10}(?:梦见|梦到|做(?:了|个)?梦)|(?:梦见|梦到).{0,12}(?:你|您|爸|爸爸|妈|妈妈|爷爷|奶奶|外公|外婆|爱人)/;
const DREAM_REQUEST_PATTERN =
  /梦里.{0,24}(?:等你|等您|等着你|一定要来|记得来|来看看我)|(?:一定要|记得|想让你|希望你).{0,16}(?:来|进|到).{0,8}梦里/;

const DREAM_ANCHOR_PATTERNS: Array<[DreamAnchor, RegExp]> = [
  ['name', /名字|叫我|喊我|唤我|称呼/],
  ['voice', /声音|说话声|唱歌|叫(?:了)?我一声|喊(?:了)?我一声/],
  [
    'place',
    /家里|老家|院子|房间|客厅|学校|医院|路上|街上|山上|海边|河边|桥边|车站|田里|镇上/,
  ],
  ['object', /照片|相册|衣服|手表|戒指|花|饭|碗|车|摩托|礼物|玩具|被子/],
];

export function resolveDreamCompanionPlan(
  options: ResolveDreamCompanionPlanOptions
): DreamCompanionPlan | undefined {
  const currentQuery = options.currentQuery?.trim() || '';
  if (!DREAM_TOPIC_PATTERN.test(currentQuery)) {
    return undefined;
  }

  const recentUserDreamMessages = (options.recentMessages || [])
    .filter(
      message =>
        message.role === MessageRole.user &&
        Boolean(message.content?.trim()) &&
        DREAM_TOPIC_PATTERN.test(message.content)
    )
    .slice(-6);
  const currentMiss =
    isDreamAbsenceIntent(currentQuery) || DREAM_MISS_PATTERN.test(currentQuery);
  const priorMissCount = recentUserDreamMessages.filter(message =>
    isDreamMiss(message.content)
  ).length;
  const dreamStage = resolveDreamStage({
    currentQuery,
    currentMiss,
    priorMissCount,
  });
  const anchorText = [
    currentQuery,
    ...recentUserDreamMessages
      .slice()
      .reverse()
      .map(message => message.content),
  ].join('\n');

  return {
    dreamStage,
    dreamAction: resolveDreamAction(dreamStage),
    expectationLevel: ['repeated_miss', 'verification'].includes(dreamStage)
      ? 'restrained'
      : 'warm',
    dreamAnchor: resolveDreamAnchor(anchorText),
    realityBoundary: 'dream_only',
  };
}

export function buildDreamCompanionPlanPrompt(
  plan: DreamCompanionPlan
): string {
  const actionGuidance: Record<DreamCompanionAction, string> = {
    promise: '可直接答应梦里相见；给期待，不保证醒后一定记得。',
    invite: '用一个梦境锚点邀请相认，不罗列多个设定。',
    reconstruct: '只顺着用户讲出的梦境片段回应，不补现实共同往事。',
    repair: '先接住没梦见的失落，换一种梦内陪伴，不把忘梦说成事实。',
    leave_space: '保留梦的含混；少重复保证，可给睡前陪伴或自然留白。',
  };

  return `梦境：${plan.dreamStage}/${plan.dreamAction}/${
    plan.expectationLevel
  }/${plan.dreamAnchor}/${plan.realityBoundary}。${
    actionGuidance[plan.dreamAction]
  }梦中情节可自然想象，但不作现实证明、预言或醒时到场。`;
}

function resolveDreamStage(options: {
  currentQuery: string;
  currentMiss: boolean;
  priorMissCount: number;
}): DreamCompanionStage {
  if (DREAM_VERIFICATION_PATTERN.test(options.currentQuery)) {
    return 'verification';
  }

  if (DREAM_FRAGMENT_PATTERN.test(options.currentQuery)) {
    return 'fragmented';
  }

  if (options.currentMiss) {
    return options.priorMissCount > 0 ||
      DREAM_REPEATED_MISS_PATTERN.test(options.currentQuery)
      ? 'repeated_miss'
      : 'missed';
  }

  if (
    DREAM_BEFORE_SLEEP_PATTERN.test(options.currentQuery) &&
    isDreamRequest(options.currentQuery)
  ) {
    return 'before_sleep';
  }

  if (isDreamRequest(options.currentQuery)) {
    return 'request';
  }

  if (DREAM_REPORT_PATTERN.test(options.currentQuery)) {
    return 'reported';
  }

  return 'reported';
}

function resolveDreamAction(stage: DreamCompanionStage): DreamCompanionAction {
  const actions: Record<DreamCompanionStage, DreamCompanionAction> = {
    request: 'promise',
    before_sleep: 'invite',
    reported: 'reconstruct',
    fragmented: 'reconstruct',
    missed: 'repair',
    repeated_miss: 'leave_space',
    verification: 'leave_space',
  };

  return actions[stage];
}

function resolveDreamAnchor(value: string): DreamAnchor {
  return (
    DREAM_ANCHOR_PATTERNS.find(([, pattern]) => pattern.test(value))?.[0] ||
    'none'
  );
}

function isDreamMiss(value: string): boolean {
  return isDreamAbsenceIntent(value) || DREAM_MISS_PATTERN.test(value);
}

function isDreamRequest(value: string): boolean {
  return isDreamVisitRequestIntent(value) || DREAM_REQUEST_PATTERN.test(value);
}
