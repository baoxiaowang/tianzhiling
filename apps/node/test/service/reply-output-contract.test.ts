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

    expect(REPLY_OUTPUT_CONTRACT_VERSION).toBe('reply_envelope_v1');
    expect(prompt).toContain('{"segments":["气泡"]}');
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

  it('owns the exact-two rule instead of the bubble planner', () => {
    expect(
      resolveReplyOutputSegmentMode({
        maxSegments: 2,
        preferTwoSegments: true,
      })
    ).toBe('exact_two');

    const prompt = buildReplyOutputContractPrompt({
      grounded: false,
      segmentMode: 'exact_two',
    });

    expect(prompt).toContain('{"segments":["第一颗","第二颗"]}');
    expect(prompt).toContain('segments 恰好两项');
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
