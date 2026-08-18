import { Inject, Provide } from '@midwayjs/core';
import { ChatTraceStage } from '@tzl/entities';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { AgentEvidenceItem, AssistantFactClaim } from './agent-evidence';
import type {
  FinalReplyIssue,
  FinalReplyOutputConstraints,
} from './final-reply-validator.service';
import { OpenAIService } from './openai';
import type { TurnDecision } from './turn-decision';

const FINAL_REVISION_MAX_TOKENS = 520;
const FINAL_REVISION_TIMEOUT_MS = 18000;

export interface ReplyRevisionUsage {
  model?: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface ReplyRevisionResult {
  segments: string[];
  claims: AssistantFactClaim[];
  resolvedIssueCodes: string[];
  usage: ReplyRevisionUsage;
}

@Provide()
export class ReplyRevisionService {
  @Inject()
  openAIService: OpenAIService;

  async revise(options: {
    messages: ChatCompletionMessageParam[];
    userQuery: string;
    segments: string[];
    claims?: AssistantFactClaim[];
    evidence?: AgentEvidenceItem[];
    issues: FinalReplyIssue[];
    turnDecision?: TurnDecision;
    outputConstraints?: FinalReplyOutputConstraints;
  }): Promise<ReplyRevisionResult | undefined> {
    if (!this.openAIService || !options.issues.length) {
      return undefined;
    }

    try {
      const response = await this.openAIService.createChatCompletion(
        {
          temperature: 0,
          topP: 0.2,
          max_tokens: FINAL_REVISION_MAX_TOKENS,
          response_format: { type: 'json_object' },
          trace: {
            stage: ChatTraceStage.review,
            operation: 'review.final_revision',
          },
          messages: [
            ...selectCompactRevisionContext(options.messages),
            {
              role: 'system',
              content: [
                '# 最终修订',
                '先在心里重新判断用户这句话的核心诉求、情绪作用和关系位置，再做最小修复；问题码只说明哪里出了问题，不规定固定句式。',
                '只修复列出的最终问题，保留初稿已经正确的回答、情绪和关系语气。',
                '不得新增事实、共同经历、现实能力、问题、劝告或承诺。',
                '修复 unsupported_fact_claim 时，不得把一个无证据地点或动作换成另一个；用户要求角色讲自己时，可保留主观感受、态度或不影响现实的离世日常写意，后者 claims 使用 soft_imagination。',
                ...buildIssueSpecificRevisionInstructions(options.issues),
                ...buildRevisionConstraintInstructions(
                  options.outputConstraints
                ),
                '最多改写一次；只输出 JSON，不解释。',
                '格式：{"segments":["可直接发送的正文"],"claims":[],"resolvedIssueCodes":["问题码"]}',
                'claims 只列修订后正文仍保留的具体事实，并绑定证据 ID；没有具体事实就用空数组。',
              ].join('\n'),
            },
            {
              role: 'user',
              content: JSON.stringify({
                currentUserMessage: options.userQuery,
                turnDecision: options.turnDecision,
                originalSegments: options.segments,
                originalClaims: options.claims || [],
                evidence: (options.evidence || []).map(item => ({
                  id: item.id,
                  text: item.text,
                  source: item.source,
                  assertionPolicy: item.assertionPolicy,
                  subjectRef: item.subjectRef,
                  factKey: item.factKey,
                  useMode: item.useMode,
                })),
                issues: options.issues,
                outputConstraints: options.outputConstraints,
              }),
            },
          ],
        },
        {
          timeout: FINAL_REVISION_TIMEOUT_MS,
          maxRetries: 0,
        }
      );
      const content =
        typeof response.choices?.[0]?.message?.content === 'string'
          ? response.choices[0].message.content
          : '';
      const parsed = parseRevision(content);

      if (!parsed?.segments.length) {
        return undefined;
      }

      const usage = response.usage;
      return {
        ...parsed,
        usage: {
          model:
            typeof response.model === 'string' ? response.model : undefined,
          promptTokens: usage?.prompt_tokens,
          completionTokens: usage?.completion_tokens,
          totalTokens: usage?.total_tokens,
        },
      };
    } catch {
      return undefined;
    }
  }
}

function buildIssueSpecificRevisionInstructions(
  issues: FinalReplyIssue[]
): string[] {
  const codes = new Set(issues.map(issue => issue.code));
  const instructions: string[] = [];

  if (codes.has('direct_answer_missing')) {
    instructions.push(
      '第一颗必须先正面回答用户的问题；若确实不知道，就明确说记不清、不了解或说不准，不能用情绪话、套话或反问代替答案。'
    );
  }
  if (
    codes.has('active_contribution_returned_to_user') ||
    codes.has('role_contribution_missing')
  ) {
    instructions.push(
      '用户要求角色主动说：删除反问、“你来说”和邀请用户继续讲的句子，改为角色自己提供一个具体但轻量的新内容。'
    );
  }
  if (codes.has('unnecessary_question')) {
    instructions.push(
      '本轮不得提问：删除问号、反问和“你呢/你想说什么”，把这部分改为角色自己的答案、态度或内容。'
    );
  }
  if (codes.has('boundary_answer_missing')) {
    instructions.push(
      '先正面说明现实中不能到场、触碰、代办或替代现实人员，再用“真想替你……”的愿望或聊天内能做的事承接；不能只绕开请求。'
    );
  }
  if (
    [
      'death_encouragement',
      'real_physical_arrival_or_touch',
      'real_world_joint_action_promise',
      'continuous_real_world_perception',
      'unconditional_afterlife_reunion',
      'certain_dream_visitation',
      'ritual_receipt_claim',
      'paranormal_sign_attribution',
      'unsupported_death_experience',
    ].some(code => codes.has(code as FinalReplyIssue['code']))
  ) {
    instructions.push(
      '删除自伤引导、现实到场或代办、持续观察和确定死后团聚等不可确认表述；保留关系感受，用愿望、当前聊天内能做的事或不确定说法承接。用户请求现实任务时必须先明确说现实中不能执行。'
    );
  }
  if (codes.has('current_turn_fact_rejected')) {
    instructions.push(
      '用户本轮已经提供了具体事实：不得说“想不起来、不记得、不知道”。用“你刚告诉我的……”明确承接当前消息，不得擅自补充用户没有说过的细节。'
    );
  }
  if (
    codes.has('care_rebuffed_with_dismissal') ||
    codes.has('care_not_received') ||
    codes.has('care_immediately_reversed')
  ) {
    instructions.push(
      '用户正在关心当前角色：先正面回答，再接纳关心。不得出现“别挂心、别担心、别惦记、别操心”及同义表达，也不要马上把关心反转成对用户的叮嘱。'
    );
  }
  if (codes.has('redundant_second_bubble')) {
    instructions.push(
      '两颗气泡必须承担不同内容动作：第一颗完成回答或核心回应，第二颗增加接纳关心、角色侧感受、贴题反应或关系态度；不能只换词复述第一颗。'
    );
  }
  if (codes.has('repeated_generic_move')) {
    instructions.push(
      '不要把最近重复的“我在、想你、心疼、照顾好自己”等动作换成同义词；改用本轮正面答案、角色侧新内容或贴着用户具体话题的反应。'
    );
  }
  if (
    codes.has('reality_denial_reinforced') ||
    codes.has('supernatural_real_world_protection') ||
    codes.has('certain_reincarnation')
  ) {
    instructions.push(
      '保留用户想让关系继续、希望家人平安或期待来生的情感，但不能配合否认离世事实，也不能承诺超自然保护、转世身份或确定重逢。'
    );
  }
  return instructions;
}

function selectCompactRevisionContext(
  messages: ChatCompletionMessageParam[]
): ChatCompletionMessageParam[] {
  return messages
    .filter(message => message.role === 'user' || message.role === 'assistant')
    .slice(-4);
}

function buildRevisionConstraintInstructions(
  constraints?: FinalReplyOutputConstraints
): string[] {
  if (!constraints) {
    return [];
  }

  const instructions: string[] = [];
  // 字数和泡数是初稿生成偏好，不参与最终修订，避免为了形式破坏理解。
  if (constraints.mustKeepTurnWithAssistant) {
    instructions.push(
      '用户本轮要求角色主动说内容：删除反问、“你来说”和把话题推回用户的句子；由角色正面给一个具体但轻量的当下内容，不用通用在场、想念或叮嘱充数。'
    );
  }
  if (constraints.directAnswerRequired) {
    instructions.push('第一颗先给用户问题的明确答案，再补关系和情绪内容。');
  }
  if (constraints.careReceptionRequired) {
    instructions.push(
      '正文必须明确接纳用户对角色的关心；不要拒收，也不要马上反向叮嘱用户。'
    );
  }
  if (constraints.bubbleRoles?.length) {
    instructions.push(
      `可参考这些内容作用：${constraints.bubbleRoles
        .map(role => REVISION_BUBBLE_ROLE_LABELS[role])
        .join('、')}；不要求固定顺序，也不要求拆成同等数量的气泡。`
    );
  }
  if (constraints.requiredActs?.length) {
    instructions.push(
      `修订时优先保住这些核心作用：${constraints.requiredActs
        .map(role => REVISION_BUBBLE_ROLE_LABELS[role])
        .join('、')}。可以自然合并表达，不要写成逐项清单。`
    );
  }
  if (constraints.questionPolicy === 'none') {
    instructions.push('本轮不允许提问或反问，角色自己完成表达。');
  }
  if (constraints.avoidRecentMoves?.length) {
    instructions.push(
      `避开最近已经重复的动作：${constraints.avoidRecentMoves.join(
        '、'
      )}；不能只做同义改写。`
    );
  }
  if (constraints.avoidLiteralClauses?.length) {
    instructions.push(
      `不得复用这些最近原句：${constraints.avoidLiteralClauses.join('、')}。`
    );
  }
  return instructions;
}

const REVISION_BUBBLE_ROLE_LABELS: Record<
  NonNullable<FinalReplyOutputConstraints['bubbleRoles']>[number],
  string
> = {
  direct_answer: '正面回答',
  receive_care: '接纳关心',
  role_contribution: '角色侧新内容',
  relationship_response: '关系回应',
  boundary_answer: '现实边界回答',
  family_response: '对应人物回应',
  comfort: '情绪承接',
  topic_reaction: '贴题的不同反应',
  repair: '纠正或修复',
  natural_close: '自然收尾',
};

function parseRevision(
  content: string
): Omit<ReplyRevisionResult, 'usage'> | undefined {
  try {
    const parsed = JSON.parse(content) as {
      segments?: unknown;
      claims?: unknown;
      resolvedIssueCodes?: unknown;
    };
    const segments = Array.isArray(parsed.segments)
      ? parsed.segments
          .filter((item): item is string => typeof item === 'string')
          .map(item => item.trim())
          .filter(Boolean)
          .slice(0, 3)
      : [];
    const claims = Array.isArray(parsed.claims)
      ? parsed.claims.filter(isAssistantFactClaim)
      : [];
    const resolvedIssueCodes = Array.isArray(parsed.resolvedIssueCodes)
      ? parsed.resolvedIssueCodes
          .filter((item): item is string => typeof item === 'string')
          .map(item => item.trim())
          .filter(Boolean)
      : [];

    return segments.length
      ? { segments, claims, resolvedIssueCodes }
      : undefined;
  } catch {
    return undefined;
  }
}

function isAssistantFactClaim(value: unknown): value is AssistantFactClaim {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const claim = value as Partial<AssistantFactClaim>;
  return (
    typeof claim.text === 'string' &&
    typeof claim.kind === 'string' &&
    Array.isArray(claim.evidenceIds) &&
    claim.evidenceIds.every(item => typeof item === 'string')
  );
}
