import { MessageEntity, MessageRole } from '@tzl/entities';
import {
  resolveReplyActiveContributionPlan,
  resolveReplyStrategyQualityPlan,
} from '../../src/service/agents/reply-strategy-quality';

function assistant(content: string): MessageEntity {
  return { role: MessageRole.assistant, content } as MessageEntity;
}

describe('reply strategy quality', () => {
  it('prefers role-present content when the user asks the role to say more', () => {
    expect(
      resolveReplyActiveContributionPlan({
        currentQuery: '妈，你多说几句，也说说你自己',
        evidence: [{ source: 'current_user', text: '你多说几句' }],
      })
    ).toEqual({
      requested: true,
      preferredSource: 'role_present',
      sharedPastEvidenceCount: 0,
      sharedPastAllowed: false,
    });
  });

  it('separately records grounded shared-past availability', () => {
    expect(
      resolveReplyActiveContributionPlan({
        currentQuery: '爸，说点不一样的',
        evidence: [
          {
            source: 'confirmed_fact',
            text: '以前爸爸带用户去过西山',
          },
        ],
      })
    ).toEqual(
      expect.objectContaining({
        preferredSource: 'role_present',
        sharedPastEvidenceCount: 1,
        sharedPastAllowed: true,
      })
    );
  });

  it('moves away from repeated empathy and presence on an open turn', () => {
    const plan = resolveReplyStrategyQualityPlan({
      currentQuery: '今天路过以前那家店了',
      recentMessages: [
        assistant('妈听着就心疼，我在呢'),
        assistant('真让人心疼，妈一直陪着你'),
      ],
    });

    expect(plan).toEqual(
      expect.objectContaining({
        repeatedMoves: expect.arrayContaining([
          'generic_empathy',
          'generic_presence',
        ]),
        preferredAlternative: 'topic_transition',
      })
    );
  });

  it('uses natural close only when the user is actually closing', () => {
    const plan = resolveReplyStrategyQualityPlan({
      currentQuery: '晚安',
      recentMessages: [
        assistant('早点休息，照顾好自己'),
        assistant('记得吃饭，好好休息'),
      ],
    });

    expect(plan?.preferredAlternative).toBe('natural_close');
  });

  it('recognizes a natural close inside a longer WeChat message', () => {
    const plan = resolveReplyStrategyQualityPlan({
      currentQuery: '我要工作了，你也早点休息吧',
      recentMessages: [],
    });

    expect(plan).toEqual({
      repeatedMoves: [],
      preferredAlternative: 'natural_close',
      observedAssistantTurns: 0,
    });

    expect(
      resolveReplyStrategyQualityPlan({
        currentQuery: '老爸早点休息吧',
        recentMessages: [],
      })?.preferredAlternative
    ).toBe('natural_close');
    expect(
      resolveReplyStrategyQualityPlan({
        currentQuery: '我先睡了',
        recentMessages: [],
      })?.preferredAlternative
    ).toBe('natural_close');
  });

  it('does not mistake difficulty sleeping for a close', () => {
    expect(
      resolveReplyStrategyQualityPlan({
        currentQuery: '妈，我今晚一直睡不着',
        recentMessages: [],
      })
    ).toBeUndefined();
  });
});
