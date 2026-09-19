import {
  AgentProfileFactEntity,
  MessageEntity,
  MessageRole,
  MessageStatus,
  MessageType,
  MongoObjectId,
} from '@tzl/entities';
import {
  AgentProfileFactService,
  ROLE_FACT_EXTRACTION_SYSTEM_PROMPT,
} from '../../src/service/agents/agent-profile-fact.service';

const USER_ID = new MongoObjectId('665000000000000000000001');
const AGENT_ID = new MongoObjectId('665000000000000000000010');
const CONVERSATION_ID = new MongoObjectId('665000000000000000000020');

function makeMessage(idHex: string, content: string, minute = 0): MessageEntity {
  const message = new MessageEntity();
  Object.assign(message, {
    id: new MongoObjectId(idHex),
    conversationId: CONVERSATION_ID,
    userId: USER_ID,
    agentId: AGENT_ID,
    role: MessageRole.user,
    type: MessageType.text,
    content,
    status: MessageStatus.sent,
    createdAt: new Date(`2026-07-26T08:0${minute}:00.000Z`),
    updatedAt: new Date(`2026-07-26T08:0${minute}:00.000Z`),
  });
  return message;
}

function makeFact(
  messageId: string,
  key: string,
  value: string
): Record<string, unknown> {
  return {
    messageId,
    type: 'memory',
    key,
    value,
    polarity: 'positive',
    confidence: 'extracted',
    priority: 2,
  };
}

function setupService() {
  const service = new AgentProfileFactService();
  const stored = new Map<string, AgentProfileFactEntity>();
  service.logger = { warn: jest.fn(), info: jest.fn() } as never;
  service.factModel = {
    findOne: jest.fn(async ({ where }: any) => {
      const key = `${where.agentId}:${where.key}`;
      return stored.get(key) ?? null;
    }),
    save: jest.fn(async (fact: AgentProfileFactEntity) => {
      if (!fact.id) fact.id = new MongoObjectId();
      stored.set(`${fact.agentId}:${fact.key}`, fact);
      return fact;
    }),
  } as never;
  service.userIdentityMemoryService = {
    recordFromUserMessage: jest.fn(async () => undefined),
  } as never;
  return { service, stored };
}

function batchResponse(facts: Array<Record<string, unknown>>) {
  return {
    content: JSON.stringify(facts),
    response: { choices: [{ finish_reason: 'stop' }] },
  };
}

/** 只统计模型产出的、以 llm. 开头的事实，避开规则抽取器的干扰。 */
function llmFacts(stored: Map<string, AgentProfileFactEntity>) {
  return [...stored.values()].filter(fact => fact.key.startsWith('llm.'));
}

describe('AgentProfileFactService batch extraction (P0-1)', () => {
  it('五条消息一个批次只发一次模型调用，固定系统提示只出现一次，并按 messageId 归属', async () => {
    const { service, stored } = setupService();
    const messages = [
      makeMessage('665000000000000000000101', '我今年58岁', 1),
      makeMessage('665000000000000000000102', '我以前是木匠', 2),
      makeMessage('665000000000000000000103', '我在山东住过', 3),
      makeMessage('665000000000000000000104', '小时候住老房子', 4),
      makeMessage('665000000000000000000105', '我有两个孩子', 5),
    ];
    const facts = messages.map((message, index) =>
      makeFact(String(message.id), `llm.batch_${index}`, `事实${index}`)
    );
    const generateMemoryText = jest
      .fn()
      .mockResolvedValue(batchResponse(facts));
    service.openAIService = {
      isEnabled: jest.fn(() => true),
      generateMemoryText,
    } as never;

    const results = await service.extractAndUpsertBatchFromUserMessages(
      messages.map(message => ({
        message,
        searchableText: message.content,
      }))
    );

    // 改动前：5 条 × 单条调用 = 5 次；改动后：整批 1 次。
    expect(generateMemoryText).toHaveBeenCalledTimes(1);
    const call = generateMemoryText.mock.calls[0][0] as {
      systemPrompt: string;
      prompt: string;
    };
    // 固定系统提示逐字等于单条路径常量，且只发送一次。
    expect(call.systemPrompt).toBe(ROLE_FACT_EXTRACTION_SYSTEM_PROMPT);
    expect(call.systemPrompt.length).toBe(2024);
    // 批量用户提示里带上每条消息的 messageId。
    for (const message of messages) {
      expect(call.prompt).toContain(String(message.id));
    }
    // 五条模型事实全部落库并按 messageId 归属到各自的消息。
    expect(llmFacts(stored)).toHaveLength(5);
    for (const message of messages) {
      expect(
        llmFacts(stored).some(
          fact => String(fact.sourceMessageId) === String(message.id)
        )
      ).toBe(true);
    }
    expect(results).toHaveLength(5);
  });

  it('丢弃 messageId 不属于本批次的事实，绝不猜测归属', async () => {
    const { service, stored } = setupService();
    const messages = [
      makeMessage('665000000000000000000201', '我今年58岁', 1),
      makeMessage('665000000000000000000202', '我以前是木匠', 2),
    ];
    service.openAIService = {
      isEnabled: jest.fn(() => true),
      generateMemoryText: jest.fn().mockResolvedValue(
        batchResponse([
          makeFact(String(messages[0].id), 'llm.keep_valid', '属于本批次'),
          makeFact(
            '665000000000000000000999',
            'llm.drop_foreign',
            '不属于本批次'
          ),
          { type: 'memory', key: 'llm.drop_null', value: '没有归属' },
        ])
      ),
    } as never;

    const results = await service.extractAndUpsertBatchFromUserMessages(
      messages.map(message => ({ message, searchableText: message.content }))
    );

    const keys = llmFacts(stored).map(fact => fact.key);
    expect(keys).toEqual(['llm.keep_valid']);
    expect(
      String(llmFacts(stored)[0].sourceMessageId)
    ).toBe(String(messages[0].id));
    // 第二条消息没有任何模型事实归属，落库条数来自规则抽取（可能为 0）。
    expect(results[1].facts.filter(f => f.key.startsWith('llm.'))).toEqual([]);
  });

  it('解析失败时回退到逐条调用（一次批量 + 每条一次，有界不递归）', async () => {
    const { service, stored } = setupService();
    const messages = [
      makeMessage('665000000000000000000301', '我今年58岁', 1),
      makeMessage('665000000000000000000302', '我以前是木匠', 2),
      makeMessage('665000000000000000000303', '我在山东住过', 3),
    ];
    let batchCalls = 0;
    const generateMemoryText = jest.fn(
      async (request: { prompt: string }) => {
        if (request.prompt.includes('消息列表：')) {
          batchCalls += 1;
          return { content: '这不是 JSON', response: { choices: [] } };
        }
        return batchResponse([
          {
            type: 'memory',
            key: `llm.single_${generateMemoryText.mock.calls.length}`,
            value: '单条结果',
            confidence: 'extracted',
          },
        ]);
      }
    );
    service.openAIService = {
      isEnabled: jest.fn(() => true),
      generateMemoryText,
    } as never;

    const results = await service.extractAndUpsertBatchFromUserMessages(
      messages.map(message => ({ message, searchableText: message.content }))
    );

    expect(batchCalls).toBe(1);
    // 1 次批量 + 3 次逐条（不是 1 + 3 再重试批量）。
    expect(generateMemoryText).toHaveBeenCalledTimes(4);
    expect(llmFacts(stored)).toHaveLength(3);
    expect(results).toHaveLength(3);
  });

  it('输出被截断时同样回退逐条，不解析半截 JSON', async () => {
    const { service, stored } = setupService();
    const messages = [
      makeMessage('665000000000000000000401', '我今年58岁', 1),
      makeMessage('665000000000000000000402', '我以前是木匠', 2),
    ];
    const generateMemoryText = jest.fn(
      async (request: { prompt: string }) => {
        if (request.prompt.includes('消息列表：')) {
          return {
            content: '[{"messageId":"x","type":"memory","key":"truncated"',
            response: { choices: [{ finish_reason: 'length' }] },
          };
        }
        return batchResponse([
          {
            type: 'memory',
            key: `llm.single_${generateMemoryText.mock.calls.length}`,
            value: '单条结果',
            confidence: 'extracted',
          },
        ]);
      }
    );
    service.openAIService = {
      isEnabled: jest.fn(() => true),
      generateMemoryText,
    } as never;

    await service.extractAndUpsertBatchFromUserMessages(
      messages.map(message => ({ message, searchableText: message.content }))
    );

    // 1 次批量（截断）+ 2 次逐条。
    expect(generateMemoryText).toHaveBeenCalledTimes(3);
    expect(llmFacts(stored)).toHaveLength(2);
  });

  it('只有一条消息需要模型时不走批量提示', async () => {
    const { service, stored } = setupService();
    const message = makeMessage('665000000000000000000501', '我今年58岁', 1);
    const generateMemoryText = jest.fn().mockResolvedValue(
      batchResponse([
        {
          type: 'memory',
          key: 'llm.single_only',
          value: '单条结果',
          confidence: 'extracted',
        },
      ])
    );
    service.openAIService = {
      isEnabled: jest.fn(() => true),
      generateMemoryText,
    } as never;

    await service.extractAndUpsertBatchFromUserMessages([
      { message, searchableText: message.content },
    ]);

    expect(generateMemoryText).toHaveBeenCalledTimes(1);
    const call = generateMemoryText.mock.calls[0][0] as { prompt: string };
    expect(call.prompt).not.toContain('消息列表：');
    expect(call.prompt).toContain('文本：我今年58岁');
    expect(llmFacts(stored)).toHaveLength(1);
  });

  it('无事实信号的消息不触发模型调用（批量为的是少发提示，不是无脑调用）', async () => {
    const { service, stored } = setupService();
    const messages = [
      makeMessage('665000000000000000000601', '嗯嗯', 1),
      makeMessage('665000000000000000000602', '好的', 2),
    ];
    const generateMemoryText = jest.fn();
    service.openAIService = {
      isEnabled: jest.fn(() => true),
      generateMemoryText,
    } as never;

    const results = await service.extractAndUpsertBatchFromUserMessages(
      messages.map(message => ({ message, searchableText: message.content }))
    );

    expect(generateMemoryText).not.toHaveBeenCalled();
    expect(results.map(result => result.total)).toEqual([0, 0]);
    expect(stored.size).toBe(0);
  });

  it('同一批次重跑幂等，不重复写', async () => {
    const { service, stored } = setupService();
    const messages = [
      makeMessage('665000000000000000000701', '我今年58岁', 1),
      makeMessage('665000000000000000000702', '我以前是木匠', 2),
    ];
    service.openAIService = {
      isEnabled: jest.fn(() => true),
      generateMemoryText: jest.fn().mockResolvedValue(
        batchResponse(
          messages.map((message, index) =>
            makeFact(String(message.id), `llm.repeat_${index}`, `事实${index}`)
          )
        )
      ),
    } as never;

    const batch = messages.map(message => ({
      message,
      searchableText: message.content,
    }));
    await service.extractAndUpsertBatchFromUserMessages(batch);
    await service.extractAndUpsertBatchFromUserMessages(batch);

    expect(llmFacts(stored)).toHaveLength(2);
  });

  it('输出全部缺少合法 messageId 时视为格式失败并回退逐条', async () => {
    const { service, stored } = setupService();
    const messages = [
      makeMessage('665000000000000000000901', '我今年58岁', 1),
      makeMessage('665000000000000000000902', '我以前是木匠', 2),
    ];
    const generateMemoryText = jest.fn(
      async (request: { prompt: string }) => {
        if (request.prompt.includes('消息列表：')) {
          return batchResponse([
            { type: 'memory', key: 'llm.no_id', value: '没有归属' },
            makeFact(
              '665000000000000000000999',
              'llm.foreign_id',
              '不属于本批次'
            ),
          ]);
        }
        return batchResponse([
          {
            type: 'memory',
            key: `llm.single_${generateMemoryText.mock.calls.length}`,
            value: '单条结果',
            confidence: 'extracted',
          },
        ]);
      }
    );
    service.openAIService = {
      isEnabled: jest.fn(() => true),
      generateMemoryText,
    } as never;

    await service.extractAndUpsertBatchFromUserMessages(
      messages.map(message => ({ message, searchableText: message.content }))
    );

    // 1 次批量（全部归属非法）+ 2 次逐条。
    expect(generateMemoryText).toHaveBeenCalledTimes(3);
    expect(llmFacts(stored)).toHaveLength(2);
  });

  it('单条路径仍是一条一次调用（对照组）', async () => {
    const { service } = setupService();
    const generateMemoryText = jest.fn().mockResolvedValue(
      batchResponse([
        {
          type: 'memory',
          key: 'llm.single_control',
          value: '单条结果',
          confidence: 'extracted',
        },
      ])
    );
    service.openAIService = {
      isEnabled: jest.fn(() => true),
      generateMemoryText,
    } as never;

    for (const index of [1, 2, 3, 4, 5]) {
      await service.extractAndUpsertFromUserMessage({
        message: makeMessage(
          `66500000000000000000080${index}`,
          '我今年58岁',
          index
        ),
        searchableText: '我今年58岁',
      });
    }

    expect(generateMemoryText).toHaveBeenCalledTimes(5);
  });
});
