import {
  resolveRelationshipOpenLoopFromUserText,
} from '../../src/service/agents/relationship-open-loop';

describe('relationship open loop health recovery', () => {
  const task = (overrides: Record<string, unknown> = {}) => ({
    id: 'task-1',
    semanticKey: 'health-check',
    rootId: 'task-1',
    relation: 'checkpoint',
    summary: '如果明天不好，我就去医院',
    subject: '用户',
    contentDomain: 'health',
    authorityType: 'professional_high_stakes',
    state: 'scheduled_checkpoint',
    importance: 2,
    sourceMessageIds: ['m1'],
    sourceOccurredAt: new Date('2026-11-14T01:30:00.000Z'),
    latestSourceOccurredAt: new Date('2026-11-14T01:30:00.000Z'),
    lastPresentedAt: new Date('2026-11-14T08:10:00.000Z'),
    presentedCount: 1,
    mentionedCount: 0,
    createdAt: new Date('2026-11-14T01:30:00.000Z'),
    updatedAt: new Date('2026-11-14T01:30:00.000Z'),
    expiresAt: new Date('2026-11-21T01:30:00.000Z'),
    ...overrides,
  });

  it('closes a health checkpoint when the user reports the symptom is gone', () => {
    const result = resolveRelationshipOpenLoopFromUserText({
      store: { version: 'relationship_open_loop_v2', tasks: [task()], updatedAt: new Date() } as any,
      text: '胸口不疼了 放心吧老公',
      sourceMessageId: 'm2',
      now: new Date('2026-11-14T08:11:00.000Z'),
    });
    expect(result.task?.state).toBe('resolved');
  });

  it('does not close a non-health task on a symptom sentence', () => {
    const result = resolveRelationshipOpenLoopFromUserText({
      store: {
        version: 'relationship_open_loop_v2',
        tasks: [task({ contentDomain: 'funeral_or_memorial' })],
        updatedAt: new Date(),
      } as any,
      text: '胸口不疼了',
      sourceMessageId: 'm3',
      now: new Date('2026-11-14T08:11:00.000Z'),
    });
    expect(result.action).toBe('noop');
  });
});
