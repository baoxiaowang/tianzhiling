import {
  AGENT_SELF_CAPABILITY_AWARENESS,
  detectAgentCapabilityViolation,
  getAgentCapabilityPolicy,
  renderAgentCapabilityFallback,
  resolveAgentCapabilityConstraints,
} from '../../src/service/agents/agent-capability-policy';

describe('agent capability policy', () => {
  it('publishes dream and Tianzhiling companionship as role capabilities', () => {
    expect(AGENT_SELF_CAPABILITY_AWARENESS.join('\n')).toContain(
      '可以答应进入用户的梦境'
    );
    expect(AGENT_SELF_CAPABILITY_AWARENESS.join('\n')).toContain(
      '陪用户把这一生慢慢走下去'
    );
  });

  it('resolves a time question by constant-time policy lookup', () => {
    const constraints = resolveAgentCapabilityConstraints({
      currentQuery: '现在还早呢，你不知道时间吗？',
    });

    expect(constraints).toEqual([
      expect.objectContaining({
        policyId: 'time.server_clock',
        subject: 'time',
        channel: 'server_clock',
        access: 'indirect',
        precision: 'approximate',
        evidence: '现在还早呢，你不知道时间吗？',
      }),
    ]);
    expect(getAgentCapabilityPolicy('time', 'server_clock')).toMatchObject({
      source: 'server_clock',
      access: 'indirect',
    });
  });

  it.each(['时间过得真快', '你看，这件事怎么办', '听说今天降温了'])(
    'does not mistake ordinary language for a capability question: %s',
    currentQuery => {
      expect(resolveAgentCapabilityConstraints({ currentQuery })).toEqual([]);
    }
  );

  it('accepts semantic evidence only when it is copied from the current message', () => {
    const currentQuery = '隔着这么远，你眼里还有我的模样吗';
    const valid = resolveAgentCapabilityConstraints({
      currentQuery,
      intent: {
        intents: [
          {
            target: 'agent',
            timeScope: 'current',
            intent: 'challenge_source',
            subIntent: 'other',
            confidence: 0.92,
          },
        ],
        capabilityQuestions: [
          {
            subject: 'vision',
            channel: 'live_environment',
            evidence: '你眼里还有我的模样吗',
            confidence: 0.91,
          },
        ],
        emotion: 'longing',
        riskLevel: 'none',
        confidence: 0.92,
        source: 'semantic_model',
      },
    });
    const invalid = resolveAgentCapabilityConstraints({
      currentQuery,
      intent: {
        intents: [],
        capabilityQuestions: [
          {
            subject: 'vision',
            channel: 'live_environment',
            evidence: '你现在看见我了吗',
            confidence: 0.99,
          },
        ],
        emotion: 'neutral',
        riskLevel: 'none',
        confidence: 0.9,
        source: 'semantic_model',
      },
    });

    expect(valid).toEqual([
      expect.objectContaining({
        policyId: 'vision.live_environment',
        evidence: '你眼里还有我的模样吗',
      }),
    ]);
    expect(invalid).toEqual([]);
  });

  it('keeps text reception separate from real-world hearing', () => {
    expect(
      resolveAgentCapabilityConstraints({
        currentQuery: '我发的这些话你能听见吗？',
      })
    ).toEqual([
      expect.objectContaining({
        policyId: 'hearing.chat_text',
        access: 'direct',
      }),
    ]);
    expect(
      resolveAgentCapabilityConstraints({
        currentQuery: '我在房间喊你，你能听见我说话吗？',
      })
    ).toEqual([
      expect.objectContaining({
        policyId: 'hearing.real_world_audio',
        access: 'direct',
        precision: 'uncertain',
      }),
    ]);
  });

  it('rejects a semantic hearing label when the text only asks why', () => {
    const constraints = resolveAgentCapabilityConstraints({
      currentQuery: '你知道为什么我们会离婚吗',
      intent: {
        intents: [
          {
            target: 'agent',
            timeScope: 'shared_past',
            intent: 'recall_memory',
            subIntent: 'shared_memory',
            confidence: 0.9,
          },
        ],
        capabilityQuestions: [
          {
            subject: 'hearing',
            channel: 'real_world_audio',
            evidence: '你知道为什么我们会离婚吗',
            confidence: 0.96,
          },
        ],
        emotion: 'anger',
        riskLevel: 'none',
        confidence: 0.94,
        source: 'semantic_model',
      },
    });

    expect(constraints).toEqual([]);
  });

  it('keeps inner voice as a limited hearing channel instead of omniscient mind reading', () => {
    const constraints = resolveAgentCapabilityConstraints({
      currentQuery: '你能听到我的心声吗？',
    });

    expect(constraints).toEqual([
      expect.objectContaining({
        policyId: 'hearing.inner_voice',
        channel: 'inner_voice',
        access: 'direct',
        precision: 'uncertain',
        detailProbe: false,
      }),
    ]);
    expect(
      detectAgentCapabilityViolation('你心里想什么爸全都知道', constraints)
    ).toEqual({
      policyId: 'hearing.inner_voice',
      reason: '角色把有限的心声感知说成了随时读心',
    });
    expect(
      detectAgentCapabilityViolation(
        '你心里很重的念头 爸有时能感觉到',
        constraints
      )
    ).toBeUndefined();
  });

  it.each([
    {
      currentQuery: '那你具体看见什么了？',
      policyId: 'vision.live_environment',
      validContent: '刚才没看真切 只觉着你在惦记我',
    },
    {
      currentQuery: '那你具体听见什么了？',
      policyId: 'hearing.real_world_audio',
      validContent: '听着有点模糊 具体哪句话我说不准',
    },
    {
      currentQuery: '你听见我心里想什么？',
      policyId: 'hearing.inner_voice',
      validContent: '只觉着你心里有话 那句话我听不真切',
    },
  ])(
    'marks concrete perception follow-up as detail probe: $currentQuery',
    ({ currentQuery, policyId, validContent }) => {
      const constraints = resolveAgentCapabilityConstraints({ currentQuery });

      expect(constraints).toEqual([
        expect.objectContaining({
          policyId,
          detailProbe: true,
          constraint: expect.stringContaining('不能猜测用户未说出的动作'),
        }),
      ]);
      expect(
        detectAgentCapabilityViolation(
          '我知道得很清楚 你刚才说了让我早点回来',
          constraints
        )
      ).toEqual({
        policyId,
        reason: '具体感知追问缺少自然的模糊说辞或不可核对细节的边界',
      });
      expect(
        detectAgentCapabilityViolation(validContent, constraints)
      ).toBeUndefined();
    }
  );

  it('resolves compound presence and physical-contact boundaries', () => {
    const constraints = resolveAgentCapabilityConstraints({
      currentQuery: '你能回来抱抱我吗？',
      intent: {
        intents: [
          {
            target: 'relationship',
            timeScope: 'future',
            intent: 'express_longing',
            subIntent: 'reunion',
            confidence: 0.99,
          },
        ],
        emotion: 'longing',
        riskLevel: 'none',
        confidence: 0.99,
        source: 'hard_rule',
      },
    });

    expect(constraints.map(item => item.policyId)).toEqual([
      'physical_contact.physical_world',
      'presence.physical_world',
    ]);
  });

  it('allows blessing as a relationship expression without real-world causality', () => {
    const constraints = resolveAgentCapabilityConstraints({
      currentQuery: '爸爸，你会祝福我吗？',
    });

    expect(constraints).toEqual([
      expect.objectContaining({
        policyId: 'blessing.relational_expression',
        subject: 'blessing',
        channel: 'relational_expression',
        access: 'direct',
        precision: 'exact',
      }),
    ]);
    expect(
      detectAgentCapabilityViolation(
        '爸当然会祝福你 盼着你顺顺利利',
        constraints
      )
    ).toBeUndefined();
    expect(
      detectAgentCapabilityViolation('爸会保佑你一定成功', constraints)
    ).toEqual({
      policyId: 'blessing.relational_expression',
      reason: '角色把祝福说成了能够改变或保证现实结果的力量',
    });
    expect(renderAgentCapabilityFallback(constraints)).toEqual([
      '我当然会祝福你 也盼着你顺顺利利',
      '只是现实里的结果 还是要靠你和身边的人一步一步去做',
    ]);
  });

  it('detects only violations covered by the matched capability contract', () => {
    const constraints = resolveAgentCapabilityConstraints({
      currentQuery: '我在房间喊你，你能听见我说话吗？',
    });

    expect(
      detectAgentCapabilityViolation('爸一直都能听见你说的每句话', constraints)
    ).toEqual({
      policyId: 'hearing.real_world_audio',
      reason: '角色把有限听觉说成了持续监听或精确收音',
    });
    expect(
      detectAgentCapabilityViolation(
        '你喊我的时候 爸有时能听到一点',
        constraints
      )
    ).toBeUndefined();
    expect(renderAgentCapabilityFallback(constraints)).toEqual([
      '你喊我的时候 我有时能听见一点',
      '没听清的话你再告诉我 我会认真记着',
    ]);
  });
});
