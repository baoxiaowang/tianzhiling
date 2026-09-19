import { AsyncLocalStorage } from 'async_hooks';
import { ChatSpanEntity, ChatSpanStatus, ChatTraceStage } from '@tzl/entities';
import { ChatTraceService } from '../../src/service/chat-trace.service';

function createService() {
  const service = new ChatTraceService();
  const savedBatches: ChatSpanEntity[][] = [];
  const traceUpdates: Array<{
    filter: Record<string, unknown>;
    update: Record<string, any>;
    options?: Record<string, unknown>;
  }> = [];

  service.logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as any;
  service.spanModel = {
    save: jest.fn(async (spans: ChatSpanEntity[]) => {
      savedBatches.push(spans);
      return spans;
    }),
  } as any;
  service.traceModel = {
    updateOne: jest.fn(async (filter, update, options) => {
      traceUpdates.push({ filter, update, options });
      return { acknowledged: true };
    }),
  } as any;

  return { service, savedBatches, traceUpdates };
}

function flattenSavedBatches(
  savedBatches: ChatSpanEntity[][]
): ChatSpanEntity[] {
  return savedBatches.reduce<ChatSpanEntity[]>(
    (spans, batch) => spans.concat(batch),
    []
  );
}

describe('ChatTraceService', () => {
  it('uses W3C-compatible trace and span identifier widths', () => {
    const { service } = createService();

    expect(service.createTraceId()).toMatch(/^[a-f0-9]{32}$/);
    expect(service.createSpanId()).toMatch(/^[a-f0-9]{16}$/);
  });

  it('keeps nested stage causality and aggregates model tokens once', async () => {
    const { service, savedBatches, traceUpdates } = createService();
    const traceId = service.createTraceId();

    await service.runWithTrace(traceId, () =>
      service.withSpan(ChatTraceStage.contextLoad, 'context.build', () =>
        service.withSpan(
          ChatTraceStage.generate,
          'generate.primary',
          recorder => {
            recorder.setModelUsage({
              model: 'test-chat-model',
              promptTokens: 80,
              completionTokens: 20,
              totalTokens: 100,
            });
            return Promise.resolve('ok');
          }
        )
      )
    );

    const spans = flattenSavedBatches(savedBatches);
    const context = spans.find(span => span.operation === 'context.build');
    const generation = spans.find(
      span => span.operation === 'generate.primary'
    );
    expect(spans).toHaveLength(2);
    expect(generation?.parentSpanId).toBe(context?.spanId);
    expect(spans.every(span => span.traceId === traceId)).toBe(true);
    expect(
      traceUpdates.some(
        item =>
          item.update.$inc?.totalModelCalls === 1 &&
          item.update.$inc?.totalTokens === 100 &&
          item.update.$inc?.['tokensByStage.generate'] === 100
      )
    ).toBe(true);
  });

  it('aggregates cached prompt tokens and tolerates spans written before token fields existed', async () => {
    const { service, savedBatches, traceUpdates } = createService();
    const traceId = service.createTraceId();

    await service.runWithTrace(traceId, async () => {
      // 旧数据：早于 token 字段落地的 span 完全没有 token 字段。
      service.recordCompletedSpan({
        stage: ChatTraceStage.contextLoad,
        operation: 'context.build.legacy',
        startedAt: new Date(Date.now() - 5),
      });
      await service.withSpan(
        ChatTraceStage.generate,
        'generate.primary',
        recorder => {
          recorder.setModelUsage({
            model: 'doubao-character',
            promptTokens: 4000,
            completionTokens: 25,
            totalTokens: 4025,
            cachedPromptTokens: 1500,
          });
          return Promise.resolve();
        }
      );
    });

    const generation = flattenSavedBatches(savedBatches).find(
      span => span.operation === 'generate.primary'
    );
    expect(generation?.cachedPromptTokens).toBe(1500);

    const aggregate = traceUpdates.find(
      item => item.update.$inc?.cachedPromptTokens !== undefined
    );
    expect(aggregate?.update.$inc).toMatchObject({
      totalModelCalls: 1,
      promptTokens: 4000,
      completionTokens: 25,
      totalTokens: 4025,
      cachedPromptTokens: 1500,
    });
    // 旧 span 无 token 时不能出现 NaN。
    expect(Number.isFinite(aggregate?.update.$inc?.totalTokens)).toBe(true);
  });

  it('leaves cache fields unset when the provider reports no cache details', async () => {
    const { service, savedBatches, traceUpdates } = createService();

    await service.runWithTrace(service.createTraceId(), () =>
      service.withSpan(
        ChatTraceStage.generate,
        'generate.primary',
        recorder => {
          recorder.setModelUsage({
            model: 'provider-without-cache-details',
            promptTokens: 100,
            completionTokens: 10,
            totalTokens: 110,
          });
          return Promise.resolve();
        }
      )
    );

    expect(flattenSavedBatches(savedBatches)[0].cachedPromptTokens).toBeUndefined();
    // 未观测到缓存字段时 trace 上也不写 cachedPromptTokens，区别于"命中 0"。
    expect(
      traceUpdates.some(
        item => item.update.$inc?.cachedPromptTokens !== undefined
      )
    ).toBe(false);
  });

  it('records failed stages without swallowing the business error', async () => {
    const { service, savedBatches } = createService();
    const error = Object.assign(new Error('provider timeout'), {
      code: 'MODEL_TIMEOUT',
    });

    await expect(
      service.runWithTrace(service.createTraceId(), () =>
        service.withSpan(ChatTraceStage.generate, 'generate.primary', () => {
          throw error;
        })
      )
    ).rejects.toBe(error);

    expect(flattenSavedBatches(savedBatches)[0]).toEqual(
      expect.objectContaining({
        status: ChatSpanStatus.failed,
        errorCode: 'MODEL_TIMEOUT',
      })
    );
  });

  it('flushes background work independently from the visible reply', async () => {
    const { service, savedBatches } = createService();
    const traceId = service.createTraceId();

    await service.runWithTrace(traceId, async () => {
      await service.withSpan(ChatTraceStage.persistReply, 'persist.reply', () =>
        Promise.resolve()
      );
      await service.runDetachedWithTrace(traceId, () =>
        service.withSpan(ChatTraceStage.asyncWrite, 'async_write.memory', () =>
          Promise.resolve()
        )
      );
    });

    expect(savedBatches).toHaveLength(2);
    expect(
      flattenSavedBatches(savedBatches).map(span => span.operation)
    ).toEqual(['async_write.memory', 'persist.reply']);
  });

  it('limits metadata volume and never requires prompt content', async () => {
    const { service, savedBatches } = createService();
    const inputAttributes = Array.from({ length: 30 }, (_, index) => [
      `field${index}`,
      'x'.repeat(300),
    ]).reduce<Record<string, string>>((attributes, [key, value]) => {
      attributes[key] = value;
      return attributes;
    }, {});

    await service.runWithTrace(service.createTraceId(), () =>
      service.withSpan(
        ChatTraceStage.plan,
        'plan.reply_intent',
        () => Promise.resolve(),
        {
          attributes: inputAttributes,
        }
      )
    );

    const attributes = flattenSavedBatches(savedBatches)[0].attributes || {};
    expect(Object.keys(attributes)).toHaveLength(24);
    expect(String(attributes.field0)).toHaveLength(160);
  });

  const acceptanceCases: Array<{
    name: string;
    stages: ChatTraceStage[];
    modelStage?: ChatTraceStage;
  }> = [
    { name: 'ordinary direct reply', stages: [ChatTraceStage.generate] },
    {
      name: 'short reply strategy injection',
      stages: [ChatTraceStage.plan, ChatTraceStage.generate],
    },
    {
      name: 'semantic planning',
      stages: [
        ChatTraceStage.contextLoad,
        ChatTraceStage.plan,
        ChatTraceStage.generate,
      ],
    },
    {
      name: 'required memory retrieval',
      stages: [
        ChatTraceStage.plan,
        ChatTraceStage.memoryRetrieve,
        ChatTraceStage.generate,
      ],
    },
    {
      name: 'user fact correction',
      stages: [
        ChatTraceStage.plan,
        ChatTraceStage.generate,
        ChatTraceStage.review,
      ],
    },
    {
      name: 'image context',
      stages: [
        ChatTraceStage.contextLoad,
        ChatTraceStage.promptBuild,
        ChatTraceStage.generate,
      ],
    },
    {
      name: 'complex relationship',
      stages: [
        ChatTraceStage.contextLoad,
        ChatTraceStage.plan,
        ChatTraceStage.generate,
      ],
    },
    {
      name: 'deterministic review',
      stages: [ChatTraceStage.generate, ChatTraceStage.review],
    },
    {
      name: 'model review',
      stages: [ChatTraceStage.generate, ChatTraceStage.review],
      modelStage: ChatTraceStage.review,
    },
    {
      name: 'feedback revision',
      stages: [
        ChatTraceStage.generate,
        ChatTraceStage.review,
        ChatTraceStage.revise,
      ],
      modelStage: ChatTraceStage.revise,
    },
    {
      name: 'generation recovery',
      stages: [ChatTraceStage.generate, ChatTraceStage.generate],
    },
    {
      name: 'bubble reflow',
      stages: [
        ChatTraceStage.generate,
        ChatTraceStage.generate,
        ChatTraceStage.persistReply,
      ],
    },
    {
      name: 'multi bubble persistence',
      stages: [ChatTraceStage.generate, ChatTraceStage.persistReply],
    },
    {
      name: 'merged user messages',
      stages: [
        ChatTraceStage.queueWait,
        ChatTraceStage.contextLoad,
        ChatTraceStage.generate,
      ],
    },
    {
      name: 'queue retry',
      stages: [ChatTraceStage.queueWait, ChatTraceStage.generate],
    },
    {
      name: 'discarded stale draft',
      stages: [
        ChatTraceStage.generate,
        ChatTraceStage.queueWait,
        ChatTraceStage.generate,
      ],
    },
    {
      name: 'memory write',
      stages: [ChatTraceStage.generate, ChatTraceStage.asyncWrite],
      modelStage: ChatTraceStage.asyncWrite,
    },
    {
      name: 'partial enrichment write',
      stages: [ChatTraceStage.asyncWrite],
    },
    {
      name: 'final failed reply persistence',
      stages: [ChatTraceStage.generate, ChatTraceStage.persistReply],
    },
    {
      name: 'full planned memory reply',
      stages: [
        ChatTraceStage.queueWait,
        ChatTraceStage.contextLoad,
        ChatTraceStage.plan,
        ChatTraceStage.memoryRetrieve,
        ChatTraceStage.promptBuild,
        ChatTraceStage.generate,
        ChatTraceStage.review,
        ChatTraceStage.persistReply,
        ChatTraceStage.asyncWrite,
      ],
    },
  ];

  it.each(acceptanceCases)(
    'keeps one causal trace for $name',
    async testCase => {
      const { service, savedBatches } = createService();
      const traceId = service.createTraceId();

      await service.runWithTrace(traceId, async () => {
        for (const [index, stage] of testCase.stages.entries()) {
          await service.withSpan(stage, `${stage}.${index}`, recorder => {
            if (stage === (testCase.modelStage || ChatTraceStage.generate)) {
              recorder.setModelUsage({
                model: 'acceptance-model',
                promptTokens: 2,
                completionTokens: 1,
                totalTokens: 3,
              });
            }
            return Promise.resolve();
          });
        }
      });

      const spans = flattenSavedBatches(savedBatches);
      expect(spans).toHaveLength(testCase.stages.length);
      expect(spans.every(span => span.traceId === traceId)).toBe(true);
      expect(
        spans.every(span => span.status === ChatSpanStatus.completed)
      ).toBe(true);
    }
  );

  it('stays inside the AsyncLocalStorage context when tracing is enabled', async () => {
    const { service, savedBatches } = createService();
    service.chatTraceConfig = { enabled: true };
    const traceId = service.createTraceId();

    let observed: string | undefined;
    let observedStage: ChatTraceStage | undefined;
    await service.runWithTrace(traceId, async () => {
      observed = service.getCurrentTraceId();
      await service.withSpan(ChatTraceStage.generate, 'generate.primary', () => {
        observedStage = service.getCurrentStage();
        return Promise.resolve();
      });
    });

    expect(service.isTraceEnabled()).toBe(true);
    expect(observed).toBe(traceId);
    expect(observedStage).toBe(ChatTraceStage.generate);
    expect(flattenSavedBatches(savedBatches)).toHaveLength(1);
  });

  it('skips the AsyncLocalStorage context, trace writes and spans when tracing is disabled', async () => {
    const { service, savedBatches, traceUpdates } = createService();
    service.chatTraceConfig = { enabled: false };

    expect(service.isTraceEnabled()).toBe(false);

    const traceId = await service.ensureTrace({
      conversationId: 'conversation-1',
      userId: 'user-1',
      agentId: 'agent-1',
    });
    expect(traceId).toMatch(/^[a-f0-9]{32}$/);
    expect(traceUpdates).toHaveLength(0);

    let observedTraceId: string | undefined = 'unset';
    let observedStage: ChatTraceStage | undefined = ChatTraceStage.generate;
    const result = await service.runWithTrace(traceId, async () => {
      observedTraceId = service.getCurrentTraceId();
      const nested = await service.withSpan(
        ChatTraceStage.generate,
        'generate.primary',
        recorder => {
          recorder.setResultCode('OK');
          return Promise.resolve('ok');
        }
      );
      observedStage = service.getCurrentStage();
      return nested;
    });

    expect(result).toBe('ok');
    expect(observedTraceId).toBeUndefined();
    expect(observedStage).toBeUndefined();
    expect(savedBatches).toHaveLength(0);
    expect(traceUpdates).toHaveLength(0);
  });

  it('never constructs the AsyncLocalStorage while tracing is disabled', async () => {
    const { service } = createService();
    service.chatTraceConfig = { enabled: false };

    await service.ensureTrace({
      conversationId: 'conversation-1',
      userId: 'user-1',
      agentId: 'agent-1',
    });
    await service.runWithTrace('0'.repeat(32), () => Promise.resolve());
    await service.withSpan(ChatTraceStage.generate, 'generate.primary', () =>
      Promise.resolve()
    );

    // 关键回归：构造 AsyncLocalStorage 会让 Node 全局启用 promise init hook，
    // 关闭追踪时必须连实例都不建，否则整进程每个 promise 都要付 async_hooks 开销。
    expect((service as any).storageInstance).toBeUndefined();
  });

  it('constructs the AsyncLocalStorage lazily once tracing actually runs', async () => {
    const { service } = createService();
    service.chatTraceConfig = { enabled: true };
    expect((service as any).storageInstance).toBeUndefined();

    await service.runWithTrace(service.createTraceId(), () => Promise.resolve());

    expect((service as any).storageInstance).toBeInstanceOf(AsyncLocalStorage);
  });
});
