import {
  AgentEntity,
  AgentProfileFactAssertionPolicy,
  AgentProfileFactConfidence,
  AgentProfileFactPolarity,
  AgentProfileFactType,
  AgentSex,
} from '@tzl/entities';
import {
  buildAgentIdentityContract,
  buildAgentIdentityPrompt,
  buildKnownConversationObjects,
} from '../../src/service/agents/agent-identity-contract';

describe('agent identity contract', () => {
  it('keeps explicit role identity ahead of a conflicting derived persona', () => {
    const agent = {
      name: '王建国',
      realName: '王建国',
      sex: AgentSex.man,
      iCallAgent: '爸爸',
      agentCallMe: '闺女',
      personaProfile: {
        demographics: { relationshipType: '哥哥' },
      },
    } as AgentEntity;

    const identity = buildAgentIdentityContract({ agent });

    expect(identity).toMatchObject({
      version: 'agent_identity_v1',
      agent: { objectId: 'agent', displayName: '王建国', sex: '男性' },
      user: { objectId: 'user', addressedAs: '闺女' },
      relationship: {
        label: '爸爸',
        canonical: 'parent',
        generation: 'elder',
        source: 'agent_profile',
      },
    });
    expect(buildAgentIdentityPrompt(identity)).toContain(
      'agent 始终是正在回复的当前角色，user 始终是聊天用户'
    );
  });

  it('creates distinct stable objects for multiple confirmed family members', () => {
    const identity = buildAgentIdentityContract({
      agent: {
        name: '妈妈',
        sex: AgentSex.woman,
        iCallAgent: '妈妈',
        agentCallMe: '闺女',
      } as AgentEntity,
    });
    const baseFact = {
      type: AgentProfileFactType.family,
      polarity: AgentProfileFactPolarity.positive,
      confidence: AgentProfileFactConfidence.confirmed,
      priority: 3,
      assertionPolicy: AgentProfileFactAssertionPolicy.canAssert,
    };
    const objects = buildKnownConversationObjects({
      identity,
      profileFacts: [
        {
          ...baseFact,
          key: 'family.shared_member.小乐',
          value: '小乐是用户和当前角色的儿子',
        },
        {
          ...baseFact,
          key: 'family.shared_member.秀兰',
          value: '秀兰是用户与当前角色共同的重要家人；具体亲属关系尚未确认，禁止猜测',
          assertionPolicy: AgentProfileFactAssertionPolicy.contextOnly,
        },
      ],
    });

    expect(objects.map(object => object.id)).toEqual([
      'agent',
      'user',
      'family.shared_member.小乐',
      'family.shared_member.秀兰',
    ]);
    expect(objects[2]).toMatchObject({
      label: '小乐',
      relationToUser: '儿子',
      assertionPolicy: 'can_assert',
    });
    expect(objects[3]).toMatchObject({
      label: '秀兰',
      assertionPolicy: 'context_only',
    });
    expect(objects[3]).not.toHaveProperty('relationToUser');
  });
});
