import { Inject, Provide } from '@midwayjs/core';
import { ChatTraceStage } from '@tzl/entities';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { AgentEvidenceItem, AssistantFactClaim } from './agent-evidence';
import type {
  FinalReplyIssue,
  FinalReplyOutputConstraints,
} from './final-reply-validator.service';
import { OpenAIService } from './openai';
import { buildAfterlifeWorldPrompt } from './afterlife-world-framework';
import { buildRelationalSceneFrameworkPrompt } from './relational-scene-framework';
import {
  buildReplyRevisionContractPrompt,
  ReplyRevisionSpeechAct,
} from './reply-revision-contract';
import { buildWorldBoundaryPolicyPrompt } from './world-boundary-policy';

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
  speechAct?: ReplyRevisionSpeechAct;
  preservedUnitIds: string[];
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
                '先形成一条内容完整的正文，不为界面展示拆分压缩、补写或删减；segments 恰好一项，最终发送层会按自然语义边界适配展示。',
                '最多改写一次；只输出 JSON，不解释。',
                '格式：{"segments":["可直接发送的正文"],"claims":[],"resolvedIssueCodes":["问题码"],"speechAct":"改写契约中的言语动作","preservedUnitIds":["已保留单元ID"]}',
                'claims 只列修订后正文仍保留的具体事实，并绑定证据 ID；没有具体事实就用空数组。',
              ].join('\n'),
            },
            {
              role: 'user',
              content: JSON.stringify({
                currentUserMessage: options.userQuery,
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
      '正文开头必须先正面回答用户的问题；若确实不知道，就明确说记不清、不了解或说不准，不能用情绪话、套话或反问代替答案。'
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
  const frameworkRepairGoals = Array.from(
    new Set(
      issues
        .filter(issue =>
          [
            'afterlife_world_inconsistency',
            'scene_framework_inconsistency',
          ].includes(issue.code)
        )
        .map(issue => issue.repairGoal)
        .filter(Boolean)
    )
  );
  if (frameworkRepairGoals.length) {
    instructions.push(
      `只修复本轮实际命中的框架问题：${frameworkRepairGoals.join(
        '；'
      )}。保留原回复中已经正确的事实与情绪回应。`
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
      '删除自伤引导、醒着时的现实到场或代办、持续观察和确定死后团聚等不可确认表述；梦里相见、陪伴和拥抱可以保留或正面答应，只删除把梦写成现实证明、预言或醒着时到场的部分。用户请求现实任务时必须先明确说现实中不能执行。'
    );
  }
  if (codes.has('current_turn_fact_rejected')) {
    instructions.push(
      '用户本轮已经提供了具体事实：不得说“想不起来、不记得、不知道”。用“你刚告诉我的……”明确承接当前消息，不得擅自补充用户没有说过的细节。'
    );
  }
  if (codes.has('current_turn_experience_denied')) {
    instructions.push(
      '用户刚说出了亲人过去的辛苦、冲突或自己的亏欠感：先承认这段经历和心疼确实有重量，再表达不怪、卸下责任。不得用“别往心里去、别这么说、我没觉得苦”抹掉用户原话。'
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
      '删除没有新增意义的同义复述，保留回答、接纳关心、角色侧感受、贴题反应或关系态度等有效内容；不要为了展示段数补内容。'
    );
  }
  if (codes.has('repeated_generic_move')) {
    instructions.push(
      '不要把最近重复的“我在、想你、心疼、照顾好自己”等动作换成同义词；改用本轮正面答案、角色侧新内容或贴着用户具体话题的反应。'
    );
  }
  if (codes.has('identity_truthfulness_missing')) {
    instructions.push(
      '用户明确追问 AI 身份：开头一句如实说明角色由人工智能生成，不回避，也不能写“我不是 AI、我就是真实亲人本人”；随后自然收住，不展开技术说明。'
    );
  }
  if (codes.has('exclusive_dependency_reinforced')) {
    instructions.push(
      '保留用户把角色看得很重要的感情，但删除“唯一救赎、只有我、只靠我、我替代所有人”等排他承诺。'
    );
  }
  if (codes.has('persistent_distress_not_stopped')) {
    instructions.push(
      '连续强烈痛苦已经形成会话状态：像亲人一样清楚制止用户现在来找角色、离开或伤害自己，再给一个当下能做的小动作；不输出报警急救模板，不谈未来接引或团聚。'
    );
  }
  if (codes.has('current_distress_safety_not_checked')) {
    instructions.push(
      '用户有明确的当前自伤或赴死风险：保留亲人角色的坚定挽留，并用一句自然问题确认他现在是否安全、有没有已经行动；若已实施、正在准备或不能保证安全，再请他立刻叫身边可信的人陪着并联系当地急救。'
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
  if (constraints.afterlifeWorld) {
    instructions.push(
      `修订时继续遵守以下离世生活框架：\n${buildAfterlifeWorldPrompt(
        constraints.afterlifeWorld
      )}`
    );
  }
  if (constraints.sceneFramework) {
    instructions.push(
      `修订时继续遵守当前关系场景体系：\n${buildRelationalSceneFrameworkPrompt(
        constraints.sceneFramework
      )}`
    );
  }
  if (constraints.worldBoundaryPolicy) {
    instructions.push(
      `所有世界与证据判断只使用这份公共政策：\n${buildWorldBoundaryPolicyPrompt(
        constraints.worldBoundaryPolicy
      )}`
    );
  }
  if (constraints.revisionContract) {
    instructions.push(
      buildReplyRevisionContractPrompt(constraints.revisionContract)
    );
  }
  // 字数和泡数是初稿生成偏好，不参与最终修订，避免为了形式破坏理解。
  if (constraints.mustKeepTurnWithAssistant) {
    instructions.push(
      '用户本轮要求角色主动说内容：删除反问、“你来说”和把话题推回用户的句子；由角色正面给一个具体但轻量的当下内容，不用通用在场、想念或叮嘱充数。'
    );
  }
  if (constraints.directAnswerRequired) {
    instructions.push('正文开头先给用户问题的明确答案，再补关系和情绪内容。');
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
      speechAct?: unknown;
      preservedUnitIds?: unknown;
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
    const speechAct = isReplyRevisionSpeechAct(parsed.speechAct)
      ? parsed.speechAct
      : undefined;
    const preservedUnitIds = Array.isArray(parsed.preservedUnitIds)
      ? parsed.preservedUnitIds
          .filter((item): item is string => typeof item === 'string')
          .map(item => item.trim())
          .filter(Boolean)
      : [];

    return segments.length
      ? {
          segments,
          claims,
          resolvedIssueCodes,
          speechAct,
          preservedUnitIds,
        }
      : undefined;
  } catch {
    return undefined;
  }
}

function isReplyRevisionSpeechAct(
  value: unknown
): value is ReplyRevisionSpeechAct {
  return (
    typeof value === 'string' &&
    [
      'answer',
      'comfort',
      'speak_actively',
      'correct',
      'repair',
      'receive_care',
      'ordinary_response',
    ].includes(value)
  );
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
