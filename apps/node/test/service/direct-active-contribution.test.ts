import {
  buildDirectActiveContributionPrompt,
  resolveDirectActiveContribution,
} from '../../src/service/agents/direct-active-contribution';
import type { ResolveDirectActiveContributionOptions } from '../../src/service/agents/direct-active-contribution';

function resolve(
  overrides: Partial<ResolveDirectActiveContributionOptions> = {}
) {
  return resolveDirectActiveContribution({
    planningMode: 'direct',
    currentQuery: '妈，我今天喝了热牛奶',
    mode: 'daily',
    primaryScene: 'daily_update',
    riskLevel: 'none',
    hasCorrection: false,
    hasExplicitActiveContribution: false,
    hasCapabilityConstraints: false,
    hasRealityDependencies: false,
    ...overrides,
  });
}

describe('direct active contribution', () => {
  it('opens a soft optional capability for an ordinary direct turn', () => {
    expect(resolve()).toEqual({
      version: 'direct_active_contribution_v1',
      mode: 'soft_optional',
    });
  });

  const protectedCases: Array<
    [string, Partial<ResolveDirectActiveContributionOptions>]
  > = [
    ['semantic path', { planningMode: 'semantic' }],
    ['bare acknowledgment', { currentQuery: '嗯' }],
    ['closing turn', { currentQuery: '那先这样，晚安' }],
    ['correction', { hasCorrection: true }],
    ['explicit contribution request', { hasExplicitActiveContribution: true }],
    ['boundary mode', { mode: 'boundary' }],
    ['reality dependency', { hasRealityDependencies: true }],
  ];

  it.each(protectedCases)(
    'does not add the soft capability to a protected %s',
    (_, overrides) => {
      expect(resolve(overrides)).toBeUndefined();
    }
  );

  it('keeps content choice optional and outside length, bubbles, and revision', () => {
    const plan = resolve();
    const prompt = buildDirectActiveContributionPrompt(plan!);

    expect(prompt).toContain('自主判断');
    expect(prompt).toContain('可选能力');
    expect(prompt).toContain('不为主动贡献增加字数或气泡');
    expect(prompt).toContain('不因缺少它改写已经完整的回答');
    expect(prompt).toContain('没有贴题新内容就自然停住');
  });
});
