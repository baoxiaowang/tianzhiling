import { buildMemorialPhotoPrompt } from '../../src/prompt/memorial-photo';

describe('buildMemorialPhotoPrompt', () => {
  it('prioritizes custom prompt and keeps pet subjects from being forced into humans', () => {
    const prompt = buildMemorialPhotoPrompt({
      agentPhotoCount: 1,
      agentName: '小白',
      customPrompt: '我和猫坐在窗边，只出现我和这只猫',
    });

    expect(prompt.indexOf('用户自定义提示词')).toBeLessThan(
      prompt.indexOf('默认兜底规则')
    );
    expect(prompt).toContain('我和猫坐在窗边，只出现我和这只猫');
    expect(prompt).toContain('请先自行观察和理解所有输入图片');
    expect(prompt).toContain('从参考图中抽离出纪念对象和用户本人');
    expect(prompt).toContain('纪念对象可能是人，也可能是宠物');
    expect(prompt).toContain('不要把宠物生成成人');
    expect(prompt).not.toContain('图1到图');
    expect(prompt).not.toContain('双人纪念合照');
    expect(prompt).not.toContain('两个人的面部身份特征');
  });
});
