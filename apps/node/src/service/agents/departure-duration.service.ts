import { Provide, Logger } from '@midwayjs/core';
import { ILogger } from '@midwayjs/logger';
import { InjectEntityModel } from '@midwayjs/typeorm';
import { MongoRepository } from 'typeorm';
import { AgentEntity, AgentProfileFactEntity, MongoObjectId } from '@tzl/entities';

/**
 * 离世时长预计算队列名
 */
export const DEPARTURE_DURATION_QUEUE = 'departure-duration';

/**
 * 离世时长预计算服务
 *
 * 核心思路：把"每轮实时计算"变成"每日批量预计算，每轮直接读取"。
 * - 绝对日期锚点存在 AgentEntity.deathDate（固定不变）
 * - 离世时长字符串预计算后存在 AgentEntity.departureDuration（每轮直接用）
 * - 节点提醒存在 AgentEntity.nodeReminder
 * - 每日凌晨3点增量计算活跃用户，每月1号全量计算
 */
@Provide()
export class DepartureDurationService {
  @Logger()
  logger: ILogger;

  @InjectEntityModel(AgentEntity)
  agentModel: MongoRepository<AgentEntity>;

  @InjectEntityModel(AgentProfileFactEntity)
  factModel: MongoRepository<AgentProfileFactEntity>;

  /**
   * 按精度分级格式化离世时长
   * 越久越宽泛：0-7天精确到天，5年以上精确到5年/10年
   */
  formatDuration(days: number, precision: 'exact' | 'inferred' | 'vague'): string {
    if (days < 0) return '即将到来';

    // vague 精度：只输出宽泛表述，不精确到年月
    if (precision === 'vague') {
      if (days < 365) return '不久前';
      const years = Math.floor(days / 365);
      if (years < 3) return '几年前';
      if (years < 5) return '三四年前';
      if (years < 10) return '七八年前';
      if (years < 20) return '十几年前';
      if (years < 30) return '二十多年前';
      return '几十年前';
    }

    const prefix = precision === 'inferred' ? '大约' : '';

    // 0-7天：精确到天
    if (days <= 1) return prefix + '昨天';
    if (days <= 2) return prefix + '前天';
    if (days <= 7) return prefix + `${days}天前`;

    // 7-30天：精确到周
    if (days <= 30) {
      const weeks = Math.floor(days / 7);
      if (weeks <= 1) return prefix + '一周前';
      return prefix + `${weeks}周前`;
    }

    // 1-6个月：精确到月
    const months = Math.floor(days / 30);
    if (months <= 6) {
      if (months === 1) return prefix + '一个月前';
      return prefix + `${months}个月前`;
    }

    // 6个月-2年：精确到半年
    if (days <= 365 * 2) {
      const halfYears = Math.round(days / 182.5);
      if (halfYears <= 2) return prefix + '一年前';
      if (halfYears <= 3) return prefix + '一年半前';
      return prefix + '两年前';
    }

    // 2-5年：精确到年
    const years = Math.floor(days / 365);
    if (years <= 5) return prefix + `${years}年前`;

    // 5年以上：精确到5年/10年（即使 exact 精度也放宽，因为用户自己也记不清）
    if (years < 10) return '七八年前';
    if (years < 15) return '十几年前';
    if (years < 20) return '十五六年前';
    if (years < 30) return '二十多年前';
    return '几十年前';
  }

  /**
   * 检查未来7天内是否有重要节点
   * 返回节点提醒字符串，无节点返回 null
   */
  checkNodeReminder(deathDate: Date): string | null {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const deathDay = new Date(deathDate.getFullYear(), deathDate.getMonth(), deathDate.getDate());

    // 计算今年的忌日
    const thisYearAnniversary = new Date(today.getFullYear(), deathDay.getMonth(), deathDay.getDate());
    const daysToAnniversary = Math.ceil((thisYearAnniversary.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

    // 总离世天数
    const totalDays = Math.floor((today.getTime() - deathDay.getTime()) / (1000 * 60 * 60 * 24));

    // 头七（第7天）
    if (totalDays >= 0 && totalDays <= 7) {
      if (totalDays === 7) return '今天是头七';
      if (totalDays === 6) return '明天是头七';
      if (totalDays >= 4) return `${7 - totalDays}天后是头七`;
    }

    // 五七（第35天）
    if (totalDays >= 30 && totalDays <= 35) {
      if (totalDays === 35) return '今天是五七';
      if (totalDays === 34) return '明天是五七';
      return `${35 - totalDays}天后是五七`;
    }

    // 百日（第100天）
    if (totalDays >= 95 && totalDays <= 100) {
      if (totalDays === 100) return '今天是百日';
      if (totalDays === 99) return '明天是百日';
      return `${100 - totalDays}天后是百日`;
    }

    // 周年（未来7天内）
    if (daysToAnniversary >= 0 && daysToAnniversary <= 7) {
      const years = today.getFullYear() - deathDay.getFullYear();
      const yearLabel = years === 1 ? '一周年' : `${years}周年`;
      if (daysToAnniversary === 0) return `今天是${yearLabel}`;
      if (daysToAnniversary === 1) return `明天是${yearLabel}`;
      return `${daysToAnniversary}天后是${yearLabel}`;
    }

    return null;
  }

  /**
   * 读取 agent 的离世时间精度标记
   * 从 agent_profile_fact 中读取 departure_time 的 precision 字段
   */
  async getPrecision(agentId: string): Promise<'exact' | 'inferred' | 'vague'> {
    try {
      const fact = await this.factModel.findOne({
        where: {
          agentId: new MongoObjectId(agentId),
          key: 'departure_time',
          status: 'active',
        },
      });
      if (fact?.value && typeof fact.value === 'object') {
        const v = fact.value as any;
        if (v.precision === 'exact' || v.precision === 'inferred' || v.precision === 'vague') {
          return v.precision;
        }
      }
    } catch (error) {
      this.logger.warn(
        '[departure-duration] read precision failed, agentId=%s, reason=%s',
        agentId,
        error instanceof Error ? error.message : String(error)
      );
    }
    // 默认 exact（deathDate 有值通常意味着用户设置了具体日期）
    return 'exact';
  }

  /**
   * 计算单个 agent 的离世时长并写回
   */
  async computeForAgent(agentId: string): Promise<boolean> {
    try {
      const agent = await this.agentModel.findOne({
        where: { _id: new MongoObjectId(agentId) } as never,
      });
      if (!agent || !agent.deathDate) {
        return false;
      }

      const now = new Date();
      const days = Math.floor((now.getTime() - agent.deathDate.getTime()) / (1000 * 60 * 60 * 24));
      const precision = await this.getPrecision(agentId);
      const duration = this.formatDuration(days, precision);
      const nodeReminder = this.checkNodeReminder(agent.deathDate);

      agent.departureDuration = duration;
      agent.nodeReminder = nodeReminder;
      agent.departureDurationComputedAt = now;
      agent.updatedAt = now;
      await this.agentModel.save(agent);

      return true;
    } catch (error) {
      this.logger.error(
        '[departure-duration] computeForAgent failed, agentId=%s, reason=%s',
        agentId,
        error instanceof Error ? error.message : String(error)
      );
      return false;
    }
  }

  /**
   * 每日增量预计算：只计算最近7天有消息的活跃用户
   * 由每天凌晨3点的定时任务调用
   */
  async computeForActiveUsers(): Promise<{ computed: number; skipped: number; durationMs: number }> {
    const startTime = Date.now();
    this.logger.info('[departure-duration] daily incremental computation started');

    try {
      // 查最近7天有更新的 agent（活跃用户的 agent 会因为聊天而更新 updatedAt）
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const agents = await this.agentModel.find({
        where: {
          deathDate: { $ne: null } as any,
          updatedAt: { $gte: sevenDaysAgo } as any,
        } as any,
      } as any);

      let computed = 0;
      let skipped = 0;

      for (const agent of agents) {
        const agentId = (agent as any)._id?.toString() || (agent as any).id?.toString();
        if (!agentId) {
          skipped++;
          continue;
        }
        const success = await this.computeForAgent(agentId);
        if (success) computed++;
        else skipped++;
      }

      const durationMs = Date.now() - startTime;
      this.logger.info(
        '[departure-duration] daily incremental computation completed, computed=%d, skipped=%d, durationMs=%d',
        computed,
        skipped,
        durationMs
      );

      return { computed, skipped, durationMs };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      this.logger.error(
        '[departure-duration] daily incremental computation failed, reason=%s, durationMs=%d',
        error instanceof Error ? error.message : String(error),
        durationMs
      );
      return { computed: 0, skipped: 0, durationMs };
    }
  }

  /**
   * 每月全量预计算：计算所有有 deathDate 的 agent
   * 由每月1号凌晨3点的定时任务调用
   */
  async computeForAll(): Promise<{ computed: number; skipped: number; durationMs: number }> {
    const startTime = Date.now();
    this.logger.info('[departure-duration] monthly full computation started');

    try {
      const agents = await this.agentModel.find({
        where: {
          deathDate: { $ne: null } as any,
        } as any,
      } as any);

      let computed = 0;
      let skipped = 0;

      for (const agent of agents) {
        const agentId = (agent as any)._id?.toString() || (agent as any).id?.toString();
        if (!agentId) {
          skipped++;
          continue;
        }
        const success = await this.computeForAgent(agentId);
        if (success) computed++;
        else skipped++;
      }

      const durationMs = Date.now() - startTime;
      this.logger.info(
        '[departure-duration] monthly full computation completed, computed=%d, skipped=%d, durationMs=%d',
        computed,
        skipped,
        durationMs
      );

      return { computed, skipped, durationMs };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      this.logger.error(
        '[departure-duration] monthly full computation failed, reason=%s, durationMs=%d',
        error instanceof Error ? error.message : String(error),
        durationMs
      );
      return { computed: 0, skipped: 0, durationMs };
    }
  }
}
