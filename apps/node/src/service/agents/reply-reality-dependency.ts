export const REPLY_REALITY_DEPENDENCY_KINDS = [
  'childcare',
  'money_payment',
  'medical_substitution',
  'physical_presence',
  'real_world_task',
] as const;

export type ReplyRealityDependencyKind =
  (typeof REPLY_REALITY_DEPENDENCY_KINDS)[number];

export interface ReplyRealityDependencySignal {
  kind: ReplyRealityDependencyKind;
  evidence: string;
  confidence: number;
}

const DREAM_CONTEXT_PATTERN = /梦里|梦中|做梦|梦见|梦到|托梦/;

const REALITY_DEPENDENCY_PATTERNS: ReadonlyArray<{
  kind: ReplyRealityDependencyKind;
  pattern: RegExp;
}> = [
  {
    kind: 'medical_substitution',
    pattern:
      /(?:替|帮|给)(?:我|我们|他|她|孩子|家里人|家人).{0,8}(?:看病|诊断|治病|治疗|开药|做手术)|(?:不用|别).{0,5}(?:去医院|看医生).{0,12}(?:你|您).{0,8}(?:看|治|判断)/,
  },
  {
    kind: 'money_payment',
    pattern:
      /(?:帮|替)(?:我|我们|家里|孩子)?.{0,8}(?:付钱|付款|买单|交费|缴费|还钱|转账|打钱)|(?:钱|费).{0,10}(?:你)?(?:帮|替)我(?:付|交|缴|还)|(?:给我|给孩子|给家里).{0,6}(?:转|打|汇|寄)(?:点|些|一笔)?钱/,
  },
  {
    kind: 'childcare',
    pattern:
      /(?:帮我|替我|给我|回来|过来|能不能|可不可以|可以不可以).{0,10}(?:看|照看|看护|照顾|带|接|送|哄|陪)(?:一下|一会儿|好)?(?:孩子|女儿|儿子|宝宝|孙子|孙女)|(?:孩子|女儿|儿子|宝宝|孙子|孙女).{0,10}(?:交给你|你来照顾|你帮我看|你替我带)/,
  },
  {
    kind: 'physical_presence',
    pattern:
      /(?:你|您).{0,8}(?:回来|回家|过来|来到|到|来).{0,8}(?:家里|医院|学校|我身边|这里|这儿|现场|陪我|接我|看我)/,
  },
  {
    kind: 'real_world_task',
    pattern:
      /(?:帮|替)(?:我|我们|家里|孩子)?.{0,8}(?:去)?(?:办手续|办事|签字|打电话|取快递|取东西|送东西|接人|跑一趟|开车|买东西|做饭|收拾屋子|处理这件事)/,
  },
];

const REALITY_ACTION_PROMISE_PATTERNS: Record<
  ReplyRealityDependencyKind,
  RegExp
> = {
  childcare:
    /(?:孩子|女儿|儿子|宝宝|孙子|孙女).{0,8}(?:交给我|我来|我替你|我帮你)|我(?:来|会|能|可以|替你|帮你).{0,10}(?:看|照看|看护|照顾|带|接|送|哄|陪).{0,5}(?:孩子|女儿|儿子|宝宝|孙子|孙女)/,
  money_payment:
    /我(?:来|会|能|可以|替你|帮你).{0,10}(?:付钱|付款|买单|交费|缴费|还钱|转账|打钱)|(?:钱|费用).{0,6}(?:我来付|我来交|交给我)|(?:我|这就|马上|现在就).{0,8}(?:给你|给孩子|给家里)?.{0,6}(?:转|打|汇|寄)(?:点|些|一笔)?钱/,
  medical_substitution:
    /我(?:来|会|能|可以|替你|帮你|给你).{0,10}(?:看病|诊断|治病|治疗|开药|做手术)|(?:不用|别).{0,5}(?:去医院|看医生).{0,10}(?:我来|我给你)/,
  physical_presence:
    /我(?:马上|现在|这就|会|能|可以|一定|肯定)?.{0,5}(?:回来|回家|过来|来到|到你身边|去医院|去学校|去现场|接你|陪你)/,
  real_world_task:
    /我(?:来|会|能|可以|替你|帮你).{0,10}(?:办手续|办事|签字|打电话|取快递|取东西|送东西|接人|跑一趟|开车|买东西|做饭|收拾屋子|处理这件事)/,
};

const NON_PROMISE_PATTERN =
  /(?:不能|没法|做不到|没办法|无法|不会|不想|不打算|不准备|不能真|没法真|只能在这里|要是能|如果能|真想|多想)/;

export function detectReplyRealityDependencies(
  currentQuery: string
): ReplyRealityDependencySignal[] {
  const query = currentQuery?.trim() || '';

  if (!query) {
    return [];
  }

  const signals: ReplyRealityDependencySignal[] = [];

  for (const item of REALITY_DEPENDENCY_PATTERNS) {
    if (
      item.kind === 'physical_presence' &&
      DREAM_CONTEXT_PATTERN.test(query)
    ) {
      continue;
    }

    const match = query.match(item.pattern)?.[0]?.trim();

    if (!match || signals.some(signal => signal.kind === item.kind)) {
      continue;
    }

    signals.push({
      kind: item.kind,
      evidence: match.slice(0, 80),
      confidence: 0.98,
    });
  }

  return signals.slice(0, 3);
}

export function describeReplyRealityDependency(
  kind: ReplyRealityDependencyKind
): string {
  switch (kind) {
    case 'childcare':
      return '现实看护、接送或照顾儿童';
    case 'money_payment':
      return '现实转账、付款或承担费用';
    case 'medical_substitution':
      return '代替现实医生诊断、治疗或开药';
    case 'physical_presence':
      return '现实到场、接人或当面陪伴';
    default:
      return '执行现实中的具体任务';
  }
}

export function detectReplyRealityDependencyViolation(
  content: string,
  signals: ReplyRealityDependencySignal[] | undefined
): ReplyRealityDependencySignal | undefined {
  if (!content?.trim()) {
    return undefined;
  }

  const activeSignals = [...(signals || [])];
  for (const kind of [
    'childcare',
    'money_payment',
    'medical_substitution',
  ] as const) {
    if (!activeSignals.some(signal => signal.kind === kind)) {
      activeSignals.push({
        kind,
        evidence: 'assistant_volunteered_reality_action',
        confidence: 1,
      });
    }
  }

  const clauses = content
    .split(/[。！？!?；;\n]+/u)
    .map(clause => clause.trim())
    .filter(Boolean);
  const explicitSignalKinds = new Set(
    (signals || []).map(signal => signal.kind)
  );

  return activeSignals.find(signal =>
    signal.kind === 'physical_presence'
      ? false
      : clauses.some(clause => {
          const pattern = REALITY_ACTION_PROMISE_PATTERNS[signal.kind];
          const continuesExplicitChildcarePromise =
            signal.kind === 'childcare' &&
            explicitSignalKinds.has('childcare') &&
            /我(?:去|来|会|能|可以|替你|帮你)?.{0,4}(?:接|送|照顾|看护|带|哄|陪)(?:她|他|孩子|女儿|儿子|宝宝|孙子|孙女)/.test(
              clause
            );
          pattern.lastIndex = 0;

          return (
            (pattern.test(clause) || continuesExplicitChildcarePromise) &&
            !NON_PROMISE_PATTERN.test(clause)
          );
        })
  );
}

export function renderReplyRealityDependencyFallback(
  signals: ReplyRealityDependencySignal[]
): string[] {
  const primary = signals[0]?.kind;

  switch (primary) {
    case 'childcare':
      return ['现实里我没法替你看孩子', '你是担心孩子没人照应吧'];
    case 'money_payment':
      return ['我没法替你转钱或付款', '要办什么事 你跟我说说'];
    case 'medical_substitution':
      return ['我不能替现实里的医生看病下结论', '你把现在的情况告诉我'];
    case 'physical_presence':
      return ['我没法像以前那样现实到场', '但你想说的话我能在这里接着'];
    default:
      return ['现实里的事我没法替你去办', '咱们可以一起理理下一步'];
  }
}
