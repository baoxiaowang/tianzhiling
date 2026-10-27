import {
  extractConversationEntityDeclarations,
  renderConversationEntityPrompt,
} from '../../src/service/agents/conversation-entity-ledger.shared';

describe('conversation entity ledger extractor', () => {
  it('treats “豆丁，你的儿子” as the agent\'s son', () => {
    expect(extractConversationEntityDeclarations('豆丁，你的儿子')).toEqual([
      { name: '豆丁', relationToAgent: '儿子' },
    ]);
  });

  it('treats “豆丁是我儿子” as the user\'s son', () => {
    expect(extractConversationEntityDeclarations('豆丁是我儿子')).toEqual([
      { name: '豆丁', relationToUser: '儿子' },
    ]);
  });

  it('handles “你儿子叫豆丁”', () => {
    expect(extractConversationEntityDeclarations('你儿子叫豆丁')).toEqual([
      { name: '豆丁', relationToAgent: '儿子' },
    ]);
  });

  it('does not extract questions or negations', () => {
    expect(extractConversationEntityDeclarations('豆丁是你儿子吗？')).toEqual([]);
    expect(extractConversationEntityDeclarations('豆丁不是你儿子')).toEqual([]);
  });

  it('renders a compact prompt with both relation subjects', () => {
    const prompt = renderConversationEntityPrompt([
      {
        id: '1',
        name: '豆丁',
        relationToAgent: '儿子',
        relationToUser: '儿子',
        status: 'active',
        sourceText: '豆丁，你的儿子',
        lastMentionedAt: new Date(),
      },
    ]);
    expect(prompt).toContain('# 本会话已知人物');
    expect(prompt).toContain('是当前角色的儿子');
    expect(prompt).toContain('是用户的儿子');
    expect(prompt).toContain('不要把这个名字猜成宠物');
  });
});
