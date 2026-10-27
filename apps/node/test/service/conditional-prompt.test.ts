import {
  compileConditionalPrompts,
  type ConditionalPromptCandidate,
} from '../../src/service/agents/conditional-prompt';

function candidate(
  id: string,
  priority: number,
  text: string,
  suppresses?: string[]
): ConditionalPromptCandidate {
  return { id, priority, text, suppresses };
}

describe('conditional prompt compiler', () => {
  it('returns nothing when there are no candidates', () => {
    const result = compileConditionalPrompts([]);
    expect(result.prompt).toBe('');
    expect(result.fired).toEqual([]);
  });

  it('fires by priority and keeps the budget', () => {
    const result = compileConditionalPrompts(
      [
        candidate('low', 10, 'low'),
        candidate('high', 90, 'high'),
        candidate('mid', 50, 'mid'),
      ],
      { maxBlocks: 2, maxChars: 100 }
    );
    expect(result.fired).toEqual(['high', 'mid']);
    expect(result.dropped).toEqual(['low']);
    expect(result.prompt).toBe('high\nmid');
  });

  it('lets a fired block suppress lower-priority blocks', () => {
    const result = compileConditionalPrompts([
      candidate('test_mode', 70, 'test', [
        'direct_answer',
        'return_turn_proof',
      ]),
      candidate('direct_answer', 50, 'answer'),
      candidate('return_turn_proof', 40, 'return'),
      candidate('safety', 100, 'safety'),
    ]);
    expect(result.fired).toEqual(['safety', 'test_mode']);
    expect(result.suppressed).toEqual(['direct_answer', 'return_turn_proof']);
    expect(result.prompt).not.toContain('answer');
    expect(result.prompt).not.toContain('return');
  });

  it('does not let test mode suppress safety or correction', () => {
    const result = compileConditionalPrompts([
      candidate('test_mode', 70, 'test', ['direct_answer']),
      candidate('safety', 100, 'safety'),
      candidate('correction', 90, 'correction'),
      candidate('direct_answer', 50, 'answer'),
    ]);
    expect(result.fired).toContain('safety');
    expect(result.fired).toContain('correction');
    expect(result.fired).not.toContain('direct_answer');
  });

  it('enforces the character budget', () => {
    const result = compileConditionalPrompts(
      [
        candidate('a', 90, 'a'.repeat(60)),
        candidate('b', 80, 'b'.repeat(60)),
        candidate('c', 70, 'c'.repeat(60)),
      ],
      { maxBlocks: 3, maxChars: 130 }
    );
    expect(result.fired).toEqual(['a', 'b']);
    expect(result.dropped).toEqual(['c']);
    expect(result.chars).toBeLessThanOrEqual(130);
  });

  it('drops empty candidates silently', () => {
    const result = compileConditionalPrompts([
      candidate('empty', 100, '   '),
      candidate('real', 10, 'real'),
    ]);
    expect(result.fired).toEqual(['real']);
    expect(result.dropped).toEqual([]);
  });
});
