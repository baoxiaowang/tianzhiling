import {
  REPLY_OUTPUT_CONTRACT_VERSION,
  buildReplyOutputContractPrompt,
  buildReplyReviewOutputContractPrompt,
  resolveReplyOutputSegmentMode,
} from '../../src/service/agents/reply-output-contract';

describe('reply output contract', () => {
  it('keeps ordinary replies on one compact envelope without claims', () => {
    const prompt = buildReplyOutputContractPrompt({
      grounded: false,
      segmentMode: 'up_to_two',
      maxSegments: 2,
    });

    expect(REPLY_OUTPUT_CONTRACT_VERSION).toBe('reply_envelope_v2');
    expect(prompt).toContain('{"segments":["完整正文"]}');
    expect(prompt).toContain('segments 一到 2 项');
    expect(prompt).not.toContain('"claims"');
    expect(prompt.match(/"segments"/g)).toHaveLength(1);
  });

  it('adds evidence claims only for grounded replies', () => {
    const prompt = buildReplyOutputContractPrompt({
      grounded: true,
      segmentMode: 'up_to_two',
    });

    expect(prompt).toContain('"claims"');
    expect(prompt).toContain('"subjectRef"');
    expect(prompt).toContain('证据须支持同一对象和事实');
    expect(prompt).toContain('证据没有的细节不写');
  });

  it('always asks the generation model for one complete body', () => {
    expect(
      resolveReplyOutputSegmentMode({
        maxSegments: 2,
        preferTwoSegments: true,
      })
    ).toBe('one');

    const prompt = buildReplyOutputContractPrompt({
      grounded: false,
      segmentMode: 'one',
    });

    expect(prompt).toContain('{"segments":["完整正文"]}');
    expect(prompt).toContain('segments 恰好一项');
  });

  it('does not pass a soft two-bubble preference into generation layout', () => {
    expect(
      resolveReplyOutputSegmentMode({
        maxSegments: 2,
        encourageTwoSegments: true,
      })
    ).toBe('one');
  });

  it('keeps the character range out of the generation contract', () => {
    const prompt = buildReplyOutputContractPrompt({
      grounded: false,
      segmentMode: 'one',
      preferredRange: { minCharacters: 20, maxCharacters: 30 },
    });

    expect(prompt).not.toContain('20-30');
    expect(prompt).toContain('segments 恰好一项');
    expect(prompt).not.toContain('视为格式不合格');
  });

  it('extends the same envelope for audited revisions', () => {
    const prompt = buildReplyOutputContractPrompt({
      grounded: true,
      segmentMode: 'up_to_two',
      purpose: 'audited_revision',
    });

    expect(prompt).toContain('"resolvedIssueCodes"');
    expect(prompt).toContain('"changes"');
    expect(prompt.match(/"segments"/g)).toHaveLength(1);
  });

  it('adds shadow tool decisions only when a schema is supplied', () => {
    const prompt = buildReplyOutputContractPrompt({
      grounded: false,
      segmentMode: 'one',
      toolDecisionSchema: {
        name: 'search_relationship_memory',
        arguments: {},
        reason: '缺失概念',
      },
    });

    expect(prompt).toContain('"toolDecisions"');
    expect(prompt).toContain('无需调用就用 []');
    expect(prompt.match(/"segments"/g)).toHaveLength(1);
  });

  it('provides one shared review verdict schema', () => {
    expect(buildReplyReviewOutputContractPrompt()).toContain(
      'hard_boundary|quality_advisory'
    );
    expect(buildReplyReviewOutputContractPrompt({ hardOnly: true })).toContain(
      '"severity":"hard"'
    );
  });
});
