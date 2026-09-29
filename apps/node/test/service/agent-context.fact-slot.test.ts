import { AgentContextService } from '../../src/service/agents/agent.context';

/**
 * 上下文验收阻塞问题的最小回归：事实对象可能缺失 key（历史数据/测试注入/跨版本字段）。
 * 修复前对 undefined 调用 key.startsWith 会直接抛 TypeError，导致上下文级用例无法运行。
 */
describe('AgentContextService.resolveFactSemanticSlot', () => {
  const service = new AgentContextService();
  const resolve = (key: unknown): string =>
    (service as unknown as {
      resolveFactSemanticSlot(value?: string | null): string;
    }).resolveFactSemanticSlot(key as string);

  it('keeps the original behavior for valid keys', () => {
    expect(resolve('relationship.agent_calls_user')).toBe('address.current');
    expect(resolve('relationship.forbidden_user_address.foo')).toBe(
      'address.forbidden'
    );
    expect(resolve('relationship.address_usage_style')).toBe('address.usage');
    expect(resolve('user.preference.food_update')).toBe('food.current');
    expect(resolve('grief_need.foo')).toBe('emotion.response');
  });

  it('returns an empty slot instead of throwing for missing keys', () => {
    expect(() => resolve(undefined)).not.toThrow();
    expect(resolve(undefined)).toBe('');
    expect(resolve(null)).toBe('');
  });

  it('returns an empty slot for blank or abnormal key types', () => {
    expect(resolve('')).toBe('');
    expect(resolve('   ')).toBe('');
    expect(resolve(123 as unknown as string)).toBe('');
    expect(resolve({} as unknown as string)).toBe('');
  });
});
