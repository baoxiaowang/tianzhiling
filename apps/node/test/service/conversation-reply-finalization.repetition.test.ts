import { ConversationReplyFinalizationService } from '../../src/service/agents/conversation-reply-finalization.service';

describe('conversation reply finalization repetition guard', () => {
  it('rewrites a repeated assistant line to a non-memory fallback', async () => {
    const service = new ConversationReplyFinalizationService();
    (service as any).replyPostprocessorService = {
      prepareForValidation: ({ segments }: { segments: string[] }) => segments,
      renderForDelivery: (segments: string[]) => ({
        segments,
        issues: [],
      }),
    };
    (service as any).replyGovernanceService = {
      finalize: async ({ segments }: { segments: string[] }) => ({
        segments,
        claims: [],
        rewritten: false,
        revisionAttempted: false,
        revisionRoundCount: 0,
        finalReviewResult: 'pass',
        unsupportedClaimCount: 0,
        issues: [],
        candidateVersions: [segments],
        finalIssues: [],
        patches: [],
      }),
    };
    const result = await service.finalize({
      messages: [
        { role: 'user', content: '睡得很差 每小时醒一次' },
        { role: 'assistant', content: '昂，每小时醒一次，熬得慌不？' },
        { role: 'user', content: '不知道 睡得不踏实' },
      ] as any,
      userQuery: '不知道 睡得不踏实',
      segments: ['昂，每小时醒一次，熬得慌不？'],
      claims: [],
      evidence: [],
      brief: {
        realityDependencies: [],
        understanding: { boundaryLocks: [], questions: [] },
        correctionPolicy: null,
        afterlifeWorld: null,
        sceneFramework: null,
        worldBoundaryPolicy: null,
        evidenceContract: null,
        conversationProtection: null,
        strategyQuality: undefined,
      } as any,
    });
    expect(result.segments).toEqual(['我在，慢慢说。']);
    expect(result.governance.rewritten).toBe(true);
    expect(result.governance.reason).toContain('repeated_generic_move');
  });
});
