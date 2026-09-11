import { Inject, Logger, Provide } from '@midwayjs/core';
import { ILogger } from '@midwayjs/logger';
import { InjectEntityModel } from '@midwayjs/typeorm';
import {
  AgentEntity,
  AgentProfileFactEntity,
  MongoObjectId,
} from '@tzl/entities';
import { MongoRepository } from 'typeorm';

/**
 * 订单关系推断服务。
 *
 * 关系是稳定属性：付款时一次性推断并写入 order.relationship，之后不再自动更新。
 * 三级回退：关键词（智能体档案）→ 记忆事实（agent_profile_fact）→ iCallAgent 称呼映射。
 */
@Provide()
export class OrderRelationshipService {
  @Logger()
  logger: ILogger;

  @InjectEntityModel(AgentEntity)
  agentModel: MongoRepository<AgentEntity>;

  @InjectEntityModel(AgentProfileFactEntity)
  factModel: MongoRepository<AgentProfileFactEntity>;

  /**
   * 推断用户与指定智能体的关系标签。
   * 返回空字符串表示未识别。
   */
  async inferRelationship(
    userId: MongoObjectId,
    agentId?: MongoObjectId
  ): Promise<string> {
    if (!agentId) return '';

    const agent = await this.agentModel.findOne({
      where: { _id: agentId } as never,
    });
    if (!agent) return '';

    // 第一级：关键词匹配（iCallAgent / name / description）
    const fromKeywords = this.inferFromKeywords(agent);
    if (fromKeywords) return fromKeywords;

    // 第二级：记忆事实（覆盖 identity.relationship + type=relationship，active+candidate）
    const fromFacts = await this.inferFromFacts(userId, agentId);
    if (fromFacts) return fromFacts;

    // 第三级：iCallAgent 称呼映射（关键词已覆盖，这里作为兜底确保单字段也能命中）
    const fromCall = this.relationshipFromCall(agent.iCallAgent ?? '');
    if (fromCall) return fromCall;

    return '';
  }

  /** 从智能体档案关键词推断关系 */
  private inferFromKeywords(agent: AgentEntity): string {
    const called = this.firstSegment(agent.iCallAgent);
    const callsUser = this.firstSegment(agent.agentCallMe);
    const text = `${called} ${agent.name ?? ''} ${agent.description ?? ''}`;
    const maleChild = /儿子|弟弟|小宝/.test(callsUser);

    if (/爸爸|父亲|老爸|老爹|爹|爸/.test(text))
      return maleChild ? '父子' : '父女';
    if (/妈妈|母亲|老妈|妈咪|娘|妈/.test(text))
      return maleChild ? '母子' : '母女';
    if (/爷爷|姥爷|外公|外姥|姨爹|嗲嗲/.test(text)) return '爷孙';
    if (/奶奶|姥姥|外婆|阿姨|姑姑|二姨|小姑|姨夫|婆婆/.test(text))
      return '奶孙';
    if (/老公|老婆|丈夫|妻子|先生|夫人|爱人/.test(text)) return '夫妻';
    if (/前任|男朋友|女朋友|恋人/.test(text)) return '恋人';
    if (/哥哥|哥/.test(called))
      return /弟弟|弟/.test(callsUser) ? '兄弟' : '兄妹';
    if (/姐姐|姐/.test(called))
      return /弟弟|弟/.test(callsUser) ? '姐弟' : '姐妹';
    if (/儿子|小宝/.test(callsUser)) return '母子';
    if (/女儿|闺女|姑娘|妞妞/.test(callsUser)) return '母女';
    return '';
  }

  /**
   * 从记忆系统的关系事实中推断关系。
   * 覆盖：
   * - type=identity, key=identity.relationship（规则提取的"当前角色是用户的爸爸"）
   * - type=relationship 的各种 key（"用户与逝去亲人的关系"/"称呼"/"婚姻关系"等）
   * status 同时查 active 和 candidate。
   */
  private async inferFromFacts(
    userId: MongoObjectId,
    agentId: MongoObjectId
  ): Promise<string> {
    const facts = await this.factModel.find({
      where: {
        userId,
        agentId,
        status: { $in: ['active', 'candidate'] } as never,
        $or: [
          { type: 'relationship' },
          { type: 'identity', key: 'identity.relationship' },
        ],
      } as never,
      order: { updatedAt: 'DESC' },
      take: 20,
    });

    if (!facts.length) return '';

    // 1. 优先：直接关系标签（"用户与逝去亲人的关系"，值如"母子"/"父女/父子"）
    const direct = facts.find(f => f.key === '用户与逝去亲人的关系');
    if (direct?.value) {
      const first = direct.value.split(/[\/／、,，\s]/)[0]?.trim();
      if (first && first !== '未知' && first.length <= 4) return first;
    }

    // 2. identity.relationship（规则提取，值如"当前角色是用户的爸爸"）
    const identityRel = facts.find(f => f.key === 'identity.relationship');
    if (identityRel?.value) {
      const match = identityRel.value.match(/当前角色是用户的(.+)/);
      if (match?.[1]) {
        const mapped = this.relationshipFromCall(match[1]);
        if (mapped) return mapped;
      }
    }

    // 3. "称呼"字段映射
    const call = facts.find(f => f.key === '称呼');
    if (call?.value) {
      const mapped = this.relationshipFromCall(call.value);
      if (mapped) return mapped;
    }

    // 4. 其他 relationship 类型事实：尝试从 value 中提取关系词
    for (const fact of facts) {
      if (fact.type !== 'relationship') continue;
      if (fact.key === '用户与逝去亲人的关系' || fact.key === '称呼') continue;
      const mapped = this.relationshipFromCall(fact.value ?? '');
      if (mapped) return mapped;
    }

    return '';
  }

  /** 称呼 → 关系标签（无法判断子女性别时默认女性侧） */
  private relationshipFromCall(call: string): string {
    if (/爸爸|父亲|老爸|老爹|爹|爸/.test(call)) return '父女';
    if (/妈妈|母亲|老妈|妈咪|娘|妈/.test(call)) return '母女';
    if (/爷爷|姥爷|外公|外姥|姨爹|嗲嗲/.test(call)) return '爷孙';
    if (/奶奶|姥姥|外婆|婆婆/.test(call)) return '奶孙';
    if (/老公|老婆|丈夫|妻子|先生|夫人|爱人/.test(call)) return '夫妻';
    if (/哥哥|哥/.test(call)) return '兄妹';
    if (/姐姐|姐/.test(call)) return '姐妹';
    return '';
  }

  private firstSegment(value?: string): string {
    return (
      String(value ?? '')
        .split(/[，,、/]/)[0]
        ?.trim() ?? ''
    );
  }
}
