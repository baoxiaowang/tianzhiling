import * as core from '@midwayjs/core';
import { MongoObjectId } from '@tzl/entities';
import { AgentController } from '../../src/controller/agent.controller';
import { AgentService } from '../../src/service/agent.service';
import { ConversationService } from '../../src/service/conversation.service';
import { AgentMemoryProfileService } from '../../src/service/agents/agent-memory-profile.service';
import { AgentProfileFactService } from '../../src/service/agents/agent-profile-fact.service';
import { MemoryValueService } from '../../src/service/agents/memory-value.service';
import { MemoryDecisionModelService } from '../../src/service/agents/memory-decision-model.service';

// Real Midway property injection + @Init; unrelated providers/storage are adapters.
// No production configuration, network, model call or business write.
describe('contacts dependency initialization regression', () => {
  const oldMode = process.env.NODE_MEMORY_VALUE_MODE;
  afterEach(() => {
    if (oldMode === undefined) delete process.env.NODE_MEMORY_VALUE_MODE;
    else process.env.NODE_MEMORY_VALUE_MODE = oldMode;
  });
  it.each(['off', 'active', 'shadow'])(
    'loads contacts and chat dependencies with memory %s',
    async mode => {
      process.env.NODE_MEMORY_VALUE_MODE = mode;
      const c = new core.MidwayContainer();
      const d = new core.MidwayDecoratorService(c);
      (d as any).aspectService = { interceptPrototypeMethod() {} };
      (d as any).init();
      const base = Object.freeze({
        model: 'chat-model',
        secondaryFallback: Object.freeze({
          model: 'memory-model',
          apiKey: 'synthetic-key',
          baseURL: 'https://example.invalid',
        }),
      });
      d.registerPropertyHandler(core.CONFIG_KEY, () => base);
      d.registerPropertyHandler(core.LOGGER_KEY, () => ({
        info() {},
        warn() {},
        error() {},
      }));
      const uid = '665000000000000000000001';
      const agent = {
        id: new MongoObjectId(),
        createdUserId: new MongoObjectId(uid),
        name: '爸爸',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const real = new Set<any>([
        AgentController,
        AgentService,
        ConversationService,
        AgentMemoryProfileService,
        AgentProfileFactService,
        MemoryValueService,
        MemoryDecisionModelService,
      ]);
      for (const Cls of real) {
        for (const meta of Object.values(
          core.getClassMetadata(core.INJECT_CUSTOM_PROPERTY, Cls) || {}
        ) as any[]) {
          if (![core.CONFIG_KEY, core.LOGGER_KEY].includes(meta.key)) {
            d.registerPropertyHandler(meta.key, name => ({
              find: async () => (name === 'agentModel' ? [agent] : []),
            }));
          }
        }
        c.bindClass(Cls);
      }
      const stub = { resolveForResponse: (v: string) => v };
      for (const Cls of real) {
        for (const [name, meta] of Object.entries(
          core.getPropertyInject(Cls) || {}
        ) as any) {
          const Dep = Reflect.getMetadata('design:type', Cls.prototype, name);
          if (
            real.has(Dep) ||
            name === 'memoryDecisionModelService' ||
            meta.value === 'memoryDecisionModelService'
          )
            continue;
          if (meta.injectMode === 'Class') {
            c.bindClass(Dep);
            c.registerObject(meta.value, stub);
          } else
            c.registerObject(
              meta.value,
              name === 'ctx' ? { state: { auth: { sub: uid } } } : stub
            );
        }
      }
      const controller = await c.getAsync(AgentController);
      const result = await controller.listAgents();
      expect(result.items).toHaveLength(1);
      expect(result.items[0].name).toBe('爸爸');
      expect(await c.getAsync(ConversationService)).toBeInstanceOf(
        ConversationService
      );
      const model = await c.getAsync(MemoryDecisionModelService);
      expect(
        Object.getOwnPropertyDescriptor(model, 'providerConfig')?.set
      ).toBeUndefined();
      expect(model.providerConfig).toBe(base);
      expect(model.openAIConfig.model).toBe('memory-model');
      expect(base.model).toBe('chat-model');
      await c.stop();
    }
  );
});
