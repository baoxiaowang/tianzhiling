import {
  AgentEntity,
  AgentSex,
  FREE_CHAT_AGENT_LEDGER_POLICY_VERSION,
  FreeChatAgentLedgerEntity,
  FreeChatAgentSlot,
  MongoObjectId,
} from '@tzl/entities';
import {
  FREE_CHAT_AGENT_LIMIT,
  FreeChatAgentEligibilityService,
} from '../../src/service/agents/free-chat-agent-eligibility.service';

const OWNER_ID = '665000000000000000000001';
const OTHER_OWNER_ID = '665000000000000000000002';
const AGENT_IDS = [
  '665000000000000000000010',
  '665000000000000000000011',
  '665000000000000000000012',
  '665000000000000000000013',
];
const NOW = new Date('2026-05-03T08:00:00.000Z');

interface LedgerStore {
  ledger?: FreeChatAgentLedgerEntity;
}

function id(value: unknown): string {
  return typeof value === 'string'
    ? value
    : typeof (value as { toHexString?: unknown })?.toHexString === 'function'
    ? (value as { toHexString(): string }).toHexString()
    : '';
}

function sameSlotList(left: unknown, right: unknown): boolean {
  if (!Array.isArray(left) || !Array.isArray(right)) {
    return false;
  }
  return (
    left.length === right.length &&
    left.every((value, index) => {
      const leftSlot = value as Partial<FreeChatAgentSlot>;
      const rightSlot = right[index] as Partial<FreeChatAgentSlot>;
      return (
        id(leftSlot?.agentId) === id(rightSlot?.agentId) &&
        leftSlot?.createdAt?.getTime?.() === rightSlot?.createdAt?.getTime?.()
      );
    })
  );
}

function slot(agent: AgentEntity): FreeChatAgentSlot {
  return { agentId: agent.id, createdAt: agent.createdAt };
}

function storedAgentIds(store: LedgerStore): string[] {
  return store.ledger?.slots.map(value => id(value.agentId)) ?? [];
}

function createAgent(
  index: number,
  overrides: Partial<AgentEntity> = {}
): AgentEntity {
  const agent = new AgentEntity();
  Object.assign(agent, {
    id: new MongoObjectId(AGENT_IDS[index]),
    createdUserId: new MongoObjectId(OWNER_ID),
    name: `亲友${index + 1}`,
    avatar: '',
    sex: AgentSex.woman,
    status: 1,
    createdAt: new Date(NOW.getTime() + index),
    updatedAt: new Date(NOW.getTime() + index),
    ...overrides,
  });
  return agent;
}

function buildService(
  agents: AgentEntity[],
  options: {
    slots?: unknown;
    ownerId?: string;
    store?: LedgerStore;
  } = {}
) {
  const ownerId = options.ownerId ?? OWNER_ID;
  const store = options.store ?? {};
  if (Object.prototype.hasOwnProperty.call(options, 'slots')) {
    const ledger = new FreeChatAgentLedgerEntity();
    ledger.id = new MongoObjectId(ownerId);
    ledger.userId = new MongoObjectId(ownerId);
    ledger.slots = options.slots as FreeChatAgentSlot[];
    ledger.policyVersion = FREE_CHAT_AGENT_LEDGER_POLICY_VERSION;
    ledger.createdAt = NOW;
    ledger.updatedAt = NOW;
    store.ledger = ledger;
  }

  const service = new FreeChatAgentEligibilityService();
  service.logger = {
    error: jest.fn(),
  } as any;
  service.agentModel = {
    aggregate: jest.fn((pipeline: any[]) => {
      expect(pipeline).toEqual(
        expect.arrayContaining([
          { $sort: { createdAt: 1, _id: 1 } },
          { $limit: FREE_CHAT_AGENT_LIMIT },
        ])
      );
      const ownerMatch = pipeline[0].$match.createdUserId;
      const limit = pipeline.find(stage => stage.$limit)?.$limit;
      const rows = agents
        .filter(
          agent =>
            id(agent.createdUserId) === id(ownerMatch) &&
            !agent.messengerOfAgentId
        )
        .sort((left, right) => {
          const timeDifference =
            (left.createdAt?.getTime?.() ?? 0) -
            (right.createdAt?.getTime?.() ?? 0);
          return timeDifference || id(left.id).localeCompare(id(right.id));
        })
        .slice(0, limit)
        .map(agent => ({ _id: agent.id, createdAt: agent.createdAt }));
      return { toArray: jest.fn().mockResolvedValue(rows) };
    }),
  } as any;
  service.ledgerModel = {
    findOne: jest.fn(async ({ where }: any) =>
      store.ledger && id(where._id) === id(store.ledger.id)
        ? store.ledger
        : null
    ),
    findOneAndUpdate: jest.fn(
      async (query: any, update: any, writeOptions: any) => {
        if (!store.ledger) {
          if (!writeOptions?.upsert) {
            return null;
          }
          const ledger = new FreeChatAgentLedgerEntity();
          ledger.id = query._id;
          Object.assign(ledger, update.$setOnInsert);
          store.ledger = ledger;
          return ledger;
        }

        if (
          query.slots !== undefined &&
          !sameSlotList(store.ledger.slots, query.slots)
        ) {
          return null;
        }
        if (
          query.policyVersion !== undefined &&
          store.ledger.policyVersion !== query.policyVersion
        ) {
          return null;
        }
        if (update.$set) {
          Object.assign(store.ledger, update.$set);
        }
        return store.ledger;
      }
    ),
  } as any;

  return { service, store };
}

describe('FreeChatAgentEligibilityService', () => {
  it('persists only the first three real agents and rejects the fourth', async () => {
    const agents = [0, 1, 2, 3].map(index => createAgent(index));
    const { service, store } = buildService(agents);

    await expect(service.isEligible(agents[3])).resolves.toBe(false);
    expect(storedAgentIds(store)).toEqual(AGENT_IDS.slice(0, 3));
    expect(store.ledger?.slots).toHaveLength(FREE_CHAT_AGENT_LIMIT);
    expect(service.ledgerModel.findOne).toHaveBeenCalledTimes(2);
  });

  it('uses Mongo _id as a deterministic tie-breaker', async () => {
    const agents = [3, 1, 0, 2].map(index =>
      createAgent(index, { createdAt: NOW })
    );
    const third = agents.find(agent => id(agent.id) === AGENT_IDS[2])!;
    const fourth = agents.find(agent => id(agent.id) === AGENT_IDS[3])!;
    const thirdService = buildService(agents);
    const fourthService = buildService(agents);

    await expect(thirdService.service.isEligible(third)).resolves.toBe(true);
    await expect(fourthService.service.isEligible(fourth)).resolves.toBe(false);
  });

  it('does not promote the fourth agent after an earlier slot agent is deleted', async () => {
    const agents = [0, 1, 2, 3].map(index => createAgent(index));
    const slots = agents.slice(0, 3).map(slot);
    agents.splice(0, 1);
    const { service, store } = buildService(agents, { slots });

    await expect(service.isEligible(agents[2])).resolves.toBe(false);
    expect(storedAgentIds(store)).toEqual(AGENT_IDS.slice(0, 3));
    expect(service.agentModel.aggregate).toHaveBeenCalled();
  });

  it('fills remaining slots in creation order when a new agent is recorded', async () => {
    const agents = [createAgent(0)];
    const { service, store } = buildService(agents);
    await service.recordCreatedAgent(agents[0]);

    agents.push(createAgent(3), createAgent(2), createAgent(1));
    await service.recordCreatedAgent(agents[1]);

    expect(storedAgentIds(store)).toEqual(AGENT_IDS.slice(0, 3));
    await expect(service.isEligible(agents[1])).resolves.toBe(false);
  });

  it('replaces later slots when the earliest-created agent persists last', async () => {
    const agents = [0, 1, 2, 3].map(index => createAgent(index));
    const persistedAgents: AgentEntity[] = [];
    const store: LedgerStore = {};

    for (const index of [3, 2, 1, 0]) {
      persistedAgents.push(agents[index]);
      const { service } = buildService(persistedAgents, { store });
      await service.recordCreatedAgent(agents[index]);
    }

    expect(storedAgentIds(store)).toEqual(AGENT_IDS.slice(0, 3));
    const { service } = buildService(persistedAgents, { store });
    await expect(service.isEligible(agents[3])).resolves.toBe(false);
  });

  it('uses the agent owner ledger for shared-agent eligibility', async () => {
    const agents = [0, 1, 2, 3].map(index =>
      createAgent(index, {
        createdUserId: new MongoObjectId(OTHER_OWNER_ID),
      })
    );
    const { service } = buildService(agents, { ownerId: OTHER_OWNER_ID });

    await expect(service.isEligible(agents[3])).resolves.toBe(false);
  });

  it('keeps messenger agents unlimited without reading a slot ledger', async () => {
    const messenger = createAgent(0, {
      messengerOfAgentId: new MongoObjectId(AGENT_IDS[1]),
    });
    const { service } = buildService([messenger]);

    await expect(service.isEligible(messenger)).resolves.toBe(true);
    expect(service.ledgerModel.findOne).not.toHaveBeenCalled();
    expect(service.agentModel.aggregate).not.toHaveBeenCalled();
  });

  it('surfaces a malformed durable ledger as an availability failure', async () => {
    const agent = createAgent(0);
    const { service } = buildService([agent], { slots: 'broken' });

    await expect(service.isEligible(agent)).rejects.toThrow(
      'slot ledger is malformed'
    );
    expect(service.logger.error).toHaveBeenCalled();
  });

  it('converges concurrent first writes on one owner ledger', async () => {
    const agents = [0, 1, 2, 3].map(index => createAgent(index));
    const store: LedgerStore = {};
    const first = buildService(agents, { store });
    const second = buildService(agents, { store });

    await expect(
      Promise.all([
        first.service.isEligible(agents[0]),
        second.service.isEligible(agents[3]),
      ])
    ).resolves.toEqual([true, false]);
    expect(storedAgentIds(store)).toEqual(AGENT_IDS.slice(0, 3));
  });
});
