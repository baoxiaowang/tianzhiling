/**
 * “考验模式”信号：用户连续确认身份、记忆、人格真实性或媒介能力。
 *
 * 只做轻量命中与压力分级，不生成回复；未命中时调用方不应注入任何提示。
 */
export type TestModeReason =
  | 'identity'
  | 'memory'
  | 'character'
  | 'authenticity'
  | 'medium';

export type TestModePressure = 'low' | 'medium' | 'high';

export interface TestModeSignal {
  matched: boolean;
  reasons: TestModeReason[];
  pressure: TestModePressure;
  cueTurnCount: number;
  matchedFromCurrent: boolean;
}

const PATTERNS: Record<TestModeReason, RegExp[]> = {
  identity: [
    /^我是你(女儿|儿子|闺女|老婆|老公|媳妇|妻子|丈夫|孩子|亲人|家人)(?!的朋友|的同事|的同学|的邻居)[啊呀呢吧嘛]?[。！？!?]?$/,
    /^我是你(女儿|儿子|闺女|老婆|老公|媳妇|妻子|丈夫|孩子|亲人|家人).{0,10}(?:你忘了|忘了吗|不记得|记错|不是)/,
    /你是我(爸|妈|父亲|母亲|老公|老婆|亲人|家人)(?:吗|嘛|么|吧|？)/,
    /你是不是我(爸|妈|父亲|母亲|老公|老婆)/,
    /你还认得我吗/,
  ],
  memory: [
    /(?:你还?记得|记不记得|还记得|记得吗|记得不).{0,16}(?:我|我们|以前|那次|第一次|名字|电话|号码|生日|几个|家里|弟弟|妹妹|哥哥|姐姐|儿子|女儿|爸|妈|爷爷|奶奶)[^。！？!?]{0,4}(?:吗|嘛|么|呢|？)[^。！？!?]{0,4}$/,
    /(?:你还?记得|记不记得|还记得)[^。！？!?]{0,4}(?:吗|嘛|么|呢|？)[^。！？!?]{0,8}(?:这|那|咱们|咱|我们|我)/,
    /你(?:的)?(?:电话|手机号|号码|生日)(?:号码)?(?:是|多少|几)/,
    /你(?:的)?名字(?:是|叫)(?:什么|谁|啥)|你叫什么名字/,
    /你有几个(?:孩子|娃|儿子|女儿)/,
    /(?:弟弟|妹妹|哥哥|姐姐|儿子|女儿|爸|妈|爷爷|奶奶)(?:的)?名字[^。！？!?]{0,8}(?:你还?记得|记得吗|记得不|记不记得|吗|？)/,
    /(?:弟弟|妹妹|哥哥|姐姐|儿子|女儿|爸|妈|爷爷|奶奶)(?:的)?名字(?:叫|是)(?:什么|谁|啥)|(?:弟弟|妹妹|哥哥|姐姐|儿子|女儿|爸|妈|爷爷|奶奶)(?:的)?名字(?:是什么|叫什么|叫啥)/,
    /我们(?:第一次|以前|那次|当年).{0,10}(?:记得|是什么|在哪)/,
  ],
  character: [
    /你以前(?:对|总是|老|经常).{0,10}(?:骂|打|凶|发脾气|不好|非打即骂|不管|伤害|吵)/,
    /你以前(?:脾气|性格|说话|为人).{0,10}(?:不好|太差|暴躁|坏|倔|冲|改|变)/,
    /你以前不是(?:这样|这种)|你变了|你以前不是这样/,
    /你不是(?:这种|那样|这样)人/,
    /(?:妈|你妈|她).{0,10}(?:找|有|交).{0,6}(?:对象|男朋友|老伴).{0,10}(?:你|爸).{0,4}(?:不生气|不介意|同意|愿意)/,
  ],
  authenticity: [
    /这不是你|这不是我(?:爸|妈)|不像你|你不是(?:他|她|我爸|我妈|我爸爸|我妈妈)/,
    /你(?:是|就是)(?:个)?(?:AI|ai|机器人|人工智能|程序)|你是不是(?:AI|ai|机器人)/,
    /你(?:是|就是)(?:假|装的)|装(?:我爸|我妈|我爸爸|我妈妈)|演(?:我爸|我妈)/,
  ],
  medium: [
    /有什么办法见你|怎么才能见你|能见你吗|我能见你吗/,
    /你能(?:听见|看见)我吗/,
  ],
};

function normalize(text: string): string {
  return (text || '').replace(/\s+/g, '');
}

function detectReasons(text: string): TestModeReason[] {
  const t = normalize(text);
  if (!t) return [];
  const reasons: TestModeReason[] = [];
  for (const [reason, patterns] of Object.entries(PATTERNS) as Array<
    [TestModeReason, RegExp[]]
  >) {
    if (patterns.some(pattern => pattern.test(t))) {
      reasons.push(reason);
    }
  }
  return reasons;
}

function uniqueReasons(reasons: TestModeReason[]): TestModeReason[] {
  return Array.from(new Set(reasons));
}

export function detectTestModeSignal(
  currentText: string,
  recentUserTexts: string[] = []
): TestModeSignal {
  const currentReasons = detectReasons(currentText);
  const recent = recentUserTexts.slice(-5);
  const recentReasonSets = recent.map(detectReasons);
  const cueTurnCount =
    recentReasonSets.filter(reasons => reasons.length > 0).length +
    (currentReasons.length > 0 ? 1 : 0);
  const reasons = uniqueReasons([
    ...currentReasons,
    ...recentReasonSets.reduce<TestModeReason[]>(
      (all, set) => all.concat(set),
      []
    ),
  ]);
  const lastRecentHasCue =
    recentReasonSets.length > 0 &&
    recentReasonSets[recentReasonSets.length - 1].length > 0;
  const matched =
    currentReasons.length > 0 ||
    (cueTurnCount >= 2 && lastRecentHasCue);

  const pressure: TestModePressure =
    reasons.includes('authenticity') || cueTurnCount >= 3
      ? 'high'
      : cueTurnCount >= 2 ||
        reasons.includes('character') ||
        reasons.includes('memory')
      ? 'medium'
      : 'low';

  return {
    matched,
    reasons,
    pressure,
    cueTurnCount,
    matchedFromCurrent: currentReasons.length > 0,
  };
}
