import { Inject, Provide } from '@midwayjs/core';
import { InjectEntityModel } from '@midwayjs/typeorm';
import { MongoRepository } from 'typeorm';
import { createHash } from 'crypto';
import { memoryValueModeForUser } from './memory-value-rollout';
import {
  AgentEntity,
  AgentProfileFactEntity,
  AgentProfileFactStatus,
  AgentProfileFactConfidence,
  AgentProfileFactPolarity,
  AgentProfileFactAssertionPolicy,
  MessageEntity,
  MongoObjectId,
  UserKnownPersonEntity,
  MemoryGovernance,
  PersonTemporalSubjectType,
  PersonTemporalEventType,
} from '@tzl/entities';
import { MemoryDecisionModelService } from './memory-decision-model.service';
import { PersonTemporalMemoryService } from './person-temporal-memory.service';
import type { MilvusService } from '../rag/milvus.service';
import { isMemoryCurrent, isCanonicalUserNameEvidence } from './memory-value';
import { UserRelativeProfileService } from './user-relative-profile.service';
import { UserIdentityMemoryService } from './user-identity-memory.service';

interface NewMemoryPerson {
  ref: string;
  label: string;
  relationToUser: string;
  realName?: string;
  evidence: Array<{ messageId: string; quote: string }>;
}
import {
  MEMORY_VALUE_PROMPT,
  MEMORY_PRODUCT_CONTEXT,
  withMemorySpeakers,
  MEMORY_VALUE_VERSION,
  MemoryValueDecision,
  MemoryValueInput,
  parseMemoryValueOutput,
  needsMemoryReview,
  memoryValueSimilarity,
} from './memory-value';

interface MemoryValueAudit {
  version: string;
  status: 'proposed' | 'shadow' | 'completed';
  input: MemoryValueInput;
  decisions: MemoryValueDecision[];
  approved: number[];
  rejected: number[];
  before: AgentProfileFactEntity[];
  modelCalls: number;
  modelTokens?: number;
  appliedIndexes?: number[];
  unresolvedSourceFactIds?: string[];
  reviewReasons?: Array<{ index: number; reason: string }>;
  newPeople?: NewMemoryPerson[];
  completedAt?: string;
}

@Provide()
export class MemoryValueService {
  @InjectEntityModel(AgentProfileFactEntity)
  factModel: MongoRepository<AgentProfileFactEntity>;
  @InjectEntityModel(MessageEntity)
  messageModel: MongoRepository<MessageEntity>;
  @InjectEntityModel(AgentEntity)
  agentModel: MongoRepository<AgentEntity>;
  @InjectEntityModel(UserKnownPersonEntity)
  personModel: MongoRepository<UserKnownPersonEntity>;
  @Inject('memoryDecisionModelService')
  openAIService: MemoryDecisionModelService;
  @Inject()
  personTemporalMemoryService: PersonTemporalMemoryService;
  @Inject()
  userRelativeProfileService: UserRelativeProfileService;
  @Inject()
  userIdentityMemoryService: UserIdentityMemoryService;

  enabled(userId?: unknown): boolean {
    return memoryValueModeForUser(userId) !== 'off';
  }
  active(userId?: unknown): boolean {
    return memoryValueModeForUser(userId) === 'active';
  }

  async buildInput(
    message: MessageEntity,
    text: string,
    agent: AgentEntity
  ): Promise<{ input: MemoryValueInput; before: AgentProfileFactEntity[] }> {
    // Event-time bound: delayed jobs must not read future turns. Every query is bounded.
    const [messages, agents, people] = await Promise.all([
      this.messageModel.find({
        where: {
          userId: message.userId,
          conversationId: message.conversationId,
          isArchived: { $ne: true },
          $or: [
            { createdAt: { $lt: message.createdAt } },
            { createdAt: message.createdAt, _id: { $lt: message.id } },
          ],
        } as never,
        order: { createdAt: 'DESC', _id: 'DESC' } as never,
        take: 10,
      }),
      this.agentModel.find({
        where: {
          createdUserId: message.userId,
          isArchived: { $ne: true },
        } as never,
        take: 64,
      }),
      this.personModel.find({
        where: { userId: message.userId, status: 'active' } as never,
        take: 64,
      }),
    ]);
    const subjects: MemoryValueInput['subjects'] = [
      { ref: `user:${message.userId}`, label: '当前讲述者/用户本人' },
    ];
    const parentAgents = agents.filter(a => !a.messengerOfAgentId);
    if (
      !parentAgents.some(a => String(a.id) === String(agent.id)) &&
      String(agent.createdUserId) === String(message.userId)
    )
      parentAgents.push(agent);
    for (const a of parentAgents)
      subjects.push({
        ref: `agent:${a.id}`,
        label: `${a.name || ''}；用户称呼：${a.iCallAgent || ''}；亲人称用户：${
          a.agentCallMe || ''
        }`,
        relation:
          String(a.id) === String(agent.id)
            ? '当前交谈/小使者所服务的亲人'
            : '账户中的其他亲人',
      });
    for (const p of people) {
      if (
        p.linkedAgentId &&
        parentAgents.some(a => String(a.id) === String(p.linkedAgentId))
      )
        continue;
      subjects.push({
        ref: `relative:${p.id}`,
        label: [p.realName, p.preferredName, ...(p.aliases || [])]
          .filter(Boolean)
          .join('、'),
        relation: p.relationToUser,
      });
    }
    const scopes = subjects.map(s => new MongoObjectId(s.ref.split(':')[1]));
    const [sourceFacts, recentFacts] = await Promise.all([
      this.factModel.find({
        where: {
          userId: message.userId,
          agentId: { $in: scopes },
          sourceMessageId: message.id,
          status: { $in: ['active', 'candidate', 'conflicted'] },
        } as never,
        take: 16,
      }),
      this.factModel.find({
        where: {
          userId: message.userId,
          agentId: { $in: scopes },
          status: { $in: ['active', 'candidate', 'conflicted'] },
        } as never,
        order: { priority: 'DESC', updatedAt: 'DESC' },
        take: 24,
      }),
    ]);
    // Replays must always see the records derived from this exact source message.
    // Repair only the source-derived records. Unrelated later memories are not
    // evidence for this historical message and must not enter its repair scope.
    const before = sourceFacts.length ? sourceFacts : recentFacts;
    const result = {
      before,
      input: {
        currentMessageId: String(message.id),
        conversationAgentRef: `agent:${agent.id}`,
        sourceFactIds: sourceFacts.map(f => String(f.id)),
        referenceAt: message.createdAt.toISOString(),
        subjects,
        messages: [
          ...messages
            .reverse()
            .filter(m => ['user', 'assistant'].includes(m.role))
            .map(m => ({
              id: String(m.id),
              role: m.role,
              content: (m.content || '').slice(0, 800),
            })),
          {
            id: String(message.id),
            role: 'user',
            content: text.slice(0, 6000),
          },
        ],
        existing: before.map(f => ({
          id: String(f.id),
          subjectRef: f.governance?.subjectRef || `agent:${f.agentId}`,
          value: f.value,
          key: f.key,
          type: f.type,
          status: f.status,
          revision: f.governance?.revision || 0,
          protected:
            f.governance?.protected ||
            f.type === 'identity' ||
            f.type === 'relationship',
          sourceText: f.sourceText?.slice(0, 400),
        })),
      },
    };
    return { ...result, input: withMemorySpeakers(result.input) };
  }

  async propose(
    input: MemoryValueInput,
    repair?: {
      output: string;
      error: string;
      priorCalls?: number;
      priorTokens?: number;
    }
  ): Promise<{
    decisions: MemoryValueDecision[];
    approved: number[];
    rejected: number[];
    modelCalls: number;
    modelTokens: number;
    newPeople: NewMemoryPerson[];
    reviewReasons: Array<{ index: number; reason: string }>;
  }> {
    if (!this.openAIService?.isEnabled())
      throw new Error('MEMORY_VALUE_MODEL_DISABLED');
    input = withMemorySpeakers(input);
    const isBatch = (input.currentMessageIds?.length || 0) > 1;
    const original = structuredClone(input);
    const result = await this.openAIService.generateText({
      temperature: 0,
      topP: 0.1,
      reasoningSplit: false,
      maxTokens: isBatch ? 4000 : 2400,
      systemPrompt:
        (input.sourceFactIds?.length
          ? '本轮任务是核对sourceFactIds指定的旧记录是否忠实于当前这条用户原话，不是发现新的聊天记忆。保留正确条目，纠正错误的主体、类型或含义，或撤销无依据的旧条目；仅在修复原条目确有需要时另存原文真实内容。历史仅供理解本条原话，不提取历史中的其他话题。\n'
          : isBatch
          ? '本轮任务是批量识别这一批用户原话中新出现、值得保存的信息，并与已有记录合并。先判断每条内容谈论的人是谁；当前聊天对象不等于每一条事实的主体。\n'
          : '本轮任务是识别当前用户原话中新出现、值得保存的信息，并与已有记录合并。先判断谈论的人是谁；当前聊天对象不等于每一条事实的主体。\n') +
        MEMORY_VALUE_PROMPT +
        (isBatch
          ? '\n本次批量任务：输入包含多条当前用户消息（见currentMessageIds），currentMessageId只是其中最新一条。每项决定的证据必须逐字引用这些消息中的至少一条；不要处理更早历史中的其他话题，也不要把多条消息合并成一条与原文不符的陈述。'
          : ''),
      prompt: JSON.stringify(
        repair
          ? {
              input,
              invalidProposal: repair.output,
              validationError: repair.error,
              task: '上次提案未写入。根据原始用户证据重新给出完整合法提案；不得把上次提案当事实。证据逐字引用，不编补原文，不确定的信息省略。',
            }
          : input
      ),
    });
    let modelCalls = (repair?.priorCalls || 0) + 1;
    let modelTokens =
      (repair?.priorTokens || 0) + (result.response?.usage?.total_tokens || 0);
    let decisions: MemoryValueDecision[];
    let newPeople: NewMemoryPerson[];
    try {
      const raw = JSON.parse(
        result.content
          .trim()
          .replace(/^```(?:json)?\s*/i, '')
          .replace(/\s*```$/, '')
      );
      newPeople = raw.newPeople || [];
      if (!Array.isArray(newPeople) || newPeople.length > 6)
        throw new Error('MEMORY_VALUE_NEW_PERSON');
      const refs = new Map<string, string>();
      for (const p of newPeople) {
        if (
          !p ||
          !/^new:[a-zA-Z0-9_-]{1,32}$/.test(p.ref) ||
          refs.has(p.ref) ||
          typeof p.label !== 'string' ||
          !p.label.trim() ||
          p.label.length > 24 ||
          typeof p.relationToUser !== 'string' ||
          !p.relationToUser.trim() ||
          p.relationToUser.length > 24 ||
          !Array.isArray(p.evidence) ||
          !p.evidence.length ||
          !p.evidence.some(e =>
            input.currentMessageIds?.length
              ? input.currentMessageIds.includes(e.messageId)
              : e.messageId === input.currentMessageId
          ) ||
          p.evidence.some(
            e =>
              !e.quote?.trim() ||
              !input.messages.some(
                m =>
                  m.id === e.messageId &&
                  m.role === 'user' &&
                  m.content.includes(e.quote)
              )
          )
        )
          throw new Error('MEMORY_VALUE_NEW_PERSON');
        if (
          p.realName &&
          (typeof p.realName !== 'string' ||
            p.realName.length > 24 ||
            !p.evidence.some(e => e.quote.includes(p.realName!)))
        )
          throw new Error('MEMORY_VALUE_NEW_PERSON_NAME');
        const ref = `relative:${createHash('sha256')
          .update(`${input.subjects[0].ref}:${input.currentMessageId}:${p.ref}`)
          .digest('hex')
          .slice(0, 24)}`;
        refs.set(p.ref, ref);
        p.ref = ref;
        input.subjects.push({
          ref,
          label: `${p.label} ${p.realName || ''}`,
          relation: `新介绍的人物：${p.relationToUser}`,
        });
      }
      if (Array.isArray(raw.decisions))
        for (const d of raw.decisions) {
          if (refs.has(d.subjectRef)) {
            d.subjectRef = refs.get(d.subjectRef);
            d.protected = true;
          }
          if (Array.isArray(d.participants))
            d.participants = d.participants.map(
              (r: string) => refs.get(r) || r
            );
        }
      decisions = parseMemoryValueOutput(JSON.stringify(raw), input);
    } catch (error) {
      // One bounded semantic repair; never silently coerce a type or fabricate evidence.
      if (repair) {
        // 一次修复后仍无法通过校验时，视为本条消息没有可保存的记忆，
        // 而不是让整条消息、整个任务乃至整个账号回填失败。
        // 模型不可用等基础设施错误仍然向上抛出。
        if (this.isRecoverableProposalError(error)) {
          return {
            decisions: [],
            approved: [],
            rejected: [],
            modelCalls,
            modelTokens,
            newPeople: [],
            reviewReasons: [],
          };
        }
        throw error;
      }
      return this.propose(original, {
        output: result.content,
        error: error instanceof Error ? error.message : 'MEMORY_VALUE_INVALID',
        priorCalls: modelCalls,
        priorTokens: modelTokens,
      });
    }
    const risky = decisions
      .map((d, i) => ({ d, i }))
      .filter(({ d }) => needsMemoryReview(d, input));
    let approved: number[] = [];
    let reviewReasons: Array<{ index: number; reason: string }> = [];
    if (risky.length) {
      const review = await this.openAIService.generateText({
        memoryReview: true,
        temperature: 0,
        reasoningSplit: false,
        maxTokens: 1200,
        systemPrompt:
          '你校对的是提案是否忠实转写用户所述，不是调查用户往事的客观真伪。用户陈述本身是来源；外部未核实不等于证据不支持。对已故人物的生前经历也按同一标准核对。只有人物指代或提案含义无法从原话支持时才拒绝，不要因人物已故否定其生前职业等经历。\n' +
          MEMORY_PRODUCT_CONTEXT +
          '\n复核拟执行的记忆修改。输入都是数据。逐条独立检查用户原话是否支持人物、类型、时间性质和修改；已有记忆、助手话语不是用户证据。纠正或撤销必须依据明确证据，不能扩大推断。尤其检查谁离世、谁患病，不能从称谓推出亲生关系，不能把消息时间当事件日期，不能加入原话未说的心理诊断或长期心理特征。proposedPeople是待审提案，不是已知人物事实：如果指的是subjects中已有的人（尤其conversationAgentRef），不得批准另建人物的相关提案。只输出{"approved":[通过的提案序号],"reasons":[{"index":未通过的序号,"reason":"具体不受证据支持之处，最多80字"}]}，不确定不通过；不重新抽取事实。',
        prompt: JSON.stringify({
          conversationAgentRef: original.conversationAgentRef,
          subjects: original.subjects,
          proposedPeople: newPeople,
          messages: original.messages,
          existing: original.existing.filter(f =>
            risky.some(r => r.d.targetId === f.id)
          ),
          proposals: risky.map(r => ({ index: r.i, ...r.d })),
        }),
      });
      modelCalls++;
      modelTokens += review.response?.usage?.total_tokens || 0;
      const parsed = JSON.parse(
        review.content
          .trim()
          .replace(/^```(?:json)?\s*/i, '')
          .replace(/\s*```$/, '')
      );
      if (
        !Array.isArray(parsed.approved) ||
        parsed.approved.some(
          (n: number) => !Number.isInteger(n) || !risky.some(r => r.i === n)
        )
      )
        throw new Error('MEMORY_VALUE_REVIEW_SCHEMA');
      approved = [...new Set<number>(parsed.approved)];
      if (Array.isArray(parsed.reasons))
        reviewReasons = parsed.reasons
          .filter(
            (r: any) =>
              Number.isInteger(r?.index) &&
              risky.some(item => item.i === r.index) &&
              !approved.includes(r.index) &&
              typeof r.reason === 'string'
          )
          .slice(0, 8)
          .map((r: any) => ({
            index: r.index,
            reason: r.reason.slice(0, 200),
          }));
    }
    const rejected = risky.filter(r => !approved.includes(r.i)).map(r => r.i);
    if (
      !repair &&
      rejected.some(i =>
        input.sourceFactIds?.includes(decisions[i].targetId || '')
      )
    ) {
      // The reviewer, not a keyword rule, explains the failed repair. One retry
      // is shared with structural repair; total calls remain bounded at four.
      return this.propose(original, {
        output: result.content,
        error: JSON.stringify({
          code: 'MEMORY_VALUE_REVIEW_REJECTED',
          rejected,
          reasons: reviewReasons,
        }),
        priorCalls: modelCalls,
        priorTokens: modelTokens,
      });
    }
    return {
      decisions,
      approved,
      rejected,
      modelCalls,
      modelTokens,
      newPeople,
      reviewReasons,
    };
  }

  /**
   * 模型输出层面的校验失败（枚举、字段、目标、证据等）是可恢复的：
   * 一次修复后仍不合规时按"本条消息没有可保存的记忆"处理。
   * 模型不可用、鉴权等基础设施错误不可恢复，必须向上抛出。
   */
  private isRecoverableProposalError(error: unknown): boolean {
    const message =
      error instanceof Error ? error.message : String(error || '');
    if (message.includes('MEMORY_VALUE_MODEL_DISABLED')) return false;
    if (message.includes('MEMORY_VALUE_ACCOUNT_NOT_ENABLED')) return false;
    return /^MEMORY_VALUE_/.test(message) || error instanceof SyntaxError;
  }

  async process(
    message: MessageEntity,
    text: string,
    agent: AgentEntity,
    options: { shadow?: boolean; replan?: boolean } = {}
  ): Promise<{
    count: number;
    changedAgents: string[];
    audit: MemoryValueAudit;
  }> {
    if (!this.active(message.userId) && !this.enabled(message.userId)) {
      throw new Error('MEMORY_VALUE_ACCOUNT_NOT_ENABLED');
    }
    const fresh = await this.messageModel.findOne({
      where: { _id: message.id, userId: message.userId } as never,
    });
    let audit = (fresh as any)?.memoryValueAudit as
      | MemoryValueAudit
      | undefined;
    if (
      audit?.version === MEMORY_VALUE_VERSION &&
      audit.status === 'completed' &&
      !options.replan
    )
      return { count: 0, changedAgents: this.changedAgentIds(audit), audit };
    if (
      !audit ||
      audit.version !== MEMORY_VALUE_VERSION ||
      options.replan ||
      (audit.status === 'shadow' && this.active(message.userId))
    ) {
      const { input, before } = await this.buildInput(message, text, agent);
      const proposal = await this.propose(input);
      audit = {
        version: MEMORY_VALUE_VERSION,
        status: 'proposed',
        input,
        before,
        ...proposal,
      };
      await this.messageModel.updateOne(
        { _id: message.id, userId: message.userId },
        { $set: { memoryValueAudit: audit } }
      );
    }
    if (options.shadow || !this.active(message.userId)) {
      audit.status = 'shadow';
      await this.messageModel.updateOne(
        { _id: message.id, userId: message.userId },
        { $set: { memoryValueAudit: audit } }
      );
      return { count: 0, changedAgents: [], audit };
    }
    const changedAgents = new Set<string>();
    let count = 0;
    for (let i = 0; i < audit.decisions.length; i++) {
      const d = audit.decisions[i];
      if (
        (d.retention === 'discard' && d.operation !== 'archive') ||
        d.operation === 'noop'
      )
        continue;
      let changed: boolean;
      try {
        changed = await this.apply(message, d, i, audit);
      } catch (error) {
        if (
          String(error).includes('MEMORY_VALUE_STALE_VERSION') ||
          String(error).includes('MEMORY_VALUE_ADD_CONFLICT')
        ) {
          await this.messageModel.updateOne({ _id: message.id }, {
            $push: { memoryValuePriorAudits: { $each: [audit], $slice: -4 } },
            $unset: { memoryValueAudit: '' },
          } as any);
        }
        throw error;
      }
      if (changed) {
        count++;
        if (d.subjectRef.startsWith('agent:') && d.retention !== 'session')
          changedAgents.add(d.subjectRef.slice(6));
      }
    }
    count = audit.appliedIndexes?.length || count;
    for (const i of audit.appliedIndexes || []) {
      const d = audit.decisions[i];
      if (d.subjectRef.startsWith('agent:') && d.retention !== 'session')
        changedAgents.add(d.subjectRef.slice(6));
    }
    audit.status = 'completed';
    audit.unresolvedSourceFactIds = (audit.input.sourceFactIds || []).filter(
      id =>
        !audit.decisions.some(
          (d, i) =>
            d.targetId === id &&
            d.certainty !== 'uncertain' &&
            !audit.rejected.includes(i) &&
            ['noop', 'merge', 'replace', 'archive'].includes(d.operation) &&
            (d.retention !== 'discard' ||
              ['noop', 'archive'].includes(d.operation))
        )
    );
    audit.completedAt = new Date().toISOString();
    await this.messageModel.updateOne(
      { _id: message.id, userId: message.userId },
      {
        $set: {
          memoryValueAudit: audit,
          memoryWriteStatus: audit.unresolvedSourceFactIds.length
            ? 'needs_review'
            : count
            ? 'written'
            : 'none',
          memoryWriteReason: audit.unresolvedSourceFactIds.length
            ? 'memory_value_review_pending'
            : 'memory_value_decided',
          memoryWriteProfileFactCount: count,
          memoryWriteCompletedAt: new Date(),
        },
      }
    );
    return { count, changedAgents: [...changedAgents], audit };
  }

  /**
   * 批量录入：一次为多条用户消息构建输入，复用同一批 subjects/existing，
   * 让一次模型调用覆盖整个对话片段，避免逐条重复调用。
   */
  private async buildBatchInput(
    messages: MessageEntity[],
    texts: string[],
    agent: AgentEntity
  ): Promise<{ input: MemoryValueInput; before: AgentProfileFactEntity[] }> {
    const anchor = messages[messages.length - 1];
    const earliest = messages[0];
    const batchIds = messages.map(message => message.id);
    const [history, agents, people, sourceFacts] = await Promise.all([
      this.messageModel.find({
        where: {
          userId: anchor.userId,
          conversationId: anchor.conversationId,
          isArchived: { $ne: true },
          createdAt: { $lt: earliest.createdAt },
        } as never,
        order: { createdAt: 'DESC', _id: 'DESC' } as never,
        take: 10,
      }),
      this.agentModel.find({
        where: {
          createdUserId: anchor.userId,
          isArchived: { $ne: true },
        } as never,
        take: 64,
      }),
      this.personModel.find({
        where: { userId: anchor.userId, status: 'active' } as never,
        take: 64,
      }),
      this.factModel.find({
        where: {
          userId: anchor.userId,
          sourceMessageId: { $in: batchIds },
        } as never,
        take: 32,
      }),
    ]);
    const subjects: MemoryValueInput['subjects'] = [
      { ref: `user:${anchor.userId}`, label: '当前讲述者/用户本人' },
    ];
    const parentAgents = agents.filter(a => !a.messengerOfAgentId);
    if (
      !parentAgents.some(a => String(a.id) === String(agent.id)) &&
      String(agent.createdUserId) === String(anchor.userId)
    )
      parentAgents.push(agent);
    for (const a of parentAgents)
      subjects.push({
        ref: `agent:${a.id}`,
        label: `${a.name || ''}；用户称呼：${a.iCallAgent || ''}；亲人称用户：${
          a.agentCallMe || ''
        }`,
        relation:
          String(a.id) === String(agent.id)
            ? '当前交谈/小使者所服务的亲人'
            : '账户中的其他亲人',
      });
    for (const p of people) {
      if (
        p.linkedAgentId &&
        parentAgents.some(a => String(a.id) === String(p.linkedAgentId))
      )
        continue;
      subjects.push({
        ref: `relative:${p.id}`,
        label: [p.realName, p.preferredName, ...(p.aliases || [])]
          .filter(Boolean)
          .join('、'),
        relation: p.relationToUser,
      });
    }
    const scopes = subjects.map(s => new MongoObjectId(s.ref.split(':')[1]));
    const recentFacts = await this.factModel.find({
      where: {
        userId: anchor.userId,
        agentId: { $in: scopes },
        status: { $in: ['active', 'candidate', 'conflicted'] },
      } as never,
      order: { priority: 'DESC', updatedAt: 'DESC' },
      take: 24,
    });
    const before = sourceFacts.length ? sourceFacts : recentFacts;
    const input: MemoryValueInput = {
      currentMessageId: String(anchor.id),
      currentMessageIds: messages.map(message => String(message.id)),
      conversationAgentRef: `agent:${agent.id}`,
      sourceFactIds: sourceFacts.map(f => String(f.id)),
      referenceAt: anchor.createdAt.toISOString(),
      subjects,
      messages: [
        ...history
          .reverse()
          .filter(m => ['user', 'assistant'].includes(m.role))
          .map(m => ({
            id: String(m.id),
            role: m.role,
            content: (m.content || '').slice(0, 800),
          })),
        ...messages.map((message, index) => ({
          id: String(message.id),
          role: 'user',
          content: (texts[index] || message.content || '').slice(0, 6000),
        })),
      ],
      existing: before.map(f => ({
        id: String(f.id),
        subjectRef: f.governance?.subjectRef || `agent:${f.agentId}`,
        value: f.value,
        key: f.key,
        type: f.type,
        status: f.status,
        revision: f.governance?.revision || 0,
        protected:
          f.governance?.protected ||
          f.type === 'identity' ||
          f.type === 'relationship',
        sourceText: f.sourceText?.slice(0, 400),
      })),
    };
    return { input: withMemorySpeakers(input), before };
  }

  /**
   * 一次模型调用处理一批用户消息，并按证据所属消息分别落库。
   * 调用方负责在异常时回退到逐条 process()。
   */
  async processBatch(
    messages: MessageEntity[],
    texts: string[],
    agent: AgentEntity
  ): Promise<{ count: number; changedAgents: string[] }> {
    if (!messages.length) return { count: 0, changedAgents: [] };
    if (!this.openAIService?.isEnabled())
      throw new Error('MEMORY_VALUE_MODEL_DISABLED');

    const { input, before } = await this.buildBatchInput(
      messages,
      texts,
      agent
    );
    const proposal = await this.propose(input);
    const audit: MemoryValueAudit = {
      version: MEMORY_VALUE_VERSION,
      status: 'completed',
      input,
      before,
      decisions: proposal.decisions,
      approved: proposal.approved,
      rejected: proposal.rejected,
      modelCalls: proposal.modelCalls,
      modelTokens: proposal.modelTokens,
      newPeople: proposal.newPeople,
      reviewReasons: proposal.reviewReasons,
    };

    const changedAgents = new Set<string>();
    let count = 0;
    for (let i = 0; i < proposal.decisions.length; i++) {
      const d = proposal.decisions[i];
      if (
        (d.retention === 'discard' && d.operation !== 'archive') ||
        d.operation === 'noop'
      )
        continue;
      const message = this.resolveDecisionMessage(d, messages);
      if (!message) continue;
      const changed = await this.apply(message, d, i, audit);
      if (changed) {
        count++;
        if (d.subjectRef.startsWith('agent:') && d.retention !== 'session')
          changedAgents.add(d.subjectRef.slice(6));
      }
    }
    count = audit.appliedIndexes?.length || count;

    // 每条参与批次的消息都记录同一份审计，便于追溯与重放。
    const touched = new Map<string, MessageEntity>();
    for (const message of messages) touched.set(String(message.id), message);
    for (const message of touched.values()) {
      await this.messageModel.updateOne(
        { _id: message.id, userId: message.userId },
        {
          $set: {
            memoryValueAudit: audit,
            memoryWriteStatus: count ? 'written' : 'none',
            memoryWriteReason: 'memory_value_batch_decided',
            memoryWriteProfileFactCount: count,
            memoryWriteCompletedAt: new Date(),
          },
        }
      );
    }
    return { count, changedAgents: [...changedAgents] };
  }

  private resolveDecisionMessage(
    d: MemoryValueDecision,
    messages: MessageEntity[]
  ): MessageEntity | undefined {
    const evidenceIds = new Set(d.evidence.map(e => e.messageId));
    return (
      messages.find(message => evidenceIds.has(String(message.id))) ||
      messages[messages.length - 1]
    );
  }

  private changedAgentIds(audit: MemoryValueAudit): string[] {
    return [
      ...new Set(
        audit.decisions
          .filter(
            (d, i) =>
              d.subjectRef.startsWith('agent:') &&
              (['durable', 'core'].includes(d.retention) ||
                d.operation === 'archive') &&
              !['noop', 'conflict'].includes(d.operation) &&
              d.certainty !== 'uncertain' &&
              !audit.rejected.includes(i)
          )
          .map(d => d.subjectRef.slice(6))
      ),
    ];
  }

  async indexMessage(
    message: MessageEntity,
    milvus: MilvusService
  ): Promise<void> {
    const records = await this.factModel.find({
      where: {
        userId: message.userId,
        sourceMessageId: message.id,
        status: 'active',
        'governance.version': MEMORY_VALUE_VERSION,
      } as never,
      take: 16,
    });
    for (const record of records) {
      if (
        !isMemoryCurrent(record.governance) ||
        isCanonicalUserNameEvidence(record)
      )
        continue;
      const ok = await milvus.indexConversationMessage({
        messageId: String(message.id),
        memoryId: String(record.id),
        sourceMessageId: String(message.id),
        userId: String(message.userId),
        conversationId: String(message.conversationId),
        agentId: record.governance!.subjectRef.startsWith('agent:')
          ? String(record.agentId)
          : undefined,
        role: message.role,
        type: message.type,
        searchableText: record.value,
        createdAt: message.createdAt,
        updatedAt: record.updatedAt,
        personId: String(record.agentId),
        memoryKind: 'governed_fact',
        sourceHash: String(record.governance!.revision),
      });
      if (!ok) throw new Error('MEMORY_VALUE_INDEX_UNAVAILABLE');
    }
  }

  private async apply(
    message: MessageEntity,
    d: MemoryValueDecision,
    index: number,
    audit: MemoryValueAudit
  ): Promise<boolean> {
    const decisionId = `${MEMORY_VALUE_VERSION}:${message.id}:${index}`;
    const existingSnapshot = audit.before.find(
      f => String(f.id) === d.targetId
    );
    const ownerId = new MongoObjectId(d.subjectRef.split(':')[1]);
    const where = d.targetId
      ? { _id: new MongoObjectId(d.targetId), userId: message.userId }
      : { userId: message.userId, agentId: ownerId, key: d.key };
    const current = await this.factModel.findOne({ where: where as never });
    if (current?.governance?.decisionId === decisionId) {
      await this.projectAcceptedDecision(message, d, current, audit);
      if (['active', 'archived'].includes(current.status)) {
        audit.appliedIndexes = [
          ...new Set([...(audit.appliedIndexes || []), index]),
        ];
      }
      return false;
    }
    // A conflict/rejected replacement never demotes the previously valid fact.
    const pending =
      d.certainty === 'uncertain' ||
      d.operation === 'conflict' ||
      audit.rejected.includes(index);
    if (pending && current) return false;
    const newPerson = audit.newPeople?.find(p => p.ref === d.subjectRef);
    if (newPerson) {
      if (pending) return false;
      const now = new Date();
      await this.personModel.updateOne(
        { _id: ownerId, userId: message.userId },
        {
          $setOnInsert: {
            userId: message.userId,
            identityKey: `governed:${ownerId}`,
            aliases: [newPerson.label],
            realName: newPerson.realName || undefined,
            relationToUser: newPerson.relationToUser,
            status: 'active',
            sourceAgentId: message.agentId,
            sourceMessageId: message.id,
            sourceText: newPerson.evidence.map(e => e.quote).join('；'),
            createdAt: now,
            updatedAt: now,
          },
        },
        { upsert: true }
      );
      const person = await this.personModel.findOne({
        where: { _id: ownerId } as never,
      });
      if (person)
        await this.userRelativeProfileService.ensureForKnownPerson({
          userId: message.userId,
          personId: person.id,
          relationToUser: person.relationToUser,
          sourceMessageId: message.id,
          sourceText: textForEvidence(d),
        });
    }
    if (
      d.targetId &&
      (!current ||
        (current.governance?.revision || 0) !==
          (existingSnapshot?.governance?.revision || 0) ||
        current.value !== existingSnapshot?.value)
    )
      throw new Error('MEMORY_VALUE_STALE_VERSION');
    if (!d.targetId && current) {
      if (current.value === d.value) return false;
      throw new Error('MEMORY_VALUE_ADD_CONFLICT');
    }
    // 跨消息去重：同一人物、同一类型的近义记录合并到已有记录，
    // 避免病痛/情绪在多次对话中被拆成多条近义碎片。
    // 仅处理普通记忆类，避免影响身份/关系/日期投影。
    if (
      !d.targetId &&
      !current &&
      !d.date &&
      !d.identity &&
      !['identity', 'relationship'].includes(d.type)
    ) {
      const similar = await this.findSimilarExistingFact(
        message.userId,
        ownerId,
        d
      );
      if (similar) return this.mergeIntoSimilarFact(message, d, similar);
    }
    // Historical replay cannot silently replace a newer assertion.
    if (
      current?.governance?.sourceOccurredAt &&
      Date.parse(current.governance.sourceOccurredAt) >
        message.createdAt.getTime()
    )
      return false;
    if (
      current?.sourceMessageId &&
      String(current.sourceMessageId) !== String(message.id)
    ) {
      const previousSource = await this.messageModel.findOne({
        where: {
          _id: current.sourceMessageId,
          userId: message.userId,
        } as never,
      });
      if (previousSource?.createdAt > message.createdAt) return false;
    }
    const now = new Date();
    const governance: MemoryGovernance = {
      version: MEMORY_VALUE_VERSION,
      subjectRef: d.subjectRef,
      participants: d.participants,
      kind: d.kind,
      retention: d.retention as MemoryGovernance['retention'],
      certainty: d.certainty,
      timeKind: d.timeKind,
      validUntil: d.validUntil,
      reason: d.reason,
      evidence: d.evidence,
      revision: (current?.governance?.revision || 0) + 1,
      decisionId,
      sourceOccurredAt: message.createdAt.toISOString(),
      protected:
        d.protected ||
        d.retention === 'core' ||
        ['identity', 'relationship', 'age'].includes(d.type) ||
        d.kind === 'temporal' ||
        !!current?.governance?.protected,
    };
    const record = Object.assign(new AgentProfileFactEntity(), current || {}, {
      id:
        current?.id ||
        new MongoObjectId(
          createHash('sha256')
            .update(`${message.userId}:${d.subjectRef}:${d.key}`)
            .digest('hex')
            .slice(0, 24)
        ),
      userId: message.userId,
      agentId: ownerId,
      type: d.type,
      key: d.key,
      value: d.value,
      status: pending
        ? AgentProfileFactStatus.candidate
        : d.operation === 'archive'
        ? AgentProfileFactStatus.archived
        : AgentProfileFactStatus.active,
      confidence:
        d.operation === 'replace'
          ? AgentProfileFactConfidence.userCorrected
          : AgentProfileFactConfidence.extracted,
      priority: d.salience,
      polarity: AgentProfileFactPolarity.positive,
      assertionPolicy:
        pending || ['wish', 'plan'].includes(d.timeKind)
          ? AgentProfileFactAssertionPolicy.contextOnly
          : AgentProfileFactAssertionPolicy.canAssert,
      sourceMessageId: message.id,
      sourceText: d.evidence.map(e => e.quote).join('；'),
      sourceMessageIds: [
        ...new Set([
          ...(current?.sourceMessageIds || []).map(String),
          ...d.evidence.map(e => e.messageId),
        ]),
      ]
        .slice(-16)
        .map(id => new MongoObjectId(id)),
      supportCount: new Set([
        ...(current?.sourceMessageIds || []).map(String),
        ...d.evidence.map(e => e.messageId),
      ]).size,
      createdAt: current?.createdAt || now,
      updatedAt: now,
      governance,
    });
    if (d.operation === 'archive' && current) {
      // Revocation must not rewrite the archived assertion or collide with a new key.
      record.key = current.key;
      record.type = current.type;
      record.value = current.value;
      record.governance!.retention = current.governance?.retention || 'durable';
    }
    if (current) {
      const { id, ...set } = record;
      const filter: any = {
        _id: id,
        userId: message.userId,
        value: current.value,
        updatedAt: current.updatedAt,
      };
      if (current.governance)
        filter['governance.revision'] = current.governance.revision;
      const result = await this.factModel.updateOne(filter, { $set: set });
      if (result.modifiedCount !== 1)
        throw new Error('MEMORY_VALUE_STALE_VERSION');
    } else {
      const { id, ...document } = record;
      await this.factModel.insertOne({ ...document, _id: id } as any);
    }
    await this.projectAcceptedDecision(message, d, record, audit);
    if (!pending)
      audit.appliedIndexes = [
        ...new Set([...(audit.appliedIndexes || []), index]),
      ];
    return !pending;
  }

  /**
   * 查找同一人物、同一类型下与提案含义高度重叠的既有记录。
   * 仅用于合并近义碎片，不触碰人工资料与受保护记录。
   */
  private async findSimilarExistingFact(
    userId: MongoObjectId,
    ownerId: MongoObjectId,
    d: MemoryValueDecision
  ): Promise<AgentProfileFactEntity | undefined> {
    const candidates = await this.factModel.find({
      where: {
        userId,
        agentId: ownerId,
        type: d.type,
        status: {
          $in: [
            AgentProfileFactStatus.active,
            AgentProfileFactStatus.candidate,
          ],
        },
      } as never,
      order: { updatedAt: 'DESC' },
      take: 32,
    });
    let best: AgentProfileFactEntity | undefined;
    let bestScore = 0.5;
    for (const fact of candidates) {
      if (fact.key === d.key || fact.key.startsWith('profile_source.'))
        continue;
      if (fact.governance?.protected) continue;
      const score = memoryValueSimilarity(fact.value, d.value);
      if (score > bestScore) {
        best = fact;
        bestScore = score;
      }
    }
    return best;
  }

  /** 把新提案并入近义既有记录：补齐更完整的内容与证据，不新建碎片。 */
  private async mergeIntoSimilarFact(
    message: MessageEntity,
    d: MemoryValueDecision,
    fact: AgentProfileFactEntity
  ): Promise<boolean> {
    const now = new Date();
    const evidenceIds = d.evidence.map(e => String(e.messageId));
    const sourceMessageIds = Array.from(
      new Set([...(fact.sourceMessageIds || []).map(String), ...evidenceIds])
    )
      .slice(-16)
      .map(id => new MongoObjectId(id));
    const valueChanged = d.value.length > (fact.value || '').length;
    const result = await this.factModel.updateOne(
      { _id: fact.id, userId: message.userId, updatedAt: fact.updatedAt },
      {
        $set: {
          ...(valueChanged ? { value: d.value } : {}),
          sourceMessageIds,
          supportCount: sourceMessageIds.length,
          updatedAt: now,
        },
      } as never
    );
    return result.modifiedCount === 1 && valueChanged;
  }

  private async projectAcceptedDecision(
    message: MessageEntity,
    d: MemoryValueDecision,
    record: AgentProfileFactEntity,
    audit: MemoryValueAudit
  ): Promise<void> {
    if (record.status !== AgentProfileFactStatus.active) return;
    await this.projectDate(message, d, record);
    if (
      d.type === 'identity' &&
      d.subjectRef.startsWith('user:') &&
      d.identity
    ) {
      await this.userIdentityMemoryService.recordApprovedUserIdentity(
        message,
        audit.input.messages.find(m => m.id === String(message.id))!.content,
        d.identity,
        d.operation === 'replace'
      );
    }
  }

  private async projectDate(
    message: MessageEntity,
    d: MemoryValueDecision,
    record: AgentProfileFactEntity
  ): Promise<void> {
    if (!d.date || record.status !== AgentProfileFactStatus.active) return;
    const [kind, id] = d.subjectRef.split(':');
    const subjectType =
      kind === 'user'
        ? PersonTemporalSubjectType.user
        : kind === 'agent'
        ? PersonTemporalSubjectType.agent
        : PersonTemporalSubjectType.relative;
    if (d.date.year || d.date.month || d.date.day) {
      await this.personTemporalMemoryService.recordExplicitPersonDate({
        message,
        subjectType,
        subjectId: new MongoObjectId(id),
        eventType:
          d.date.event === 'death'
            ? PersonTemporalEventType.death
            : d.date.event === 'expected_birth'
            ? PersonTemporalEventType.expectedBirth
            : PersonTemporalEventType.birth,
        year: d.date.year,
        month: d.date.month,
        day: d.date.day,
        isCorrection: d.operation === 'replace',
        rawText: d.evidence.map(e => e.quote).join('；'),
      });
    } else if (
      kind === 'agent' &&
      d.date.event === 'death' &&
      d.date.expression
    ) {
      const cloned = Object.assign(new MessageEntity(), message, {
        agentId: new MongoObjectId(id),
      });
      await this.personTemporalMemoryService.recordAgentDepartureFromMessage({
        message: cloned,
        searchableText: d.date.expression,
        implicitCurrentAgent: true,
        semanticApproved: true,
      });
    }
  }
}

function textForEvidence(d: MemoryValueDecision): string {
  return d.evidence.map(e => e.quote).join('；');
}
