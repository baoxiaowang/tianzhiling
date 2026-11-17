import { writeFileSync } from 'fs';
import { createHash } from 'crypto';
import { fixture } from '../fixtures/memory-package-context';

const capture = process.env.MEMORY_PROMPT_CAPTURE;
(capture ? describe : describe.skip)('frozen prompt comparison', () => {
  it('captures the actual context messages across paths without model calls', async () => {
    const original = { ...process.env };
    const result: Record<string, unknown> = {};
    jest.useFakeTimers().setSystemTime(new Date('2026-11-17T00:00:00Z'));
    try {
      for (const mode of ['active', 'off', 'shadow', 'deliberate']) {
        const { service, options } = fixture();
        if (mode === 'off') {
          (service.memoryModuleService as any).describeSelection = () => ({
            mode: 'off',
            primary: 'legacy_v1',
            recallEngine: 'legacy_v1',
            scopedUserIds: 0,
          });
        }
        if (mode === 'shadow') {
          (service.memoryModuleService as any).describeSelection = () => ({
            mode: 'shadow',
            primary: 'legacy_v1',
            recallEngine: 'legacy_v1',
            shadow: 'event_v1',
            scopedUserIds: 1,
          });
          (service.memoryModuleService!.recall as jest.Mock).mockResolvedValue({
            evidence: [],
            status: 'empty',
            diagnostics: {
              engine: 'legacy_v1',
              mode: 'shadow',
              candidateCount: 0,
              selectedCount: 0,
            },
            shadow: {
              engine: 'event_v1',
              status: 'empty',
              candidateCount: 0,
              selectedCount: 0,
              evidenceIds: [],
              evidencePreviews: [],
            },
          });
        }
        if (mode === 'deliberate')
          options.deliberateLongReplyExecutionPrompt =
            '请完成之前约定的长回复。';
        const context = await service.buildConversationContext(options);
        result[mode] = {
          messages: context.messages,
          hash: createHash('sha256')
            .update(JSON.stringify(context.messages))
            .digest('hex'),
        };
      }
      writeFileSync(capture!, JSON.stringify(result, null, 2));
    } finally {
      jest.useRealTimers();
      process.env = original;
    }
  });
});
