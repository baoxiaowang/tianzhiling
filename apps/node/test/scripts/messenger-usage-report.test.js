const { ObjectId } = require('mongodb');
const { buildUsageReport } = require('../../scripts/report-messenger-usage');

describe('messenger usage report', () => {
  it('builds independent rolling 24-hour and 7-day metrics', () => {
    const now = new Date('2026-08-17T12:00:00.000Z');
    const userA = new ObjectId();
    const userB = new ObjectId();
    const messengerA = new ObjectId();
    const messengerB = new ObjectId();
    const conversationA = new ObjectId();
    const conversationB = new ObjectId();
    const events = [
      {
        userId: userA,
        messengerAgentId: messengerA,
        conversationId: conversationA,
        status: 'completed',
        modelCalled: true,
        modelSucceeded: true,
        fallbackUsed: false,
        model: 'MiniMax-M2.1',
        promptTokens: 100,
        completionTokens: 20,
        totalTokens: 120,
        durationMs: 1000,
        profileSaved: true,
        changedProfileFields: ['hobbies', 'personalityTraits'],
        releaseVersion: 'abc123',
        createdAt: new Date('2026-08-17T11:00:00.000Z'),
      },
      {
        userId: userA,
        messengerAgentId: messengerA,
        conversationId: conversationA,
        status: 'skipped',
        skipReason: 'low_information',
        modelCalled: false,
        modelSucceeded: false,
        fallbackUsed: false,
        durationMs: 20,
        profileSaved: false,
        changedProfileFields: [],
        releaseVersion: 'abc123',
        createdAt: new Date('2026-08-17T10:00:00.000Z'),
      },
      {
        userId: userB,
        messengerAgentId: messengerB,
        conversationId: conversationB,
        status: 'completed',
        modelCalled: true,
        modelSucceeded: false,
        fallbackUsed: true,
        errorCode: 'ETIMEDOUT',
        durationMs: 3000,
        profileSaved: false,
        changedProfileFields: [],
        releaseVersion: 'older',
        createdAt: new Date('2026-08-14T12:00:00.000Z'),
      },
    ];

    const report = buildUsageReport(events, now);

    expect(report.windows.last24Hours).toEqual(
      expect.objectContaining({
        turns: 2,
        completedTurns: 1,
        skippedTurns: 1,
        modelCalls: 1,
        modelSucceededCalls: 1,
        uniqueUsers: 1,
        profileSavedTurns: 1,
      })
    );
    expect(report.windows.last24Hours.tokens).toEqual({
      taggedCalls: 1,
      coverageRate: 1,
      prompt: 100,
      completion: 20,
      total: 120,
    });
    expect(report.windows.last7Days).toEqual(
      expect.objectContaining({
        turns: 3,
        modelCalls: 2,
        modelSucceededCalls: 1,
        modelFailedCalls: 1,
        fallbackTurns: 1,
        uniqueUsers: 2,
        errors: { ETIMEDOUT: 1 },
      })
    );
    expect(report.windows.last7Days.changedProfileFields).toEqual({
      hobbies: 1,
      personalityTraits: 1,
    });
  });
});
