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

  it('exposes the tool for short factual questions without the semantic planner', () => {
    const plan = resolveAgentChatToolTurnPlan({
      config: { mode: 'active', activeSampleRate: 1 },
      stableKey: 'user:conversation:message-factual',
      currentQuery: '奶奶是哪一年走的',
      plannerMemoryRequested: false,
    });
    expect(plan.mode).toBe('active');
    expect(plan.reason).toBe('available');
    expect(plan.availableTools).toEqual(['lookup_chat_evidence']);
  });

  it('keeps the tool off for ordinary short messages', () => {
    const plan = resolveAgentChatToolTurnPlan({
      config: { mode: 'active', activeSampleRate: 1 },
      stableKey: 'user:conversation:message-plain',
      currentQuery: '今天有点想你了',
      plannerMemoryRequested: false,
    });
    expect(plan.mode).toBe('off');
    expect(plan.reason).toBe('planner_context_complete');
    expect(plan.availableTools).toEqual([]);
  });

  it('uses one strict, batched evidence lookup tool', () => {
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
    expect(plan.availableTools).toEqual(['lookup_chat_evidence']);
    expect(buildAgentChatToolDecisionSchema(plan)).toBeDefined();
  });

  it('keeps active mode explicit and independently sampled', () => {
    const riskyBrief = buildReplyBrief({ currentQuery: '我真的不想活了' });
    riskyBrief.riskLevel = 'high';
    const plan = buildPlan({
      config: { mode: 'active', activeSampleRate: 1 },
      replyBrief: riskyBrief,
    });

    expect(plan.mode).toBe('active');
    expect(plan.availableTools).toEqual(['lookup_chat_evidence']);
  });

  it('does not expose active tools when the semantic planner says context is complete', () => {
    // 普通短消息（非事实回忆提问）仍不暴露工具，避免每轮白付 schema 成本。
    const plan = buildPlan({
      config: { mode: 'active', activeSampleRate: 1 },
      currentQuery: '今天有点累，不太想说话',
      replyBrief: buildReplyBrief({ currentQuery: '今天有点累，不太想说话' }),
      plannerMemoryRequested: false,
    });

    expect(plan.mode).toBe('off');
    expect(plan.eligible).toBe(false);
    expect(plan.reason).toBe('planner_context_complete');
    expect(plan.availableTools).toEqual([]);
  });

  it('rejects missing or extra tool arguments instead of repairing them', () => {
    expect(
      normalizeAgentChatToolArguments('lookup_chat_evidence', {
        requests: [
          {
            subjectRef: '爸爸',
            need: '西山',
            sources: ['relationship_memory'],
          },
        ],
        triggerWord: '记得',
      })
    ).toBeNull();
    expect(
      normalizeAgentChatToolArguments('lookup_chat_evidence', {
        requests: [],
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
              need: '西山和秋天',
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
