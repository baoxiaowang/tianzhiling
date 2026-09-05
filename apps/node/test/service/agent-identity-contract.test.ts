import {
  AgentEntity,
  AgentProfileFactAssertionPolicy,
  AgentProfileFactConfidence,
  AgentProfileFactPolarity,
  AgentProfileFactStatus,
  AgentProfileFactType,
  AgentSex,
  MongoObjectId,
  UserRelativeFactDomain,
  UserRelativeFactStatus,
} from '@tzl/entities';
import {
  buildAgentIdentityContract,
  buildAgentIdentityPrompt,
  buildKnownConversationObjects,
} from '../../src/service/agents/agent-identity-contract';

describe('agent identity contract', () => {
  it('adds an account-level relative profile as facts rather than reply instructions', () => {
    const identity = buildAgentIdentityContract({
      agent: {
        id: new MongoObjectId('665000000000000000000010'),
        name: '妈妈',
        sex: AgentSex.woman,
        iCallAgent: '妈妈',
        agentCallMe: '女儿',
      } as AgentEntity,
      relatives: [
        {
          id: 'person:665000000000000000000201',
          preferredName: '安安',
          realName: '赵安宁',
          aliases: ['二宝'],
          relationToUser: '女儿',
          relationToAgent: '外孙女',
          personCallsAgent: '外婆',
          lifeStage: 'school_age',
          facts: [
            {
              domain: UserRelativeFactDomain.health,
              key: 'health.fever',
              value: '安安今天发烧',
              status: UserRelativeFactStatus.current,
            },
          ],
        },
      ],
    });

    const prompt = buildAgentIdentityPrompt(identity);
    const objects = buildKnownConversationObjects({ identity });

    expect(prompt).toContain('本轮相关亲人档案');
    expect(prompt).toContain('安安今天发烧');
    expect(prompt).not.toContain('必须询问');
    expect(prompt).not.toContain('应该追问');
    expect(objects[2]).toMatchObject({
      id: 'person:665000000000000000000201',
      label: '安安',
      relationToUser: '女儿',
      relationToAgent: '外孙女',
    });
  });

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
          value:
            '秀兰是用户与当前角色共同的重要家人；具体亲属关系尚未确认，禁止猜测',
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

  it('keeps display names separate from formal names and relationship preferences', () => {
    const baseFact = {
      type: AgentProfileFactType.identity,
      polarity: AgentProfileFactPolarity.positive,
      confidence: AgentProfileFactConfidence.confirmed,
      priority: 3,
      status: AgentProfileFactStatus.active,
      assertionPolicy: AgentProfileFactAssertionPolicy.canAssert,
    };
    const profileFacts = [
      {
        ...baseFact,
        key: 'identity.real_name',
        value: '当前角色正式姓名是赵浩帅',
      },
      {
        ...baseFact,
        key: 'relationship.preferred_agent_name',
        value: '当前用户偏好称呼当前角色为浩浩',
      },
      {
        ...baseFact,
        key: 'user.identity.real_name',
        value: '用户正式姓名是赵浩洁',
      },
      {
        ...baseFact,
        key: 'relationship.preferred_user_name',
        value: '当前用户希望当前角色称呼其为洁洁',
      },
    ];
    const identity = buildAgentIdentityContract({
      agent: {
        name: '弟弟',
        iCallAgent: '弟弟',
        agentCallMe: '姐姐',
      } as AgentEntity,
      profileFacts,
    });

    expect(identity).toMatchObject({
      agent: {
        displayName: '弟弟',
        realName: '赵浩帅',
        aliases: ['浩帅', '浩浩', '帅帅'],
        preferredName: '浩浩',
      },
      user: {
        addressedAs: '洁洁',
        realName: '赵浩洁',
        aliases: ['浩洁', '浩浩', '洁洁'],
        preferredName: '洁洁',
      },
      addresses: {
        userCallsAgent: '浩浩',
        agentCallsUser: '洁洁',
      },
    });
    expect(buildAgentIdentityPrompt(identity)).toContain('"realName":"赵浩帅"');

    const knownObjects = buildKnownConversationObjects({
      identity,
      profileFacts,
    });
    expect(knownObjects[0].aliases).toEqual(
      expect.arrayContaining(['弟弟', '赵浩帅', '浩帅', '浩浩', '帅帅'])
    );
    expect(knownObjects[1].aliases).toEqual(
      expect.arrayContaining(['赵浩洁', '浩洁', '洁洁'])
    );
  });

  it('uses one global user identity across agents while retaining relationship address', () => {
    const identity = buildAgentIdentityContract({
      agent: {
        name: '妈妈',
        iCallAgent: '妈妈',
        agentCallMe: '女儿',
      } as AgentEntity,
      userIdentity: {
        realName: '赵皓洁',
        formerNames: ['赵浩洁'],
        aliases: ['皓洁', '皓皓', '洁洁'],
      },
      profileFacts: [
        {
          type: AgentProfileFactType.identity,
          key: 'user.identity.real_name',
          value: '用户正式姓名是旧关系画像姓名',
          polarity: AgentProfileFactPolarity.positive,
          confidence: AgentProfileFactConfidence.confirmed,
          priority: 3,
        },
      ],
    });

    expect(identity.user).toMatchObject({
      realName: '赵皓洁',
      addressedAs: '女儿',
    });
    expect(identity.user.aliases).toEqual(
      expect.arrayContaining(['赵浩洁', '皓洁', '皓皓', '洁洁'])
    );
    expect(identity.user.realName).not.toBe('旧关系画像姓名');
  });

  it('injects only relevant known people as stable person objects', () => {
    const identity = buildAgentIdentityContract({
      agent: {
        name: '弟弟',
        iCallAgent: '弟弟',
        agentCallMe: '姐姐',
      } as AgentEntity,
      knownPeople: [
        {
          id: 'person:665000000000000000000201',
          realName: '李雨桐',
          aliases: ['大宝'],
          relationToUser: '女儿',
        },
      ],
    });
    const objects = buildKnownConversationObjects({ identity });

    expect(objects[2]).toEqual({
      id: 'person:665000000000000000000201',
      kind: 'family',
      label: '李雨桐',
      aliases: ['李雨桐', '大宝'],
      relationToUser: '女儿',
      assertionPolicy: 'can_assert',
    });
    expect(buildAgentIdentityPrompt(identity)).toContain('本轮相关其他人物');
  });
});
