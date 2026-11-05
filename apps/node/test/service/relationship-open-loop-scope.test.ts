import { getObjectDefinition, ScopeEnum } from '@midwayjs/core';
import { RelationshipOpenLoopService } from '../../src/service/agents/relationship-open-loop.service';

describe('RelationshipOpenLoopService lifecycle', () => {
  it('is process-scoped so its production interval cannot retain one request graph per resolution', () => {
    expect(getObjectDefinition(RelationshipOpenLoopService).scope).toBe(
      ScopeEnum.Singleton
    );
  });
});

describe('RelationshipOpenLoopService result answers', () => {
  const makeStore = () => {
    const now = new Date('2026-11-04T22:51:00.000Z');
    return {
      version: 'relationship_open_loop_v2' as const,
      tasks: [
        {
          id: 'task-1',
          semanticKey: 'health-result',
          rootId: 'task-1',
          relation: 'checkpoint' as const,
          summary: '用户去化验，等结果出来',
          subject: '用户',
          contentDomain: 'health' as const,
          authorityType: 'professional_high_stakes' as const,
          state: 'scheduled_checkpoint' as const,
          importance: 2 as const,
          sourceMessageIds: ['m1'],
          sourceOccurredAt: now,
          latestSourceOccurredAt: now,
          lastPresentedAt: new Date('2026-11-04T22:50:00.000Z'),
          presentedCount: 1,
          mentionedCount: 0,
          createdAt: now,
          updatedAt: now,
        },
      ],
      updatedAt: now,
    };
  };

  it('resolves a result answer that does not repeat the task keyword', () => {
    const { resolveRelationshipOpenLoopFromUserText } = require('../../src/service/agents/relationship-open-loop');
    const result = resolveRelationshipOpenLoopFromUserText({
      store: makeStore() as any,
      text: '出来了嘛，那说那不高，二百二十二。',
      sourceMessageId: 'm2',
      now: new Date('2026-11-04T22:51:02.000Z'),
    });
    expect(result.task?.state).toBe('resolved');
  });

  it('does not resolve a future promise to report the result', () => {
    const { resolveRelationshipOpenLoopFromUserText } = require('../../src/service/agents/relationship-open-loop');
    const result = resolveRelationshipOpenLoopFromUserText({
      store: makeStore() as any,
      text: '等结果出来了再跟你说。',
      sourceMessageId: 'm3',
      now: new Date('2026-11-04T22:52:00.000Z'),
    });
    expect(result.action).toBe('noop');
  });

  it('does not close a task for a bare "我出来了"', () => {
    const { resolveRelationshipOpenLoopFromUserText } = require('../../src/service/agents/relationship-open-loop');
    const result = resolveRelationshipOpenLoopFromUserText({
      store: makeStore() as any,
      text: '我出来了。',
      sourceMessageId: 'm4',
      now: new Date('2026-11-04T22:53:00.000Z'),
    });
    expect(result.action).toBe('noop');
  });
});
