import { MessageEntity, MessageRole } from '@tzl/entities';
import {
  buildDreamCompanionPlanPrompt,
  resolveDreamCompanionPlan,
} from '../../src/service/agents/dream-companion-plan';

function userMessage(content: string): MessageEntity {
  return { role: MessageRole.user, content } as MessageEntity;
}

describe('dream companion plan', () => {
  it.each([
    ['request', '你什么时候能来我梦里一次', 'promise', 'warm', 'none'],
    ['before_sleep', '我准备睡了 你今晚来我梦里好吗', 'invite', 'warm', 'none'],
    [
      'reported',
      '昨晚我梦见你了 我们在老家院子里',
      'reconstruct',
      'warm',
      'place',
    ],
    [
      'fragmented',
      '昨晚我梦见你 可醒来已经记不清了',
      'reconstruct',
      'warm',
      'none',
    ],
    ['missed', '昨晚没有梦到你', 'repair', 'warm', 'none'],
    ['repeated_miss', '昨晚还是没梦到你', 'leave_space', 'restrained', 'none'],
    [
      'verification',
      '昨晚梦见你了 是不是你真的来过',
      'leave_space',
      'restrained',
      'none',
    ],
  ])(
    'maps %s without a model call',
    (dreamStage, currentQuery, dreamAction, expectationLevel, dreamAnchor) => {
      expect(resolveDreamCompanionPlan({ currentQuery })).toEqual({
        dreamStage,
        dreamAction,
        expectationLevel,
        dreamAnchor,
        realityBoundary: 'dream_only',
      });
    }
  );

  it('upgrades a new miss after an earlier miss and inherits its anchor', () => {
    const plan = resolveDreamCompanionPlan({
      currentQuery: '昨晚还是没有梦到你',
      recentMessages: [
        userMessage('前天也没梦到你 我怕忘记你的声音'),
        {
          role: MessageRole.assistant,
          content: '今晚再去看你',
        } as MessageEntity,
      ],
    });

    expect(plan).toEqual({
      dreamStage: 'repeated_miss',
      dreamAction: 'leave_space',
      expectationLevel: 'restrained',
      dreamAnchor: 'voice',
      realityBoundary: 'dream_only',
    });
  });

  it('does not add a plan to ordinary chat', () => {
    expect(
      resolveDreamCompanionPlan({ currentQuery: '爸 我今天下班有点晚' })
    ).toBeUndefined();
  });

  it('keeps the model instruction compact and dream-only', () => {
    const plan = resolveDreamCompanionPlan({
      currentQuery: '昨晚梦见你了 是不是你真的来过',
    });

    expect(buildDreamCompanionPlanPrompt(plan!)).toContain(
      'verification/leave_space/restrained/none/dream_only'
    );
    expect(buildDreamCompanionPlanPrompt(plan!)).toContain('不作现实证明');
  });
});
