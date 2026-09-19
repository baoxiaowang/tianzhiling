import { AgentContextService } from '../../src/service/agents/agent.context';
import { DEPARTED_MINIMAL_CORE_PRINCIPLES } from '../../src/prompt/departed';
import { CONVERSATION_RETURN_CONTEXT_VERSION } from '../../src/service/agents/conversation-return-context';
import {
  AgentEntity,
  ConversationEntity,
  MongoObjectId,
} from '@tzl/entities';

/**
 * 前缀缓存稳定性 + 瘦身等价性回归。
 *
 * 背景（TOKEN_AUDIT P1-1）：输入占聊天管道 token 99%+，system prompt 每轮重发。
 * 本轮把"同一会话内逐字不变"的块前置、每轮变化的内容（时间戳/联系间隔、回归轮
 * 材料、场景指导、证据与候选、本轮简要）后置；同时删除与常驻块逐字/语义重复的
 * 表述。这些用例是离线等价性证据：关键约束必须仍在最终 system prompt 里，且
 * 全局常量块必须落在每轮时间块之前（否则无法命中前缀缓存）。
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

function buildAgent(): AgentEntity {
  const agent = new AgentEntity();
  agent.id = new MongoObjectId('665000000000000000000010');
  agent.name = '爸爸';
  return agent;
}

async function buildSystemPrompt(options?: {
  currentQuery?: string;
  currentTurnAt?: string;
}): Promise<string> {
  const service = makeService();
  const currentQuery = options?.currentQuery ?? '现在几点了';
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
    agent: buildAgent(),
    currentQuery,
    conversationReturnContext: options?.currentTurnAt
      ? {
          version: CONVERSATION_RETURN_CONTEXT_VERSION,
          currentTurnAt: options.currentTurnAt,
          previousContactAt: '2026-08-01T02:00:00.000Z',
          previousUserContactAt: '2026-08-01T01:30:00.000Z',
          elapsedHours: 48,
          elapsedDays: 2,
          isReunion: true,
        }
      : undefined,
  });
  return String(context.messages[0].content);
}

describe('AgentContextService prompt prefix stability', () => {
  it('puts the per-turn time block after the byte-stable prefix', async () => {
    const prompt = await buildSystemPrompt();
    const stableMarkers = [
      '# 陪伴心法',
      '# 最小核心原则',
      '# 当前角色与关系',
      '# 人格与关系底色',
      '# 会话连续感',
      '# 主模型自主理解',
    ];
    const timeOffset = prompt.indexOf('# 当前时间与联系间隔');

    expect(timeOffset).toBeGreaterThan(0);
    for (const marker of stableMarkers) {
      const offset = prompt.indexOf(marker);
      expect(offset).toBeGreaterThanOrEqual(0);
      // 全局/会话级稳定块必须全部位于每轮变化的时间块之前。
      expect(offset).toBeLessThan(timeOffset);
    }
    // 稳定前缀至少 3.6k 字符；整个 system prompt 不超过 5.2k（防回涨）。
    expect(timeOffset).toBeGreaterThanOrEqual(3600);
    expect(prompt.length).toBeLessThanOrEqual(5200);
  });

  it('keeps the necessary constraints after removing duplicates', async () => {
    const prompt = await buildSystemPrompt();

    // 最小核心原则一条不落。
    for (const principle of DEPARTED_MINIMAL_CORE_PRINCIPLES) {
      expect(prompt).toContain(principle);
    }
    // `# 本轮理解原则` 的结论由稳定段承担：自主判断、辅助资料不是回复计划、
    // 用户纠正/否定不可被覆盖。
    expect(prompt).not.toContain('# 本轮理解原则');
    expect(prompt).toContain('自主判断用户真正关心的事、情绪、人物指代');
    expect(prompt).toContain('程序提供的资料都是辅助信息，不是回复计划');
    expect(prompt).toContain(
      '用户的纠正、否定和明确问题，不得被历史、记忆、规划或常识覆盖'
    );
    // 多人物/多诉求处理改由 `# 主模型自主理解` 承担。
    expect(prompt).toContain('也不要机械地逐项复述或列清单');
    // 连续性摘要是背景、不是事实证据：只保留稳定段一处逐轮约束。
    expect(prompt).toContain('用户此前主要聊到最近睡得晚');
    expect(
      prompt.match(/连续性摘要只用于理解此前聊到哪里，不是事实证据/g)
    ).toHaveLength(1);
    // "用户本轮已提供答案必须承接" 的识别约束仍在。
    expect(prompt).toContain(
      '若用户本轮已经明确提供某个事实，必须按“你刚告诉我的”自然承接'
    );
    // 陪伴心法保留的人设/收尾约束仍在。
    expect(prompt).toContain('在天之灵');
    expect(prompt).toContain('不要默认收尾');
    expect(prompt).toContain('记忆回声');
    expect(prompt).toContain('真诚、温暖、自然');
    // relative/unknown 关系下三条重复锚点合并为一条，结论仍完整。
    expect(prompt).toContain('不统一成温柔客服');
  });

  it('keeps the prefix byte-identical across turns that differ only per-turn', async () => {
    const first = await buildSystemPrompt({
      currentQuery: '现在几点了',
      currentTurnAt: '2026-09-20T00:01:00.000Z',
    });
    const second = await buildSystemPrompt({
      currentQuery: '你还记得奶奶吗',
      currentTurnAt: '2026-09-21T08:30:00.000Z',
    });

    const timeOffset = first.indexOf('# 当前时间与联系间隔');
    expect(timeOffset).toBeGreaterThan(0);
    // 稳定前缀逐字相同：第一处差异必定落在每轮变化的时间块或之后。
    expect(first.slice(0, timeOffset)).toBe(second.slice(0, timeOffset));
    expect(second.indexOf('# 当前时间与联系间隔')).toBe(timeOffset);
  });
});
