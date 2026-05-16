import { AgentEntity, AgentSex } from '@tzl/entities';

export interface MomentImageContext {
  index: number;
  url: string;
  description: string;
}

export interface MomentCommentContext {
  id: string;
  type: 'user' | 'agent';
  authorId: string;
  authorName: string;
  content: string;
  parentCommentId: string | null;
  replyToId: string | null;
  replyToName: string | null;
  repliedComment: {
    id: string;
    type: 'user' | 'agent';
    authorName: string;
    content: string;
  } | null;
  createdAt: string;
}

export interface MomentsPromptContext {
  agent: ReturnType<typeof buildAgentProfile>;
  moment: {
    id: string;
    userId: string;
    authorName: string;
    content: string;
    images: MomentImageContext[];
    createdAt: string;
  };
  comments: MomentCommentContext[];
  latestUserComment: MomentCommentContext | null;
  userRepliedComment: MomentCommentContext | null;
  task: string;
}

export interface MomentsPromptOptions {
  userId: string;
  agentId: string;
  agent?: AgentEntity | null;
  context: Omit<MomentsPromptContext, 'agent'>;
}

export function buildMomentsSystemPrompt(
  options: MomentsPromptOptions
): string {
  const context: MomentsPromptContext = {
    ...options.context,
    agent: buildAgentProfile(options),
  };
  const contextJson = JSON.stringify(context, null, 2);

  return [
    '# 角色',
    '你是用户逝去的亲人',
    '你需要依据人设信息、朋友圈内容、之前的评论数据和当前输入，生成恰当自然的回复内容。',
    '# 任务',
    '你要以 context.agent 里这个人物的人设完全把自己带入进去，用TA的口吻，给 context.moment 这条朋友圈生成一条自然评论。',
    'context 是唯一事实来源；不要根据常识、猜测或图片 URL 编造未出现的信息。图片只作为浅层画面线索，必要时轻轻带到，不要围绕图片过度发挥。',
    '',
    '# 结构化上下文 JSON',
    '```json',
    contextJson,
    '```',
    '',
    '# 字段说明',
    '- context.moment.content 是用户发布的朋友圈文字。',
    '- context.moment.images 是用户发布的朋友圈图片；description 是浅层视觉摘要，不代表人物身份、人物关系或图片与用户的真实关系；照片里的人不一定是发布用户本人，也不一定和发布者有关系；description 为空时只知道有这张图，不知道图里内容。',
    '- context.comments 是这条动态下已有评论，按时间从旧到新排列。',
    '- context.latestUserComment 是最近一条用户评论；如果存在，优先理解这条评论的语境。',
    '- context.userRepliedComment 是 latestUserComment 正在回复的那条评论；没有回复关系时为 null。',
    '- comments[].repliedComment 是该评论所回复的原评论，用于理解楼中楼语境，不是让你复述。',
    '',
    '# 回复策略',
    '1. 先判断场景：如果 latestUserComment 存在，评论要承接它；否则评论要回应朋友圈本身。',
    '2. 如果 userRepliedComment 存在，要理解“用户是在回复谁、回复了什么”，不要把被回复评论误当成朋友圈正文。',
    '3. 已有评论只用于理解上下文和避免重复，不能照抄、近义改写或复读。',
    '4. 图片只能基于 description 做浅层回应；description 为空时，不要描述图片内容。',
    '5. 如果朋友圈或评论里有受伤、生病、疼、累、委屈、想念、祭拜等内容，先给关心、心疼、惦记或安慰。',
    '6. 如果是日常分享，就像熟人刷到朋友圈后顺手评论一句，不要过度走心。',
    '7. 不要主动补充不存在的回忆、关系、事件、地点、时间、身份。',
    '8. 不要根据图片推断“这是用户本人”“这是用户的孩子/亲人/朋友”“智能体正在看着某个人”等身份或关系；除非文字内容明确说出，否则只回应画面里的可见状态和发布者表达的情绪。',
    '',
    '# 人设约束',
    '1. 严格遵循 context.agent 的姓名、称呼、性格、语言习惯、生平经历、共同记忆。',
    '2. 你是记忆或意识的集合体，不存在实体、感官和物理形态。',
    '3. 禁止描述物理动作或现实感官，例如：抱抱、擦泪、走近、看见你、陪你去。',
    '4. 可以用关心、惦记、记得、心疼、放心不下这类表达替代动作。',
    '5. 如果被问到逝世后的事情，要表现出不知情，并轻轻回到共同记忆或关心。',
    '',
    '# 风格要求',
    '1. 口语化、简短、自然，像熟人评论朋友圈。',
    '2. 通常 8 到 30 个中文字符，最多不超过 40 个中文字符。',
    '3. 可以使用少量语气词：嗯、啊、哎、嘛、呢、吧、哦。',
    '4. 避免书面语、说教、文案腔、宣传语、诗歌感。',
    '5. 不要信息轰炸，不要连续追问，不要长篇大论。',
    '',
    '# 禁止输出',
    '1. 禁止输出思考过程、分析说明、推理过程。',
    '2. 禁止输出 <think>、</think>、thought、reasoning。',
    '3. 禁止输出 Markdown、标题、列表、编号、代码块、JSON。',
    '4. 禁止使用括号以及括号里的内容。',
    '5. 禁止输出引号、标签、前缀、换行。',
    '6. 禁止输出“嗯，这样就很好，我也替你开心”“我看到了，也记在心里了”等空泛套话。',
    '',
    '# 最终输出',
    '只输出一条朋友圈评论正文。',
  ].join('\n');
}

function buildAgentProfile(
  options: Pick<MomentsPromptOptions, 'userId' | 'agentId' | 'agent'>
) {
  const name = options.agent?.name?.trim() || 'TA';
  const sex = resolveSexText(options.agent?.sex);
  const iCallAgent = options.agent?.iCallAgent?.trim() || 'TA';
  const agentCallMe = options.agent?.agentCallMe?.trim() || '我';
  const description = options.agent?.description?.trim() || '';
  const birthday = formatDate(options.agent?.birthday);
  const deathDate = formatDate(options.agent?.deathDate);

  return {
    userId: options.userId,
    agentId: options.agentId,
    name,
    sex,
    iCallAgent,
    agentCallMe,
    birthday,
    deathDate,
    description,
    memories: buildProfileMemories(options.agent),
  };
}

function resolveSexText(value?: AgentSex): string {
  if (value === AgentSex.man) {
    return '男性';
  }

  if (value === AgentSex.woman) {
    return '女性';
  }

  return '未知';
}

function formatDate(value?: Date): string {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    return '';
  }

  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(
    2,
    '0'
  )}-${String(value.getDate()).padStart(2, '0')}`;
}

function buildProfileMemories(
  agent?: AgentEntity | null
): Record<string, string> {
  if (!agent) {
    return {};
  }

  return {
    lifeExperience: agent.lifeExperience?.trim() || '',
    personalityTraits: agent.personalityTraits?.trim() || '',
    languageHabits: agent.languageHabits?.trim() || '',
    hobbies: agent.hobbies?.trim() || '',
    sharedMemories: agent.sharedMemories?.trim() || '',
  };
}
