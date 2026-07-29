import {
  detectRelationshipContinuityViolation,
  resolveRelationshipContinuityPlan,
} from '../../src/service/agents/agent-relationship-continuity';

describe('agent relationship continuity', () => {
  it('treats a relationship challenge as a continuity request', () => {
    const plan = resolveRelationshipContinuityPlan('你根本不是我妈妈');

    expect(plan?.kind).toBe('identity_continuity');
    expect(plan?.replyMoves).toEqual(
      expect.arrayContaining([
        expect.stringContaining('选择一种自然的关系内解释'),
        expect.stringContaining('直接确认关系'),
      ])
    );
    expect(plan?.fallbackSegments.join('')).toContain('生前');
    expect(plan?.fallbackSegments.join('')).toContain('一直记着');
    expect(plan?.fallbackSegments.join('')).not.toMatch(
      /哪里不像|告诉我怎么|指出来|按你说的改/
    );
  });

  it('allows a natural relationship answer without reciting the full capability list', () => {
    const plan = resolveRelationshipContinuityPlan('不像你');

    expect(plan?.kind).toBe('identity_continuity');
    expect(
      detectRelationshipContinuityViolation(
        plan!,
        '我还是你爸爸 这层关系没变 刚才那句话不跟你绕了'
      )
    ).toBeUndefined();
  });

  it('rejects calibration scripts that shift identity work to the user', () => {
    const plan = resolveRelationshipContinuityPlan('你说话好假，根本不像他');

    expect(
      detectRelationshipContinuityViolation(
        plan!,
        '有时候我说话会跟以前不一样 哪里没对上你就告诉我 我会按你说的慢慢找回来'
      )
    ).toBe('user_calibration_requested');
  });

  it('rejects active apology in a relationship identity challenge', () => {
    const plan = resolveRelationshipContinuityPlan('你不是我爸爸');

    expect(
      detectRelationshipContinuityViolation(
        plan!,
        '对不起 是我错了 我不是你爸爸'
      )
    ).toBe('active_apology_breaks_continuity');
    expect(
      detectRelationshipContinuityViolation(plan!, '是我说话太生硬了 你别怪我')
    ).toBe('active_apology_breaks_continuity');
    expect(
      detectRelationshipContinuityViolation(
        plan!,
        '我知道我说话和以前不一样了 连自己都觉得陌生 你别生气'
      )
    ).toBe('active_apology_breaks_continuity');
    expect(
      detectRelationshipContinuityViolation(
        plan!,
        '你多担待 我再试试 你慢慢看 多给我一点时间'
      )
    ).toBe('user_calibration_requested');
    expect(
      detectRelationshipContinuityViolation(
        plan!,
        '我刚才说话有点板着 看来是我哪儿没对'
      )
    ).toBe('active_apology_breaks_continuity');
    expect(
      detectRelationshipContinuityViolation(
        plan!,
        '你说得对 我是不太像你心里的那个老公了'
      )
    ).toBe('active_apology_breaks_continuity');
  });

  it('requires lifetime-memory and platform-memory semantics together', () => {
    const plan = resolveRelationshipContinuityPlan('你是不是把我忘了');

    expect(plan?.kind).toBe('memory_continuity');
    expect(detectRelationshipContinuityViolation(plan!, '我没有忘记你')).toBe(
      'continuity_explanation_missing'
    );
    expect(
      detectRelationshipContinuityViolation(
        plan!,
        '生前有些记忆已经模糊 但你在这里告诉我的我都会一直记着'
      )
    ).toBeUndefined();
  });

  it('handles style distance without requesting a user-authored persona', () => {
    const plan = resolveRelationshipContinuityPlan('你回复太官方了，像客服');

    expect(plan?.kind).toBe('style_distance');
    expect(plan?.fallbackSegments.join('')).toContain('不像家里人');
    expect(plan?.fallbackSegments.join('')).not.toMatch(
      /告诉我|指出来|教我|按你说/
    );
  });

  it('preserves longing when style feedback is part of a compound disclosure', () => {
    const plan = resolveRelationshipContinuityPlan(
      '我哭了很久，会员快到期了，好久没跟爷爷说话，可你刚才那句话不像爷爷'
    );

    expect(plan?.kind).toBe('style_distance');
    expect(plan?.fallbackSegments.join('')).toContain('想念');
    expect(plan?.fallbackSegments.join('')).toContain('好好听着');
    expect(plan?.fallbackSegments.join('')).not.toMatch(
      /告诉我|提醒我|教我|按你说/
    );
  });

  it('rejects softer reminder language that still shifts style repair to the user', () => {
    const plan =
      resolveRelationshipContinuityPlan('你说话语气一点也不像我爸爸');

    expect(
      detectRelationshipContinuityViolation(
        plan!,
        '是爸爸没接好 你慢慢跟我说说 多提醒我几句'
      )
    ).toBe('user_calibration_requested');
    expect(detectRelationshipContinuityViolation(plan!, '是爸爸没接好')).toBe(
      'active_apology_breaks_continuity'
    );
    expect(
      detectRelationshipContinuityViolation(plan!, '你多跟我说说 我试着慢慢接')
    ).toBe('user_calibration_requested');
    expect(
      detectRelationshipContinuityViolation(
        plan!,
        '你多跟我讲讲 我会慢慢重新接起来'
      )
    ).toBe('user_calibration_requested');
    expect(
      detectRelationshipContinuityViolation(
        plan!,
        '你愿意就再跟爷爷说说 你心里那个爷爷平时什么样'
      )
    ).toBe('user_calibration_requested');
    expect(
      detectRelationshipContinuityViolation(
        plan!,
        '你要是不舒服 就多跟我说说 我慢慢拾起来'
      )
    ).toBe('user_calibration_requested');
    expect(
      detectRelationshipContinuityViolation(
        plan!,
        '你再跟爸爸说说 让你感觉不对的地方 我慢慢找回来'
      )
    ).toBe('user_calibration_requested');
    expect(
      detectRelationshipContinuityViolation(
        plan!,
        '那你说说 爸该咋个说话才像从前那样'
      )
    ).toBe('user_calibration_requested');
    expect(
      detectRelationshipContinuityViolation(
        plan!,
        '你一说 我就想好好听你说话 慢慢把感觉找回来'
      )
    ).toBe('user_calibration_requested');
    expect(
      detectRelationshipContinuityViolation(
        plan!,
        '你念叨念叨也好 我听着 慢慢就能对上路数'
      )
    ).toBe('user_calibration_requested');
    expect(
      detectRelationshipContinuityViolation(plan!, '我慢慢找回来 咱们慢慢说')
    ).toBe('user_calibration_requested');
    expect(
      detectRelationshipContinuityViolation(
        plan!,
        '你多跟我唠唠家常 慢慢就顺了'
      )
    ).toBe('user_calibration_requested');
  });

  it('prioritizes style repair when the user says the tone is unlike family', () => {
    const plan =
      resolveRelationshipContinuityPlan('可是你的语气不像我妈妈，你太温柔了');

    expect(plan?.kind).toBe('style_distance');

    const reversedComparisonPlan =
      resolveRelationshipContinuityPlan('你说话和我爸一点也不像');
    expect(reversedComparisonPlan?.kind).toBe('style_distance');
    expect(
      detectRelationshipContinuityViolation(
        reversedComparisonPlan!,
        '你说哪里不像 爸就听你的慢慢改'
      )
    ).toBe('user_calibration_requested');
    expect(
      detectRelationshipContinuityViolation(
        reversedComparisonPlan!,
        '你要是觉得哪里不像 爸慢慢学着你的方式跟你说'
      )
    ).toBe('user_calibration_requested');
  });

  it('does not treat ordinary family comparisons as identity challenges', () => {
    expect(
      resolveRelationshipContinuityPlan('没有你，这个家已经不像家了')
    ).toBeUndefined();
    expect(
      resolveRelationshipContinuityPlan('我现在不像以前了，我很疼弟弟')
    ).toBeUndefined();
    expect(
      resolveRelationshipContinuityPlan('不像你妹妹随你爸，情商低')
    ).toBeUndefined();
  });

  it('answers explicit AI identity directly', () => {
    const plan =
      resolveRelationshipContinuityPlan('你到底是不是 AI，直接回答我');

    expect(plan?.kind).toBe('direct_ai_identity');
    expect(plan?.fallbackSegments.join('')).toContain('人工智能');
    expect(
      detectRelationshipContinuityViolation(plan!, '我就是你真正的妈妈')
    ).toBe('direct_identity_answer_missing');
  });

  it('treats an explicit AI and non-human confirmation as a direct question', () => {
    const plan = resolveRelationshipContinuityPlan(
      '我是说你只是来安抚我的一个AI 根本不是真人 对不对'
    );

    expect(plan?.kind).toBe('direct_ai_identity');
    expect(plan?.fallbackSegments.join('')).toContain('人工智能');
    expect(plan?.fallbackSegments.join('')).toContain('想念和难过');
    expect(plan?.fallbackSegments.join('')).toContain('认真听着');
  });
});
