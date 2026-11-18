import { applyExactReplyPatch, ReplyRevisionService } from '../../src/service/agents/reply-revision.service';
import { ReplyGovernanceService } from '../../src/service/agents/reply-governance.service';

const issue = { code: 'unsupported_fact_claim', severity: 'hard', onlineAction: 'exact_patch', blockingKind: 'real_world_actionable_fabrication', evidence: '去柜子找存折', problem: '无依据位置', repairGoal: '撤回' } as const;
const invalid = { passed: false, issues: [issue], unsupportedClaimCount: 1 };
const valid = { passed: true, issues: [], unsupportedClaimCount: 0 };

describe('reply group coherence', () => {
  it('repairs a cross-bubble span without dropping surrounding text', () => {
    expect(applyExactReplyPatch(['前文。旧', '说法。后文。'], {originalSpan: '旧\n说法', replacementSpan: '新说法', resolvedIssueCode: 'x'})).toEqual(['前文。新说法。后文。']);
  });
  it('rejects ambiguous and empty patches and preserves literal replacement text', () => {
    expect(applyExactReplyPatch(['旧旧'], {originalSpan: '旧', replacementSpan: '新', resolvedIssueCode: 'x'})).toBeUndefined();
    expect(applyExactReplyPatch(['旧'], {originalSpan: '旧', replacementSpan: '', resolvedIssueCode: 'x'})).toBeUndefined();
    expect(applyExactReplyPatch(['旧'], {originalSpan: '旧', replacementSpan: '$&', resolvedIssueCode: 'x'})).toEqual(['$&']);
  });
  it('sends the full reply group and issue to one bounded repair', async () => {
    const service = new ReplyRevisionService();
    const original = ['我给你留了钱。', '去柜子找存折'];
    const create = jest.fn().mockResolvedValue({choices:[{message:{content:JSON.stringify({originalSpan:original.join('\n'),replacementSpan:'存折在哪里，我不能确定。',resolvedIssueCode:issue.code})}}]});
    service.openAIService = {createChatCompletion:create} as never;
    const result = await service.revise({messages:[],userQuery:'存折在哪',segments:original,issue});
    expect(result?.originalSpan).toBe(original.join('\n'));
    const sent = JSON.parse(create.mock.calls[0][0].messages.slice(-1)[0].content);
    expect(sent.problematicSpan).toBe(issue.evidence);
    expect(sent.requiredOriginalSpan).toBe(original.join('\n'));
    expect(create).toHaveBeenCalledTimes(1);
  });
  it('rechecks a coherent group and never splices a canned fallback on repair failure', async () => {
    const service = new ReplyGovernanceService();
    const validate = jest.fn().mockReturnValueOnce(invalid).mockReturnValue(valid);
    service.finalReplyValidatorService = {validate} as never;
    const revise = jest.fn().mockResolvedValue(undefined);
    service.replyRevisionService = {revise} as never;
    const result = await service.finalize({messages:[],userQuery:'存折在哪',segments:['我给你留了钱。去柜子找存折']});
    expect(revise).toHaveBeenCalledTimes(1);
    expect(result.finalReviewResult).toBe('hard_recovery');
    expect(result.patches).toEqual([]);
    expect(result.segments.join('')).not.toContain('我给你留了钱');
    expect(validate).toHaveBeenCalledTimes(2);
  });
});
