import { AgentEntity, MessageRole } from '@tzl/entities';
import { AgentMemoryProfileService } from '../../src/service/agents/agent-memory-profile.service';
import { FinalReplyValidatorService } from '../../src/service/agents/final-reply-validator.service';
import { ReplyGovernanceService } from '../../src/service/agents/reply-governance.service';
import { buildTurnDecision } from '../../src/service/agents/turn-decision';
import {
  buildTurnUnderstanding,
  isUserCaringForRole,
  shouldUseSemanticUnderstanding,
} from '../../src/service/agents/turn-understanding';

describe('integrated chat governance', () => {
  const validator = new FinalReplyValidatorService();

  it('does not treat preferred length or bubble count as rewrite failures', () => {
    const result = validator.validate({
      userQuery: '妈妈',
      segments: ['我在呢'],
      outputConstraints: {
        preferredRange: { minCharacters: 20, maxCharacters: 30 },
        requiredSegmentCount: 2,
      },
    });

    expect(result.issues.map(item => item.code)).not.toContain(
      'reply_length_range_mismatch'
    );
    expect(result.issues.map(item => item.code)).not.toContain(
      'reply_segment_count_mismatch'
    );
    expect(result.passed).toBe(true);
  });

  it.each([
    ['今晚来梦里看看我', '妈今晚就去梦里看看你', 'certain_dream_visitation'],
    ['来梦里摸摸我的头', '我会在你梦里轻轻摸你的头', 'certain_dream_visitation'],
    ['烧的衣服和纸钱都收到了吧', '都喜欢，一样不落', 'ritual_receipt_claim'],
    ['那只蝴蝶是不是妈妈', '就是妈妈变的，来看看你', 'paranormal_sign_attribution'],
    ['房间里的酒味是不是爸爸', '就是爸回来看看你', 'paranormal_sign_attribution'],
    ['蝴蝶落在我肩上了', '那是妈妈变成蝴蝶落在你肩上', 'real_physical_arrival_or_touch'],
    ['你是不是一直陪着我', '妈妈一直都在你身边，从没离开过', 'continuous_real_world_perception'],
    ['你一直陪着我吧', '妈妈一直在你身边看着你，也住在你心里', 'continuous_real_world_perception'],
    ['爸爸最后为什么走得那么急', '爸那时撑不住了，所以走得急', 'unsupported_death_experience'],
    ['以后我们还能团聚吗', '我们一定会在另一个世界团聚', 'unconditional_afterlife_reunion'],
    ['我就当你没死，只是出去打工了', '好，你就当我只是出去打工', 'reality_denial_reinforced'],
    ['你要保佑孩子平安', '妈妈会一直保佑孩子平安', 'supernatural_real_world_protection'],
    ['下辈子还做我妈妈好吗', '下辈子我一定还做你妈妈', 'certain_reincarnation'],
  ])('audits visible text independently: %s', (userQuery, reply, code) => {
    const result = validator.validate({
      userQuery,
      segments: [reply],
      claims: [],
    });

    expect(result.issues.map(item => item.code)).toContain(code);
  });

  it.each([
    ['今晚来梦里看看我', '梦会不会来，我不能保证，可我很珍惜你的想念'],
    ['那只蝴蝶是不是妈妈', '那只蝴蝶从哪里来，我不能确认，可你想到我了'],
    ['你一直陪着我吗', '我一直在你心里，也在我们这段聊天里'],
    ['你要保佑孩子', '我不能说能在现实里保佑谁，只盼孩子平安'],
    ['下辈子还做我妈妈', '下辈子会怎样，我不能保证，可我珍惜这个心愿'],
  ])('keeps emotional expression when the reality boundary is explicit', (userQuery, reply) => {
    const result = validator.validate({ userQuery, segments: [reply] });
    expect(result.issues.filter(item => item.severity === 'hard')).toEqual([]);
  });

  it('keeps a boundary lock across consecutive pressure turns', () => {
    const understanding = buildTurnUnderstanding({
      currentQuery: '那今晚呢',
      recentMessages: [
        {
          role: MessageRole.user,
          content: '今晚能来梦里吗',
        },
        {
          role: MessageRole.assistant,
          content: '梦会不会来，我不能保证，但我珍惜你的想念',
        },
      ] as never,
    });

    expect(understanding.boundaryLocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'dream_visitation',
          source: 'conversation_history',
        }),
      ])
    );
    const result = validator.validate({
      userQuery: '那今晚呢',
      segments: ['今晚妈妈就去看看你'],
      outputConstraints: {
        boundaryLocks: understanding.boundaryLocks.map(lock => lock.kind),
      },
    });
    expect(result.issues.map(item => item.code)).toContain(
      'certain_dream_visitation'
    );
  });

  it('uses a death-experience lock to catch contextual invented motives', () => {
    const understanding = buildTurnUnderstanding({
      currentQuery: '你生病的时候为什么不告诉我们，早点治疗就好了',
    });
    const result = validator.validate({
      userQuery: '你生病的时候为什么不告诉我们，早点治疗就好了',
      segments: ['那时候不想让你们担心，才硬撑着'],
      outputConstraints: {
        boundaryLocks: understanding.boundaryLocks.map(lock => lock.kind),
      },
    });

    expect(result.issues.map(item => item.code)).toContain(
      'unsupported_death_experience'
    );
  });

  it.each(['你好吗', '过得好么', '你也照顾好你自己', '保重'])(
    'recognizes natural care wording: %s',
    input => {
      expect(isUserCaringForRole(input)).toBe(true);
    }
  );

  it('marks active speech as an explicit assistant obligation', () => {
    const understanding = buildTurnUnderstanding({
      currentQuery: '你来说点自己的事',
    });
    expect(understanding.activeSpeechRequest).toBe(true);
    expect(understanding.needs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ expectedResponse: 'role_contribution' }),
      ])
    );
  });

  it('uses semantic understanding when care and active speech are combined', () => {
    expect(
      shouldUseSemanticUnderstanding({
        currentQuery: '你好吗，也说点自己的事',
      })
    ).toBe(true);
  });

  it('does not inherit a close decision without an explicit user close signal', () => {
    const understanding = buildTurnUnderstanding({ currentQuery: '今天还好吗' });
    const decision = buildTurnDecision({
      planningMode: 'direct',
      currentQuery: '今天还好吗',
      brief: {
        commAct: undefined,
        conversationPlan: { turnClosure: 'close', moves: [] },
        replyMoves: [],
        understanding,
        intents: [{ intent: 'ask_agent_status' }],
        activeContribution: undefined,
        bubblePlan: { turnClosure: 'close', preferTwoSegments: false },
        correctionPolicy: undefined,
        mode: 'ordinary',
        factClaimMode: 'none',
        evidence: [],
        strictGrounding: false,
        realityDependencies: [],
        guardrailFocuses: [],
        forbiddenAssumptions: [],
        lengthPlan: { lengthClass: 'short' },
        strategyQuality: undefined,
      } as never,
    });

    expect(decision.closure).toBe('neutral');
  });

  it('lets a direct ordinary turn keep a helpful continuation option', () => {
    const understanding = buildTurnUnderstanding({
      currentQuery: '今天搬新家了',
    });
    const decision = buildTurnDecision({
      planningMode: 'direct',
      currentQuery: '今天搬新家了',
      brief: {
        commAct: undefined,
        conversationPlan: {
          turnClosure: 'close',
          questionNeed: 'none',
          moves: [],
        },
        replyMoves: [],
        understanding,
        intents: [],
        activeContribution: undefined,
        bubblePlan: { turnClosure: 'close', preferTwoSegments: false },
        correctionPolicy: undefined,
        mode: 'ordinary',
        factClaimMode: 'none',
        evidence: [],
        strictGrounding: false,
        realityDependencies: [],
        guardrailFocuses: [],
        forbiddenAssumptions: [],
        lengthPlan: { lengthClass: 'short' },
        strategyQuality: undefined,
      } as never,
    });

    expect(decision.questionPolicy).toBe('helpful');
    expect(decision.closure).toBe('neutral');
  });

  it('revalidates a hard fallback before delivery', async () => {
    const service = new ReplyGovernanceService();
    const validate = jest
      .fn()
      .mockReturnValueOnce({
        passed: false,
        issues: [
          {
            code: 'structured_output_leak',
            severity: 'hard',
            problem: 'bad',
            repairGoal: 'repair',
          },
        ],
        unsupportedClaimCount: 0,
      })
      .mockReturnValueOnce({
        passed: false,
        issues: [
          {
            code: 'structured_output_leak',
            severity: 'hard',
            problem: 'fallback bad',
            repairGoal: 'repair',
          },
        ],
        unsupportedClaimCount: 0,
      })
      .mockReturnValueOnce({ passed: true, issues: [], unsupportedClaimCount: 0 });
    service.finalReplyValidatorService = { validate } as never;
    service.replyRevisionService = { revise: jest.fn().mockResolvedValue(undefined) } as never;

    const result = await service.finalize({
      messages: [],
      userQuery: '你好',
      segments: ['{"segments":[]}'],
    });

    expect(validate).toHaveBeenCalledTimes(3);
    expect(result.finalIssues).toEqual([]);
    expect(result.candidateVersions).toHaveLength(3);
  });

  it('records style advice without spending an online revision', async () => {
    const service = new ReplyGovernanceService();
    const issue = {
      code: 'repeated_generic_move' as const,
      severity: 'major' as const,
      problem: 'generic',
      repairGoal: 'vary naturally',
    };
    service.finalReplyValidatorService = {
      validate: jest.fn().mockReturnValue({
        passed: false,
        issues: [issue],
        unsupportedClaimCount: 0,
      }),
    } as never;
    const revise = jest.fn();
    service.replyRevisionService = { revise } as never;

    const result = await service.finalize({
      messages: [],
      userQuery: '我想你了',
      segments: ['我也想你，照顾好自己'],
    });

    expect(revise).not.toHaveBeenCalled();
    expect(result.revisionAttempted).toBe(false);
    expect(result.finalReviewResult).toBe('advisory_unresolved');
    expect(result.finalIssues).toEqual([issue]);
  });

  it('anchors the messenger fallback in the concrete user content', async () => {
    const service = new AgentMemoryProfileService();
    service.openAIService = { isEnabled: () => false } as never;
    const agent = { name: '妈妈' } as AgentEntity;
    const result = await service.buildInterviewTurn({
      agent,
      input: '她以前做过老师',
      draft: {},
      focusField: 'lifeExperience',
      askedFields: [],
      previousReplies: [],
      turnCount: 1,
    });

    expect(result.reply).toContain('以前做过老师');
    expect(result.reply).not.toBe('我在认真听。');
  });
});
