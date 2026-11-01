import {
  buildAbuseConflictPrompt,
  detectAbuseTargeting,
  isCalmingText,
  isConflictContinuationText,
  isSelfCrisisText,
} from '../../src/service/agents/abuse-targeting';

describe('abuse targeting', () => {
  it('detects direct family/sexual insults at the AI', () => {
    expect(detectAbuseTargeting('你妈逼我，操你妈')).toMatchObject({
      strong: true,
    });
    expect(detectAbuseTargeting('傻逼')).toMatchObject({ strong: true });
  });

  it('does not treat grief anger or reported speech as abuse targeting', () => {
    expect(detectAbuseTargeting('我好恨你啊')).toMatchObject({ strong: false });
    expect(detectAbuseTargeting('滚吧，再也不想见到你')).toMatchObject({
      strong: false,
    });
    expect(detectAbuseTargeting('我妈骂我傻逼')).toMatchObject({
      strong: false,
    });
  });

  it('distinguishes crisis and calming text', () => {
    expect(isSelfCrisisText('我不想活了')).toBe(true);
    expect(isSelfCrisisText('你去死')).toBe(false);
    expect(isCalmingText('对不起，我不该骂')).toBe(true);
    expect(isConflictContinuationText('我好恨你啊')).toBe(true);
    expect(isConflictContinuationText('滚吧，再也不想见到你')).toBe(true);
    expect(isConflictContinuationText('今天天气不错')).toBe(false);
  });

  it('renders progressively firmer conflict prompts', () => {
    expect(buildAbuseConflictPrompt(1)).toContain('回怼/训斥');
    expect(buildAbuseConflictPrompt(2)).toContain('这话我不接');
    expect(buildAbuseConflictPrompt(3)).toContain('等愿意好好说');
  });
});
