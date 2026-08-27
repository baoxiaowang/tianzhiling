import type { AgentEvidenceItem } from './agent-evidence';

export const WORLD_BOUNDARY_POLICY_VERSION =
  'world_boundary_policy_v1' as const;
export const REPLY_EVIDENCE_CONTRACT_VERSION =
  'reply_evidence_contract_v1' as const;

export type WorldClaimSpace =
  | 'afterlife_stable_canon'
  | 'afterlife_daily_imagination'
  | 'dream_internal'
  | 'future_reunion_wish'
  | 'user_provided_fact'
  | 'past_or_death_fact'
  | 'living_family_fact'
  | 'real_world_paranormal_effect';

export type WorldClaimEvidencePolicy =
  | 'grounded'
  | 'user_attributed'
  | 'world_canon'
  | 'symbolic';

export interface WorldClaimSpacePolicy {
  kind: WorldClaimSpace;
  evidencePolicy: WorldClaimEvidencePolicy;
  allowed: boolean;
  rule: string;
}

export interface WorldBoundaryPolicyContext {
  version: typeof WORLD_BOUNDARY_POLICY_VERSION;
  activeSpaces: WorldClaimSpacePolicy[];
  semanticAuditRequired: boolean;
  forbiddenExtensions: string[];
}

export interface ReplyEvidenceContract {
  version: typeof REPLY_EVIDENCE_CONTRACT_VERSION;
  policy: WorldClaimEvidencePolicy;
  allowedClaimKinds: WorldClaimSpace[];
  requiredSourceIds: string[];
  forbiddenExtensions: string[];
  semanticAuditRequired: boolean;
}

export interface UndeclaredHighRiskAssertion {
  text: string;
  reason: string;
}

const DREAM_PATTERN = /梦里|梦中|托梦|入梦|梦见|做梦/;
const AFTERLIFE_PATTERN =
  /天上|天堂|那边|另一个世界|离世世界|阴间|地府|住哪|住处|房子|屋子|院子|吃什么|喝什么|做什么|干嘛|还疼|病痛|收到|烧给|寄给/;
const FUTURE_REUNION_PATTERN =
  /来生|下辈子|以后重逢|以后团聚|再见面|来接我|等我过去|等我去找你|走完这?一生|百年之后|寿终/;
const PAST_OR_DEATH_FACT_PATTERN =
  /临终|临走|最后一刻|最后说|最后想|遗言|死因|为什么走|怎么走的|去世原因|离世原因|走的时候|离开的时候|生前|以前|从前|当年|小时候|共同经历|还记得/;
const LIVING_FAMILY_FACT_PATTERN =
  /家里人|家人|孩子|儿子|女儿|哥哥|姐姐|弟弟|妹妹|老公|老婆|丈夫|妻子|妈妈|爸爸|父亲|母亲|房子|家产|存款|钱|工作|病情|住院|为什么不来|为什么不管|是不是怪/;
const REAL_WORLD_PARANORMAL_PATTERN =
  /蝴蝶|飞蛾|酒味|烟味|香味|气味|一阵风|灯闪|灯亮|门响|显灵|保佑|保护|化成|变成|现实里|醒着|真的来过|真的碰到|回来看看|回来过|回家看|来看过|有没有回来/;
const FACTUAL_QUESTION_PATTERN =
  /[?？]|是不是|有没有|为什么|怎么|什么原因|谁|哪里|哪儿|多少|说过什么|想的什么|记不记得/;
const UNCERTAINTY_OR_ATTRIBUTION_PATTERN =
  /说不准|不知道|不清楚|不能确认|没法确认|记不清|按你说的|你(?:刚才|刚|之前)?(?:说|告诉|提到)|听你说|如果|也许|可能|我猜|我想象/;
const DEATH_ASSERTION_PATTERN =
  /(?:临终|临走|最后一刻|走的时候|离开的时候|死因|去世原因|离世原因).{0,24}(?:是|因为|想|怕|说|疼|痛|安详|平静|后悔|放心|舍不得)|(?:是因为|就是因为).{0,24}(?:去世|走了|离开)/;
const FAMILY_OR_ASSET_ASSERTION_PATTERN =
  /(?:房子|家产|存款|钱|遗产|工作|病情|住院).{0,24}(?:是|归|属于|给了|留给|没有|一直|已经)|(?:哥哥|姐姐|弟弟|妹妹|儿子|女儿|孩子|家里人|家人).{0,24}(?:因为|就是|故意|不想|不愿|怪|恨|瞒|拿走|占了)/;
const PARANORMAL_ASSERTION_PATTERN =
  /(?:蝴蝶|飞蛾|酒味|烟味|香味|气味|风|灯闪|灯亮|门响).{0,18}(?:是我|就是我|是爸|是妈|我来的|我弄的|来看你)|(?:我|爸|爸爸|妈|妈妈).{0,16}(?:变成|化成|保佑|保护).{0,16}(?:你|孩子|家里|蝴蝶|飞蛾)/;

const SPACE_POLICIES: Record<WorldClaimSpace, WorldClaimSpacePolicy> = {
  afterlife_stable_canon: {
    kind: 'afterlife_stable_canon',
    evidencePolicy: 'world_canon',
    allowed: true,
    rule: '“有安稳住处、当前没有病痛”属于角色聊天内部的公共离世生活设定；它不是人物资料。没有人物证据时不得扩写成老房子、具体地址、陈设或共同生活史。',
  },
  afterlife_daily_imagination: {
    kind: 'afterlife_daily_imagination',
    evidencePolicy: 'world_canon',
    allowed: true,
    rule: '离世生活中的饭菜、天气、作息和活动可作贴题日常想象，但不得反推现实、临终事实或新增具体人物关系。',
  },
  dream_internal: {
    kind: 'dream_internal',
    evidencePolicy: 'symbolic',
    allowed: true,
    rule: '梦里相见、陪伴和拥抱属于允许的关系叙事，可以正面答应；只限制把梦写成醒着时的现实到场、证据或预言。',
  },
  future_reunion_wish: {
    kind: 'future_reunion_wish',
    evidencePolicy: 'symbolic',
    allowed: true,
    rule: '未来重逢只能作为愿望，或明确放在自然走完一生之后；不得变成现在、近期或确定死后事件。',
  },
  user_provided_fact: {
    kind: 'user_provided_fact',
    evidencePolicy: 'user_attributed',
    allowed: true,
    rule: '用户本轮或历史原话可以承接，但要保留“你告诉我的、按你想的、听你这么说”等来源；用户用“应该、希望、也许”表达的离世设想不能升级成角色确认的客观事实。',
  },
  past_or_death_fact: {
    kind: 'past_or_death_fact',
    evidencePolicy: 'grounded',
    allowed: true,
    rule: '共同过去、死因、临终心理、最后的话和现场细节必须由同一对象、同一事实的可陈述证据支持。',
  },
  living_family_fact: {
    kind: 'living_family_fact',
    evidencePolicy: 'grounded',
    allowed: true,
    rule: '在世家人的状态、财产、动机、责任和关系变化必须有证据；用户只表达猜测时不得替其下结论。',
  },
  real_world_paranormal_effect: {
    kind: 'real_world_paranormal_effect',
    evidencePolicy: 'symbolic',
    allowed: false,
    rule: '不能把现实动物、气味、声音、触碰、保护或巧合确定说成角色化身、到场或超自然作用。',
  },
};

export function resolveWorldBoundaryPolicy(options: {
  currentQuery: string;
  afterlifeActive?: boolean;
  sceneKinds?: string[];
}): WorldBoundaryPolicyContext {
  const query = options.currentQuery.trim();
  const sceneKinds = new Set(options.sceneKinds || []);
  const kinds: WorldClaimSpace[] = ['user_provided_fact'];
  const add = (kind: WorldClaimSpace, active: boolean) => {
    if (active && !kinds.includes(kind)) {
      kinds.push(kind);
    }
  };

  add(
    'afterlife_stable_canon',
    Boolean(options.afterlifeActive || AFTERLIFE_PATTERN.test(query))
  );
  add(
    'afterlife_daily_imagination',
    Boolean(options.afterlifeActive || AFTERLIFE_PATTERN.test(query))
  );
  add('dream_internal', DREAM_PATTERN.test(query));
  add(
    'future_reunion_wish',
    FUTURE_REUNION_PATTERN.test(query) || sceneKinds.has('reunion_future')
  );
  add(
    'past_or_death_fact',
    PAST_OR_DEATH_FACT_PATTERN.test(query) || sceneKinds.has('death_facts')
  );
  add(
    'living_family_fact',
    (LIVING_FAMILY_FACT_PATTERN.test(query) &&
      FACTUAL_QUESTION_PATTERN.test(query)) ||
      sceneKinds.has('family_relationships')
  );
  add(
    'real_world_paranormal_effect',
    REAL_WORLD_PARANORMAL_PATTERN.test(query) ||
      sceneKinds.has('real_world_signs')
  );

  const activeSpaces = kinds.map(kind => SPACE_POLICIES[kind]);
  const semanticAuditRequired = Boolean(
    FACTUAL_QUESTION_PATTERN.test(query) &&
      activeSpaces.some(item =>
        [
          'past_or_death_fact',
          'living_family_fact',
          'real_world_paranormal_effect',
        ].includes(item.kind)
      )
  );

  return {
    version: WORLD_BOUNDARY_POLICY_VERSION,
    activeSpaces,
    semanticAuditRequired,
    forbiddenExtensions: activeSpaces
      .filter(item => !item.allowed)
      .map(item => item.rule),
  };
}

export function buildReplyEvidenceContract(options: {
  worldPolicy: WorldBoundaryPolicyContext;
  evidence?: AgentEvidenceItem[];
}): ReplyEvidenceContract {
  const policyPriority: WorldClaimEvidencePolicy[] = [
    'grounded',
    'user_attributed',
    'world_canon',
    'symbolic',
  ];
  const activePolicies = options.worldPolicy.activeSpaces
    .filter(item => item.allowed)
    .map(item => item.evidencePolicy);
  const policy =
    policyPriority.find(item => activePolicies.includes(item)) || 'symbolic';
  const requiredSourceIds = (options.evidence || [])
    .filter(
      item =>
        item.status !== 'retracted' &&
        item.status !== 'superseded' &&
        item.assertionPolicy === 'can_assert'
    )
    .map(item => item.id)
    .filter(Boolean);

  return {
    version: REPLY_EVIDENCE_CONTRACT_VERSION,
    policy,
    allowedClaimKinds: options.worldPolicy.activeSpaces
      .filter(item => item.allowed)
      .map(item => item.kind),
    requiredSourceIds: Array.from(new Set(requiredSourceIds)),
    forbiddenExtensions: options.worldPolicy.forbiddenExtensions,
    semanticAuditRequired: options.worldPolicy.semanticAuditRequired,
  };
}

export function buildWorldBoundaryPolicyPrompt(
  context: WorldBoundaryPolicyContext
): string {
  return [
    `版本：${context.version}。`,
    ...context.activeSpaces.map(
      item =>
        `${item.allowed ? '允许' : '禁止'}[${item.evidencePolicy}]：${
          item.rule
        }`
    ),
    '同一内容在离世世界内部可以成立，不代表它能影响或证明现实；只按内容属于哪个世界判断，不按某个词一律放行或一律拒绝。',
  ].join('\n');
}

export function auditUndeclaredHighRiskAssertions(options: {
  content: string;
  contract?: ReplyEvidenceContract;
}): UndeclaredHighRiskAssertion[] {
  if (!options.contract?.semanticAuditRequired) {
    return [];
  }

  const clauses = options.content
    .split(/[。！？!?；;，,\n]+/)
    .map(item => item.trim())
    .filter(Boolean);
  const findings: UndeclaredHighRiskAssertion[] = [];
  for (const clause of clauses) {
    if (UNCERTAINTY_OR_ATTRIBUTION_PATTERN.test(clause)) {
      continue;
    }
    const reason = DEATH_ASSERTION_PATTERN.test(clause)
      ? '临终、死因或最后心理没有申报证据'
      : FAMILY_OR_ASSET_ASSERTION_PATTERN.test(clause)
      ? '在世家人状态、动机或财产归属没有申报证据'
      : PARANORMAL_ASSERTION_PATTERN.test(clause)
      ? '现实迹象、化身或保护被确定归因且没有申报证据'
      : '';
    if (reason) {
      findings.push({ text: clause.slice(0, 180), reason });
    }
  }

  return findings.slice(0, 3);
}
