import {
  ReplyRevisionContract,
  buildReplyRevisionContractPrompt,
  revisionContractSatisfied,
} from '../../src/service/agents/reply-revision-contract';

describe('reply revision contract', () => {
  const contract: ReplyRevisionContract = {
    version: 'reply_revision_contract_v1',
    speechAct: 'answer',
    answerTarget: '你最后为什么没有告诉我们？',
    mustPreserveUnits: [
      {
        id: 'question_1',
        kind: 'question',
        text: '你最后为什么没有告诉我们？',
        required: true,
      },
      {
        id: 'emotion_1',
        kind: 'emotion',
        text: '难过：一直放不下',
        required: false,
      },
    ],
    forbiddenSemantics: ['无证据补写临终动机'],
  };

  it('makes required task units explicit in the revision prompt', () => {
    const prompt = buildReplyRevisionContractPrompt(contract);

    expect(prompt).toContain('言语动作=answer');
    expect(prompt).toContain('question_1*=');
    expect(prompt).toContain('边界修复不能把用户的问题');
  });

  it('rejects a revision that changes the speech act or drops a required unit', () => {
    expect(
      revisionContractSatisfied({
        contract,
        speechAct: 'comfort',
        preservedUnitIds: ['question_1'],
        segments: ['这件事我也很难过'],
      })
    ).toBe(false);
    expect(
      revisionContractSatisfied({
        contract,
        speechAct: 'answer',
        preservedUnitIds: [],
        segments: ['我不能确认当时的原因'],
      })
    ).toBe(false);
  });

  it('accepts a task-preserving revision and rejects generic task loss', () => {
    expect(
      revisionContractSatisfied({
        contract,
        speechAct: 'answer',
        preservedUnitIds: ['question_1'],
        segments: ['当时为什么没告诉你们，我现在不能确认，不想拿猜测骗你'],
      })
    ).toBe(true);
    expect(
      revisionContractSatisfied({
        contract,
        speechAct: 'answer',
        preservedUnitIds: ['question_1'],
        segments: ['我在'],
      })
    ).toBe(false);
  });
});
