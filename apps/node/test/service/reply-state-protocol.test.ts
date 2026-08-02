import { MessageEntity, MessageRole } from '@tzl/entities';
import {
  buildReplyStateProtocolPrompt,
  ReplyStateProtocolPlan,
  resolveReplyStateProtocol,
} from '../../src/service/agents/reply-state-protocol';

function previousAssistant(protocol: ReplyStateProtocolPlan): MessageEntity {
  return {
    role: MessageRole.assistant,
    content: '上一轮回复',
    replyStateProtocol: protocol,
  } as MessageEntity;
}

describe('reply state protocol', () => {
  it('maps the existing dream plan without another model call', () => {
    const plan = resolveReplyStateProtocol({
      currentQuery: '今晚来我梦里吧',
      dreamPlan: {
        dreamStage: 'before_sleep',
        dreamAction: 'invite',
        expectationLevel: 'warm',
        dreamAnchor: 'voice',
        realityBoundary: 'dream_only',
      },
    });

    expect(plan).toEqual({
      version: 'state_protocol_v1',
      protocol: 'dream',
      stage: 'before_sleep',
      action: 'invite',
      anchor: 'voice',
      exit: 'stay',
      source: 'existing_dream',
      previousStage: undefined,
    });
  });

  it('gives trust repair priority over a dream plan', () => {
    const plan = resolveReplyStateProtocol({
      currentQuery: '你答应来梦里，又在编了',
      dreamPlan: {
        dreamStage: 'request',
        dreamAction: 'promise',
        expectationLevel: 'warm',
        dreamAnchor: 'none',
        realityBoundary: 'dream_only',
      },
    });

    expect(plan).toMatchObject({
      protocol: 'trust_repair',
      stage: 'challenge',
      action: 'retract',
      anchor: 'fact',
    });
  });

  it('uses missing memory coverage to request retrieval', () => {
    const plan = resolveReplyStateProtocol({
      currentQuery: '还记得小时候你带我去哪儿玩吗',
      mode: 'memory',
      memoryPlan: {
        need: 'retrieve',
        contextCoverage: 'missing',
        missingConcepts: ['童年出游地点'],
        queries: [],
      },
    });

    expect(plan).toMatchObject({
      protocol: 'memory_dialogue',
      stage: 'probe',
      action: 'retrieve',
      anchor: 'time',
      exit: 'stay',
      source: 'semantic_plan',
    });
  });

  it('resets a corrected memory instead of inventing a replacement', () => {
    const plan = resolveReplyStateProtocol({
      currentQuery: '你记错了，不是十一月，是十二月',
      correctionMode: 'replace',
    });

    expect(plan).toMatchObject({
      protocol: 'memory_dialogue',
      stage: 'corrected',
      action: 'reset',
      anchor: 'time',
      exit: 'resolved',
    });
  });

  it('escalates a repeated request for active contribution', () => {
    const previous: ReplyStateProtocolPlan = {
      version: 'state_protocol_v1',
      protocol: 'active_contribution',
      stage: 'request_contribution',
      action: 'self_expression',
      anchor: 'role_present',
      exit: 'stay',
      source: 'deterministic',
    };
    const plan = resolveReplyStateProtocol({
      currentQuery: '别光问我，你再多说一点',
      recentMessages: [previousAssistant(previous)],
    });

    expect(plan).toMatchObject({
      protocol: 'active_contribution',
      stage: 'still_unsatisfied',
      action: 'self_expression',
      previousStage: 'request_contribution',
    });
  });

  it('uses the next positive user turn as an observable exit signal', () => {
    const previous: ReplyStateProtocolPlan = {
      version: 'state_protocol_v1',
      protocol: 'active_contribution',
      stage: 'request_contribution',
      action: 'self_expression',
      anchor: 'role_present',
      exit: 'stay',
      source: 'deterministic',
    };
    const plan = resolveReplyStateProtocol({
      currentQuery: '嗯，继续说',
      recentMessages: [previousAssistant(previous)],
    });

    expect(plan).toMatchObject({
      protocol: 'active_contribution',
      stage: 'engaged',
      action: 'topic_offer',
      exit: 'satisfied',
    });
  });

  it('does not revive a protocol skipped by a newer ordinary assistant turn', () => {
    const oldProtocol: ReplyStateProtocolPlan = {
      version: 'state_protocol_v1',
      protocol: 'active_contribution',
      stage: 'request_contribution',
      action: 'self_expression',
      anchor: 'role_present',
      exit: 'stay',
      source: 'deterministic',
    };
    const plan = resolveReplyStateProtocol({
      currentQuery: '今天路过老房子，站了一会儿',
      recentMessages: [
        previousAssistant(oldProtocol),
        {
          role: MessageRole.assistant,
          content: '路上慢一点',
        } as MessageEntity,
      ],
    });

    expect(plan).toBeUndefined();
  });

  it('keeps the compiled instruction compact and free of reply copy', () => {
    const plan: ReplyStateProtocolPlan = {
      version: 'state_protocol_v1',
      protocol: 'trust_repair',
      stage: 'challenge',
      action: 'retract',
      anchor: 'fact',
      exit: 'stay',
      source: 'deterministic',
    };
    const prompt = buildReplyStateProtocolPrompt(plan);

    expect(prompt.length).toBeLessThanOrEqual(80);
    expect(prompt).toContain('撤回旧说法，不补新版本');
    expect(prompt).not.toContain('可以这样说');
  });

  it('keeps the longest current protocol instruction within 80 characters', () => {
    const prompt = buildReplyStateProtocolPrompt({
      version: 'state_protocol_v1',
      protocol: 'active_contribution',
      stage: 'still_unsatisfied',
      action: 'grounded_detail',
      anchor: 'grounded_shared_past',
      exit: 'satisfied',
      source: 'semantic_plan',
      previousStage: 'request_contribution',
    });

    expect(prompt.length).toBeLessThanOrEqual(80);
    expect(prompt).not.toContain('active_contribution');
  });
});
