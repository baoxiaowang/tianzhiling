import { ConversationEntity, MongoObjectId } from '@tzl/entities';
import { AgentContextService } from '../../src/service/agents/agent.context';

export const groupId = '665000000000000000000077';
export function fixture() {
  const service = new AgentContextService();
  service.messageModel = { find: jest.fn().mockResolvedValue([]) } as never;
  service.agentProfileFactService = { listFactsForPrompt: jest.fn().mockResolvedValue([]) } as never;
  const evidence = ['去年住院时哥哥每天给我送饭', '出院那天哥哥开车接我回家'].map((text, i) => ({
    id: `quote-${i}`, kind: 'event', text, role: 'user', assertPolicy: 'quote',
    groupId, groupTitle: '去年住院', sourceMessageIds: [`source-${i}`],
    occurredAt: '2026-11-01T00:00:00Z', score: 0.9, engine: 'event',
  }));
  const packages = [{ groupId, title: '去年住院', topicKey: '住院', spanFrom: '2026-11-01', spanTo: '2026-11-01', memberEvidenceIds: evidence.map(x => x.id) }];
  service.memoryModuleService = {
    describeSelection: () => ({ mode: 'active', primary: 'event', recallEngine: 'event', scopedUserIds: 1 }),
    recall: jest.fn().mockResolvedValue({ evidence, packages, status: 'ok', diagnostics: { mode: 'active', engine: 'event', candidateCount: 2, selectedCount: 2 } }),
  } as never;
  const conversation = Object.assign(new ConversationEntity(), {
    id: new MongoObjectId('665000000000000000000020'),
    userId: new MongoObjectId('665000000000000000000001'),
    agentId: new MongoObjectId('665000000000000000000010'),
  });
  const options = { auth: { sub: String(conversation.userId), accountId: '665000000000000000000101', account: 'test', iat: 0, exp: 0, nonce: 'test' }, conversation, agent: null, currentQuery: '你还记得去年住院的事吗？' } as any;
  return { service, options, evidence, packages };
}

describe('memory package context integration', () => {
  it('preserves a real group through recall mapping, selection and narrative rendering', async () => {
    const { service, options } = fixture();
    const result = await service.buildConversationContext(options);
    expect(service.memoryModuleService!.recall).toHaveBeenCalled();
    expect(result.diagnostics.memoryInjectionPackages).toEqual(expect.arrayContaining([
      expect.objectContaining({ groupId, originalMembers: 2, injectedMembers: 2 }),
    ]));
    expect(JSON.stringify(result.messages)).toContain('一件有来龙去脉的事');
    expect(JSON.stringify(result.messages)).toContain('去年住院');
  });
});
