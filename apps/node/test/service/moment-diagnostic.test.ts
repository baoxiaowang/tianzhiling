import {
  evaluateMomentFrameSegments,
  resolveMomentFrame,
  resolveMomentFilterMode,
  shouldBlockMemoryRetrieval,
  buildMomentFramePrompt,
} from '../../src/service/agents/moment-frame';
import { buildReplyBrief } from '../../src/service/agents/reply-brief.service';
import { routeReplyScene } from '../../src/service/agents/reply-scene-router';
describe('moment diagnostic', () => {
  const original = process.env.MOMENT_FILTER_MODE;
  afterEach(() => {
    if (original === undefined) delete process.env.MOMENT_FILTER_MODE;
    else process.env.MOMENT_FILTER_MODE = original;
  });
  const frame = resolveMomentFrame({
    currentQuery: '洗完澡，躺了',
    recentMessages: [],
    isDeceased: true,
  });
  it('defaults unknown modes to enforcement', () => {
    delete process.env.MOMENT_FILTER_MODE;
    expect(resolveMomentFilterMode()).toBe('enforce');
    process.env.MOMENT_FILTER_MODE = 'invalid';
    expect(resolveMomentFilterMode()).toBe('enforce');
  });
  it.each(['我还记着你爱吃的面，香得很', '不是说闻到香味，你说的是已经吃完了'])(
    'preserves prose and records old decision: %s',
    text => {
      process.env.MOMENT_FILTER_MODE = 'enforce';
      const old = evaluateMomentFrameSegments([text], frame);
      process.env.MOMENT_FILTER_MODE = 'diagnostic';
      const input = [text];
      const result = evaluateMomentFrameSegments(input, frame);
      expect(result.wouldFilter).toBe(true);
      expect(result.reasons.length).toBeGreaterThan(0);
      expect(result.segments).toEqual(input);
      expect(result.segments).not.toBe(input);
      expect(old.segments).not.toEqual(input);
      expect(shouldBlockMemoryRetrieval(frame)).toBe(true);
    }
  );
  it('leaves ordinary prose and empty input unchanged', () => {
    process.env.MOMENT_FILTER_MODE = 'diagnostic';
    expect(
      evaluateMomentFrameSegments(['到家了，心里还是不想待着。'], frame)
        .wouldFilter
    ).toBe(false);
    expect(evaluateMomentFrameSegments([], frame).segments).toEqual([]);
  });
  it('merges comprehension and correction without forced scene phrasing', () => {
    process.env.MOMENT_FILTER_MODE = 'diagnostic';
    const currentQuery = '到家了，在外面晃荡一个半小时，不想回家';
    const prompt = buildReplyBrief({
      currentQuery,
      route: routeReplyScene({ currentQuery }),
    }).prompt;
    expect(prompt.split('## 理解与纠正')).toHaveLength(2);
    expect(prompt).toContain(
      '区分已发生的事、当前状态、未来打算和仍存在的感受'
    );
    expect(buildMomentFramePrompt(frame)).not.toContain('最多一个气泡');
    expect(buildMomentFramePrompt(frame)).toContain('粗粒度分类');
  });
});
