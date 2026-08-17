import {
  AgentEntity,
  AgentProfileFactConfidence,
  AgentProfileFactPolarity,
  AgentProfileFactType,
  AgentSex,
  MongoObjectId,
} from '@tzl/entities';
import { AgentMemoryProfileService } from '../../src/service/agents/agent-memory-profile.service';
import { AgentProfileFactSummary } from '../../src/service/agents/agent-profile-fact.service';

const USER_ID = new MongoObjectId('665000000000000000000001');
const AGENT_ID = new MongoObjectId('665000000000000000000010');

function createAgent(): AgentEntity {
  const agent = new AgentEntity();

  Object.assign(agent, {
    id: AGENT_ID,
    createdUserId: USER_ID,
    name: '爸爸',
    sex: AgentSex.man,
    iCallAgent: '爸爸',
    agentCallMe: '闺女',
    description: '',
    lifeExperience: '不应直接作为生成输入',
    personalityTraits: '',
    languageHabits: '',
    hobbies: '',
    sharedMemories: '',
    status: 1,
    createdAt: new Date('2026-07-01T00:00:00.000Z'),
    updatedAt: new Date('2026-07-01T00:00:00.000Z'),
  });

  return agent;
}

function createFact(
  key: string,
  value: string,
  priority = 3
): AgentProfileFactSummary {
  return {
    type: AgentProfileFactType.memory,
    key,
    value,
    polarity: AgentProfileFactPolarity.positive,
    confidence: AgentProfileFactConfidence.confirmed,
    priority,
  };
}

function createService(
  facts: AgentProfileFactSummary[],
  speechCache = new Map<string, string>()
) {
  const service = new AgentMemoryProfileService();
  const generateText = jest.fn().mockResolvedValue({
    content: JSON.stringify({
      lifeExperience: '年轻时在工厂做设备维修。',
      personalityTraits: '做事认真，嘴上严厉但很关心家人。',
      languageHabits: '说话直接，常提醒家人慢慢来。',
      hobbies: '喜欢下象棋。',
      sharedMemories: '和闺女一起去过河边散步。',
    }),
  });
  const synthesizeMessengerSpeech = jest.fn().mockResolvedValue({
    audioUrl: 'https://provider.example/messenger.mp3',
    audioBuffer: Buffer.from('female-voice'),
    mimeType: 'audio/mpeg',
  });
  const putBuffer = jest.fn().mockResolvedValue({
    objectKey: 'profile-messenger-speech/messenger.wav',
    url: 'https://media.example/messenger.wav',
  });

  service.logger = {
    warn: jest.fn(),
  } as any;
  service.agentModel = {
    save: jest.fn(async agent => agent),
  } as any;
  service.agentProfileFactService = {
    listFactsForPrompt: jest.fn(async () => facts),
    syncAgentProfileMemorySources: jest.fn().mockResolvedValue(undefined),
  } as any;
  service.openAIService = {
    isEnabled: jest.fn().mockReturnValue(true),
    generateText,
  } as any;
  service.minimaxVoiceSpeechService = {
    hasConfig: jest.fn().mockReturnValue(true),
    synthesize: synthesizeMessengerSpeech,
  } as any;
  service.redisService = {
    get: jest.fn(async (key: string) => speechCache.get(key) ?? null),
    set: jest.fn(async (key: string, value: string, ...args: unknown[]) => {
      if (args.includes('NX') && speechCache.has(key)) {
        return null;
      }
      speechCache.set(key, value);
      return 'OK';
    }),
    del: jest.fn(async (key: string) => (speechCache.delete(key) ? 1 : 0)),
  } as any;
  service.tencentCosService = {
    isEnabled: jest.fn().mockReturnValue(true),
    putBuffer,
  } as any;
  service.ossService = {
    isEnabled: jest.fn().mockReturnValue(false),
  } as any;

  return { service, generateText, synthesizeMessengerSpeech, putBuffer };
}

describe('AgentMemoryProfileService', () => {
  it('uses the dedicated high-fidelity female voice for messenger speech', async () => {
    const { service, synthesizeMessengerSpeech, putBuffer } = createService([]);

    const first = await service.createMessengerSpeech('你好，终于找到你了。');
    const cached = await service.createMessengerSpeech('你好，终于找到你了。');

    expect(synthesizeMessengerSpeech).toHaveBeenCalledWith({
      text: '你好，终于找到你了。',
      model: 'speech-2.8-hd',
      voiceId: 'Chinese (Mandarin)_Gentle_Senior',
      speed: 0.98,
      pitch: 0,
    });
    expect(putBuffer).toHaveBeenCalledWith(
      Buffer.from('female-voice'),
      expect.objectContaining({
        folder: 'profile-messenger-speech',
        contentType: 'audio/mpeg',
      })
    );
    expect(first).toEqual({
      url: 'https://media.example/messenger.wav',
      voice: 'Chinese (Mandarin)_Gentle_Senior',
    });
    expect(cached).toEqual(first);
    expect(synthesizeMessengerSpeech).toHaveBeenCalledTimes(1);
  });

  it('reuses a generated messenger speech asset across service instances', async () => {
    const speechCache = new Map<string, string>();
    const firstService = createService([], speechCache);
    const secondService = createService([], speechCache);

    const first = await firstService.service.createMessengerSpeech(
      '你好，终于找到你了。'
    );
    const cached = await secondService.service.createMessengerSpeech(
      '你好，终于找到你了。'
    );

    expect(cached).toEqual(first);
    expect(firstService.synthesizeMessengerSpeech).toHaveBeenCalledTimes(1);
    expect(secondService.synthesizeMessengerSpeech).not.toHaveBeenCalled();
    expect(secondService.putBuffer).not.toHaveBeenCalled();
  });

  it('shares one synthesis when prewarm and page playback overlap', async () => {
    const speechCache = new Map<string, string>();
    const prewarmService = createService([], speechCache);
    const pageService = createService([], speechCache);
    let finishSynthesis: (() => void) | undefined;
    let markSynthesisStarted: (() => void) | undefined;
    const synthesisStarted = new Promise<void>(resolve => {
      markSynthesisStarted = resolve;
    });

    prewarmService.synthesizeMessengerSpeech.mockImplementation(
      () =>
        new Promise(resolve => {
          finishSynthesis = () =>
            resolve({
              audioUrl: 'https://provider.example/messenger.mp3',
              audioBuffer: Buffer.from('female-voice'),
              mimeType: 'audio/mpeg',
            });
          markSynthesisStarted?.();
        })
    );

    const prewarm =
      prewarmService.service.createMessengerSpeech('你好，终于找到你了。');
    await synthesisStarted;
    const pagePlayback =
      pageService.service.createMessengerSpeech('你好，终于找到你了。');
    finishSynthesis?.();

    await expect(pagePlayback).resolves.toEqual(await prewarm);
    expect(prewarmService.synthesizeMessengerSpeech).toHaveBeenCalledTimes(1);
    expect(pageService.synthesizeMessengerSpeech).not.toHaveBeenCalled();
  });

  it('turns a free description into a draft and asks an adaptive follow-up', async () => {
    const agent = createAgent();
    const { service, generateText } = createService([]);
    generateText.mockResolvedValue({
      content: JSON.stringify({
        reply: '听起来他很温和。忙完工作后，他最喜欢做什么？',
        nextFocusField: 'hobbies',
        lifeExperience: '在工厂做设备维修。',
        personalityTraits: '待人温和，很有耐心。',
        languageHabits: '',
        hobbies: '',
        sharedMemories: '',
      }),
    });

    const result = await service.buildInterviewTurn({
      agent,
      input: '爸爸以前在工厂修设备，脾气很好，也很有耐心。',
      turnCount: 0,
    });

    expect(result.draft.lifeExperience).toBe('在工厂做设备维修。');
    expect(result.draft.personalityTraits).toContain('有耐心');
    expect(result.coveredFields).toEqual([
      'personalityTraits',
      'lifeExperience',
    ]);
    expect(result.nextFocusField).toBe('hobbies');
    expect(result.reply).toBe('听起来他很温和。忙完工作后，他最喜欢做什么？');
    expect(generateText).toHaveBeenCalledTimes(1);
    expect(generateText.mock.calls[0][0].systemPrompt).toContain(
      '不要把“生意做得很好”只压缩成“有生意头脑”'
    );
  });

  it('moves to another uncovered area instead of repeating one question', async () => {
    const agent = createAgent();
    const { service, generateText } = createService([]);
    generateText.mockResolvedValue({
      content: JSON.stringify({
        reply: '那段经历后来又发生了什么？',
        nextFocusField: 'lifeExperience',
        lifeExperience: '',
        personalityTraits: '待人温和，很有耐心。',
        languageHabits: '',
        hobbies: '喜欢下象棋。',
        sharedMemories: '',
      }),
    });

    const result = await service.buildInterviewTurn({
      agent,
      input: '他平时还喜欢下象棋。',
      draft: {
        personalityTraits: '待人温和，很有耐心。',
      },
      focusField: 'lifeExperience',
      turnCount: 2,
    });

    expect(result.nextFocusField).toBe('languageHabits');
    expect(result.reply).toContain('怎么说话');
    expect(result.reply).not.toContain('后来又发生了什么');
  });

  it('uses a broad question when AI changes fields but keeps digging into the same topic', async () => {
    const agent = createAgent();
    const { service, generateText } = createService([]);
    generateText.mockResolvedValue({
      content: JSON.stringify({
        reply: '爸爸爱下象棋这点真鲜活，他平时会约谁一起下吗？',
        nextFocusField: 'sharedMemories',
        lifeExperience: '',
        personalityTraits: '待人温和，很有耐心。',
        languageHabits: '',
        hobbies: '喜欢下象棋。',
        sharedMemories: '',
      }),
    });

    const result = await service.buildInterviewTurn({
      agent,
      input: '他平时喜欢下象棋，一坐下来能下很久。',
      draft: {
        personalityTraits: '待人温和，很有耐心。',
      },
      focusField: 'lifeExperience',
      turnCount: 2,
    });

    expect(result.nextFocusField).toBe('sharedMemories');
    expect(result.reply).toContain('最想留住');
    expect(result.reply).not.toContain('一起下');
  });

  it('asks at most one representative detail after covering the outline', async () => {
    const agent = createAgent();
    const { service, generateText } = createService([]);
    generateText.mockResolvedValue({
      content: JSON.stringify({
        reply: '我已经认识他了。哪件小事最能看出他的性格？',
        nextFocusField: 'personalityTraits',
        lifeExperience: '年轻时在工厂工作。',
        personalityTraits: '温和、有耐心。',
        languageHabits: '常说慢慢来。',
        hobbies: '喜欢下象棋。',
        sharedMemories: '每年春节一起包饺子。',
      }),
    });

    const firstDepth = await service.buildInterviewTurn({
      agent,
      input: '每年春节我们都会一起包饺子。',
      draft: {
        lifeExperience: '年轻时在工厂工作。',
        personalityTraits: '温和、有耐心。',
        languageHabits: '常说慢慢来。',
        hobbies: '喜欢下象棋。',
      },
      focusField: 'sharedMemories',
      turnCount: 4,
    });

    expect(firstDepth.nextFocusField).toBe('personalityTraits');
    expect(firstDepth.isComplete).toBe(false);

    generateText.mockResolvedValue({
      content: JSON.stringify({
        reply: '他下棋时还会做些什么？',
        nextFocusField: 'hobbies',
        ...firstDepth.draft,
        personalityTraits: '温和、有耐心；会默默照顾家人。',
      }),
    });

    const completed = await service.buildInterviewTurn({
      agent,
      input: '他总会默默把家里的事情安排好。',
      draft: firstDepth.draft,
      focusField: firstDepth.nextFocusField,
      turnCount: 5,
    });

    expect(completed.nextFocusField).toBe('');
    expect(completed.isComplete).toBe(true);
    expect(completed.reply).toContain('继续想到哪儿说到哪儿');
    expect(completed.reply).not.toContain('下棋时');
  });

  it('does not repeat the only remaining question when it was skipped', async () => {
    const agent = createAgent();
    const { service, generateText } = createService([]);
    generateText.mockResolvedValue({
      content: JSON.stringify({
        reply: '再想想，他有没有常说的话？',
        nextFocusField: 'languageHabits',
        lifeExperience: '年轻时在工厂工作。',
        personalityTraits: '温和、有耐心。',
        languageHabits: '',
        hobbies: '喜欢下象棋。',
        sharedMemories: '每年春节一起包饺子。',
      }),
    });

    const result = await service.buildInterviewTurn({
      agent,
      input: '这个我实在想不起来了。',
      draft: {
        lifeExperience: '年轻时在工厂工作。',
        personalityTraits: '温和、有耐心。',
        languageHabits: '',
        hobbies: '喜欢下象棋。',
        sharedMemories: '每年春节一起包饺子。',
      },
      focusField: 'languageHabits',
      turnCount: 4,
    });

    expect(result.nextFocusField).toBe('');
    expect(result.isComplete).toBe(true);
    expect(result.reply).toContain('继续想到哪儿说到哪儿');
    expect(result.reply).not.toContain('再想想');
  });

  it('never asks a previously asked profile area again', async () => {
    const agent = createAgent();
    const { service, generateText } = createService([]);
    generateText.mockResolvedValue({
      content: JSON.stringify({
        reply: '他平时有没有常说的一句话？',
        nextFocusField: 'languageHabits',
        lifeExperience: '年轻时在工厂工作。',
        personalityTraits: '温和、有耐心。',
        languageHabits: '',
        hobbies: '喜欢下象棋。',
        sharedMemories: '',
      }),
    });

    const result = await service.buildInterviewTurn({
      agent,
      input: '这句我刚才已经回答过了。',
      draft: {
        lifeExperience: '年轻时在工厂工作。',
        personalityTraits: '温和、有耐心。',
        hobbies: '喜欢下象棋。',
      },
      focusField: 'languageHabits',
      askedFields: ['languageHabits'],
      previousReplies: ['爸爸平时怎么说话，有没有常说的一句话？'],
      turnCount: 3,
    });

    expect(result.nextFocusField).toBe('sharedMemories');
    expect(result.reply).toContain('最想留住');
    expect(result.reply).not.toContain('常说的一句话');
    expect(generateText.mock.calls[0][0].prompt).toContain(
      '此前已经问过、不得再问：["languageHabits"]'
    );
  });

  it('replaces mechanical memory confirmations with contextual understanding', async () => {
    const agent = createAgent();
    const { service, generateText } = createService([]);
    generateText.mockResolvedValue({
      content: JSON.stringify({
        reply: '谢谢，我记住了。爸爸平时喜欢做什么？',
        nextFocusField: 'hobbies',
        lifeExperience: '年轻时在工厂工作。',
        personalityTraits: '',
        languageHabits: '',
        hobbies: '',
        sharedMemories: '',
      }),
    });

    const result = await service.buildInterviewTurn({
      agent,
      input: '爸爸年轻时一直在工厂工作。',
      turnCount: 0,
    });

    expect(result.reply).not.toContain('记住了');
    expect(result.reply).toContain('这段经历');
    expect(result.reply).toContain('喜欢做什么');
  });

  it('does not return the same sentence as an earlier messenger reply', async () => {
    const agent = createAgent();
    const repeatedReply = '听起来他很温和。忙完工作后，他最喜欢做什么？';
    const { service, generateText } = createService([]);
    generateText.mockResolvedValue({
      content: JSON.stringify({
        reply: repeatedReply,
        nextFocusField: 'hobbies',
        lifeExperience: '在工厂做设备维修。',
        personalityTraits: '待人温和，很有耐心。',
        languageHabits: '',
        hobbies: '',
        sharedMemories: '',
      }),
    });

    const result = await service.buildInterviewTurn({
      agent,
      input: '他脾气一直很温和。',
      previousReplies: [repeatedReply],
      turnCount: 1,
    });

    expect(result.reply).not.toBe(repeatedReply);
    expect(result.reply).toContain('喜欢做什么');
  });

  it('keeps the interview usable when AI is unavailable', async () => {
    const agent = createAgent();
    const { service, generateText } = createService([]);
    service.openAIService.isEnabled = jest.fn().mockReturnValue(false);

    const result = await service.buildInterviewTurn({
      agent,
      input: '他总说慢慢来，别着急。',
      draft: {
        personalityTraits: '很有耐心。',
      },
      focusField: 'languageHabits',
      turnCount: 2,
    });

    expect(result.draft.personalityTraits).toBe('很有耐心。');
    expect(result.draft.languageHabits).toBe('他总说慢慢来，别着急。');
    expect(result.nextFocusField).toBe('hobbies');
    expect(result.reply).toContain('喜欢做什么');
    expect(generateText).not.toHaveBeenCalled();
  });

  it('generates all profile paragraphs from memory and reuses the snapshot', async () => {
    const facts = [
      createFact('occupation.primary', '当前角色曾在工厂做设备维修'),
      createFact('preference.chess', '当前角色喜欢下象棋', 2),
      createFact('personality.care', '当前角色很关心家人'),
      createFact('style.directness', '当前角色说话直接'),
      createFact('memory.river', '用户和当前角色去过河边'),
      createFact('identity.relationship', '当前角色是用户的爸爸'),
      createFact('language.slowly', '当前角色常说慢慢来'),
    ];
    const agent = createAgent();
    const { service, generateText } = createService(facts);

    const generated = await service.refreshFromMemoryForView({
      agent,
      userId: USER_ID,
    });
    await service.refreshFromMemoryForView({
      agent: generated,
      userId: USER_ID,
    });

    expect(generated.lifeExperience).toBe('年轻时在工厂做设备维修。');
    expect(generated.personalityTraits).toContain('关心家人');
    expect(generated.memoryProfileFactSnapshot).toHaveLength(7);
    expect(generated.memoryProfileVersion).toBe('memory_profile_v1');
    expect(generated.memoryProfileGenerationCount).toBe(1);
    expect(generateText).toHaveBeenCalledTimes(1);
    expect(generateText.mock.calls[0][0].prompt).not.toContain(
      '不应直接作为生成输入'
    );
  });

  it('accumulates memory changes before spending another model call', async () => {
    const facts = Array.from({ length: 7 }, (_, index) =>
      createFact(`memory.initial.${index}`, `初始记忆${index}`, 3)
    );
    const agent = createAgent();
    const { service, generateText } = createService(facts);

    await service.refreshFromMemoryForView({ agent, userId: USER_ID });

    facts[0] = createFact('memory.initial.0', '初始记忆已更新', 3);
    await service.refreshFromMemoryForView({ agent, userId: USER_ID });
    expect(generateText).toHaveBeenCalledTimes(1);

    facts.push(
      ...Array.from({ length: 9 }, (_, index) =>
        createFact(`memory.second.${index}`, `第二阶段记忆${index}`, 3)
      )
    );
    await service.refreshFromMemoryForView({ agent, userId: USER_ID });

    expect(generateText).toHaveBeenCalledTimes(2);
    expect(agent.memoryProfileGenerationCount).toBe(2);

    facts[1] = createFact('memory.initial.1', '第二条初始记忆已更新', 3);
    facts.push(
      ...Array.from({ length: 13 }, (_, index) =>
        createFact(`memory.third.${index}`, `第三阶段记忆${index}`, 3)
      )
    );
    await service.refreshFromMemoryForView({ agent, userId: USER_ID });

    expect(generateText).toHaveBeenCalledTimes(3);
    expect(agent.memoryProfileGenerationCount).toBe(3);
  });

  it('waits for an initial score of twenty before first synthesis', async () => {
    const facts = Array.from({ length: 6 }, (_, index) =>
      createFact(`memory.initial.${index}`, `初始记忆${index}`, 3)
    );
    const agent = createAgent();
    const { service, generateText } = createService(facts);

    await service.refreshFromMemoryForView({ agent, userId: USER_ID });
    expect(generateText).not.toHaveBeenCalled();

    facts.push(createFact('preference.opera', '当前角色喜欢听戏', 2));
    await service.refreshFromMemoryForView({ agent, userId: USER_ID });

    expect(generateText).toHaveBeenCalledTimes(1);
    expect(agent.memoryProfileGenerationCount).toBe(1);
  });

  it('aligns manual edits with memory without calling profile generation', async () => {
    const facts = [
      createFact('profile_source.hobbies', '当前角色兴趣爱好：下象棋、听戏', 2),
      createFact('memory.pending.1', '尚未整理的记忆一', 3),
      createFact('memory.pending.2', '尚未整理的记忆二', 3),
    ];
    const agent = createAgent();
    agent.hobbies = '下象棋、听戏';
    const { service, generateText } = createService(facts);
    const sourceMessageId = new MongoObjectId();

    const aligned = await service.alignManualProfileEdits({
      agent,
      userId: USER_ID,
      sources: {
        hobbies: '下象棋、听戏',
      },
      sourceMessageId,
      sourceText: '爸爸喜欢下象棋，也喜欢听戏。',
    });

    expect(
      service.agentProfileFactService.syncAgentProfileMemorySources
    ).toHaveBeenCalledWith({
      userId: USER_ID,
      agentId: AGENT_ID,
      sources: {
        hobbies: '下象棋、听戏',
      },
      sourceMessageId,
      sourceText: '爸爸喜欢下象棋，也喜欢听戏。',
    });
    expect(aligned.memoryProfileFactSnapshot).toHaveLength(1);
    expect(aligned.memoryProfileVersion).toBe('memory_profile_v1');
    expect(generateText).not.toHaveBeenCalled();
  });

  it('records an empty but valid synthesis without retrying on every view', async () => {
    const facts = Array.from({ length: 7 }, (_, index) =>
      createFact(
        `memory.rejected_assistant.${index}`,
        `用户否认助手编造的往事${index}`,
        3
      )
    );
    const agent = createAgent();
    const { service, generateText } = createService(facts);
    generateText.mockResolvedValue({
      content: JSON.stringify({
        lifeExperience: '',
        personalityTraits: '',
        languageHabits: '',
        hobbies: '',
        sharedMemories: '',
      }),
    });

    await service.refreshFromMemoryForView({ agent, userId: USER_ID });
    await service.refreshFromMemoryForView({ agent, userId: USER_ID });

    expect(agent.memoryProfileFactSnapshot).toHaveLength(7);
    expect(generateText).toHaveBeenCalledTimes(1);
  });

  it('clears stale profile text without a model call when memory is emptied', async () => {
    const facts = Array.from({ length: 7 }, (_, index) =>
      createFact(`memory.initial.${index}`, `初始记忆${index}`, 3)
    );
    const agent = createAgent();
    const { service, generateText } = createService(facts);

    await service.refreshFromMemoryForView({ agent, userId: USER_ID });
    facts.splice(0, facts.length);
    await service.refreshFromMemoryForView({ agent, userId: USER_ID });

    expect(agent.lifeExperience).toBe('');
    expect(agent.memoryProfileFactSnapshot).toEqual([]);
    expect(agent.memoryProfileGenerationCount).toBe(1);
    expect(generateText).toHaveBeenCalledTimes(1);
  });
});
