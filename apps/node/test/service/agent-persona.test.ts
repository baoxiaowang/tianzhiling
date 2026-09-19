import {
  AgentEntity,
  AgentSex,
} from '@tzl/entities';
import { buildAgentPersonaPrompt } from '../../src/service/agents/agent-persona';

describe('buildAgentPersonaPrompt', () => {
  it('uses age, sex, relationship and chat-derived style without treating it as fact', () => {
    const agent = {
      name: '父亲',
      sex: AgentSex.man,
      iCallAgent: '爸爸',
      agentCallMe: '星星',
      birthday: new Date('1949-01-01T00:00:00.000Z'),
      deathDate: new Date('2025-12-31T00:00:00.000Z'),
      personaProfile: {
        version: 'chat_derived_persona_v1',
        demographics: {
          relationshipType: 'father',
          sex: 'man',
          ageAtDeath: 76,
        },
        careStyle: '通过生活细节表达关心',
        criticismStyle: '不赞同时先说担心，再给建议',
        languageProfile: {
          directness: '含蓄',
          addressStyle: '称呼用户为星星',
        },
        departedTransformation: {
          retainedEdges: ['对生活细节有坚持'],
        },
      },
    } as AgentEntity;
    const result = buildAgentPersonaPrompt({
      agent,
    });

    expect(result.source).toBe('chat_derived_profile');
    expect(result.ageAtDeath).toBe(76);
    expect(result.generation).toBe('elder');
    expect(result.classifierContext).toContain('agent=父亲（用户称爸爸，elder）');
    expect(result.classifierContext).toContain('离世年龄约76岁');
    expect(result.prompt).not.toContain('用户称你为“爸爸”');
    expect(result.prompt).toContain('晚辈情绪或行为明显过激时');
    expect(result.prompt).toContain('只管表达，不作事实');
    expect(result.prompt).not.toContain('近期聊天风格弱证据');
  });

  it('falls back to relationship defaults when no personality field exists', () => {
    const result = buildAgentPersonaPrompt({
      agent: {
        sex: AgentSex.woman,
        iCallAgent: '女儿',
        agentCallMe: '妈',
      } as AgentEntity,
    });

    expect(result.source).toBe('relationship_defaults');
    expect(result.generation).toBe('younger');
    expect(result.prompt).not.toContain('近期聊天风格弱证据');
    expect(result.prompt).toContain('不要临时编造稳定性格');
  });

  it('does not inject profile-page source paragraphs directly into persona', () => {
    const result = buildAgentPersonaPrompt({
      agent: {
        iCallAgent: '爸爸',
        personalityTraits: '嘴硬心软，说话直接',
        languageHabits: '常说慢慢来',
        lifeExperience: '年轻时做木匠',
        personaProfile: {},
      } as AgentEntity,
    });

    expect(result.source).toBe('relationship_defaults');
    expect(result.prompt).not.toContain('嘴硬心软，说话直接');
    expect(result.prompt).not.toContain('常说慢慢来');
    expect(result.prompt).not.toContain('年轻时做木匠');
  });

  it('marks a relationship-only fallback without claiming chat evidence', () => {
    const result = buildAgentPersonaPrompt({
      agent: {
        iCallAgent: '爷爷',
      } as AgentEntity,
    });

    expect(result.source).toBe('relationship_defaults');
    expect(result.evidenceSnippetCount).toBe(0);
  });

  it('keeps admin custom context alongside a usable chat-derived profile', () => {
    const result = buildAgentPersonaPrompt({
      agent: {
        iCallAgent: '弟弟',
        customContext: '除简单问候外，多说几句把回应表达完整。',
        personaProfile: {
          version: 'chat_derived_persona_v1',
          careStyle: '先接住姐姐说的重点',
        },
      } as AgentEntity,
    });

    expect(result.prompt).toContain('先接住姐姐说的重点');
    expect(result.prompt).toContain('多说几句把回应表达完整');
  });

  it('renders every language dimension as its own item instead of one truncated line', () => {
    const agent = {
      name: '爷爷',
      sex: AgentSex.man,
      iCallAgent: '爷爷',
      agentCallMe: '湾呐',
      personaProfile: {
        version: 'wechat_import_style_v1',
        languageProfile: {
          sentenceLength: '句子偏短',
          modalParticles: '常用语气词',
          replyBubblePattern: '常拆两条',
          directness: '直接',
          emotionalExpression: '含蓄',
          addressStyle: '称呼用户为湾呐',
          distinctiveRhythm: '语速慢',
        },
      },
    } as unknown as AgentEntity;

    const { prompt } = buildAgentPersonaPrompt({ agent });

    // 七维逐一成项，末尾维度不再被整体截断吞掉
    for (const label of [
      '称呼习惯',
      '直接程度',
      '句长',
      '语气词',
      '情绪表达',
      '气泡节奏',
      '语言节奏',
    ]) {
      expect(prompt).toContain(`${label}：`);
    }
    expect(prompt).toContain('称呼习惯：称呼用户为湾呐');
    expect(prompt).toContain('语言节奏：语速慢');
  });

  it('never renders a half-truncated language dimension when the budget is exceeded', () => {
    // 用不重复的汉字填充，避免内容清洗规则对连续重复字符做归一
    const filler = '甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳午未申酉戌亥'.repeat(4).slice(0, 62);
    const long = (tag: string) => `${tag}${filler}`;
    const values = {
      sentenceLength: long('句长'),
      modalParticles: long('语气词'),
      replyBubblePattern: long('气泡'),
      directness: long('直接'),
      emotionalExpression: long('情绪'),
      addressStyle: long('称呼'),
      distinctiveRhythm: long('节奏'),
    };
    const agent = {
      name: '爷爷',
      sex: AgentSex.man,
      iCallAgent: '爷爷',
      agentCallMe: '湾呐',
      personaProfile: { version: 'wechat_import_style_v1', languageProfile: values },
    } as unknown as AgentEntity;

    const { prompt } = buildAgentPersonaPrompt({ agent });

    // 最高优先级的称呼习惯必须在；且任一被装入的维度都是完整值，不得只出现半句。
    expect(prompt).toContain(`称呼习惯：${values.addressStyle}`);
    const labels: Array<[string, string]> = [
      ['称呼习惯', values.addressStyle],
      ['直接程度', values.directness],
      ['句长', values.sentenceLength],
      ['语气词', values.modalParticles],
      ['情绪表达', values.emotionalExpression],
      ['气泡节奏', values.replyBubblePattern],
      ['语言节奏', values.distinctiveRhythm],
    ];
    for (const [label, value] of labels) {
      const start = prompt.indexOf(`${label}：`);
      if (start < 0) continue; // 整项未装入是允许的
      // 装入的必须是完整值：半句截断会让整值不再出现
      expect(prompt).toContain(value);
    }
  });
});
