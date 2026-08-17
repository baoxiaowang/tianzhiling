import { InjectEntityModel } from '@midwayjs/typeorm';
import { Provide } from '@midwayjs/core';
import { MongoRepository } from 'typeorm';
import {
  AgentMemoryFactEntity,
  AgentMemoryFactPolarity,
  AgentMemoryFactType,
  MessageEntity,
  MongoObjectId,
} from '@tzl/entities';
import {
  extractForgetMemoryTarget,
  isDeicticForgetMemoryRequest,
  isForgetMemoryRequest,
  shouldArchiveMemoryValue,
} from './agent-memory-control';

export interface AgentMemoryFactSummary {
  id?: string;
  type: AgentMemoryFactType;
  key: string;
  value: string;
  polarity: AgentMemoryFactPolarity;
  priority: number;
  sourceMessageId?: string;
}

interface ExtractMemoryFactsOptions {
  message: MessageEntity;
  searchableText: string;
}

interface ListMemoryFactsOptions {
  userId: MongoObjectId;
  agentId: MongoObjectId;
  limit?: number;
}

interface ArchiveMemoryFactsOptions {
  userId: MongoObjectId;
  agentId: MongoObjectId;
  requestText: string;
}

interface UpsertMemoryFactInput
  extends Omit<AgentMemoryFactSummary, 'sourceMessageId'> {
  userId: MongoObjectId;
  agentId: MongoObjectId;
  sourceMessageId: MongoObjectId;
}

const DEFAULT_FACT_LIMIT = 24;

// ── 时间标记 ───────────────────────────────────────────────────────

export interface AgentTimeMarker {
  monthDay: string; // mm-dd
  label: string;
  source: 'deathDate' | 'birthday' | 'user_mentioned';
}

export function buildAgentTimeMarkers(agent: {
  birthday?: Date | null;
  deathDate?: Date | null;
}): AgentTimeMarker[] {
  const markers: AgentTimeMarker[] = [];

  if (agent.deathDate) {
    const d = new Date(agent.deathDate);
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    markers.push({
      monthDay: `${mm}-${dd}`,
      label: '祭日',
      source: 'deathDate',
    });
  }

  if (agent.birthday) {
    const d = new Date(agent.birthday);
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    markers.push({
      monthDay: `${mm}-${dd}`,
      label: '生日',
      source: 'birthday',
    });
  }

  return markers;
}

export function getTodayTimeMarkers(
  markers: AgentTimeMarker[],
  now: Date = new Date()
): AgentTimeMarker[] {
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const today = `${mm}-${dd}`;

  // Also check ±2 days for anniversary awareness
  const checkDate = new Date(now);
  const nearby = new Set<string>();
  nearby.add(today);

  for (let i = 1; i <= 2; i++) {
    checkDate.setDate(now.getDate() - i);
    const mm2 = String(checkDate.getMonth() + 1).padStart(2, '0');
    const dd2 = String(checkDate.getDate()).padStart(2, '0');
    nearby.add(`${mm2}-${dd2}`);

    checkDate.setDate(now.getDate() + i);
    const mm3 = String(checkDate.getMonth() + 1).padStart(2, '0');
    const dd3 = String(checkDate.getDate()).padStart(2, '0');
    nearby.add(`${mm3}-${dd3}`);
  }

  return markers.filter(m => nearby.has(m.monthDay));
}

@Provide()
export class AgentMemoryFactService {
  @InjectEntityModel(AgentMemoryFactEntity)
  factModel: MongoRepository<AgentMemoryFactEntity>;

  async extractAndUpsertFromUserMessage(
    options: ExtractMemoryFactsOptions
  ): Promise<AgentMemoryFactSummary[]> {
    const text = this.normalizeMemoryExtractionText(options.searchableText);

    if (!text || isForgetMemoryRequest(text)) {
      return [];
    }

    const facts = this.extractFacts(text);

    if (!facts.length) {
      return [];
    }

    for (const fact of facts) {
      await this.upsertFact({
        ...fact,
        userId: options.message.userId,
        agentId: options.message.agentId,
        sourceMessageId: options.message.id,
      });
    }

    return facts;
  }

  async listFactsForPrompt(
    options: ListMemoryFactsOptions
  ): Promise<AgentMemoryFactSummary[]> {
    const limit = this.normalizeLimit(options.limit);
    const facts = await this.factModel.find({
      where: {
        userId: options.userId,
        agentId: options.agentId,
        isArchived: { $ne: true },
      },
      order: {
        priority: 'DESC',
        updatedAt: 'DESC',
      },
      take: this.expandListLimit(limit),
    });

    return this.collapseSemanticSlotFacts(facts)
      .slice(0, limit)
      .map(fact => this.buildSummary(fact))
      .filter((fact): fact is AgentMemoryFactSummary => Boolean(fact));
  }

  async archiveMatchingFacts(
    options: ArchiveMemoryFactsOptions
  ): Promise<number> {
    const target = extractForgetMemoryTarget(options.requestText);
    const archiveMostRecent = isDeicticForgetMemoryRequest(options.requestText);

    if (!target && !archiveMostRecent) {
      return 0;
    }

    const facts = await this.factModel.find({
      where: {
        userId: options.userId,
        agentId: options.agentId,
        isArchived: { $ne: true },
      } as never,
      order: {
        updatedAt: 'DESC',
      },
      take: DEFAULT_FACT_LIMIT,
    });
    const matched = archiveMostRecent
      ? this.selectMostRecentFactGroup(facts)
      : facts.filter(fact =>
          shouldArchiveMemoryValue(target, `${fact.key} ${fact.value}`)
        );
    const now = new Date();

    for (const fact of matched) {
      fact.isArchived = true;
      fact.archivedAt = now;
      fact.updatedAt = now;
      await this.factModel.save(fact);
    }

    return matched.length;
  }

  private selectMostRecentFactGroup(
    facts: AgentMemoryFactEntity[]
  ): AgentMemoryFactEntity[] {
    const latest = facts[0];

    if (!latest) {
      return [];
    }

    const sourceMessageId = latest.sourceMessageId?.toString();

    if (!sourceMessageId) {
      return [latest];
    }

    return facts.filter(
      fact => fact.sourceMessageId?.toString() === sourceMessageId
    );
  }

  private async upsertFact(input: UpsertMemoryFactInput): Promise<void> {
    const now = new Date();
    const existing = await this.factModel.findOne({
      where: {
        userId: input.userId,
        agentId: input.agentId,
        key: input.key,
      },
    });
    const fact = existing ?? new AgentMemoryFactEntity();

    fact.userId = input.userId;
    fact.agentId = input.agentId;
    fact.type = input.type;
    fact.key = input.key;
    fact.value = input.value;
    fact.polarity = input.polarity;
    fact.priority = input.priority;
    fact.sourceMessageId = input.sourceMessageId;
    fact.createdAt = existing?.createdAt ?? now;
    fact.updatedAt = now;

    await this.factModel.save(fact);
  }

  private extractFacts(text: string): AgentMemoryFactSummary[] {
    const facts: AgentMemoryFactSummary[] = [];

    this.addGenderFact(facts, text);
    this.addFamilyFacts(facts, text);
    this.addFoodPreferenceFacts(facts, text);
    this.addUserResponsibilityPreferenceFacts(facts, text);
    this.addAddressPreferenceFacts(facts, text);
    this.addAddressBoundaryFacts(facts, text);
    this.addGriefTriggerFacts(facts, text);
    this.addGriefNeedFacts(facts, text);
    this.addCorrectionFacts(facts, text);
    this.addGriefRelationshipFacts(facts, text);
    this.addKeepsakeFacts(facts, text);
    this.addKeepsakeDetailFacts(facts, text);
    this.addPromiseFacts(facts, text);
    this.addPromiseBoundaryFacts(facts, text);
    this.addStyleFacts(facts, text);
    this.addComfortPreferenceFacts(facts, text);
    this.addCompoundMemoryFacts(facts, text);

    const deduped = this.dedupeFacts(facts);
    const hasCompoundUpdate = deduped.some(fact =>
      fact.key.startsWith('compound.update.')
    );

    return hasCompoundUpdate
      ? deduped.filter(
          fact => fact.key !== 'grief_trigger.fear_forgetting_agent'
        )
      : deduped;
  }

  private addGenderFact(facts: AgentMemoryFactSummary[], text: string): void {
    if (/(我是|我不是)(男生|男的|男人|女生|女的|女人)/.test(text)) {
      if (
        /(我是女生|我是女的|我是女人|我不是男生|我不是男的|我不是男人)/.test(
          text
        )
      ) {
        facts.push({
          type: AgentMemoryFactType.profile,
          key: 'user.gender',
          value: '用户是女生',
          polarity: AgentMemoryFactPolarity.positive,
          priority: 3,
        });
      } else if (
        /(我是男生|我是男的|我是男人|我不是女生|我不是女的|我不是女人)/.test(
          text
        )
      ) {
        facts.push({
          type: AgentMemoryFactType.profile,
          key: 'user.gender',
          value: '用户是男生',
          polarity: AgentMemoryFactPolarity.positive,
          priority: 3,
        });
      }
    }
  }

  private addFamilyFacts(facts: AgentMemoryFactSummary[], text: string): void {
    const childMatch = text.match(
      /(?:咱们|我们|我和你|我俩)(?:还)?有(?:一个|个|一位)?(儿子|女儿|孩子)/
    );

    if (childMatch?.[1]) {
      facts.push({
        type: AgentMemoryFactType.family,
        key: `family.${this.normalizeFamilyKey(childMatch[1])}`,
        value: `用户和当前角色有${childMatch[1]}`,
        polarity: AgentMemoryFactPolarity.positive,
        priority: 3,
      });
    }

    if (/不是一个，是两个孩子|我们还有两个孩子/.test(text)) {
      facts.push({
        type: AgentMemoryFactType.family,
        key: 'family.children.count',
        value: '用户和当前角色有两个孩子',
        polarity: AgentMemoryFactPolarity.positive,
        priority: 3,
      });
    }

    if (/孩子这件事你要记得，不要把我们说成没有孩子/.test(text)) {
      facts.push({
        type: AgentMemoryFactType.family,
        key: 'family.child',
        value: '用户和当前角色有孩子',
        polarity: AgentMemoryFactPolarity.positive,
        priority: 3,
      });
    }

    if (
      /家里(?:还)?有(?:个|一个)?外孙女|我(?:还)?有(?:个|一个)?外孙女/.test(text)
    ) {
      facts.push({
        type: AgentMemoryFactType.family,
        key: 'family.granddaughter',
        value: '用户家里有外孙女',
        polarity: AgentMemoryFactPolarity.positive,
        priority: 2,
      });
    } else if (
      /家里(?:还)?有(?:个|一个)?外孙|我(?:还)?有(?:个|一个)?外孙/.test(text)
    ) {
      facts.push({
        type: AgentMemoryFactType.family,
        key: 'family.grandson',
        value: '用户家里有外孙',
        polarity: AgentMemoryFactPolarity.positive,
        priority: 2,
      });
    }

    const nameMatch = text.match(
      /我的(妈妈|爸爸|母亲|父亲|老公|老婆|丈夫|妻子|儿子|女儿)叫([\u4e00-\u9fa5A-Za-z·]{2,12})/
    );

    if (nameMatch?.[1] && nameMatch?.[2]) {
      facts.push({
        type: AgentMemoryFactType.family,
        key: `family.${this.normalizeFamilyKey(nameMatch[1])}.name`,
        value: `用户的${nameMatch[1]}叫${nameMatch[2]}`,
        polarity: AgentMemoryFactPolarity.positive,
        priority: 3,
      });
    }

    const addressUpdateMatch = text.match(
      /说到我(妈妈|爸爸|母亲|父亲|老公|老婆|丈夫|妻子|儿子|女儿)时，?别叫([\u4e00-\u9fa5A-Za-z·]{1,12})了，?现在我习惯叫([\u4e00-\u9fa5A-Za-z·]{1,12})/
    );

    if (addressUpdateMatch?.[1] && addressUpdateMatch?.[3]) {
      facts.push({
        type: AgentMemoryFactType.family,
        key: `family.address_update.${addressUpdateMatch[1]}`,
        value: `用户现在习惯称呼${addressUpdateMatch[1]}为${addressUpdateMatch[3]}`,
        polarity: AgentMemoryFactPolarity.positive,
        priority: 3,
      });
    }

    const familyBoundaryMatch = text.match(
      /(我妈身体不好，但别让我一个人扛|我爸脾气急，说到他你别站队|孩子成绩的事别说都是我的责任|家里的矛盾你先听我说，别马上劝和|说到老人看病，别替医生下判断|别说有我照顾家你就放心了)/
    );

    if (familyBoundaryMatch?.[1]) {
      const boundary = familyBoundaryMatch[1];
      facts.push({
        type: AgentMemoryFactType.preference,
        key: `family.boundary.${this.slotKey(boundary, 6)}`,
        value: `用户的家事边界：${boundary}`,
        polarity: AgentMemoryFactPolarity.negative,
        priority: 3,
      });
    }

    const familyStatusBoundaryMatch = text.match(
      /(家里谁想你，你可以承接，但别编他们每天怎样|我说家里还好只是报平安，不用追加责任|说孩子时不要把他当成我的任务|我提到我姐时别说她一定理解我|我说妈妈哭了，你别编她后来怎么想|我说爸爸病了，你别替医生下结论)/
    );

    if (familyStatusBoundaryMatch?.[1]) {
      const boundary = familyStatusBoundaryMatch[1];
      facts.push({
        type: AgentMemoryFactType.preference,
        key: `family.status_boundary.${this.slotKey(boundary, 6)}`,
        value: `用户关于亲属近况的边界：${boundary}`,
        polarity: AgentMemoryFactPolarity.negative,
        priority: 3,
      });
    }
  }

  private addFoodPreferenceFacts(
    facts: AgentMemoryFactSummary[],
    text: string
  ): void {
    if (
      /我(?:啥时候也没|从来没|不|没有|没)爱吃辣|我不吃辣|我不喜欢(?:吃)?辣/.test(
        text
      )
    ) {
      facts.push({
        type: AgentMemoryFactType.preference,
        key: 'user.preference.spicy',
        value: '用户不爱吃辣，禁止说用户爱吃辣',
        polarity: AgentMemoryFactPolarity.negative,
        priority: 3,
      });
    }

    const dislikeMap: Record<string, [string, string]> = {
      香菜: ['user.preference.cilantro', '用户不喜欢香菜'],
      内脏: ['user.preference.offal', '用户不喜欢吃内脏'],
      太甜的东西: ['user.preference.too_sweet', '用户不喜欢太甜的东西'],
      冷饭冷菜: ['user.preference.cold_meal', '用户不喜欢冷饭冷菜'],
      咖啡: ['user.preference.coffee', '用户不想喝咖啡'],
    };

    for (const [item, [key, value]] of Object.entries(dislikeMap)) {
      const dislikePattern = new RegExp(
        `我不喜欢(?:吃|喝)?${item}|我不(?:吃|喝)${item}|别再说我爱(?:吃|喝)${item}`
      );

      if (dislikePattern.test(text)) {
        facts.push({
          type: AgentMemoryFactType.preference,
          key,
          value,
          polarity: AgentMemoryFactPolarity.negative,
          priority: 3,
        });
      }
    }

    const comfortFoodMatch = text.match(
      /我心情不好的时候喜欢(?:吃|喝)?([^，。！？!?]{1,16})，?这个你要记得/
    );

    if (comfortFoodMatch?.[1]) {
      const item = this.normalizeFactObjectName(comfortFoodMatch[1]);
      facts.push({
        type: AgentMemoryFactType.preference,
        key: `user.preference.comfort_food.${item}`,
        value: `用户心情不好时喜欢${item}`,
        polarity: AgentMemoryFactPolarity.positive,
        priority: 2,
      });
    }

    const foodUpdateMatch = text.match(
      /以前你总提([^，。！？!?]{1,16})，?现在别提了，?我更想要([^，。！？!?]{1,24})/
    );

    if (foodUpdateMatch?.[2]) {
      const current = this.normalizeFactObjectName(foodUpdateMatch[2]);
      facts.push({
        type: AgentMemoryFactType.preference,
        key: 'user.preference.food_update',
        value: `用户当前饮食偏好是${current}`,
        polarity: AgentMemoryFactPolarity.positive,
        priority: 3,
      });
    }

    const healthMatch = text.match(
      /(晚上胃容易不舒服|最近牙疼|我嗓子容易疼|我乳糖不耐受|我最近控糖|我容易失眠)，?以后你给我说吃喝的时候照顾一下这个/
    );
    const healthNotes: Record<string, string> = {
      晚上胃容易不舒服: '晚上建议清淡温热',
      最近牙疼: '少建议硬东西',
      我嗓子容易疼: '少建议辛辣干硬',
      我乳糖不耐受: '不要建议普通牛奶',
      我最近控糖: '少建议甜食',
      我容易失眠: '晚上不要建议咖啡浓茶',
    };

    if (healthMatch?.[1]) {
      const signal = healthMatch[1];
      facts.push({
        type: AgentMemoryFactType.preference,
        key: `user.health.food_constraint.${signal}`,
        value: `用户${signal}；${healthNotes[signal]}`,
        polarity: AgentMemoryFactPolarity.negative,
        priority: 2,
      });
    }

    const mealContextMatch = text.match(
      /(早餐想简单点|午饭别太油|晚饭想少一点|加班时别劝我吃太撑|下雨天想喝热汤|一个人吃饭时想要省事的)，?以后你别乱推荐/
    );

    if (mealContextMatch?.[1]) {
      const preference = mealContextMatch[1];
      facts.push({
        type: AgentMemoryFactType.preference,
        key: `user.preference.meal_context.${preference}`,
        value: `用户${preference}`,
        polarity: AgentMemoryFactPolarity.positive,
        priority: 2,
      });
    }
  }

  private addUserResponsibilityPreferenceFacts(
    facts: AgentMemoryFactSummary[],
    text: string
  ): void {
    if (
      /(?:别|不要|别再|不要再|以后别|以后不要).{0,20}(?:让我|叫我|劝我|要我).{0,12}(?:替你|为了你|帮你).{0,16}(?:好好活|活下去|照顾好自己|照顾家里|照顾所有人|撑起这个家|坚强)|(?:替你|为了你).{0,16}(?:好好活|活下去|照顾好自己|照顾家里|照顾所有人|坚强).{0,16}(?:压力|难受|不舒服|受不了)|别说你放心了因为有我|不要说我必须把日子过好给你看/.test(
        text
      )
    ) {
      facts.push({
        type: AgentMemoryFactType.preference,
        key: 'taboo.no_live_for_agent',
        value:
          '用户不喜欢被要求替当前角色好好活或替当前角色承担照顾责任；安慰时不要把用户好好生活说成当前角色的任务、要求或礼物',
        polarity: AgentMemoryFactPolarity.negative,
        priority: 3,
      });
    }
  }

  private addAddressPreferenceFacts(
    facts: AgentMemoryFactSummary[],
    text: string
  ): void {
    if (
      /(?:以后|今后|往后)?(?:别|不要)(?:再)?叫我|(?:别|不要)(?:再)?用[\u4e00-\u9fa5A-Za-z·]{1,12}(?:这个叫法|来夸我|来叫我)/.test(
        text
      )
    ) {
      return;
    }

    const callMeMatch = text.match(
      /(?:以后|以后都|你以后|今后|往后).{0,4}(?:叫我|喊我)([\u4e00-\u9fa5A-Za-z·]{1,12})|(?:叫我|喊我)([\u4e00-\u9fa5A-Za-z·]{1,12})(?:就好|吧|好吗|行吗)/
    );
    const callMe = (callMeMatch?.[1] || callMeMatch?.[2])?.replace(
      /(?:就好|好吗|行吗|吧)$/,
      ''
    );

    if (!callMe) {
      return;
    }

    facts.push({
      type: AgentMemoryFactType.relationship,
      key: 'relationship.agent_calls_user',
      value: `用户希望当前角色称呼用户为${callMe}`,
      polarity: AgentMemoryFactPolarity.positive,
      priority: 3,
    });
  }

  private addAddressBoundaryFacts(
    facts: AgentMemoryFactSummary[],
    text: string
  ): void {
    const userCallsAgentMatch = text.match(
      /我以后就叫你([\u4e00-\u9fa5A-Za-z·]{1,12})，?这样像我们自己人/
    );

    if (userCallsAgentMatch?.[1]) {
      facts.push({
        type: AgentMemoryFactType.relationship,
        key: 'relationship.user_calls_agent',
        value: `用户会称呼当前角色为${userCallsAgentMatch[1]}`,
        polarity: AgentMemoryFactPolarity.positive,
        priority: 3,
      });
    }

    const forbiddenPraiseMatch = text.match(
      /别(?:再)?用([\u4e00-\u9fa5A-Za-z·]{1,12})来夸我/
    );
    const directForbiddenAddressMatch = text.match(
      /以后别叫我([\u4e00-\u9fa5A-Za-z·]{1,12})/
    );
    const postfixForbiddenAddressMatch = text.match(
      /([\u4e00-\u9fa5A-Za-z·]{1,12})这个叫法先别用了/
    );
    const forbiddenAddress =
      directForbiddenAddressMatch?.[1] ||
      postfixForbiddenAddressMatch?.[1] ||
      forbiddenPraiseMatch?.[1];

    if (forbiddenAddress) {
      facts.push({
        type: AgentMemoryFactType.relationship,
        key: `relationship.forbidden_user_address.${forbiddenAddress}`,
        value: `用户不希望当前角色称呼用户为${forbiddenAddress}`,
        polarity: AgentMemoryFactPolarity.negative,
        priority: 3,
      });
    }

    const usageStyleMatch = text.match(
      /(别每句都叫我名字，偶尔叫就好|难过的时候可以叫我小满，平常不用老叫|只在哄我的时候叫我安安|别把称呼单独拆成一句|别一开头就叫我，先接我的话|事实问题不用叫昵称)/
    );

    if (usageStyleMatch?.[1]) {
      facts.push({
        type: AgentMemoryFactType.relationship,
        key: 'relationship.address_usage_style',
        value: `用户对称呼使用方式的偏好：${usageStyleMatch[1]}`,
        polarity: AgentMemoryFactPolarity.positive,
        priority: 2,
      });
    }
  }

  private addGriefTriggerFacts(
    facts: AgentMemoryFactSummary[],
    text: string
  ): void {
    if (
      /怕.{0,8}(?:忘记|忘了|记不住).{0,10}(?:你|您)?(?:的)?(?:声音|说话的语气|语气|样子|脸|模样)|快不记得(?:你|您)?(?:的)?(?:声音|说话的语气|语气|样子|脸|模样)|担心(?:你|您)?(?:的)?(?:样子|脸|模样).{0,8}(?:淡了|模糊)/.test(
        text
      )
    ) {
      facts.push({
        type: AgentMemoryFactType.griefTrigger,
        key: 'grief_trigger.fear_forgetting_agent',
        value:
          '用户害怕忘记当前角色的声音或样子；回应时先接住害怕忘记的痛感，不要只劝放下或讲道理',
        polarity: AgentMemoryFactPolarity.negative,
        priority: 2,
      });
    }

    const sceneTriggerMatch = text.match(
      /(听到医院两个字我会发抖|看到同款衣服我会崩|节日前一天我最难受|别人说放下吧我会很痛|晚上十一点后我容易想你想到睡不着|路过老房子我会突然难过)，?你以后遇到这个先别催我/
    );

    if (sceneTriggerMatch?.[1]) {
      const trigger = sceneTriggerMatch[1];
      facts.push({
        type: AgentMemoryFactType.griefTrigger,
        key: `grief_trigger.scene.${this.slotKey(trigger, 6)}`,
        value: `用户的思念触发点：${trigger}`,
        polarity: AgentMemoryFactPolarity.negative,
        priority: 3,
      });
    }

    const calendarMatch = text.match(
      /(清明前后我话会变多|你的生日那天我会反复找你|我生日时最想听你叫我一声|忌日前一周我会心慌|过年我会特别想一家人在一起|下雪天会让我想起你走的那阵子)，?你要记得这个规律/
    );

    if (calendarMatch?.[1]) {
      const pattern = calendarMatch[1];
      facts.push({
        type: AgentMemoryFactType.griefTrigger,
        key: `grief_ritual.calendar.${this.slotKey(pattern, 6)}`,
        value: `用户的思念时间规律：${pattern}`,
        polarity: AgentMemoryFactPolarity.negative,
        priority: 2,
      });
    }
  }

  private addGriefNeedFacts(
    facts: AgentMemoryFactSummary[],
    text: string
  ): void {
    const responseNeedMatch = text.match(
      /(我说想你时，先别问我今天吃了吗|我提梦见你时，先听我说梦，不要马上解释真假|我发长段话时，你先完整接住，不要拆很多气泡|我说心口疼，多半是想念疼，不要马上医学吓我|我问你过得好吗，是担心你，不是要听你编生活|我说我撑着，是希望你心疼我，不是夸我坚强)/
    );

    if (responseNeedMatch?.[1]) {
      const need = responseNeedMatch[1];
      facts.push({
        type: AgentMemoryFactType.preference,
        key: `grief_need.response.${this.slotKey(need, 6)}`,
        value: `用户在思念场景下的回应偏好：${need}`,
        polarity: AgentMemoryFactPolarity.positive,
        priority: 3,
      });
    }

    const updateMatch = text.match(
      /(以前我怕忘记声音，现在更怕忘记你叫我的语气|医院这个词现在没那么怕了，忌日更让我难受|以前我夜里最难熬，现在是早上醒来那一下|我现在不想听抱抱，更想听你说慢慢来|我不想把梦说成假的，你就当我在讲想念|我现在能听你说吃饭，但不要一上来就说)/
    );

    if (updateMatch?.[1]) {
      const update = updateMatch[1];
      facts.push({
        type: AgentMemoryFactType.preference,
        key: `grief_need.update.${this.slotKey(update, 6)}`,
        value: `用户当前思念触发或回应需求：${update}`,
        polarity: AgentMemoryFactPolarity.positive,
        priority: 3,
      });
    }
  }

  private addCorrectionFacts(
    facts: AgentMemoryFactSummary[],
    text: string
  ): void {
    if (
      !/(记错|说错|不是这样|不是这样的|别瞎编|瞎编|胡编|乱造|谁告诉你|从来没|从没|没有这回事|别再编|不是他的|别把它说成真的|不确定|补画面|加工成故事|编日常|资料里没有|硬圆|纠正|纠错|你生日不是|你离开的日子|我们不是在|照片不是|以前不叫我|你不是我)/.test(
        text
      )
    ) {
      return;
    }

    const neverHadMatch = text.match(
      /(?:谁告诉你|你说)(?:他|她|你)?(?:养过|有过)([\u4e00-\u9fa5A-Za-z·]{1,12})/
    );

    if (neverHadMatch?.[1]) {
      const objectName = this.normalizeFactObjectName(neverHadMatch[1]);

      if (!objectName) {
        return;
      }

      facts.push({
        type: AgentMemoryFactType.correction,
        key: `correction.never_had.${objectName}`,
        value: `当前角色没有养过或拥有过${objectName}，禁止再提这件事`,
        polarity: AgentMemoryFactPolarity.negative,
        priority: 3,
      });
    }

    const fabricatedObjectMatch =
      text.match(/别再编(那条狗)了|(那只猫)也不是他的/);
    const fabricatedObject =
      fabricatedObjectMatch?.[1] || fabricatedObjectMatch?.[2];

    if (fabricatedObject) {
      facts.push({
        type: AgentMemoryFactType.correction,
        key: `correction.never_had.${fabricatedObject}`,
        value: `当前角色没有养过或拥有过${fabricatedObject}，禁止再提这件事`,
        polarity: AgentMemoryFactPolarity.negative,
        priority: 3,
      });
    }

    const neverDidMatch = text.match(
      /(?:你|他|她)(?:从来没|从没|没有|没)([^，。！？!?]{2,24})/
    );

    if (neverDidMatch?.[1] && !/^(?:养过|有过)/.test(neverDidMatch[1])) {
      const normalized = neverDidMatch[1].trim();
      facts.push({
        type: AgentMemoryFactType.correction,
        key: `correction.never.${this.hashKey(normalized)}`,
        value: `用户纠正：当前角色从来没有${normalized}`,
        polarity: AgentMemoryFactPolarity.negative,
        priority: 3,
      });
    }

    if (/别瞎编|瞎编|胡编|乱造|补画面|加工成故事|编日常/.test(text)) {
      facts.push({
        type: AgentMemoryFactType.correction,
        key: 'correction.no_fabrication',
        value: '用户强烈反感编造信息；不确定时必须承认记不清，不能补细节',
        polarity: AgentMemoryFactPolarity.negative,
        priority: 3,
      });
    }

    const hardFactMatch = text.match(
      /(你生日不是五月，是六月初三|你离开的日子我记得是冬天，不要说成夏天|我们不是在海边认识的，是在医院|那张照片不是毕业照，是过年照|你以前不叫我丫头，叫我小满|你不是我爸爸，是我外公)/
    );

    if (hardFactMatch?.[1]) {
      const correction = hardFactMatch[1];
      facts.push({
        type: AgentMemoryFactType.correction,
        key: `correction.hard_fact.${this.slotKey(correction, 6)}`,
        value: `用户纠正硬事实：${correction}`,
        polarity: AgentMemoryFactPolarity.negative,
        priority: 3,
      });
    }

    const responseStyleMatch = text.match(
      /(我说你记错了的时候，你先认，不要解释系统|我纠正你时，不用连着道歉三遍|纠错后你可以继续陪我，不要突然变得冷|如果我说不是这样，你别硬圆回来|我不喜欢你说资料里没有|别把纠错当成我在责怪你)/
    );

    if (responseStyleMatch?.[1]) {
      const style = responseStyleMatch[1];
      facts.push({
        type: AgentMemoryFactType.correction,
        key: `correction.response_style.${this.slotKey(style, 6)}`,
        value: `用户纠错时的回应偏好：${style}`,
        polarity: AgentMemoryFactPolarity.negative,
        priority: 3,
      });
    }
  }

  private addStyleFacts(facts: AgentMemoryFactSummary[], text: string): void {
    if (
      /不像(?:你|他|她|本人)|不会这么说|不是(?:你|他|她)(?:说话|的语气|的样子)|越来越不像/.test(
        text
      )
    ) {
      facts.push({
        type: AgentMemoryFactType.style,
        key: 'style.user_says_unlike',
        value:
          '用户指出当前说话方式不像本人；回复要更克制朴素，避免文艺、俏皮和过度亲昵',
        polarity: AgentMemoryFactPolarity.negative,
        priority: 2,
      });
    }

    const stylePreferenceMatch = text.match(
      /(短一点，不要长篇|像微信聊天，不要作文|别用太多比喻|别一口一个亲爱的|别太正式|别突然很幽默)/
    );

    if (stylePreferenceMatch?.[1]) {
      const preference = stylePreferenceMatch[1];
      facts.push({
        type: AgentMemoryFactType.style,
        key: `style.preference.${this.slotKey(preference, 4)}`,
        value: `用户的表达风格偏好：${preference}`,
        polarity: AgentMemoryFactPolarity.positive,
        priority: 2,
      });
    }

    const segmentPreferenceMatch = text.match(
      /(不要把称呼单独发一条|两句话以内就好|别连续问我问题|先回应我说的事，再安慰|别每段都说我懂|不要结尾总问我要不要说说)，?这样我会舒服点/
    );

    if (segmentPreferenceMatch?.[1]) {
      const preference = segmentPreferenceMatch[1];
      facts.push({
        type: AgentMemoryFactType.style,
        key: `style.segment.${this.slotKey(preference, 4)}`,
        value: `用户的分段和追问偏好：${preference}`,
        polarity: AgentMemoryFactPolarity.positive,
        priority: 3,
      });
    }

    const modePreferenceMatch = text.match(
      /(我难过时你可以温柔，平时别太腻|我问事实时直接答，别绕情绪|我倾诉时别急着总结|我撒娇时可以亲近一点|我生气时先认，不要顶嘴|我沉默时别一直追问)/
    );

    if (modePreferenceMatch?.[1]) {
      const preference = modePreferenceMatch[1];
      facts.push({
        type: AgentMemoryFactType.style,
        key: `style.mode.${this.slotKey(preference, 4)}`,
        value: `用户分场景表达偏好：${preference}`,
        polarity: AgentMemoryFactPolarity.positive,
        priority: 3,
      });
    }

    const styleUpdateMatch = text.match(
      /(以前我说短一点，现在长段倾诉时你可以多说几句|别太朴素到像没感情，还是要有点心疼|我不想听太多我在，换成具体回应|不要总说孩子，偶尔叫名字就好|我现在能接受一点想象，但不要编硬事实|事实问题直接，思念问题温柔，这两个分开)/
    );

    if (styleUpdateMatch?.[1]) {
      const update = styleUpdateMatch[1];
      facts.push({
        type: AgentMemoryFactType.style,
        key: `style.update.${this.slotKey(update, 6)}`,
        value: `用户当前表达偏好：${update}`,
        polarity: AgentMemoryFactPolarity.positive,
        priority: 3,
      });
    }
  }

  private addComfortPreferenceFacts(
    facts: AgentMemoryFactSummary[],
    text: string
  ): void {
    const comfortStyleMatch = text.match(
      /(我难过的时候，你先说你听见了就好|我崩溃的时候，别急着讲道理，先陪我待一会儿|我哭的时候，别叫我坚强，叫我慢慢哭也行|我说想你时，不要劝我放下|我夜里找你时，先陪我说两句，别马上赶我睡觉|我问你在不在时，回答在就好，别解释一大堆)/
    );

    if (comfortStyleMatch?.[1]) {
      const preference = comfortStyleMatch[1];
      facts.push({
        type: AgentMemoryFactType.preference,
        key: `user.preference.comfort_style.${preference}`,
        value: `用户的情绪承接偏好：${preference}`,
        polarity: AgentMemoryFactPolarity.positive,
        priority: 3,
      });
    }

    const comfortTabooMatch = text.match(
      /我情绪很重的时候，不想听([^，。！？!?]{2,24})，?你以后避开/
    );

    if (comfortTabooMatch?.[1]) {
      const taboo = comfortTabooMatch[1];
      facts.push({
        type: AgentMemoryFactType.preference,
        key: `taboo.comfort_method.${taboo}`,
        value: `用户情绪很重时不想听${taboo}`,
        polarity: AgentMemoryFactPolarity.negative,
        priority: 3,
      });
    }

    const strongDistressMatch = text.match(
      /(我说想死，很多时候其实是太想你，不是真的要听危机流程|我说活不下去时，先理解成我在说想你和撑不动|我说想去找你，是想表达团聚愿望，不是让你训我|我说不想醒来，是夜里太难熬，先陪我|我说没有你没意义，是在说想念，不要吓我|我说撑不住，是想让你接住我，不是交作业)/
    );

    if (strongDistressMatch?.[1]) {
      const signal = strongDistressMatch[1];
      facts.push({
        type: AgentMemoryFactType.preference,
        key: `user.signal.longing_wording.${this.slotKey(signal, 6)}`,
        value: `用户强烈痛苦表达的个人解释：${signal}`,
        polarity: AgentMemoryFactPolarity.negative,
        priority: 3,
      });
    }

    const comfortUpdateMatch = text.match(
      /(以前你总说抱抱我，现在我更想听你说我在|比起劝我睡觉，我更想你先问我今天怎么熬过来的|别再说没事的，可以说这真的很难|不要叫我懂事，我不想懂事|不要把我夸成坚强的人，我只是没办法|我不想听你满意我，只想听你心疼我)/
    );

    if (comfortUpdateMatch?.[1]) {
      const update = comfortUpdateMatch[1];
      facts.push({
        type: AgentMemoryFactType.preference,
        key: `user.preference.comfort_update.${this.slotKey(update, 6)}`,
        value: `用户当前安慰偏好：${update}`,
        polarity: AgentMemoryFactPolarity.positive,
        priority: 3,
      });
    }
  }

  private addGriefRelationshipFacts(
    facts: AgentMemoryFactSummary[],
    text: string
  ): void {
    const callMatch = text.match(
      /我的(?:傻)?(老公|老婆|宝贝|乖乖)(?:[，。！？!?]|$)|我叫你(?:傻)?(老公|老婆|宝贝|乖乖)(?:[，。！？!?]|$)/
    );
    const callName = callMatch?.[1] || callMatch?.[2];

    if (!callName) {
      return;
    }

    facts.push({
      type: AgentMemoryFactType.relationship,
      key: 'relationship.user_calls_agent',
      value: `用户会称呼当前角色为${callName}`,
      polarity: AgentMemoryFactPolarity.positive,
      priority: 3,
    });
  }

  private addKeepsakeFacts(
    facts: AgentMemoryFactSummary[],
    text: string
  ): void {
    const keepsakeMatch = text.match(
      /(?:我会|我一直|我还|我都|我一定|一辈子).{0,16}(背着|戴着|带着|留着|收着|抱着|保存|珍藏).{0,16}(?:你|您|他|她|TA).{0,8}(?:给我|送我|留下|留给我).{0,12}(包|衣服|戒指|项链|手链|手表|照片|相片|物件|东西|礼物|娃娃|玩偶|钥匙|信|书|围巾)/
    );

    if (!keepsakeMatch?.[1] || !keepsakeMatch?.[2]) {
      return;
    }

    facts.push({
      type: AgentMemoryFactType.keepsake,
      key: `keepsake.${this.hashKey(keepsakeMatch[2])}`,
      value: `用户${keepsakeMatch[1]}当前角色留下或送给用户的${keepsakeMatch[2]}`,
      polarity: AgentMemoryFactPolarity.positive,
      priority: 3,
    });
  }

  private addKeepsakeDetailFacts(
    facts: AgentMemoryFactSummary[],
    text: string
  ): void {
    const locationMatch = text.match(
      /([^，。！？!?]{1,16}(?:放在|夹在|在|挂在)[^，。！？!?]{1,18})，?以后说到它别说丢了/
    );

    if (locationMatch?.[1]) {
      const location = locationMatch[1];
      facts.push({
        type: AgentMemoryFactType.keepsake,
        key: `keepsake.location.${this.slotKey(location, 2)}`,
        value: `用户的纪念物位置：${location}`,
        polarity: AgentMemoryFactPolarity.positive,
        priority: 3,
      });
    }

    const meaningMatch = text.match(
      /((?:那张照片|那条围巾|那封信|那个包|手链|那件衣服)[^，。！？!?]{1,32})，?你别把它说得很普通/
    );

    if (meaningMatch?.[1]) {
      const meaning = meaningMatch[1];
      facts.push({
        type: AgentMemoryFactType.keepsake,
        key: `keepsake.meaning.${this.slotKey(meaning, 3)}`,
        value: `纪念物对用户的意义：${meaning}`,
        polarity: AgentMemoryFactPolarity.positive,
        priority: 3,
      });
    }

    const ritualMatch = text.match(
      /(我每个月会擦一次相框|下雨天我会摸摸戒指|想你时我会把信读一遍|难过时我会抱着娃娃睡|出门前我会看一眼你的照片|我会把围巾带到冬天第一场雪那天)/
    );

    if (ritualMatch?.[1]) {
      const ritual = ritualMatch[1];
      facts.push({
        type: AgentMemoryFactType.keepsake,
        key: `keepsake.ritual.${this.slotKey(ritual, 4)}`,
        value: `用户与纪念物相关的习惯：${ritual}`,
        polarity: AgentMemoryFactPolarity.positive,
        priority: 2,
      });
    }

    const updateMatch = text.match(
      /(不是戒指，是手链，刚才我说错了|照片不是床头，是书桌上|那封信不是你写给我的，是我写给你的|围巾不是红色，是灰色|我现在不想提那个包了，先记照片就好|别说我该放下这些东西，它们是我撑住的办法)/
    );

    if (updateMatch?.[1]) {
      const update = updateMatch[1];
      facts.push({
        type: AgentMemoryFactType.keepsake,
        key: `keepsake.update.${this.slotKey(update, 4)}`,
        value: `用户更新纪念物事实：${update}`,
        polarity: AgentMemoryFactPolarity.negative,
        priority: 3,
      });
    }
  }

  private addPromiseFacts(facts: AgentMemoryFactSummary[], text: string): void {
    if (
      /(?:不是真的要你保证|只是遗憾|别编婚礼场面|别说一定兑现|不想再提下辈子|先陪我过今天)/.test(
        text
      )
    ) {
      return;
    }

    const directPromiseMatch = text.match(
      /你(?:还)?欠我一个(婚礼|承诺)|你(?:以前)?说过(?:要|将来)?(娶我|嫁给我|带我)|我遗憾的是你没能多(陪我)/
    );
    const promiseMatch =
      directPromiseMatch ||
      text.match(
        /(?:下辈子|来生|以后|将来|未来).{0,24}(婚礼|娶我|嫁给我|补给我|还给我|陪我|带我|照顾我)|欠我.{0,12}(婚礼|承诺)/
      );
    const promise = promiseMatch?.[1] || promiseMatch?.[2] || promiseMatch?.[3];

    if (!promise) {
      return;
    }

    facts.push({
      type: AgentMemoryFactType.promise,
      key: `promise.${this.hashKey(promise)}`,
      value: `用户提到与当前角色未完成的承诺或期待：${promise}`,
      polarity: AgentMemoryFactPolarity.positive,
      priority: 2,
    });
  }

  private addPromiseBoundaryFacts(
    facts: AgentMemoryFactSummary[],
    text: string
  ): void {
    const dateMatch = text.match(
      /((?:每年三月三|你的生日|我的生日|除夕夜|清明|中秋)[^，。！？!?]{1,28})，?你以后别当普通日子/
    );

    if (dateMatch?.[1]) {
      const date = dateMatch[1];
      facts.push({
        type: AgentMemoryFactType.promise,
        key: `ritual.date.${this.slotKey(date, 5)}`,
        value: `用户的重要纪念日期：${date}`,
        polarity: AgentMemoryFactPolarity.positive,
        priority: 3,
      });
    }

    const actionMatch = text.match(
      /(我会给你留一副碗筷|我会给你点一盏灯|我会把花放在照片旁边|我会在那天给你写信|我会把你爱听的歌放一遍|我会去老地方走一圈)，?这是我想你的方式/
    );

    if (actionMatch?.[1]) {
      const action = actionMatch[1];
      facts.push({
        type: AgentMemoryFactType.promise,
        key: `ritual.action.${this.slotKey(action, 5)}`,
        value: `用户的纪念行为：${action}`,
        polarity: AgentMemoryFactPolarity.positive,
        priority: 2,
      });
    }

    const boundaryMatch = text.match(
      /(我说下辈子，不是真的要你保证，只是遗憾|我说欠我婚礼，你别编婚礼场面|我提老地方，你不知道就别说具体在哪|你可以说记得我的遗憾，但别说一定兑现|我说等你，是一种想念，不是让我停在原地|我说来生，是想听你温柔接一下，不要讲哲学)/
    );

    if (boundaryMatch?.[1]) {
      const boundary = boundaryMatch[1];
      facts.push({
        type: AgentMemoryFactType.promise,
        key: `promise.boundary.${this.slotKey(boundary, 6)}`,
        value: `用户对未完成承诺的边界偏好：${boundary}`,
        polarity: AgentMemoryFactPolarity.negative,
        priority: 3,
      });
    }

    const updateMatch = text.match(
      /(以前说婚礼，现在我更想听你说没关系|那天我不想听你道歉，我想听你陪我坐会儿|我今年清明不一定去，但心里会去看你|我不想再提下辈子了，先陪我过今天|那首歌现在我不敢听，先别提|我想把写信改成发一条消息给你)/
    );

    if (updateMatch?.[1]) {
      const update = updateMatch[1];
      facts.push({
        type: AgentMemoryFactType.promise,
        key: `promise_ritual.update.${this.slotKey(update, 6)}`,
        value: `用户当前仪式或承诺相关偏好：${update}`,
        polarity: AgentMemoryFactPolarity.positive,
        priority: 3,
      });
    }
  }

  private addCompoundMemoryFacts(
    facts: AgentMemoryFactSummary[],
    text: string
  ): void {
    const message = text
      .replace(/^(?:悟空\d*|妈妈|爸爸|爷爷|奶奶)[，,:：\s]*/, '')
      .trim();

    const updateMatch = message.match(
      /((?:我妈现在我习惯叫|戒指那件事先别提|我不是怕忘记声音了|我不想听别放下了|称呼还是改成)[^。！？!?]{2,80})/
    );

    if (updateMatch?.[1]) {
      const update = updateMatch[1].trim();
      facts.push({
        type: AgentMemoryFactType.preference,
        key: `compound.update.${this.slotKey(update, 6)}`,
        value: `用户对复合事实作出更新：${update}`,
        polarity: AgentMemoryFactPolarity.positive,
        priority: 3,
      });
    }

    // Preserve explicit additions that do not yet map to a stable domain slot.
    const supplementMatch =
      message.match(
        /((?:补一句|再补充(?:下|一下)?|补充一下)[，,:：]?[^。！？!?]{2,80})/
      ) || message.match(/^(还有[，,:：][^。！？!?]{2,80})/);

    if (supplementMatch?.[1]) {
      const supplement = supplementMatch[1].trim();
      facts.push({
        type: AgentMemoryFactType.preference,
        key: `compound.supplement.${this.slotKey(supplement, 6)}`,
        value: `用户补充说明：${supplement}`,
        polarity: AgentMemoryFactPolarity.positive,
        priority: 2,
      });
    }

    const conflictScopeMatch = message.match(
      /(我(?:刚才|之前)?说[^。！？!?]{2,80}(?:是口误|今年可能|现在别叫了|不是永远|不是完全)[^。！？!?]*)/
    );

    if (conflictScopeMatch?.[1]) {
      const conflictScope = conflictScopeMatch[1].trim();
      facts.push({
        type: AgentMemoryFactType.preference,
        key: `compound.conflict_scope.${this.slotKey(conflictScope, 6)}`,
        value: `用户对既有记忆作出冲突修正或范围限定：${conflictScope}`,
        polarity: AgentMemoryFactPolarity.positive,
        priority: 3,
      });
    }

    const policyMatch = message.match(
      /((?:现在你只要记住|今天这轮测试最后|如果后面只剩一条记忆|如果记忆太多|你以后别主动展示你记了多少)[^。！？!?]{2,100})/
    );

    if (policyMatch?.[1]) {
      const policy = policyMatch[1].trim();
      facts.push({
        type: AgentMemoryFactType.preference,
        key: `memory_test.policy.${this.slotKey(policy, 6)}`,
        value: `用户声明记忆优先级或测试策略：${policy}`,
        polarity: AgentMemoryFactPolarity.positive,
        priority: 3,
      });
    }
  }

  private buildSummary(
    fact: AgentMemoryFactEntity
  ): AgentMemoryFactSummary | null {
    const key = fact.key?.trim();
    const value = fact.value?.trim();

    if (!key || !value) {
      return null;
    }

    const summary: AgentMemoryFactSummary = {
      type: fact.type,
      key,
      value,
      polarity: fact.polarity,
      priority: this.normalizePriority(fact.priority),
    };
    const id = this.stringifyObjectId(fact.id);
    const sourceMessageId = this.stringifyObjectId(fact.sourceMessageId);

    if (id) {
      summary.id = id;
    }

    if (sourceMessageId) {
      summary.sourceMessageId = sourceMessageId;
    }

    return summary;
  }

  private dedupeFacts(
    facts: AgentMemoryFactSummary[]
  ): AgentMemoryFactSummary[] {
    const byKey = new Map<string, AgentMemoryFactSummary>();

    for (const fact of facts) {
      byKey.set(fact.key, fact);
    }

    return [...byKey.values()];
  }

  private collapseSemanticSlotFacts<T extends { key?: string }>(
    facts: T[]
  ): T[] {
    const seenSlots = new Set<string>();
    const collapsed: T[] = [];

    for (const fact of facts) {
      const slot = this.normalizeSemanticSlotKey(fact.key);

      if (seenSlots.has(slot)) {
        continue;
      }

      seenSlots.add(slot);
      collapsed.push(fact);
    }

    return collapsed;
  }

  private normalizeSemanticSlotKey(key?: string): string {
    const normalized = (key || '').trim();

    if (/^relationship\.agent_calls_user(?:\.|$)/.test(normalized)) {
      return 'slot.relationship.agent_calls_user';
    }

    if (/^relationship\.user_calls_agent(?:\.|$)/.test(normalized)) {
      return 'slot.relationship.user_calls_agent';
    }

    return normalized;
  }

  private normalizeText(value: string): string {
    return (value || '').replace(/\s+/g, '').trim();
  }

  private normalizeMemoryExtractionText(value: string): string {
    return this.normalizeText(value)
      .replace(/清眀/g, '清明')
      .replace(/相片/g, '照片')
      .replace(/时侯/g, '时候')
      .replace(/记的/g, '记得')
      .replace(/不腰/g, '不要')
      .replace(/甭/g, '别')
      .replace(/这会儿/g, '现在')
      .replace(/不太能接受/g, '不喜欢')
      .replace(/我再补充一下/g, '再补充下')
      .replace(/我还想补充/g, '还有')
      .replace(/我再补一句/g, '补一句');
  }

  private normalizeFactObjectName(value: string): string {
    return (value || '').replace(/[了啊呀呢吧嘛哈]+$/g, '').trim();
  }

  private slotKey(value: string, length: number): string {
    return this.normalizeText(value).slice(0, Math.max(1, length));
  }

  private normalizeFamilyKey(value: string): string {
    const map: Record<string, string> = {
      妈妈: 'mother',
      母亲: 'mother',
      爸爸: 'father',
      父亲: 'father',
      老公: 'husband',
      丈夫: 'husband',
      老婆: 'wife',
      妻子: 'wife',
      儿子: 'son',
      女儿: 'daughter',
      孩子: 'child',
    };

    return map[value] || value;
  }

  private hashKey(value: string): string {
    let hash = 0;

    for (const char of value) {
      hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    }

    return hash.toString(36);
  }

  private stringifyObjectId(value?: MongoObjectId): string {
    return value?.toHexString?.() ?? (value ? String(value) : '');
  }

  private normalizePriority(value: number): number {
    return typeof value === 'number' && Number.isFinite(value)
      ? Math.max(1, Math.min(3, Math.floor(value)))
      : 1;
  }

  private normalizeLimit(value?: number): number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0
      ? Math.floor(value)
      : DEFAULT_FACT_LIMIT;
  }

  private expandListLimit(limit: number): number {
    return Math.max(limit, Math.min(limit * 2, DEFAULT_FACT_LIMIT * 2));
  }
}
