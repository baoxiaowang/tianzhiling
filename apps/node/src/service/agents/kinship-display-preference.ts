/**
 * 家庭称谓的“显示偏好”规则。
 *
 * 只判断用户是不是在要求 AI 改口，以及旧叫法/新叫法是什么；
 * 具体是哪个人物由 UserIdentityMemoryService 解析，避免在这里猜。
 */

export type KinshipDisplayAction = 'display' | 'avoid';

export interface KinshipDisplaySignal {
  action: KinshipDisplayAction;
  oldTerm?: string;
  newTerm?: string;
  matched: string;
}

const ONE_OFF = /(?:今天|今晚|这会儿|这次|这回|暂时|先别|先不要|先不用)/;
const QUESTION_OR_HYPOTHETICAL = /[?？]|(?:如果|要是|假如|万一|是否|是不是)/;

function compact(text: string): string {
  return (text || '').replace(/\s+/g, ' ').trim();
}

function cleanTerm(value: string): string | undefined {
  const term = value
    .replace(/[“”"‘’']/g, '')
    .replace(/^(?:他|她|你|您)/, '')
    .replace(/(?:了|的)$/, '')
    .trim();
  if (!term || term.length > 8) return undefined;
  if (/^(?:我|你|您|他|她)/.test(term)) return undefined;
  return term;
}

/**
 * 返回改口信号；关系矫正（“他不是我外公，是我爷爷”）不在这里处理。
 */
export function detectKinshipDisplayPreference(
  text: string
): KinshipDisplaySignal | undefined {
  const value = compact(text);
  if (!value || value.length > 400) return undefined;
  if (QUESTION_OR_HYPOTHETICAL.test(value)) return undefined;
  if (ONE_OFF.test(value)) return undefined;
  // “他不是我外公”是关系矫正；“不是叫姥爷”才是叫法矫正。
  if (/(?:他|她|你)不是/.test(value) && !/不是叫/.test(value)) {
    return undefined;
  }

  // 别叫姥爷，叫外公 / 不要叫外公，叫姥爷
  const replace = /(?:别|不要)(?:再)?叫(?:他|她)?[“"]?([^”"，,。]{1,8})[”"]?[，,](?:叫|称呼)[“"]?([^”"，,。]{1,8})[”"]?/.exec(
    value
  );
  if (replace) {
    const oldTerm = cleanTerm(replace[1]);
    const newTerm = cleanTerm(replace[2]);
    if (oldTerm && newTerm) {
      return {
        action: 'display',
        oldTerm,
        newTerm,
        matched: replace[0],
      };
    }
  }

  // 以后叫他外公 / 以后都称呼她家家
  const future = /(?:以后|往后|之后)(?:都)?(?:叫|称呼)(?:他|她)[“"]?([^”"，,。]{1,8})[”"]?/.exec(
    value
  );
  if (future) {
    const newTerm = cleanTerm(future[1]);
    if (newTerm) {
      return { action: 'display', newTerm, matched: future[0] };
    }
  }

  // 你也跟着叫家家 / 你也叫家家 / 你就叫家家
  const follow = /(?:你)?(?:也|就)?(?:跟着|跟着我)(?:叫|称呼)[“"]?([^”"，,。]{1,8})[”"]?/.exec(
    value
  ) || /(?:你)(?:也|就)(?:叫|称呼)[“"]?([^”"，,。]{1,8})[”"]?/.exec(value);
  if (follow) {
    const newTerm = cleanTerm(follow[1]);
    if (newTerm) {
      return { action: 'display', newTerm, matched: follow[0] };
    }
  }

  // 别叫姥爷了 / 不要叫外公了（只否定，没有替代）
  const avoid = /(?:别|不要)(?:再)?叫(?:他|她)?[“"]?([^”"，,。]{1,8})[”"]?(?:了)?/.exec(
    value
  );
  if (avoid) {
    const oldTerm = cleanTerm(avoid[1]);
    if (oldTerm && (avoid[0].includes('他') || avoid[0].includes('她') || oldTerm.length >= 2)) {
      return { action: 'avoid', oldTerm, matched: avoid[0] };
    }
  }

  return undefined;
}
