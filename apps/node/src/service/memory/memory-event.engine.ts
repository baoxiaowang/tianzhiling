import { Logger, Provide } from '@midwayjs/core';
import { ILogger } from '@midwayjs/logger';
import { InjectEntityModel } from '@midwayjs/typeorm';
import {
  MemoryEventGroupEntity,
  MemoryEventGroupMember,
  MemoryEventGroupStatus,
  MemoryOpenItemEntity,
  MemoryOpenItemState,
  MessageEntity,
  MessageRole,
  MongoObjectId,
} from '@tzl/entities';
import { MongoRepository } from 'typeorm';
import { isFactBearingUtterance, kinshipTermsIn } from '../agents/memory-value';
import {
  resolvePrimaryTopicKey,
  resolveTopicKeys,
} from '../agents/memory-topics';
import {
  buildGroupKey,
  buildGroupTitle,
  buildOpenItemFingerprint,
  EVENT_GROUP_MAX_GAP_MS,
  hashMessageText,
  resolveGroupAssignment,
} from './memory-grouping';
import {
  buildOpenItemSummary,
  nextOpenItemState,
  resolveItemTopicKey,
  resolveOpenItemObservation,
} from './memory-open-item.rules';
import { isPastOnlyStatement } from './memory-open-item-extraction';
import {
  SAME_MATTER_MENTION_SCORE,
  scoreOpenItemMention,
} from './memory-return-turn';
import type {
  OpenItemCandidate,
  OpenItemTopicKey,
} from './memory-open-item-extraction';
import type {
  MemoryCapabilities,
  MemoryEvidence,
  MemoryIngestRequest,
  MemoryIngestResult,
  MemoryMaintenanceAction,
  MemoryMaintenanceResult,
  MemoryModule,
  MemoryOpenItemView,
  MemoryOpenItemsRequest,
  MemoryOpenItemsResult,
  MemoryRecallRequest,
  MemoryRecallResult,
  MemoryUpdateOpenItemRequest,
  MemoryUpdateOpenItemResult,
} from './memory-module.types';

export const EVENT_MEMORY_ENGINE = 'event_v1' as const;

const MAX_ACTIVE_GROUPS_SCANNED = 40;
const MAX_GROUPS_EXPANDED = 2;
const MAX_GROUP_MEMBERS = 6;
const MAX_EVIDENCE_PER_RECALL = 8;
const RECALL_BUDGET_MS = 1200;
const REBUILD_MESSAGE_LIMIT = 3000;
/** 每人最多保留 5 条活跃的未了结事项：清单要像"最近惦记的几件事"，不能是流水账。 */
const MAX_ACTIVE_OPEN_ITEMS = 5;
/**
 * 两句话是不是同一件事（同一件事的不同说法、或其中一条没带主体时靠它兜底）。
 * 主体没提到（模型没给 subjectRef）或者换了个说法时，光比话题+主体会漏，
 * 于是同一件事长出好几条。门槛与回复记账用的是同一个，避免两边判断不一致。
 */
function isSameOpenItemMatter(left: string, right: string): boolean {
  if (!left || !right) return false;
  return scoreOpenItemMention(left, right) >= SAME_MATTER_MENTION_SCORE;
}

/**
 * 新提取的这一句，是不是已有条目那件事：
 * 日子类单独一套——"纪念日"只跟"纪念日"比，同一句话被归到"纪念日"和"家人"两边时
 * 两边各自留在自己的清单里（并了就会把日子从"记得的日子"里抹掉）；
 * 其余类别之间：主体相同就直接算同一件，主体没提或换了说法时看内容像不像，
 * 而且两边都明确说了不同的人（"我"和"妈妈"）时不算同一件。
 * 跨类别也要并能比：同一句话可能会被抽成"家人"和"关系矛盾"两条，那是同一件事，
 * 留在清单里就会被问两遍。
 */
function isSameOpenItem(
  item: Pick<MemoryOpenItemEntity, 'topicKey' | 'subjectRef' | 'summary'>,
  candidate: Pick<OpenItemCandidate, 'topicKey' | 'subjectRef'>,
  summary: string
): boolean {
  const itemIsCalendar = item.topicKey === '纪念日';
  const candidateIsCalendar = candidate.topicKey === '纪念日';
  if (itemIsCalendar || candidateIsCalendar) {
    return (
      itemIsCalendar &&
      candidateIsCalendar &&
      isSameOpenItemMatter(summary, item.summary)
    );
  }
  const sameSubject =
    normalizeSubject(item.subjectRef) ===
    normalizeSubject(candidate.subjectRef);
  // 同类同主体：一定是同一件（哪怕这句话换了说法）
  if (item.topicKey === candidate.topicKey && sameSubject) return true;
  // 两边都点了不同的人：不是同一件，不再往下比内容
  if (item.subjectRef && candidate.subjectRef && !sameSubject) return false;
  // 其余情况看内容：换说法、少了个称呼、被抽到两个类别，都要能认出来
  return isSameOpenItemMatter(summary, item.summary);
}

const OPEN_ITEM_ACTIVE_STATES: MemoryOpenItemState[] = [
  'reported',
  'awaiting_result',
  'action_committed',
];

interface GroupQueryWindow {
  topicKey?: string;
  topicKeys?: string[];
  from?: Date;
  to?: Date;
}

/**
 * 事件组合引擎（v1）。
 * 做：把"事实型原话"聚成事件组合；按组合检索并展开成员原话；维护未了结条目。
 * 不做：完整的双时间戳与生效区间、跨会话历史关联（留给 v2）。
 */
@Provide()
export class MemoryEventEngine implements MemoryModule {
  @Logger()
  logger: ILogger;

  @InjectEntityModel(MemoryEventGroupEntity)
  groupModel: MongoRepository<MemoryEventGroupEntity>;

  @InjectEntityModel(MemoryOpenItemEntity)
  itemModel: MongoRepository<MemoryOpenItemEntity>;

  @InjectEntityModel(MessageEntity)
  messageModel: MongoRepository<MessageEntity>;

  capabilities(): MemoryCapabilities {
    return {
      engine: EVENT_MEMORY_ENGINE,
      supports: {
        events: true,
        openItems: true,
        timeIntervals: false,
        shadowRecord: true,
        rebuild: true,
        audit: true,
      },
      limits: {
        maxEvidencePerRecall: MAX_EVIDENCE_PER_RECALL,
        maxGroupMembers: MAX_GROUP_MEMBERS,
        recallBudgetMs: RECALL_BUDGET_MS,
      },
    };
  }

  async ingest(request: MemoryIngestRequest): Promise<MemoryIngestResult> {
    const userId = toObjectId(request.userId);
    if (!userId) return { status: 'failed', reason: 'invalid_user' };
    const conversationId = toObjectId(request.conversationId) || userId;
    const agentId = toObjectId(request.agentId) || conversationId;
    const now = request.now || new Date();
    const groupIds: string[] = [];
    let processed = 0;

    for (const message of request.messages || []) {
      const messageId = toObjectId(message.messageId);
      const text = (message.content || '').trim();
      if (!messageId || !text) continue;
      // 进门过滤：组合只收事实型原话；未了结清单另走自己的信号判断
      // （"下周去复查"未必命中事实信号，但它确实是一件没完的事）。
      const factBearing =
        isFactBearingUtterance(text) && !isPastOnlyStatement(text);
      const observation = resolveOpenItemObservation(text);
      if (!factBearing && !observation) continue;

      // 话题键与"是不是事实型"无关地照抽：清单的状态判定要按同一话题对齐。
      const topicKey = resolvePrimaryTopicKey(text);
      // 清单只看"具体事项"（就医、学业、工作……），纪念日和闲聊不成条目。
      const itemTopicKey = resolveItemTopicKey(text);
      if (!topicKey && !observation) continue;
      // 主体只在原话里明确点出某位亲人时才标注；不推断身份、不做消歧。
      // 开头的称呼是"说话对象"（"爸爸，大儿今天又抽烟了"），不是这件事说的人。
      const subjectRef = resolveSubjectRef(text);

      try {
        const groupId =
          factBearing && topicKey
            ? await this.attachToGroup({
                engine: EVENT_MEMORY_ENGINE,
                userId,
                conversationId,
                agentId,
                topicKey,
                subjectRef,
                text,
                messageId,
                occurredAt: message.occurredAt || now,
                now,
              })
            : undefined;
        if (groupId) groupIds.push(groupId);
        if (groupId || observation) processed += 1;
        // 未了结清单只由离线模型判定写入（applyExtractedOpenItems）；
        // v1 的规则路径实测噪声高（把回忆、别人状态当成待办），默认关闭，用
        // NODE_MEMORY_OPEN_ITEM_RULES=1 可临时打开做对照。
        if (process.env.NODE_MEMORY_OPEN_ITEM_RULES === '1') {
          await this.applyOpenItemObservation({
            userId,
            conversationId,
            agentId,
            itemTopicKey,
            subjectRef,
            text,
            messageId,
            occurredAt: message.occurredAt || now,
            groupId,
            now,
          });
        }
      } catch (error) {
        this.logger?.warn?.(
          '[memory] event group ingest failed, userId=%s messageId=%s reason=%s',
          request.userId,
          message.messageId,
          describeError(error)
        );
        return { status: 'failed', reason: describeError(error), groupIds };
      }
    }

    return {
      status: processed ? 'accepted' : 'skipped',
      groupIds,
      ...(processed ? {} : { reason: 'no_fact_bearing_message' }),
    };
  }

  async recall(request: MemoryRecallRequest): Promise<MemoryRecallResult> {
    const startedAt = Date.now();
    const userId = toObjectId(request.userId);
    const limit = Math.max(
      1,
      Math.min(
        request.limit || MAX_EVIDENCE_PER_RECALL,
        MAX_EVIDENCE_PER_RECALL
      )
    );
    if (!userId) {
      return {
        evidence: [],
        status: 'skipped',
        diagnostics: {
          engine: EVENT_MEMORY_ENGINE,
          mode: 'active',
          candidateCount: 0,
          selectedCount: 0,
          skipReason: 'invalid_user',
        },
      };
    }

    const topicKeys = resolveTopicKeys(request.currentUserText || '');
    if (!topicKeys.length) {
      // 抽不出话题键就不检索：这一步与现有检索键策略一致。
      return {
        evidence: [],
        status: 'skipped',
        diagnostics: {
          engine: EVENT_MEMORY_ENGINE,
          mode: 'active',
          candidateCount: 0,
          selectedCount: 0,
          skipReason: 'no_topic_key',
        },
      };
    }

    const groups = await this.listGroups(userId, {
      topicKeys,
      to: request.now || new Date(),
    });
    const expanded = groups.slice(0, MAX_GROUPS_EXPANDED);
    const memberIds: string[] = [];
    for (const group of expanded) {
      for (const member of group.members.slice(-MAX_GROUP_MEMBERS)) {
        const id = stringifyObjectId(member.messageId);
        if (id && memberIds.indexOf(id) === -1) memberIds.push(id);
      }
    }

    const textById = await this.loadUserMessageTexts(memberIds, {
      userId,
      excludeMessageIds: request.currentTurnMessageIds || [],
    });

    const excluded = new Set(request.currentTurnMessageIds || []);
    const evidence: MemoryEvidence[] = [];
    for (const group of expanded) {
      evidence.push({
        id: `group:${stringifyObjectId(group.id)}`,
        kind: 'group_summary',
        text: group.title,
        occurredAt: group.spanTo.toISOString(),
        sourceMessageIds: group.members
          .map(member => stringifyObjectId(member.messageId))
          .filter(Boolean),
        groupId: stringifyObjectId(group.id),
        groupTitle: group.title,
        ...(group.subjectRef ? { personRef: group.subjectRef } : {}),
        // 组合摘要只能当背景：任何可断言内容必须回原话。
        assertPolicy: 'context',
        engine: EVENT_MEMORY_ENGINE,
      });

      const members = group.members
        .slice()
        .sort(
          (left, right) =>
            right.occurredAt.getTime() - left.occurredAt.getTime()
        );
      for (const member of members) {
        const id = stringifyObjectId(member.messageId);
        const text = textById.get(id);
        if (!id || !text || excluded.has(id)) continue;
        evidence.push({
          id: `member:${id}`,
          kind: 'group_member',
          text,
          role: 'user',
          occurredAt: member.occurredAt.toISOString(),
          sourceMessageIds: [id],
          groupId: stringifyObjectId(group.id),
          groupTitle: group.title,
          ...(group.subjectRef ? { personRef: group.subjectRef } : {}),
          assertPolicy: 'quote',
          engine: EVENT_MEMORY_ENGINE,
        });
      }
    }

    const selected = evidence.slice(0, limit + 1);
    return {
      evidence: selected,
      status: selected.length ? 'ok' : 'empty',
      diagnostics: {
        engine: EVENT_MEMORY_ENGINE,
        mode: 'active',
        candidateCount: memberIds.length,
        selectedCount: selected.length,
        groupCount: expanded.length,
        elapsedMs: Date.now() - startedAt,
      },
    };
  }

  async listOpenItems(
    request: MemoryOpenItemsRequest
  ): Promise<MemoryOpenItemsResult> {
    const userId = toObjectId(request.userId);
    if (!userId) {
      return {
        items: [],
        status: 'failed',
        diagnostics: {
          engine: EVENT_MEMORY_ENGINE,
          total: 0,
          errorCode: 'invalid_user',
        },
      };
    }
    const where: Record<string, unknown> = {
      userId,
      engine: EVENT_MEMORY_ENGINE,
      state: { $in: OPEN_ITEM_ACTIVE_STATES },
    };
    if (!request.includeCalendar) where.topicKey = { $ne: '纪念日' };
    const items = await this.itemModel.find({
      where: where as never,
      order: { lastRaisedAt: 'ASC', updatedAt: 'DESC' } as never,
      take: 20,
    });
    return {
      items: items.map(toOpenItemView),
      status: items.length ? 'ok' : 'empty',
      diagnostics: { engine: EVENT_MEMORY_ENGINE, total: items.length },
    };
  }

  async updateOpenItem(
    request: MemoryUpdateOpenItemRequest
  ): Promise<MemoryUpdateOpenItemResult> {
    const itemId = toObjectId(request.itemId);
    if (!itemId) return { status: 'not_found' };
    const item = await this.itemModel.findOne({
      where: { _id: itemId, engine: EVENT_MEMORY_ENGINE } as never,
    });
    if (!item) return { status: 'not_found' };

    const now = request.now || new Date();
    const next: MemoryOpenItemEntity = { ...item };

    if (request.raised) {
      // 提问记账：只记"提出了"，不改状态、不写状态历史。
      // 同一轮重试会重复调用这里，所以 10 分钟内只算一次，避免"问过"被多加。
      const lastRaisedAt = item.lastRaisedAt ? item.lastRaisedAt.getTime() : 0;
      if (now.getTime() - lastRaisedAt > 10 * 60 * 1000) {
        next.lastRaisedAt = now;
        next.raisedCount = (item.raisedCount || 0) + 1;
      }
    }

    if (request.state && request.state !== item.state) {
      const event = {
        state: request.state,
        changedAt: now,
        ...(request.evidenceMessageId
          ? { evidenceMessageId: toObjectId(request.evidenceMessageId) }
          : {}),
        source: request.source || ('offline_extraction' as const),
      };
      next.state = request.state;
      next.stateHistory = [...(item.stateHistory || []), event];
    }

    next.updatedAt = now;
    await this.itemModel.save(next);
    return { status: 'updated', item: toOpenItemView(next) };
  }

  async maintain(
    request: MemoryMaintenanceAction
  ): Promise<MemoryMaintenanceResult> {
    try {
      switch (request.action) {
        case 'rebuild':
          return await this.rebuild(request.userId, request.fromMessageAt);
        case 'regroup':
          return await this.regroup(request.userId, {
            groupIds: request.groupIds,
            fromMessageAt: request.fromMessageAt,
          });
        case 'forget':
          return await this.forget(request);
        case 'inspect':
          return await this.inspect(request.userId);
        case 'purgeUser':
          return await this.purgeUser(request.userId);
        default:
          return { status: 'failed', detail: { reason: 'unknown_action' } };
      }
    } catch (error) {
      return { status: 'failed', detail: { reason: describeError(error) } };
    }
  }

  // ---- 以下是本引擎的内部实现 ----

  private async attachToGroup(options: {
    engine: string;
    userId: MongoObjectId;
    conversationId: MongoObjectId;
    agentId: MongoObjectId;
    topicKey: string;
    subjectRef?: string;
    text: string;
    messageId: MongoObjectId;
    occurredAt: Date;
    now: Date;
  }): Promise<string | undefined> {
    const candidates = await this.listGroups(options.userId, {
      topicKey: options.topicKey,
      from: new Date(options.occurredAt.getTime() - EVENT_GROUP_MAX_GAP_MS),
      to: new Date(options.occurredAt.getTime() + 24 * 60 * 60 * 1000),
    });

    // 幂等：这条原话已经在某个组合里，就不再重复挂。
    const existing = candidates.find(group =>
      group.members.some(
        member =>
          stringifyObjectId(member.messageId) ===
          stringifyObjectId(options.messageId)
      )
    );
    if (existing) return stringifyObjectId(existing.id);

    const assignment = resolveGroupAssignment({
      topicKey: options.topicKey,
      subjectRef: options.subjectRef,
      occurredAt: options.occurredAt,
      candidates: candidates.map(group => ({
        groupId: stringifyObjectId(group.id),
        topicKey: group.topicKey,
        subjectRef: group.subjectRef,
        spanTo: group.spanTo,
      })),
    });

    const member: MemoryEventGroupMember = {
      messageId: options.messageId,
      occurredAt: options.occurredAt,
      textHash: hashMessageText(options.text),
      preview: options.text.slice(0, 40),
    };

    if (assignment.action === 'join') {
      const target = candidates.find(
        group => stringifyObjectId(group.id) === assignment.groupId
      );
      if (target) {
        const members = [...target.members, member];
        target.members = members;
        target.spanFrom = new Date(
          Math.min(target.spanFrom.getTime(), options.occurredAt.getTime())
        );
        target.spanTo = new Date(
          Math.max(target.spanTo.getTime(), options.occurredAt.getTime())
        );
        target.title = buildGroupTitle({
          topicKey: target.topicKey,
          subjectRef: target.subjectRef,
          memberCount: members.length,
        });
        target.updatedAt = options.now;
        await this.groupModel.save(target);
        return stringifyObjectId(target.id);
      }
    }

    const created: MemoryEventGroupEntity = {
      schemaVersion: 'memory_event_group_v1',
      engine: options.engine,
      userId: options.userId,
      conversationId: options.conversationId,
      agentId: options.agentId,
      topicKey: options.topicKey,
      ...(options.subjectRef ? { subjectRef: options.subjectRef } : {}),
      title: buildGroupTitle({
        topicKey: options.topicKey,
        subjectRef: options.subjectRef,
        memberCount: 1,
      }),
      status: MemoryEventGroupStatus.active,
      members: [member],
      spanFrom: options.occurredAt,
      spanTo: options.occurredAt,
      groupKey: buildGroupKey({
        engine: options.engine,
        userId: stringifyObjectId(options.userId),
        topicKey: options.topicKey,
        subjectRef: options.subjectRef,
        spanFrom: options.occurredAt,
      }),
      createdAt: options.now,
      updatedAt: options.now,
    } as MemoryEventGroupEntity;

    const saved = await this.groupModel.save(created);
    return stringifyObjectId(saved.id) || undefined;
  }

  private async listGroups(
    userId: MongoObjectId,
    window: GroupQueryWindow
  ): Promise<MemoryEventGroupEntity[]> {
    const topicKeys =
      window.topicKeys || (window.topicKey ? [window.topicKey] : []);
    const where: Record<string, unknown> = {
      userId,
      engine: EVENT_MEMORY_ENGINE,
      status: MemoryEventGroupStatus.active,
    };
    if (topicKeys.length === 1) where.topicKey = topicKeys[0];
    if (topicKeys.length > 1) where.topicKey = { $in: topicKeys };
    if (window.from) where.spanTo = { $gte: window.from };
    if (window.to) where.spanFrom = { $lte: window.to };

    const groups = await this.groupModel.find({
      where: where as never,
      order: { spanTo: 'DESC' } as never,
      take: MAX_ACTIVE_GROUPS_SCANNED,
    });
    return groups;
  }

  private async loadUserMessageTexts(
    messageIds: string[],
    options: { userId: MongoObjectId; excludeMessageIds: string[] }
  ): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    const ids = messageIds
      .filter(id => MongoObjectId.isValid(id))
      .map(id => new MongoObjectId(id));
    if (!ids.length) return result;

    // 必须用 _id：本项目的 TypeORM MongoDB 版本不会把 where.id 映射成 _id。
    const messages = await this.messageModel.find({
      where: {
        _id: { $in: ids },
        userId: options.userId,
        role: MessageRole.user,
        isArchived: { $ne: true },
      } as never,
    });
    const excluded = new Set(options.excludeMessageIds);
    for (const message of messages) {
      const id = stringifyObjectId(message.id);
      const text = (message.content || '').trim();
      if (!id || !text || excluded.has(id)) continue;
      result.set(id, text);
    }
    return result;
  }

  /**
   * 离线抽取：从这条原话里判断"有没有一件没完的事"，并推进状态。
   * 只有用户原话明确支持了结才了结；含糊的保持"还没结果"。
   */
  private async applyOpenItemObservation(options: {
    userId: MongoObjectId;
    conversationId: MongoObjectId;
    agentId: MongoObjectId;
    /** 清单自己的话题（纪念日等不算），可能为空：空时只看"刚问过的那一件"。 */
    itemTopicKey?: string;
    subjectRef?: string;
    text: string;
    messageId: MongoObjectId;
    occurredAt: Date;
    groupId?: string;
    now: Date;
  }): Promise<void> {
    const observation = resolveOpenItemObservation(options.text);
    if (!observation) return;

    const where: Record<string, unknown> = {
      userId: options.userId,
      engine: EVENT_MEMORY_ENGINE,
      state: { $in: OPEN_ITEM_ACTIVE_STATES },
    };
    if (options.itemTopicKey) where.topicKey = options.itemTopicKey;
    let active = await this.itemModel.find({
      where: where as never,
      take: 50,
    });
    const sameSubject = (item: MemoryOpenItemEntity) =>
      normalizeSubject(item.subjectRef) ===
      normalizeSubject(options.subjectRef);

    // 用户说"别问了"却没说哪件事：落到这段对话里刚刚被提起的那一件上。
    if (observation.dismissed && !options.itemTopicKey) {
      const conversationId = stringifyObjectId(options.conversationId);
      active = active
        .filter(
          item => stringifyObjectId(item.conversationId) === conversationId
        )
        .sort(
          (left, right) =>
            (right.lastRaisedAt ? right.lastRaisedAt.getTime() : 0) -
            (left.lastRaisedAt ? left.lastRaisedAt.getTime() : 0)
        )
        .slice(0, 1);
    }

    // 了结或不再提：只改状态，不新建条目。
    if (observation.resolved || observation.dismissed) {
      for (const item of active.filter(sameSubject)) {
        const state = nextOpenItemState({ current: item.state, observation });
        if (!state) continue;
        item.state = state;
        item.stateHistory = [
          ...(item.stateHistory || []),
          {
            state,
            changedAt: options.now,
            evidenceMessageId: options.messageId,
            source: 'offline_extraction' as const,
          },
        ];
        item.updatedAt = options.now;
        await this.itemModel.save(item);
      }
      return;
    }

    const existingActive = active.find(sameSubject);

    if (existingActive) {
      const next = nextOpenItemState({
        current: existingActive.state,
        observation,
      });
      if (next) {
        existingActive.state = next;
        existingActive.stateHistory = [
          ...(existingActive.stateHistory || []),
          {
            state: next,
            changedAt: options.now,
            evidenceMessageId: options.messageId,
            source: 'offline_extraction' as const,
          },
        ];
      }
      const sources = (existingActive.sourceMessageIds || []).map(
        stringifyObjectId
      );
      if (sources.indexOf(stringifyObjectId(options.messageId)) === -1) {
        existingActive.sourceMessageIds = [
          ...existingActive.sourceMessageIds,
          options.messageId,
        ];
      }
      existingActive.updatedAt = options.now;
      await this.itemModel.save(existingActive);
      return;
    }

    const fingerprint = buildOpenItemFingerprint({
      engine: EVENT_MEMORY_ENGINE,
      userId: stringifyObjectId(options.userId),
      topicKey: options.itemTopicKey || '其他',
      subjectRef: options.subjectRef,
      content: options.text,
      occurredAt: options.occurredAt,
    });
    const duplicated = await this.itemModel.findOne({
      where: { fingerprint, engine: EVENT_MEMORY_ENGINE } as never,
    });
    if (duplicated) return;

    const created = {
      schemaVersion: 'memory_open_item_v1',
      engine: EVENT_MEMORY_ENGINE,
      userId: options.userId,
      conversationId: options.conversationId,
      agentId: options.agentId,
      ...(options.groupId ? { groupId: toObjectId(options.groupId) } : {}),
      topicKey: options.itemTopicKey || '其他',
      ...(options.subjectRef ? { subjectRef: options.subjectRef } : {}),
      summary: buildOpenItemSummary(options.text),
      state: 'awaiting_result' as MemoryOpenItemState,
      stateHistory: [
        {
          state: 'awaiting_result' as MemoryOpenItemState,
          changedAt: options.now,
          evidenceMessageId: options.messageId,
          source: 'offline_extraction' as const,
        },
      ],
      importance: observation.importance,
      raisedCount: 0,
      sourceMessageIds: [options.messageId],
      fingerprint,
      createdAt: options.now,
      updatedAt: options.now,
    } as MemoryOpenItemEntity;

    await this.itemModel.save(created);
  }

  /**
   * 写入离线模型判定出来的未了结条目（门面之外的引擎能力，供离线抽取任务调用）。
   * 同一事项+同一主体只保留一条活跃条目；每人最多 5 条；证据只追加。
   */
  async applyExtractedOpenItems(options: {
    userId: string;
    conversationId: string;
    agentId: string;
    candidates: Array<OpenItemCandidate & { occurredAt: Date }>;
    now?: Date;
  }): Promise<{ created: number; updated: number; skipped: number }> {
    const userId = toObjectId(options.userId);
    if (!userId)
      return { created: 0, updated: 0, skipped: options.candidates.length };
    const now = options.now || new Date();
    const active = await this.itemModel.find({
      where: {
        userId,
        engine: EVENT_MEMORY_ENGINE,
        state: { $in: OPEN_ITEM_ACTIVE_STATES },
      } as never,
      take: 50,
    });

    let created = 0;
    let updated = 0;
    let skipped = 0;

    for (const candidate of options.candidates || []) {
      const summary = buildOpenItemSummary(candidate.quote);
      // 纪念日是"日子"，不是待跟进的事：照常存，但不占待跟进清单的名额。
      const isCalendar = candidate.topicKey === '纪念日';
      // 同一件事只留一条。先比"同类同主体"，再比"两句话说的是不是同一件事"——
      // 主体没提出来（模型没给 subjectRef）、或者同一件事换了说法时，光比前者会漏。
      // 但两边都明确说了不同的人（"我"和"妈妈"），就不是同一件事，不能并。
      // 日子类不按话题+主体并：三七、五七、百天、生日本来就是一件一件不同的日子，
      // 只有"说的是同一个日子"（指纹相同）才算同一条，否则等于把日子丢了。
      const existing = isCalendar
        ? undefined
        : active.find(item => isSameOpenItem(item, candidate, summary));

      if (existing) {
        await this.mergeOpenItemCandidate(existing, candidate, now);
        updated += 1;
        continue;
      }

      if (!isCalendar && active.length >= MAX_ACTIVE_OPEN_ITEMS) {
        skipped += 1;
        continue;
      }

      const fingerprint = buildOpenItemFingerprint({
        engine: EVENT_MEMORY_ENGINE,
        userId: options.userId,
        topicKey: candidate.topicKey,
        subjectRef: candidate.subjectRef,
        content: summary,
        occurredAt: candidate.occurredAt,
      });
      const duplicated = await this.itemModel.findOne({
        where: { fingerprint, engine: EVENT_MEMORY_ENGINE } as never,
      });
      if (duplicated) {
        // 指纹相同就是同一件事：活跃的补证据，已经了结/过期的重新开工（状态历史留痕）。
        // 不再另起一条，否则同一件事有两份冷却，模型会把它反复端上来问。
        const duplicatedIsActive =
          OPEN_ITEM_ACTIVE_STATES.indexOf(duplicated.state) !== -1;
        const canReopen = isCalendar || active.length < MAX_ACTIVE_OPEN_ITEMS;
        if (duplicatedIsActive || canReopen) {
          await this.mergeOpenItemCandidate(duplicated, candidate, now);
          if (active.indexOf(duplicated) === -1) active.push(duplicated);
          updated += 1;
          continue;
        }
        skipped += 1;
        continue;
      }

      const entity = {
        schemaVersion: 'memory_open_item_v1',
        engine: EVENT_MEMORY_ENGINE,
        userId,
        conversationId: toObjectId(options.conversationId) || userId,
        agentId: toObjectId(options.agentId) || userId,
        topicKey: candidate.topicKey as OpenItemTopicKey,
        ...(candidate.subjectRef ? { subjectRef: candidate.subjectRef } : {}),
        summary: buildOpenItemSummary(candidate.quote),
        state: candidate.state,
        stateHistory: [
          {
            state: candidate.state,
            changedAt: now,
            evidenceMessageId: toObjectId(candidate.messageId),
            source: 'offline_extraction' as const,
          },
        ],
        importance: isCalendar ? 1 : candidate.importance,
        raisedCount: 0,
        sourceMessageIds: [toObjectId(candidate.messageId) || userId],
        fingerprint,
        createdAt: now,
        updatedAt: now,
      } as MemoryOpenItemEntity;

      // 用 save 的返回值：它带上了落库后的 id，同一批里的下一条才能认出
      // "这就是刚才写的那条"，不然同一件事会被写两遍。
      const saved = await this.itemModel.save(entity);
      active.push(saved);
      created += 1;
    }

    return { created, updated, skipped };
  }

  /**
   * 把新提取到的一句话并进已有条目：证据只追加，状态变了才写历史。
   * 已经了结/过期的条目被重新提起时，等于这件事新开一轮：
   * 提起次数清零（否则它带着上一轮的账，算不出"还没问过"），状态历史留痕。
   */
  private async mergeOpenItemCandidate(
    item: MemoryOpenItemEntity,
    candidate: OpenItemCandidate & { occurredAt: Date },
    now: Date
  ): Promise<void> {
    const sources = (item.sourceMessageIds || []).map(stringifyObjectId);
    if (sources.indexOf(candidate.messageId) === -1) {
      item.sourceMessageIds = [
        ...(item.sourceMessageIds || []),
        toObjectId(candidate.messageId) || item.userId,
      ];
    }
    if (item.state !== candidate.state) {
      const wasActive = OPEN_ITEM_ACTIVE_STATES.indexOf(item.state) !== -1;
      const nextActive =
        OPEN_ITEM_ACTIVE_STATES.indexOf(candidate.state) !== -1;
      item.state = candidate.state;
      item.stateHistory = [
        ...(item.stateHistory || []),
        {
          state: candidate.state,
          changedAt: now,
          evidenceMessageId: toObjectId(candidate.messageId),
          source: 'offline_extraction' as const,
        },
      ];
      if (!wasActive && nextActive) item.raisedCount = 0;
    }
    item.updatedAt = now;
    await this.itemModel.save(item);
  }

  private async rebuild(
    userId?: string,
    fromMessageAt?: Date
  ): Promise<MemoryMaintenanceResult> {
    if (!userId)
      return { status: 'failed', detail: { reason: 'userId_required' } };
    const userObjectId = toObjectId(userId);
    if (!userObjectId) {
      return { status: 'failed', detail: { reason: 'invalid_user' } };
    }

    // 重建 = 清掉未纠正的派生物 + 按原话顺序重跑写入。纠正过的组合保留。
    const groups = await this.groupModel.find({
      where: { userId: userObjectId, engine: EVENT_MEMORY_ENGINE } as never,
    });
    const removable = groups.filter(group => !group.corrected);
    for (const group of removable) {
      await this.groupModel.delete({ _id: group.id } as never);
    }

    const messages = await this.messageModel.find({
      where: {
        userId: userObjectId,
        role: MessageRole.user,
        isArchived: { $ne: true },
        ...(fromMessageAt ? { createdAt: { $gte: fromMessageAt } } : {}),
      } as never,
      order: { createdAt: 'ASC' } as never,
      take: REBUILD_MESSAGE_LIMIT,
    });

    let affected = 0;
    for (const message of messages) {
      const conversationId = stringifyObjectId(message.conversationId);
      const agentId = stringifyObjectId(message.agentId);
      if (!conversationId || !agentId) continue;
      const ingested = await this.ingest({
        userId,
        conversationId,
        agentId,
        messages: [
          {
            messageId: stringifyObjectId(message.id),
            content: message.content || '',
            occurredAt: message.createdAt,
          },
        ],
      });
      affected += ingested.groupIds?.length || 0;
    }

    return {
      status: 'ok',
      affected,
      detail: { messages: messages.length, removedGroups: removable.length },
    };
  }

  private async regroup(
    userId: string,
    options: { groupIds?: string[]; fromMessageAt?: Date }
  ): Promise<MemoryMaintenanceResult> {
    const userObjectId = toObjectId(userId);
    if (!userObjectId) {
      return { status: 'failed', detail: { reason: 'invalid_user' } };
    }
    const where: Record<string, unknown> = {
      userId: userObjectId,
      engine: EVENT_MEMORY_ENGINE,
    };
    if (options.groupIds?.length) {
      const ids = options.groupIds
        .filter(id => MongoObjectId.isValid(id))
        .map(id => new MongoObjectId(id));
      where._id = { $in: ids };
    } else if (options.fromMessageAt) {
      where.spanTo = { $gte: options.fromMessageAt };
    }
    const groups = await this.groupModel.find({ where: where as never });
    for (const group of groups) {
      await this.groupModel.delete({ _id: group.id } as never);
    }
    const rebuilt = await this.rebuild(userId, options.fromMessageAt);
    return {
      status: rebuilt.status,
      affected: rebuilt.affected,
      detail: { removed: groups.length, ...(rebuilt.detail || {}) },
    };
  }

  private async forget(request: {
    userId: string;
    evidenceIds?: string[];
    groupIds?: string[];
    messageIds?: string[];
  }): Promise<MemoryMaintenanceResult> {
    const userId = toObjectId(request.userId);
    if (!userId)
      return { status: 'failed', detail: { reason: 'invalid_user' } };

    const removedMessageIds = [
      ...(request.messageIds || []),
      ...(request.evidenceIds || [])
        .map(id => id.replace(/^member:/u, ''))
        .filter(id => id.indexOf('group:') !== 0),
    ]
      .map(id => id.trim())
      .filter(id => MongoObjectId.isValid(id));
    const explicitGroups = (request.groupIds || []).filter(id =>
      MongoObjectId.isValid(id)
    );

    let affected = 0;
    const groups = await this.groupModel.find({
      where: { userId, engine: EVENT_MEMORY_ENGINE } as never,
    });
    for (const group of groups) {
      const groupId = stringifyObjectId(group.id);
      const shouldDropGroup = explicitGroups.indexOf(groupId) !== -1;
      const members = group.members.filter(
        member =>
          removedMessageIds.indexOf(stringifyObjectId(member.messageId)) === -1
      );
      if (!shouldDropGroup && members.length === group.members.length) continue;

      affected += 1;
      if (shouldDropGroup || !members.length) {
        await this.groupModel.delete({ _id: group.id } as never);
        continue;
      }
      group.members = members;
      group.title = buildGroupTitle({
        topicKey: group.topicKey,
        subjectRef: group.subjectRef,
        memberCount: members.length,
      });
      group.spanFrom = members[0].occurredAt;
      group.spanTo = members[members.length - 1].occurredAt;
      group.updatedAt = new Date();
      await this.groupModel.save(group);
    }

    // 清单级联：证据被删空的条目一并删除，还有证据的重算来源。
    if (removedMessageIds.length) {
      const items = await this.itemModel.find({
        where: { userId, engine: EVENT_MEMORY_ENGINE } as never,
      });
      for (const item of items) {
        const sources = (item.sourceMessageIds || [])
          .map(stringifyObjectId)
          .filter(id => id && removedMessageIds.indexOf(id) === -1);
        if (!sources.length) {
          await this.itemModel.delete({ _id: item.id } as never);
          affected += 1;
          continue;
        }
        if (sources.length !== item.sourceMessageIds.length) {
          item.sourceMessageIds = sources.map(id => new MongoObjectId(id));
          item.updatedAt = new Date();
          await this.itemModel.save(item);
          affected += 1;
        }
      }
    }

    return { status: 'ok', affected };
  }

  private async inspect(userId: string): Promise<MemoryMaintenanceResult> {
    const userObjectId = toObjectId(userId);
    if (!userObjectId) {
      return { status: 'failed', detail: { reason: 'invalid_user' } };
    }
    const groups = await this.groupModel.find({
      where: { userId: userObjectId, engine: EVENT_MEMORY_ENGINE } as never,
      order: { spanTo: 'DESC' } as never,
      take: 50,
    });
    const items = await this.itemModel.find({
      where: { userId: userObjectId, engine: EVENT_MEMORY_ENGINE } as never,
      take: 50,
    });
    return {
      status: 'ok',
      affected: groups.length + items.length,
      detail: {
        groups: groups.map(group => ({
          id: stringifyObjectId(group.id),
          topicKey: group.topicKey,
          title: group.title,
          members: group.members.length,
          spanFrom: group.spanFrom,
          spanTo: group.spanTo,
          corrected: Boolean(group.corrected),
        })),
        openItems: items.map(item => ({
          id: stringifyObjectId(item.id),
          topicKey: item.topicKey,
          state: item.state,
          summary: item.summary,
        })),
      },
    };
  }

  private async purgeUser(userId: string): Promise<MemoryMaintenanceResult> {
    const userObjectId = toObjectId(userId);
    if (!userObjectId) {
      return { status: 'failed', detail: { reason: 'invalid_user' } };
    }
    const groups = await this.groupModel.delete({
      userId: userObjectId,
      engine: EVENT_MEMORY_ENGINE,
    } as never);
    const items = await this.itemModel.delete({
      userId: userObjectId,
      engine: EVENT_MEMORY_ENGINE,
    } as never);
    return {
      status: 'ok',
      affected: (groups?.affected || 0) + (items?.affected || 0),
    };
  }
}

/** 取这句话真正在说的那位亲人；开头的称呼语不算。 */
export function resolveSubjectRef(text: string): string | undefined {
  for (const term of kinshipTermsIn(text)) {
    const index = text.indexOf(term);
    if (index < 0) continue;
    if (isAddresseePosition(text, term, index)) continue;
    return term;
  }
  return undefined;
}

function isAddresseePosition(
  text: string,
  term: string,
  index: number
): boolean {
  if (index > 2) return false;
  const after = text.slice(index + term.length, index + term.length + 1);
  return !after || /[\s，,、。.!！?？:：~～]/u.test(after);
}

function toOpenItemView(item: MemoryOpenItemEntity): MemoryOpenItemView {
  return {
    id: stringifyObjectId(item.id),
    ...(item.groupId ? { groupId: stringifyObjectId(item.groupId) } : {}),
    topicKey: item.topicKey,
    summary: item.summary,
    ...(item.subjectRef ? { subjectRef: item.subjectRef } : {}),
    state: item.state,
    stateHistory: item.stateHistory || [],
    importance: item.importance,
    ...(item.dueAt ? { dueAt: item.dueAt.toISOString() } : {}),
    ...(item.lastRaisedAt
      ? { lastRaisedAt: item.lastRaisedAt.toISOString() }
      : {}),
    raisedCount: item.raisedCount || 0,
    sourceMessageIds: (item.sourceMessageIds || []).map(stringifyObjectId),
    updatedAt: item.updatedAt
      ? item.updatedAt.toISOString()
      : new Date(0).toISOString(),
  };
}

function normalizeSubject(value?: string): string {
  return (value || '').trim().toLowerCase();
}

function toObjectId(value?: string): MongoObjectId | undefined {
  const text = (value || '').trim();
  return text && MongoObjectId.isValid(text)
    ? new MongoObjectId(text)
    : undefined;
}

function stringifyObjectId(value?: unknown): string {
  if (!value) return '';
  if (typeof value === 'string') return value;
  const candidate = value as {
    toHexString?: () => string;
    toString?: () => string;
  };
  if (typeof candidate.toHexString === 'function')
    return candidate.toHexString();
  return typeof candidate.toString === 'function' ? candidate.toString() : '';
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
