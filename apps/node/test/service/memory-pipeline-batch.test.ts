import {
  AgentEntity,
  MessageEntity,
  MessageStatus,
  MessageType,
  MongoObjectId,
  MemoryPipelineTaskEntity,
  MemoryPipelineTaskKind,
  MemoryPipelineTaskStatus,
} from '@tzl/entities';
import { ConversationService } from '../../src/service/conversation.service';
import { MemoryValueService } from '../../src/service/agents/memory-value.service';

const userId = new MongoObjectId('665000000000000000000001');
const agentId = new MongoObjectId('665000000000000000000002');
const conversationId = new MongoObjectId('665000000000000000000003');

function makeMessage(
  idHex: string,
  content: string,
  idx: number
): MessageEntity {
  const m = new MessageEntity();
  Object.assign(m, {
    id: new MongoObjectId(idHex),
    userId,
    agentId,
    conversationId,
    role: 'user',
    type: MessageType.text,
    content,
    status: MessageStatus.sent,
    isArchived: false,
    createdAt: new Date(`2026-09-08T00:0${idx}:00.000Z`),
    updatedAt: new Date(`2026-09-08T00:0${idx}:00.000Z`),
  });
  return m;
}

function makeTask(
  kind: MemoryPipelineTaskKind,
  messageIds?: string[],
  firstMessageId?: string
): MemoryPipelineTaskEntity {
  const t = new MemoryPipelineTaskEntity();
  Object.assign(t, {
    id: new MongoObjectId('665000000000000000000100'),
    kind,
    status: MemoryPipelineTaskStatus.pending,
    messageId: new MongoObjectId(firstMessageId || messageIds?.[0] || '665000000000000000000010'),
    messageIds: messageIds?.map(id => new MongoObjectId(id)),
    conversationId,
    userId,
    agentId,
    sourceHash: 'testhash',
    attemptCount: 0,
    nextAttemptAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return t;
}

function setupConversationService() {
  const service = new ConversationService();
  const svc = service as any;
  svc.logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };
  svc.stringifyObjectId = (id: any) => (id ? id.toString() : String(id));
  svc.describeReplyError = (e: any) =>
    e instanceof Error ? e.message : String(e);
  return svc;
}

describe('memory-pipeline batch consumer (conversation.service)', () => {
  describe('batch task with N messageIds', () => {
    it('processes all N messages via per-message loop when memoryValueService is not active', async () => {
      const service = setupConversationService();
      const messages = [
        makeMessage('665000000000000000000010', '今天天气不错', 1),
        makeMessage('665000000000000000000011', '我妈喜欢种花', 2),
        makeMessage('665000000000000000000012', '小时候住老房子', 3),
      ];
      const messageIds = messages.map(m => String(m.id));

      service.messageModel = {
        find: jest.fn().mockResolvedValue(messages),
        findOne: jest.fn(),
      };

      const enrichCallArgs: string[] = [];
      service.enrichUserMessageForReply = jest.fn(async (msg: MessageEntity) => {
        enrichCallArgs.push(String(msg.id));
      });
      service.findAgentById = jest.fn(async () => {
        const a = new AgentEntity();
        Object.assign(a, { id: agentId, createdUserId: userId });
        return a;
      });
      service.userRelativeProfileService = {
        listSemanticUnitsForSourceMessage: jest.fn(async () => []),
      };
      service.memoryPipelineTaskService = {
        enqueueForMessage: jest.fn(async () => []),
      };
      // memoryValueService enabled but NOT active → legacy path
      service.memoryValueService = {
        enabled: jest.fn(() => true),
        active: jest.fn(() => false),
        process: jest.fn(),
      };

      const task = makeTask(MemoryPipelineTaskKind.structuredMemory, messageIds);
      const result = await service.executeMemoryPipelineTask(task);

      expect(result).toBe('completed');
      expect(service.messageModel.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            _id: { $in: expect.any(Array) },
            isArchived: { $ne: true },
            status: MessageStatus.sent,
          }),
        })
      );
      expect(enrichCallArgs).toHaveLength(3);
      expect(enrichCallArgs.sort()).toEqual(messageIds.sort());
    });

    it('tries batch LLM extraction first when memoryValueService is active', async () => {
      const service = setupConversationService();
      const messages = [
        makeMessage('665000000000000000000020', '第一条用户消息', 1),
        makeMessage('665000000000000000000021', '第二条用户消息', 2),
      ];
      const messageIds = messages.map(m => String(m.id));

      service.messageModel = {
        find: jest.fn().mockResolvedValue(messages),
        findOne: jest.fn(),
      };
      service.findAgentById = jest.fn(async () => {
        const a = new AgentEntity();
        Object.assign(a, { id: agentId, createdUserId: userId });
        return a;
      });

      const processBatch = jest.fn(async () => ({ count: 2, changedAgents: [] }));
      service.memoryValueService = {
        enabled: jest.fn(() => true),
        active: jest.fn(() => true),
        processBatch,
        process: jest.fn(),
      };

      service.recognizeEmotionStateForUserMessage = jest.fn(async () => undefined);
      service.captureRelationshipOpenLoop = jest.fn(async () => undefined);
      service.memoryPipelineTaskService = {
        enqueueForMessage: jest.fn(async () => []),
      };
      service.agentMemoryProfileService = {
        refreshFromMemoryNow: jest.fn(),
      };

      const task = makeTask(MemoryPipelineTaskKind.structuredMemory, messageIds);
      const result = await service.executeMemoryPipelineTask(task);

      expect(result).toBe('completed');
      expect(processBatch).toHaveBeenCalledTimes(1);
      expect(processBatch).toHaveBeenCalledWith(
        messages,
        ['第一条用户消息', '第二条用户消息'],
        expect.any(AgentEntity)
      );
    });

    it('falls back to per-message loop when batch LLM extraction throws', async () => {
      const service = setupConversationService();
      const messages = [
        makeMessage('665000000000000000000030', '消息一', 1),
        makeMessage('665000000000000000000031', '消息二', 2),
      ];
      const messageIds = messages.map(m => String(m.id));

      service.messageModel = {
        find: jest.fn().mockResolvedValue(messages),
        findOne: jest.fn(),
      };
      service.findAgentById = jest.fn(async () => {
        const a = new AgentEntity();
        Object.assign(a, { id: agentId, createdUserId: userId });
        return a;
      });

      const processBatch = jest.fn(async () => {
        throw new Error('LLM unavailable');
      });
      const process = jest.fn(async () => ({ count: 1, changedAgents: [] }));
      service.memoryValueService = {
        enabled: jest.fn(() => true),
        active: jest.fn(() => true),
        processBatch,
        process,
      };

      service.recognizeEmotionStateForUserMessage = jest.fn(async () => undefined);
      service.captureRelationshipOpenLoop = jest.fn(async () => undefined);
      service.memoryPipelineTaskService = {
        enqueueForMessage: jest.fn(async () => []),
      };
      service.agentMemoryProfileService = {
        refreshFromMemoryNow: jest.fn(),
      };

      const task = makeTask(MemoryPipelineTaskKind.structuredMemory, messageIds);
      const result = await service.executeMemoryPipelineTask(task);

      expect(result).toBe('completed');
      expect(processBatch).toHaveBeenCalledTimes(1);
      expect(process).toHaveBeenCalledTimes(2);
    });

    it('isolates failures: one bad message does not abort the rest', async () => {
      const service = setupConversationService();
      const messages = [
        makeMessage('665000000000000000000040', '正常消息一', 1),
        makeMessage('665000000000000000000041', '正常消息二', 2),
        makeMessage('665000000000000000000042', '正常消息三', 3),
      ];
      const messageIds = messages.map(m => String(m.id));

      service.messageModel = {
        find: jest.fn().mockResolvedValue(messages),
        findOne: jest.fn(),
      };
      service.findAgentById = jest.fn(async () => {
        const a = new AgentEntity();
        Object.assign(a, { id: agentId, createdUserId: userId });
        return a;
      });

      // memoryValueService not enabled → legacy enrich path
      service.memoryValueService = {
        enabled: jest.fn(() => false),
        active: jest.fn(() => false),
      };

      let callCount = 0;
      service.enrichUserMessageForReply = jest.fn(async (msg: MessageEntity) => {
        callCount++;
        if (callCount === 2) throw new Error('DB write failed for msg 2');
      });
      service.userRelativeProfileService = {
        listSemanticUnitsForSourceMessage: jest.fn(async () => []),
      };
      service.memoryPipelineTaskService = {
        enqueueForMessage: jest.fn(async () => []),
      };

      const task = makeTask(MemoryPipelineTaskKind.structuredMemory, messageIds);
      const result = await service.executeMemoryPipelineTask(task);

      expect(result).toBe('completed');
      expect(service.enrichUserMessageForReply).toHaveBeenCalledTimes(3);
      expect(service.logger.warn).toHaveBeenCalled();
    });
  });

  describe('single message task (messageIds empty)', () => {
    it('falls back to original single-message path', async () => {
      const service = setupConversationService();
      const message = makeMessage('665000000000000000000050', '单条消息', 1);

      service.messageModel = {
        findOne: jest.fn().mockResolvedValue(message),
        find: jest.fn(),
      };
      service.findAgentById = jest.fn(async () => {
        const a = new AgentEntity();
        Object.assign(a, { id: agentId, createdUserId: userId });
        return a;
      });

      const process = jest.fn(async () => ({ count: 1, changedAgents: [] }));
      service.memoryValueService = {
        enabled: jest.fn(() => true),
        active: jest.fn(() => true),
        process,
      };

      service.recognizeEmotionStateForUserMessage = jest.fn(async () => undefined);
      service.captureRelationshipOpenLoop = jest.fn(async () => undefined);
      service.memoryPipelineTaskService = {
        enqueueForMessage: jest.fn(async () => []),
      };
      service.agentMemoryProfileService = {
        refreshFromMemoryNow: jest.fn(),
      };

      const task = makeTask(MemoryPipelineTaskKind.structuredMemory, undefined, '665000000000000000000050');
      task.messageIds = undefined;

      const result = await service.executeMemoryPipelineTask(task);

      expect(result).toBe('completed');
      expect(service.messageModel.findOne).toHaveBeenCalled();
      expect(service.messageModel.find).not.toHaveBeenCalled();
      expect(process).toHaveBeenCalledTimes(1);
      expect(process).toHaveBeenCalledWith(message, '单条消息', expect.any(AgentEntity));
    });

    it('returns skipped when message is archived', async () => {
      const service = setupConversationService();
      const message = makeMessage('665000000000000000000060', '已归档', 1);
      message.isArchived = true;

      service.messageModel = {
        findOne: jest.fn().mockResolvedValue(message),
        find: jest.fn(),
      };

      const task = makeTask(MemoryPipelineTaskKind.structuredMemory, undefined, '665000000000000000000060');
      task.messageIds = undefined;

      const result = await service.executeMemoryPipelineTask(task);
      expect(result).toBe('skipped');
    });
  });

  describe('semanticIndex batch', () => {
    it('indexes all messages in the batch to Milvus', async () => {
      const service = setupConversationService();
      const messages = [
        makeMessage('665000000000000000000070', '索引一', 1),
        makeMessage('665000000000000000000071', '索引二', 2),
      ];
      const messageIds = messages.map(m => String(m.id));

      service.messageModel = {
        find: jest.fn().mockResolvedValue(messages),
      };
      const indexConversationMessage = jest.fn(async () => true);
      service.milvusService = { indexConversationMessage };

      const task = makeTask(MemoryPipelineTaskKind.semanticIndex, messageIds);
      const result = await service.executeMemoryPipelineTask(task);

      expect(result).toBe('completed');
      expect(indexConversationMessage).toHaveBeenCalledTimes(2);
    });
  });
});

describe('MemoryValueService.processBatch', () => {
  function setupBatchService(llmResponse: string) {
    const service = new MemoryValueService() as any;
    const userIdLocal = new MongoObjectId('665000000000000000000001');
    const agentLocal = new AgentEntity();
    Object.assign(agentLocal, {
      id: new MongoObjectId('665000000000000000000002'),
      createdUserId: userIdLocal,
      name: '爸爸',
      iCallAgent: '爸爸',
      agentCallMe: '孩子',
    });

    service.agentModel = {
      find: jest.fn(async () => [agentLocal]),
    };
    service.personModel = {
      find: jest.fn(async () => []),
    };
    service.factModel = {
      find: jest.fn(async () => []),
      findOne: jest.fn(async () => null),
      updateOne: jest.fn(async () => ({ modifiedCount: 1 })),
      insertOne: jest.fn(async () => ({})),
    };
    service.messageModel = {
      find: jest.fn(async () => []),
      updateOne: jest.fn(async () => ({ modifiedCount: 1 })),
    };
    service.openAIService = {
      isEnabled: jest.fn(() => true),
      generateText: jest
        .fn()
        // First call: propose. Second call: review.
        .mockResolvedValueOnce({
          content: llmResponse,
          response: { usage: { total_tokens: 100 } },
        })
        .mockResolvedValueOnce({
          content: JSON.stringify({ approved: [0, 1], reasons: [] }),
          response: { usage: { total_tokens: 50 } },
        }),
    };
    service.personTemporalMemoryService = {
      recordExplicitPersonDate: jest.fn(),
      recordAgentDepartureFromMessage: jest.fn(),
    };
    service.userRelativeProfileService = {
      ensureForKnownPerson: jest.fn(),
    };
    service.userIdentityMemoryService = {
      recordApprovedUserIdentity: jest.fn(),
    };

    return { service, agent: agentLocal, userId: userIdLocal };
  }

  it('groups decisions by messageId and upserts per message', async () => {
    const msgId1 = '665000000000000000000101';
    const msgId2 = '665000000000000000000102';
    const agentLocal = '665000000000000000000002';

    const llmResponse = JSON.stringify({
      newPeople: [],
      decisions: [
        {
          subjectRef: `agent:${agentLocal}`,
          participants: [],
          kind: 'person',
          type: 'memory',
          key: 'childhood.school',
          value: '小时候在村口小学读书',
          retention: 'durable',
          certainty: 'explicit',
          timeKind: 'historical',
          operation: 'add',
          reason: '具体童年经历',
          evidence: [{ messageId: msgId1, quote: '村口小学读书' }],
          protected: false,
          salience: 2,
        },
        {
          subjectRef: `agent:${agentLocal}`,
          participants: [],
          kind: 'person',
          type: 'memory',
          key: 'hobbies.fishing',
          value: '喜欢在河边钓鱼',
          retention: 'durable',
          certainty: 'explicit',
          timeKind: 'historical',
          operation: 'add',
          reason: '具体爱好',
          evidence: [{ messageId: msgId2, quote: '河边钓鱼' }],
          protected: false,
          salience: 2,
        },
      ],
    });

    const { service, agent, userId: uid } = setupBatchService(llmResponse);
    const msg1 = new MessageEntity();
    Object.assign(msg1, {
      id: new MongoObjectId(msgId1),
      userId: uid,
      agentId: agent.id,
      conversationId: new MongoObjectId('665000000000000000000003'),
      content: '爸爸小时候在村口小学读书',
      createdAt: new Date('2026-09-08T00:00:00Z'),
    });
    const msg2 = new MessageEntity();
    Object.assign(msg2, {
      id: new MongoObjectId(msgId2),
      userId: uid,
      agentId: agent.id,
      conversationId: new MongoObjectId('665000000000000000000003'),
      content: '他以前喜欢在河边钓鱼',
      createdAt: new Date('2026-09-08T00:01:00Z'),
    });

    const result = await service.processBatch(
      [msg1, msg2],
      ['爸爸小时候在村口小学读书', '他以前喜欢在河边钓鱼'],
      agent
    );

    expect(result.count).toBe(2);
    // One propose call + one review call (durable retention triggers review)
    expect(service.openAIService.generateText).toHaveBeenCalledTimes(2);
    expect(service.messageModel.updateOne).toHaveBeenCalledTimes(2);
    expect(service.factModel.insertOne).toHaveBeenCalledTimes(2);
  });

  it('registers mentioned core relatives as known people', async () => {
    const msgId1 = '665000000000000000000301';
    const llmResponse = JSON.stringify({
      newPeople: [],
      mentionedPeople: [
        { label: '妈妈', relation: '母亲', evidence: [] },
        { label: '儿子', relation: '儿子', evidence: [] },
        { label: '爷爷的姐姐', relation: '爷爷的姐姐', evidence: [] },
        { label: '健楠俺爹', relation: '父亲', evidence: [] },
      ],
      decisions: [],
    });

    const { service, agent, userId: uid } = setupBatchService(llmResponse);
    const upsert = jest.fn(async (_options: any) => ({}));
    service.userIdentityMemoryService = {
      recordApprovedUserIdentity: jest.fn(),
      upsertKnownPersonDeclaration: upsert,
    };
    const msg1 = new MessageEntity();
    Object.assign(msg1, {
      id: new MongoObjectId(msgId1),
      userId: uid,
      agentId: agent.id,
      conversationId: new MongoObjectId('665000000000000000000003'),
      content: '妈妈最近还好，儿子也上幼儿园了',
      createdAt: new Date('2026-09-08T00:00:00Z'),
    });

    await service.processBatch([msg1], ['妈妈最近还好，儿子也上幼儿园了'], agent);

    const relations = upsert.mock.calls.map(
      call => (call[0] as any).declaration.relationToUser
    );
    expect(relations).toContain('母亲');
    expect(relations).toContain('儿子');
    // 第三方关系（“爷爷的姐姐”）不是用户本人的核心亲人，不建档。
    expect(relations).not.toContain('爷爷的姐姐');
    // 把用户名字加训斥语误读成的“称谓”不能当别名建档。
    expect(
      upsert.mock.calls.some(call =>
        ((call[0] as any).declaration.aliases || []).includes('健楠俺爹')
      )
    ).toBe(false);
    // 建档是"出现记录/检索索引"，不是身份判定：按"关系 + 当时的称呼"建索引，
    // 两个不同名字的孙子不会被并成一个人（更早的按关系建键会并）。
    const motherKeys = upsert.mock.calls
      .filter(call => (call[0] as any).declaration.relationToUser === '母亲')
      .map(call => (call[0] as any).declaration.identityKey);
    expect(motherKeys[0]).toBe('母亲|妈妈');
  });

  it('links the agent-backed relative into the person roster', async () => {
    const msgId1 = '665000000000000000000401';
    // agent 的 iCallAgent 是"爸爸"，用户消息里也提到爸爸：这是同一个人。
    const llmResponse = JSON.stringify({
      newPeople: [],
      mentionedPeople: [{ label: '爸爸', relation: '父亲', evidence: [] }],
      decisions: [],
    });
    const { service, agent, userId: uid } = setupBatchService(llmResponse);
    const upsert = jest.fn(async (_options: any) => ({}));
    service.userIdentityMemoryService = {
      recordApprovedUserIdentity: jest.fn(),
      upsertKnownPersonDeclaration: upsert,
    };
    const msg1 = new MessageEntity();
    Object.assign(msg1, {
      id: new MongoObjectId(msgId1),
      userId: uid,
      agentId: agent.id,
      conversationId: new MongoObjectId('665000000000000000000003'),
      content: '爸爸我好想你',
      createdAt: new Date('2026-09-08T00:00:00Z'),
    });

    await service.processBatch([msg1], ['爸爸我好想你'], agent);

    expect(upsert).toHaveBeenCalledTimes(1);
    const declaration = (upsert.mock.calls[0][0] as any).declaration;
    // 人物实体必须存在，并挂到对应 agent 上，避免同一个人两副面孔。
    expect(declaration.relationToUser).toBe('父亲');
    expect(String(declaration.linkedAgentId)).toBe(String(agent.id));
  });

  it('throws when LLM is disabled so caller can fall back', async () => {
    const { service, agent, userId: uid } = setupBatchService('{}');
    service.openAIService.isEnabled = jest.fn(() => false);

    const msg1 = new MessageEntity();
    Object.assign(msg1, {
      id: new MongoObjectId('665000000000000000000201'),
      userId: uid,
      agentId: agent.id,
      conversationId: new MongoObjectId('665000000000000000000003'),
      content: '测试',
      createdAt: new Date(),
    });

    await expect(
      service.processBatch([msg1], ['测试'], agent)
    ).rejects.toThrow('MEMORY_VALUE_MODEL_DISABLED');
  });

  it('returns empty result for empty messages array', async () => {
    const { service, agent } = setupBatchService('{}');
    const result = await service.processBatch([], [], agent);
    expect(result).toEqual({ count: 0, changedAgents: [] });
  });
});
