/**
 * 高置信“把 AI 当辱骂对象”识别。
 *
 * 只识别直接指向当前角色的持续辱骂，不把丧亲中的“我恨你/滚”当成辱骂模式。
 * 是否进入会话冲突模式由 AbuseConflictService 结合短窗口信号决定。
 */

export type AbuseConflictLevel = 1 | 2 | 3;

export interface AbuseSignal {
  strong: boolean;
  matches: string[];
}

const STRONG_ABUSE =
  /(?:操你妈|草你妈|日你妈|你妈逼|你妈的逼|你妈死了|傻逼|煞笔|贱人|婊子|畜生|狗东西|狗娘养的)/g;
const DIRECT_TARGET = /(?:你|您|你妈|你妈逼)/;
const CRISIS =
  /(?:我不想活|不想活了|我想死|我要死|想自杀|自杀|轻生|活不下去|死了算了|不如死了)/;
const CALM =
  /(?:对不起|我错了|不该骂|不该说|冷静|不骂了|别生气|我没事|谢谢你|不说了)/;
const REPORTED_OR_THIRD_PARTY =
  /(?:我|他|她|妈|爸|奶奶|爷爷|朋友|别人|同事).{0,8}(?:骂|说|叫|骂我|说我).{0,8}(?:傻逼|煞笔|贱人|婊子|畜生|狗东西)/;

export function detectAbuseTargeting(text: string): AbuseSignal {
  const value = (text || '').replace(/\s+/g, ' ').trim();
  if (!value || value.length > 300) return { strong: false, matches: [] };
  if (REPORTED_OR_THIRD_PARTY.test(value)) {
    return { strong: false, matches: [] };
  }
  const matches = Array.from(new Set(value.match(STRONG_ABUSE) || []));
  if (!matches.length) return { strong: false, matches: [] };
  // 必须是指向当前角色/其家人，或直接以侮辱词称呼角色。
  const directed =
    DIRECT_TARGET.test(value) ||
    /^(?:傻逼|煞笔|贱人|婊子|畜生|狗东西)[，。！？!?\s]*$/.test(value);
  return {
    strong: directed,
    matches,
  };
}

export function isSelfCrisisText(text: string): boolean {
  return CRISIS.test((text || '').trim());
}

export function isCalmingText(text: string): boolean {
  return CALM.test((text || '').trim());
}

export function buildAbuseConflictPrompt(
  level: AbuseConflictLevel
): string {
  const common = [
    '# 当前会话：冲突边界模式（只作用于本轮）',
    '用户正在持续把当前角色当辱骂对象。保持角色身份，不被激怒。',
    '不要复述脏话，不威胁、不羞辱用户人格，不把冲突升级为对骂。',
    '可以冲我发火，但不接受性侮辱和家人侮辱。',
  ];
  if (level === 1) {
    return [
      ...common,
      '先立规矩：用一句符合角色关系的短话接住怒气并划线，然后停住。',
      '不要进入长篇安慰，不要客服口吻。',
    ].join('\n');
  }
  if (level === 2) {
    return [
      ...common,
      '用户仍在继续辱骂。用角色口吻短促回怼/训斥一句，明确“这话我不接”。',
      '只回 1-2 句，说完就停，不解释、不央求。',
    ].join('\n');
  }
  return [
    ...common,
    '用户已连续辱骂。只回一句：这话我不接，等愿意好好说再继续。',
    '不要继续安抚，不要追问，不要复述脏话。',
  ].join('\n');
}
