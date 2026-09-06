import {
  MESSENGER_PRODUCT_GUIDE_CARDS,
  MESSENGER_PRODUCT_GUIDE_KNOWLEDGE_VERSION,
  buildMessengerProductGuideContextQuery,
  buildMessengerProductGuideDirectReply,
  buildMessengerProductGuideKnowledgePrompt,
  findMessengerProductGuideCards,
} from '../../src/service/agents/messenger-product-guide-knowledge';

function allFacts(query: string): string {
  return (
    findMessengerProductGuideCards(query)[0]
      ?.topics.flatMap(topic => topic.facts)
      .join('\n') || ''
  );
}

describe('messenger product guide knowledge', () => {
  it('keeps seven cards with one overview and independently usable topics', () => {
    expect(MESSENGER_PRODUCT_GUIDE_CARDS).toHaveLength(7);
    expect(
      new Set(MESSENGER_PRODUCT_GUIDE_CARDS.map(card => card.id)).size
    ).toBe(MESSENGER_PRODUCT_GUIDE_CARDS.length);
    expect(
      MESSENGER_PRODUCT_GUIDE_CARDS.every(
        card =>
          card.overviewReply.length > 0 &&
          card.topics.length > 0 &&
          card.sources.length > 0 &&
          card.topics.every(
            topic =>
              topic.triggers.length > 0 &&
              topic.facts.length > 0 &&
              topic.directReply.length > 0
          )
      )
    ).toBe(true);
  });

  it.each([
    ['所有功能和服务有哪些？', 'product.introduction'],
    ['新用户试用几天？', 'chat.membership_policy'],
    ['不充钱每天能聊几句？', 'chat.membership_policy'],
    ['基础版会员有什么用？', 'chat.membership_policy'],
    ['动态可以和亲人多轮回复吗？', 'chat.membership_policy'],
    ['怎么让亲人更像以前？', 'memory.improvement_methods'],
    ['跟亲人聊天会记住吗？', 'memory.improvement_methods'],
    ['导入聊天记录有什么用？', 'chat_import.features'],
    ['导入记录怎么操作？', 'chat_import.features'],
    ['导入后会学习说话方式吗？', 'chat_import.features'],
    ['重复截图会重复导入吗？', 'chat_import.features'],
    ['微信语音要先转文字吗？', 'chat_import.features'],
    ['导入完了但是有一张识别错了', 'chat_import.features'],
    ['聊天里可以发照片吗？', 'image.features'],
    ['纪念合照怎么生成？', 'image.features'],
    ['合照每天能生成几次？', 'image.features'],
    ['声音训练免费吗？', 'membership.voice'],
    ['支付后去哪里查订单？', 'payment.common'],
  ])('retrieves the expected card for %s', (query, expectedId) => {
    expect(findMessengerProductGuideCards(query)[0]?.id).toBe(expectedId);
  });

  it('keeps related business topics in one card without flattening them', () => {
    const card = findMessengerProductGuideCards('基础版会员有什么用？')[0];
    const facts = allFacts('基础版会员有什么用？');

    expect(card?.id).toBe('chat.membership_policy');
    expect(card?.topics.map(topic => topic.id)).toEqual([
      'trial',
      'free_quota',
      'basic_benefits',
      'moments',
      'purchase',
    ]);
    expect(facts).toContain('免费试用期为 3 天');
    expect(facts).toContain('非会员每天可与每位亲友聊 3 句');
    expect(facts).toContain('无限聊天、记忆唤醒和云端共享');
    expect(facts).toContain('基础版会员可以在评论区继续与亲人多轮回复');
  });

  it('answers only the requested membership topic on the legacy path', () => {
    const reply =
      buildMessengerProductGuideDirectReply('为什么我的动态只回复一句？');

    expect(reply).toContain('非会员可以获得亲人的首轮回复');
    expect(reply).toContain('基础版会员可以在评论区继续和亲人多轮回复');
    expect(reply).not.toContain('3 天');
    expect(reply).not.toContain('云端共享');
  });

  it('gives only an overview for a broad memory question', () => {
    const reply = buildMessengerProductGuideDirectReply('怎样让亲人更像以前？');

    expect(reply).toContain('四处慢慢补充');
    expect(reply).toContain('告诉小使者');
    expect(reply).toContain('导入过去的微信聊天记录');
    expect(reply).not.toContain('导入记录不消耗聊天次数');
  });

  it('keeps image topics in one card', () => {
    const facts = allFacts('图片和合照功能怎么用？');

    expect(facts).toContain('从相册选择一张照片');
    expect(facts).toContain('亲人的 1—3 张照片');
    expect(facts).toContain('非会员每天可生成 3 次');
    expect(facts).toContain('不是真实发生过的合影');
  });

  it('keeps the four memory methods in one guide card', () => {
    const facts = allFacts('怎么完善亲人记忆？');

    expect(facts).toContain('主动提到具体的人、事情、地点');
    expect(facts).toContain('可以告诉小使者');
    expect(facts).toContain('进入亲人主页完善');
    expect(facts).toContain('微信聊天截图');
  });

  it('keeps all chat import facts available as independent topics', () => {
    const facts = allFacts('导入聊天记录有什么用？');

    expect(facts).toContain('图片入口发送一张过去的微信聊天截图');
    expect(facts).toContain('显示在亲人聊天框最上方');
    expect(facts).toContain('常用语气词、句子长短');
    expect(facts).toContain('自动识别并去重');
    expect(facts).toContain('先在微信中转成文字');
    expect(facts).toContain('长按对应消息');
    expect(facts).toContain('不消耗聊天次数');
  });

  it('injects only the overview for a broad chat-import question', () => {
    const prompt =
      buildMessengerProductGuideKnowledgePrompt('导入聊天记录有什么用？');

    expect(prompt).toContain('接在亲人聊天框最上方');
    expect(prompt).toContain('共同经历和过去的说话习惯');
    expect(prompt).not.toContain('自动识别并去重');
    expect(prompt).not.toContain('先在微信中转成文字');
    expect(prompt).not.toContain('长按对应消息');
    expect(prompt).not.toContain('不消耗聊天次数');
  });

  it('injects only the specifically requested topic by default', () => {
    const prompt =
      buildMessengerProductGuideKnowledgePrompt('微信语音要先转文字吗？');

    expect(prompt).toContain('只截语音气泡');
    expect(prompt).not.toContain('自动识别并去重');
    expect(prompt).not.toContain('长按对应消息');
    expect(prompt).not.toContain('不消耗聊天次数');
  });

  it('expands every topic only after an explicit detailed request', () => {
    const prompt =
      buildMessengerProductGuideKnowledgePrompt(
        '请详细介绍导入聊天记录的全部功能'
      );

    expect(prompt).toContain('"depth":"detailed"');
    expect(prompt).toContain('自动识别并去重');
    expect(prompt).toContain('先在微信中转成文字');
    expect(prompt).toContain('长按对应消息');
    expect(prompt).toContain('不消耗聊天次数');
  });

  it('keeps an explicit follow-up inside the preceding product-guide task', () => {
    const query = buildMessengerProductGuideContextQuery('再详细一点', [
      { role: 'user', content: '导入聊天记录有什么用？' },
      { role: 'assistant', content: '导入后可以接着以前的对话聊。' },
    ]);

    expect(query).toContain('导入聊天记录有什么用？');
    expect(buildMessengerProductGuideKnowledgePrompt(query)).toContain(
      '"depth":"detailed"'
    );
  });

  it('keeps a legacy direct reply limited to one import topic', () => {
    const reply =
      buildMessengerProductGuideDirectReply('重复截图会重复导入吗？');

    expect(reply).toContain('自动去重');
    expect(reply).not.toContain('语音');
    expect(reply).not.toContain('长按');
    expect(reply).not.toContain('聊天次数');
  });

  it('keeps import recognition and imitation guardrails', () => {
    const card = findMessengerProductGuideCards('导入后会怎么样？')[0];
    const guidance = card?.guidance?.join('\n') || '';

    expect(guidance).toContain('不承诺截图识别完全准确');
    expect(guidance).toContain('不承诺导入后立即或完全复刻本人');
    expect(guidance).toContain('切换到亲人记忆助理');
    expect(guidance).toContain('一次只开启一个容易回答的记忆话题');
  });

  it('does not inject product knowledge into an ordinary family memory', () => {
    expect(
      findMessengerProductGuideCards('妈妈以前会把省下来的钱留给我买书。')
    ).toEqual([]);
    expect(
      findMessengerProductGuideCards('妈妈以前连我报名时的付费都替我操心。')
    ).toEqual([]);
    expect(
      findMessengerProductGuideCards('妈妈以前喜欢发动态记录种花。')
    ).toEqual([]);
    expect(
      findMessengerProductGuideCards('这张照片是妈妈年轻时在粮管所拍的。')
    ).toEqual([]);
  });

  it('supplies facts and progressive rules without leaking sources', () => {
    const prompt =
      buildMessengerProductGuideKnowledgePrompt('试用结束后还有免费额度吗？');

    expect(prompt).toContain(MESSENGER_PRODUCT_GUIDE_KNOWLEDGE_VERSION);
    expect(prompt).toContain('每天可与每位亲友聊 3 句');
    expect(prompt).toContain('默认只回答用户当前问到的主题');
    expect(prompt).toContain('不主动推销');
    expect(prompt).not.toContain('apps/weapp');
  });

  it('builds a concise legacy answer for voice pricing', () => {
    const reply = buildMessengerProductGuideDirectReply('声音复刻收费吗？');

    expect(reply).toContain('声音训练和试听是免费的');
    expect(reply).not.toContain('方言');
  });
});
