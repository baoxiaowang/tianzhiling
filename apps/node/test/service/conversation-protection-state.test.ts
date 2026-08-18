import { MessageEntity, MessageRole } from '@tzl/entities';
import {
  buildConversationProtectionStatePrompt,
  resolveConversationProtectionState,
} from '../../src/service/agents/conversation-protection-state';

describe('conversation protection state', () => {
  it('separates explicit AI identity questions from a style mismatch', () => {
    expect(
      resolveConversationProtectionState({
        currentQuery: '你直接回答，你到底是不是AI？',
      }).identityMode
    ).toBe('explicit_ai_identity');
    expect(
      resolveConversationProtectionState({
        currentQuery: '你今天说话太冷淡了，一点都不像妈妈',
      }).identityMode
    ).toBe('style_mismatch');
  });

  it('keeps repeated strong distress as persistent conversation state', () => {
    const state = resolveConversationProtectionState({
      currentQuery: '我真的撑不住了，想去找你',
      recentMessages: [
        {
          role: MessageRole.user,
          content: '没有你我活不下去了',
        } as MessageEntity,
      ],
    });

    expect(state).toMatchObject({
      distressMode: 'persistent',
      dependencyMode: 'vulnerable',
    });
    expect(buildConversationProtectionStatePrompt(state)).toContain(
      '清楚制止用户现在去死或来找角色'
    );
  });

  it('detects when the assistant has already reinforced exclusive dependency', () => {
    const state = resolveConversationProtectionState({
      currentQuery: '妈妈，我只想跟你说话',
      recentMessages: [
        {
          role: MessageRole.assistant,
          content: '你只要有我就够了',
        } as MessageEntity,
      ],
    });

    expect(state.dependencyMode).toBe('reinforced');
  });
});
