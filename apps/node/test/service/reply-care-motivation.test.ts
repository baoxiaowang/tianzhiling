import type { AgentEntity } from '@tzl/entities';
import {
  buildReplyCareMotivationPrompt,
  resolveReplyCareMotivationPlan,
} from '../../src/service/agents/reply-care-motivation';
import type { ReplyExperiencePlan } from '../../src/service/agents/reply-experience-plan';

const EXPERIENCE: ReplyExperiencePlan = {
  version: 'experience_plan_v1',
  profileTier: 'P0',
  profileScore: 0,
  profileDimensionCount: 0,
  profileTrustedFactCount: 0,
  relationshipStage: 'R1',
  relationshipMaturity: 'warming',
  relationshipState: 'steady',
  relationshipUserTurnCount: 3,
  relationshipActiveDayCount: 1,
  conversationDepth: 'D1',
  factScope: 'identity_only',
  intimacyLevel: 'warm',
  contributionMode: 'reciprocal',
  memoryPolicy: 'context_only',
  questionPolicy: 'none',
  closurePolicy: 'neutral',
};

describe('reply care motivation', () => {
  it('turns longing into reciprocal role-side affection', () => {
    const plan = resolveReplyCareMotivationPlan({
      currentQuery: '妈，我想你了',
      mode: 'emotional',
      primaryScene: 'miss_longing',
      riskLevel: 'none',
      experiencePlan: EXPERIENCE,
    });

    expect(plan).toMatchObject({
      version: 'care_motivation_v1',
      motive: 'mutual_longing',
      focus: 'reciprocal_bond',
      initiative: 'proactive',
      styleSource: 'relationship_default',
    });
    expect(buildReplyCareMotivationPrompt(plan!)).toContain(
      '结合人物性格、关系位置和最近上下文'
    );
  });

  it('cares about the concrete state instead of appending generic advice', () => {
    const plan = resolveReplyCareMotivationPlan({
      currentQuery: '今天加班累坏了，饭也没吃',
      mode: 'daily',
      riskLevel: 'none',
      experiencePlan: { ...EXPERIENCE, conversationDepth: 'D2' },
    });

    expect(plan).toMatchObject({
      motive: 'protect_current_wellbeing',
      focus: 'current_wellbeing',
    });
    expect(buildReplyCareMotivationPrompt(plan!)).toContain(
      '不按程序分类逐项执行'
    );
  });

  it('uses persona care style as expression source without turning it into fact', () => {
    const agent = {
      personaProfile: { careStyle: '不直说心疼，习惯先问吃饭没有' },
    } as AgentEntity;
    const plan = resolveReplyCareMotivationPlan({
      currentQuery: '我今天心里特别难受',
      mode: 'emotional',
      primaryScene: 'comfort_request',
      riskLevel: 'none',
      agent,
      experiencePlan: EXPERIENCE,
    });

    expect(plan).toMatchObject({
      motive: 'ease_emotional_burden',
      focus: 'user_burden',
      styleSource: 'persona',
    });
  });

  it('does not reopen a simple closing turn', () => {
    expect(
      resolveReplyCareMotivationPlan({
        currentQuery: '妈妈晚安',
        mode: 'daily',
        primaryScene: 'smalltalk',
        riskLevel: 'none',
        experiencePlan: { ...EXPERIENCE, conversationDepth: 'D0' },
      })
    ).toBeUndefined();
  });
});
