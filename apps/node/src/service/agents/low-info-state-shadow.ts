// 低信息轮状态注入 · 影子模式（第 0 步）
//
// 只计算"本轮若启用状态注入，会注入什么"，落审计字段；不改变任何回复行为。
// 设计依据 352 方法：程序管时机（五道门），模型管表达。
// 五道门全过才 wouldInject：低信息轮 / 开启型时机 / 候选新鲜(<3天) /
// 候选未闭合 / 频次预算(每会话每天 1 次) / 情绪平稳(低落轮不引压力状态)。
// 后续按影子抽样的合适率决定是否进入第 1 步（真实注入）。

export type LowInfoStateShadowCandidateKind = 'open_loop' | 'entity';

export interface LowInfoStateShadowCandidate {
  kind: LowInfoStateShadowCandidateKind;
  /** open_loop: task id；entity: normalizedName */
  ref: string;
  /** 候选主题摘要（仅用于审计，不进入提示词） */
  subject: string;
  /** 缺省视为 active */
  state?: string;
  /** ISO 时间；缺失视为不新鲜 */
  updatedAt?: string;
}

export interface LowInfoStateShadowInput {
  momentType?: string;
  currentQuery: string;
  /** 当日首条用户消息（含本轮） */
  isFirstUserTurnOfDay: boolean;
  /** 本会话今天已有影子注入标记 */
  alreadyInjectedToday?: boolean;
  candidates: LowInfoStateShadowCandidate[];
  now?: Date;
}

export interface LowInfoStateShadowDecision {
  wouldInject: boolean;
  candidateKind: LowInfoStateShadowCandidateKind | 'none';
  candidateRef?: string;
  gates: {
    lowInfoTurn: boolean;
    openingTurn: boolean;
    candidateFresh: boolean;
    candidateUnresolved: boolean;
    budgetOk: boolean;
    calmEmotion: boolean;
  };
  /** 审计用紧凑原因：shadow:inject|<kind>:<ref> 或 shadow:skip|<原因列表> */
  reason: string;
}

const FRESH_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

// 收尾型确认（好/嗯）不注入——那是告别不是机会；
// 开启型问候与当日首条才是状态兑现位。
const OPENING_GREETING_PATTERN =
  /^(?:早|早安|早上好|午安|下午好|晚上好|晚安|我回来了|我来了|回来了)/u;

// 情绪门槛：当轮低落时不引入压力类状态，只接情绪（与 moment-frame H3 排除集同源）。
const DISTRESS_SIGNAL_PATTERN =
  /哭|难受|累|疼|痛|不舒服|心情不好|撑不住|难过|心里堵|没睡踏实|睡得很差/u;

export function resolveLowInfoStateShadowDecision(
  input: LowInfoStateShadowInput
): LowInfoStateShadowDecision {
  const now = input.now ?? new Date();
  const query = String(input.currentQuery || '').trim();

  const lowInfoTurn = input.momentType === 'low_info_status';
  const openingTurn =
    input.isFirstUserTurnOfDay || OPENING_GREETING_PATTERN.test(query);
  const budgetOk = !input.alreadyInjectedToday;
  const calmEmotion = !DISTRESS_SIGNAL_PATTERN.test(query);

  // 未闭合 = 非终态（与 relationship-open-loop 的状态枚举对齐）。
  const terminalStates = new Set([
    'resolved',
    'dismissed',
    'superseded',
    'dormant',
  ]);
  const eligible = input.candidates
    .filter(
      candidate => !terminalStates.has(candidate.state ?? 'reported')
    )
    .map(candidate => {
      const time = candidate.updatedAt
        ? new Date(candidate.updatedAt).getTime()
        : Number.NaN;
      return { candidate, time };
    })
    .filter(
      entry =>
        !Number.isNaN(entry.time) &&
        now.getTime() - entry.time <= FRESH_WINDOW_MS &&
        now.getTime() - entry.time >= -FRESH_WINDOW_MS
    )
    .sort((a, b) => b.time - a.time);

  const picked = eligible[0]?.candidate;
  const candidateFresh = Boolean(picked);
  const candidateUnresolved = Boolean(picked);
  const wouldInject = Boolean(
    lowInfoTurn &&
      openingTurn &&
      budgetOk &&
      calmEmotion &&
      picked
  );

  const gates = {
    lowInfoTurn,
    openingTurn,
    candidateFresh,
    candidateUnresolved,
    budgetOk,
    calmEmotion,
  };

  if (wouldInject && picked) {
    return {
      wouldInject: true,
      candidateKind: picked.kind,
      candidateRef: picked.ref,
      gates,
      reason: `shadow:inject|${picked.kind}:${picked.ref}|${picked.subject.slice(0, 30)}`,
    };
  }

  const skipReasons = [
    !lowInfoTurn && 'not_low_info',
    !openingTurn && 'not_opening',
    !candidateFresh && 'no_fresh_candidate',
    !budgetOk && 'budget_used',
    !calmEmotion && 'distress_turn',
  ].filter(Boolean) as string[];

  return {
    wouldInject: false,
    candidateKind: 'none',
    gates,
    reason: `shadow:skip|${skipReasons.length ? skipReasons.join(',') : 'unknown'}`,
  };
}

/** 判断一条消息是否当轮已带影子注入标记（供同会话当天预算判定）。 */
export function isSameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
