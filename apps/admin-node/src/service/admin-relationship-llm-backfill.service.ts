import { Inject, Logger, Provide } from '@midwayjs/core';
import { ILogger } from '@midwayjs/logger';
import { InjectEntityModel } from '@midwayjs/typeorm';
import {
  AgentEntity,
  MessageEntity,
  MessageRole,
  MessageType,
  MongoObjectId,
  OrderEntity,
  OrderStatus,
} from '@tzl/entities';
import { MongoRepository } from 'typeorm';
import { AdminLlmService } from './admin-llm.service';

/**
 * 订单关系 LLM 回填服务。
 *
 * 对于付款时未能通过关键词/记忆/iCallAgent 识别关系的订单，
 * 每月末批量调用大模型分析用户与智能体的聊天内容，推断关系并写入 order.relationship。
 *
 * 关系是稳定属性：识别一次后不再自动更新，用户纠错时才会覆盖。
 */
@Provide()
export class AdminRelationshipLlmBackfillService {
  @Logger()
  logger: ILogger;

  @Inject()
  llm: AdminLlmService;

  @InjectEntityModel(OrderEntity)
  orderModel: MongoRepository<OrderEntity>;

  @InjectEntityModel(MessageEntity)
  messageModel: MongoRepository<MessageEntity>;

  @InjectEntityModel(AgentEntity)
  agentModel: MongoRepository<AgentEntity>;

  /** 每次分析取最近多少条用户消息 */
  private readonly RECENT_MESSAGES_LIMIT = 50;

  /** 单次任务最多处理多少个 (userId, agentId) 对，避免单次运行过久 */
  private readonly MAX_PAIRS_PER_RUN = 200;

  /** 关系标签白名单（与 OrderRelationshipService 保持一致） */
  private readonly RELATIONSHIP_TAGS = [
    '父女',
    '父子',
    '母女',
    '母子',
    '爷孙',
    '奶孙',
    '夫妻',
    '恋人',
    '兄妹',
    '姐弟',
    '姐妹',
    '兄弟',
  ];

  /**
   * 执行一次批量回填。
   * 返回统计信息：处理对数、识别成功数、更新订单数。
   */
  async run(options?: { limit?: number }): Promise<{
    pairsTotal: number;
    pairsIdentified: number;
    ordersUpdated: number;
    details: Array<{
      userId: string;
      agentId: string;
      agentName?: string;
      relationship: string;
      ordersUpdated: number;
    }>;
  }> {
    const limit = options?.limit ?? this.MAX_PAIRS_PER_RUN;

    // 1. 查询所有未识别关系的已付款订单，按 (userId, agentId) 分组
    const unresolvedOrders = await this.orderModel.find({
      where: {
        paidAt: { $ne: null } as never,
        status: { $in: [OrderStatus.paid, OrderStatus.completed] } as never,
        $or: [
          { relationship: { $exists: false } as never },
          { relationship: '' },
          { relationship: null },
        ],
      } as never,
      select: ['_id', 'userId', 'agentId', 'paidAt'] as never,
      take: 2000,
    });

    if (!unresolvedOrders.length) {
      this.logger.info('[relationship-llm] no unresolved orders, skip');
      return { pairsTotal: 0, pairsIdentified: 0, ordersUpdated: 0, details: [] };
    }

    // 按 userId+agentId 分组
    const pairMap = new Map<string, Array<MongoObjectId>>();
    for (const order of unresolvedOrders) {
      if (!order.agentId) continue; // 无关联智能体的订单（如VIP升级）无法分析聊天
      const key = `${order.userId.toString()}_${order.agentId.toString()}`;
      if (!pairMap.has(key)) pairMap.set(key, []);
      pairMap.get(key)!.push(order.id);
    }

    const pairs = Array.from(pairMap.entries()).slice(0, limit);
    this.logger.info(
      '[relationship-llm] start: %d unresolved orders, %d pairs, processing %d',
      unresolvedOrders.length,
      pairMap.size,
      pairs.length
    );

    let pairsIdentified = 0;
    let ordersUpdated = 0;
    const details: Array<{
      userId: string;
      agentId: string;
      agentName?: string;
      relationship: string;
      ordersUpdated: number;
    }> = [];

    // 2. 逐个分析
    for (const [key, orderIds] of pairs) {
      const [userIdStr, agentIdStr] = key.split('_');
      const userId = new (Object.getPrototypeOf(orderIds[0]).constructor)(userIdStr);
      const agentId = new (Object.getPrototypeOf(orderIds[0]).constructor)(agentIdStr);

      try {
        const relationship = await this.inferRelationshipFromChat(userId, agentId);
        if (!relationship) continue;

        // 3. 更新该用户该智能体的所有未识别订单
        const updateResult = await this.orderModel.update(
          {
            _id: { $in: orderIds } as never,
          } as never,
          {
            $set: { relationship } as never,
          } as never
        );

        const updated = (updateResult as unknown as { modifiedCount?: number }).modifiedCount ?? orderIds.length;
        pairsIdentified += 1;
        ordersUpdated += updated;

        const agent = await this.agentModel.findOne({ where: { _id: agentId } as never });
        details.push({
          userId: userIdStr,
          agentId: agentIdStr,
          agentName: agent?.name,
          relationship,
          ordersUpdated: updated,
        });

        this.logger.info(
          '[relationship-llm] identified: userId=%s agent=%s(%s) relationship=%s orders=%d',
          userIdStr,
          agent?.name ?? '?',
          agentIdStr,
          relationship,
          updated
        );
      } catch (err) {
        this.logger.error(
          '[relationship-llm] pair failed: userId=%s agentId=%s err=%s',
          userIdStr,
          agentIdStr,
          (err as Error).message
        );
      }
    }

    this.logger.info(
      '[relationship-llm] done: pairs=%d identified=%d ordersUpdated=%d',
      pairs.length,
      pairsIdentified,
      ordersUpdated
    );

    return { pairsTotal: pairs.length, pairsIdentified, ordersUpdated, details };
  }

  /**
   * 从聊天内容推断关系。
   * 取最近的用户消息，调用大模型分析，返回关系标签或空字符串。
   */
  private async inferRelationshipFromChat(
    userId: MongoObjectId,
    agentId: MongoObjectId
  ): Promise<string> {
    // 查询最近的用户文本消息
    const messages = await this.messageModel.find({
      where: {
        userId,
        agentId,
        role: MessageRole.user,
        type: MessageType.text,
        status: 'sent' as never,
      } as never,
      order: { createdAt: 'DESC' },
      take: this.RECENT_MESSAGES_LIMIT,
      select: ['content', 'createdAt'] as never,
    });

    if (!messages.length) return '';

    // 按时间正序拼接，取最近的内容（控制总长度）
    const sorted = [...messages].reverse();
    const texts: string[] = [];
    let totalChars = 0;
    for (const msg of sorted) {
      const text = (msg.content ?? '').trim();
      if (!text) continue;
      if (totalChars + text.length > 8000) break;
      texts.push(text);
      totalChars += text.length;
    }

    if (!texts.length) return '';

    const chatContent = texts.join('\n');

    const systemPrompt = `你是一个亲属关系分析助手。根据用户与逝去亲人的聊天记录，判断用户与逝者的关系。

只能从以下标签中选择一个：${this.RELATIONSHIP_TAGS.join('、')}。

如果聊天内容不足以判断关系，返回"未知"。
只输出关系标签，不要输出任何解释或其他内容。`;

    const prompt = `以下是用户与逝者的聊天记录（用户发送的消息）：

${chatContent}

请判断用户与逝者的关系。只输出一个关系标签或"未知"。`;

    const result = await this.llm.generateText(prompt, {
      systemPrompt,
      temperature: 0,
    });

    if (!result) return '';

    // 解析模型输出，匹配白名单标签
    const cleaned = result.replace(/[「」""''\s。.,，]/g, '').trim();
    for (const tag of this.RELATIONSHIP_TAGS) {
      if (cleaned.includes(tag)) return tag;
    }

    return '';
  }
}
