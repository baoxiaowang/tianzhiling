import { buildReplyBrief } from '../../src/service/agents/reply-brief.service';
import { routeReplyScene } from '../../src/service/agents/reply-scene-router';
describe('one correction instruction independent of keyword classification', () => {
  it.each([
    '我上厕所肚子咕咕能是饿了？',
    '我是你孙女',
    '不是这样的',
    '我说过了',
    '现在都是坐便',
  ])('%s', currentQuery => {
    const brief = buildReplyBrief({
      currentQuery,
      route: routeReplyScene({ currentQuery }),
    });
    expect(brief.prompt.split('## 理解与纠正')).toHaveLength(2);
    expect(brief.prompt).toContain('包括反问和省略');
    expect(brief.prompt).toContain('未说明的部分不要另猜一个版本');
    expect(brief.prompt).not.toContain('不要逐字重复上一轮被用户否定的原句');
  });
});
