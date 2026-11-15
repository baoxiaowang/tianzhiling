import { FinalReplyValidatorService } from '../../src/service/agents/final-reply-validator.service';

describe('unsupported preference governance', () => {
  it('marks unsupported user preference as an actionable memory assertion', () => {
    const validator = new FinalReplyValidatorService();
    const result = validator.validate({
      userQuery: '明天回天津',
      segments: ['明天路上别赶时间，我记着你也爱吃清淡的'],
      claims: [],
      evidence: [],
    });
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: 'unsupported_user_preference',
        severity: 'hard',
        onlineAction: 'exact_patch',
        blockingKind: 'unsupported_memory_assertion',
      })
    );
  });
});
