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
      plannerMemoryRequested: true,
      ...overrides,
    });

  it('uses a strict schema for the unified evidence lookup tool', () => {
    expect(Object.keys(AGENT_CHAT_TOOL_DEFINITIONS)).toEqual([
      'lookup_chat_evidence',
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

  it('promotes legacy shadow configuration to one executable lookup tool', () => {
    const plan = buildPlan();

    expect(plan).toEqual(
      expect.objectContaining({
        mode: 'active',
        eligible: true,
        sampled: true,
        plannerMemoryRequested: false,
      })
    );
    expect(plan.availableTools).toEqual(['lookup_chat_evidence']);
    expect(buildAgentChatToolDecisionSchema(plan)).toBeUndefined();
  });

  it('keeps empty turns off even when active mode is configured', () => {
    const plan = buildPlan({
      config: { mode: 'active', activeSampleRate: 1 },
      currentQuery: '   ',
    });

    expect(plan.mode).toBe('off');
    expect(plan.availableTools).toEqual([]);
  });

  it('rejects missing or extra tool arguments instead of repairing them', () => {
    expect(
      normalizeAgentChatToolArguments('lookup_chat_evidence', {
        requests: [
          {
            subjectRef: '爸爸',
            need: '以前去过的地方',
            sources: ['relationship_memory'],
            triggerWord: '记得',
          },
        ],
      })
    ).toBeNull();
    expect(
      normalizeAgentChatToolArguments('lookup_chat_evidence', {
        requests: [{ subjectRef: '爸爸', need: '以前去过的地方' }],
      })
    ).toBeNull();
  });

  it('keeps at most two valid shadow decisions and counts invalid items', () => {
    const parsed = normalizeAgentChatToolDecisions([
      {
        name: 'lookup_chat_evidence',
        arguments: {
          requests: [
            {
              subjectRef: '爸爸',
              need: '以前去过的地方',
              sources: ['relationship_memory'],
            },
          ],
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
    expect(parsed.decisions[0].name).toBe('lookup_chat_evidence');
    expect(parsed.invalidCount).toBe(1);
  });
});
