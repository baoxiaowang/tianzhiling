import {
  ConversationChatImportConfidence,
  ConversationChatImportSpeaker,
  ConversationChatImportTimePrecision,
} from '@tzl/entities';
import {
  analyzeChatImportLanguage,
  markDuplicateChatImportItems,
  sortChatImportItems,
} from '../../src/service/chat-import-domain';

function buildItem(
  overrides: Partial<{
    screenshotSequence: number;
    bubbleSequence: number;
    speaker: ConversationChatImportSpeaker;
    content: string;
    occurredAt: Date;
    recognitionConfidence: number;
  }> = {}
) {
  return {
    screenshotSequence: overrides.screenshotSequence ?? 0,
    bubbleSequence: overrides.bubbleSequence ?? 0,
    speaker: overrides.speaker ?? ConversationChatImportSpeaker.agent,
    content: overrides.content ?? '早点休息啊',
    occurredAt: overrides.occurredAt,
    rawTimeText: '',
    timePrecision: ConversationChatImportTimePrecision.minute,
    timeConfidence: ConversationChatImportConfidence.high,
    recognitionConfidence: overrides.recognitionConfidence ?? 0.9,
    isDuplicate: false,
  };
}

describe('chat import domain', () => {
  it('sorts explicit historical timestamps before screenshot order', () => {
    const later = buildItem({
      screenshotSequence: 0,
      occurredAt: new Date('2021-05-01T09:00:00.000Z'),
    });
    const earlier = buildItem({
      screenshotSequence: 2,
      occurredAt: new Date('2020-05-01T09:00:00.000Z'),
    });
    const unknown = buildItem({ screenshotSequence: 1 });

    expect(sortChatImportItems([later, unknown, earlier])).toEqual([
      earlier,
      later,
      unknown,
    ]);
  });

  it('keeps the higher-confidence copy when screenshots overlap', () => {
    const low = buildItem({
      screenshotSequence: 0,
      bubbleSequence: 0,
      recognitionConfidence: 0.62,
      occurredAt: new Date('2020-05-01T09:00:00.000Z'),
    });
    const high = buildItem({
      screenshotSequence: 1,
      bubbleSequence: 0,
      recognitionConfidence: 0.94,
      occurredAt: new Date('2020-05-01T09:00:00.000Z'),
    });
    const previousContext = buildItem({
      screenshotSequence: 0,
      bubbleSequence: 1,
      content: '你到家了吗',
      occurredAt: new Date('2020-05-01T08:59:00.000Z'),
    });
    const repeatedContext = buildItem({
      screenshotSequence: 1,
      bubbleSequence: 1,
      content: '你到家了吗',
      occurredAt: new Date('2020-05-01T08:59:00.000Z'),
    });
    const result = markDuplicateChatImportItems([
      previousContext,
      low,
      high,
      repeatedContext,
    ]);

    expect(result.find(item => item === low)?.isDuplicate).toBe(true);
    expect(result.find(item => item === high)?.isDuplicate).toBe(false);
  });

  it('does not remove repeated short replies outside an overlap context', () => {
    const first = buildItem({ screenshotSequence: 0, content: '嗯' });
    const second = buildItem({ screenshotSequence: 1, content: '嗯' });

    markDuplicateChatImportItems([first, second]);

    expect(first.isDuplicate).toBe(false);
    expect(second.isDuplicate).toBe(false);
  });

  it('only compares the boundary of adjacent screenshots', () => {
    const first = buildItem({
      screenshotSequence: 0,
      bubbleSequence: 0,
      content: '早点休息啊',
    });
    const middle = buildItem({
      screenshotSequence: 0,
      bubbleSequence: 1,
      content: '晚安',
    });
    const repeatedAwayFromBoundary = buildItem({
      screenshotSequence: 1,
      bubbleSequence: 1,
      content: '早点休息啊',
    });
    const currentStart = buildItem({
      screenshotSequence: 1,
      bubbleSequence: 0,
      content: '明天记得吃早饭',
    });

    markDuplicateChatImportItems([
      first,
      middle,
      currentStart,
      repeatedAwayFromBoundary,
    ]);

    expect(first.isDuplicate).toBe(false);
    expect(repeatedAwayFromBoundary.isDuplicate).toBe(false);
  });

  it('summarizes message length and stable language evidence', () => {
    const statistics = analyzeChatImportLanguage([
      { content: '吃饭了吗？', occurredAt: new Date('2020-05-01') },
      { content: '早点休息啊', occurredAt: new Date('2020-05-01') },
      { content: '听话啊', occurredAt: new Date('2020-05-02') },
      { content: '别让我担心啊', occurredAt: new Date('2020-05-02') },
    ]);

    expect(statistics.messageCount).toBe(4);
    expect(statistics.dayCount).toBe(2);
    expect(statistics.averageLength).toBeGreaterThan(0);
    expect(statistics.commonEndings).toContain('啊');
    expect(statistics.commonModalParticles).toContain('啊');
  });

  it('measures how many bubbles are usually sent in one reply', () => {
    const statistics = analyzeChatImportLanguage([
      {
        content: '你吃饭了吗？',
        speaker: ConversationChatImportSpeaker.agent,
      },
      {
        content: '记得按时吃饭啊',
        speaker: ConversationChatImportSpeaker.agent,
      },
      { content: '吃过了', speaker: ConversationChatImportSpeaker.user },
      { content: '那就好啊', speaker: ConversationChatImportSpeaker.agent },
      { content: '早点休息', speaker: ConversationChatImportSpeaker.agent },
      { content: '别熬夜', speaker: ConversationChatImportSpeaker.agent },
    ]);

    expect(statistics.messageCount).toBe(5);
    expect(statistics.replyCount).toBe(2);
    expect(statistics.averageReplyBubbleCount).toBe(2.5);
    expect(statistics.maxReplyBubbleCount).toBe(3);
    expect(statistics.multiBubbleReplyRatio).toBe(1);
  });
});
