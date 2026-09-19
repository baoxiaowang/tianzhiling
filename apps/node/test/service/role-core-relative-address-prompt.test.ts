import {
  AgentEntity,
  MongoObjectId,
  UserRelativeLifeStage,
} from '@tzl/entities';
import {
  buildAgentIdentityContract,
  buildAgentIdentityPrompt,
} from '../../src/service/agents/agent-identity-contract';

const AGENT_ID = new MongoObjectId('665000000000000000000010');

function buildAgent() {
  return Object.assign(new AgentEntity(), {
    id: AGENT_ID,
    name: '爷爷',
    iCallAgent: '爷爷',
    agentCallMe: '孙女',
  } as AgentEntity);
}

function relative(
  id: string,
  relationToUser: string,
  preferredName: string
): {
  id: string;
  preferredName: string;
  aliases: string[];
  relationToUser: string;
  lifeStage: UserRelativeLifeStage;
  facts: [];
  nameKnown: boolean;
  nameInquiryCount: number;
} {
  return {
    id,
    preferredName,
    aliases: [],
    relationToUser,
    lifeStage: 'adult',
    facts: [],
    nameKnown: true,
    nameInquiryCount: 0,
  };
}

function knownPerson(
  id: string,
  relationToUser: string,
  preferredName: string,
  personCallsUser?: string
) {
  return {
    id,
    preferredName,
    aliases: [] as string[],
    relationToUser,
    ...(personCallsUser ? { personCallsUser } : {}),
  };
}

describe('relative address rendering in the identity prompt', () => {
  it('renders a family member addressing the user, attributed to that person', () => {
    const identity = buildAgentIdentityContract({
      agent: buildAgent(),
      knownPeople: [knownPerson('person:1', '爸爸', '爸爸', '湾呐')],
      relatives: [relative('person:1', '爸爸', '爸爸')],
    });

    const prompt = buildAgentIdentityPrompt(identity);
    expect(prompt).toContain('平时叫你湾呐');
    expect(prompt).toContain('爸爸');

    // 不并入 user 对象，也不冒充用户正式姓名/别名。
    expect(identity.user.aliases).not.toContain('湾呐');
    expect(identity.user.realName).toBeUndefined();
    expect(identity.user.preferredName).toBeUndefined();
    // 但 knownPeople 条目按 personId 带上该家人自己的叫法。
    expect(identity.knownPeople?.[0]).toMatchObject({
      id: 'person:1',
      personCallsUser: '湾呐',
    });
  });

  it('does not render a known person who is not scoped to the current role', () => {
    const identity = buildAgentIdentityContract({
      agent: buildAgent(),
      knownPeople: [knownPerson('person:1', '爸爸', '爸爸', '湾呐')],
      relatives: [],
    });

    const prompt = buildAgentIdentityPrompt(identity);
    expect(prompt).not.toContain('湾呐');
    // 已知人物条目不渲染未作用域到当前角色的 personCallsUser。
    expect(prompt).not.toContain('personCallsUser');
  });

  it('keeps two unconfirmed relations separate instead of merging them', () => {
    const identity = buildAgentIdentityContract({
      agent: buildAgent(),
      knownPeople: [
        knownPerson('person:1', '婆婆', '婆婆', '大宝'),
        knownPerson('person:2', '奶奶', '奶奶', '小宝'),
      ],
      relatives: [
        relative('person:1', '婆婆', '婆婆'),
        relative('person:2', '奶奶', '奶奶'),
      ],
    });

    const prompt = buildAgentIdentityPrompt(identity);
    // 两个人的叫法各自归属，不因为称谓相近而合并。
    expect(prompt).toContain('婆婆（婆婆）平时叫你大宝');
    expect(prompt).toContain('奶奶（奶奶）平时叫你小宝');
    expect(prompt).not.toContain('婆婆（婆婆）平时叫你小宝');
    expect(identity.knownPeople?.[0].personCallsUser).toBe('大宝');
    expect(identity.knownPeople?.[1].personCallsUser).toBe('小宝');
    // 未证实称谓的歧义说明仍在。
    expect(prompt).toContain('不得合并成同一个人');
    // 用户正式姓名/别名不受影响。
    expect(identity.user.aliases).toEqual([]);
    expect(identity.user.realName).toBeUndefined();
  });

  it('keeps user aliases from global identity untouched', () => {
    const identity = buildAgentIdentityContract({
      agent: buildAgent(),
      userIdentity: { formerNames: ['赵小洁'], aliases: ['小洁'] },
      knownPeople: [knownPerson('person:1', '爸爸', '爸爸', '湾呐')],
      relatives: [relative('person:1', '爸爸', '爸爸')],
    });

    expect(identity.user.aliases).toEqual(['赵小洁', '小洁']);
    expect(identity.user.aliases).not.toContain('湾呐');
  });
});
