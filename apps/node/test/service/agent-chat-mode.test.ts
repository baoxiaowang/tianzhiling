import {
  buildAgentChatModePrompt,
  resolveAgentChatModePolicy,
} from '../../src/service/agents/agent-chat-mode';
import type { ReplyBrief } from '../../src/service/agents/reply-brief.service';
import type { ReplySceneRoute } from '../../src/service/agents/reply-scene-router';

describe('agent chat mode', () => {
  it('uses the same context budget across open-chat route labels', () => {
    const modes = ['emotional', 'relationship', 'family', 'daily', 'general'];
    const policies = modes.map(mode =>
      resolveAgentChatModePolicy({ mode } as ReplyBrief)
    );

    expect(
      policies.map(policy => ({
        history: policy.historyMessageLimit,
        profile: policy.profileFactLimit,
        legacy: policy.legacyFactLimit,
        retrieved: policy.retrievedMemoryLimit,
      }))
    ).toEqual(
      Array.from({ length: modes.length }, () => ({
        history: 10,
        profile: 5,
        legacy: 4,
        retrieved: 3,
      }))
    );
  });

  it('keeps ordinary route labels as weak hints', () => {
    const prompt = buildAgentChatModePrompt(
      { mode: 'relationship' } as ReplyBrief,
      {
        primaryScene: {
          scene: 'dream_companionship',
        },
      } as ReplySceneRoute
    );

    expect(prompt).toContain('# 当前对话参考模式：relationship');
    expect(prompt).toContain('仅作弱参考');
    expect(prompt).not.toContain('梦中相见作为安慰性想象');
  });

  it('keeps correction routes weak instead of forcing an apology template', () => {
    const prompt = buildAgentChatModePrompt(
      { mode: 'boundary' } as ReplyBrief,
      {
        primaryScene: {
          scene: 'correction',
        },
      } as ReplySceneRoute
    );

    expect(prompt).toContain('# 当前对话参考模式：boundary');
    expect(prompt).toContain('仅作弱参考');
    expect(prompt).not.toContain('先认错并采用用户刚纠正的事实');
    expect(prompt).not.toContain('守住本轮必要边界');
  });
});
