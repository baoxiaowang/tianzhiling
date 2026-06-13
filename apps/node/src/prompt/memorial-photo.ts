export const MEMORIAL_PHOTO_CUSTOM_PROMPT_MAX_LENGTH = 500;

export interface MemorialPhotoPromptOptions {
  agentPhotoCount: number;
  agentName?: string;
  customPrompt?: string;
}

export function normalizeMemorialPhotoCustomPrompt(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }

  return value
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MEMORIAL_PHOTO_CUSTOM_PROMPT_MAX_LENGTH);
}

export function buildMemorialPhotoPrompt(
  options: MemorialPhotoPromptOptions
): string {
  const agentPhotoCount = Math.max(1, Math.min(3, options.agentPhotoCount));
  const agentName = options.agentName?.trim();
  const agentNameText = agentName ? `纪念对象名为“${agentName}”。` : '';
  const customPrompt = normalizeMemorialPhotoCustomPrompt(options.customPrompt);
  const defaultPrompt = [
    `请先自行观察和理解所有输入图片，判断图片里的人物、动物和主要主体，不要机械按编号拼接。${agentNameText}`,
    `默认上传顺序是：前${agentPhotoCount}张用于提供纪念对象参考，最后一张用于提供用户本人参考；请以视觉理解为主，从参考图中抽离出纪念对象和用户本人，再重新生成一张纪念合照。`,
    '纪念对象可能是人，也可能是宠物或其他有情感意义的对象，请根据参考照片自行判断对象类型。',
    '请生成一张温暖、自然、真实摄影风格的纪念同框照片，不要直接复制原图背景或做生硬拼贴。',
    '如果纪念对象是人，保留人物面部身份特征、年龄感、发型和主要气质；如果纪念对象是宠物，必须保持真实动物形态、品种、毛色和体型，不要拟人化，不要把宠物生成成人。',
    '用户与纪念对象自然同框，光线柔和，构图像真实生活照片。',
    '不要生成多余的人物或动物，不要文字，不要水印，不要夸张表情，不要卡通化，不要恐怖、灵异、祭奠感。',
  ].join('');

  if (customPrompt) {
    return [
      `用户自定义提示词（优先遵循）：${customPrompt}`,
      '默认提示词仅作为兜底补充；如画面内容、场景、动作、风格、对象类型与用户自定义提示词冲突，以用户自定义提示词为主，但仍需保持参考对象身份/物种特征，不要新增无关人物或动物，不要文字和水印。',
      `默认兜底规则：${defaultPrompt}`,
    ].join('\n');
  }

  return defaultPrompt;
}
