import { AgentCreateGuideService } from '../../src/service/agents/agent-create-guide.service';

function createService() {
  const service = new AgentCreateGuideService();
  const generateText = jest.fn();
  service.openAIService = {
    isEnabled: jest.fn().mockReturnValue(true),
    generateText,
  } as never;

  return { service, generateText };
}

describe('AgentCreateGuideService', () => {
  it('extracts all creation basics from one natural sentence', async () => {
    const { service, generateText } = createService();
    generateText.mockResolvedValue({
      content: JSON.stringify({
        relationToThem: '妈妈',
        realName: '王秀兰',
        agentName: '老妈',
        gender: 'female',
        relationToMe: '幺儿',
      }),
    });

    const result = await service.buildTurn({
      input:
        '我想创建妈妈，她真实姓名是王秀兰，微信备注是老妈，以前一直叫我幺儿。',
      focusField: 'relationToThem',
      turnCount: 0,
    });

    expect(result.draft).toEqual({
      relationToThem: '妈妈',
      realName: '王秀兰',
      agentName: '老妈',
      gender: 'female',
      relationToMe: '幺儿',
    });
    expect(result.nextFocusField).toBe('');
    expect(result.reply).toContain('选张头像');
    expect(result.isComplete).toBe(true);
  });

  it('asks for the chat name after learning who the user wants to create', async () => {
    const { service, generateText } = createService();
    generateText.mockResolvedValue({
      content: JSON.stringify({
        relationToThem: '奶奶',
        realName: '',
        agentName: '',
        gender: '',
        relationToMe: '',
      }),
    });

    const result = await service.buildTurn({
      input: '我想创建奶奶。',
      focusField: 'relationToThem',
    });

    expect(result.draft.gender).toBe('female');
    expect(result.nextFocusField).toBe('agentName');
    expect(result.reply).toContain('聊天列表');
  });

  it('handles a quick relationship choice without calling AI', async () => {
    const { service, generateText } = createService();

    const result = await service.buildTurn({
      input: '妈妈',
      focusField: 'relationToThem',
    });

    expect(generateText).not.toHaveBeenCalled();
    expect(result.draft.relationToThem).toBe('妈妈');
    expect(result.draft.gender).toBe('female');
    expect(result.nextFocusField).toBe('agentName');
  });

  it('does not ask for gender when it cannot be inferred', async () => {
    const { service, generateText } = createService();
    generateText.mockResolvedValue({
      content: JSON.stringify({
        relationToThem: '朋友',
        realName: '',
        agentName: '老周',
        gender: '',
        relationToMe: '小林',
      }),
    });

    const result = await service.buildTurn({
      input: '是一位很重要的朋友。',
      focusField: 'relationToThem',
    });

    expect(result.nextFocusField).toBe('');
    expect(result.isComplete).toBe(true);
    expect(result.reply).toContain('选张头像');
  });

  it('keeps creation usable without AI', async () => {
    const { service } = createService();
    service.openAIService.isEnabled = jest.fn().mockReturnValue(false);

    const result = await service.buildTurn({
      input: '她一直叫我宝贝',
      draft: {
        relationToThem: '妈妈',
        agentName: '老妈',
        gender: 'female',
      },
      focusField: 'relationToMe',
    });

    expect(result.draft.relationToMe).toBe('宝贝');
    expect(result.nextFocusField).toBe('');
    expect(result.isComplete).toBe(true);
  });

  it('uses a WeChat remark as the chat display name without AI', async () => {
    const { service } = createService();
    service.openAIService.isEnabled = jest.fn().mockReturnValue(false);

    const result = await service.buildTurn({
      input: '微信备注名称是老周',
      draft: {
        relationToThem: '朋友',
      },
      focusField: 'agentName',
    });

    expect(result.draft.relationToThem).toBe('朋友');
    expect(result.draft.agentName).toBe('老周');
    expect(result.nextFocusField).toBe('relationToMe');
  });

  it('keeps relation, real name and chat name separate without AI', async () => {
    const { service } = createService();
    service.openAIService.isEnabled = jest.fn().mockReturnValue(false);

    const result = await service.buildTurn({
      input: '她是我妈妈，真实姓名是王秀兰，智能体名称就叫老妈，她叫我幺儿',
      focusField: 'relationToThem',
    });

    expect(result.draft).toEqual({
      relationToThem: '妈妈',
      realName: '王秀兰',
      agentName: '老妈',
      gender: 'female',
      relationToMe: '幺儿',
    });
    expect(result.isComplete).toBe(true);
  });
});
