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
});
