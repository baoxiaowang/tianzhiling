import { ConversationReplyFinalizationService } from '../../src/service/agents/conversation-reply-finalization.service';
const old = '昂，每小时醒一次，熬得慌不？';
const brief = {
  realityDependencies: [],
  understanding: { boundaryLocks: [], questions: [] },
  correctionPolicy: null,
} as any;
function setup() {
  const service = new ConversationReplyFinalizationService();
  const review = jest.fn(async ({ segments }: any) => ({
    segments,
    claims: [],
    rewritten: false,
    revisionAttempted: false,
    revisionRoundCount: 0,
    finalReviewResult: 'pass',
    candidateVersions: [segments],
    hardFactAuditUsage: undefined,
  }));
  const repair = jest.fn();
  Object.assign(service, {
    replyPostprocessorService: {
      prepareForValidation: ({ segments }: any) => segments,
      renderForDelivery: (segments: any) => ({ segments, issues: [] }),
    },
    replyGovernanceService: { finalize: review },
    replyRevisionService: { reviseRepeatedReply: repair },
  });
  const options = {
    messages: [
      { role: 'user', content: '睡得很差 每小时醒一次' },
      { role: 'assistant', content: old },
      { role: 'user', content: '不知道 睡得不踏实' },
    ],
    userQuery: '不知道 睡得不踏实',
    segments: [old],
    claims: [],
    evidence: [],
    brief,
  } as any;
  return { service, review, repair, options };
}
describe('bounded repeated reply repair', () => {
  it('repairs once and validates the replacement before delivery', async () => {
    const { service, review, repair, options } = setup();
    repair.mockResolvedValue({
      segments: ['这一晚上睡不踏实，确实难受。'],
      usage: { totalTokens: 12 },
    });
    const r = await service.finalize(options);
    expect(repair).toHaveBeenCalledTimes(1);
    expect(review).toHaveBeenCalledTimes(2);
    expect(review.mock.calls[1][0]).toMatchObject({
      claims: [],
      maxRevisionRounds: 1,
    });
    expect(r.segments).toEqual(['这一晚上睡不踏实，确实难受。']);
    expect(r.governance.revisionUsage?.totalTokens).toBe(12);
    expect(r.governance.revisionRoundCount).toBe(1);
  });
  it.each([
    undefined,
    { segments: [], usage: {} },
    { segments: [old], usage: {} },
  ])('keeps reviewed original on unusable repair %p', async candidate => {
    const { service, review, repair, options } = setup();
    repair.mockResolvedValue(candidate);
    const r = await service.finalize(options);
    expect(r.segments).toEqual([old]);
    expect(review).toHaveBeenCalledTimes(1);
    expect(r.governance.reason).toContain('unresolved');
    expect(repair).toHaveBeenCalledTimes(1);
  });
  it('handles repair exception without canned fallback', async () => {
    const { service, repair, options } = setup();
    repair.mockRejectedValue(new Error('timeout'));
    expect((await service.finalize(options)).segments).toEqual([old]);
  });
  it('does not remove an old clause inside a correction', async () => {
    const { service, review, repair, options } = setup();
    options.segments = [old + '刚才问岔了，你已经说了睡不踏实。'];
    expect((await service.finalize(options)).segments).toEqual(
      options.segments
    );
    expect(repair).not.toHaveBeenCalled();
    expect(
      review.mock.calls[0][0].outputConstraints.avoidLiteralClauses
    ).toBeUndefined();
  });
  it('does not stack quality repair after safety revision', async () => {
    const { service, review, repair, options } = setup();
    review.mockImplementation(async ({ segments }: any) => ({
      segments,
      claims: [],
      rewritten: true,
      revisionAttempted: true,
      revisionRoundCount: 1,
      finalReviewResult: 'pass',
      candidateVersions: [segments],
      hardFactAuditUsage: undefined,
    }));
    await service.finalize(options);
    expect(repair).not.toHaveBeenCalled();
  });
  it('sends governance result, not unsafe repair candidate', async () => {
    const { service, review, repair, options } = setup();
    repair.mockResolvedValue({
      segments: ['新出现的未经支持的事实'],
      usage: {},
    });
    review.mockImplementationOnce(async ({ segments }: any) => ({
      segments,
      claims: [],
      rewritten: false,
      revisionAttempted: false,
      revisionRoundCount: 0,
      finalReviewResult: 'pass',
      candidateVersions: [segments],
      hardFactAuditUsage: undefined,
    }));
    review.mockImplementationOnce(async () => ({
      segments: ['不能凭空认下这件事。'],
      claims: [],
      rewritten: true,
      revisionAttempted: true,
      revisionRoundCount: 1,
      finalReviewResult: 'hard_recovery',
      candidateVersions: [['不能凭空认下这件事。']],
      hardFactAuditUsage: undefined,
    }));
    const r = await service.finalize(options);
    expect(r.segments).toEqual(['不能凭空认下这件事。']);
    expect(r.governance.revisionRoundCount).toBe(2);
  });
  it('leaves technical empty recovery to governance', async () => {
    const { service, review, repair, options } = setup();
    options.segments = [];
    review.mockImplementation(async () => ({
      segments: ['技术兜底'],
      claims: [],
      rewritten: true,
      revisionAttempted: false,
      revisionRoundCount: 0,
      finalReviewResult: 'technical_fallback',
      candidateVersions: [[]],
      hardFactAuditUsage: undefined,
    }));
    expect((await service.finalize(options)).segments).toEqual(['技术兜底']);
    expect(repair).not.toHaveBeenCalled();
  });
});
