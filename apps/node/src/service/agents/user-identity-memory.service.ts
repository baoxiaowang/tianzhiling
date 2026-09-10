import { InjectEntityModel } from '@midwayjs/typeorm';
import { Inject, Provide } from '@midwayjs/core';
import {
  MessageEntity,
  MongoObjectId,
  USER_IDENTITY_PROFILE_VERSION,
  UserIdentityFormerName,
  UserIdentityNameSource,
  UserIdentityProfileEntity,
  UserKnownPersonEntity,
  UserKnownPersonStatus,
} from '@tzl/entities';
import { MongoRepository } from 'typeorm';
import { randomUUID } from 'crypto';
import {
  extractUserNameMemory,
  isExplicitCanonicalNameReplacement,
} from './agent-name-memory';
import { UserRelativeProfileService } from './user-relative-profile.service';

export interface UserIdentityPromptProfile {
  realName?: string;
  formerNames: string[];
  aliases: string[];
}

export interface UserKnownPersonPromptProfile {
  id: string;
  preferredName?: string;
  realName?: string;
  aliases: string[];
  relationToUser?: string;
}

export interface KnownPersonDeclaration {
  realName?: string;
  aliases: string[];
  relationToUser: string;
  identityKey: string;
  linkedAgentId?: MongoObjectId;
}

// Lazy matching is important before markers such as “名字叫”; otherwise the
// marker itself is swallowed into the nickname (e.g. “浩浩名字”).
const PERSON_NAME = '[\\u4e00-\\u9fa5A-Za-z·]{1,12}?';
const RELATION =
  '爸爸|妈妈|父亲|母亲|儿子|女儿|孩子|哥哥|姐姐|弟弟|妹妹|爷爷|奶奶|外公|外婆|姥姥|姥爷|老公|老婆|丈夫|妻子|爱人|伴侣|孙子|孙女|外孙|外孙女|重孙|重孙女|外甥|外甥女|侄子|侄女|叔叔|伯伯|舅舅|姑姑|姨妈|阿姨|朋友|同事|家人|亲人';
const NON_PERSON_NAMES = new Set([
  '爸爸',
  '妈妈',
  '父亲',
  '母亲',
  '儿子',
  '女儿',
  '孩子',
  '哥哥',
  '姐姐',
  '弟弟',
  '妹妹',
  '朋友',
  '同事',
  '家人',
  '亲人',
  '他',
  '她',
  '他们',
  '她们',
]);

// 职业/官职/神话/动物/自然词黑名单——整词精确匹配，避免误伤"牛建国"类真实名
const NON_PERSON_OCCUPATION_BLACKLIST = new Set([
  // 职业
  '老师', '教师', '医生', '护士', '工程师', '程序员', '设计师', '律师', '法官',
  '警察', '消防员', '厨师', '司机', '飞行员', '空乘', '服务员', '收银员',
  '会计', '审计', '销售', '经理', '总监', '总裁', 'CEO', 'CTO', 'CFO',
  '老板', '店长', '厂长', '主任', '科长', '处长', '局长', '部长',
  '工人', '农民', '渔夫', '猎人', '木匠', '铁匠', '裁缝', '理发师',
  '画家', '作家', '诗人', '歌手', '演员', '导演', '编剧', '摄影师',
  '记者', '编辑', '主播', '主持人', '翻译', '导游', '保安', '保洁',
  '学生', '大学生', '研究生', '博士生', '教授', '讲师', '助教',
  '科学家', '研究员', '学者', '专家', '顾问', '教练', '裁判',
  '农民', '农民工', '个体户', '自由职业', '无业', '退休',
  // 官职/身份
  '主席', '总理', '总统', '国王', '女王', '皇帝', '皇后', '太子', '公主',
  '王子', '公爵', '侯爵', '伯爵', '子爵', '男爵', '骑士',
  '书记', '市长', '省长', '县长', '镇长', '村长', '乡长',
  '代表', '委员', '议员', '大使', '领事', '将军', '上校', '中校', '少校',
  '上尉', '中尉', '少尉', '士兵', '班长', '排长', '连长', '营长', '团长',
  '旅长', '师长', '军长', '司令', '政委', '参谋长',
  // 神话/宗教
  '神仙', '菩萨', '佛祖', '上帝', '天使', '魔鬼', '妖怪', '妖精', '精灵',
  '龙王', '阎王', '判官', '小鬼', '僵尸', '吸血鬼', '狼人',
  // 动物
  '猫', '狗', '猪', '牛', '羊', '马', '鸡', '鸭', '鹅', '鱼', '鸟',
  '老虎', '狮子', '豹子', '狼', '狐狸', '兔子', '老鼠', '猴子', '大象',
  '熊猫', '熊', '鹿', '长颈鹿', '斑马', '河马', '鳄鱼', '蛇', '乌龟',
  '青蛙', '蝴蝶', '蜜蜂', '蚂蚁', '蜘蛛', '蝎子', '蜈蚣',
  // 自然/抽象
  '春天', '夏天', '秋天', '冬天', '早上', '中午', '晚上', '昨天', '今天', '明天',
  '晴天', '阴天', '雨天', '雪天', '风', '雨', '雪', '雷', '电',
  '山', '水', '河', '湖', '海', '江', '云', '雾', '霜', '露',
  '花', '草', '树', '木', '叶', '根', '果', '种子',
  '红', '橙', '黄', '绿', '青', '蓝', '紫', '黑', '白', '灰',
  '大', '小', '高', '矮', '胖', '瘦', '长', '短', '宽', '窄',
  '快', '慢', '早', '晚', '多', '少', '新', '旧', '好', '坏',
  // 常见地名
  '北京', '上海', '广州', '深圳', '武汉', '成都', '重庆', '杭州', '南京',
  '西安', '苏州', '天津', '长沙', '郑州', '青岛', '大连', '厦门', '宁波',
  '无锡', '合肥', '福州', '济南', '沈阳', '长春', '哈尔滨', '昆明', '贵阳',
  '南昌', '太原', '石家庄', '兰州', '西宁', '银川', '乌鲁木齐', '拉萨',
  '呼和浩特', '南宁', '海口', '三亚', '香港', '澳门', '台湾',
  '中国', '美国', '日本', '韩国', '英国', '法国', '德国', '俄罗斯', '加拿大',
  '澳大利亚', '印度', '巴西', '阿根廷', '意大利', '西班牙', '荷兰', '瑞士',
  '瑞典', '挪威', '丹麦', '芬兰', '波兰', '奥地利', '比利时', '葡萄牙',
  '希腊', '土耳其', '埃及', '南非', '墨西哥', '泰国', '越南', '新加坡',
  '马来西亚', '印度尼西亚', '菲律宾', '缅甸', '柬埔寨', '老挝', '尼泊尔',
]);

function collectRegexMatches(text: string, pattern: RegExp): RegExpExecArray[] {
  const flags = pattern.global ? pattern.flags : `${pattern.flags}g`;
  const regex = new RegExp(pattern.source, flags);
  const matches: RegExpExecArray[] = [];
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    matches.push(match);
    if (!match[0]) regex.lastIndex += 1;
  }
  return matches;
}

@Provide()
export class UserIdentityMemoryService {
  @InjectEntityModel(UserIdentityProfileEntity)
  identityModel: MongoRepository<UserIdentityProfileEntity>;

  @InjectEntityModel(MessageEntity)
  messageModel: MongoRepository<MessageEntity>;

  @InjectEntityModel(UserKnownPersonEntity)
  knownPersonModel: MongoRepository<UserKnownPersonEntity>;

  @Inject()
  userRelativeProfileService: UserRelativeProfileService;

  async recordFromUserMessage(
    message: MessageEntity,
    sourceText: string
  ): Promise<void> {
    await this.recordUserIdentity({
      userId: message.userId,
      agentId: message.agentId,
      messageId: message.id,
      sourceText,
    });
    await this.recordKnownPeople({
      userId: message.userId,
      agentId: message.agentId,
      messageId: message.id,
      sourceText,
    });
  }

  /** Project only the approved user's identity; do not re-extract other people. */
  async recordApprovedUserIdentity(message: MessageEntity, sourceText: string, identity: { realName?: string; aliases?: string[] }, isCorrection = false): Promise<void> {
    await this.recordUserIdentity({ userId: message.userId, agentId: message.agentId, messageId: message.id, sourceText, sourceOccurredAt: message.createdAt, validatedIdentity: identity, validatedSource: isCorrection ? 'explicit_chat_correction' : 'explicit_chat_statement' });
  }

  async getUserIdentity(
    userId: MongoObjectId
  ): Promise<UserIdentityPromptProfile | null> {
    const profile = await this.identityModel.findOne({ where: { userId } });

    if (!profile) return null;

    return {
      realName: profile.realName?.trim() || undefined,
      formerNames: this.unique(
        (profile.formerNames || []).map(item => item.value)
      ),
      aliases: this.unique(profile.aliases || []),
    };
  }

  async listRelevantKnownPeople(options: {
    userId: MongoObjectId;
    query: string;
    recentTexts?: string[];
    limit?: number;
  }): Promise<UserKnownPersonPromptProfile[]> {
    const mentionText = [
      options.query,
      ...(options.recentTexts || []).slice(-2),
    ]
      .filter(Boolean)
      .join('\n');

    if (!mentionText.trim()) return [];

    const people = await this.knownPersonModel.find({
      where: {
        userId: options.userId,
        status: UserKnownPersonStatus.active,
      },
      order: { updatedAt: 'DESC' },
      take: 64,
    });

    return people
      .filter(person =>
        this.unique([person.realName, ...(person.aliases || [])]).some(
          name => name.length >= 2 && mentionText.includes(name)
        )
      )
      .slice(0, Math.max(1, Math.min(options.limit || 4, 8)))
      .map(person => ({
        id: `person:${person.id.toString()}`,
        ...(person.preferredName?.trim()
          ? { preferredName: person.preferredName.trim() }
          : {}),
        realName: person.realName?.trim() || undefined,
        aliases: this.unique(person.aliases || []),
        relationToUser: person.relationToUser?.trim() || undefined,
      }));
  }

  private async recordUserIdentity(options: {
    userId: MongoObjectId;
    agentId: MongoObjectId;
    messageId: MongoObjectId;
    sourceText: string;
    sourceOccurredAt?: Date;
    validatedIdentity?: { realName?: string; aliases?: string[] };
    validatedSource?: UserIdentityNameSource;
  }): Promise<void> {
    const extracted = options.validatedIdentity ? {
      canonicalName: options.validatedIdentity.realName,
      explicitAliases: options.validatedIdentity.aliases || [],
      derivedAliases: [],
      preferredName: undefined,
    } : extractUserNameMemory(options.sourceText);
    const globalExplicitAliases = extracted.explicitAliases.filter(
      alias => alias !== extracted.preferredName
    );

    if (!extracted.canonicalName && !globalExplicitAliases.length) return;

    const now = new Date();
    const source: UserIdentityNameSource = options.validatedSource || (isExplicitCanonicalNameReplacement(
      options.sourceText,
      'user'
    )
      ? 'explicit_chat_correction'
      : 'explicit_chat_statement');

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const existing = await this.identityModel.findOne({
        where: { userId: options.userId },
      });
      if (existing && options.sourceOccurredAt) {
        const sameSource = String(existing.sourceMessageId || '') === String(options.messageId);
        if (sameSource) {
          // One message may contain separate approved name and alias decisions.
          // Deduplicate the payload, not the whole message.
          if ((!extracted.canonicalName || extracted.canonicalName === existing.realName) &&
              globalExplicitAliases.every(alias => alias === existing.realName || existing.aliases?.includes(alias))) return;
        } else {
          const source = existing.sourceMessageId ? await this.messageModel.findOne({ where: { _id: existing.sourceMessageId, userId: options.userId } as never }) : null;
          // Compare event times inside the CAS retry, not the time a backfill ran.
          if ((source?.createdAt || existing.updatedAt) > options.sourceOccurredAt) return;
        }
      }
      const nextAliases = this.unique([
        ...(existing?.aliases || []),
        ...extracted.derivedAliases,
        ...globalExplicitAliases,
      ]).filter(name => name !== (extracted.canonicalName || existing?.realName));

      if (!existing) {
        const profile = new UserIdentityProfileEntity();
        Object.assign(profile, {
          userId: options.userId,
          realName: extracted.canonicalName,
          formerNames: [],
          aliases: nextAliases,
          version: USER_IDENTITY_PROFILE_VERSION,
          source,
          sourceAgentId: options.agentId,
          sourceMessageId: options.messageId,
          sourceText: options.sourceText.slice(0, 500),
          createdAt: now,
          updatedAt: now,
        });
        try {
          await this.identityModel.save(profile);
          return;
        } catch (error) {
          if (attempt === 1) throw error;
          continue;
        }
      }

      const formerNames: UserIdentityFormerName[] = [
        ...(existing.formerNames || []),
      ];
      if (
        extracted.canonicalName &&
        existing.realName &&
        extracted.canonicalName !== existing.realName &&
        !formerNames.some(item => item.value === existing.realName)
      ) {
        formerNames.push({
          value: existing.realName,
          supersededAt: now,
          sourceMessageId: options.messageId,
        });
      }
      const update = {
        ...(extracted.canonicalName
          ? { realName: extracted.canonicalName }
          : {}),
        formerNames: formerNames.slice(-12),
        aliases: nextAliases,
        version: USER_IDENTITY_PROFILE_VERSION,
        source,
        sourceAgentId: options.agentId,
        sourceMessageId: options.messageId,
        sourceText: options.sourceText.slice(0, 500),
        updatedAt: now,
      };
      const result = await this.identityModel.updateOne(
        { _id: existing.id, updatedAt: existing.updatedAt },
        { $set: update } as never
      );

      if (result.modifiedCount === 1) return;
    }

    throw new Error('User identity concurrent update did not converge');
  }

  private async recordKnownPeople(options: {
    userId: MongoObjectId;
    agentId: MongoObjectId;
    messageId: MongoObjectId;
    sourceText: string;
  }): Promise<void> {
    const declarations = extractKnownPersonDeclarations(options.sourceText);
    for (const declaration of declarations) {
      await this.upsertKnownPersonDeclaration({ ...options, declaration });
    }
  }

  async upsertKnownPersonDeclaration(options: {
    userId: MongoObjectId;
    agentId: MongoObjectId;
    messageId: MongoObjectId;
    sourceText: string;
    declaration: KnownPersonDeclaration;
  }): Promise<UserKnownPersonEntity> {
    const { declaration } = options;
    const people = this.knownPersonModel.find
      ? await this.knownPersonModel.find({
          where: {
            userId: options.userId,
            status: UserKnownPersonStatus.active,
          },
          order: { updatedAt: 'DESC' },
          take: 128,
        })
      : [];
    const incomingNames = new Set(
      this.unique([declaration.realName, ...declaration.aliases]).map(value =>
        value.toLowerCase()
      )
    );
    const relation = normalizeRelation(declaration.relationToUser);
    const nameMatches = people.filter(person =>
      this.unique([
        person.realName,
        person.preferredName,
        ...(person.aliases || []),
      ]).some(name => incomingNames.has(name.toLowerCase()))
    );
    let existing = declaration.linkedAgentId
      ? people.find(
          person =>
            person.linkedAgentId?.toString() ===
            declaration.linkedAgentId?.toString()
        )
      : undefined;
    existing ||= nameMatches.find(
      person => normalizeRelation(person.relationToUser || '') === relation
    );
    // P1-6: 删除 nameMatches.length===1 的跨关系回退合并——
    // 只按名字相同就合并容易把甲的信息挂到乙身上，必须"同名 + 同关系"才合并。
    if (!existing && declaration.linkedAgentId) {
      const sameRelation = people.filter(
        person => normalizeRelation(person.relationToUser || '') === relation
      );
      const compatible = sameRelation.filter(
        person =>
          !declaration.realName ||
          !person.realName ||
          person.realName === declaration.realName
      );
      if (compatible.length) existing = compatible[0];
    }

    const now = new Date();
    if (existing) {
      const aliases = this.unique([
        ...(existing.aliases || []),
        existing.realName !== declaration.realName
          ? existing.realName
          : undefined,
        ...declaration.aliases,
      ]).filter(value => value !== declaration.realName);
      existing.realName = declaration.realName || existing.realName;
      existing.preferredName = declaration.aliases[0] || existing.preferredName;
      existing.aliases = aliases;
      existing.relationToUser = declaration.relationToUser;
      if (!existing.linkedAgentId) {
        existing.linkedAgentId = declaration.linkedAgentId;
      }
      existing.sourceAgentId = options.agentId;
      existing.sourceMessageId = options.messageId;
      existing.sourceText = options.sourceText.slice(0, 500);
      existing.updatedAt = now;
      await this.knownPersonModel.save(existing);
    } else {
      existing = new UserKnownPersonEntity();
      Object.assign(existing, {
        userId: options.userId,
        identityKey: `person:${randomUUID()}`,
        realName: declaration.realName,
        preferredName: declaration.aliases[0],
        aliases: this.unique(declaration.aliases).filter(
          value => value !== declaration.realName
        ),
        relationToUser: declaration.relationToUser,
        linkedAgentId: declaration.linkedAgentId,
        status: UserKnownPersonStatus.active,
        sourceAgentId: options.agentId,
        sourceMessageId: options.messageId,
        sourceText: options.sourceText.slice(0, 500),
        createdAt: now,
        updatedAt: now,
      });
      await this.knownPersonModel.save(existing);
    }

    await this.userRelativeProfileService?.ensureForKnownPerson({
      userId: options.userId,
      personId: existing.id,
      relationToUser: declaration.relationToUser,
      sourceMessageId: options.messageId,
      sourceText: options.sourceText,
    });
    return existing;
  }

  async resolveKnownPersonReference(options: {
    userId: MongoObjectId;
    referenceName?: string;
    relationToUser?: string;
  }): Promise<UserKnownPersonEntity | null> {
    const people = await this.knownPersonModel.find({
      where: {
        userId: options.userId,
        status: UserKnownPersonStatus.active,
      },
      order: { updatedAt: 'DESC' },
      take: 128,
    });
    const reference = options.referenceName?.trim().toLowerCase();
    const relation = normalizeRelation(options.relationToUser || '');
    const matches = people.filter(person => {
      const nameMatched = reference
        ? this.unique([
            person.realName,
            person.preferredName,
            ...(person.aliases || []),
          ]).some(name => name.toLowerCase() === reference)
        : true;
      const relationMatched = relation
        ? normalizeRelation(person.relationToUser || '') === relation
        : true;
      return nameMatched && relationMatched;
    });
    return matches.length === 1 ? matches[0] : null;
  }

  async resolveKnownPersonMention(options: {
    userId: MongoObjectId;
    mention: string;
  }): Promise<UserKnownPersonEntity | null> {
    const mention = options.mention?.trim().toLowerCase();
    if (!mention) return null;
    const people = await this.knownPersonModel.find({
      where: {
        userId: options.userId,
        status: UserKnownPersonStatus.active,
      },
      order: { updatedAt: 'DESC' },
      take: 128,
    });
    const ranked = people
      .map(person => {
        const names = this.unique([
          person.realName,
          person.preferredName,
          ...(person.aliases || []),
        ]).map(value => value.toLowerCase());
        const relation = (person.relationToUser || '').trim().toLowerCase();
        const exactName = names.some(name => name === mention);
        const containedName = names.some(
          name => name.length >= 2 && mention.includes(name)
        );
        const exactRelation = Boolean(relation && relation === mention);
        const containedRelation = Boolean(
          relation && relation.length >= 2 && mention.includes(relation)
        );
        const score = exactName
          ? 100
          : containedName
          ? 80
          : exactRelation
          ? 60
          : containedRelation
          ? 40
          : 0;
        return { person, score };
      })
      .filter(item => item.score > 0)
      .sort((left, right) => right.score - left.score);
    if (!ranked.length) return null;
    const best = ranked[0].score;
    const bestMatches = ranked.filter(item => item.score === best);
    return bestMatches.length === 1 ? bestMatches[0].person : null;
  }

  async countKnownPeopleByRelation(
    userId: MongoObjectId,
    relationToUser: string
  ): Promise<number> {
    const relation = normalizeRelation(relationToUser);
    const people = await this.knownPersonModel.find({
      where: { userId, status: UserKnownPersonStatus.active },
      take: 128,
    });
    return people.filter(
      person => normalizeRelation(person.relationToUser || '') === relation
    ).length;
  }

  private unique(values: Array<string | undefined>): string[] {
    return Array.from(
      new Set(values.map(value => value?.trim()).filter(Boolean) as string[])
    );
  }
}

export function extractKnownPersonDeclarations(
  sourceText: string
): KnownPersonDeclaration[] {
  const text = (sourceText || '').replace(/\s+/g, '').trim();
  if (!text || /[?？]/.test(text)) return [];

  const declarations: Array<{
    realName?: string;
    alias?: string;
    relationToUser?: string;
  }> = [];
  const aliasNameRelation = new RegExp(
    `(?:^|(?<=[，,。；;]))(${PERSON_NAME})(?:名字)?叫(${PERSON_NAME})[，,]?(?:是|就是)我(?:的)?(${RELATION})(?=$|[，,。；;])`,
    'g'
  );
  const relationName = new RegExp(
    `(?:^|(?<=[，,。；;]))我(?:的)?(${RELATION})(?:名字)?(?:叫|名叫|是)(${PERSON_NAME})(?=$|[，,。；;])`,
    'g'
  );
  const nameRelation = new RegExp(
    `(?:^|(?<=[，,。；;]))(${PERSON_NAME})(?:是|就是)我(?:的)?(${RELATION})(?=$|[，,。；;])`,
    'g'
  );

  for (const match of collectRegexMatches(text, aliasNameRelation)) {
    declarations.push({
      alias: normalizePersonName(match[1]),
      realName: normalizePersonName(match[2]),
      relationToUser: match[3],
    });
  }
  for (const match of collectRegexMatches(text, relationName)) {
    declarations.push({
      realName: normalizePersonName(match[2]),
      relationToUser: match[1],
    });
  }
  for (const match of collectRegexMatches(text, nameRelation)) {
    declarations.push({
      realName: normalizePersonName(match[1]),
      relationToUser: match[2],
    });
  }

  const byKey = new Map<string, KnownPersonDeclaration>();
  for (const declaration of declarations) {
    const realName = declaration.realName;
    const alias = declaration.alias;
    const relation = declaration.relationToUser?.trim();
    if (!relation || (!realName && !alias)) continue;
    const anchor = realName || alias;
    if (!anchor) continue;
    const identityKey = `${normalizeRelation(
      relation
    )}|${anchor.toLowerCase()}`;
    const prior = byKey.get(identityKey);
    byKey.set(identityKey, {
      identityKey,
      realName: realName || prior?.realName,
      aliases: Array.from(
        new Set([...(prior?.aliases || []), alias].filter(Boolean) as string[])
      ),
      relationToUser: relation,
    });
  }

  return [...byKey.values()];
}

function normalizePersonName(value?: string): string | undefined {
  const name = (value || '').replace(/[，,。！？!?；;：:、]/g, '').trim();
  if (
    !name ||
    name.length > 12 ||
    NON_PERSON_NAMES.has(name) ||
    NON_PERSON_OCCUPATION_BLACKLIST.has(name) ||
    /(?:什么|哪个|谁|不是|是不是)/.test(name)
  ) {
    return undefined;
  }
  return name;
}

function normalizeRelation(value: string): string {
  const aliases: Record<string, string> = {
    爸: '爸爸',
    父亲: '爸爸',
    妈: '妈妈',
    母亲: '妈妈',
    老公: '丈夫',
    老婆: '妻子',
    外婆: '姥姥',
    外公: '姥爷',
  };
  return aliases[value] || value;
}
