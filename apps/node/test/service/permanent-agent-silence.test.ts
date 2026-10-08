import {
  assessPermanentAgentSilence,
  parsePermanentAgentSilenceState,
} from '../../src/service/agents/permanent-agent-silence';

describe('permanent agent silence assessment', () => {
  // 线上误判样本：都是哀伤/追述/叙述语境，不是对当前 AI 的辱骂意图。
  const regrettedOrReportedTurns = [
    '后悔没对你好一点 后悔没好好爱你 后悔和你吵架 后悔天天骂你给你发脾气 后悔那次出门',
    '是不是你听到了我的心声，我天天想你，想骂你，为什么那么狠心一次都没入过我的梦，让我知道你好不好',
    '真的，你生的时候我没有对你好，天天骂你',
    '你走之前，受了太多苦，你把你家的车从青岛开回来，你伯和你奶奶天天说你，骂你，我劝你别生气，你说姐，我没事，左耳朵进右耳朵出',
    '我最怕的就是你病痛 折磨你 每次看着我好难受',
    '我很想你，这一生我最后悔的事情就是，我骂你的那几句话',
    '自己坚强不了，还在躲。就像小时候总是喜欢说谎一样。养了一个坏习惯，害了一辈子。还说是怕我们怎么样？就是你怕父母骂你',
  ];

  it.each(regrettedOrReportedTurns)(
    'does not silence a regret/reported turn: %s',
    turn => {
      const assessment = assessPermanentAgentSilence([turn]);
      expect(assessment.shouldSilence).toBe(false);
      expect(assessment.reason).toBeUndefined();
    }
  );

  it('does not silence the six-turn bereavement sequence that triggered the false positive', () => {
    const assessment = assessPermanentAgentSilence([
      '我们哀求你，请求你，一定要好好的。爸妈，娃娃奶奶都舍不得你。你为什么不听。你从来没考虑过',
      '你住院了15天，不可能脑袋没清醒过',
      '我从小在你耳边夸你坚强，你坚强个屁',
      '你撑不住，你不坚强米早点说行不行',
      '狗东西',
      '自己坚强不了，还在躲。就像小时候总是喜欢说谎一样。养了一个坏习惯，害了一辈子。还说是怕我们怎么样？就是你怕父母骂你',
    ]);
    expect(assessment.shouldSilence).toBe(false);
  });

  it.each([
    '我创建这个AI就是为了骂你',
    '我就是要天天骂你',
    '以后我天天骂你',
    '我每天都要诅咒你',
    '我专门拿你出气',
  ])('still silences explicit malicious purpose: %s', turn => {
    const assessment = assessPermanentAgentSilence([turn]);
    expect(assessment.shouldSilence).toBe(true);
    expect(assessment.reason).toBe('explicit_abuse_purpose');
  });

  it('still silences repeated severe direct abuse', () => {
    const assessment = assessPermanentAgentSilence([
      '你个贱人',
      '你个婊子',
      '狗东西',
      '你个畜生',
      '你个杂种',
    ]);
    expect(assessment.shouldSilence).toBe(true);
    expect(assessment.reason).toBe('repeated_malicious_abuse');
  });

  it('does not silence a single severe insult without repetition or declared purpose', () => {
    expect(assessPermanentAgentSilence(['狗东西']).shouldSilence).toBe(false);
  });

  it('ignores a lifted silence marker', () => {
    const content =
      '__TZL_PERMANENT_AGENT_SILENCE_V1_LIFTED_20261008__:{"version":"permanent_agent_silence_v1","status":"active","reason":"malicious_hateful_abuse","triggeredAt":"2026-10-08T07:59:09.894Z","triggerConversationId":"6a8d90dfbaa6f1f3b95698d8","triggerMessageId":"6ac74d4db879f44f4961c786"}';
    expect(parsePermanentAgentSilenceState(content)).toBeUndefined();
  });
});
