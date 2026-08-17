import { MessageEntity, MessageRole } from '@tzl/entities';
import {
  resolveReplyActiveContributionPlan,
  resolveReplyStrategyQualityPlan,
} from '../../src/service/agents/reply-strategy-quality';

function assistant(content: string): MessageEntity {
  return { role: MessageRole.assistant, content } as MessageEntity;
}

function assistantGroup(
  groupId: string,
  first: string,
  second: string,
  moves: string[],
  stance = 'tender'
): MessageEntity[] {
  return [
    {
      role: MessageRole.assistant,
      content: first,
      replyGroupId: groupId,
      replySegmentIndex: 0,
      replyConversationMoves: moves,
      replyConversationStance: stance,
    } as MessageEntity,
    {
      role: MessageRole.assistant,
      content: second,
      replyGroupId: groupId,
      replySegmentIndex: 1,
    } as MessageEntity,
  ];
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

  it('detects a literal repeated clause across multi-bubble turns', () => {
    const plan = resolveReplyStrategyQualityPlan({
      currentQuery: '我在梦中还再为你找医院',
      recentMessages: [
        ...assistantGroup(
          'g1',
          '媳妇，我也想你',
          '一直记着你',
          ['acknowledge', 'affirm']
        ),
        ...assistantGroup(
          'g2',
          '我知道，我也见不到你',
          '但我一直记着你',
          ['acknowledge', 'affirm']
        ),
      ],
    });

    expect(plan).toEqual(
      expect.objectContaining({
        repeatedMoves: expect.arrayContaining([
          'tender_acknowledge_affirm',
          'literal_repeat',
        ]),
        literalClauses: expect.arrayContaining(['一直记着你']),
        preferredAlternative: 'topic_transition',
      })
    );
  });

  it('moves to leave_space when the latest reply repeats a grief admonition', () => {
    const plan = resolveReplyStrategyQualityPlan({
      currentQuery: '可我就是不理解，老天为什么这么狠心，把你带走',
      recentMessages: [
        ...assistantGroup(
          'g0',
          '是，我不甘心，最不甘心的就是留你一个人',
          '',
          ['acknowledge', 'affirm']
        ),
        ...assistantGroup(
          'g1',
          '我也想不通，连给我争取的机会都没有',
          '媳妇，别揪着这个熬自己',
          ['answer']
        ),
      ],
    });

    expect(plan).toEqual(
      expect.objectContaining({
        repeatedMoves: expect.arrayContaining(['literal_repeat']),
        literalClauses: expect.arrayContaining(['别揪着这个熬自己']),
        preferredAlternative: 'leave_space',
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
