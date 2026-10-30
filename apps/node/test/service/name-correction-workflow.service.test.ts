import {
  isNameCorrectionCandidate,
  NameCorrectionWorkflowService,
} from '../../src/service/agents/name-correction-workflow.service';

describe('name correction workflow', () => {
  it('recognizes high-alert correction candidates without treating ordinary mentions as triggers', () => {
    expect(
      isNameCorrectionCandidate('你怎么又叫他小蹦蛋儿？我说了多少次，是小蹦得儿')
    ).toBe(true);
    expect(isNameCorrectionCandidate('小蹦得儿今天很乖')).toBe(false);
  });

  it('writes the corrected name only after a high-alert proposal', async () => {
    const service = new NameCorrectionWorkflowService();
    service.logger = { info: jest.fn(), warn: jest.fn() } as never;
    service.openAIService = {
      isEnabled: jest.fn(() => true),
      generateText: jest.fn().mockResolvedValue({
        content: JSON.stringify({
          highAlert: true,
          needsClarification: false,
          personId: 'person:p1',
          wrongNames: ['小蹦蛋儿'],
          correctNames: ['小蹦得儿'],
          allowedNames: ['小朵朵'],
          confidence: 0.94,
          reason: '用户明确纠正',
        }),
      }),
    } as never;
    service.knownPersonModel = {
      find: jest.fn().mockResolvedValue([
        {
          id: 'p1',
          realName: '小蹦得儿',
          preferredName: '小蹦得儿',
          aliases: ['小朵朵'],
          relationToUser: '女儿',
        },
      ]),
    } as never;
    service.messageModel = {
      find: jest.fn().mockResolvedValue([
        { role: 'assistant', content: '小蹦蛋儿今天乖不乖' },
      ]),
    } as never;
    service.personAddressService = {
      applyStructuredNameCorrection: jest.fn().mockResolvedValue(true),
    } as never;

    const result = await service.maybeApply({
      userId: '665000000000000000001001' as never,
      conversationId: '665000000000000000001002' as never,
      currentText: '你怎么又叫他小蹦蛋儿？我说了多少次，是小蹦得儿',
      currentMessageId: '665000000000000000001003' as never,
    });

    expect(result.applied).toBe(true);
    expect(
      service.personAddressService.applyStructuredNameCorrection
    ).toHaveBeenCalledWith({
      userId: '665000000000000000001001',
      personId: 'p1',
      preferredName: '小蹦得儿',
      allowedNames: ['小朵朵'],
      rejectedNames: ['小蹦蛋儿'],
    });
  });
});
