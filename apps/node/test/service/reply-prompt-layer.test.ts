import {
  REPLY_PROMPT_LAYER_VERSION,
  normalizeReplyPromptLayerMode,
  normalizeReplyPromptReductionMode,
  resolveReplyPromptLayerPlan,
} from '../../src/service/agents/reply-prompt-layer';

describe('reply-prompt-layer', () => {
  it('normalizes reduction mode to off or active', () => {
    expect(normalizeReplyPromptReductionMode(undefined)).toBe('active');
    expect(normalizeReplyPromptReductionMode('off')).toBe('off');
    expect(normalizeReplyPromptReductionMode('unknown')).toBe('active');
  });

  it('normalizes layer mode to minimal, hybrid, or full', () => {
    expect(normalizeReplyPromptLayerMode(undefined)).toBe('hybrid');
    expect(normalizeReplyPromptLayerMode('minimal')).toBe('minimal');
    expect(normalizeReplyPromptLayerMode('full')).toBe('full');
    expect(normalizeReplyPromptLayerMode('unknown')).toBe('hybrid');
  });

  it('does not treat every semantic planner call as an L5-complex turn', () => {
    const plan = resolveReplyPromptLayerPlan({
      config: { mode: 'active', modelPromptLayer: 'hybrid', l5TraceOnly: true },
      planningMode: 'semantic',
      hasContinuitySummary: false,
    });

    expect(plan.version).toBe(REPLY_PROMPT_LAYER_VERSION);
    expect(plan.reductionActive).toBe(true);
    expect(plan.complex).toBe(false);
    expect(plan.includeL5).toBe(false);
    expect(plan.l5TraceOnly).toBe(true);
    expect(plan.includeTools).toBe(false);
  });

  it('drops L5 from ordinary direct turns in hybrid mode but keeps it as trace only', () => {
    const plan = resolveReplyPromptLayerPlan({
      config: { mode: 'active', modelPromptLayer: 'hybrid', l5TraceOnly: true },
      planningMode: 'direct',
      hasContinuitySummary: true,
    });

    expect(plan.planningMode).toBe('direct');
    expect(plan.complex).toBe(false);
    expect(plan.includeL5).toBe(false);
    expect(plan.includeReading).toBe(false);
    expect(plan.includeContinuity).toBe(true);
    expect(plan.includeMode).toBe(false);
    expect(plan.includeEvidence).toBe(true);
  });

  it('keeps full layers when reduction is off or layer mode is full', () => {
    const off = resolveReplyPromptLayerPlan({
      config: { mode: 'off', modelPromptLayer: 'hybrid', l5TraceOnly: true },
      planningMode: 'direct',
      hasContinuitySummary: false,
    });
    const full = resolveReplyPromptLayerPlan({
      config: { mode: 'active', modelPromptLayer: 'full', l5TraceOnly: true },
      planningMode: 'direct',
      hasContinuitySummary: false,
    });

    expect(off.includeL5).toBe(true);
    expect(off.includeReading).toBe(true);
    expect(off.l5TraceOnly).toBe(false);
    expect(full.includeL5).toBe(true);
    expect(full.includeReading).toBe(false);
  });

  it('recognizes tool plans as available tools', () => {
    const plan = resolveReplyPromptLayerPlan({
      config: { mode: 'active', modelPromptLayer: 'hybrid', l5TraceOnly: true },
      planningMode: 'direct',
      chatToolPlan: {
        mode: 'active',
        availableTools: [],
      } as never,
      hasContinuitySummary: false,
    });

    expect(plan.includeTools).toBe(true);
  });
});
