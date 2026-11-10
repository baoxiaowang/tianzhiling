import {
  buildReplyCommActPrompt,
  resolveConversationState,
  resolveReplyCommAct,
  verifyReplyCommActEcho,
} from '../../src/service/agents/reply-comm-act';
import { collectContentUnits } from '../../src/service/agents/reply-content-unit';

describe('reply comm act', () => {
  it('maps exploring turns to content, concretization and invitation', () => {
    const units = collectContentUnits({
      objectPlan: {
        objects: [
          { ref: 'o1', mention: '你女婿', kind: 'other_person', binding: 'unknown', confidence: 'high' },
        ],
        focusRefs: ['o1'],
        ambiguousMentions: [],
      },
      anchors: [{ text: '前两天下班回家莫名眼眶红了', importance: 'high' }],
    });
    const plan = resolveReplyCommAct({
      currentQuery: '前两天下班回家莫名眼眶红了，你女婿问怎么了',
      state: 'exploring',
      contentUnits: units,
    });

    expect(plan.steps.map(step => step.act)).toEqual([
      'echo_content',
      'concretize',
      'invite',
    ]);
    expect(plan.targetUnit?.text).toBe('你女婿');
    expect(buildReplyCommActPrompt(plan)).toContain('L1=复述用户说的具体内容');
    expect(buildReplyCommActPrompt(plan)).toContain('锚点：你女婿');
  });

  it('uses natural close when the user is withdrawing from the conversation', () => {
    expect(resolveConversationState({ currentQuery: '我先睡了，晚安' })).toBe(
      'closing'
    );

    const plan = resolveReplyCommAct({
      currentQuery: '我先睡了，晚安',
      state: 'closing',
    });
    expect(plan.steps[plan.steps.length - 1].act).toBe('natural_close');
  });

  it('uses follow_up_probe when a concrete question is useful for the open turn', () => {
    const units = collectContentUnits({
      objectPlan: {
        objects: [
          { ref: 'o1', mention: '你女婿', kind: 'other_person', binding: 'unknown', confidence: 'high' },
        ],
        focusRefs: ['o1'],
        ambiguousMentions: [],
      },
      anchors: [{ text: '前两天下班回家莫名眼眶红了', importance: 'high' }],
    });
    const plan = resolveReplyCommAct({
      currentQuery: '前两天下班回家莫名眼眶红了，你女婿问怎么了',
      state: 'exploring',
      contentUnits: units,
      questionNeed: 'helpful',
      preferAsk: true,
    });

    expect(plan.steps[plan.steps.length - 1].act).toBe('follow_up_probe');
    expect(buildReplyCommActPrompt(plan)).toContain('L3=顺着已确认的具体内容问一个开放式问题');
    expect(buildReplyCommActPrompt(plan)).toContain('追问最多一个');
  });

  it('uses follow_up_probe when the turn plan marks an open topic_followup', () => {
    const plan = resolveReplyCommAct({
      currentQuery: '家里的房子正在装修，还没装完',
      state: 'exploring',
      contentUnits: [
        { kind: 'event', text: '家里的房子正在装修', source: 'utterance' },
      ],
      questionNeed: 'helpful',
      turnPlan: {
        state: 'exploring',
        open: [
          {
            object: 'user',
            need: 'topic_followup',
            detail: '装修进行到哪一步，什么时候完工',
            priority: 'supporting',
          },
        ],
        goal: 'deepen',
        action: 'question',
        target: '关心装修进度',
        avoid: 'none',
        close: 'possible',
      },
    });

    expect(plan.steps[plan.steps.length - 1].act).toBe('follow_up_probe');
  });

  it('does not over-ask when the topic is only supporting and questionNeed is none', () => {
    const plan = resolveReplyCommAct({
      currentQuery: '家里的房子正在装修，还没装完',
      state: 'exploring',
      contentUnits: [
        { kind: 'event', text: '家里的房子正在装修', source: 'utterance' },
      ],
      questionNeed: 'none',
      turnPlan: {
        state: 'exploring',
        open: [
          {
            object: 'user',
            need: 'topic_followup',
            detail: '装修什么时候完工',
            priority: 'supporting',
          },
        ],
        goal: 'deepen',
        action: 'question',
        target: '关心装修进度',
        avoid: 'none',
        close: 'possible',
      },
    });

    expect(plan.steps[plan.steps.length - 1].act).toBe('invite');
  });

  it('keeps follow_up_probe when a concrete topic is still open in a deepening turn', () => {
    const plan = resolveReplyCommAct({
      currentQuery: '今天开车回来的时候看到一辆银灰色的SUV，到它右转的地方才发现那里没有路口',
      state: 'deepening',
      contentUnits: [
        { kind: 'event', text: '今天开车回来的时候看到一辆银灰色的SUV', source: 'utterance' },
      ],
      questionNeed: 'helpful',
      turnPlan: {
        state: 'deepening',
        open: [
          {
            object: 'user',
            need: 'topic_followup',
            detail: '你后来还看到那个地方了吗',
            priority: 'supporting',
          },
        ],
        goal: 'deepen',
        action: 'question',
        target: '顺着路上的异常经历继续了解',
        avoid: 'none',
        close: 'possible',
      },
    });

    expect(plan.steps[plan.steps.length - 1].act).toBe('follow_up_probe');
  });

  it('lets a repeated strategy alternative drive the L3 posture', () => {
    const plan = resolveReplyCommAct({
      currentQuery: '今天又路过那家店了',
      state: 'exploring',
      strategyQuality: {
        repeatedMoves: ['generic_empathy', 'generic_presence'],
        preferredAlternative: 'topic_transition',
        observedAssistantTurns: 2,
      },
    });

    expect(plan.steps[plan.steps.length - 1].act).toBe('redirect');
    expect(buildReplyCommActPrompt(plan)).toContain('L3=贴着新信息轻转相邻一步');
  });

  it('verifies that a concrete reply echoes one of the targeted units', () => {
    const units = collectContentUnits({
      objectPlan: {
        objects: [
          { ref: 'o1', mention: '你女婿', kind: 'other_person', binding: 'unknown', confidence: 'high' },
        ],
        focusRefs: ['o1'],
        ambiguousMentions: [],
      },
      anchors: [{ text: '前两天下班回家莫名眼眶红了', importance: 'high' }],
    });
    const plan = resolveReplyCommAct({
      currentQuery: '前两天下班回家莫名眼眶红了，你女婿问怎么了',
      state: 'exploring',
      contentUnits: units,
    });

    expect(
      verifyReplyCommActEcho('你女婿也跟着哭了，爸心里都懂', plan)
    ).toEqual({
      passed: true,
      echoedUnits: expect.arrayContaining([
        expect.objectContaining({ text: '你女婿' }),
      ]),
    });
  });
});
