import { buildReplyBrief } from '../../src/service/agents/reply-brief.service';
import {
  AGENT_CHAT_TOOL_DEFINITIONS,
  buildAgentChatToolDecisionSchema,
  normalizeAgentChatToolArguments,
  normalizeAgentChatToolDecisions,
  resolveAgentChatToolTurnPlan,
} from '../../src/service/agents/agent-chat-tools';

describe('agent chat tools', () => {
  const buildPlan = (overrides: Record<string, unknown> = {}) =>
    resolveAgentChatToolTurnPlan({
      config: { mode: 'shadow', shadowSampleRate: 1 },
      stableKey: 'user:conversation:message',
      currentQuery: '你还记得我们以前去过哪里吗',
      replyBrief: buildReplyBrief({
        currentQuery: '你还记得我们以前去过哪里吗',
      }),
      planningMode: 'semantic',
      planningReason: 'memory_candidate',
      plannerMemoryRequested: true,
      ...overrides,
    });

  it('uses strict schemas for the four narrowly scoped tools', () => {
    expect(Object.keys(AGENT_CHAT_TOOL_DEFINITIONS)).toEqual([
      'search_relationship_memory',
      'get_family_facts',
      'get_persona_evidence',
      'record_user_correction',
    ]);

    for (const tool of Object.values(AGENT_CHAT_TOOL_DEFINITIONS)) {
      const functionTool = tool as Extract<typeof tool, { type: 'function' }>;
      expect(functionTool.function.strict).toBe(true);
      expect(functionTool.function.parameters).toEqual(
        expect.objectContaining({
          type: 'object',
          additionalProperties: false,
        })
      );
    }
  });

  it('samples eligible shadow turns without registering executable tools', () => {
    const plan = buildPlan();

    expect(plan).toEqual(
      expect.objectContaining({
        mode: 'shadow',
        eligible: true,
        sampled: true,
        plannerMemoryRequested: true,
      })
    );
    expect(plan.availableTools).toHaveLength(4);
    expect(buildAgentChatToolDecisionSchema(plan)).toBeDefined();
  });

  it('keeps difficult active scenes on the planner fallback', () => {
    const riskyBrief = buildReplyBrief({ currentQuery: '我真的不想活了' });
    riskyBrief.riskLevel = 'high';
    const plan = buildPlan({
      config: { mode: 'active', activeSampleRate: 1 },
      replyBrief: riskyBrief,
    });

    expect(plan.mode).toBe('planner_fallback');
    expect(plan.availableTools).toEqual([]);
  });

  it('rejects missing or extra tool arguments instead of repairing them', () => {
    expect(
      normalizeAgentChatToolArguments('search_relationship_memory', {
        missingConcepts: ['西山'],
        subjectRef: '爸爸',
        limit: 3,
        triggerWord: '记得',
      })
    ).toBeNull();
    expect(
      normalizeAgentChatToolArguments('search_relationship_memory', {
        missingConcepts: ['西山'],
        subjectRef: '爸爸',
      })
    ).toBeNull();
  });

  it('keeps at most two valid shadow decisions and counts invalid items', () => {
    const parsed = normalizeAgentChatToolDecisions([
      {
        name: 'search_relationship_memory',
        arguments: {
          missingConcepts: ['西山', '秋天'],
          subjectRef: '爸爸',
          limit: 4,
        },
        reason: '上下文缺少共同地点',
      },
      {
        name: 'unknown_tool',
        arguments: {},
        reason: '错误工具',
      },
    ]);

    expect(parsed.decisions).toHaveLength(1);
    expect(parsed.decisions[0].name).toBe('search_relationship_memory');
    expect(parsed.invalidCount).toBe(1);
  });
});
