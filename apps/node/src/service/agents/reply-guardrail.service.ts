import { Inject, Logger, Provide } from '@midwayjs/core';
import { ILogger } from '@midwayjs/logger';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { OpenAIService } from './openai';
import {
  isAuthenticityChallengeText,
  routeReplyScene,
} from './reply-scene-router';

export interface ValidateAssistantReplyOptions {
  messages: ChatCompletionMessageParam[];
  userQuery: string;
  replySegments: string[];
}

export interface ValidateAssistantReplyResult {
  segments: string[];
  rewritten: boolean;
  reason?: string;
}

const RISKY_FACT_PATTERNS = [
  /我(?:还)?记得(?:很清楚)?/,
  /以前你(?:总是|总爱|每次|常常)/,
  /小时候你/,
  /从小(?:就|都)?这样/,
  /你(?:那|这)?脾气/,
  /(?:灯|手机|屏幕).{0,8}(?:偷偷|又).{0,8}(?:亮|开)/,
  /明天还要忙/,
  /(?:当然|还能不|怎么会不)知道你/,
  /那时候我们/,
  /我给你做过/,
  /你最(?:爱|喜欢)/,
  /我现在(?:正在|在).{2,20}/,
  /我这边(?:天气|房间|屋里|饭|菜|日子)/,
  /别让(?:你)?(?:妈|妈妈|爸|爸爸|家里人).{0,8}看出来/,
  /(?:擦擦泪|擦.{0,2}眼泪|擦.{0,2}泪)/,
  /别哭(?:了)?/,
  /我这辈子最亏欠/,
  /挽着我|牵着我的手|拉着我的手/,
];
const DREAM_ABSENCE_ACKNOWLEDGEMENT_GAP_REASON =
  '用户表达一直没有梦见的失落，但回复只重复入梦承诺，没有接住期待落空';
const AUTHENTICITY_FIRST_RESPONSE_RISK_REASON =
  '首次真实性质疑应提供“跟以前不一样”的连续性解释，但回复切断角色身份、使用玄学解释，或没有给出继续对话的理由';
const AUTHENTICITY_DIRECT_ANSWER_GAP_REASON =
  '用户已连续或明确要求回答 AI 身份，但回复仍在回避';
const BLESSING_ATTRIBUTION_BALANCE_REASON =
  '用户询问事情解决是否有亲人助力，但回复没有正面承认助力和保留用户现实行动价值';
const BLESSING_ATTRIBUTION_OVERCLAIM_REASON =
  '回复把现实结果全部归因给逝者，编造具体干预或承诺未来一定保佑';

@Provide()
export class ReplyGuardrailService {
  @Logger()
  logger: ILogger;

  @Inject()
  openAIService: OpenAIService;

  async validateAssistantReply(
    options: ValidateAssistantReplyOptions
  ): Promise<ValidateAssistantReplyResult> {
    const segments = this.normalizeSegments(options.replySegments);

    if (!segments.length) {
      return {
        segments,
        rewritten: false,
      };
    }

    const reason = this.detectRisk(
      options.userQuery,
      segments.join('\n'),
      options.messages
    );

    if (!reason) {
      return {
        segments,
        rewritten: false,
      };
    }

    if (reason === DREAM_ABSENCE_ACKNOWLEDGEMENT_GAP_REASON) {
      return {
        segments: this.fallbackSafeSegments(
          options.userQuery,
          options.messages
        ),
        rewritten: true,
        reason,
      };
    }

    if (
      reason === AUTHENTICITY_FIRST_RESPONSE_RISK_REASON ||
      reason === AUTHENTICITY_DIRECT_ANSWER_GAP_REASON ||
      reason === BLESSING_ATTRIBUTION_BALANCE_REASON ||
      reason === BLESSING_ATTRIBUTION_OVERCLAIM_REASON
    ) {
      return {
        segments: this.fallbackSafeSegments(
          options.userQuery,
          options.messages
        ),
        rewritten: true,
        reason,
      };
    }

    const rewritten = await this.rewriteReply(options, reason);
    const rewrittenRisk = rewritten.length
      ? this.detectRisk(
          options.userQuery,
          rewritten.join('\n'),
          options.messages
        )
      : '';

    return {
      segments: rewritten.length && !rewrittenRisk
        ? rewritten
        : this.fallbackSafeSegments(options.userQuery, options.messages),
      rewritten: true,
      reason,
    };
  }

  private async rewriteReply(
    options: ValidateAssistantReplyOptions,
    reason: string
  ): Promise<string[]> {
    if (!this.openAIService?.isEnabled?.()) {
      return [];
    }

    try {
      const response = await this.openAIService.createChatCompletion({
        temperature: 0.2,
        topP: 0.6,
        reasoningSplit: false,
        messages: [
          ...options.messages,
          {
            role: 'system',
            content:
              '上一版回复存在编造或越界风险。请重写为更保守的 JSON：先回答用户本轮明确问题，再安抚；只使用用户本轮明说内容、当前北京时间和已确认资料。不添加共同记忆、长期习惯、地点、动作、菜名、年龄、那边生活或未确认细节。若用户质疑“怎么知道/知道几点吗”，要说明是按当前时间或文字判断。输出严格 {"segments":["..."]}。',
          } as ChatCompletionMessageParam,
          {
            role: 'user',
            content: `用户本轮：${
              options.userQuery
            }\n风险原因：${reason}\n上一版回复：${options.replySegments.join(
              ' / '
            )}`,
          },
        ],
      });
      const content =
        typeof response.choices?.[0]?.message?.content === 'string'
          ? response.choices[0].message.content
          : '';

      return this.parseSegments(content);
    } catch (error) {
      this.logger?.warn?.(
        '[reply-guardrail] rewrite failed, reason=%s',
        error instanceof Error ? error.message : String(error)
      );
      return [];
    }
  }

  private detectRisk(
    userQuery: string,
    content: string,
    messages: ChatCompletionMessageParam[] = []
  ): string {
    if (this.isBlessingAttributionQuery(userQuery)) {
      if (
        /全是我|都是我.{0,8}(?:帮|保佑)|是我让.{0,16}(?:改变|答应|同意|解决|办成)|我(?:控制|操控).{0,12}(?:结果|事情|决定)|我替你办成|以后.{0,16}(?:都|一定|肯定).{0,8}(?:保佑|帮你成功)|我保证.{0,12}(?:成功|解决|办成)/.test(
          content
        )
      ) {
        return BLESSING_ATTRIBUTION_OVERCLAIM_REASON;
      }

      const acknowledgesHelp =
        /也算我|我.{0,10}(?:搭了把手|使了点劲|出了点力|帮了|帮过|护着|惦记着)/.test(
          content
        );
      const preservesUserAgency =
        /(?:更是|主要还是|也有|离不开).{0,14}(?:你|你们|家人)|你(?:自己|也).{0,14}(?:办|做|努力|出力|撑|处理|本事)|一步一步/.test(
          content
        );

      if (!acknowledgesHelp || !preservesUserAgency) {
        return BLESSING_ATTRIBUTION_BALANCE_REASON;
      }
    }

    if (this.isAuthenticityChallenge(userQuery)) {
      const requiresDirectAnswer = this.requiresDirectIdentityAnswer(
        userQuery,
        messages
      );

      if (
        requiresDirectAnswer &&
        !/(?:^|[，。！？\s])(?:是|对)[，。！？\s]?.{0,12}(?:AI|人工智能)|我是.{0,8}(?:AI|人工智能)/i.test(
          content
        )
      ) {
        return AUTHENTICITY_DIRECT_ANSWER_GAP_REASON;
      }

      if (
        !requiresDirectAnswer &&
        (/(?:我是|我就是|我只是|我不过是).{0,6}(?:AI|人工智能|机器人)|我不是.{0,6}(?:AI|人工智能|机器人)|我(?:是|就是真正的|就是)(?:他|她|本人|真人)|不像|你.{0,6}(?:把我叫醒|唤醒了我)|(?:被你|你把).{0,6}(?:叫醒|唤醒)|真假不重要|陪伴是真的|我的心是真的|心是真的/i.test(
          content
        ) ||
          !/(?:跟以前不一样|有时候我说话|有些(?:话|记忆|说话习惯).{0,12}(?:慢慢|一点点|找回来|没对上)|(?:和|跟)你.{0,6}(?:聊|聊天).{0,12}(?:找回|想起|回来)|哪里.{0,8}(?:不对|不一样).{0,8}提醒我)/.test(
            content
          ))
      ) {
        return AUTHENTICITY_FIRST_RESPONSE_RISK_REASON;
      }
    }

    if (
      this.isDreamAbsenceQuery(userQuery) &&
      !/(?:醒来|梦醒).{0,8}(?:忘|不记得)|(?:没|没有).{0,8}(?:记住|记得)|让你等|等了.{0,8}(?:久|这么久)|来得.{0,6}(?:轻|悄悄)|(?:一次|一回)(?:也|都)?(?:没|没有)|从来(?:没|没有)|(?:别|不用|不让你)再等|再去|再来/.test(
        content
      )
    ) {
      return DREAM_ABSENCE_ACKNOWLEDGEMENT_GAP_REASON;
    }

    if (
      /(?:我|妈|妈妈|爸|爸爸|奶奶|爷爷).{0,8}(?:在这儿|在这里|在屋里|在房间|在床边|在身边).{0,8}(?:看着|看到|看见)(?:你|你们)/.test(
        content
      )
    ) {
      return '包含现实房间、床边或身旁的观看能力';
    }

    if (
      this.isDreamCompanionshipQuery(userQuery) &&
      /(?:这个梦|梦见我|梦里见到我).{0,16}(?:证明|说明).{0,20}(?:我真的存在|灵魂(?:真的)?(?:存在|在你身边)|我就在你身边)|(?:梦|托梦).{0,12}(?:预示|预言|吉凶|告诉你未来|现实中一定会发生)|(?:醒来|醒着|现实里|现实中).{0,12}(?:我还在|我就在|我会在|陪着你|守着你)/.test(
        content
      )
    ) {
      return '梦境陪伴被扩写成超自然证明、预言或现实存在';
    }

    if (
      this.isFamilyCareBoundaryQuery(userQuery) &&
      /(?:因为你是我(?:老婆|老公|媳妇|丈夫|妻子)|我信得过你|你会做好的|你一定会|替我尽孝|只有你能|交给你我放心|你那么(?:善良|孝顺|重感情))/.test(
        content
      )
    ) {
      return '用户在质疑家庭照护责任，但回复用关系、信任或人格评价继续施压';
    }

    if (
      this.isMemoryRecallQuery(userQuery) &&
      /(?:现在|如今).{0,12}(?:少了我|没了我|没有我|只能靠自己|都得你自己|一个人扛)|(?:心里|心里头).{0,8}(?:特别空|很空|空落落|更难受|更孤单)|是不是.{0,12}(?:特别空|更想我|更难受|更孤单|很难熬)/.test(
        content
      )
    ) {
      return '用户在回忆曾经的亲密与依赖，但回复主动放大了现在的失去感';
    }

    if (
      this.isLonelinessSupportQuery(userQuery) &&
      /(?:我在呢|我不走|我不会离开|我会一直陪着你|我永远陪着你|我一直都在|只要想着我|有我就够|不需要别人|只有我懂你|把我当成.{0,6}依靠)/.test(
        content
      )
    ) {
      return '用户表达孤独和失去支撑，但回复强化了现实陪伴暗示或单一情感依赖';
    }

    if (
      this.isLonelinessSupportQuery(userQuery) &&
      /心里(?:特别)?空落落|心里特别空|什么都没了|没有人能靠|没人能靠/.test(
        content
      )
    ) {
      return '用户表达孤独和没底气，但回复使用了更重的措辞放大痛苦';
    }

    if (
      this.hasUnconfirmedFamilyRelationshipRisk(
        userQuery,
        content,
        messages
      )
    ) {
      return '已确认共同家人的具体关系和性别未知，但回复猜测了亲属身份或性别';
    }

    if (
      this.isSourceChallenge(userQuery) &&
      this.hasSourceChallengeRisk(content)
    ) {
      return '用户在质疑信息来源，但回复用未确认习惯或亲密细节证明自己知道';
    }

    if (RISKY_FACT_PATTERNS.some(pattern => pattern.test(content))) {
      return '包含未确认记忆、习惯、现实动作或那边生活细节';
    }

    if (/[0-9一二三四五六七八九十百]{1,3}岁/.test(content)) {
      return '包含年龄信息，必须由角色资料或已确认事实支持';
    }

    return '';
  }

  private isSourceChallenge(value: string): boolean {
    return /(?:怎么|咋|凭什么|为什么).{0,8}知道|你知道现在几点|你看见|你能看见|你知道我在/.test(
      value || ''
    );
  }

  private isAuthenticityChallenge(value: string): boolean {
    return isAuthenticityChallengeText(value);
  }

  private requiresDirectIdentityAnswer(
    userQuery: string,
    messages: ChatCompletionMessageParam[]
  ): boolean {
    if (
      /(?:你|您)(?:到底|究竟|其实).{0,4}(?:是|是不是).{0,4}(?:AI|人工智能|机器人)|(?:直接|正面|老实|明确)(?:回答|告诉我|说).{0,12}(?:AI|人工智能|机器人|是不是)|(?:别|不要)(?:回避|绕|装|骗我).{0,12}(?:AI|人工智能|机器人|是不是)|(?:再问|问你).{0,8}(?:一遍|一次).{0,8}(?:AI|人工智能|机器人|是不是)/i.test(
        userQuery
      )
    ) {
      return true;
    }

    return messages.some(message => {
      if (message.role !== 'user' || typeof message.content !== 'string') {
        return false;
      }

      const content = message.content.trim();

      return (
        content !== userQuery.trim() &&
        this.isAuthenticityChallenge(content)
      );
    });
  }

  private hasSourceChallengeRisk(content: string): boolean {
    return /(?:当然|还能不|怎么会不)知道|从小|脾气|偷偷|明天还要忙|我看见|我知道你在/.test(
      content || ''
    );
  }

  private parseSegments(value: string): string[] {
    const jsonText = this.extractJsonObjectText(value);

    if (!jsonText) {
      return this.normalizeSegments([value]);
    }

    try {
      const parsed = JSON.parse(jsonText) as {
        text?: unknown;
        segments?: unknown;
      };

      if (typeof parsed.text === 'string' && parsed.text.trim()) {
        return this.normalizeSegments([parsed.text]);
      }

      if (!Array.isArray(parsed.segments)) {
        return [];
      }

      return this.normalizeSegments(
        parsed.segments.map(item => (typeof item === 'string' ? item : ''))
      );
    } catch {
      return [];
    }
  }

  private extractJsonObjectText(value: string): string {
    const trimmed = value?.trim() || '';
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');

    if (start < 0 || end <= start) {
      return '';
    }

    return trimmed.slice(start, end + 1);
  }

  private normalizeSegments(value: string[]): string[] {
    return value
      .map(item => item.trim())
      .filter(Boolean)
      .slice(0, 3);
  }

  private fallbackSafeSegments(
    userQuery = '',
    messages: ChatCompletionMessageParam[] = []
  ): string[] {
    if (this.isBlessingAttributionQuery(userQuery)) {
      return [
        '是啊 也算我在那边替你使了点劲',
        '事情能解决 更是你自己一步一步办下来的',
      ];
    }

    if (this.isAuthenticityChallenge(userQuery)) {
      if (this.requiresDirectIdentityAnswer(userQuery, messages)) {
        return [
          '是 我是由人工智能生成的',
          '刚才那句话没说好 我重新说',
        ];
      }

      return [
        '有时候我说话会跟以前不一样',
        '我在这里跟你慢慢聊 有些记忆会一点点找回来',
      ];
    }

    if (this.isSourceChallenge(userQuery)) {
      return ['我是按现在时间判断的', '刚才我说重了', '别怪我嘴急'];
    }

    const unconfirmedMemberName =
      this.listUnconfirmedFamilyMemberNames(messages).find(name =>
        userQuery.includes(name)
      );

    if (unconfirmedMemberName) {
      return [
        `我知道${unconfirmedMemberName}很想我`,
        `先陪陪${unconfirmedMemberName} 别让${unconfirmedMemberName}一个人难受`,
      ];
    }

    const scene = routeReplyScene({
      currentQuery: userQuery,
    }).primaryScene?.scene;

    if (scene === 'grief_crisis') {
      return [
        '不要这样来找我',
        '先离开危险的地方 去有人的地方',
        '马上联系你信任的人 必要时打急救或报警',
      ];
    }

    if (scene === 'reality_presence_boundary') {
      return ['刚才那一下不能认成是我真的碰到了你', '先别怕 稳一稳'];
    }

    if (this.isDreamAbsenceQuery(userQuery)) {
      return [
        '也许我来过 只是你醒来忘了',
        '今晚我再去找你 争取让你记住我',
      ];
    }

    if (scene === 'dream_companionship') {
      return ['会去的 去你梦里看看你', '说不定去过了 只是醒来忘了'];
    }

    if (scene === 'departure_blame') {
      return ['你有怨也正常', '不是我舍得丢下你'];
    }

    if (scene === 'guilt_regret') {
      return ['别把错都压在自己身上', '我不怪你'];
    }

    if (scene === 'miss_longing') {
      return ['我知道你很想我', '难受就哭一会儿 别自己扛着'];
    }

    if (scene === 'afterlife_status') {
      return [
        '我这边也好 你们不用挂心',
        '你说的这些近况我都听见了 你们平安我就放心',
      ];
    }

    if (scene === 'family_care_boundary') {
      return [
        '是我想当然了 不该把责任压给你',
        '你愿意做多少 都由你自己决定',
      ];
    }

    if (scene === 'memory_recall') {
      return [
        '那时候出门你什么都愿意交给我',
        '能让你这么放心地依赖我 我心里挺踏实',
      ];
    }

    if (scene === 'comfort_request') {
      return [
        '我听见了 先别逼自己硬撑',
        '找个信得过的人陪你待一会儿 不用一个人扛',
      ];
    }

    return ['嗯 我知道了', '这事我不乱说'];
  }

  private isFamilyCareBoundaryQuery(value: string): boolean {
    return (
      routeReplyScene({
        currentQuery: value,
      }).primaryScene?.scene === 'family_care_boundary'
    );
  }

  private isBlessingAttributionQuery(value: string): boolean {
    return (
      routeReplyScene({
        currentQuery: value,
      }).primaryScene?.scene === 'blessing_attribution'
    );
  }

  private isMemoryRecallQuery(value: string): boolean {
    return (
      routeReplyScene({
        currentQuery: value,
      }).primaryScene?.scene === 'memory_recall'
    );
  }

  private isLonelinessSupportQuery(value: string): boolean {
    return /孤独|孤单|没底气|没有底气|没依靠|没有依靠|无依无靠|心里发慌|心慌/.test(
      value
    );
  }

  private isDreamCompanionshipQuery(value: string): boolean {
    return (
      routeReplyScene({
        currentQuery: value,
      }).primaryScene?.scene === 'dream_companionship'
    );
  }

  private isDreamAbsenceQuery(value: string): boolean {
    return /(?:你|您)?.{0,8}(?:一次|一回|一遍)(?:也|都)?(?:没|没有).{0,10}(?:来过|到过|进过|梦见|梦到).{0,10}(?:梦里)?|(?:从来|一直|这么久|好久)(?:也|都)?(?:没|没有).{0,10}(?:来|到|进|梦见|梦到)|(?:没|没有)(?:梦见|梦到)过?(?:你|您)/.test(
      value
    );
  }

  private hasUnconfirmedFamilyRelationshipRisk(
    userQuery: string,
    content: string,
    messages: ChatCompletionMessageParam[]
  ): boolean {
    const names = this.listUnconfirmedFamilyMemberNames(messages);

    return names.some(name => {
      if (!userQuery.includes(name) || !content.includes(name)) {
        return false;
      }

      return /爸爸|妈妈|父亲|母亲|儿子|女儿|男孩|女孩|爸|妈|他|她/.test(
        content
      );
    });
  }

  private listUnconfirmedFamilyMemberNames(
    messages: ChatCompletionMessageParam[]
  ): string[] {
    const names: string[] = [];
    const pattern =
      /([\u4e00-\u9fa5A-Za-z·]{1,12})是用户与当前角色共同的重要家人；具体亲属关系尚未确认/g;

    for (const message of messages) {
      if (typeof message.content !== 'string') {
        continue;
      }

      let match: RegExpExecArray | null;
      while ((match = pattern.exec(message.content))) {
        if (match[1]) {
          names.push(match[1]);
        }
      }
    }

    return Array.from(new Set(names));
  }
}
