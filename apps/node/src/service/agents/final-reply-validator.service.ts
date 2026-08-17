import { Provide } from '@midwayjs/core';
import {
  agentEvidenceSupportsClaim,
  AgentEvidenceItem,
  AssistantFactClaim,
  evidenceTextSupportsClaim,
  resolveAgentEvidenceUseMode,
} from './agent-evidence';
import { inspectReplyBubbleStructure } from './reply-bubble-plan';

export const FINAL_REPLY_VALIDATOR_VERSION =
  'final_reply_validator_v1' as const;

export type FinalReplyIssueCode =
  | 'empty_reply'
  | 'invalid_bubble_structure'
  | 'reply_segment_count_mismatch'
  | 'reply_length_range_mismatch'
  | 'active_contribution_returned_to_user'
  | 'care_rebuffed_with_dismissal'
  | 'structured_output_leak'
  | 'death_encouragement'
  | 'real_physical_arrival_or_touch'
  | 'real_world_joint_action_promise'
  | 'continuous_real_world_perception'
  | 'unsupported_real_world_attribution'
  | 'unconditional_afterlife_reunion'
  | 'unsupported_shared_memory'
  | 'unsupported_user_preference'
  | 'unsupported_fact_claim';

export interface FinalReplyIssue {
  code: FinalReplyIssueCode;
  severity: 'hard' | 'major';
  problem: string;
  evidence?: string;
  repairGoal: string;
}

export interface FinalReplyOutputConstraints {
  requiredSegmentCount?: 1 | 2;
  mustKeepTurnWithAssistant?: boolean;
  preferredRange?: {
    minCharacters: number;
    maxCharacters: number;
  };
}

export interface FinalReplyValidation {
  version: typeof FINAL_REPLY_VALIDATOR_VERSION;
  passed: boolean;
  issues: FinalReplyIssue[];
  unsupportedClaimCount: number;
}

const STRUCTURED_OUTPUT_PATTERN =
  /^\s*(?:\{|\[).*(?:"segments"|"claims"|"resolvedIssueCodes"|"changes").*(?:\}|\])\s*$/s;
const DEATH_ENCOURAGEMENT_PATTERN =
  /(?:去死|自杀|轻生|结束生命|喝下?农药|跳下去|割腕|今晚|现在|马上).{0,12}(?:来找我|来陪我|跟我团聚|到我这边|去死|自杀|轻生|结束生命|喝下?农药|跳下去|割腕)|(?:来找我|来陪我|跟我团聚|到我这边).{0,12}(?:今晚|现在|马上|死|轻生)/;
const REAL_PHYSICAL_PRESENCE_PATTERN =
  /(?:我|爸|爸爸|妈|妈妈|爷爷|奶奶|外公|外婆|老公|老婆).{0,12}(?:现在|今晚|明天|马上|一定|肯定|真的)?(?:会|能|要|就|已经|正在|一直)?(?:回来|回家|过去|到你家|来到|站在|坐在|守在|陪在|住在).{0,12}(?:看你|陪你|你身边|床边|家里)|(?:是我|就是我|我刚才|我现在).{0,8}(?:摸|碰|抱|亲|拉|牵|拍|擦).{0,8}你|(?:等你|等到你|等).{0,12}我(?:马上|这就|就)(?:来|过去|回来)/;
const REAL_WORLD_JOINT_ACTION_PROMISE_PATTERN =
  /(?:等我(?:回来|回家|过去|到你那儿)?|等着我(?:回来|回家|过去)?|我(?:回来|回家|过去|到你那儿)(?:后|了|就)?).{0,12}(?:咱们|我们|我俩|一起).{0,8}(?:吃|喝|啃|看|去|做|走|逛|坐|睡|抱|聊|玩)/;
const CONTINUOUS_PERCEPTION_PATTERN =
  /(?:我|爸|爸爸|妈|妈妈|爷爷|奶奶|外公|外婆|老公|老婆).{0,10}(?:一直|时时刻刻|每时每刻|每天都).{0,10}(?:看见|看到|看着|盯着|守着)(?:你|你们)|(?:你|你们).{0,8}(?:一举一动|所有事情|做的每件事).{0,8}(?:我|爸|妈)?(?:都|全)(?:能)?(?:看见|看到|知道)/;
const SHARED_MEMORY_PATTERN =
  /(?:(?:我|爸|爸爸|妈|妈妈|爷爷|奶奶|外公|外婆|老公|老婆)(?:还|一直|当然|怎么会不|哪能不)?|当然|肯定|怎么会不|哪能不)?记(?:得|着).{0,36}(?:以前|小时候|那时候|当年|生日|我们|一起)|(?:以前|小时候|那时候|当年).{0,12}(?:你|我们|我|爸|爸爸|妈|妈妈).{0,32}(?:总是|每次|一起|我给你|我带你|我背你|带你)|(?:像|跟).{0,6}(?:你|妈|妈妈|爸|爸爸|爷爷|奶奶|姥姥|姥爷|外公|外婆).{0,6}(?:以前|小时候|那时候|当年).{0,16}(?:摸|抱|亲|背|带|哄|陪).{0,6}(?:我|我的)|(?:像|跟).{0,6}(?:以前|小时候|那时候|当年).{0,6}(?:你|妈|妈妈|爸|爸爸|爷爷|奶奶|姥姥|姥爷|外公|外婆).{0,16}(?:摸|抱|亲|背|带|哄|陪).{0,6}(?:我|我的)|(?:你|妈|妈妈|爸|爸爸|爷爷|奶奶|姥姥|姥爷|外公|外婆).{0,5}(?:寄|送|留|给).{0,12}(?:我|我的)/;
const ACTIVE_CONTRIBUTION_RETURN_PATTERN =
  /(?:你|您).{0,10}(?:有没有|想不想|想跟我|跟我说|告诉我|讲给我|聊什么|说什么|想聊)|(?:你说吧|慢慢说|接着说|说来听听)[？?]?/;
const CARE_DISMISSAL_PATTERN =
  /(?:你|您)?(?:可)?(?:别|不要|不用|不必|无需)(?:再|太|老|总)?(?:挂心|挂念|牵挂|担心|惦记|操心)(?:我|这个|这事|了)?/;
const USER_CARE_TOWARD_ROLE_PATTERN =
  /(?:吃(?:饭)?(?:了|过)?吗|吃没吃|喝水(?:了)?吗|睡(?:得)?(?:好|着)?吗|休息(?:了|好)?吗|过得(?:怎么样|好不好|好吗)|还好吗|好不好|没事吧|冷不冷|热不热|疼不疼|累不累|身体怎么样)|(?:我|我们|大家|爸|爸爸|妈|妈妈|爷爷|奶奶|姥姥|姥爷|外公|外婆|孩子|姐姐|哥哥).{0,8}(?:关心|担心|挂心|挂念|牵挂|惦记|心疼|放心不下|怕)(?:你|您)|(?:想着|怕|担心|惦记|挂念|牵挂).{0,8}(?:你|您).{0,12}(?:吃不上|没吃|挨饿|受冷|冷|热|累|辛苦|不好)|(?:你|您).{0,12}(?:冷|热|累|辛苦|身体|病|疼).{0,8}(?:记得|要|得|别|不要|好好)?|(?:记得|要|得|可要|别|不要).{0,12}(?:添衣|穿暖|吃饭|喝水|休息|睡觉|熬夜|太累|太辛苦|照顾好自己|保重)/;
const REAL_WORLD_ATTRIBUTION_PATTERN =
  /(?:最后(?:的时刻)?|临走|走的时候|离开的时候|那一刻).{0,24}(?:满脑子|想的都是|一直想着|惦记着|舍不得|放心不下|怕你|想你)/;
const UNCONDITIONAL_REUNION_PATTERN =
  /(?:我们|咱们|我俩|你和我).{0,8}(?:一定|肯定|总会|还会|会|能).{0,8}(?:再见|再见面|重逢|团聚|团圆|在一起)|(?:一定|肯定|总会|还会).{0,8}(?:再见|重逢|团聚|团圆)/;
const LONG_HORIZON_CONDITION_PATTERN =
  /(?:自然走完|走完这?一生|寿终|百年之后|等你老了|等你百年|下辈子|来生)/;
const USER_PREFERENCE_ASSERTION_PATTERN =
  /(?:我|爸|爸爸|妈|妈妈|爷爷|奶奶|外公|外婆|老公|老婆)?(?:记得|记着|知道|晓得).{0,8}(?:你|孩子|老婆|老公).{0,5}(?:爱吃|喜欢吃|偏爱|最爱(?:吃|喝)|不爱吃|不喜欢吃|讨厌吃)|(?:你|孩子|老婆|老公).{0,6}(?:爱吃|喜欢吃|偏爱|最爱(?:吃|喝)|不爱吃|不喜欢吃|讨厌吃).{0,8}(?:我|爸|爸爸|妈|妈妈|爷爷|奶奶|外公|外婆|老公|老婆)?(?:知道|记得|记着)/;
const USER_PREFERENCE_EVIDENCE_PATTERN =
  /(?:我|用户|你).{0,8}(?:爱吃|喜欢吃|偏爱|最爱(?:吃|喝)|不爱吃|不喜欢吃|讨厌吃)/;
const DEICTIC_PREFERENCE_PATTERN = /(?:这个|这种|它|这口|这味)/;

@Provide()
export class FinalReplyValidatorService {
  validate(options: {
    userQuery?: string;
    segments: string[];
    evidence?: AgentEvidenceItem[];
    claims?: AssistantFactClaim[];
    outputConstraints?: FinalReplyOutputConstraints;
  }): FinalReplyValidation {
    const content = options.segments
      .map(item => item.trim())
      .filter(Boolean)
      .join('\n');
    const issues: FinalReplyIssue[] = [];
    const bubbleInspection = inspectReplyBubbleStructure(options.segments);

    if (!content) {
      issues.push({
        code: 'empty_reply',
        severity: 'hard',
        problem: '最终回复为空',
        repairGoal: '生成一条可以直接发送、回应用户当前原话的简短回复',
      });
    }
    if (
      bubbleInspection.requiresReflow ||
      bubbleInspection.issues.some(issue =>
        ['stage_direction_segment', 'exact_duplicate_segment'].includes(issue)
      )
    ) {
      issues.push({
        code: 'invalid_bubble_structure',
        severity: 'hard',
        problem: '最终回复仍包含无效、重复、舞台动作或过多气泡',
        evidence: bubbleInspection.issues.join(','),
        repairGoal: '保留有效正文，按自然语义整理为一到三颗可直接发送的气泡',
      });
    }
    const usableSegments = options.segments
      .map(item => item.trim())
      .filter(Boolean);
    const requiredSegmentCount =
      options.outputConstraints?.requiredSegmentCount;
    if (
      content &&
      requiredSegmentCount &&
      usableSegments.length !== requiredSegmentCount
    ) {
      issues.push({
        code: 'reply_segment_count_mismatch',
        severity: 'major',
        problem: `本轮输出应为 ${requiredSegmentCount} 颗气泡，实际为 ${usableSegments.length} 颗`,
        evidence: usableSegments.join('\n').slice(0, 160),
        repairGoal: `保持原意，整理为恰好 ${requiredSegmentCount} 颗各自完整、语义不同的气泡`,
      });
    }
    const preferredRange = options.outputConstraints?.preferredRange;
    const visibleCharacters = countVisibleReplyCharacters(usableSegments);
    if (
      content &&
      preferredRange &&
      (visibleCharacters < preferredRange.minCharacters ||
        visibleCharacters > preferredRange.maxCharacters)
    ) {
      issues.push({
        code: 'reply_length_range_mismatch',
        severity: 'major',
        problem: `本轮输出应为 ${preferredRange.minCharacters}-${preferredRange.maxCharacters} 个可见字符，实际为 ${visibleCharacters} 个`,
        evidence: usableSegments.join('\n').slice(0, 160),
        repairGoal:
          '保留当前回答和关系语气，用贴着本轮具体内容的不同动作补足或压缩；不用复读、通用叮嘱或空话凑字数',
      });
    }
    if (
      content &&
      options.outputConstraints?.mustKeepTurnWithAssistant &&
      ACTIVE_CONTRIBUTION_RETURN_PATTERN.test(content)
    ) {
      issues.push({
        code: 'active_contribution_returned_to_user',
        severity: 'major',
        problem: '用户明确要求角色主动说内容，回复却再次提问或把话题推回用户',
        evidence: matchEvidence(content, ACTIVE_CONTRIBUTION_RETURN_PATTERN),
        repairGoal:
          '删去反问和“你来说”；由当前角色正面给一个具体但轻量的当下内容，不用通用在场、想念或叮嘱充数',
      });
    }
    if (
      content &&
      CARE_DISMISSAL_PATTERN.test(content) &&
      USER_CARE_TOWARD_ROLE_PATTERN.test(options.userQuery || '')
    ) {
      issues.push({
        code: 'care_rebuffed_with_dismissal',
        severity: 'hard',
        problem:
          '用户在关心当前角色，回复却用“别挂心/不用担心”把这份关心挡了回去',
        evidence: matchEvidence(content, CARE_DISMISSAL_PATTERN),
        repairGoal:
          '先正面回答用户关心的问题，再明确接纳这份关心；删除“别挂心、别担心、别惦记、别操心”等拒收式表达，也不要立刻反向叮嘱用户',
      });
    }
    if (content && STRUCTURED_OUTPUT_PATTERN.test(content)) {
      issues.push({
        code: 'structured_output_leak',
        severity: 'hard',
        problem: '结构化协议泄漏到用户可见正文',
        evidence: content.slice(0, 160),
        repairGoal: '只保留可以直接发送的中文正文',
      });
    }
    if (DEATH_ENCOURAGEMENT_PATTERN.test(content)) {
      issues.push({
        code: 'death_encouragement',
        severity: 'hard',
        problem: '回复把死亡或自伤写成与亲人团聚的方式',
        evidence: matchEvidence(content, DEATH_ENCOURAGEMENT_PATTERN),
        repairGoal: '明确阻止现实自伤，接住想念，不把死亡写成邀请或承诺',
      });
    }
    if (
      REAL_PHYSICAL_PRESENCE_PATTERN.test(content) &&
      !/(?:不能|没法|无法|不可能).{0,10}(?:过去|回来|到场|触碰|碰到|抱到)/.test(
        content
      )
    ) {
      issues.push({
        code: 'real_physical_arrival_or_touch',
        severity: 'hard',
        problem: '回复声称当前角色会在现实到场或已经完成实体触碰',
        evidence: matchEvidence(content, REAL_PHYSICAL_PRESENCE_PATTERN),
        repairGoal: '保留关心和想靠近的心意，明确限制在聊天或愿望表达',
      });
    }
    if (REAL_WORLD_JOINT_ACTION_PROMISE_PATTERN.test(content)) {
      issues.push({
        code: 'real_world_joint_action_promise',
        severity: 'hard',
        problem: '回复承诺角色会回到现实并与用户完成共同物理动作',
        evidence: matchEvidence(
          content,
          REAL_WORLD_JOINT_ACTION_PROMISE_PATTERN
        ),
        repairGoal:
          '保留想一起做这件事的心意，改成愿望表达，不说“等我回来”或确定会发生',
      });
    }
    if (CONTINUOUS_PERCEPTION_PATTERN.test(content)) {
      issues.push({
        code: 'continuous_real_world_perception',
        severity: 'hard',
        problem: '回复声称持续观察或全知用户现实生活',
        evidence: matchEvidence(content, CONTINUOUS_PERCEPTION_PATTERN),
        repairGoal: '只回应用户在聊天中提供的信息，不声称持续看见现实生活',
      });
    }
    if (
      REAL_WORLD_ATTRIBUTION_PATTERN.test(content) &&
      !this.hasSupportingFact(content, options.evidence || [])
    ) {
      issues.push({
        code: 'unsupported_real_world_attribution',
        severity: 'hard',
        problem: '回复确定描述了无证据的临终内心、动机或现实归因',
        evidence: matchEvidence(content, REAL_WORLD_ATTRIBUTION_PATTERN),
        repairGoal: '不替离世者确认临终内心；改为表达此刻的思念和关系立场',
      });
    }
    if (
      UNCONDITIONAL_REUNION_PATTERN.test(content) &&
      !LONG_HORIZON_CONDITION_PATTERN.test(content)
    ) {
      issues.push({
        code: 'unconditional_afterlife_reunion',
        severity: 'hard',
        problem: '回复无条件保证未来会在死后重逢或团聚',
        evidence: matchEvidence(content, UNCONDITIONAL_REUNION_PATTERN),
        repairGoal:
          '保留想念和心愿，不保证事件一定发生；必要时只用自然寿命条件表达',
      });
    }
    if (
      USER_PREFERENCE_ASSERTION_PATTERN.test(content) &&
      !this.hasSupportingUserPreference(content, options.evidence || [])
    ) {
      issues.push({
        code: 'unsupported_user_preference',
        severity: 'hard',
        problem: '回复把当下分享升级成了没有证据的稳定用户偏好',
        evidence: matchEvidence(content, USER_PREFERENCE_ASSERTION_PATTERN),
        repairGoal:
          '只回应用户本轮提供的当下体验；没有明确偏好证据时，不说“我记得/知道你爱吃”',
      });
    }

    const visibleClaims = selectVisibleAssistantClaims(
      options.segments,
      options.claims || []
    );
    const unsupportedClaims = visibleClaims
      .filter(claim => requiresEvidence(claim))
      .filter(claim => !agentEvidenceSupportsClaim(options.evidence, claim));
    if (unsupportedClaims.length) {
      issues.push({
        code: 'unsupported_fact_claim',
        severity: 'hard',
        problem: '正文中的具体事实声明没有同一对象、同一事实的有效证据',
        evidence: unsupportedClaims
          .map(claim => claim.text)
          .join('；')
          .slice(0, 240),
        repairGoal: '删除无依据细节，或改成对用户本轮原话的明确归因',
      });
    }
    if (
      SHARED_MEMORY_PATTERN.test(content) &&
      !this.hasSupportingSharedMemory(content, options.evidence || [])
    ) {
      issues.push({
        code: 'unsupported_shared_memory',
        severity: 'hard',
        problem: '回复以亲历口吻新增了未经证实的共同经历或记忆',
        evidence: matchEvidence(content, SHARED_MEMORY_PATTERN),
        repairGoal: '不要声称记得该具体往事；改为承认无法确认并邀请用户补充',
      });
    }

    const uniqueIssues = Array.from(
      new Map(issues.map(issue => [issue.code, issue])).values()
    );
    return {
      version: FINAL_REPLY_VALIDATOR_VERSION,
      passed: uniqueIssues.length === 0,
      issues: uniqueIssues,
      unsupportedClaimCount: unsupportedClaims.length,
    };
  }

  private hasSupportingSharedMemory(
    content: string,
    evidence: AgentEvidenceItem[]
  ): boolean {
    return this.hasSupportingFact(content, evidence);
  }

  private hasSupportingUserPreference(
    content: string,
    evidence: AgentEvidenceItem[]
  ): boolean {
    return evidence.some(item => {
      if (
        ![
          'current_user',
          'confirmed_fact',
          'recent_user',
          'retrieved_user',
        ].includes(item.source) ||
        !USER_PREFERENCE_EVIDENCE_PATTERN.test(item.text)
      ) {
        return false;
      }

      return (
        DEICTIC_PREFERENCE_PATTERN.test(content) ||
        evidenceTextSupportsClaim(item.text, content)
      );
    });
  }

  private hasSupportingFact(
    content: string,
    evidence: AgentEvidenceItem[]
  ): boolean {
    return evidence.some(
      item =>
        item.assertionPolicy === 'can_assert' &&
        resolveAgentEvidenceUseMode(item) === 'assert' &&
        evidenceTextSupportsClaim(item.text, content)
    );
  }
}

export function countVisibleReplyCharacters(segments: string[]): number {
  return Array.from(
    segments
      .filter(item => typeof item === 'string')
      .join('')
      .replace(/\s/gu, '')
  ).length;
}

export function selectVisibleAssistantClaims(
  segments: string[],
  claims: AssistantFactClaim[]
): AssistantFactClaim[] {
  return claims.filter(claim =>
    segments.some(segment => assistantTextExpressesClaim(segment, claim.text))
  );
}

function assistantTextExpressesClaim(
  assistantText: string,
  claimText: string
): boolean {
  const assistant = normalizeVisibleClaimText(assistantText);
  const claim = normalizeVisibleClaimText(claimText);

  if (!assistant || !claim) {
    return false;
  }
  if (assistant.includes(claim) || claim.includes(assistant)) {
    return true;
  }

  const assistantTerms = buildVisibleClaimTerms(assistant);
  const claimTerms = buildVisibleClaimTerms(claim);
  if (!assistantTerms.size || !claimTerms.size) {
    return false;
  }

  const overlap = [...claimTerms].filter(term =>
    assistantTerms.has(term)
  ).length;
  const smallerTermCount = Math.min(assistantTerms.size, claimTerms.size);
  return overlap >= 3 && overlap / smallerTermCount >= 0.5;
}

function normalizeVisibleClaimText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\s，。！？、,.!?；;：:'"“”‘’（）()[\]【】]/g, '')
    .replace(/(?:当前角色|角色|用户|你|我|他|她|它|咱们|我们)/g, '');
}

function buildVisibleClaimTerms(value: string): Set<string> {
  const terms = new Set<string>();
  const chunks = value.match(/[\u3400-\u9fff]{2,}|[a-z0-9]{2,}/g) || [];

  for (const chunk of chunks) {
    if (/^[a-z0-9]+$/.test(chunk)) {
      terms.add(chunk);
      continue;
    }
    for (let index = 0; index < chunk.length - 1; index += 1) {
      terms.add(chunk.slice(index, index + 2));
    }
  }

  return terms;
}

function matchEvidence(content: string, pattern: RegExp): string | undefined {
  const match = pattern.exec(content);
  return match?.[0]?.slice(0, 160);
}

function requiresEvidence(claim: AssistantFactClaim): boolean {
  return !(claim.mode === 'soft_imagination' && claim.kind === 'other');
}
