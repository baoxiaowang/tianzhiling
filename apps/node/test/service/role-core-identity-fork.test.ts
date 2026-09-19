import {
  AgentEntity,
  AgentProfileFactConfidence,
  AgentProfileFactEntity,
  AgentProfileFactPolarity,
  AgentProfileFactStatus,
  AgentProfileFactType,
  ConversationEntity,
  MongoObjectId,
} from '@tzl/entities';
import { ConversationService } from '../../src/service/conversation.service';
import { buildReplyBrief } from '../../src/service/agents/reply-brief.service';
import { routeReplyScene } from '../../src/service/agents/reply-scene-router';

const USER_ID = '665000000000000000000001';
const AGENT_ID = '665000000000000000000010';
const CONVERSATION_ID = '665000000000000000000020';
const NOW = new Date('2026-09-19T08:00:00.000Z');

function createRuntime() {
  const agent = Object.assign(new AgentEntity(), {
    id: new MongoObjectId(AGENT_ID),
    createdUserId: new MongoObjectId(USER_ID),
    name: '爷爷',
    iCallAgent: '爷爷',
    agentCallMe: '小宝',
    status: 1,
    createdAt: NOW,
    updatedAt: NOW,
  });
  const conversation = Object.assign(new ConversationEntity(), {
    id: new MongoObjectId(CONVERSATION_ID),
    userId: new MongoObjectId(USER_ID),
    agentId: new MongoObjectId(AGENT_ID),
    createdAt: NOW,
    updatedAt: NOW,
  });
  return {
    auth: {} as never,
    conversation,
    agent,
  };
}

function activeFact(
  key: string,
  value: string
): AgentProfileFactEntity {
  return Object.assign(new AgentProfileFactEntity(), {
    id: new MongoObjectId(),
    userId: new MongoObjectId(USER_ID),
    agentId: new MongoObjectId(AGENT_ID),
    type: AgentProfileFactType.relationship,
    key,
    value,
    polarity: AgentProfileFactPolarity.positive,
    confidence: AgentProfileFactConfidence.confirmed,
    status: AgentProfileFactStatus.active,
    priority: 3,
    supportCount: 1,
    createdAt: NOW,
    updatedAt: NOW,
  });
}

function buildService(profileFacts: AgentProfileFactEntity[]) {
  const service = new ConversationService();
  service.logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as never;
  service.userIdentityMemoryService = {
    getUserIdentity: jest.fn().mockResolvedValue(null),
  } as never;
  service.agentProfileFactService = {
    listFactsForPrompt: jest.fn().mockResolvedValue(
      profileFacts.map(fact => ({
        id: fact.id?.toString?.() ?? '',
        type: fact.type,
        key: fact.key,
        value: fact.value,
        polarity: fact.polarity,
        confidence: fact.confidence,
        priority: fact.priority,
        status: fact.status,
      }))
    ),
  } as never;
  return service;
}

function buildBrief() {
  const currentQuery = '爷爷，我想你了';
  const intent = {
    intents: [
      {
        target: 'relationship' as const,
        timeScope: 'future' as const,
        intent: 'express_longing' as const,
        subIntent: 'reunion' as const,
        confidence: 0.99,
      },
    ],
    emotion: 'longing' as const,
    riskLevel: 'none' as const,
    confidence: 0.99,
    source: 'hard_rule' as const,
  };
  const route = routeReplyScene({ currentQuery, intent });
  return buildReplyBrief({ currentQuery, intent, route });
}

describe('role-core identity convergence in remaining conversation paths', () => {
  it('uses the corrected user address in the minimal generation recovery path', async () => {
    const service = buildService([
      activeFact(
        'relationship.preferred_user_name',
        '当前用户希望当前角色称呼其为湾呐'
      ),
    ]);
    const runtime = createRuntime();

    const messages = await (service as any).buildMinimalGenerationRecoveryMessages({
      runtime,
      userQuery: '爷爷，我想你了',
      contextMessages: [],
      replyBrief: buildBrief(),
      evidence: [],
    });

    const systemPrompt = (messages[0] as { content: string }).content;
    expect(systemPrompt).toContain('称呼用户为“湾呐”');
    expect(systemPrompt).not.toContain('称呼用户为“小宝”');
    expect(
      service.agentProfileFactService.listFactsForPrompt
    ).toHaveBeenCalled();
  });

  it('falls back to the stored default when the user never corrected it', async () => {
    const service = buildService([]);
    const runtime = createRuntime();

    const messages = await (service as any).buildMinimalGenerationRecoveryMessages({
      runtime,
      userQuery: '爷爷，我想你了',
      contextMessages: [],
      replyBrief: buildBrief(),
      evidence: [],
    });

    expect((messages[0] as { content: string }).content).toContain(
      '称呼用户为“小宝”'
    );
  });

  it('uses the corrected agent address in the image identity reference path', async () => {
    const service = buildService([
      activeFact(
        'relationship.preferred_agent_name',
        '当前用户偏好称呼当前角色为老爷子'
      ),
    ]);
    const runtime = createRuntime();

    const reference = await (service as any).buildImageIdentityReference(
      runtime,
      []
    );

    expect(reference).toContain('用户通常称呼TA为老爷子');
    expect(reference).not.toContain('用户通常称呼TA为爷爷');
  });

  it('keeps the stored default agent address when uncorrected', async () => {
    const service = buildService([]);
    const runtime = createRuntime();

    await expect(
      (service as any).buildImageIdentityReference(runtime, [])
    ).resolves.toContain('身份参考：当前角色是爷爷');
  });
});
