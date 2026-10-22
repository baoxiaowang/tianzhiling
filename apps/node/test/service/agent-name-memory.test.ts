import { extractAgentNameMemory } from '../../src/service/agents/agent-name-memory';

describe('agent name memory action phrases', () => {
  it('does not treat 叫你起床 as a preferred name', () => {
    const result = extractAgentNameMemory('我就叫你起床，你就说再睡十分钟');

    expect(result.preferredName).toBeUndefined();
    expect(result.explicitAliases).not.toContain('起床');
  });

  it('still extracts an explicit preferred name', () => {
    expect(extractAgentNameMemory('以后叫你阿辰').preferredName).toBe('阿辰');
  });
});
