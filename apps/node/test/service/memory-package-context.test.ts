import { fixture, groupId } from '../fixtures/memory-package-context';

describe('memory package context integration', () => {
  it('preserves a real group through recall mapping, selection and narrative rendering', async () => {
    const { service, options } = fixture();
    const result = await service.buildConversationContext(options);
    expect(service.memoryModuleService!.recall).toHaveBeenCalled();
    expect(result.diagnostics.memoryInjectionPackages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          groupId,
          originalMembers: 2,
          injectedMembers: 2,
        }),
      ])
    );
    expect(JSON.stringify(result.messages)).toContain('一件有来龙去脉的事');
    expect(JSON.stringify(result.messages)).toContain('去年住院');
  });
});
