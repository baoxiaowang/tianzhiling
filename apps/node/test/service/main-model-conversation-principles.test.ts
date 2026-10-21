import {
  buildMainModelConditionalGuidance,
  buildMainModelConversationPrinciplesPrompt,
} from '../../src/service/agents/main-model-conversation-principles';

describe('main model conversation principles', () => {
  it('keeps only always-on rules in the stable layer', () => {
    const prompt = buildMainModelConversationPrinciplesPrompt();

    expect(prompt).toContain('# 主模型自主理解');
    expect(prompt).toContain('程序提供的资料都是辅助信息，不是回复计划');
    expect(prompt).toContain('也不要机械地逐项复述或列清单');
    // 只在特定轮次成立的规则不再占用稳定段。
    expect(prompt).not.toContain('用户明确要求你主动说');
    expect(prompt).not.toContain('把关心递给当前角色');
    expect(prompt).not.toContain('明确结束当前对话');
  });

  it('adds no conditional block for an ordinary turn', () => {
    expect(buildMainModelConditionalGuidance({})).toBe('');
  });

  it('renders each condition only when it holds', () => {
    const active = buildMainModelConditionalGuidance({
      activeSpeechRequested: true,
    });
    expect(active).toContain('# 本轮条件规则');
    expect(active).toContain('真正说出一件完整内容');
    expect(active).not.toContain('把关心递给当前角色');

    const care = buildMainModelConditionalGuidance({ careReception: true });
    expect(care).toContain('把关心递给当前角色');
    expect(care).toContain('不要求固定句式');
    expect(care).not.toContain('真正说出一件完整内容');

    const close = buildMainModelConditionalGuidance({ explicitClose: true });
    expect(close).toContain('用户已明确结束当前对话');
    expect(close).not.toContain('把关心递给当前角色');
  });

  it('keeps the explicit close instruction authoritative but compact', () => {
    const close = buildMainModelConditionalGuidance({ explicitClose: true });

    expect(close).toContain('不再展开新内容、不追问、不推进话题');
  });
});
