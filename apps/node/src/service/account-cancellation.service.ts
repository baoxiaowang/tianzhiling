import { Inject, Logger, Provide } from '@midwayjs/core';
import { brandName } from '../config/brand';
import { Framework as BullMQFramework } from '@midwayjs/bullmq';
import type { ILogger } from '@midwayjs/logger';
import { RedisService } from '@midwayjs/redis';
import { InjectEntityModel } from '@midwayjs/typeorm';
import {
  AgentEntitlementEntity,
  AgentEntitlementStatus,
  AgentEntity,
  AgentMemoryFactEntity,
  AgentProfileFactEntity,
  AgentRelationshipSignalEntity,
  AgentShareInviteEntity,
  AgentShareMemberEntity,
  AgentSubEntity,
  ChatSpanEntity,
  ChatTraceEntity,
  ConversationChatImportBatchEntity,
  ConversationChatImportItemEntity,
  ConversationChatImportStatus,
  ConversationEmotionStateEntity,
  ConversationEntity,
  ConversationMessageFeedbackEntity,
  MessageEntity,
  MessengerCallEventEntity,
  MongoObjectId,
  OrderEntity,
  OrderStatus,
  PostCommentEntity,
  PostCommentNotificationEntity,
  PostEntity,
  PostLikeEntity,
  PostNotificationEntity,
  UserAccountCancellationStatus,
  UserAccountEntity,
  UserAccountStatus,
  UserEntity,
  UserLoginAccountStatus,
  UserMembershipEntity,
  UserMembershipStatus,
  VoiceServiceDataDeletionStatus,
  VoiceServiceSessionEntity,
  VoiceServiceSessionStatus,
  VoiceTrainingTaskEntity,
  VoiceTrainingTaskStatus,
} from '@tzl/entities';
import { createHash } from 'crypto';
import { MongoRepository } from 'typeorm';
import {
  getRevokedUserRedisKey,
  getUserAccountStatusRedisKey,
} from '../common/auth-token';
import { AppError } from '../common/errors';
import { CancelCurrentUserDTO } from '../dto/user.dto';
import { AuthenticatedUserPayload } from '../interface';
import { TencentCosService } from './tencent-cos.service';
import { VoiceServiceDataDeletionService } from './voice-service-data-deletion.service';
import { WechatPayService } from './wechat-pay.service';

const ACCOUNT_CANCELLATION_CONFIRMATION = '确认注销';
export const ACCOUNT_CANCELLATION_CLEANUP_QUEUE =
  'account-cancellation-cleanup';

export interface AccountCancellationCleanupJobData {
  userId: string;
}
const PERSONAL_ASSET_PREFIXES = [
  'avatars',
  'chat-imports',
  'contact-covers',
  'conversation-images',
  'conversation-voice',
  'conversation-voice-replies',
  'memorial-photos',
  'memorial-source-photos',
  'moments',
  'profile-interview-voice',
  'profile-messenger-speech',
];

const BLOCKING_ORDER_STATUSES = new Set<OrderStatus>([
  OrderStatus.pending,
  OrderStatus.paid,
  OrderStatus.granting,
  OrderStatus.refundRequested,
  OrderStatus.grantFailed,
]);

const BLOCKING_VOICE_SESSION_STATUSES = new Set<VoiceServiceSessionStatus>([
  VoiceServiceSessionStatus.analyzing,
  VoiceServiceSessionStatus.training,
]);

const BLOCKING_VOICE_TASK_STATUSES = new Set<VoiceTrainingTaskStatus>([
  VoiceTrainingTaskStatus.processing,
  VoiceTrainingTaskStatus.training,
]);

export interface AccountCancellationBlocker {
  code: 'ORDER_PROCESSING' | 'VOICE_PROCESSING' | 'IMPORT_PROCESSING';
  title: string;
  description: string;
  count: number;
  actionText: string;
  actionPath: string;
}

export interface AccountCancellationCheckResult {
  eligible: boolean;
  blockers: AccountCancellationBlocker[];
  confirmationText: typeof ACCOUNT_CANCELLATION_CONFIRMATION;
  consequences: string[];
}

export interface AccountCancellationResult {
  canceledAt: number;
  cleanupStatus: 'completed' | 'processing';
}

interface CleanupSummary {
  deletedRecordCount: number;
  deletedAssetCount: number;
  deletedVoiceObjectCount: number;
  deletedVoiceModelCount: number;
  deactivatedMembershipCount: number;
  expiredEntitlementCount: number;
  failureStages: string[];
  pendingAssetKeys: string[];
}

@Provide()
export class AccountCancellationService {
  @Logger()
  logger: ILogger;

  @Inject()
  redisService: RedisService;

  @Inject()
  bullmqFramework: BullMQFramework;

  @Inject()
  wechatPayService: WechatPayService;

  @Inject()
  tencentCosService: TencentCosService;

  @Inject()
  voiceServiceDataDeletionService: VoiceServiceDataDeletionService;

  @InjectEntityModel(UserEntity)
  userModel: MongoRepository<UserEntity>;

  @InjectEntityModel(UserAccountEntity)
  userAccountModel: MongoRepository<UserAccountEntity>;

  @InjectEntityModel(OrderEntity)
  orderModel: MongoRepository<OrderEntity>;

  @InjectEntityModel(UserMembershipEntity)
  userMembershipModel: MongoRepository<UserMembershipEntity>;

  @InjectEntityModel(AgentEntitlementEntity)
  agentEntitlementModel: MongoRepository<AgentEntitlementEntity>;

  @InjectEntityModel(AgentEntity)
  agentModel: MongoRepository<AgentEntity>;

  @InjectEntityModel(AgentSubEntity)
  agentSubModel: MongoRepository<AgentSubEntity>;

  @InjectEntityModel(AgentMemoryFactEntity)
  agentMemoryFactModel: MongoRepository<AgentMemoryFactEntity>;

  @InjectEntityModel(AgentProfileFactEntity)
  agentProfileFactModel: MongoRepository<AgentProfileFactEntity>;

  @InjectEntityModel(AgentRelationshipSignalEntity)
  agentRelationshipSignalModel: MongoRepository<AgentRelationshipSignalEntity>;

  @InjectEntityModel(AgentShareInviteEntity)
  agentShareInviteModel: MongoRepository<AgentShareInviteEntity>;

  @InjectEntityModel(AgentShareMemberEntity)
  agentShareMemberModel: MongoRepository<AgentShareMemberEntity>;

  @InjectEntityModel(ConversationEntity)
  conversationModel: MongoRepository<ConversationEntity>;

  @InjectEntityModel(MessageEntity)
  messageModel: MongoRepository<MessageEntity>;

  @InjectEntityModel(MessengerCallEventEntity)
  messengerCallEventModel: MongoRepository<MessengerCallEventEntity>;

  @InjectEntityModel(ConversationChatImportBatchEntity)
  chatImportBatchModel: MongoRepository<ConversationChatImportBatchEntity>;

  @InjectEntityModel(ConversationChatImportItemEntity)
  chatImportItemModel: MongoRepository<ConversationChatImportItemEntity>;

  @InjectEntityModel(ConversationEmotionStateEntity)
  conversationEmotionStateModel: MongoRepository<ConversationEmotionStateEntity>;

  @InjectEntityModel(ConversationMessageFeedbackEntity)
  conversationFeedbackModel: MongoRepository<ConversationMessageFeedbackEntity>;

  @InjectEntityModel(ChatTraceEntity)
  chatTraceModel: MongoRepository<ChatTraceEntity>;

  @InjectEntityModel(ChatSpanEntity)
  chatSpanModel: MongoRepository<ChatSpanEntity>;

  @InjectEntityModel(PostEntity)
  postModel: MongoRepository<PostEntity>;

  @InjectEntityModel(PostCommentEntity)
  postCommentModel: MongoRepository<PostCommentEntity>;

  @InjectEntityModel(PostLikeEntity)
  postLikeModel: MongoRepository<PostLikeEntity>;

  @InjectEntityModel(PostNotificationEntity)
  postNotificationModel: MongoRepository<PostNotificationEntity>;

  @InjectEntityModel(PostCommentNotificationEntity)
  postCommentNotificationModel: MongoRepository<PostCommentNotificationEntity>;

  @InjectEntityModel(VoiceServiceSessionEntity)
  voiceServiceSessionModel: MongoRepository<VoiceServiceSessionEntity>;

  @InjectEntityModel(VoiceTrainingTaskEntity)
  voiceTrainingTaskModel: MongoRepository<VoiceTrainingTaskEntity>;

  async checkCurrentUser(
    auth: AuthenticatedUserPayload
  ): Promise<AccountCancellationCheckResult> {
    const userId = this.parseObjectId(auth?.sub);
    const user = await this.findUser(userId);
    this.ensureUserCanCancel(user);

    const blockers = await this.findBlockers(userId);

    return {
      eligible: blockers.length === 0,
      blockers,
      confirmationText: ACCOUNT_CANCELLATION_CONFIRMATION,
      consequences: [
        `你创建的${brandName()}、聊天记录、记忆和导入记录将无法恢复`,
        '声音素材、剪辑结果和已训练音色将被删除并解除接入',
        '会员及未使用权益将终止，注销后不会转移到新账号',
        '订单、支付和退款凭证会依法留存，并限制为履约、审计与争议处理使用',
      ],
    };
  }

  async cancelCurrentUser(
    auth: AuthenticatedUserPayload,
    payload: CancelCurrentUserDTO
  ): Promise<AccountCancellationResult> {
    if (payload?.confirmation?.trim() !== ACCOUNT_CANCELLATION_CONFIRMATION) {
      throw new AppError(
        'ACCOUNT_CANCELLATION_CONFIRMATION_REQUIRED',
        `请输入“${ACCOUNT_CANCELLATION_CONFIRMATION}”`,
        400
      );
    }

    const userId = this.parseObjectId(auth?.sub);
    const user = await this.findUser(userId);
    this.ensureUserCanCancel(user);

    const blockers = await this.findBlockers(userId);
    if (blockers.length) {
      throw new AppError(
        'ACCOUNT_CANCELLATION_BLOCKED',
        '还有未完成的业务，请处理后再注销',
        409,
        { blockers }
      );
    }

    await this.verifyWechatIdentity(userId, auth.accountId, payload?.jsCode);

    const now = new Date();
    user.accountStatus = UserAccountStatus.canceled;
    user.accountCancellationStatus =
      UserAccountCancellationStatus.processing;
    user.accountCancellationRequestedAt = now;
    user.canceledAt = now;
    user.updatedAt = now;
    await this.userModel.save(user);

    await this.redisService.del(getUserAccountStatusRedisKey(String(userId)));
    await this.redisService.set(
      getRevokedUserRedisKey(String(userId)),
      JSON.stringify({ canceledAt: now.getTime() })
    );

    const summary = await this.cleanupUserData(userId, user);
    const completedAt = new Date();
    await this.runCleanupStage(
      summary,
      'login_account_anonymization',
      () => this.anonymizeLoginAccounts(userId, completedAt)
    );
    const cleanupCompleted = summary.failureStages.length === 0;

    user.name = '已注销用户';
    user.avatar = '';
    user.phone = '';
    user.phoneVerified = false;
    user.gender = 'unknown';
    user.region = null;
    user.preferences = {};
    user.riskControlUntilAt = undefined;
    user.postNotificationSeenAt = undefined;
    user.accountCancellationStatus = cleanupCompleted
      ? UserAccountCancellationStatus.completed
      : UserAccountCancellationStatus.partialFailed;
    user.accountCancellationCompletedAt = cleanupCompleted
      ? completedAt
      : undefined;
    user.accountCancellationFailureReason = cleanupCompleted
      ? ''
      : '部分数据正在等待系统继续清理';
    user.accountCancellationSummary = {
      deletedRecordCount: summary.deletedRecordCount,
      deletedAssetCount: summary.deletedAssetCount,
      deletedVoiceObjectCount: summary.deletedVoiceObjectCount,
      deletedVoiceModelCount: summary.deletedVoiceModelCount,
      deactivatedMembershipCount: summary.deactivatedMembershipCount,
      expiredEntitlementCount: summary.expiredEntitlementCount,
      failureStages: summary.failureStages.length
        ? summary.failureStages
        : undefined,
    };
    user.accountCancellationPendingAssetKeys = summary.pendingAssetKeys;
    user.updatedAt = completedAt;
    await this.userModel.save(user);
    if (!cleanupCompleted) {
      await this.enqueueCleanupRetry(userId);
    }

    this.logger.info(
      '[account-cancellation] completed, userId=%s cleanupCompleted=%s summary=%j',
      String(userId),
      cleanupCompleted,
      summary
    );

    return {
      canceledAt: now.getTime(),
      cleanupStatus: cleanupCompleted ? 'completed' : 'processing',
    };
  }

  async processCleanupRetry(
    data: AccountCancellationCleanupJobData
  ): Promise<void> {
    const userId = this.parseObjectId(data?.userId);
    const user = await this.findUser(userId);
    if (
      !user ||
      user.accountStatus !== UserAccountStatus.canceled ||
      user.accountCancellationStatus === UserAccountCancellationStatus.completed
    ) {
      return;
    }

    const summary = await this.cleanupUserData(userId, user);
    const completedAt = new Date();
    await this.runCleanupStage(
      summary,
      'login_account_anonymization',
      () => this.anonymizeLoginAccounts(userId, completedAt)
    );
    const previous = user.accountCancellationSummary;
    const completed = summary.failureStages.length === 0;

    user.accountCancellationStatus = completed
      ? UserAccountCancellationStatus.completed
      : UserAccountCancellationStatus.partialFailed;
    user.accountCancellationCompletedAt = completed ? completedAt : undefined;
    user.accountCancellationFailureReason = completed
      ? ''
      : '部分数据正在等待系统继续清理';
    user.accountCancellationPendingAssetKeys = summary.pendingAssetKeys;
    user.accountCancellationSummary = {
      deletedRecordCount:
        (previous?.deletedRecordCount ?? 0) + summary.deletedRecordCount,
      deletedAssetCount:
        (previous?.deletedAssetCount ?? 0) + summary.deletedAssetCount,
      deletedVoiceObjectCount:
        (previous?.deletedVoiceObjectCount ?? 0) +
        summary.deletedVoiceObjectCount,
      deletedVoiceModelCount:
        (previous?.deletedVoiceModelCount ?? 0) +
        summary.deletedVoiceModelCount,
      deactivatedMembershipCount:
        (previous?.deactivatedMembershipCount ?? 0) +
        summary.deactivatedMembershipCount,
      expiredEntitlementCount:
        (previous?.expiredEntitlementCount ?? 0) +
        summary.expiredEntitlementCount,
      failureStages: completed ? undefined : summary.failureStages,
    };
    user.updatedAt = completedAt;
    await this.userModel.save(user);

    if (!completed) {
      throw new AppError(
        'ACCOUNT_CANCELLATION_CLEANUP_PENDING',
        'account cancellation cleanup is still pending',
        503,
        { failureStages: summary.failureStages }
      );
    }
  }

  private async findBlockers(
    userId: MongoObjectId
  ): Promise<AccountCancellationBlocker[]> {
    const [orders, sessions, tasks, importBatches] = await Promise.all([
      this.orderModel.find({ where: { userId } }),
      this.voiceServiceSessionModel.find({ where: { userId } }),
      this.voiceTrainingTaskModel.find({ where: { userId } }),
      this.chatImportBatchModel.find({ where: { userId } }),
    ]);
    const blockingOrders = orders.filter(item =>
      BLOCKING_ORDER_STATUSES.has(item.status)
    );
    const blockingSessions = sessions.filter(item =>
      this.isVoiceSessionProcessing(item)
    );
    const blockingTasks = tasks.filter(item =>
      BLOCKING_VOICE_TASK_STATUSES.has(item.status)
    );
    const blockingImports = importBatches.filter(item =>
      [
        ConversationChatImportStatus.uploading,
        ConversationChatImportStatus.queued,
        ConversationChatImportStatus.recognizing,
        ConversationChatImportStatus.importing,
        ConversationChatImportStatus.extractingMemory,
      ].includes(item.status)
    );
    const blockers: AccountCancellationBlocker[] = [];

    if (blockingOrders.length) {
      blockers.push({
        code: 'ORDER_PROCESSING',
        title: '有未完成的订单或退款',
        description: '请先等待支付、权益发放或退款处理完成。待支付订单关闭后即可继续。',
        count: blockingOrders.length,
        actionText: '查看订单',
        actionPath: '/pages/my-orders/index',
      });
    }

    const voiceCount = blockingSessions.length + blockingTasks.length;
    if (voiceCount) {
      blockers.push({
        code: 'VOICE_PROCESSING',
        title: '声音任务正在处理',
        description: '剪辑或训练完成后再注销，避免处理中断导致记录不完整。',
        count: voiceCount,
        actionText: '查看声音任务',
        actionPath: '/pages/voice-package/index',
      });
    }

    if (blockingImports.length) {
      blockers.push({
        code: 'IMPORT_PROCESSING',
        title: '聊天记录正在导入',
        description: '请等待识别、导入和记忆整理完成后再注销。',
        count: blockingImports.length,
        actionText: '',
        actionPath: '',
      });
    }

    return blockers;
  }

  private isVoiceSessionProcessing(session: VoiceServiceSessionEntity) {
    if (BLOCKING_VOICE_SESSION_STATUSES.has(session.status)) {
      return true;
    }

    return (session.reviewClips ?? []).some(
      clip => clip.recutStatus === 'queued' || clip.recutStatus === 'processing'
    );
  }

  private async verifyWechatIdentity(
    userId: MongoObjectId,
    currentAccountId: string | undefined,
    jsCode?: string
  ): Promise<void> {
    const normalizedCode = jsCode?.trim();
    if (!normalizedCode) {
      throw new AppError(
        'ACCOUNT_CANCELLATION_WECHAT_VERIFICATION_REQUIRED',
        '请完成微信身份验证',
        400
      );
    }

    const openid = await this.wechatPayService.getOpenidByJsCode(
      normalizedCode
    );
    const accounts = await this.userAccountModel.find({ where: { userId } });
    const linkedAccounts = accounts.filter(account => account.openId?.trim());
    const matchedLinkedAccount = linkedAccounts.some(
      account =>
        account.status !== UserLoginAccountStatus.canceled &&
        account.openId?.trim() === openid
    );
    const currentAccount = accounts.find(
      account => String(account.id) === currentAccountId?.trim()
    );
    const verifiedPhoneOnlyAccount = Boolean(
      linkedAccounts.length === 0 &&
        currentAccount &&
        currentAccount.status !== UserLoginAccountStatus.canceled
    );

    if (!matchedLinkedAccount && !verifiedPhoneOnlyAccount) {
      throw new AppError(
        'ACCOUNT_CANCELLATION_IDENTITY_MISMATCH',
        '当前微信身份与登录账号不一致',
        403
      );
    }
  }

  private async cleanupUserData(
    userId: MongoObjectId,
    user: UserEntity
  ): Promise<CleanupSummary> {
    const summary: CleanupSummary = {
      deletedRecordCount: 0,
      deletedAssetCount: 0,
      deletedVoiceObjectCount: 0,
      deletedVoiceModelCount: 0,
      deactivatedMembershipCount: 0,
      expiredEntitlementCount: 0,
      failureStages: [],
      pendingAssetKeys: [],
    };
    const ownedAgents = await this.agentModel.find({
      where: { createdUserId: userId },
    });
    const ownedAgentIds = ownedAgents.map(item => item.id);
    const [userConversations, ownedAgentConversations, posts] =
      await Promise.all([
        this.conversationModel.find({ where: { userId } }),
        ownedAgentIds.length
          ? this.conversationModel.find({
              where: { agentId: { $in: ownedAgentIds } } as never,
            })
          : Promise.resolve([]),
        this.postModel.find({ where: { userId } }),
      ]);
    const conversations = this.uniqueEntities([
      ...userConversations,
      ...ownedAgentConversations,
    ]);
    const conversationIds = conversations.map(item => item.id);
    const postIds = posts.map(item => item.id);
    const [messages, importBatches] = await Promise.all([
      conversationIds.length
        ? this.messageModel.find({
            where: { conversationId: { $in: conversationIds } } as never,
          })
        : Promise.resolve([]),
      this.chatImportBatchModel.find({ where: { userId } }),
    ]);
    const userIdText = String(userId);
    const chatTraces = await this.chatTraceModel.find({
      where: { userId: userIdText },
    });
    const traceIds = Array.from(
      new Set(chatTraces.map(item => item.traceId))
    );

    const assetValues = new Set<string>([
      user.avatar,
      user.preferences?.contactsCoverImage ?? '',
      ...(user.accountCancellationPendingAssetKeys ?? []),
      ...ownedAgents.map(item => item.avatar),
      ...posts.reduce<string[]>(
        (items, post) => items.concat(post.images ?? []),
        []
      ),
      ...messages.reduce<string[]>(
        (items, message) =>
          items.concat(message.mediaObjectKey ?? '', message.mediaUrl ?? ''),
        []
      ),
      ...importBatches.reduce<string[]>(
        (items, batch) =>
          items.concat(
            ...(batch.assets ?? []).map(asset => [
              asset.objectKey,
              asset.publicUrl ?? '',
            ])
          ),
        []
      ),
    ]);
    await this.runCleanupStage(summary, 'personal_assets', async () => {
      const assetResult = await this.deletePersonalAssets(assetValues);
      summary.deletedAssetCount += assetResult.deleted;
      summary.pendingAssetKeys = assetResult.failedKeys;
      if (assetResult.failed) {
        throw new Error('some personal assets could not be deleted');
      }
    });

    await this.runCleanupStage(summary, 'voice_data', async () => {
      const voiceResult = await this.deleteVoiceData(userId);
      summary.deletedVoiceObjectCount += voiceResult.deletedObjectCount;
      summary.deletedVoiceModelCount += voiceResult.deletedVoiceModelCount;
      if (voiceResult.partialFailure) {
        throw new Error('voice data deletion partially failed');
      }
    });

    await this.runCleanupStage(summary, 'membership_rights', async () => {
      const result = await this.deactivateRights(userId);
      summary.deactivatedMembershipCount += result.memberships;
      summary.expiredEntitlementCount += result.entitlements;
    });

    await this.runCleanupStage(summary, 'conversation_data', async () => {
      summary.deletedRecordCount += await this.deleteMany(
        this.messengerCallEventModel,
        { userId }
      );
      summary.deletedRecordCount += await this.deleteMany(
        this.messageModel,
        this.byIds(messages.map(item => item.id))
      );
      summary.deletedRecordCount += await this.deleteMany(
        this.chatImportItemModel,
        { userId }
      );
      summary.deletedRecordCount += await this.deleteMany(
        this.chatImportBatchModel,
        { userId }
      );
      summary.deletedRecordCount += await this.deleteMany(
        this.conversationEmotionStateModel,
        this.byForeignIds('conversationId', conversationIds)
      );
      summary.deletedRecordCount += await this.deleteMany(
        this.conversationFeedbackModel,
        this.byForeignIds('conversationId', conversationIds)
      );
      summary.deletedRecordCount += await this.deleteMany(
        this.conversationModel,
        this.byIds(conversationIds)
      );
      summary.deletedRecordCount += await this.deleteMany(
        this.chatSpanModel,
        this.byStringValues('traceId', traceIds)
      );
      summary.deletedRecordCount += await this.deleteMany(
        this.chatTraceModel,
        this.byIds(chatTraces.map(item => item.id))
      );
    });

    await this.runCleanupStage(summary, 'agent_data', async () => {
      summary.deletedRecordCount += await this.deleteMany(
        this.agentMemoryFactModel,
        { $or: [{ userId }, this.inForeignIds('agentId', ownedAgentIds)] }
      );
      summary.deletedRecordCount += await this.deleteMany(
        this.agentProfileFactModel,
        { $or: [{ userId }, this.inForeignIds('agentId', ownedAgentIds)] }
      );
      summary.deletedRecordCount += await this.deleteMany(
        this.agentRelationshipSignalModel,
        { $or: [{ userId }, this.inForeignIds('agentId', ownedAgentIds)] }
      );
      summary.deletedRecordCount += await this.deleteMany(
        this.agentShareInviteModel,
        {
          $or: [
            { ownerUserId: userId },
            { createdByUserId: userId },
            this.inForeignIds('agentId', ownedAgentIds),
          ],
        }
      );
      summary.deletedRecordCount += await this.deleteMany(
        this.agentShareMemberModel,
        {
          $or: [
            { userId },
            { ownerUserId: userId },
            this.inForeignIds('agentId', ownedAgentIds),
          ],
        }
      );
      summary.deletedRecordCount += await this.deleteMany(
        this.agentSubModel,
        this.byForeignIds('agentId', ownedAgentIds)
      );
      summary.deletedRecordCount += await this.deleteMany(
        this.agentModel,
        this.byIds(ownedAgentIds)
      );
    });

    await this.runCleanupStage(summary, 'community_data', async () => {
      summary.deletedRecordCount += await this.deleteMany(
        this.postNotificationModel,
        {
          $or: [
            { userId },
            { actorUserId: userId },
            this.inForeignIds('actorAgentId', ownedAgentIds),
            this.inForeignIds('postId', postIds),
          ],
        }
      );
      summary.deletedRecordCount += await this.deleteMany(
        this.postCommentNotificationModel,
        {
          $or: [
            { userId },
            { actorUserId: userId },
            this.inForeignIds('actorAgentId', ownedAgentIds),
            this.inForeignIds('postId', postIds),
          ],
        }
      );
      summary.deletedRecordCount += await this.deleteMany(
        this.postLikeModel,
        { $or: [{ userId }, this.inForeignIds('postId', postIds)] }
      );
      summary.deletedRecordCount += await this.deleteMany(
        this.postCommentModel,
        {
          $or: [
            { userId },
            { replyToUserId: userId },
            this.inForeignIds('agentId', ownedAgentIds),
            this.inForeignIds('replyToAgentId', ownedAgentIds),
            this.inForeignIds('postId', postIds),
          ],
        }
      );
      summary.deletedRecordCount += await this.deleteMany(
        this.postModel,
        this.byIds(postIds)
      );
    });

    return summary;
  }

  private async deleteVoiceData(userId: MongoObjectId): Promise<{
    deletedObjectCount: number;
    deletedVoiceModelCount: number;
    partialFailure: boolean;
  }> {
    const sessions = await this.voiceServiceSessionModel.find({
      where: { userId },
    });
    let deletedObjectCount = 0;
    let deletedVoiceModelCount = 0;
    let partialFailure = false;

    for (const session of sessions) {
      const now = new Date();
      session.dataDeletionStatus = VoiceServiceDataDeletionStatus.pending;
      session.dataDeletionRequestedAt ??= now;
      session.dataDeletionCompletedAt = undefined;
      session.dataDeletionFailureReason = '';
      session.updatedAt = now;
      await this.voiceServiceSessionModel.save(session);

      try {
        const result =
          await this.voiceServiceDataDeletionService.deleteSessionArtifacts(
            session
          );
        deletedObjectCount += result.deletedObjectCount;
        deletedVoiceModelCount += result.deletedVoiceModelCount;
        const completed = result.failures.length === 0;
        session.dataDeletionStatus = completed
          ? VoiceServiceDataDeletionStatus.completed
          : VoiceServiceDataDeletionStatus.partialFailed;
        session.dataDeletionCompletedAt = completed ? new Date() : undefined;
        session.dataDeletionFailures = result.failures;
        session.dataDeletionFailureReason = completed
          ? ''
          : '账号注销时仍有部分声音数据等待删除';
        partialFailure = partialFailure || !completed;
      } catch (error) {
        partialFailure = true;
        session.dataDeletionStatus =
          VoiceServiceDataDeletionStatus.partialFailed;
        session.dataDeletionFailureReason =
          error instanceof Error ? error.message : '声音数据删除失败';
      }

      session.updatedAt = new Date();
      await this.voiceServiceSessionModel.save(session);
    }

    return { deletedObjectCount, deletedVoiceModelCount, partialFailure };
  }

  private async deactivateRights(userId: MongoObjectId) {
    const now = new Date();
    const [memberships, entitlements] = await Promise.all([
      this.userMembershipModel.find({ where: { userId } }),
      this.agentEntitlementModel.find({ where: { userId } }),
    ]);
    const activeMemberships = memberships.filter(
      item => item.status === UserMembershipStatus.active
    );
    const activeEntitlements = entitlements.filter(
      item =>
        item.status === AgentEntitlementStatus.available ||
        item.status === AgentEntitlementStatus.used
    );

    await Promise.all([
      ...activeMemberships.map(item => {
        item.status = UserMembershipStatus.canceled;
        item.expiredAt = now;
        item.updatedAt = now;
        return this.userMembershipModel.save(item);
      }),
      ...activeEntitlements.map(item => {
        item.status = AgentEntitlementStatus.expired;
        item.expiredAt = now;
        item.updatedAt = now;
        return this.agentEntitlementModel.save(item);
      }),
    ]);

    return {
      memberships: activeMemberships.length,
      entitlements: activeEntitlements.length,
    };
  }

  private async deletePersonalAssets(values: Set<string>): Promise<{
    deleted: number;
    failed: number;
    failedKeys: string[];
  }> {
    const objectKeys = new Set<string>();
    for (const rawValue of values) {
      const value = rawValue?.trim();
      if (!value) {
        continue;
      }

      const fromUrl = this.tencentCosService.resolveObjectKeyFromPublicUrl(
        value,
        PERSONAL_ASSET_PREFIXES
      );
      const rawKey = PERSONAL_ASSET_PREFIXES.some(prefix =>
        value.startsWith(`${prefix}/`)
      )
        ? value
        : undefined;
      const objectKey = fromUrl || rawKey;
      if (objectKey) {
        objectKeys.add(objectKey);
      }
    }

    let deleted = 0;
    let failed = 0;
    const failedKeys: string[] = [];
    for (const objectKey of objectKeys) {
      try {
        await this.tencentCosService.deleteObject(objectKey);
        deleted += 1;
      } catch (error) {
        failed += 1;
        failedKeys.push(objectKey);
        this.logger.warn(
          '[account-cancellation] personal asset delete failed, objectKeyHash=%s error=%s',
          createHash('sha256').update(objectKey).digest('hex').slice(0, 12),
          error instanceof Error ? error.message : String(error)
        );
      }
    }

    return { deleted, failed, failedKeys };
  }

  private async enqueueCleanupRetry(userId: MongoObjectId): Promise<void> {
    const queue = this.bullmqFramework?.getQueue(
      ACCOUNT_CANCELLATION_CLEANUP_QUEUE
    );
    if (!queue) {
      this.logger.error(
        '[account-cancellation] cleanup retry queue unavailable, userId=%s',
        String(userId)
      );
      return;
    }

    const data: AccountCancellationCleanupJobData = {
      userId: String(userId),
    };
    await queue.addJobToQueue(
      data,
      {
        jobId: `account-cancellation:${String(userId)}`,
        attempts: 5,
        backoff: { type: 'exponential', delay: 60_000 },
        removeOnComplete: true,
        removeOnFail: 100,
      }
    );
  }

  private async anonymizeLoginAccounts(
    userId: MongoObjectId,
    canceledAt: Date
  ): Promise<void> {
    const accounts = await this.userAccountModel.find({ where: { userId } });

    await Promise.all(
      accounts.map(account => {
        const suffix = String(account.id).slice(-8);
        const accountHash = createHash('sha256')
          .update(`${account.account}:${String(userId)}`)
          .digest('hex')
          .slice(0, 16);

        return this.userAccountModel.updateOne(
          { _id: account.id },
          {
            $set: {
              account: `canceled:${accountHash}:${suffix}`,
              password: '',
              status: UserLoginAccountStatus.canceled,
              canceledAt,
              updatedAt: canceledAt,
            },
            $unset: { openId: '' },
          }
        );
      })
    );
  }

  private async runCleanupStage(
    summary: CleanupSummary,
    stage: string,
    task: () => Promise<void>
  ): Promise<void> {
    try {
      await task();
    } catch (error) {
      summary.failureStages.push(stage);
      this.logger.error(
        '[account-cancellation] cleanup stage failed, stage=%s error=%s',
        stage,
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  private async deleteMany<T>(
    repository: MongoRepository<T>,
    query: Record<string, unknown>
  ): Promise<number> {
    if (this.isEmptyIdQuery(query)) {
      return 0;
    }
    const result = await repository.deleteMany(query as never);
    return result.deletedCount ?? 0;
  }

  private byIds(ids: MongoObjectId[]): Record<string, unknown> {
    return ids.length ? { _id: { $in: ids } } : { _id: { $in: [] } };
  }

  private byForeignIds(
    field: string,
    ids: MongoObjectId[]
  ): Record<string, unknown> {
    return ids.length ? this.inForeignIds(field, ids) : { _id: { $in: [] } };
  }

  private byStringValues(
    field: string,
    values: string[]
  ): Record<string, unknown> {
    return values.length
      ? this.inStringValues(field, values)
      : { _id: { $in: [] } };
  }

  private inStringValues(
    field: string,
    values: string[]
  ): Record<string, unknown> {
    return { [field]: { $in: values } };
  }

  private inForeignIds(
    field: string,
    ids: MongoObjectId[]
  ): Record<string, unknown> {
    return { [field]: { $in: ids } };
  }

  private isEmptyIdQuery(query: Record<string, unknown>): boolean {
    const value = query._id as { $in?: unknown[] } | undefined;
    return Array.isArray(value?.$in) && value.$in.length === 0;
  }

  private uniqueEntities<T extends { id: MongoObjectId }>(items: T[]): T[] {
    return Array.from(
      new Map(items.map(item => [String(item.id), item])).values()
    );
  }

  private ensureUserCanCancel(user: UserEntity | null): asserts user is UserEntity {
    if (!user) {
      throw new AppError('USER_NOT_FOUND', 'user profile does not exist', 404);
    }
    if (user.accountStatus === UserAccountStatus.canceled) {
      throw new AppError(
        'ACCOUNT_ALREADY_CANCELED',
        '账号已注销',
        410
      );
    }
  }

  private async findUser(userId: MongoObjectId) {
    const userById = await this.userModel.findOne({ where: { id: userId } });
    if (userById) {
      return userById;
    }

    return this.userModel.findOne({
      where: { _id: userId } as never,
    });
  }

  private parseObjectId(value?: string): MongoObjectId {
    const normalized = value?.trim();
    if (!normalized || !MongoObjectId.isValid(normalized)) {
      throw new AppError('INVALID_TOKEN', 'token user id is invalid', 401);
    }
    return new MongoObjectId(normalized);
  }
}
