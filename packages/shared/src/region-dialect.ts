/**
 * 地域→口音倾向提示（口音倾向级，非方言词级）。
 *
 * ⚠️ 使用约束（2026-11-16 复核划定，防止重蹈 A2 误用）：
 * 仅可用于「理解用户表达」（用户侧），不得用于给角色定人格/口音——
 * 用户的 region 不等于亲人的口音（主体错位已被复核否决过一次）。
 * 若将来启用，须走事件触发（用户消息出现方言词时当轮解释），
 * 不得按 region 常驻注入；启用前须重写文案（现文案含地域性格倾向，有刻板印象风险）。
 * 当前状态：休眠资产，无调用方。
 *
 * 设计分寸（2026-11-16 用户拍板）：语气像，不演方言戏——
 * 只描述称呼/语气词/句式倾向；除非用户自己使用方言词，否则一律普通话。
 */

export interface RegionDialectHintInput {
  provinceName?: string;
}

const REGION_DIALECT_AREAS: Array<[RegExp, string]> = [
  [
    /辽宁|吉林|黑龙江|东北/u,
    '称呼热乎、句式直爽，语气词偏"咋、嗯呐、唠"',
  ],
  [
    /山东|河北|河南|山西|陕西|北京|天津/u,
    '称呼直、句式爽快，语气词偏"哎、咋、嘛"',
  ],
  [
    /内蒙古|宁夏|甘肃|青海|新疆|西藏/u,
    '句式朴实简短，语气沉稳',
  ],
  [
    /四川|重庆/u,
    '句式松快、语气带笑意；"要得、啥子"仅在用户自己用时才跟着用',
  ],
  [
    /云南|贵州/u,
    '语速感慢、语气软和',
  ],
  [
    /湖南|湖北|江西/u,
    '句式干脆、语气实在',
  ],
  [
    /江苏|浙江|上海|安徽/u,
    '语气平和、表达含蓄，少用重语气词',
  ],
  [
    /广东|广西|海南/u,
    '语气缓和、少用儿化，表达务实',
  ],
  [
    /福建/u,
    '语气轻缓、表达细致',
  ],
];

/** 生成一行口音倾向提示；无省份或未命中返回空串（调用方应整段省略）。 */
export function buildRegionDialectHint(input: RegionDialectHintInput): string {
  const province = (input?.provinceName || '').trim();
  if (!province) return '';
  for (const [pattern, habit] of REGION_DIALECT_AREAS) {
    if (pattern.test(province)) {
      return `用户地区表达偏好：${province}一带口音倾向——${habit}；除非用户自己使用方言词，否则用普通话（语气像，不演方言戏）`;
    }
  }
  return '';
}
