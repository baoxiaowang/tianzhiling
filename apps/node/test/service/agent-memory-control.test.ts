import {
  extractForgetMemoryTarget,
  isDeicticForgetMemoryRequest,
  isExplicitRememberRequest,
  isForgetMemoryRequest,
  shouldArchiveMemoryValue,
} from '../../src/service/agents/agent-memory-control';

describe('agent memory control', () => {
  it('distinguishes remember commands from memory questions', () => {
    expect(isExplicitRememberRequest('记住，我不喜欢别人说教')).toBe(true);
    expect(
      isExplicitRememberRequest(
        '妈妈你记住了 你有三个女儿 我排行老三 上面有两个姐姐'
      )
    ).toBe(true);
    expect(isExplicitRememberRequest('你记住了')).toBe(true);
    expect(isExplicitRememberRequest('妈妈你一定要记住我爱你')).toBe(false);
    expect(isExplicitRememberRequest('你还记得我小时候吗')).toBe(false);
  });

  it('distinguishes forget commands from ordinary forgetfulness', () => {
    expect(isForgetMemoryRequest('请忘掉我不爱吃辣这件事')).toBe(true);
    expect(isForgetMemoryRequest('删除关于考研的记忆')).toBe(true);
    expect(isForgetMemoryRequest('刚才那件事你别记了，忘掉吧。')).toBe(true);
    expect(isDeicticForgetMemoryRequest('刚才那件事你别记了，忘掉吧。')).toBe(
      true
    );
    expect(isForgetMemoryRequest('我忘记带钥匙了')).toBe(false);
    expect(extractForgetMemoryTarget('请忘掉我不爱吃辣这件事')).toBe(
      '我不爱吃辣'
    );
    expect(extractForgetMemoryTarget('删除关于考研的记忆')).toBe('考研');
    expect(extractForgetMemoryTarget('刚才那件事你别记了，忘掉吧。')).toBe(
      '刚才那件事'
    );
  });

  it('matches deletion targets to related structured facts only', () => {
    expect(
      shouldArchiveMemoryValue(
        '我不爱吃辣',
        'preference.food.spicy 用户不爱吃辣，禁止说用户爱吃辣'
      )
    ).toBe(true);
    expect(shouldArchiveMemoryValue('失眠', '用户最近睡眠不好')).toBe(true);
    expect(shouldArchiveMemoryValue('不喜欢说教', '用户正在准备考研')).toBe(
      false
    );
  });
});
