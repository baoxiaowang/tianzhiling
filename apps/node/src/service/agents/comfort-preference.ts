/**
 * 安慰措辞 / 死亡用词偏好。
 *
 * 只识别用户明确、长期、可执行的禁忌；不判断情绪，不生成回复。
 * 纯规则，不调用模型。
 */

export interface ComfortPreference {
  comfortAvoid: string[];
  deathWording?: {
    preferred?: string;
    avoid?: string;
    value: string;
    matched: string;
  };
}

const COMFORT_PHRASES = [
  '节哀',
  '想开点',
  '看开点',
  '放下',
  '走出来',
  '他在天上',
  '去了更好的地方',
  '投胎',
  '轮回',
  '解脱',
  '命中注定',
  '你要坚强',
  '别难过',
  '人死不能复生',
  '时间会治愈',
  '我理解你',
];

const DEATH_WORDS = /^(?:死|去世|过世|离世|走了|没了|不在了|离开)$/;

const QUESTION_OR_HYPOTHETICAL = /[?？]|(?:如果|要是|假如|万一|是否|是不是)/;
const ONE_OFF = /(?:今天|今晚|这会儿|这次|这回|暂时|先别|先不要|先不用)/;

function compact(text: string): string {
  return (text || '').replace(/\s+/g, ' ').trim();
}

function cleanWord(value: string): string {
  return value.replace(/[“”"‘’']/g, '').trim();
}

function isDeathWord(value: string): boolean {
  return DEATH_WORDS.test(cleanWord(value));
}

function buildDeathWording(
  preferred: string | undefined,
  avoid: string | undefined,
  matched: string
): ComfortPreference['deathWording'] {
  const p = preferred ? cleanWord(preferred) : undefined;
  const a = avoid ? cleanWord(avoid) : undefined;
  if (!p && !a) return undefined;
  if (!isDeathWord(p || '') && !isDeathWord(a || '')) return undefined;
  if (p && a) {
    return {
      preferred: p,
      avoid: a,
      value: `用“${p}”，不用“${a}”`,
      matched,
    };
  }
  if (p) {
    return { preferred: p, value: `用“${p}”`, matched };
  }
  return { avoid: a, value: `不要用“${a}”`, matched };
}

/**
 * 返回高置信的安慰禁忌/死亡用词；一次性、疑问、假设返回空。
 */
export function detectComfortPreference(text: string): ComfortPreference {
  const value = compact(text);
  if (!value || value.length > 400) return { comfortAvoid: [] };
  if (QUESTION_OR_HYPOTHETICAL.test(value)) return { comfortAvoid: [] };
  if (ONE_OFF.test(value)) return { comfortAvoid: [] };

  const comfortAvoid = COMFORT_PHRASES.filter(phrase => {
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(
      `(?:别|不要|不想听|不爱听|受不了|讨厌|不用)(?:再)?[^，。！？!?]{0,10}?[“"]?${escaped}[”"]?`
    ).test(value);
  }).slice(0, 8);

  const patterns: Array<{
    re: RegExp;
    preferredGroup: number;
    avoidGroup: number;
  }> = [
    {
      // 我们不说死，说走了
      re: /(?:我们|我)(?:都|一般|习惯)?(?:不|别)(?:说|叫|用)[“"]?([^”"，,。]{1,6})[”"]?(?:，|,)?(?:说|叫|用)[“"]?([^”"，,。]{1,6})[”"]?/,
      preferredGroup: 2,
      avoidGroup: 1,
    },
    {
      // 我们说走了，不说死
      re: /(?:我们|我)(?:都|一般|习惯)?(?:说|叫|用)[“"]?([^”"，,。]{1,6})[”"]?(?:，|,)?(?:不|别)(?:说|叫|用)[“"]?([^”"，,。]{1,6})[”"]?/,
      preferredGroup: 1,
      avoidGroup: 2,
    },
    {
      // 别说死，说走了
      re: /(?:别|不要)(?:再)?(?:说|用)[“"]?([^”"，,。]{1,6})[”"]?(?:这个字|这个词)?(?:，|,)?(?:说|用)[“"]?([^”"，,。]{1,6})[”"]?/,
      preferredGroup: 2,
      avoidGroup: 1,
    },
  ];

  for (const pattern of patterns) {
    const match = pattern.re.exec(value);
    if (!match) continue;
    const wording = buildDeathWording(
      match[pattern.preferredGroup],
      match[pattern.avoidGroup],
      match[0]
    );
    if (wording) return { comfortAvoid, deathWording: wording };
  }

  // 只否定、没给替代：别用“死”这个字
  const avoidOnly =
    /(?:别|不要)(?:再)?(?:说|用)[“"]?([^”"，,。]{1,6})[”"]?(?:这个字|这个词)/.exec(
      value
    );
  if (avoidOnly) {
    const wording = buildDeathWording(undefined, avoidOnly[1], avoidOnly[0]);
    if (wording) return { comfortAvoid, deathWording: wording };
  }

  return { comfortAvoid };
}
