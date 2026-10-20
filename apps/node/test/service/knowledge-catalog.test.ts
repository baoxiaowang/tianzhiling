import {
  buildRitualKnowledgePrompt,
  getDreamKnowledge,
  matchRitualKnowledge,
  resetRitualKnowledgeSticky,
  resolveRitualKnowledge,
} from '../../src/service/agents/knowledge/knowledge-catalog';
import { buildDreamCompanionPlanPrompt } from '../../src/service/agents/dream-companion-plan';

describe('knowledge catalog', () => {
  beforeEach(() => resetRitualKnowledgeSticky());

  it('resolves dream guidance by action and prefers stage-specific overrides', () => {
    for (const action of [
      'promise',
      'invite',
      'reconstruct',
      'repair',
      'leave_space',
    ] as const) {
      const entry = getDreamKnowledge({ dreamStage: 'reported', dreamAction: action });
      expect(entry?.key).toContain(`dream.`);
      expect(entry?.short).toBeTruthy();
      expect(entry?.move?.length).toBeGreaterThan(0);
    }

    expect(
      getDreamKnowledge({
        dreamStage: 'verification',
        dreamAction: 'leave_space',
      })?.key
    ).toBe('dream.verification.leave_space');
    expect(
      getDreamKnowledge({
        dreamStage: 'repeated_miss',
        dreamAction: 'leave_space',
      })?.key
    ).toBe('dream.repeated_miss.leave_space');
  });

  it('uses the catalog text in the dream plan prompt', () => {
    const prompt = buildDreamCompanionPlanPrompt({
      dreamStage: 'missed',
      dreamAction: 'repair',
      expectationLevel: 'warm',
      dreamAnchor: 'none',
      realityBoundary: 'dream_only',
    });
    expect(prompt).toContain('先接住没梦见的失落');
  });

  it('matches ritual and festival triggers, with negative patterns', () => {
    expect(matchRitualKnowledge('三七要准备什么')?.key).toBe(
      'ritual.sanqi.custom'
    );
    expect(matchRitualKnowledge('三七粉能吃吗')).toBeUndefined();
    expect(matchRitualKnowledge('清明要不要去扫墓')?.key).toBe(
      'festival.qingming.custom'
    );
    expect(matchRitualKnowledge('今天天气不错')).toBeUndefined();
  });

  it('reuses the matched ritual knowledge for follow-up turns', () => {
    const first = resolveRitualKnowledge({
      conversationId: 'conv-1',
      query: '三七要准备什么',
    });
    expect(first?.key).toBe('ritual.sanqi.custom');

    const followUp = resolveRitualKnowledge({
      conversationId: 'conv-1',
      query: '那还要注意什么',
    });
    expect(followUp?.key).toBe('ritual.sanqi.custom');

    const unrelated = resolveRitualKnowledge({
      conversationId: 'conv-1',
      query: '今天天气不错',
    });
    expect(unrelated).toBeUndefined();
  });

  it('builds a bounded prompt only when an entry matched', () => {
    expect(buildRitualKnowledgePrompt(undefined)).toBe('');
    const prompt = buildRitualKnowledgePrompt(
      matchRitualKnowledge('头七怎么算')
    );
    expect(prompt).toContain('# 相关习俗');
    expect(prompt.length).toBeLessThan(220);
  });
});
