import { AgentContextService } from '../../src/service/agents/agent.context';
import { buildDepartedSystemPrompt } from '../../src/prompt/departed';
import { buildAgentPersonaPrompt } from '../../src/service/agents/agent-persona';
import { buildMainModelConditionalGuidance } from '../../src/service/agents/main-model-conversation-principles';
import {
  AgentEntity,
  AgentSex,
  ConversationEntity,
  MongoObjectId,
} from '@tzl/entities';

/**
 * 提示词合并改造的等价性/结构回归。
 *
 * 覆盖四件事：
 * 1. 身份段与人格段真的合并，且不再渲染空占位；
 * 2. 证据/世界设定/本轮边界真的合并进 `# 证据与边界`，旧标题消失；
 * 3. 条件规则只在命中时进入任务层，稳定段逐字不变；
 * 4. 原有硬约束（虚构边界、远期团聚、现实感知、共同过去证据等）没有在合并中丢失。
 */

function makeService(): AgentContextService {
  const service = new AgentContextService();
  service.messageModel = { find: jest.fn().mockResolvedValue([]) } as never;
  service.retrieveService = {
    retrieveConversationMemories: jest.fn().mockResolvedValue([]),
  } as never;
  service.agentMemoryFactService = {
    listFactsForPrompt: jest.fn().mockResolvedValue([
      { key: 'profile.gender', value: '用户是女生', priority: 3 },
      {
        key: 'profile.taste',
        value: '用户不爱吃辣，禁止说用户爱吃辣',
        priority: 3,
      },
    ]),
  } as never;
  service.agentEmotionStateService = {
    getCurrentState: jest.fn().mockResolvedValue(null),
  } as never;
  return service;
}

function buildConversation(): ConversationEntity {
  const conversation = new ConversationEntity();
  conversation.id = new MongoObjectId('665000000000000000000020');
  conversation.agentId = new MongoObjectId('665000000000000000000010');
  conversation.userId = new MongoObjectId('665000000000000000000001');
  conversation.continuitySummary = '用户此前主要聊到最近睡得晚。';
  return conversation;
}

function buildAgent(overrides: Partial<AgentEntity> = {}): AgentEntity {
  const agent = new AgentEntity();
  agent.id = new MongoObjectId('665000000000000000000010');
  agent.name = '爸爸';
  Object.assign(agent, overrides);
  return agent;
}

async function buildPrompt(options?: {
  currentQuery?: string;
  agent?: AgentEntity;
}): Promise<string> {
  const service = makeService();
  const context = await service.buildConversationContext({
    auth: {
      sub: '665000000000000000000001',
      accountId: '665000000000000000000101',
      account: 'test-account',
      iat: 0,
      exp: 0,
      nonce: 'test-nonce',
    },
    conversation: buildConversation(),
    agent: options?.agent || buildAgent(),
    currentQuery: options?.currentQuery || '现在几点了',
  });
  return String(context.messages[0].content);
}

function stablePrefix(prompt: string): string {
  // 容器标题已删除；稳定段结束于第一个任务层小标题。
  const markers = ['# 本轮条件规则', '# 当前时间与联系间隔'];
  const offsets = markers
    .map(marker => prompt.indexOf(marker))
    .filter(offset => offset >= 0);
  return prompt.slice(0, Math.min(...offsets));
}

describe('prompt consolidation structure', () => {
  it('merges identity and persona into one section without empty placeholders', () => {
    const agent = buildAgent({
      iCallAgent: '爸爸',
      agentCallMe: '湾呐',
      sex: AgentSex.man,
      personaProfile: {
        demographics: { relationshipType: 'father' },
        careStyle: '通过生活细节表达关心',
      } as never,
    });
    const systemPrompt = buildDepartedSystemPrompt({
      userId: '665000000000000000000001',
      agentId: '665000000000000000000010',
      agent,
    });
    const persona = buildAgentPersonaPrompt({
      agent,
      embedInIdentitySection: true,
    });

    expect(systemPrompt).toContain('# 当前角色与关系');
    expect(persona.prompt).not.toContain('# 人格与关系底色');
    expect(persona.prompt).toContain('关系类型：亲子');
    expect(persona.prompt).not.toContain('你现在就是');
    expect(persona.prompt).not.toContain('用户也接受这些叫法');

    // 空值/占位不再出现在身份 JSON 里。
    for (const placeholder of [
      '"realName":"未知"',
      '"preferredName":"未设置"',
      '"relationToUser":"未确认"',
      '"aliases":[]',
    ]) {
      expect(systemPrompt).not.toContain(placeholder);
    }
  });

  it('renders each canonical relationship as one merged guidance line', () => {
    const cases: Array<[string, string]> = [
      ['爸爸', '关系类型：亲子'],
      ['妈妈', '关系类型：亲子'],
      ['爷爷', '关系类型：祖孙'],
      ['女儿', '关系类型：子女'],
      ['老公', '关系类型：伴侣'],
      ['哥哥', '关系类型：手足'],
    ];

    for (const [callName, expected] of cases) {
      const persona = buildAgentPersonaPrompt({
        agent: buildAgent({ iCallAgent: callName, name: callName }),
        embedInIdentitySection: true,
      });

      expect(persona.prompt).toContain(expected);
      // 旧的三行重复结构：姿态 + 类型 + “关系差异锚点”。
      expect(persona.prompt).not.toContain('关系差异锚点');
    }
  });

  it('merges evidence, world policy and turn boundaries into one section', async () => {
    const prompt = await buildPrompt({
      currentQuery: '你还记得我小时候你带我钓鱼吗',
    });

    expect(prompt).toContain('# 证据与边界');
    expect(prompt).toContain('用法：可确认');
    expect(prompt).toContain('世界设定：');
    expect(prompt).toContain('本轮边界：');
    for (const legacy of [
      '# 本轮证据包',
      '# 证据规则',
      '# 世界与证据公共政策',
      '# 本轮必要边界',
    ]) {
      expect(prompt).not.toContain(legacy);
    }
    // 证据数据仍在，且顺序在输出合同之前。
    expect(prompt).toMatch(/\[[A-Z]\d+\|[^\]]+\]/);
    expect(prompt.indexOf('# 证据与边界')).toBeLessThan(
      prompt.indexOf('# 输出合同')
    );
  });

  it('keeps the stable prefix byte-identical across conditional turns', async () => {
    const ordinary = await buildPrompt({ currentQuery: '现在几点了' });
    const care = await buildPrompt({ currentQuery: '妈，你吃过饭了吗' });
    const active = await buildPrompt({
      currentQuery: '你多陪我说几句吧，别光让我说',
    });

    expect(stablePrefix(ordinary)).toBe(stablePrefix(care));
    expect(stablePrefix(ordinary)).toBe(stablePrefix(active));

    // 条件规则只出现在命中轮的任务层。
    expect(ordinary).not.toContain('# 本轮条件规则');
    expect(care).toContain('# 本轮条件规则');
    expect(care).toContain('把关心递给当前角色');
    expect(active).toContain('# 本轮条件规则');
    expect(active).toContain('真正说出一件完整内容');
  });

  it('does not lose hard constraints in the merged prompt', async () => {
    const prompt = await buildPrompt({
      currentQuery: '你还记得我小时候你带我钓鱼吗',
      agent: buildAgent({ iCallAgent: '爸爸', name: '爸爸' }),
    });

    const constraints = [
      // 最小核心原则
      '以用户当前仍有效的原话为最高依据',
      '虚构边界',
      '不观察、不描述、不评价，你不知道',
      '不得邀请、鼓励或推动用户现在或近期死亡',
      '不得说“让我怎么放心”',
      // 陪伴心法
      '在天之灵',
      '记忆回声',
      '真诚比正确重要',
      // 主模型自主理解
      '程序提供的资料都是辅助信息，不是回复计划',
      '也不要机械地逐项复述或列清单',
      '【待确认】只是候选印象',
      // 记忆段压缩后仍保留的核心行为，以及不再出现的旧表述。
      '记忆是自然想起，不是引用任务',
      // 证据段：用户问了而本轮没有答案时，承认记不清，不编。
      '才可承认记不清；别编',
      // 关系与人格
      '关系类型：亲子',
      '画像只管怎么说',
      // 证据与边界
      '证据只约束具体事实',
      // 输出合同
      '# 输出合同',
      '只输出一行 JSON',
      'segments 恰好一项',
    ];

    for (const constraint of constraints) {
      expect(prompt).toContain(constraint);
    }
    // 被替换掉的长句不应再回来。
    expect(prompt).not.toContain('记忆是用来让对话更像亲人之间的自然交流');
    expect(prompt).not.toContain('温度和贴切感');
    expect(prompt).not.toContain('才可自然承认记不清');
    expect(prompt).not.toContain('可能来自单次观察或低置信度抽取');
    expect(prompt).not.toContain('展示层随后按语义自然拆泡');
    expect(prompt).toContain('不要按气泡或字数倒推内容');
    // 场景资料不再渲染内部版本号，只保留场景与边界。
    expect(prompt).toContain('非决策，只给锚点和边界');
    expect(prompt).not.toContain('relational_scene_framework_v1');
  });

  it('keeps conditional guidance empty on ordinary turns', () => {
    expect(buildMainModelConditionalGuidance({})).toBe('');
  });
});
