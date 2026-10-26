import { detectTestModeSignal } from '../../src/service/agents/test-mode-signal';

describe('test mode signal', () => {
  it.each([
    ['我是你女儿', 'identity'],
    ['你是我爸吗', 'identity'],
    ['还记得吗，这是咱们家门口', 'memory'],
    ['爸爸你还记得你电话号码多少吗', 'memory'],
    ['你有几个孩子', 'memory'],
    ['弟弟名字你还记得吗', 'memory'],
    ['妈找了个对象你不生气啊', 'character'],
    ['你以前对妈非打即骂的嘛', 'character'],
    ['这不是你啊', 'authenticity'],
    ['你是不是AI', 'authenticity'],
    ['有什么办法见你', 'medium'],
  ])('detects %s as %s', (text, reason) => {
    const signal = detectTestModeSignal(text);
    expect(signal.matched).toBe(true);
    expect(signal.reasons).toContain(reason);
  });

  it.each([
    '我想你',
    '你在那边好吗',
    '我今天哭了',
    '我梦到你了',
    '你还记得吃饭吗',
    '我是你女儿的朋友',
    '你以前对我很好',
    '我昨天视频了',
    '我想见见你',
    '你多来我梦里好吗',
    '我知道你是我老公啊可是我不知道你名字啊',
    '你是我爸，我是你儿子',
    '爸爸，你名字叫林江',
    '因为是爸爸的名字呀',
    '你骗人。梦里没有你',
    '你不要骗我',
    '你能发一段语音嘛',
    '妈妈昨晚在外面坐的很晚，就在你楼下，我知道她更想你，想你看不见你，听不见你说话，摸不到你',
  ])('does not treat ordinary grief as a test: %s', text => {
    expect(detectTestModeSignal(text).matched).toBe(false);
  });

  it('detects a short continuation after repeated tests', () => {
    const signal = detectTestModeSignal('哦', [
      '我是你女儿',
      '你电话号码多少',
      '这不是你啊',
    ]);
    expect(signal.matched).toBe(true);
    expect(signal.cueTurnCount).toBeGreaterThanOrEqual(3);
    expect(signal.pressure).toBe('high');
  });

  it('does not keep a normal message in test mode after one cue', () => {
    const signal = detectTestModeSignal('我想你', ['我是你女儿']);
    expect(signal.matched).toBe(false);
  });

  it('raises pressure on repeated memory/character probes', () => {
    const signal = detectTestModeSignal('你以前对妈非打即骂的嘛', [
      '我是你女儿',
      '你还记得电话号码吗',
    ]);
    expect(signal.pressure).toBe('high');
  });
});
