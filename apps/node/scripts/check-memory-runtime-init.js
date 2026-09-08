'use strict';
// Offline artifact gate: actual compiled providers and Midway injection/lifecycle.
// Storage and unrelated services are adapters; never boot workers or load .env.
const assert = require('assert');
const core = require('@midwayjs/core');
const { MongoObjectId } = require('@tzl/entities');
const { AgentController } = require('../dist/controller/agent.controller');
const { AgentService } = require('../dist/service/agent.service');
const { ConversationService } = require('../dist/service/conversation.service');
const {
  AgentMemoryProfileService,
} = require('../dist/service/agents/agent-memory-profile.service');
const {
  AgentProfileFactService,
} = require('../dist/service/agents/agent-profile-fact.service');
const {
  MemoryValueService,
} = require('../dist/service/agents/memory-value.service');
const {
  MemoryDecisionModelService,
} = require('../dist/service/agents/memory-decision-model.service');

async function check(mode) {
  process.env.NODE_MEMORY_VALUE_MODE = mode;
  const c = new core.MidwayContainer();
  const d = new core.MidwayDecoratorService(c);
  d.aspectService = { interceptPrototypeMethod() {} };
  d.init();
  const base = Object.freeze({
    model: 'chat',
    secondaryFallback: Object.freeze({
      model: 'memory',
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
    name: 'test-parent',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const real = new Set([
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
    )) {
      if (![core.CONFIG_KEY, core.LOGGER_KEY].includes(meta.key)) {
        d.registerPropertyHandler(meta.key, name => ({
          find: async () => (name === 'agentModel' ? [agent] : []),
        }));
      }
    }
    c.bindClass(Cls);
  }
  const stub = { resolveForResponse: v => v };
  for (const Cls of real) {
    for (const [name, meta] of Object.entries(
      core.getPropertyInject(Cls) || {}
    )) {
      const Dep = Reflect.getMetadata('design:type', Cls.prototype, name);
      if (real.has(Dep) || meta.value === 'memoryDecisionModelService')
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
  const contacts = await (await c.getAsync(AgentController)).listAgents();
  assert.strictEqual(contacts.items[0].name, 'test-parent');
  assert(await c.getAsync(ConversationService));
  const model = await c.getAsync(MemoryDecisionModelService);
  assert.strictEqual(model.openAIConfig.model, 'memory');
  assert.strictEqual(base.model, 'chat');
  await c.stop();
  console.log(
    `[MEMORY_RUNTIME_INIT_OK] mode=${mode} contacts=ok chat_dependency=ok`
  );
}
(async () => {
  for (const key of [
    'NODE_MEMORY_PROVIDER',
    'NODE_MEMORY_MODEL',
    'NODE_MEMORY_API_KEY',
    'NODE_MEMORY_BASE_URL',
  ])
    delete process.env[key];
  for (const mode of ['off', 'active', 'shadow']) await check(mode);
})().catch(error => {
  console.error(error.stack);
  process.exitCode = 1;
});
