import {
  AgentEntity,
  AgentProfileFactAssertionPolicy,
  AgentProfileFactConfidence,
  AgentProfileFactPolarity,
  AgentProfileFactType,
  MessageEntity,
  MessageRole,
} from '@tzl/entities';
import type { AgentProfileFactSummary } from '../../src/service/agents/agent-profile-fact.service';
import {
  buildReplyExperiencePlan,
  buildReplyExperiencePlanPrompt,
  constrainConversationPlanForExperience,
} from '../../src/service/agents/reply-experience-plan';

describe('reply experience plan', () => {
  it('keeps a first longing turn in reunion mode even when depth is D1', () => {
    const experience = buildReplyExperiencePlan({
      currentQuery: '就是想你',
      mode: 'relationship',
      primaryScene: 'miss_longing',
      riskLevel: 'none',
    });
    const constrained = constrainConversationPlanForExperience(
      {
        stance: 'tender',
        stanceTarget: 'user',
        moves: [
          { type: 'acknowledge', goal: '接住用户的思念' },
          { type: 'affirm', goal: '回应用户的情感' },
        ],
        socialStrategy: 'direct',
        strategyPurpose: '接住思念并回应温度',
        questionNeed: 'none',
        turnClosure: 'close',
        personaActivation: [],
      },
      experience
    );

    expect(experience).toMatchObject({
      conversationDepth: 'D1',
      relationshipUserTurnCount: 0,
    });
    expect(constrained).toMatchObject({
      questionNeed: 'none',
      turnClosure: 'neutral',
    });
    expect(constrained?.moves[0]).toMatchObject({
      type: 'self_disclose',
    });
  });

  it('keeps a first simple closing turn restrained and minimal', () => {
    const plan = buildReplyExperiencePlan({
      currentQuery: '妈妈晚安',
      mode: 'daily',
      riskLevel: 'none',
    });

    expect(plan).toMatchObject({
      version: 'experience_plan_v1',
      profileTier: 'P0',
      relationshipStage: 'R0',
      relationshipMaturity: 'new',
      conversationDepth: 'D0',
      factScope: 'identity_only',
      intimacyLevel: 'reserved',
      contributionMode: 'minimal',
      memoryPolicy: 'off',
      questionPolicy: 'none',
      closurePolicy: 'close',
    });
  });

  it('recognizes a rich profile and a sustained deep relationship', () => {
    const agent = {
      description: '她一直是家里拿主意的人，关心人时嘴硬心软',
      lifeExperience: '年轻时在纺织厂工作，后来照顾一家人的生活',
      personalityTraits: '爽快、要强，也很护着孩子',
      languageHabits: '句子短，常用反问表达关心',
      hobbies: '喜欢种花和听戏',
      sharedMemories: '每年秋天会一起晒桂花、做桂花糕',
    } as AgentEntity;
    const profileFacts: AgentProfileFactSummary[] = [
      buildFact(
        AgentProfileFactType.memory,
        'memory.autumn.osmanthus',
        '用户和妈妈每年秋天一起晒桂花'
      ),
      buildFact(
        AgentProfileFactType.preference,
        'preference.opera',
        '妈妈喜欢听戏'
      ),
    ];
    const messages = buildRelationshipHistory({
      userTurns: 24,
      activeDays: 3,
      deepAssistantTurns: 4,
    });
    const plan = buildReplyExperiencePlan({
      currentQuery: '妈，你还记得我们晒桂花那年吗',
      agent,
      profileFacts,
      conversationMessages: messages,
      mode: 'memory',
      primaryScene: 'memory_recall',
      riskLevel: 'none',
      intent: {
        intents: [
          {
            target: 'relationship',
            timeScope: 'shared_past',
            intent: 'recall_memory',
            subIntent: 'shared_memory',
            confidence: 0.95,
          },
        ],
        emotion: 'longing',
        riskLevel: 'none',
        confidence: 0.95,
        source: 'semantic_model',
      },
    });

    expect(plan).toMatchObject({
      profileTier: 'P3',
      profileTrustedFactCount: 2,
      relationshipStage: 'R3',
      relationshipMaturity: 'deep',
      conversationDepth: 'D3',
      factScope: 'evidence_backed_memory',
      intimacyLevel: 'deep',
      contributionMode: 'deepen_one_point',
      memoryPolicy: 'evidence_required',
      questionPolicy: 'prefer_one',
      closurePolicy: 'continue',
    });
    expect(buildReplyExperiencePlanPrompt(plan)).toContain('P3/R3/D3');
    expect(buildReplyExperiencePlanPrompt(plan)).toContain(
      '相关时自然带一处有证据的共同记忆'
    );
    expect(buildReplyExperiencePlanPrompt(plan)).toContain(
      '承载理解而非证明身份'
    );
  });

  it('uses R4 only as a transient repair state without losing maturity', () => {
    const plan = buildReplyExperiencePlan({
      currentQuery: '你又在编，越来越不像我妈了',
      conversationMessages: buildRelationshipHistory({
        userTurns: 10,
        activeDays: 2,
        deepAssistantTurns: 2,
      }),
      mode: 'relationship',
      primaryScene: 'authenticity_challenge',
      riskLevel: 'none',
    });

    expect(plan).toMatchObject({
      relationshipStage: 'R4',
      relationshipMaturity: 'familiar',
      relationshipState: 'repairing',
      conversationDepth: 'D4',
      intimacyLevel: 'repairing',
      contributionMode: 'repair_trust',
      questionPolicy: 'none',
      closurePolicy: 'repair_before_close',
    });
  });

  it('keeps simple longing at D1 and a detailed family update at D2', () => {
    const simple = buildReplyExperiencePlan({
      currentQuery: '妈，我想你了',
      conversationMessages: buildRelationshipHistory({
        userTurns: 3,
        activeDays: 1,
        deepAssistantTurns: 0,
      }),
      mode: 'emotional',
      primaryScene: 'miss_longing',
      riskLevel: 'none',
    });
    const detailed = buildReplyExperiencePlan({
      currentQuery: '孩子今天第一次参加比赛，拿了奖牌，回家一路都在笑',
      conversationMessages: [],
      mode: 'family',
      primaryScene: 'family_life',
      riskLevel: 'none',
    });

    expect(simple).toMatchObject({
      relationshipStage: 'R1',
      conversationDepth: 'D1',
      contributionMode: 'reciprocal',
    });
    expect(buildReplyExperiencePlanPrompt(simple)).toContain(
      '事实只用称呼、当前原话和证据；亲密感用关系立场、愿望和理解表达'
    );
    expect(buildReplyExperiencePlanPrompt(simple)).toContain(
      '短而有温度，再给一处亲人侧心意'
    );
    expect(detailed).toMatchObject({
      conversationDepth: 'D2',
      contributionMode: 'role_present',
      questionPolicy: 'optional',
    });
  });

  it('turns a repair plan into action instead of another calibration question', () => {
    const experience = buildReplyExperiencePlan({
      currentQuery: '说了也没用，你还是只会问我该怎么回',
      mode: 'relationship',
      primaryScene: 'authenticity_challenge',
      riskLevel: 'none',
    });
    const constrained = constrainConversationPlanForExperience(
      {
        stance: 'tender',
        stanceTarget: 'user',
        moves: [{ type: 'ask', goal: '问用户希望怎么回复' }],
        socialStrategy: 'save_face',
        strategyPurpose: '修复关系',
        questionNeed: 'necessary',
        turnClosure: 'continue',
        personaActivation: [],
        engagement: {
          userConversationState: 'repairing',
          openLoop: '用户不相信回复会改变',
          continuationGoal: 'repair',
          assistantContribution: 'question',
          mustContribute: '询问用户偏好',
          avoidRepeatingMove: '不要道歉',
          closureReadiness: 'possible',
        },
      },
      experience
    );

    expect(constrained?.moves).toEqual([
      { type: 'acknowledge', goal: '用本轮实际回应修复信任' },
    ]);
    expect(constrained).toMatchObject({
      questionNeed: 'none',
      turnClosure: 'neutral',
      engagement: {
        continuationGoal: 'repair',
        closureReadiness: 'blocked',
      },
    });
  });
});

function buildFact(
  type: AgentProfileFactType,
  key: string,
  value: string
): AgentProfileFactSummary {
  return {
    type,
    key,
    value,
    polarity: AgentProfileFactPolarity.positive,
    confidence: AgentProfileFactConfidence.confirmed,
    priority: 3,
    assertionPolicy: AgentProfileFactAssertionPolicy.canAssert,
    supportCount: 2,
  };
}

function buildRelationshipHistory(options: {
  userTurns: number;
  activeDays: number;
  deepAssistantTurns: number;
}): MessageEntity[] {
  const result: MessageEntity[] = [];
  for (let index = 0; index < options.userTurns; index += 1) {
    result.push({
      role: MessageRole.user,
      content: index % 4 === 0 ? '今天又想起以前的事了' : '今天过得还行',
      createdAt: new Date(
        2026,
        6,
        1 + (index % Math.max(1, options.activeDays))
      ),
    } as MessageEntity);
  }
  for (let index = 0; index < options.deepAssistantTurns; index += 1) {
    result.push({
      role: MessageRole.assistant,
      content: '妈记着你这份想念',
      replyBriefMode: 'emotional',
      createdAt: new Date(2026, 6, 1 + (index % options.activeDays)),
    } as MessageEntity);
  }
  return result;
}
