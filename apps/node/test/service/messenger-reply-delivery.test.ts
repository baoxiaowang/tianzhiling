import {
  MESSENGER_REPLY_MAX_BUBBLES,
  buildMessengerReplyDeliverySegments,
} from '../../src/service/agents/messenger-reply-delivery';

describe('messenger reply delivery', () => {
  it('splits task completion and the next memory task into two bubbles', () => {
    const source =
      '导入完成后，过去的对话会帮助妈妈延续以前的说话习惯。接下来我也可以帮你补全妈妈的记忆——你最先想到妈妈平时常说的哪句话？';

    const segments = buildMessengerReplyDeliverySegments(source);

    expect(segments).toEqual([
      '导入完成后，过去的对话会帮助妈妈延续以前的说话习惯。',
      '接下来我也可以帮你补全妈妈的记忆——你最先想到妈妈平时常说的哪句话？',
    ]);
    expect(segments.join('')).toBe(source);
  });

  it('keeps a short acknowledgement in one bubble', () => {
    expect(buildMessengerReplyDeliverySegments('好，我记下了。')).toEqual([
      '好，我记下了。',
    ]);
  });

  it('never exceeds two bubbles or changes the completed reply', () => {
    const source =
      '第一件事已经说清楚了。第二件事也补充完整了。最后这一点会继续保留，不会为了拆泡删掉。';
    const segments = buildMessengerReplyDeliverySegments(source);

    expect(MESSENGER_REPLY_MAX_BUBBLES).toBe(2);
    expect(segments.length).toBeLessThanOrEqual(2);
    expect(segments.join('')).toBe(source);
  });
});
