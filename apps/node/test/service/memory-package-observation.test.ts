import { BSON } from 'mongodb';
import { MessageEntity, MongoObjectId } from '@tzl/entities';
import { DataSource } from 'typeorm';
import { writeFileSync } from 'fs';
import { performance } from 'perf_hooks';
import { ConversationService } from '../../src/service/conversation.service';
import { MemoryModuleService } from '../../src/service/memory/memory-module.service';
import {
  beginMemoryObservation,
  boundMemoryObservation,
} from '../../src/service/agents/memory-package-observation';
import { fixture, groupId } from '../fixtures/memory-package-context';

const savedEnv = { ...process.env };
afterEach(() => {
  process.env = { ...savedEnv };
});
function configure(mode: string, scope = '665000000000000000000001') {
  process.env.NODE_MEMORY_MODULE_MODE = mode;
  process.env.NODE_MEMORY_MODULE_USER_IDS = scope;
  delete process.env.NODE_MEMORY_MODULE_SCOPE;
  process.env.NODE_MEMORY_MODULE_PRIMARY = 'legacy_v1';
  process.env.NODE_MEMORY_MODULE_RECALL_ENGINE = 'legacy_v1';
  process.env.NODE_MEMORY_MODULE_SHADOW = 'event_v1';
}

describe('memory package observation', () => {
  it('distinguishes configured off from scope miss without executing recall', () => {
    const service = new MemoryModuleService();
    configure('off');
    expect(
      beginMemoryObservation(
        service.describeSelection('665000000000000000000001')
      )
    ).toMatchObject({
      replyMemoryModuleConfiguredMode: 'off',
      replyMemoryModuleMode: 'off',
      replyMemorySkipReason: 'module_off',
      replyMemoryExecutionStatus: 'not_run',
    });
    configure('shadow', '665000000000000000000099');
    expect(
      beginMemoryObservation(
        service.describeSelection('665000000000000000000001')
      )
    ).toMatchObject({
      replyMemoryModuleConfiguredMode: 'shadow',
      replyMemoryModuleMode: 'off',
      replyMemoryScopeMatched: false,
      replyMemorySkipReason: 'scope_missed',
    });
  });

  it('keeps shadow packages separate, observes failures and leaves primary prompt identical', async () => {
    configure('shadow');
    const { service, options, evidence, packages } = fixture();
    const facade = new MemoryModuleService();
    facade.legacyEngine = {
      capabilities: () => ({ engine: 'legacy_v1' }),
      recall: jest.fn().mockResolvedValue({
        evidence: [],
        status: 'empty',
        diagnostics: {
          engine: 'legacy_v1',
          mode: 'active',
          candidateCount: 0,
          selectedCount: 0,
        },
      }),
    } as never;
    facade.eventEngine = {
      capabilities: () => ({ engine: 'event_v1' }),
      recall: jest.fn().mockResolvedValue({
        evidence,
        packages: packages.map(p => ({
          ...p,
          heat: 0.75,
          originalMemberCount: 2,
        })),
        status: 'ok',
        diagnostics: {
          engine: 'event_v1',
          mode: 'active',
          candidateCount: 2,
          selectedCount: 2,
        },
      }),
    } as never;
    service.memoryModuleService = facade;
    const result = await service.buildConversationContext(options);
    expect(result.diagnostics.memoryObservation).toMatchObject({
      replyMemoryModuleMode: 'shadow',
      replyMemoryShadowStatus: 'ok',
      replyMemoryPackageInjected: false,
      replyMemoryPackageDetails: [
        expect.objectContaining({
          groupId,
          source: 'shadow',
          heat: 0.75,
          stage: 'recalled',
          reason: 'shadow_only',
        }),
      ],
    });
    expect(JSON.stringify(result.messages)).not.toContain(evidence[0].text);
    (facade.eventEngine.recall as jest.Mock).mockRejectedValue(
      new Error('synthetic failure')
    );
    const failed = await service.buildConversationContext(options);
    expect(failed.diagnostics.memoryObservation?.replyMemoryShadowStatus).toBe(
      'failed'
    );
    expect(failed.messages).toEqual(result.messages);
    expect(
      failed.diagnostics.memoryObservation?.replyMemoryLegacyFallback
    ).toBe(false);
  });

  it('observes active injection and empty/failed outcomes', async () => {
    const { service, options } = fixture();
    const result = await service.buildConversationContext(options);
    expect(result.diagnostics.memoryObservation).toMatchObject({
      replyMemoryPackageInjected: true,
      replyMemoryPackageDetails: [
        expect.objectContaining({
          groupId,
          source: 'primary',
          stage: 'injected',
        }),
      ],
    });
    (service.memoryModuleService!.recall as jest.Mock).mockResolvedValue({
      evidence: [],
      status: 'empty',
      diagnostics: {
        engine: 'event_v1',
        mode: 'active',
        candidateCount: 0,
        selectedCount: 0,
      },
    });
    expect(
      (await service.buildConversationContext(options)).diagnostics
        .memoryObservation
    ).toMatchObject({
      replyMemoryExecutionStatus: 'empty',
      replyMemorySkipReason: 'no_package_match',
    });
    (service.memoryModuleService!.recall as jest.Mock).mockRejectedValue(
      new Error('synthetic failure')
    );
    expect(
      (await service.buildConversationContext(options)).diagnostics
        .memoryObservation
    ).toMatchObject({
      replyMemoryExecutionStatus: 'failed',
      replyMemorySkipReason: 'recall_failed',
    });
  });

  it('caps actual BSON size and prioritizes actual injections without losing truncation evidence', () => {
    const snapshot = beginMemoryObservation({
      mode: 'active',
      configuredMode: 'active',
      primary: 'event_v1',
      recallEngine: 'event_v1',
      scopedUserIds: 1,
      scopeMatched: true,
    });
    snapshot.replyMemoryPackageDetails = Array.from({ length: 12 }, (_, i) => ({
      source: 'primary' as const,
      engine: 'event_v1',
      groupId: String(i).padStart(24, '0'),
      members: 8,
      retained: 3,
      heat: 0.9,
      score: 0.8,
      stage: i === 11 ? ('injected' as const) : ('recalled' as const),
      reason: 'capacity_trimmed' as const,
    }));
    const capped = boundMemoryObservation(snapshot);
    expect(capped.replyMemoryPackageDetailsTruncated).toBe(true);
    expect(capped.replyMemoryPackageDetails[0].stage).toBe('injected');
    expect(capped.replyMemoryPackageDetails.length).toBeLessThanOrEqual(4);
    expect(BSON.calculateObjectSize(capped)).toBeLessThanOrEqual(1024);
    capped.replyMemoryPackageDetails.forEach(p =>
      expect(BSON.calculateObjectSize(p)).toBeLessThanOrEqual(256)
    );
  });

  it('records real fallback and allows semantic indexing despite the narrow legacy write switch', async () => {
    configure('active');
    process.env.NODE_MEMORY_MODULE_RECALL_ENGINE = 'event_v1'; // Missing event provider triggers actual fallback.
    const module = new MemoryModuleService();
    module.legacyEngine = {
      capabilities: () => ({ engine: 'legacy_v1' }),
      recall: jest
        .fn()
        .mockResolvedValue({
          evidence: [],
          status: 'empty',
          diagnostics: {
            engine: 'legacy_v1',
            mode: 'active',
            candidateCount: 0,
            selectedCount: 0,
          },
        }),
    } as never;
    const recalled = await module.recall({
      userId: '665000000000000000000001',
      conversationId: 'c',
      agentId: 'a',
      currentUserText: '合成测试',
      currentTurnMessageIds: [],
      limit: 2,
    });
    expect(recalled.diagnostics.legacyFallback).toBe(true);
    process.env.CHAT_SKIP_MEMORY_WRITE = 'true';
    process.env.MEMORY_WRITE_DISABLED = 'false';
    process.env.MILVUS_INDEX_ENABLED = 'true';
    const service = new ConversationService();
    service.memoryPipelineTaskService = {
      enqueueForMessage: jest.fn().mockResolvedValue([]),
    } as never;
    await (service as any).queueMilvusIndexForMessage({
      message: new MessageEntity(),
      searchableText: '去年住院时哥哥每天送饭',
    });
    expect(
      service.memoryPipelineTaskService.enqueueForMessage
    ).toHaveBeenCalledTimes(1);
  });

  it('shadow ingest calls both configured engines: shadow is not read-only', async () => {
    configure('shadow');
    const service = new MemoryModuleService();
    const engine = (name: string) => ({
      capabilities: () => ({ engine: name }),
      ingest: jest.fn().mockResolvedValue({ status: 'accepted', groupIds: [] }),
    });
    const legacy = engine('legacy_v1'),
      shadow = engine('event_v1');
    service.legacyEngine = legacy as never;
    service.eventEngine = shadow as never;
    await service.ingest({
      userId: '665000000000000000000001',
      conversationId: 'c',
      agentId: 'a',
      messages: [],
    });
    expect(legacy.ingest).toHaveBeenCalledTimes(1);
    expect(shadow.ingest).toHaveBeenCalledTimes(1);
  });
});

// Explicit opt-in; never defaults to a remote/production database.
const localMongo = process.env.MEMORY_OBSERVATION_TEST_MONGO;
(localMongo ? describe : describe.skip)(
  'local Mongo persistence and save latency',
  () => {
    it('persists snapshots through real routing/create/save and reads them back', async () => {
      if (localMongo !== 'mongodb://127.0.0.1:27089')
        throw new Error('Only dedicated localhost Mongo allowed');
      const db = new DataSource({
        type: 'mongodb',
        url: localMongo,
        database: 'tzl_memory_observation_test',
        entities: [MessageEntity],
        synchronize: false,
      });
      await db.initialize();
      try {
        const repo = db.getMongoRepository(MessageEntity);
        const service = new ConversationService();
        service.messageModel = repo;
        const f = fixture();
        const context = await f.service.buildConversationContext(f.options);
        const snapshot = context.diagnostics.memoryObservation!;
        const options = {
          conversationId: new MongoObjectId(),
          userId: new MongoObjectId(),
          agentId: new MongoObjectId(),
          replyTime: new Date(),
          replySegments: ['合成测试第一泡', '合成测试第二泡'],
          usage: {},
          routing: { ...context.diagnostics },
        };
        // Later config changes must not rewrite the generation-time snapshot.
        configure('off');
        const saved = await (service as any).createAssistantReplyMessages(
          options
        );
        const read = await repo.find({
          where: { conversationId: options.conversationId },
        });
        expect(read).toHaveLength(2);
        read.forEach(row => {
          expect(row.replyMemoryModuleMode).toBe('active');
          expect(row.replyMemoryPackageInjected).toBe(true);
          expect(row.replyMemoryPackageDetails?.[0].groupId).toBe(groupId);
        });
        const stateDocuments: unknown[] = [];
        for (const mode of ['off', 'shadow']) {
          configure(mode);
          const module = new MemoryModuleService();
          const state = beginMemoryObservation(
            module.describeSelection('665000000000000000000001'),
            'path_not_run'
          );
          const c = new MongoObjectId();
          await (service as any).createAssistantReplyMessages({
            ...options,
            conversationId: c,
            replySegments: ['合成状态验证'],
            routing: { memoryObservation: state },
          });
          const row = await repo.findOne({ where: { conversationId: c } });
          expect(row?.replyMemoryModuleMode).toBe(mode);
          expect(row?.replyMemoryExecutionStatus).toBe('not_run');
          expect(row?.replyMemorySkipReason).toBe(
            mode === 'off' ? 'module_off' : 'path_not_run'
          );
          stateDocuments.push({
            mode: row?.replyMemoryModuleMode,
            status: row?.replyMemoryExecutionStatus,
            reason: row?.replyMemorySkipReason,
          });
        }
        const latencies: Record<string, number[]> = { before: [], after: [] };
        for (let i = 0; i < 110; i++) {
          for (const arm of i % 2 ? ['after', 'before'] : ['before', 'after']) {
            const started = performance.now();
            await (service as any).createAssistantReplyMessages({
              ...options,
              replySegments: ['合成性能测试'],
              routing:
                arm === 'after' ? { memoryObservation: snapshot } : undefined,
            });
            if (i >= 10) latencies[arm].push(performance.now() - started);
          }
        }
        const percentiles = (v: number[]) => {
          const x = [...v].sort((a, b) => a - b);
          return { n: x.length, p50: x[49], p95: x[94] };
        };
        const report = {
          syntheticOnly: true,
          stateDocuments,
          snapshotBytes: BSON.calculateObjectSize(snapshot),
          before: percentiles(latencies.before),
          after: percentiles(latencies.after),
          documents: read.map(row =>
            Object.entries(row)
              .filter(([k]) => k.startsWith('replyMemory'))
              .reduce((out, [k, v]) => ({ ...out, [k]: v }), {})
          ),
          ids: saved.map((row: any) => String(row.id)),
        };
        if (process.env.MEMORY_OBSERVATION_TEST_OUTPUT)
          writeFileSync(
            process.env.MEMORY_OBSERVATION_TEST_OUTPUT,
            JSON.stringify(report, null, 2)
          );
      } finally {
        await db.destroy();
      }
    }, 30000);
  }
);
