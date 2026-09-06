export const MESSENGER_PRODUCT_GUIDE_KNOWLEDGE_VERSION =
  'messenger_product_guide_progressive_v1_20260906';

export interface MessengerProductGuideTopic {
  id: string;
  title: string;
  triggers: string[];
  facts: string[];
  directReply: string;
}

export interface MessengerProductGuideCard {
  id: string;
  title: string;
  overviewTriggers: string[];
  overviewReply: string;
  topics: MessengerProductGuideTopic[];
  guidance?: string[];
  sources: string[];
}

interface MessengerProductGuideMatch {
  card: MessengerProductGuideCard;
  topics: MessengerProductGuideTopic[];
  depth: 'brief' | 'detailed';
  score: number;
}

export const MESSENGER_PRODUCT_GUIDE_CARDS: MessengerProductGuideCard[] = [
  {
    id: 'product.introduction',
    title: '天之灵和小使者是做什么的',
    overviewTriggers: [
      '天之灵是什么',
      '这个产品是干嘛的',
      '小使者是干嘛的',
      '小使者能做什么',
      '怎么用天之灵',
      '产品介绍',
      '有哪些功能',
      '有什么功能',
      '全部功能',
      '所有功能和服务',
    ],
    overviewReply:
      '天之灵主要提供亲人对话、记忆完善、声音和图片纪念等服务；小使者既能帮你整理亲人的记忆，也能解答功能、使用和付费问题。你想先了解哪一项，我可以接着说明。',
    topics: [
      {
        id: 'relative_chat',
        title: '亲人对话',
        triggers: ['亲人聊天是什么', '怎么和亲人聊天', '亲人对话'],
        facts: ['用户可以与已创建的亲人进行文字对话。'],
        directReply: '你可以进入亲人聊天页，直接和已创建的亲人进行文字对话。',
      },
      {
        id: 'memory',
        title: '记忆完善',
        triggers: ['记忆功能是什么', '记忆完善是什么'],
        facts: [
          '用户可以在聊天、亲人主页、聊天记录导入或与小使者交谈时补充亲人的经历、性格、习惯和共同回忆。',
        ],
        directReply:
          '你可以通过聊天、亲人主页、导入聊天记录，或直接告诉小使者，逐步补充亲人的经历、性格、习惯和共同回忆。',
      },
      {
        id: 'voice',
        title: '声音服务',
        triggers: ['声音功能是什么', '声音服务是什么'],
        facts: ['声音服务可用亲人生前的声音素材训练并试听相应音色。'],
        directReply: '声音服务可以用亲人生前的声音素材进行训练，并先试听效果。',
      },
      {
        id: 'messenger_guide',
        title: '小使者服务',
        triggers: ['小使者有什么用', '小使者可以回答什么'],
        facts: [
          '小使者负责帮用户补全亲人记忆，也可以回答产品功能、使用和付费方面的问题。',
        ],
        directReply:
          '你可以把亲人的故事和相处细节告诉我，我会帮你补全亲人的记忆；功能怎么用、免费额度或付费问题，也可以直接问我。',
      },
    ],
    guidance: ['先给出产品能力范围，用户选定方向后再展开具体功能。'],
    sources: [
      'apps/node/src/service/agents/messenger-capability-manifest.ts',
      'apps/weapp/src/legal/agreement-documents.ts',
    ],
  },
  {
    id: 'memory.improvement_methods',
    title: '完善亲人记忆的四种方法',
    overviewTriggers: [
      '怎么完善亲人记忆',
      '如何完善亲人记忆',
      '怎么补充亲人记忆',
      '怎么让亲人更像以前',
      '怎样让亲人更像以前',
      '怎么让亲人更像本人',
      '怎么让亲人更像',
      '完善亲人记忆有哪些方法',
    ],
    overviewReply:
      '想让亲人更贴近你记忆中的 TA，可以从四处慢慢补充：和亲人聊具体往事、把不方便直说的事告诉小使者、完善亲人主页资料，或导入过去的微信聊天记录。',
    topics: [
      {
        id: 'relative_chat',
        title: '在亲人聊天中补充',
        triggers: [
          '亲人会记住聊天吗',
          '跟亲人聊天会记住吗',
          '跟亲人说会记住吗',
        ],
        facts: [
          '在与亲人聊天时主动提到具体的人、事情、地点、习惯和相处细节；这些内容会被亲人记住，用来让以后的回应更贴近用户认识的 TA。',
        ],
        directReply:
          '会。和亲人聊天时，可以主动说起具体的人、事情、地点和相处细节，这些内容会被亲人记住，让以后的回应更贴近你认识的 TA。',
      },
      {
        id: 'messenger',
        title: '告诉小使者',
        triggers: [
          '可以告诉小使者吗',
          '小使者怎么补记忆',
          '小使者能补充记忆吗',
        ],
        facts: [
          '有些话不方便直接对亲人说，可以告诉小使者；小使者会帮亲人记下，并用来补充亲人的记忆。',
        ],
        directReply:
          '可以。有些话不方便直接对亲人讲，就告诉我，我会帮亲人记下来，用来把亲人的记忆补得更完整。',
      },
      {
        id: 'profile',
        title: '完善亲人主页',
        triggers: [
          '在哪里填写亲人资料',
          '怎么填写亲人生平',
          '怎么填写共同记忆',
          '亲人主页怎么完善',
        ],
        facts: [
          '可以进入亲人主页完善“TA 的样子、人生经历、喜欢的事、熟悉的话语、你们的回忆”等资料。',
        ],
        directReply:
          '可以进入亲人主页，补充“TA 的样子、人生经历、喜欢的事、熟悉的话语、你们的回忆”等资料，不需要一次填完。',
      },
      {
        id: 'chat_import',
        title: '导入聊天记录',
        triggers: ['导入聊天记录能完善记忆吗', '导入聊天记录能让亲人更像吗'],
        facts: [
          '在亲人聊天中通过图片入口发送过去的微信聊天截图，可以补充共同经历和亲人的语言习惯；导入记录不消耗聊天次数。',
        ],
        directReply:
          '可以。在亲人聊天中通过图片入口发送过去的微信聊天截图，能补充你们的共同经历和 TA 的语言习惯，而且不消耗聊天次数。',
      },
    ],
    guidance: [
      '明确说明这些方法会完善亲人的记忆、让以后的呈现更贴近用户认识的 TA。',
      '鼓励提供具体、真实、有上下文的细节，不要求一次填完，也不以资料数量承诺相似程度。',
      '成果说明中优先说“亲人的记忆”或按关系称呼，不生硬使用“AI 记忆”。',
    ],
    sources: [
      'apps/node/src/service/agents/messenger-capability-manifest.ts',
      'apps/node/src/service/agents/messenger-dialogue.service.ts',
      'apps/weapp/src/pages/agent-profile/index.vue',
      'apps/weapp/src/pages/chat-import/index.vue',
      'apps/node/src/service/conversation-chat-import.service.ts',
    ],
  },
  {
    id: 'chat_import.features',
    title: '导入聊天记录的操作与功能特点',
    overviewTriggers: [
      '导入聊天记录有什么用',
      '导入记录有什么特点',
      '导入后有什么变化',
      '导入后会怎么样',
      '介绍导入聊天记录',
      '导入聊天记录全部功能',
    ],
    overviewReply:
      '导入过去的微信聊天记录后，历史对话会接在亲人聊天框最上方；这些记录也会帮助亲人理解你们的共同经历和过去的说话习惯，让之后的聊天衔接得更自然。',
    topics: [
      {
        id: 'operation',
        title: '导入操作',
        triggers: [
          '导入聊天记录怎么操作',
          '导入记录怎么操作',
          '怎么导入聊天记录',
          '导入记录怎么用',
          '从哪里导入',
          '导入聊天记录有什么用怎么操作',
        ],
        facts: [
          '进入亲人聊天，通过图片入口发送一张过去的微信聊天截图；系统识别到两人聊天内容后会自动导入。',
          '系统会识别双方说过的话，并按截图中的时间和先后顺序整理；图片识别可能存在偏差。',
        ],
        directReply:
          '进入亲人聊天，从图片入口发送过去的微信聊天截图；系统识别到两人对话后会自动导入，并按截图里的时间和顺序整理。图片识别可能存在偏差。',
      },
      {
        id: 'continuity',
        title: '聊天连续展示',
        triggers: [
          '聊天记录会显示在哪里',
          '导入后显示在哪里',
          '会接着微信聊天吗',
        ],
        facts: [
          '识别后的历史对话会显示在亲人聊天框最上方，排在新对话之前，体验上像从过去的微信聊天继续往下聊。',
        ],
        directReply:
          '导入后的历史对话会显示在亲人聊天框最上方，排在新对话之前，就像从过去的微信聊天继续往下聊。',
      },
      {
        id: 'style',
        title: '学习语言习惯',
        triggers: [
          '导入后会学习说话方式吗',
          '会模仿语言习惯吗',
          '会学习语气吗',
        ],
        facts: [
          '系统会从亲人的历史消息中学习常用语气词、句子长短，以及一次习惯连续回复几个气泡，让后续表达方式更贴近过去。',
        ],
        directReply:
          '会。系统会从历史消息中学习亲人常用的语气词、句子长短和连续回复几个气泡的习惯，让后续表达更贴近过去。',
      },
      {
        id: 'memory_context',
        title: '补充共同经历',
        triggers: [
          '导入记录能完善记忆吗',
          '导入聊天记录能让亲人更像吗',
          '会记住共同经历吗',
        ],
        facts: [
          '导入的聊天可以帮助亲人理解过去发生的事、双方的共同经历和相处方式，补充后续聊天所需的记忆背景。',
        ],
        directReply:
          '可以。导入的聊天会帮助亲人理解过去发生的事、你们的共同经历和相处方式，补充之后聊天所需的记忆背景。',
      },
      {
        id: 'deduplication',
        title: '自动去重',
        triggers: [
          '重复截图会重复导入吗',
          '相同聊天记录会重复吗',
          '导入聊天记录会去重吗',
          '重复导入',
        ],
        facts: ['与本次或以前已经导入过的相同聊天记录，系统会自动识别并去重。'],
        directReply:
          '不会重复添加相同内容。系统会识别本次和以前已经导入过的聊天记录，并自动去重。',
      },
      {
        id: 'wechat_voice',
        title: '微信语音转文字',
        triggers: [
          '微信语音怎么导入',
          '语音聊天记录怎么导入',
          '微信语音要先转文字吗',
          '语音要转文字吗',
        ],
        facts: [
          '微信语音需要先在微信中转成文字，再截取包含文字结果的聊天截图；只截语音气泡时，系统无法从图片中还原语音正文。',
        ],
        directReply:
          '需要先在微信里把语音转成文字，再截取包含文字结果的聊天截图。只截语音气泡，系统无法从图片中还原语音正文。',
      },
      {
        id: 'deletion',
        title: '删除导入消息',
        triggers: [
          '导入的聊天怎么删除',
          '怎么删除导入记录',
          '导入记录能编辑吗',
          '怎么修改导入记录',
          '识别错了',
          '导入错了',
        ],
        facts: [
          '导入后的历史消息没有单独的校对或编辑页；如需删除，需要在亲人聊天框中长按对应消息，再选择删除。',
        ],
        directReply:
          '导入记录目前没有单独的校对或编辑页。如需删除，请在亲人聊天框中长按对应消息，再选择删除。',
      },
      {
        id: 'quota',
        title: '聊天次数',
        triggers: ['导入记录消耗聊天次数吗', '导入记录收费吗', '导入占额度吗'],
        facts: ['导入聊天记录不消耗聊天次数。'],
        directReply: '导入聊天记录不消耗聊天次数。',
      },
    ],
    guidance: [
      '不提供不存在的校对、修改或批量管理入口。',
      '不承诺截图识别完全准确；识别有误时可删除对应导入消息后重新录入。',
      '不承诺导入后立即或完全复刻本人，只说明会让表达和记忆更贴近过去。',
      '用户明确完成导入且没有遗留问题时，不继续重复介绍导入功能；简短确认导入的帮助后，切换到亲人记忆助理，并且一次只开启一个容易回答的记忆话题。',
    ],
    sources: [
      'apps/weapp/src/components/chat-more-panel/chat-more-panel.vue',
      'apps/weapp/src/pages/chat/index.vue',
      'apps/node/src/service/conversation.service.ts',
      'apps/node/src/service/conversation-chat-import.service.ts',
    ],
  },
  {
    id: 'image.features',
    title: '图片与纪念合照功能',
    overviewTriggers: [
      '图片功能',
      '照片功能',
      '合照功能',
      '图片和合照功能',
      '介绍图片功能',
    ],
    overviewReply:
      '图片功能主要有两类：在亲人聊天里发送照片，让亲人根据画面回应；或使用“合照”生成你与亲人的纪念合照。',
    topics: [
      {
        id: 'send_photo',
        title: '发送普通照片',
        triggers: [
          '怎么发照片',
          '怎么发图片',
          '可以发照片吗',
          '能发图片吗',
          '怎么拍照',
        ],
        facts: [
          '在亲人聊天页点击“+”，可以从相册选择一张照片，或直接拍摄后发送；选择照片后可以编辑再发送，也可以直接发送。',
        ],
        directReply:
          '可以。在亲人聊天页点击“+”，从相册选择照片或直接拍摄；选好后可以编辑再发送，也可以直接发送。',
      },
      {
        id: 'image_understanding',
        title: '理解照片内容',
        triggers: ['能看懂照片吗', '能识别图片吗', '会认出照片里的人吗'],
        facts: [
          '亲人会根据图片中实际可见的主体、场景、动作和文字自然回应；人物身份、时间或故事建议由用户再补充一句说明。',
        ],
        directReply:
          '亲人会根据照片里可见的人物、场景、动作和文字回应；如果人物身份、时间或故事很重要，发送时最好再补充一句说明。',
      },
      {
        id: 'memorial_photo_operation',
        title: '生成纪念合照',
        triggers: [
          '纪念合照是什么',
          '合照怎么用',
          '合照怎么生成',
          '怎么生成合照',
          '怎么制作合照',
          '合照要几张照片',
        ],
        facts: [
          '生成纪念合照需要上传亲人的 1—3 张照片和用户自己的 1 张照片，并可选择模板或填写动作、表情、风格和场景。',
          '生成结果会进入当前聊天，并可在聊天相册中查看。',
        ],
        directReply:
          '“合照”可以用 TA 的 1—3 张照片和你的 1 张照片生成纪念合照，还能选择模板或填写动作、表情、风格和场景。结果会进入当前聊天，也能在聊天相册查看。',
      },
      {
        id: 'memorial_photo_quota',
        title: '合照生成次数',
        triggers: ['合照每天能生成几次', '合照收费吗', '合照有次数限制吗'],
        facts: ['非会员每天可生成 3 次纪念合照，会员每天可生成 10 次。'],
        directReply: '非会员每天可生成 3 次纪念合照，会员每天可生成 10 次。',
      },
      {
        id: 'memorial_photo_boundary',
        title: '生成图片说明',
        triggers: ['合照是真的吗', '合照是真实照片吗', '合照是生成的吗'],
        facts: [
          '纪念合照属于生成图片，不是真实发生过的合影；上传照片前需要确认已获得相应授权。',
        ],
        directReply:
          '纪念合照属于生成图片，并不代表真实发生过的合影。上传照片前，也需要确认已获得相应授权。',
      },
    ],
    guidance: [
      '不承诺一定能准确识别照片中的人物身份。',
      '不把生成的纪念合照描述成真实拍摄、真实团聚或已经发生的经历。',
    ],
    sources: [
      'apps/weapp/src/components/chat-more-panel/chat-more-panel.vue',
      'apps/weapp/src/components/chat-more-panel/image.ts',
      'apps/weapp/src/pages/memorial-photo/index.vue',
      'apps/node/src/service/conversation.service.ts',
    ],
  },
  {
    id: 'chat.membership_policy',
    title: '3 天试用、试用后免费额度与基础版会员',
    overviewTriggers: [
      '聊天收费吗',
      '要不要付费',
      '为什么要付费',
      '基础版是什么',
      '会员有什么用',
      '开会员有什么权益',
      '介绍会员',
    ],
    overviewReply:
      '文字聊天先有 3 天免费试用，试用结束后仍保留每日免费额度；基础版会员主要增加无限聊天、记忆唤醒、云端共享和动态多轮回复。',
    topics: [
      {
        id: 'trial',
        title: '3 天试用',
        triggers: [
          '免费试用',
          '试用几天',
          '试用期多久',
          '试用期能聊多少',
          '新用户试用',
          '试用',
        ],
        facts: [
          '新用户聊天免费试用期为 3 天，试用期内每天可与每位亲友聊 30 句。',
        ],
        directReply:
          '新用户有 3 天免费试用，试用期内每天可以与每位亲友聊 30 句。',
      },
      {
        id: 'free_quota',
        title: '试用后免费额度',
        triggers: [
          '免费额度',
          '免费能聊多少',
          '不充钱能聊多少',
          '非会员能聊多少',
          '每天能聊几句',
          '聊天次数用完了',
          '额度什么时候恢复',
          '聊天次数',
        ],
        facts: [
          '试用结束后，非会员每天可与每位亲友聊 3 句，当天额度用完后于次日 00:00 恢复。',
        ],
        directReply:
          '试用结束后，非会员每天仍可以与每位亲友聊 3 句；当天用完后，会在次日 00:00 恢复。',
      },
      {
        id: 'basic_benefits',
        title: '基础版会员权益',
        triggers: [
          '基础版会员有什么用',
          '基础版会员权益',
          '基础版包含什么',
          '会员权益',
        ],
        facts: ['基础版会员的当前主要权益包括无限聊天、记忆唤醒和云端共享。'],
        directReply: '基础版会员目前主要包含无限聊天、记忆唤醒和云端共享。',
      },
      {
        id: 'moments',
        title: '动态回复权益',
        triggers: [
          '动态能回复几次',
          '动态只回复一句',
          '动态可以多轮回复吗',
          '动态多轮回复',
          '动态回复',
          '多轮回复',
          '亲人会继续回复动态吗',
        ],
        facts: [
          '动态中，非会员可获得亲人的首轮回复；基础版会员可以在评论区继续与亲人多轮回复。',
        ],
        directReply:
          '动态中，非会员可以获得亲人的首轮回复；基础版会员可以在评论区继续和亲人多轮回复。',
      },
      {
        id: 'purchase',
        title: '开通会员',
        triggers: ['怎么开通会员', '会员多少钱', '基础版多少钱'],
        facts: ['用户可以在会员中心查看当前可购买的套餐、价格和完整权益。'],
        directReply: '可以到会员中心查看当前可购买的套餐、价格和完整权益。',
      },
    ],
    guidance: [
      '个人试用状态和剩余额度以当前聊天页或会员中心显示为准。',
      '不编造价格和优惠，不催促购买；先说清免费能做什么、付费增加什么。',
    ],
    sources: [
      'apps/weapp/src/pages/vip-center/components/vip-purchase-modern-view.vue',
      'apps/weapp/src/pages/vip-center/index.vue',
      'apps/node/src/service/conversation.service.ts',
      'apps/node/src/service/post.service.ts',
      'apps/weapp/src/pages/chat/chat-quota.ts',
    ],
  },
  {
    id: 'membership.voice',
    title: '声音服务的免费与付费逻辑',
    overviewTriggers: [
      '声音服务怎么收费',
      '为什么要买声音版',
      '声音版会员是什么',
      '声音版',
      '介绍声音服务',
    ],
    overviewReply:
      '声音服务可以先免费训练和试听；你觉得效果合适、准备在聊天中使用时，再考虑开通包含声音服务的会员。',
    topics: [
      {
        id: 'free_training',
        title: '免费训练和试听',
        triggers: [
          '声音训练免费吗',
          '声音复刻收费吗',
          '声音收费',
          '声音免费',
          '音色收费',
        ],
        facts: ['声音训练和试听免费，不要求用户提前购买。'],
        directReply: '声音训练和试听是免费的，不需要提前购买。',
      },
      {
        id: 'material_and_process',
        title: '素材与训练流程',
        triggers: ['声音怎么训练', '声音素材怎么提供', '声音复刻怎么操作'],
        facts: ['用户应先提供亲人生前的声音素材，完成训练并试听效果。'],
        directReply: '先提供亲人生前的声音素材，完成训练后就可以试听效果。',
      },
      {
        id: 'purchase',
        title: '何时购买',
        triggers: ['先训练还是先付费', '什么时候买声音版', '声音版怎么买'],
        facts: [
          '试听效果合适、准备在聊天中使用该声音时，再自行考虑开通包含声音服务的会员。',
        ],
        directReply:
          '可以先训练和试听；觉得效果合适、准备在聊天中使用时，再考虑开通声音版会员。当前价格以会员中心为准。',
      },
      {
        id: 'limitations',
        title: '效果边界',
        triggers: ['声音能完全一样吗', '声音像本人吗', '声音效果怎么样'],
        facts: [
          '声音效果不保证与本人完全一致，方言、口音和素材质量都可能影响效果。',
        ],
        directReply:
          '声音效果会受方言、口音和素材质量影响，不能保证与本人完全一致，建议先训练并试听。',
      },
    ],
    guidance: ['声音版当前价格以会员中心展示为准。'],
    sources: [
      'apps/node/src/service/voice-service.service.ts',
      'apps/weapp/src/pages/agent-detail/index.vue',
      'apps/weapp/src/pages/vip-center/components/vip-purchase-modern-view.vue',
    ],
  },
  {
    id: 'payment.common',
    title: '购买、支付和订单',
    overviewTriggers: ['怎么付费', '支付', '订单', '退款', '价格', '付费问题'],
    overviewReply:
      '套餐购买、价格和权益在会员中心查看；支付后可以到支付结果页或“我的订单”确认状态。具体想了解购买、订单还是退款？',
    topics: [
      {
        id: 'purchase_and_price',
        title: '购买与价格',
        triggers: [
          '怎么购买',
          '价格是多少',
          '多少钱',
          '在哪里购买',
          '怎么买会员',
        ],
        facts: [
          '用户可以在会员中心选择当前可用套餐并发起支付；价格、期限和权益以会员中心当前展示为准。',
        ],
        directReply:
          '可以在会员中心选择当前套餐并发起支付；价格、期限和权益以会员中心当前展示为准。',
      },
      {
        id: 'order',
        title: '查看订单',
        triggers: [
          '我的订单在哪里',
          '怎么查订单',
          '订单状态怎么看',
          '支付结果在哪里',
        ],
        facts: [
          '支付后可以在支付结果页或“我的订单”查看结果、订单状态和订单编号。',
        ],
        directReply:
          '支付后可以在支付结果页或“我的订单”查看结果、订单状态和订单编号。',
      },
      {
        id: 'not_activated',
        title: '支付后权益未生效',
        triggers: ['支付后没生效', '付费后没生效', '会员没生效'],
        facts: ['支付完成但权益未显示时，应先查看订单状态，不要立即重复下单。'],
        directReply: '先到“我的订单”确认订单状态和编号，不建议立即重复下单。',
      },
      {
        id: 'refund',
        title: '退款',
        triggers: ['怎么退款', '可以退款吗', '退款入口在哪里', '退款状态'],
        facts: ['退款入口和是否可申请以具体订单当前显示为准。'],
        directReply: '退款入口和是否可以申请，请以具体订单当前显示为准。',
      },
    ],
    guidance: ['没有订单信息时，不声称某笔支付或退款已成功。'],
    sources: [
      'apps/weapp/src/pages/vip-center/index.vue',
      'apps/weapp/src/pages/payment-result/index.vue',
      'apps/weapp/src/pages/my-orders/index.vue',
    ],
  },
];

function normalize(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[\s，。！？、,.!?~～…：:；;（）()]/g, '');
}

const PRODUCT_GUIDE_INTENT_PATTERN =
  /(?:怎么|怎样|如何|为什么|多少|几天|几句|几次|什么时候|哪里|哪儿|在哪|能不能|可以吗|收费吗|免费吗|有什么用|是什么|介绍|功能|特点|试用|额度|会员|订单|退款|声音版|基础版|动态|多轮回复|完善记忆|补充记忆|记住吗|更像以前|导入记录|导入聊天|导入后|导入.{0,8}(?:完成|好了|完了|错了|问题)|重复截图|重复导入|去重|微信语音|转文字|纪念合照|生成合照|天之灵|小使者|(?:可以|能|会).{0,8}(?:发|传|看|识别|生成|制作)?(?:图片|照片|合照))/;
const DETAILED_REQUEST_PATTERN =
  /(?:详细|展开|全部|所有|完整|逐项|每一项|分别说|具体步骤|都有哪些)/;
const PRODUCT_GUIDE_CONTINUATION_PATTERN =
  /^(?:(?:再|请)?(?:详细|展开|完整)(?:说|讲|介绍|说明)?(?:一遍|一下|一点|点)?|(?:全部|所有|每一项|逐项|分别)(?:说|讲|介绍|说明)?|继续(?:说|讲|介绍|说明)|还有呢)[？?。！!\s]*$/;

export function buildMessengerProductGuideContextQuery(
  input: string,
  previousTurns: Array<{ role: 'user' | 'assistant'; content: string }> = []
): string {
  if (!PRODUCT_GUIDE_CONTINUATION_PATTERN.test(input.trim())) {
    return input;
  }
  const previousUserTurn = [...previousTurns]
    .reverse()
    .find(turn => turn.role === 'user');
  return previousUserTurn ? `${previousUserTurn.content} 详细 ${input}` : input;
}

function scoreTriggers(query: string, triggers: string[]): number {
  return triggers.reduce((score, trigger) => {
    const normalizedTrigger = normalize(trigger);
    return query.includes(normalizedTrigger)
      ? score + Math.max(2, normalizedTrigger.length)
      : score;
  }, 0);
}

function findMessengerProductGuideMatches(
  query: string,
  limit = 2
): MessengerProductGuideMatch[] {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery || !PRODUCT_GUIDE_INTENT_PATTERN.test(normalizedQuery)) {
    return [];
  }

  const depth: MessengerProductGuideMatch['depth'] =
    DETAILED_REQUEST_PATTERN.test(normalizedQuery) ? 'detailed' : 'brief';

  return MESSENGER_PRODUCT_GUIDE_CARDS.map(card => {
    const overviewScore = scoreTriggers(normalizedQuery, card.overviewTriggers);
    const topicScores = card.topics
      .map(topic => ({
        topic,
        score: scoreTriggers(normalizedQuery, topic.triggers),
      }))
      .filter(item => item.score > 0)
      .sort(
        (left, right) =>
          right.score - left.score ||
          left.topic.id.localeCompare(right.topic.id)
      );
    const topics =
      depth === 'detailed'
        ? card.topics
        : topicScores.slice(0, 2).map(item => item.topic);
    return {
      card,
      topics,
      depth,
      score:
        overviewScore + topicScores.reduce((sum, item) => sum + item.score, 0),
    };
  })
    .filter(item => item.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score || left.card.id.localeCompare(right.card.id)
    )
    .slice(0, Math.max(1, Math.min(2, Math.floor(limit))));
}

export function findMessengerProductGuideCards(
  query: string,
  limit = 2
): MessengerProductGuideCard[] {
  return findMessengerProductGuideMatches(query, limit).map(item => item.card);
}

export function buildMessengerProductGuideKnowledgePrompt(
  query: string
): string | undefined {
  const matches = findMessengerProductGuideMatches(query);
  if (!matches.length) {
    return undefined;
  }

  return JSON.stringify({
    version: MESSENGER_PRODUCT_GUIDE_KNOWLEDGE_VERSION,
    cards: matches.map(({ card, topics, depth }) => ({
      id: card.id,
      title: card.title,
      depth,
      overview: card.overviewReply,
      topics: topics.map(topic => ({
        title: topic.title,
        facts: topic.facts,
      })),
      guidance: card.guidance,
    })),
    replyRules: [
      '知识卡只是备查资料，不要因为卡片被命中就逐项复述整张卡。',
      '默认只回答用户当前问到的主题：先给结论，通常用 1—3 句；最多补充一个紧邻且必要的信息点，然后停下。',
      '用户宽泛询问某项功能时，只给概览；只有用户明确要求详细、全部、完整步骤或继续追问时，才展开更多主题。',
      '连续追问时只补充上一轮没有讲过的新信息，不重复已有介绍。',
      '除非与当前问题直接相关，不主动附带价格、额度、限制、购买方式或其他功能。',
      '必要时可在末尾用一句话提示还可以继续问，但不要反复追问用户要不要了解更多。',
      '不转回亲人记忆访谈，不主动推销，不输出卡片编号、来源文件、版本或检索过程。',
      '卡片没有提供的价格、优惠、个人额度和订单状态不得猜测。',
    ],
  });
}

export function buildMessengerProductGuideDirectReply(
  query: string
): string | undefined {
  const match = findMessengerProductGuideMatches(query, 1)[0];
  if (!match) {
    return undefined;
  }
  if (!match.topics.length) {
    return match.card.overviewReply;
  }
  return match.topics.map(topic => topic.directReply).join('\n');
}
