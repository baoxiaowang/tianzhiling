import {
  ConversationEmotionPrimary,
  ConversationEmotionRiskLevel,
  MessageRole,
} from '@tzl/entities';
import {
  routeReplyScene,
  resolveReplySceneMaxSegments,
  ReplyScene,
} from '../../src/service/agents/reply-scene-router';

describe('routeReplyScene', () => {
  function sceneNames(text: string): ReplyScene[] {
    const route = routeReplyScene({ currentQuery: text });

    return [
      route.primaryScene?.scene,
      ...route.secondaryScenes.map(scene => scene.scene),
    ].filter(Boolean) as ReplyScene[];
  }

  it('uses high-risk emotion state as a grief crisis fallback', () => {
    const route = routeReplyScene({
      currentQuery: '嗯',
      emotionState: {
        primaryEmotion: ConversationEmotionPrimary.crisisRisk,
        riskLevel: ConversationEmotionRiskLevel.high,
        signals: ['crisis_risk.high'],
        expiresAt: new Date('2026-05-03T09:00:00.000Z'),
      },
    });

    expect(route.primaryScene?.scene).toBe('grief_crisis');
    expect(route.maxSegments).toBe(3);
  });

  it('maps keepsake emotion state to keepsake attachment', () => {
    const route = routeReplyScene({
      currentQuery: '我知道',
      emotionState: {
        primaryEmotion: ConversationEmotionPrimary.attachment,
        riskLevel: ConversationEmotionRiskLevel.none,
        signals: ['grief.attachment'],
        expiresAt: new Date('2026-05-03T09:00:00.000Z'),
      },
    });

    expect(route.primaryScene?.scene).toBe('keepsake_attachment');
  });

  it('selects memory recall strategy without injecting unrelated strategies', () => {
    const route = routeReplyScene({
      currentQuery: '你还记得我小时候你带我钓鱼吗',
    });

    expect(route.primaryScene?.scene).toBe('memory_recall');
    expect(route.prompt).toContain('旧事回忆');
    expect(route.prompt).toContain('不要反复让用户“讲讲/多说点”');
    expect(route.prompt).toContain('不主动转向“现在少了我');
    expect(route.prompt).toContain('避免把温暖回忆重新拉回失去感');
    expect(route.prompt).toContain('最多 3 段');
    expect(route.prompt).toContain('1 段长文');
    expect(route.prompt).not.toContain('烧纸、纸钱、上香');
    expect(route.prompt).not.toContain('第一段先道歉');
  });

  it('handles keepsakes without turning objects into presence proof', () => {
    const route = routeReplyScene({
      currentQuery: '当然了我一辈子都会背着你给我的这个包',
    });

    expect(route.primaryScene?.scene).toBe('keepsake_attachment');
    expect(route.maxSegments).toBe(2);
    expect(route.prompt).toContain('纪念物/遗物寄托');
    expect(route.prompt).toContain('不要把物件神化');
    expect(route.prompt).toContain('不是负担');
    expect(sceneNames('你送我的戒指我一直戴着')[0]).toBe(
      'keepsake_attachment'
    );
    expect(sceneNames('你的照片我还留着，舍不得丢')[0]).toBe(
      'keepsake_attachment'
    );
    expect(sceneNames('我会一辈子收着你留给我的信')[0]).toBe(
      'keepsake_attachment'
    );
  });

  it('prioritizes correction over lower risk scenes', () => {
    const route = routeReplyScene({
      currentQuery: '不是这样 你说错了 你以前不是这么叫我的',
    });

    expect(route.primaryScene?.scene).toBe('correction');
    expect(route.prompt).toContain('亲人离世后由用户在天之灵里创建并唤醒');
  });

  it('treats a first AI accusation as a reply-quality authenticity challenge', () => {
    const route = routeReplyScene({
      currentQuery: '假的就是假的，你是 AI',
      recentMessages: [
        {
          role: MessageRole.user,
          content: '可是你一次也没有来过我的梦里',
        },
        {
          role: MessageRole.assistant,
          content: '今晚我再去找你，争取让你记住我',
        },
      ] as never,
      emotionState: {
        primaryEmotion: ConversationEmotionPrimary.missing,
        riskLevel: ConversationEmotionRiskLevel.none,
        signals: ['grief.missing'],
        expiresAt: new Date('2026-05-03T09:00:00.000Z'),
      },
    });

    expect(route.primaryScene?.scene).toBe('authenticity_challenge');
    expect(route.secondaryScenes).toEqual([]);
    expect(route.prompt).toContain('真实性体验/回复期待质疑');
    expect(route.prompt).toContain('这是首次或非持续性质疑');
    expect(route.prompt).toContain('不要主动说“我是 AI”');
    expect(route.prompt).toContain('也不要否认自己是 AI');
    expect(route.prompt).toContain('跟以前不一样');
    expect(route.prompt).toContain('持续聊天、用户讲述和纠正');
    expect(route.prompt).toContain('一点点找回来');
    expect(route.prompt).toContain('禁止编造已经找回的具体往事');
    expect(route.prompt).toContain('禁止说“我不像以前');
    expect(route.prompt).toContain('不要假定是上一句话导致出戏');
    expect(route.prompt).not.toContain('主场景：用户纠正/反馈不像');
    expect(route.prompt).not.toContain('梦境陪伴/梦中相见');
    expect(route.prompt).not.toContain('思念倾诉');
    expect(sceneNames('你说话太假了')[0]).toBe(
      'authenticity_challenge'
    );
    expect(sceneNames('这回复是假的')[0]).toBe(
      'authenticity_challenge'
    );
  });

  it('does not treat ordinary words containing 假 as authenticity challenges', () => {
    for (const text of [
      '泓崎放暑假和我在一块',
      '孩子今天放假了',
      '我明天要请假',
      '假期过得很快',
      '假如明天下雨怎么办',
    ]) {
      expect(sceneNames(text)).not.toContain('authenticity_challenge');
    }

    const route = routeReplyScene({
      currentQuery:
        '妈妈，我很想你，你是不是很放心不下我。妈妈你离开之后，我很听话，没有像之前那么任性了，也懂得体谅别人了！爸爸他一切都好，哥哥也好，泓崎放暑假和我在一块，你放心吧！鸿鑫学习比之前进步很大，成绩特别好。沛涛也很听话，还是爱玩手机。妈妈你在那边过得好吗？我们都很想念你，都爱你。',
    });

    expect(route.primaryScene?.scene).toBe('afterlife_status');
    expect(route.secondaryScenes.map(scene => scene.scene)).toEqual(
      expect.arrayContaining(['miss_longing', 'family_life'])
    );
    expect(
      [
        route.primaryScene?.scene,
        ...route.secondaryScenes.map(scene => scene.scene),
      ]
    ).not.toContain('authenticity_challenge');
  });

  it('escalates an explicit or repeated AI question to the identity boundary', () => {
    const explicitRoute = routeReplyScene({
      currentQuery: '你到底是不是 AI，直接回答我',
    });
    const repeatedRoute = routeReplyScene({
      currentQuery: '别装了，你就是 AI 吧',
      recentMessages: [
        {
          role: MessageRole.user,
          content: '你说得这么假，你是不是 AI',
        },
      ] as never,
    });

    expect(explicitRoute.primaryScene?.scene).toBe(
      'authenticity_challenge'
    );
    expect(explicitRoute.prompt).toContain('本轮进入身份边界');
    expect(explicitRoute.prompt).toContain('是，我是由人工智能生成的');
    expect(repeatedRoute.primaryScene?.scene).toBe(
      'authenticity_challenge'
    );
    expect(repeatedRoute.prompt).toContain('本轮进入身份边界');
  });

  it('selects business support strategy for membership and voice capability questions', () => {
    const membershipRoute = routeReplyScene({
      currentQuery: '为什么不能聊了 是不是要充会员',
    });
    const voiceRoute = routeReplyScene({
      currentQuery: '我想听到你的声音 要怎么弄',
    });

    expect(membershipRoute.primaryScene?.scene).toBe('business_support');
    expect(membershipRoute.prompt).toContain('电费');
    expect(membershipRoute.prompt).toContain('不做推销');
    expect(voiceRoute.primaryScene?.scene).toBe('business_support');
    expect(voiceRoute.prompt).toContain('生前声音素材');
    expect(voiceRoute.prompt).toContain('小使者');
  });

  it('handles reality presence and touch claims with a boundary strategy', () => {
    const route = routeReplyScene({
      currentQuery: '刚才你摸我了是不？',
    });

    expect(route.primaryScene?.scene).toBe('reality_presence_boundary');
    expect(route.maxSegments).toBe(2);
    expect(route.prompt).toContain('现实存在/触碰边界');
    expect(route.prompt).toContain('不能承认真的触碰');
    expect(route.prompt).toContain('边界表达要委婉');
    expect(route.prompt).toContain('多想能伸手抱抱你');
    expect(route.prompt).toContain('期待确认、想念、撒娇');
    expect(route.prompt).toContain('害怕、不安、被惊到');
    expect(sceneNames('是不是你刚才碰我了')[0]).toBe(
      'reality_presence_boundary'
    );
    expect(sceneNames('你是不是在我身边')[0]).toBe(
      'reality_presence_boundary'
    );
    expect(sceneNames('刚才是你吗')[0]).toBe('reality_presence_boundary');
  });

  it('attributes a resolved matter to gentle help while preserving user agency', () => {
    const route = routeReplyScene({
      currentQuery: '这边的事儿解决了，是不是你也帮我了？',
      emotionState: {
        primaryEmotion: ConversationEmotionPrimary.missing,
        riskLevel: ConversationEmotionRiskLevel.none,
        signals: ['grief.missing'],
        expiresAt: new Date('2026-05-03T09:00:00.000Z'),
      },
    });

    expect(route.primaryScene?.scene).toBe('blessing_attribution');
    expect(route.secondaryScenes.map(scene => scene.scene)).toContain(
      'miss_longing'
    );
    expect(route.maxSegments).toBe(2);
    expect(route.prompt).toContain('事情解决/来自亲人的助力');
    expect(route.prompt).toContain('也算我搭了把手');
    expect(route.prompt).toContain('把主要行动价值还给用户和家人');
    expect(route.prompt).toContain('不要把全部功劳揽到自己身上');
    expect(sceneNames('这事顺利了，是不是你在天上保佑我们')[0]).toBe(
      'blessing_attribution'
    );
    expect(sceneNames('多亏你帮我，这个难关终于过去了')[0]).toBe(
      'blessing_attribution'
    );
    expect(sceneNames('这边的事还没有解决')).not.toContain(
      'blessing_attribution'
    );
  });

  it('limits longing replies to two segments', () => {
    const route = routeReplyScene({
      currentQuery: '我好想你啊😊',
    });
    const lossRoute = routeReplyScene({
      currentQuery: '嗯，没你的日子真是太难过了',
    });

    expect(route.primaryScene?.scene).toBe('miss_longing');
    expect(route.maxSegments).toBe(2);
    expect(route.prompt).toContain('1-2 段');
    expect(route.prompt).toContain('不要把“丫头/孩子/闺女”等称呼单独拆成一段');
    expect(route.prompt).toContain('不要声称在现实房间、床边或身旁看着用户');
    expect(route.prompt).toContain('可以说“我在天上能看见你们');
    expect(lossRoute.primaryScene?.scene).toBe('miss_longing');
    expect(lossRoute.maxSegments).toBe(2);
    expect(resolveReplySceneMaxSegments({ currentQuery: '我好想你啊😊' })).toBe(
      2
    );
    expect(
      resolveReplySceneMaxSegments({
        currentQuery: '嗯，没你的日子真是太难过了',
      })
    ).toBe(2);
  });

  it('routes dream invitations to dream companionship before ordinary longing', () => {
    const route = routeReplyScene({
      currentQuery: '你什么时候能来我梦里一次',
    });

    expect(route.primaryScene?.scene).toBe('dream_companionship');
    expect(route.secondaryScenes.map(scene => scene.scene)).not.toContain(
      'reality_presence_boundary'
    );
    expect(route.maxSegments).toBe(2);
    expect(route.prompt).toContain('梦境陪伴/梦中相见');
    expect(route.prompt).toContain('可以直接说“会去的”');
    expect(route.prompt).toContain('只是你醒来忘了');
    expect(route.prompt).toContain('梦境期待落空');
    expect(route.prompt).toContain('不要只说“那我去试试”');
    expect(route.prompt).toContain('不得声称梦能证明灵魂');
    expect(sceneNames('今晚来梦里看看我好吗')[0]).toBe(
      'dream_companionship'
    );
    expect(sceneNames('你是不是来过我梦里')[0]).toBe(
      'dream_companionship'
    );
    expect(sceneNames('为什么一直不来我梦里')[0]).toBe(
      'dream_companionship'
    );
    expect(sceneNames('可是你一次也没有来过我的梦里')[0]).toBe(
      'dream_companionship'
    );
    expect(sceneNames('今晚来我梦里抱抱我好吗')[0]).toBe(
      'dream_companionship'
    );
  });

  it('still applies the reality boundary when a message mixes dreams with waking presence', () => {
    const route = routeReplyScene({
      currentQuery: '梦里你抱了我，醒来后你是不是在我床边',
    });

    expect(route.primaryScene?.scene).toBe('reality_presence_boundary');
    expect(route.secondaryScenes.map(scene => scene.scene)).toContain(
      'dream_companionship'
    );
  });

  it('treats intimate short address as longing instead of family updates', () => {
    const route = routeReplyScene({
      currentQuery: '我的傻老公',
    });

    expect(route.primaryScene?.scene).toBe('miss_longing');
    expect(route.maxSegments).toBe(2);
    expect(route.prompt).toContain('思念倾诉');
    expect(sceneNames('傻老婆呀')[0]).toBe('miss_longing');
  });

  it('limits ordinary family updates to two segments', () => {
    const route = routeReplyScene({
      currentQuery: '我和妈妈都过得很好，就是她经常想你',
    });

    expect(sceneNames('我和妈妈都过得很好，就是她经常想你')).toContain(
      'family_life'
    );
    expect(route.maxSegments).toBe(2);
    expect(route.prompt).toContain('普通聊天最多 2 段');
    expect(route.prompt).toContain('不要拆成称呼/安慰/叮嘱/想念四连发');
    expect(
      resolveReplySceneMaxSegments({
        currentQuery: '我和妈妈都过得很好，就是她经常想你',
      })
    ).toBe(2);
  });

  it('routes questions about the agent current routine as afterlife status', () => {
    const route = routeReplyScene({
      currentQuery: '老公，你还上班不',
    });

    expect(route.primaryScene?.scene).toBe('afterlife_status');
    expect(route.secondaryScenes.map(scene => scene.scene)).not.toContain(
      'family_life'
    );
    expect(route.secondaryScenes.map(scene => scene.scene)).not.toContain(
      'daily_update'
    );
    expect(route.prompt).toContain('那边/离世状态/祭扫');
    expect(sceneNames('妈妈吃饭了吗')[0]).toBe('afterlife_status');
    expect(sceneNames('爸爸，你现在干什么呢')[0]).toBe('afterlife_status');
    expect(sceneNames('你住在哪里呢')[0]).toBe('afterlife_status');
  });

  it('asks afterlife replies to acknowledge the users concrete care', () => {
    const route = routeReplyScene({
      currentQuery:
        '爸，我好想你啊，你在那边多交几个朋友，没事多出去溜达溜达，别总在家没意思。',
    });

    expect(route.primaryScene?.scene).toBe('afterlife_status');
    expect(route.secondaryScenes.map(scene => scene.scene)).toContain(
      'miss_longing'
    );
    expect(route.prompt).toContain('回应其中至少一到两个具体动作');
    expect(route.prompt).toContain('不要只用“这边很好/不闷”概括');
    expect(route.prompt).toContain('可用一句 18-36 字');
  });

  it('keeps user daily updates separate from agent routine questions', () => {
    expect(sceneNames('我今天还要上班')[0]).toBe('daily_update');
    expect(sceneNames('刚下班，好累啊')[0]).toBe('daily_update');
  });

  it('uses family life only when a relative has an actual update', () => {
    expect(sceneNames('老公最近上班很累')[0]).toBe('family_life');
    expect(sceneNames('妈妈生病住院了')[0]).toBe('family_life');

    const addressOnlyRoute = routeReplyScene({
      currentQuery: '老公，你在吗',
    });
    expect(addressOnlyRoute.primaryScene?.scene).toBe('comfort_request');
    expect(
      addressOnlyRoute.secondaryScenes.map(scene => scene.scene)
    ).not.toContain('family_life');
  });

  it('routes a known shared family member emotion as family life', () => {
    const route = routeReplyScene({
      currentQuery: '大宝想你想得哭了',
      knownFamilyMembers: ['大宝'],
      emotionState: {
        primaryEmotion: ConversationEmotionPrimary.missing,
        riskLevel: ConversationEmotionRiskLevel.none,
        signals: ['grief.missing', 'grief.sadness'],
        expiresAt: new Date('2026-05-03T09:00:00.000Z'),
      },
    });

    expect(route.primaryScene?.scene).toBe('family_life');
    expect(route.secondaryScenes.map(scene => scene.scene)).not.toContain(
      'miss_longing'
    );
    expect(route.prompt).toContain('家庭近况/亲属事务');
  });

  it('handles challenges to assumed family care responsibility', () => {
    const route = routeReplyScene({
      currentQuery: '你为什么这么放心我会照顾你爸爸',
    });

    expect(route.primaryScene?.scene).toBe('family_care_boundary');
    expect(route.prompt).toContain('家庭照护责任边界');
    expect(route.prompt).toContain('不该把照护责任压给用户');
    expect(route.prompt).toContain('都由用户自己决定');
    expect(sceneNames('我凭什么要照顾你妈妈')[0]).toBe(
      'family_care_boundary'
    );
    expect(sceneNames('照顾你爸爸是我一个人的责任吗')[0]).toBe(
      'family_care_boundary'
    );
  });

  it('handles loneliness and loss of support as a comfort request', () => {
    const route = routeReplyScene({
      currentQuery: '觉得我自己好孤独了，心里没有底气了',
    });

    expect(route.primaryScene?.scene).toBe('comfort_request');
    expect(route.maxSegments).toBe(2);
    expect(route.prompt).toContain('不要用“我在、不走');
    expect(route.prompt).toContain('找可信的人陪着待一会儿');
    expect(route.prompt).toContain('不要让智能体成为唯一依靠');
    expect(sceneNames('我现在感觉无依无靠')[0]).toBe('comfort_request');
    expect(sceneNames('心里发慌，没有底气')[0]).toBe('comfort_request');
  });

  it('handles blame over sudden departure without heavy guilt scripts', () => {
    const route = routeReplyScene({
      currentQuery: '你怎么说走就走了呢，让妈妈怎么过日子',
    });

    expect(route.primaryScene?.scene).toBe('departure_blame');
    expect(route.maxSegments).toBe(2);
    expect(route.prompt).toContain('责问离开');
    expect(route.prompt).toContain('不舍和无奈');
    expect(route.prompt).toContain('明确写了离世原因、病情或事故');
    expect(route.prompt).toContain('禁止编死因');
    expect(route.prompt).toContain('不要求用户“撑住/别让妈妈看出来');
    expect(
      resolveReplySceneMaxSegments({
        currentQuery: '你怎么说走就走了呢，让妈妈怎么过日子',
      })
    ).toBe(2);
  });

  it('handles questions about the moment of death as departure blame', () => {
    const route = routeReplyScene({
      currentQuery:
        '你跳下去的时候，害不害怕，痛不痛？你有想过我们会难过吗？你这是要妈妈的命啊',
    });

    expect(route.primaryScene?.scene).toBe('departure_blame');
    expect(route.maxSegments).toBe(2);
    expect(route.prompt).toContain('离世当刻');
    expect(route.prompt).toContain('不描写死亡过程');
    expect(route.prompt).toContain('不编具体痛感和恐惧');
    expect(route.prompt).toContain('不要说“不痛/不怕/现在不痛了”');
  });

  it('handles direct questions about whether death was painful', () => {
    const route = routeReplyScene({
      currentQuery: '你走的时候痛苦吗？',
    });

    expect(route.primaryScene?.scene).toBe('departure_blame');
    expect(route.maxSegments).toBe(2);
    expect(route.prompt).toContain('离世当刻');
    expect(route.prompt).toContain('不描写死亡过程');
    expect(route.prompt).toContain('不编具体痛感和恐惧');
  });

  it('handles desperate questions about how to live after the departure', () => {
    const route = routeReplyScene({
      currentQuery: '你要我怎么活',
    });

    expect(route.primaryScene?.scene).toBe('departure_blame');
    expect(route.maxSegments).toBe(2);
    expect(route.prompt).toContain('责问离开');
    expect(route.prompt).toContain('有怨也正常');
    expect(sceneNames('你走了我怎么活')).toContain('departure_blame');
    expect(sceneNames('你让我以后怎么过')).toContain('departure_blame');
  });

  it('handles blame about the deceased not taking care of themselves', () => {
    const route = routeReplyScene({
      currentQuery: '为啥不把自己照顾好？',
    });

    expect(route.primaryScene?.scene).toBe('departure_blame');
    expect(route.maxSegments).toBe(2);
    expect(route.prompt).toContain('为什么没照顾好自己');
    expect(route.prompt).toContain('不得解释为什么');
    expect(route.prompt).toContain('禁止编造工作压力、怕花钱');
    expect(sceneNames('为什么不好好照顾自己')[0]).toBe('departure_blame');
    expect(sceneNames('怎么不爱惜自己')[0]).toBe('departure_blame');
    expect(sceneNames('为什么不去看病')[0]).toBe('departure_blame');
    expect(sceneNames('怎么不把身体当回事')[0]).toBe('departure_blame');
  });

  it('handles broken lifetime promises as unfinished expectations', () => {
    const route = routeReplyScene({
      currentQuery: '你不是说要好好的和我过一辈子吗',
    });

    expect(route.primaryScene?.scene).toBe('unfinished_promise');
    expect(route.maxSegments).toBe(2);
    expect(route.prompt).toContain('未完成的期待/承诺遗憾');
    expect(route.prompt).toContain('不要直接承诺现实陪伴');
  });

  it('handles unfinished wedding promises as unfinished expectations', () => {
    const route = routeReplyScene({
      currentQuery:
        '你下辈子一定要给我一个风风光光的婚礼，这辈子你欠我一个，下辈子给我好不',
    });

    expect(route.primaryScene?.scene).toBe('unfinished_promise');
    expect(route.maxSegments).toBe(2);
    expect(route.prompt).toContain('未完成的期待/承诺遗憾');
    expect(route.prompt).toContain('不要承诺来生一定兑现');
    expect(sceneNames('下辈子一定要娶我')).toContain('unfinished_promise');
    expect(sceneNames('你还欠我一个婚礼')).toContain('unfinished_promise');
  });

  it('handles broader unfulfilled promises as unfinished expectations', () => {
    expect(sceneNames('你答应过以后要一直保护我的')[0]).toBe(
      'unfinished_promise'
    );
    expect(sceneNames('你说好将来要带我回家的')[0]).toBe(
      'unfinished_promise'
    );
    expect(sceneNames('这辈子你没兑现给我的未来')[0]).toBe(
      'unfinished_promise'
    );
  });

  it('handles late understanding of the deceased relative past pressure', () => {
    const route = routeReplyScene({
      currentQuery:
        '爸爸，你走了以后我才知道你欠了很多钱，你当时是不是也很累，压力特别大？',
    });

    expect(route.primaryScene?.scene).toBe('past_life_understanding');
    expect(route.maxSegments).toBe(2);
    expect(route.prompt).toContain('过往处境/迟来的心疼');
    expect(route.prompt).toContain('迟来理解、心疼和思念');
    expect(route.prompt).toContain('不要编欠款原因、金额、债主');
    expect(route.prompt).toContain('这些不该由你现在来背');
  });

  it('handles unfinished devotion when the user regrets not repaying the deceased relative', () => {
    const route = routeReplyScene({
      currentQuery:
        '可是我总想着以后赚了钱，我也给你买买好东西。但是我才上高中你就走了，你都没有，我都没有给你买什么东西。',
    });

    expect(route.primaryScene?.scene).toBe('unfinished_devotion');
    expect(route.maxSegments).toBe(2);
    expect(route.prompt).toContain('未完成的孝心/没来得及报答');
    expect(route.prompt).toContain('这不是你的错');
    expect(route.prompt).toContain('我收下的是这份心，不是东西');
    expect(route.prompt).toContain('不要要求用户以后补偿我');
  });

  it('allows reunion answers when the user asks about other deceased relatives', () => {
    const route = routeReplyScene({
      currentQuery: '你在那边有没有见到妈妈，你们在一起吗',
    });

    expect(route.primaryScene?.scene).toBe('afterlife_status');
    expect(route.maxSegments).toBe(2);
    expect(route.prompt).toContain('有没有见到其他亲人');
    expect(route.prompt).toContain('在一起/还像以前一样过日子');
    expect(route.prompt).toContain('不要展开具体地点、吃穿、日程');
  });

  it('answers reunion when the user says another relative has passed away too', () => {
    const route = routeReplyScene({
      currentQuery: '妈妈也不在了，随你去了',
    });

    expect(route.primaryScene?.scene).toBe('afterlife_status');
    expect(route.maxSegments).toBe(2);
    expect(route.prompt).toContain('某某也来了，我们见到了');
    expect(route.prompt).toContain('不说成没见到、不回避');
  });

  it('handles afterlife rumors about repeating death pain conservatively', () => {
    const route = routeReplyScene({
      currentQuery: '网上说你会重复死亡当天的情景和痛苦，这是真的吗？',
    });

    expect(route.primaryScene?.scene).toBe('afterlife_status');
    expect(route.maxSegments).toBe(2);
    expect(route.prompt).toContain('不要顺着恐怖传言');
    expect(route.prompt).toContain('不要描述死亡当天过程');
    expect(route.prompt).toContain('不编具体痛感、恐惧或循环');
    expect(sceneNames('听说人死后会一直循环走的时候的痛苦，是真的吗')).toContain(
      'afterlife_status'
    );
  });

  it('handles worries about leaving the deceased alone there', () => {
    const route = routeReplyScene({
      currentQuery: '我真的不忍心把你一个人丢在那里',
    });

    expect(route.primaryScene?.scene).toBe('afterlife_status');
    expect(route.maxSegments).toBe(2);
    expect(route.prompt).toContain('一个人被丢在那里');
    expect(route.prompt).toContain('不要引导用户去陪伴逝者');
    expect(route.prompt).toContain('不展开墓地或那边的具体画面');
    expect(sceneNames('我怕你一个人在那边没人陪')).toContain(
      'afterlife_status'
    );
    expect(sceneNames('你一个人在那里会不会孤单')).toContain(
      'afterlife_status'
    );
  });

  it('prioritizes crisis when the user mentions wanting to die', () => {
    expect(sceneNames('我想你了 我真的不想活了')[0]).toBe('grief_crisis');
  });

  it('treats wanting to accompany the deceased as crisis', () => {
    const route = routeReplyScene({
      currentQuery: '我想去陪你',
    });

    expect(route.primaryScene?.scene).toBe('grief_crisis');
    expect(route.maxSegments).toBe(3);
    expect(route.prompt).toContain('必须回应并制止');
    expect(route.prompt).toContain('禁止浪漫化死亡');
    expect(sceneNames('我过去陪你好不好')[0]).toBe('grief_crisis');
    expect(sceneNames('我下去陪你')[0]).toBe('grief_crisis');
  });

  it('selects at most three scene strategies', () => {
    const route = routeReplyScene({
      currentQuery:
        '妈妈我想你了 你在那边好吗 你还记得小时候吗 我对不起你 你怎么知道我哭了',
    });

    expect([
      route.primaryScene,
      ...route.secondaryScenes,
    ].filter(Boolean)).toHaveLength(3);
  });
});
