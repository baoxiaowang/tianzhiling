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
});
