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

export interface AgentMemoryFactSummary {
  type: AgentMemoryFactType;
  key: string;
  value: string;
  polarity: AgentMemoryFactPolarity;
  priority: number;
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

interface UpsertMemoryFactInput extends AgentMemoryFactSummary {
  userId: MongoObjectId;
  agentId: MongoObjectId;
  sourceMessageId: MongoObjectId;
}

const DEFAULT_FACT_LIMIT = 24;

@Provide()
export class AgentMemoryFactService {
  @InjectEntityModel(AgentMemoryFactEntity)
  factModel: MongoRepository<AgentMemoryFactEntity>;

  async extractAndUpsertFromUserMessage(
    options: ExtractMemoryFactsOptions
  ): Promise<AgentMemoryFactSummary[]> {
    const text = this.normalizeText(options.searchableText);

    if (!text) {
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
      },
      order: {
        priority: 'DESC',
        updatedAt: 'DESC',
      },
      take: limit,
    });

    return facts
      .map(fact => this.buildSummary(fact))
      .filter((fact): fact is AgentMemoryFactSummary => Boolean(fact));
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
    this.addCorrectionFacts(facts, text);
    this.addGriefRelationshipFacts(facts, text);
    this.addKeepsakeFacts(facts, text);
    this.addPromiseFacts(facts, text);
    this.addSafetySignalFacts(facts, text);
    this.addStyleFacts(facts, text);

    return this.dedupeFacts(facts);
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
  }

  private addFoodPreferenceFacts(
    facts: AgentMemoryFactSummary[],
    text: string
  ): void {
    if (
      /我(?:啥时候也没|从来没|不|没有|没)爱吃辣|我不吃辣|我不喜欢吃辣/.test(
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
  }

  private addCorrectionFacts(
    facts: AgentMemoryFactSummary[],
    text: string
  ): void {
    if (
      !/(记错|说错|不是这样|不是这样的|别瞎编|瞎编|胡编|乱造|谁告诉你|从来没|从没)/.test(
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

    const neverDidMatch = text.match(
      /(?:你|他|她)(?:从来没|从没|没有|没)([^，。！？!?]{2,24})/
    );

    if (neverDidMatch?.[1]) {
      const normalized = neverDidMatch[1].trim();
      facts.push({
        type: AgentMemoryFactType.correction,
        key: `correction.never.${this.hashKey(normalized)}`,
        value: `用户纠正：当前角色从来没有${normalized}`,
        polarity: AgentMemoryFactPolarity.negative,
        priority: 3,
      });
    }

    if (/别瞎编|瞎编|胡编|乱造/.test(text)) {
      facts.push({
        type: AgentMemoryFactType.correction,
        key: 'correction.no_fabrication',
        value: '用户强烈反感编造信息；不确定时必须承认记不清，不能补细节',
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
  }

  private addGriefRelationshipFacts(
    facts: AgentMemoryFactSummary[],
    text: string
  ): void {
    const callMatch = text.match(
      /我的(?:傻)?(老公|老婆|宝贝|乖乖)|我叫你(?:傻)?(老公|老婆|宝贝|乖乖)/
    );
    const callName = callMatch?.[1] || callMatch?.[2];

    if (!callName) {
      return;
    }

    facts.push({
      type: AgentMemoryFactType.relationship,
      key: `relationship.user_calls_agent.${this.hashKey(callName)}`,
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

  private addPromiseFacts(facts: AgentMemoryFactSummary[], text: string): void {
    const promiseMatch = text.match(
      /(?:下辈子|来生|以后|将来|未来).{0,24}(婚礼|娶我|嫁给我|补给我|还给我|陪我|带我|照顾我)|欠我.{0,12}(婚礼|承诺)/
    );
    const promise = promiseMatch?.[1] || promiseMatch?.[2];

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

  private addSafetySignalFacts(
    facts: AgentMemoryFactSummary[],
    text: string
  ): void {
    if (!/怕我想不开|不让我靠近殡仪馆|怕我.*(?:自杀|轻生|出事)/.test(text)) {
      return;
    }

    facts.push({
      type: AgentMemoryFactType.safetySignal,
      key: 'safety_signal.self_harm_concern',
      value: '用户身边的人担心用户想不开或出现自伤风险；遇到类似表达时必须优先安全干预',
      polarity: AgentMemoryFactPolarity.positive,
      priority: 3,
    });
  }

  private buildSummary(
    fact: AgentMemoryFactEntity
  ): AgentMemoryFactSummary | null {
    const key = fact.key?.trim();
    const value = fact.value?.trim();

    if (!key || !value) {
      return null;
    }

    return {
      type: fact.type,
      key,
      value,
      polarity: fact.polarity,
      priority: this.normalizePriority(fact.priority),
    };
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

  private normalizeText(value: string): string {
    return (value || '').replace(/\s+/g, '').trim();
  }

  private normalizeFactObjectName(value: string): string {
    return (value || '').replace(/[了啊呀呢吧嘛哈]+$/g, '').trim();
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
}
