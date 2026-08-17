import { Inject, Logger, Provide } from '@midwayjs/core';
import { ILogger } from '@midwayjs/logger';
import { InjectEntityModel } from '@midwayjs/typeorm';
import * as bullmq from '@midwayjs/bullmq';
import type {
  ChatCompletion,
  ChatCompletionMessageParam,
} from 'openai/resources/chat/completions';
import { MongoRepository } from 'typeorm';
import { AppError } from '../common/errors';
import { CreatePostCommentDTO, CreatePostDTO } from '../dto/post.dto';
import {
  AgentEntity,
  MongoObjectId,
  PostCommentEntity,
  PostCommentNotificationEntity,
  PostCommentType,
  PostLikeEntity,
  PostNotificationEntity,
  PostNotificationType,
  PostEntity,
  PostModerationStatus,
  UserAccountEntity,
  UserEntity,
  UserMembershipEntity,
  UserMembershipStatus,
} from '@tzl/entities';
import { AuthenticatedUserPayload } from '../interface';
import { OpenAIService } from './agents/openai';
import {
  buildMomentsSystemPrompt,
  MomentCommentContext,
  MomentImageContext,
} from '../prompt/moments';
import { PostImageService } from './post-image.service';
import { WechatPayService } from './wechat-pay.service';

export const POST_REMIND_REPLY_QUEUE = 'post-remind-reply';
export const POST_COMMENT_AGENT_REPLY_QUEUE = 'post-comment-agent-reply';
const WEAPP_ACCOUNT_PREFIX = 'weapp:';
const WEAPP_ACCOUNT_HASH_PATTERN = /^[a-f0-9]{12}$/i;

const POST_AUTO_REPLY_DAILY_LIMIT = {
  nonVipLimit: 3,
} as const;

export interface PostRemindReplyJobData {
  postId: string;
  agentId: string;
  triggerCommentId?: string;
}

export interface PostItem {
  id: string;
  userId: string;
  authorName: string;
  authorAvatar: string;
  content: string;
  images: string[];
  imageThumbnails: string[];
  remindAgentIds: string[];
  moderationStatus: PostModerationStatus;
  moderationReason: string;
  isRiskControlled: boolean;
  likeCount: number;
  likedByMe: boolean;
  commentCount: number;
  comments: PostCommentItem[];
  createdAt: string;
  updatedAt: string;
}

export interface PostListResult {
  items: PostItem[];
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export interface PostCommentItem {
  id: string;
  postId: string;
  type: PostCommentType;
  userId: string;
  agentId: string;
  authorName: string;
  authorAvatar: string;
  content: string;
  parentCommentId: string;
  replyToUserId: string;
  replyToAgentId: string;
  replyToUserName: string;
  createdAt: string;
  updatedAt: string;
}

export interface PostCommentNotificationItem {
  id: string;
  postId: string;
  commentId: string;
  type: PostCommentType;
  actorName: string;
  actorAvatar: string;
  commentPreview: string;
  replyToUserName: string;
  postThumbnail: string;
  isRead: boolean;
  createdAt: string;
}

export interface PostCommentNotificationSummary {
  unreadCount: number;
  latest: PostCommentNotificationItem | null;
}

export interface PostCommentNotificationListResult {
  items: PostCommentNotificationItem[];
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export interface ReadCommentNotificationsResult {
  items: PostCommentNotificationItem[];
  readCount: number;
  unreadCount: number;
}

export interface PostNotificationItem {
  id: string;
  postId: string;
  type: PostNotificationType;
  commentId: string;
  commentType: PostCommentType | '';
  actorName: string;
  actorAvatar: string;
  contentPreview: string;
  replyToUserName: string;
  postThumbnail: string;
  postContentPreview: string;
  isSeen: boolean;
  isRead: boolean;
  createdAt: string;
}

export interface PostNotificationSummary {
  unreadCount: number;
  latest: PostNotificationItem | null;
  unseenCount: number;
  latestUnseen: PostNotificationItem | null;
}

export interface PostNotificationEntrySummary {
  unseenCount: number;
  latestUnseen: PostNotificationItem | null;
}

export interface PostNotificationListResult {
  items: PostNotificationItem[];
  page: number;
  pageSize: number;
  hasMore: boolean;
  readFilterApplied?: boolean;
}

export interface ReadPostNotificationsResult {
  items: PostNotificationItem[];
  readCount: number;
  unreadCount: number;
}

export interface ReadPostNotificationResult {
  notificationId: string;
  readCount: number;
  unreadCount: number;
}

export interface SeePostNotificationsResult {
  seenCount: number;
  unseenCount: number;
  unreadCount: number;
}

interface PostLikeSummary {
  likeCountByPostId: Map<string, number>;
  likedPostIds: Set<string>;
}

interface PostCommentPreviewSummary {
  count: number;
  items: PostCommentItem[];
}

interface ListPostsOptions {
  page?: number | string;
  pageSize?: number | string;
  mine?: boolean | string;
  lightweight?: boolean | string;
  read?: boolean | string;
}

type MongoWhere = Record<string, unknown>;

@Provide()
export class PostService {
  @Logger()
  logger: ILogger;

  @Inject()
  postImageService: PostImageService;

  @Inject()
  openAIService: OpenAIService;

  @Inject()
  wechatPayService: WechatPayService;

  @Inject()
  bullmqFramework: bullmq.Framework;

  @InjectEntityModel(PostEntity)
  postModel: MongoRepository<PostEntity>;

  @InjectEntityModel(PostCommentEntity)
  commentModel: MongoRepository<PostCommentEntity>;

  @InjectEntityModel(PostCommentNotificationEntity)
  commentNotificationModel: MongoRepository<PostCommentNotificationEntity>;

  @InjectEntityModel(PostLikeEntity)
  likeModel: MongoRepository<PostLikeEntity>;

  @InjectEntityModel(PostNotificationEntity)
  notificationModel: MongoRepository<PostNotificationEntity>;

  @InjectEntityModel(AgentEntity)
  agentModel: MongoRepository<AgentEntity>;

  @InjectEntityModel(UserEntity)
  userModel: MongoRepository<UserEntity>;

  @InjectEntityModel(UserMembershipEntity)
  userMembershipModel: MongoRepository<UserMembershipEntity>;

  @InjectEntityModel(UserAccountEntity)
  userAccountModel: MongoRepository<UserAccountEntity>;

  async listPosts(
    auth?: AuthenticatedUserPayload,
    options: ListPostsOptions = {}
  ): Promise<PostListResult> {
    const page = this.normalizePositiveInteger(options.page, 1);
    const pageSize = this.normalizePositiveInteger(options.pageSize, 10, 20);
    const skip = (page - 1) * pageSize;
    const currentUserId = auth?.sub ? this.parseObjectId(auth.sub) : null;
    const onlyMine = this.normalizeBoolean(options.mine);
    const lightweight = this.normalizeBoolean(options.lightweight);

    if (onlyMine && !currentUserId) {
      throw new AppError('UNAUTHORIZED', 'login required', 401);
    }

    const where = this.buildListPostsWhere(onlyMine, currentUserId);
    const posts = await this.postModel.find({
      where: where as never,
      order: {
        createdAt: 'DESC',
      },
      skip,
      take: pageSize + 1,
    });
    const pagePosts = posts.slice(0, pageSize);
    const likeSummary = await this.buildLikeSummary(pagePosts, currentUserId);

    const authorCache = new Map<string, UserEntity | null>();
    const agentCache = new Map<string, AgentEntity | null>();

    await this.primeUserCache(
      pagePosts.map(post => post.userId),
      authorCache
    );

    const postIds = pagePosts.map(post => post.id);
    const commentPreviewsByPostId = lightweight
      ? await this.listCommentPreviewSummariesByPostIds(
          postIds,
          authorCache,
          agentCache,
          2
        )
      : null;
    const commentsByPostId = lightweight
      ? null
      : await this.listCommentItemsByPostIds(postIds, authorCache, agentCache);
    const items = pagePosts.map(post => {
      const userId = this.stringifyObjectId(post.userId);
      const postId = this.stringifyObjectId(post.id);
      const commentPreview = commentPreviewsByPostId?.get(postId);
      const comments =
        commentPreview?.items ?? commentsByPostId?.get(postId) ?? [];

      return this.buildPostItem(
        post,
        authorCache.get(userId) ?? null,
        likeSummary.likeCountByPostId.get(postId) ?? 0,
        likeSummary.likedPostIds.has(postId),
        commentPreview?.count ?? comments.length,
        comments
      );
    });

    return {
      items,
      page,
      pageSize,
      hasMore: posts.length > pageSize,
    };
  }

  async getPostDetail(
    postId: string,
    auth?: AuthenticatedUserPayload
  ): Promise<PostItem> {
    const post = await this.getPostById(postId);
    this.assertPostViewable(post, auth);
    const user = await this.findUserById(post.userId);
    const authorCache = new Map<string, UserEntity | null>();
    const agentCache = new Map<string, AgentEntity | null>();
    const currentUserId = auth?.sub ? this.parseObjectId(auth.sub) : null;
    const likeSummary = await this.buildLikeSummary([post], currentUserId);
    const comments = await this.listCommentItemsByPostId(
      post.id,
      authorCache,
      agentCache
    );
    const normalizedPostId = this.stringifyObjectId(post.id);

    return this.buildPostItem(
      post,
      user,
      likeSummary.likeCountByPostId.get(normalizedPostId) ?? 0,
      likeSummary.likedPostIds.has(normalizedPostId),
      comments.length,
      comments
    );
  }

  async getUnreadCommentNotificationSummary(
    auth: AuthenticatedUserPayload
  ): Promise<PostCommentNotificationSummary> {
    const userId = this.parseObjectId(auth.sub);
    const unreadCount = await this.commentNotificationModel.count({
      userId,
      isRead: false,
    });
    const notifications = await this.commentNotificationModel.find({
      where: {
        userId,
        isRead: false,
      },
      order: {
        createdAt: 'DESC',
      },
      take: 1,
    });

    return {
      unreadCount,
      latest:
        notifications.length > 0
          ? this.buildCommentNotificationItem(notifications[0])
          : null,
    };
  }

  async listCommentNotifications(
    auth: AuthenticatedUserPayload,
    options: ListPostsOptions = {}
  ): Promise<PostCommentNotificationListResult> {
    const userId = this.parseObjectId(auth.sub);
    const page = this.normalizePositiveInteger(options.page, 1);
    const pageSize = this.normalizePositiveInteger(options.pageSize, 20, 50);
    const skip = (page - 1) * pageSize;
    const notifications = await this.commentNotificationModel.find({
      where: {
        userId,
      },
      order: {
        createdAt: 'DESC',
      },
      skip,
      take: pageSize + 1,
    });
    const pageNotifications = notifications.slice(0, pageSize);

    return {
      items: pageNotifications.map(notification =>
        this.buildCommentNotificationItem(notification)
      ),
      page,
      pageSize,
      hasMore: notifications.length > pageSize,
    };
  }

  async getUnreadPostNotificationSummary(
    auth: AuthenticatedUserPayload
  ): Promise<PostNotificationSummary> {
    const userId = this.parseObjectId(auth.sub);
    const unreadQuery = { userId, isRead: false };
    const [notifications, legacyCommentNotifications, user] = await Promise.all(
      [
        this.notificationModel.find({
          where: unreadQuery,
          order: {
            createdAt: 'DESC',
          },
        }),
        this.commentNotificationModel.find({
          where: unreadQuery,
          order: {
            createdAt: 'DESC',
          },
        }),
        this.findUserById(userId),
      ]
    );
    const validNotifications = await this.filterAndPrunePostNotifications(
      notifications,
      legacyCommentNotifications
    );
    const items = this.mergePostNotificationItems(
      validNotifications.notifications,
      validNotifications.legacyCommentNotifications,
      validNotifications.postContentPreviewById
    );
    const unseenItems = this.filterUnseenPostNotificationItems(
      items,
      user?.postNotificationSeenAt
    );

    return {
      unreadCount: items.length,
      latest: items[0] ?? null,
      unseenCount: unseenItems.length,
      latestUnseen: unseenItems[0] ?? null,
    };
  }

  async getPostNotificationEntrySummary(
    auth: AuthenticatedUserPayload
  ): Promise<PostNotificationEntrySummary> {
    const userId = this.parseObjectId(auth.sub);
    const user = await this.findUserById(userId);
    const seenAt = this.normalizeDate(user?.postNotificationSeenAt);
    const where = seenAt
      ? {
          userId,
          createdAt: {
            $gt: seenAt,
          },
        }
      : { userId };
    const [notifications, legacyCommentNotifications] = await Promise.all([
      this.notificationModel.find({
        where: where as never,
        order: {
          createdAt: 'DESC',
        },
      }),
      this.commentNotificationModel.find({
        where: where as never,
        order: {
          createdAt: 'DESC',
        },
      }),
    ]);
    const validNotifications = await this.filterAndPrunePostNotifications(
      notifications,
      legacyCommentNotifications
    );
    const unseenItems = this.filterUnseenPostNotificationItems(
      this.mergePostNotificationItems(
        validNotifications.notifications,
        validNotifications.legacyCommentNotifications,
        validNotifications.postContentPreviewById
      ),
      seenAt
    );

    return {
      unseenCount: unseenItems.length,
      latestUnseen: unseenItems[0] ?? null,
    };
  }

  async listPostNotifications(
    auth: AuthenticatedUserPayload,
    options: ListPostsOptions = {}
  ): Promise<PostNotificationListResult> {
    const userId = this.parseObjectId(auth.sub);
    const page = this.normalizePositiveInteger(options.page, 1);
    const pageSize = this.normalizePositiveInteger(options.pageSize, 20, 50);
    const skip = (page - 1) * pageSize;
    const take = skip + pageSize + 1;
    const readFilter = this.normalizeOptionalBoolean(options.read);
    const where = {
      userId,
      ...(readFilter === undefined ? {} : { isRead: readFilter }),
    };
    const notifications = await this.notificationModel.find({
      where,
      order: {
        createdAt: 'DESC',
      },
      take,
    });
    const legacyCommentNotifications = await this.commentNotificationModel.find(
      {
        where,
        order: {
          createdAt: 'DESC',
        },
        take,
      }
    );
    const validNotifications = await this.filterAndPrunePostNotifications(
      notifications,
      legacyCommentNotifications
    );
    const items = this.mergePostNotificationItems(
      validNotifications.notifications,
      validNotifications.legacyCommentNotifications,
      validNotifications.postContentPreviewById
    );
    const pageItems = items.slice(skip, skip + pageSize);

    return {
      items: pageItems,
      page,
      pageSize,
      hasMore: items.length > skip + pageSize,
      readFilterApplied: readFilter !== undefined,
    };
  }

  async readUnreadPostNotifications(
    auth: AuthenticatedUserPayload
  ): Promise<ReadPostNotificationsResult> {
    const userId = this.parseObjectId(auth.sub);
    const notifications = await this.notificationModel.find({
      where: {
        userId,
        isRead: false,
      },
      order: {
        createdAt: 'DESC',
      },
    });
    const legacyCommentNotifications = await this.commentNotificationModel.find(
      {
        where: {
          userId,
          isRead: false,
        },
        order: {
          createdAt: 'DESC',
        },
      }
    );
    const validNotifications = await this.filterAndPrunePostNotifications(
      notifications,
      legacyCommentNotifications
    );
    const items = this.mergePostNotificationItems(
      validNotifications.notifications,
      validNotifications.legacyCommentNotifications,
      validNotifications.postContentPreviewById
    );
    const now = new Date();

    for (const notification of validNotifications.notifications) {
      notification.isSeen = true;
      notification.seenAt = notification.seenAt ?? now;
      notification.isRead = true;
      notification.readAt = now;
      notification.updatedAt = now;
    }

    for (const notification of validNotifications.legacyCommentNotifications) {
      notification.isSeen = true;
      notification.seenAt = notification.seenAt ?? now;
      notification.isRead = true;
      notification.readAt = now;
      notification.updatedAt = now;
    }

    if (validNotifications.notifications.length > 0) {
      await this.notificationModel.save(validNotifications.notifications);
    }

    if (validNotifications.legacyCommentNotifications.length > 0) {
      await this.commentNotificationModel.save(
        validNotifications.legacyCommentNotifications
      );
    }

    const unreadCount = await this.countUnreadPostNotifications(userId);

    return {
      items,
      readCount: items.length,
      unreadCount,
    };
  }

  async seePostNotifications(
    auth: AuthenticatedUserPayload
  ): Promise<SeePostNotificationsResult> {
    const userId = this.parseObjectId(auth.sub);
    const unreadQuery = { userId, isRead: false };
    const [notifications, legacyCommentNotifications, user] = await Promise.all(
      [
        this.notificationModel.find({
          where: unreadQuery,
          order: {
            createdAt: 'DESC',
          },
        }),
        this.commentNotificationModel.find({
          where: unreadQuery,
          order: {
            createdAt: 'DESC',
          },
        }),
        this.findUserById(userId),
      ]
    );
    const validNotifications = await this.filterAndPrunePostNotifications(
      notifications,
      legacyCommentNotifications
    );
    const unseenItems = this.filterUnseenPostNotificationItems(
      this.mergePostNotificationItems(
        validNotifications.notifications,
        validNotifications.legacyCommentNotifications,
        validNotifications.postContentPreviewById
      ),
      user?.postNotificationSeenAt
    );
    const unseenNotifications = validNotifications.notifications.filter(
      notification => notification.isSeen !== true
    );
    const unseenLegacyNotifications =
      validNotifications.legacyCommentNotifications.filter(
        notification => notification.isSeen !== true
      );
    const now = new Date();

    for (const notification of unseenNotifications) {
      notification.isSeen = true;
      notification.seenAt = now;
      notification.updatedAt = now;
    }

    for (const notification of unseenLegacyNotifications) {
      notification.isSeen = true;
      notification.seenAt = now;
      notification.updatedAt = now;
    }

    if (unseenNotifications.length > 0) {
      await this.notificationModel.save(unseenNotifications);
    }

    if (unseenLegacyNotifications.length > 0) {
      await this.commentNotificationModel.save(unseenLegacyNotifications);
    }

    if (user) {
      const latestCreatedAt = this.getLatestPostNotificationCreatedAt(
        validNotifications.notifications,
        validNotifications.legacyCommentNotifications
      );
      const previousSeenAt = this.normalizeDate(user.postNotificationSeenAt);
      const nextSeenAt =
        latestCreatedAt && (!previousSeenAt || latestCreatedAt > previousSeenAt)
          ? latestCreatedAt
          : previousSeenAt ?? new Date();

      user.postNotificationSeenAt = nextSeenAt;
      await this.userModel.save(user);
    }

    return {
      seenCount: unseenItems.length,
      unseenCount: 0,
      unreadCount: await this.countUnreadPostNotifications(userId),
    };
  }

  async readPostNotification(
    auth: AuthenticatedUserPayload,
    notificationId: string
  ): Promise<ReadPostNotificationResult> {
    const userId = this.parseObjectId(auth.sub);
    const normalizedNotificationId = this.normalizeObjectId(notificationId);

    if (!normalizedNotificationId) {
      throw new AppError(
        'POST_NOTIFICATION_NOT_FOUND',
        'post notification not found',
        404
      );
    }

    const [targetNotification, targetLegacyNotification] = await Promise.all([
      this.findPostNotificationByIdForUser(userId, normalizedNotificationId),
      this.findLegacyCommentNotificationByIdForUser(
        userId,
        normalizedNotificationId
      ),
    ]);
    const targetNotifications = targetNotification ? [targetNotification] : [];
    const targetLegacyNotifications = targetLegacyNotification
      ? [targetLegacyNotification]
      : [];

    if (
      targetNotifications.length === 0 &&
      targetLegacyNotifications.length === 0
    ) {
      throw new AppError(
        'POST_NOTIFICATION_NOT_FOUND',
        'post notification not found',
        404
      );
    }

    const relatedCommentIds = new Set<string>();

    for (const notification of targetNotifications) {
      if (
        notification.type === PostNotificationType.comment &&
        notification.commentId
      ) {
        relatedCommentIds.add(this.stringifyObjectId(notification.commentId));
      }
    }

    for (const notification of targetLegacyNotifications) {
      relatedCommentIds.add(this.stringifyObjectId(notification.commentId));
    }

    const relatedCommentId = Array.from(relatedCommentIds)[0];
    const [mirroredNotifications, mirroredLegacyNotifications] =
      relatedCommentId
        ? await Promise.all([
            this.notificationModel.find({
              where: {
                userId,
                commentId: this.parseObjectId(relatedCommentId),
                type: PostNotificationType.comment,
              },
            }),
            this.commentNotificationModel.find({
              where: {
                userId,
                commentId: this.parseObjectId(relatedCommentId),
              },
            }),
          ])
        : [[], []];
    const notificationsToRead = Array.from(
      new Set([...targetNotifications, ...mirroredNotifications])
    );
    const legacyNotificationsToRead = Array.from(
      new Set([...targetLegacyNotifications, ...mirroredLegacyNotifications])
    );
    const now = new Date();
    const unreadNotifications = notificationsToRead.filter(
      notification => notification.isRead !== true
    );
    const unreadLegacyNotifications = legacyNotificationsToRead.filter(
      notification => notification.isRead !== true
    );

    for (const notification of unreadNotifications) {
      notification.isSeen = true;
      notification.seenAt = notification.seenAt ?? now;
      notification.isRead = true;
      notification.readAt = now;
      notification.updatedAt = now;
    }

    for (const notification of unreadLegacyNotifications) {
      notification.isSeen = true;
      notification.seenAt = notification.seenAt ?? now;
      notification.isRead = true;
      notification.readAt = now;
      notification.updatedAt = now;
    }

    if (unreadNotifications.length > 0) {
      await this.notificationModel.save(unreadNotifications);
    }

    if (unreadLegacyNotifications.length > 0) {
      await this.commentNotificationModel.save(unreadLegacyNotifications);
    }

    return {
      notificationId: this.stringifyObjectId(normalizedNotificationId),
      readCount: unreadNotifications.length + unreadLegacyNotifications.length,
      unreadCount: await this.countUnreadPostNotifications(userId),
    };
  }

  private async countUnreadPostNotifications(
    userId: MongoObjectId
  ): Promise<number> {
    const notifications = await this.notificationModel.find({
      where: {
        userId,
        isRead: false,
      },
    });
    const legacyCommentNotifications = await this.commentNotificationModel.find(
      {
        where: {
          userId,
          isRead: false,
        },
      }
    );

    const validNotifications = await this.filterAndPrunePostNotifications(
      notifications,
      legacyCommentNotifications
    );

    return this.mergePostNotificationItems(
      validNotifications.notifications,
      validNotifications.legacyCommentNotifications,
      validNotifications.postContentPreviewById
    ).length;
  }

  private async findPostNotificationByIdForUser(
    userId: MongoObjectId,
    notificationId: MongoObjectId
  ): Promise<PostNotificationEntity | null> {
    const byId = await this.notificationModel.findOne({
      where: {
        id: notificationId,
        userId,
      },
    });

    if (byId) {
      return byId;
    }

    return this.notificationModel.findOne({
      where: {
        _id: notificationId,
        userId,
      } as never,
    });
  }

  private async findLegacyCommentNotificationByIdForUser(
    userId: MongoObjectId,
    notificationId: MongoObjectId
  ): Promise<PostCommentNotificationEntity | null> {
    const byId = await this.commentNotificationModel.findOne({
      where: {
        id: notificationId,
        userId,
      },
    });

    if (byId) {
      return byId;
    }

    return this.commentNotificationModel.findOne({
      where: {
        _id: notificationId,
        userId,
      } as never,
    });
  }

  private async markMirroredPostCommentNotificationsRead(
    userId: MongoObjectId,
    commentIds: MongoObjectId[],
    now: Date
  ): Promise<void> {
    const normalizedCommentIds = new Set(
      commentIds.map(commentId => this.stringifyObjectId(commentId))
    );

    if (normalizedCommentIds.size === 0) {
      return;
    }

    const notifications = await this.notificationModel.find({
      where: {
        userId,
        isRead: false,
      },
    });
    const mirroredNotifications = notifications.filter(
      notification =>
        notification.type === PostNotificationType.comment &&
        Boolean(notification.commentId) &&
        normalizedCommentIds.has(
          this.stringifyObjectId(notification.commentId!)
        )
    );

    for (const notification of mirroredNotifications) {
      notification.isSeen = true;
      notification.seenAt = notification.seenAt ?? now;
      notification.isRead = true;
      notification.readAt = now;
      notification.updatedAt = now;
    }

    if (mirroredNotifications.length > 0) {
      await this.notificationModel.save(mirroredNotifications);
    }
  }

  async readUnreadCommentNotifications(
    auth: AuthenticatedUserPayload
  ): Promise<ReadCommentNotificationsResult> {
    const userId = this.parseObjectId(auth.sub);
    const notifications = await this.commentNotificationModel.find({
      where: {
        userId,
        isRead: false,
      },
      order: {
        createdAt: 'DESC',
      },
    });
    const items = notifications.map(notification =>
      this.buildCommentNotificationItem(notification)
    );
    const now = new Date();

    for (const notification of notifications) {
      notification.isSeen = true;
      notification.seenAt = notification.seenAt ?? now;
      notification.isRead = true;
      notification.readAt = now;
      notification.updatedAt = now;
    }

    if (notifications.length > 0) {
      await this.commentNotificationModel.save(notifications);
      await this.markMirroredPostCommentNotificationsRead(
        userId,
        notifications.map(notification => notification.commentId),
        now
      );
    }

    const unreadCount = await this.commentNotificationModel.count({
      userId,
      isRead: false,
    });

    return {
      items,
      readCount: notifications.length,
      unreadCount,
    };
  }

  async markPostCommentNotificationsRead(
    auth: AuthenticatedUserPayload,
    postId: string
  ): Promise<{
    postId: string;
    readCount: number;
    unreadCount: number;
  }> {
    const userId = this.parseObjectId(auth.sub);
    const post = await this.getPostById(postId);

    if (
      this.stringifyObjectId(post.userId) !== this.stringifyObjectId(userId)
    ) {
      throw new AppError('POST_NOT_FOUND', 'post not found', 404);
    }

    const notifications = await this.commentNotificationModel.find({
      where: {
        userId,
        postId: post.id,
        isRead: false,
      },
      order: {
        createdAt: 'DESC',
      },
    });

    const now = new Date();
    for (const notification of notifications) {
      notification.isSeen = true;
      notification.seenAt = notification.seenAt ?? now;
      notification.isRead = true;
      notification.readAt = now;
      notification.updatedAt = now;
    }

    if (notifications.length > 0) {
      await this.commentNotificationModel.save(notifications);
      await this.markMirroredPostCommentNotificationsRead(
        userId,
        notifications.map(notification => notification.commentId),
        now
      );
    }

    const unreadCount = await this.commentNotificationModel.count({
      userId,
      isRead: false,
    });

    return {
      postId: this.stringifyObjectId(post.id),
      readCount: notifications.length,
      unreadCount,
    };
  }

  async createPost(
    auth: AuthenticatedUserPayload,
    payload: CreatePostDTO
  ): Promise<PostItem> {
    const userId = this.parseObjectId(auth.sub);
    const user = await this.findUserById(userId);
    const now = new Date();

    this.assertUserCanCreatePost(user, now);

    const content = this.normalizeContent(payload?.content);
    const images = this.normalizeImages(payload?.images);
    const remindAgentIds = await this.normalizeRemindAgentIds(
      userId,
      payload?.remindAgentIds
    );

    if (!content && images.length === 0) {
      throw new AppError(
        'INVALID_POST',
        'post content or images are required',
        400
      );
    }

    const post = new PostEntity();
    post.userId = userId;
    post.content = content;
    post.images = images;
    post.remindAgentIds = remindAgentIds;
    post.moderationStatus = PostModerationStatus.normal;
    post.isDeleted = false;
    post.createdAt = now;
    post.updatedAt = now;

    const savedPost = await this.postModel.save(post);
    await this.enqueueRemindReplyJobs(savedPost);

    return this.buildPostItem(savedPost, user, 0, false, 0, []);
  }

  async deletePost(
    auth: AuthenticatedUserPayload,
    postId: string
  ): Promise<{ id: string; deleted: true }> {
    const post = await this.getPostById(postId);
    const userId = this.parseObjectId(auth.sub);

    if (!this.isSameObjectId(post.userId, userId)) {
      throw new AppError('POST_NOT_FOUND', 'post not found', 404);
    }

    if (post.isDeleted !== true) {
      const now = new Date();
      post.isDeleted = true;
      post.deletedAt = now;
      post.deletedByUserId = userId;
      post.updatedAt = now;
      await this.postModel.save(post);
    }

    await this.deleteNotificationsByPostId(post.id);

    return {
      id: this.stringifyObjectId(post.id),
      deleted: true,
    };
  }

  async likePost(
    auth: AuthenticatedUserPayload,
    postId: string
  ): Promise<PostItem> {
    const post = await this.getPostById(postId);
    const userId = this.parseObjectId(auth.sub);
    this.assertPostViewableByUser(post, userId);
    const existing = await this.findLike(post.id, userId);
    let shouldCreateNotification = false;

    if (!existing) {
      const now = new Date();
      const like = new PostLikeEntity();
      like.postId = post.id;
      like.userId = userId;
      like.createdAt = now;
      like.updatedAt = now;

      try {
        await this.likeModel.save(like);
        shouldCreateNotification = true;
      } catch (error) {
        const duplicateCode = (error as { code?: number } | undefined)?.code;

        if (duplicateCode !== 11000) {
          throw error;
        }
      }
    }

    if (shouldCreateNotification) {
      const user = await this.findUserById(userId);
      try {
        await this.createLikeNotification(post, userId, user);
      } catch (error) {
        await this.likeModel
          .deleteOne({
            postId: post.id,
            userId,
          } as never)
          .catch(cleanupError => {
            this.logger.warn(
              '[post-like] failed to roll back like after notification failure, postId=%s, userId=%s, error=%s',
              postId,
              auth.sub,
              String(cleanupError)
            );
          });
        throw error;
      }
    }

    return this.getPostDetail(postId, auth);
  }

  async unlikePost(
    auth: AuthenticatedUserPayload,
    postId: string
  ): Promise<PostItem> {
    const post = await this.getPostById(postId);
    const userId = this.parseObjectId(auth.sub);
    this.assertPostViewableByUser(post, userId);

    await this.deleteLikeNotification(post.id, userId);
    await this.likeModel.deleteOne({
      postId: post.id,
      userId,
    } as never);

    return this.getPostDetail(postId, auth);
  }

  async listComments(
    postId: string,
    auth?: AuthenticatedUserPayload
  ): Promise<PostCommentItem[]> {
    const post = await this.getPostById(postId);
    this.assertPostViewable(post, auth);
    const authorCache = new Map<string, UserEntity | null>();
    const agentCache = new Map<string, AgentEntity | null>();
    return this.listCommentItemsByPostId(post.id, authorCache, agentCache);
  }

  async createComment(
    auth: AuthenticatedUserPayload,
    postId: string,
    payload: CreatePostCommentDTO
  ): Promise<PostCommentItem> {
    const post = await this.getPostById(postId);
    const userId = this.parseObjectId(auth.sub);
    this.assertPostViewableByUser(post, userId);
    const content = this.normalizeCommentContent(payload?.content);
    await this.checkCommentContentSafety(auth, content);

    const user = await this.findUserById(userId);
    const replyToComment = await this.findReplyTarget(
      post.id,
      payload?.replyToCommentId
    );
    const replyToUser = replyToComment?.replyToUserId
      ? await this.findUserById(replyToComment.replyToUserId)
      : replyToComment?.userId
      ? await this.findUserById(replyToComment.userId)
      : null;
    const replyToAgent = replyToComment?.replyToAgentId
      ? await this.findAgentById(replyToComment.replyToAgentId)
      : replyToComment?.agentId
      ? await this.findAgentById(replyToComment.agentId)
      : null;
    const now = new Date();
    const comment = new PostCommentEntity();

    comment.postId = post.id;
    comment.userId = userId;
    comment.type = PostCommentType.user;
    comment.content = content;
    comment.parentCommentId = replyToComment?.id;
    comment.replyToUserId =
      replyToComment?.replyToUserId ?? replyToComment?.userId;
    comment.replyToAgentId =
      replyToComment?.replyToAgentId ?? replyToComment?.agentId;
    comment.createdAt = now;
    comment.updatedAt = now;

    const savedComment = await this.commentModel.save(comment);
    try {
      await this.createCommentNotification(post, savedComment, user, null);
      await this.enqueueAgentCommentReplyJob(
        post,
        savedComment,
        replyToComment
      );
    } catch (error) {
      await this.rollbackCreatedComment(savedComment);
      throw error;
    }

    return this.buildCommentItem(
      savedComment,
      user,
      replyToUser,
      null,
      replyToAgent
    );
  }

  async processRemindReplyJob(data: PostRemindReplyJobData): Promise<void> {
    const postId = data?.postId?.trim();
    const agentId = data?.agentId?.trim();
    const triggerCommentId = data?.triggerCommentId?.trim();

    if (!postId || !agentId) {
      this.logger.warn(
        '[post-remind-reply] skip invalid job payload, postId=%s, agentId=%s',
        postId,
        agentId
      );
      return;
    }

    const post = await this.getPostById(postId);

    if (this.isPostDeleted(post) || this.isPostRiskControlled(post)) {
      this.logger.info(
        '[post-remind-reply] skip hidden post, postId=%s, agentId=%s',
        postId,
        agentId
      );
      return;
    }

    const agent = await this.findAgentById(agentId);
    const user = await this.findUserById(post.userId);

    if (!agent || !user) {
      this.logger.warn(
        '[post-remind-reply] skip job due to missing resources, postId=%s, agentId=%s',
        postId,
        agentId
      );
      return;
    }

    const ownerUserId = this.stringifyObjectId(post.userId);
    if (this.stringifyObjectId(agent.createdUserId) !== ownerUserId) {
      this.logger.info(
        '[post-remind-reply] skip unauthorized or stale remind target, postId=%s, agentId=%s',
        postId,
        agentId
      );
      return;
    }

    if (triggerCommentId) {
      await this.processAgentCommentReplyJob(
        post,
        user,
        agent,
        triggerCommentId
      );
      return;
    }

    if (!(await this.shouldAutoReplyToPost(post, new Date()))) {
      this.logger.info(
        '[post-remind-reply] skip non-vip daily post reply limit, postId=%s, agentId=%s',
        postId,
        agentId
      );
      return;
    }

    if (
      !Array.isArray(post.remindAgentIds) ||
      !post.remindAgentIds.includes(agentId)
    ) {
      this.logger.info(
        '[post-remind-reply] skip unauthorized or stale remind target, postId=%s, agentId=%s',
        postId,
        agentId
      );
      return;
    }

    const existing = await this.commentModel.findOne({
      where: {
        postId: post.id,
        agentId: agent.id,
      },
    });

    if (existing) {
      this.logger.info(
        '[post-remind-reply] agent comment already exists, postId=%s, agentId=%s',
        postId,
        agentId
      );
      return;
    }

    const content = await this.generateAgentPostReply(post, user, agent);
    if (!content) {
      this.logger.warn(
        '[post-remind-reply] skip empty generated reply, postId=%s, agentId=%s',
        postId,
        agentId
      );
      return;
    }

    await this.saveAgentReplyComment(post, agent, content);
    this.logger.info(
      '[post-remind-reply] created agent comment, postId=%s, agentId=%s',
      postId,
      agentId
    );
  }

  private async processAgentCommentReplyJob(
    post: PostEntity,
    user: UserEntity,
    agent: AgentEntity,
    triggerCommentId: string
  ): Promise<void> {
    const postId = this.stringifyObjectId(post.id);
    const agentId = this.stringifyObjectId(agent.id);
    const triggerComment = await this.findCommentById(
      post.id,
      triggerCommentId
    );

    const repliedComment = triggerComment?.parentCommentId
      ? await this.findCommentById(post.id, triggerComment.parentCommentId)
      : null;

    if (
      !triggerComment ||
      !this.isAgentCommentReplyTrigger(triggerComment, agent, repliedComment)
    ) {
      this.logger.info(
        '[post-remind-reply] skip invalid comment reply trigger, postId=%s, agentId=%s, triggerCommentId=%s',
        postId,
        agentId,
        triggerCommentId
      );
      return;
    }

    if (!(await this.isUserVip(post.userId, new Date()))) {
      this.logger.info(
        '[post-remind-reply] skip non-vip comment reply, postId=%s, agentId=%s, triggerCommentId=%s',
        postId,
        agentId,
        triggerCommentId
      );
      return;
    }

    const existing = await this.commentModel.findOne({
      where: {
        postId: post.id,
        agentId: agent.id,
        parentCommentId: triggerComment.id,
      } as never,
    });

    if (existing) {
      this.logger.info(
        '[post-remind-reply] agent comment reply already exists, postId=%s, agentId=%s, triggerCommentId=%s',
        postId,
        agentId,
        triggerCommentId
      );
      return;
    }

    const content = await this.generateAgentPostReply(
      post,
      user,
      agent,
      triggerComment.id
    );
    if (!content) {
      this.logger.warn(
        '[post-remind-reply] skip empty generated reply, postId=%s, agentId=%s',
        postId,
        agentId
      );
      return;
    }

    await this.saveAgentReplyComment(post, agent, content, triggerComment);
    this.logger.info(
      '[post-remind-reply] created agent comment reply, postId=%s, agentId=%s, triggerCommentId=%s',
      postId,
      agentId,
      triggerCommentId
    );
  }

  private async saveAgentReplyComment(
    post: PostEntity,
    agent: AgentEntity,
    content: string,
    triggerComment?: PostCommentEntity
  ): Promise<PostCommentEntity> {
    const now = new Date();
    const comment = new PostCommentEntity();
    comment.postId = post.id;
    comment.agentId = agent.id;
    comment.type = PostCommentType.agent;
    comment.content = content;
    comment.parentCommentId = triggerComment?.id;
    comment.replyToUserId = triggerComment?.userId;
    comment.createdAt = now;
    comment.updatedAt = now;

    const savedComment = await this.commentModel.save(comment);

    try {
      await this.createCommentNotification(post, savedComment, null, agent);
      return savedComment;
    } catch (error) {
      await this.rollbackCreatedComment(savedComment);
      throw error;
    }
  }

  private buildListPostsWhere(
    onlyMine: boolean,
    currentUserId?: MongoObjectId | null
  ): MongoWhere {
    const where: MongoWhere = {
      isDeleted: {
        $ne: true,
      },
    };

    if (onlyMine && currentUserId) {
      where.userId = currentUserId;
      return where;
    }

    where.moderationStatus = {
      $ne: PostModerationStatus.riskControlled,
    };

    return where;
  }

  private assertPostViewable(
    post: PostEntity,
    auth?: AuthenticatedUserPayload
  ): void {
    const currentUserId = auth?.sub ? this.parseObjectId(auth.sub) : null;
    this.assertPostViewableByUser(post, currentUserId);
  }

  private assertPostViewableByUser(
    post: PostEntity,
    currentUserId?: MongoObjectId | null
  ): void {
    if (this.isPostDeleted(post)) {
      throw new AppError('POST_NOT_FOUND', 'post not found', 404);
    }

    if (
      this.isPostRiskControlled(post) &&
      !this.isPostOwner(post, currentUserId)
    ) {
      throw new AppError('POST_NOT_FOUND', 'post not found', 404);
    }
  }

  private isPostOwner(
    post: PostEntity,
    currentUserId?: MongoObjectId | null
  ): boolean {
    return Boolean(
      currentUserId && this.isSameObjectId(post.userId, currentUserId)
    );
  }

  private isPostDeleted(post: PostEntity): boolean {
    return post.isDeleted === true;
  }

  private isPostRiskControlled(post: PostEntity): boolean {
    return (
      this.normalizePostModerationStatus(post.moderationStatus) ===
      PostModerationStatus.riskControlled
    );
  }

  private normalizePostModerationStatus(
    value?: PostModerationStatus | string
  ): PostModerationStatus {
    return value === PostModerationStatus.riskControlled
      ? PostModerationStatus.riskControlled
      : PostModerationStatus.normal;
  }

  private assertUserCanCreatePost(user: UserEntity | null, now: Date): void {
    const riskControlUntilAt = this.normalizeDate(user?.riskControlUntilAt);

    if (!riskControlUntilAt || riskControlUntilAt <= now) {
      return;
    }

    throw new AppError(
      'USER_RISK_CONTROLLED',
      '账号处于风控状态，暂时不能发布朋友圈',
      403,
      {
        riskControlUntilAt: riskControlUntilAt.toISOString(),
      }
    );
  }

  private normalizeDate(value?: Date): Date | undefined {
    if (!value) {
      return undefined;
    }

    const parsed = value instanceof Date ? value : new Date(value);

    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }

  private filterUnseenPostNotificationItems(
    items: PostNotificationItem[],
    seenAt?: Date
  ): PostNotificationItem[] {
    const normalizedSeenAt = this.normalizeDate(seenAt);

    return items.filter(item => {
      if (item.isSeen === true) {
        return false;
      }

      if (!normalizedSeenAt) {
        return true;
      }

      const createdAt = this.normalizeDate(
        item.createdAt ? new Date(item.createdAt) : undefined
      );

      return Boolean(createdAt && createdAt > normalizedSeenAt);
    });
  }

  private getLatestPostNotificationCreatedAt(
    notifications: PostNotificationEntity[],
    legacyCommentNotifications: PostCommentNotificationEntity[]
  ): Date | undefined {
    let latestCreatedAt: Date | undefined;

    for (const notification of [
      ...notifications,
      ...legacyCommentNotifications,
    ]) {
      const createdAt = this.normalizeDate(notification.createdAt);

      if (createdAt && (!latestCreatedAt || createdAt > latestCreatedAt)) {
        latestCreatedAt = createdAt;
      }
    }

    return latestCreatedAt;
  }

  private isSameObjectId(
    left?: MongoObjectId | null,
    right?: MongoObjectId | null
  ): boolean {
    return Boolean(
      left &&
        right &&
        this.stringifyObjectId(left) === this.stringifyObjectId(right)
    );
  }

  private async findUserById(
    userId: MongoObjectId
  ): Promise<UserEntity | null> {
    const userById = await this.userModel.findOne({
      where: {
        id: userId,
      },
    });

    if (userById) {
      return userById;
    }

    return this.userModel.findOne({
      where: {
        _id: userId,
      } as never,
    });
  }

  private buildPostItem(
    post: PostEntity,
    user?: UserEntity | null,
    likeCount = 0,
    likedByMe = false,
    commentCount = 0,
    comments: PostCommentItem[] = []
  ): PostItem {
    const moderationStatus = this.normalizePostModerationStatus(
      post.moderationStatus
    );
    const images = Array.isArray(post.images)
      ? post.images
          .filter(image => typeof image === 'string')
          .map(image => this.postImageService.resolveForResponse(image))
          .filter(Boolean)
      : [];

    return {
      id: this.stringifyObjectId(post.id),
      userId: this.stringifyObjectId(post.userId),
      authorName: user?.name?.trim() || '天之灵用户',
      authorAvatar: this.postImageService.resolveForResponse(
        user?.avatar?.trim() || ''
      ),
      content: post.content?.trim() || '',
      images,
      imageThumbnails: images.map(image => {
        const resolver = this.postImageService.resolveFeedThumbnailForResponse;
        return typeof resolver === 'function'
          ? resolver.call(this.postImageService, image)
          : image;
      }),
      remindAgentIds: Array.isArray(post.remindAgentIds)
        ? post.remindAgentIds
            .filter(agentId => typeof agentId === 'string')
            .map(agentId => agentId.trim())
            .filter(Boolean)
        : [],
      moderationStatus,
      moderationReason: post.moderationReason?.trim() || '',
      isRiskControlled:
        moderationStatus === PostModerationStatus.riskControlled,
      likeCount,
      likedByMe,
      commentCount,
      comments,
      createdAt: post.createdAt?.toISOString?.() ?? '',
      updatedAt: post.updatedAt?.toISOString?.() ?? '',
    };
  }

  private async buildLikeSummary(
    posts: PostEntity[],
    currentUserId?: MongoObjectId | null
  ): Promise<PostLikeSummary> {
    const likeCountByPostId = new Map<string, number>();
    const likedPostIds = new Set<string>();
    const likeUserIdsByPostId = new Map<string, Set<string>>();

    if (posts.length === 0) {
      return {
        likeCountByPostId,
        likedPostIds,
      };
    }

    const postIds = posts.map(post => post.id);
    const currentUserIdText = currentUserId
      ? this.stringifyObjectId(currentUserId)
      : '';

    if (typeof this.likeModel.aggregate === 'function') {
      const rows = await this.likeModel
        .aggregate<{
          _id: MongoObjectId;
          userIds: MongoObjectId[];
        }>([
          {
            $match: {
              postId: { $in: postIds },
            },
          },
          {
            $group: {
              _id: '$postId',
              userIds: { $addToSet: '$userId' },
            },
          },
        ])
        .toArray();

      for (const row of rows) {
        const postId = this.stringifyObjectId(row._id);
        const userIds = Array.isArray(row.userIds) ? row.userIds : [];
        likeCountByPostId.set(postId, userIds.length);

        if (
          currentUserIdText &&
          userIds.some(id => this.stringifyObjectId(id) === currentUserIdText)
        ) {
          likedPostIds.add(postId);
        }
      }

      return {
        likeCountByPostId,
        likedPostIds,
      };
    }

    const likes = await this.likeModel.find({
      where: {
        postId: {
          $in: postIds,
        },
      } as never,
    });

    for (const like of likes) {
      const postId = this.stringifyObjectId(like.postId);
      const likeUserId = this.stringifyObjectId(like.userId);
      const likeUserIds = likeUserIdsByPostId.get(postId) ?? new Set<string>();
      likeUserIds.add(likeUserId);
      likeUserIdsByPostId.set(postId, likeUserIds);

      if (currentUserIdText && likeUserId === currentUserIdText) {
        likedPostIds.add(postId);
      }
    }

    for (const [postId, likeUserIds] of likeUserIdsByPostId.entries()) {
      likeCountByPostId.set(postId, likeUserIds.size);
    }

    return {
      likeCountByPostId,
      likedPostIds,
    };
  }

  private findLike(
    postId: MongoObjectId,
    userId: MongoObjectId
  ): Promise<PostLikeEntity | null> {
    return this.likeModel.findOne({
      where: {
        postId,
        userId,
      },
    });
  }

  private async listCommentItemsByPostId(
    postId: MongoObjectId,
    authorCache: Map<string, UserEntity | null>,
    agentCache: Map<string, AgentEntity | null>
  ): Promise<PostCommentItem[]> {
    const comments = await this.commentModel.find({
      where: {
        postId,
      },
      order: {
        createdAt: 'ASC',
      },
    });

    return this.buildCommentItems(comments, authorCache, agentCache);
  }

  private async listCommentItemsByPostIds(
    postIds: MongoObjectId[],
    authorCache: Map<string, UserEntity | null>,
    agentCache: Map<string, AgentEntity | null>
  ): Promise<Map<string, PostCommentItem[]>> {
    const result = new Map<string, PostCommentItem[]>();

    if (postIds.length === 0) {
      return result;
    }

    const comments = await this.commentModel.find({
      where: {
        postId: {
          $in: postIds,
        },
      } as never,
      order: {
        createdAt: 'ASC',
      },
    });
    const items = await this.buildCommentItems(
      comments,
      authorCache,
      agentCache
    );

    for (const item of items) {
      const postComments = result.get(item.postId) ?? [];
      postComments.push(item);
      result.set(item.postId, postComments);
    }

    return result;
  }

  private async listCommentPreviewSummariesByPostIds(
    postIds: MongoObjectId[],
    authorCache: Map<string, UserEntity | null>,
    agentCache: Map<string, AgentEntity | null>,
    previewLimit: number
  ): Promise<Map<string, PostCommentPreviewSummary>> {
    const result = new Map<string, PostCommentPreviewSummary>();

    if (postIds.length === 0) {
      return result;
    }

    if (typeof this.commentModel.aggregate !== 'function') {
      const comments = await this.commentModel.find({
        where: {
          postId: {
            $in: postIds,
          },
        } as never,
        order: {
          createdAt: 'ASC',
        },
      });
      const commentsByPostId = new Map<string, PostCommentEntity[]>();

      for (const comment of comments) {
        const postId = this.stringifyObjectId(comment.postId);
        const postComments = commentsByPostId.get(postId) ?? [];
        postComments.push(comment);
        commentsByPostId.set(postId, postComments);
      }

      for (const [postId, postComments] of commentsByPostId.entries()) {
        result.set(postId, {
          count: postComments.length,
          items: await this.buildCommentItems(
            postComments.slice(0, previewLimit),
            authorCache,
            agentCache
          ),
        });
      }

      return result;
    }

    const rows = await this.commentModel
      .aggregate<{
        _id: MongoObjectId;
        count: number;
        comments: Array<PostCommentEntity & { _id?: MongoObjectId }>;
      }>([
        {
          $match: {
            postId: { $in: postIds },
          },
        },
        {
          $sort: {
            createdAt: 1,
          },
        },
        {
          $group: {
            _id: '$postId',
            count: { $sum: 1 },
            comments: { $push: '$$ROOT' },
          },
        },
        {
          $project: {
            count: 1,
            comments: { $slice: ['$comments', previewLimit] },
          },
        },
      ])
      .toArray();

    for (const row of rows) {
      const comments = row.comments.map(raw => {
        const comment = Object.assign(new PostCommentEntity(), raw);
        comment.id = raw.id ?? raw._id ?? comment.id;
        return comment;
      });
      result.set(this.stringifyObjectId(row._id), {
        count: row.count,
        items: await this.buildCommentItems(comments, authorCache, agentCache),
      });
    }

    return result;
  }

  private async buildCommentItems(
    comments: PostCommentEntity[],
    authorCache: Map<string, UserEntity | null>,
    agentCache: Map<string, AgentEntity | null>
  ): Promise<PostCommentItem[]> {
    await Promise.all([
      this.primeUserCache(
        comments.reduce<MongoObjectId[]>((ids, comment) => {
          if (comment.userId) ids.push(comment.userId);
          if (comment.replyToUserId) ids.push(comment.replyToUserId);
          return ids;
        }, []),
        authorCache
      ),
      this.primeAgentCache(
        comments.reduce<MongoObjectId[]>((ids, comment) => {
          if (comment.agentId) ids.push(comment.agentId);
          if (comment.replyToAgentId) ids.push(comment.replyToAgentId);
          return ids;
        }, []),
        agentCache
      ),
    ]);
    const authorPromises = new Map<string, Promise<UserEntity | null>>();
    const agentPromises = new Map<string, Promise<AgentEntity | null>>();
    const loadUser = (id: MongoObjectId) => {
      const key = this.stringifyObjectId(id);

      if (authorCache.has(key)) {
        return Promise.resolve(authorCache.get(key) ?? null);
      }

      const existing = authorPromises.get(key);
      if (existing) {
        return existing;
      }

      const promise = this.findUserById(id).then(user => {
        authorCache.set(key, user);
        return user;
      });
      authorPromises.set(key, promise);
      return promise;
    };
    const loadAgent = (id: MongoObjectId) => {
      const key = this.stringifyObjectId(id);

      if (agentCache.has(key)) {
        return Promise.resolve(agentCache.get(key) ?? null);
      }

      const existing = agentPromises.get(key);
      if (existing) {
        return existing;
      }

      const promise = this.findAgentById(id).then(agent => {
        agentCache.set(key, agent);
        return agent;
      });
      agentPromises.set(key, promise);
      return promise;
    };

    return Promise.all(
      comments.map(async comment => {
        const user = comment.userId ? await loadUser(comment.userId) : null;

        const agent = comment.agentId ? await loadAgent(comment.agentId) : null;

        const replyToUser = comment.replyToUserId
          ? await loadUser(comment.replyToUserId)
          : null;

        const replyToAgent = comment.replyToAgentId
          ? await loadAgent(comment.replyToAgentId)
          : null;

        return this.buildCommentItem(
          comment,
          user,
          replyToUser,
          agent,
          replyToAgent
        );
      })
    );
  }

  private async primeUserCache(
    values: MongoObjectId[],
    cache: Map<string, UserEntity | null>
  ): Promise<void> {
    const ids = this.uniqueObjectIds(values).filter(
      id => !cache.has(this.stringifyObjectId(id))
    );

    if (ids.length === 0) {
      return;
    }

    if (typeof this.userModel.find === 'function') {
      const users = await this.userModel.find({
        where: {
          _id: { $in: ids },
        } as never,
      });

      for (const user of users) {
        cache.set(this.stringifyObjectId(user.id), user);
      }
    }

    await Promise.all(
      ids.map(async id => {
        const key = this.stringifyObjectId(id);
        if (!cache.has(key)) {
          cache.set(key, await this.findUserById(id));
        }
      })
    );
  }

  private async primeAgentCache(
    values: MongoObjectId[],
    cache: Map<string, AgentEntity | null>
  ): Promise<void> {
    const ids = this.uniqueObjectIds(values).filter(
      id => !cache.has(this.stringifyObjectId(id))
    );

    if (ids.length === 0) {
      return;
    }

    if (typeof this.agentModel.find === 'function') {
      const agents = await this.agentModel.find({
        where: {
          _id: { $in: ids },
        } as never,
      });

      for (const agent of agents) {
        cache.set(this.stringifyObjectId(agent.id), agent);
      }
    }

    await Promise.all(
      ids.map(async id => {
        const key = this.stringifyObjectId(id);
        if (!cache.has(key)) {
          cache.set(key, await this.findAgentById(id));
        }
      })
    );
  }

  private uniqueObjectIds(values: MongoObjectId[]): MongoObjectId[] {
    const ids = new Map<string, MongoObjectId>();

    for (const value of values) {
      ids.set(this.stringifyObjectId(value), value);
    }

    return [...ids.values()];
  }

  private buildCommentItem(
    comment: PostCommentEntity,
    user?: UserEntity | null,
    replyToUser?: UserEntity | null,
    agent?: AgentEntity | null,
    replyToAgent?: AgentEntity | null
  ): PostCommentItem {
    return {
      id: this.stringifyObjectId(comment.id),
      postId: this.stringifyObjectId(comment.postId),
      type:
        comment.type === PostCommentType.agent
          ? PostCommentType.agent
          : PostCommentType.user,
      userId: comment.userId ? this.stringifyObjectId(comment.userId) : '',
      agentId: comment.agentId ? this.stringifyObjectId(comment.agentId) : '',
      authorName: agent?.name?.trim() || user?.name?.trim() || '天之灵用户',
      authorAvatar: this.postImageService.resolveForResponse(
        agent?.avatar?.trim() || user?.avatar?.trim() || ''
      ),
      content: comment.content?.trim() || '',
      parentCommentId: comment.parentCommentId
        ? this.stringifyObjectId(comment.parentCommentId)
        : '',
      replyToUserId: comment.replyToUserId
        ? this.stringifyObjectId(comment.replyToUserId)
        : '',
      replyToAgentId: comment.replyToAgentId
        ? this.stringifyObjectId(comment.replyToAgentId)
        : '',
      replyToUserName:
        replyToAgent?.name?.trim() || replyToUser?.name?.trim() || '',
      createdAt: comment.createdAt?.toISOString?.() ?? '',
      updatedAt: comment.updatedAt?.toISOString?.() ?? '',
    };
  }

  private buildCommentNotificationItem(
    notification: PostCommentNotificationEntity
  ): PostCommentNotificationItem {
    return {
      id: this.stringifyObjectId(notification.id),
      postId: this.stringifyObjectId(notification.postId),
      commentId: this.stringifyObjectId(notification.commentId),
      type:
        notification.commentType === PostCommentType.agent
          ? PostCommentType.agent
          : PostCommentType.user,
      actorName: notification.actorName?.trim() || '新评论',
      actorAvatar: this.postImageService.resolveForResponse(
        notification.actorAvatar?.trim() || ''
      ),
      commentPreview: notification.commentPreview?.trim() || '',
      replyToUserName: notification.replyToUserName?.trim() || '',
      postThumbnail: notification.postThumbnail
        ? this.postImageService.resolveForResponse(
            notification.postThumbnail?.trim() || ''
          )
        : '',
      isRead: notification.isRead === true,
      createdAt: notification.createdAt?.toISOString?.() ?? '',
    };
  }

  private buildPostNotificationItem(
    notification: PostNotificationEntity,
    postContentPreview = ''
  ): PostNotificationItem {
    return {
      id: this.stringifyObjectId(notification.id),
      postId: this.stringifyObjectId(notification.postId),
      type:
        notification.type === PostNotificationType.like
          ? PostNotificationType.like
          : PostNotificationType.comment,
      commentId: notification.commentId
        ? this.stringifyObjectId(notification.commentId)
        : '',
      commentType:
        notification.commentType === PostCommentType.agent
          ? PostCommentType.agent
          : notification.commentType === PostCommentType.user
          ? PostCommentType.user
          : '',
      actorName:
        notification.actorName?.trim() ||
        (notification.type === PostNotificationType.like ? '新共鸣' : '新评论'),
      actorAvatar: this.postImageService.resolveForResponse(
        notification.actorAvatar?.trim() || ''
      ),
      contentPreview: notification.contentPreview?.trim() || '',
      replyToUserName: notification.replyToUserName?.trim() || '',
      postThumbnail: notification.postThumbnail
        ? this.postImageService.resolveForResponse(
            notification.postThumbnail?.trim() || ''
          )
        : '',
      postContentPreview,
      isSeen: notification.isSeen === true || notification.isRead === true,
      isRead: notification.isRead === true,
      createdAt: notification.createdAt?.toISOString?.() ?? '',
    };
  }

  private buildPostNotificationItemFromComment(
    notification: PostCommentNotificationEntity,
    postContentPreview = ''
  ): PostNotificationItem {
    return {
      id: this.stringifyObjectId(notification.id),
      postId: this.stringifyObjectId(notification.postId),
      type: PostNotificationType.comment,
      commentId: this.stringifyObjectId(notification.commentId),
      commentType:
        notification.commentType === PostCommentType.agent
          ? PostCommentType.agent
          : PostCommentType.user,
      actorName: notification.actorName?.trim() || '新评论',
      actorAvatar: this.postImageService.resolveForResponse(
        notification.actorAvatar?.trim() || ''
      ),
      contentPreview: notification.commentPreview?.trim() || '',
      replyToUserName: notification.replyToUserName?.trim() || '',
      postThumbnail: notification.postThumbnail
        ? this.postImageService.resolveForResponse(
            notification.postThumbnail?.trim() || ''
          )
        : '',
      postContentPreview,
      isSeen: notification.isSeen === true || notification.isRead === true,
      isRead: notification.isRead === true,
      createdAt: notification.createdAt?.toISOString?.() ?? '',
    };
  }

  private async filterAndPrunePostNotifications(
    notifications: PostNotificationEntity[],
    legacyCommentNotifications: PostCommentNotificationEntity[]
  ): Promise<{
    notifications: PostNotificationEntity[];
    legacyCommentNotifications: PostCommentNotificationEntity[];
    postContentPreviewById: Map<string, string>;
  }> {
    const postIds = Array.from(
      new Set(
        [
          ...notifications.map(notification => notification.postId),
          ...legacyCommentNotifications.map(
            notification => notification.postId
          ),
        ].map(postId => this.stringifyObjectId(postId))
      )
    );
    const validPostIds = new Set<string>();
    const postContentPreviewById = new Map<string, string>();
    const postObjectIds = postIds
      .map(postId => this.normalizeObjectId(postId))
      .filter((postId): postId is MongoObjectId => Boolean(postId));
    const posts =
      postObjectIds.length > 0
        ? await this.postModel.find({
            where: {
              _id: {
                $in: postObjectIds,
              },
            } as never,
          })
        : [];

    for (const post of posts) {
      const postId = this.stringifyObjectId(post.id);

      if (post.isDeleted !== true) {
        validPostIds.add(postId);
        postContentPreviewById.set(
          postId,
          this.buildPostContentPreview(post.content)
        );
      }
    }

    const validNotifications = notifications.filter(notification =>
      validPostIds.has(this.stringifyObjectId(notification.postId))
    );
    const validLegacyCommentNotifications = legacyCommentNotifications.filter(
      notification =>
        validPostIds.has(this.stringifyObjectId(notification.postId))
    );
    const deletedNotifications = notifications.filter(
      notification => !validNotifications.includes(notification)
    );
    const deletedLegacyCommentNotifications = legacyCommentNotifications.filter(
      notification => !validLegacyCommentNotifications.includes(notification)
    );

    await Promise.all([
      ...deletedNotifications.map(notification =>
        this.notificationModel.deleteOne({
          _id: notification.id,
        } as never)
      ),
      ...deletedLegacyCommentNotifications.map(notification =>
        this.commentNotificationModel.deleteOne({
          _id: notification.id,
        } as never)
      ),
    ]);

    return {
      notifications: validNotifications,
      legacyCommentNotifications: validLegacyCommentNotifications,
      postContentPreviewById,
    };
  }

  private async deleteNotificationsByPostId(
    postId: MongoObjectId
  ): Promise<void> {
    const [notifications, legacyCommentNotifications] = await Promise.all([
      this.notificationModel.find({
        where: {
          postId,
        },
      }),
      this.commentNotificationModel.find({
        where: {
          postId,
        },
      }),
    ]);

    await Promise.all([
      ...notifications.map(notification =>
        this.notificationModel.deleteOne({
          _id: notification.id,
        } as never)
      ),
      ...legacyCommentNotifications.map(notification =>
        this.commentNotificationModel.deleteOne({
          _id: notification.id,
        } as never)
      ),
    ]);
  }

  private mergePostNotificationItems(
    notifications: PostNotificationEntity[],
    legacyCommentNotifications: PostCommentNotificationEntity[],
    postContentPreviewById = new Map<string, string>()
  ): PostNotificationItem[] {
    const items = notifications.map(notification => {
      const postId = this.stringifyObjectId(notification.postId);

      return this.buildPostNotificationItem(
        notification,
        postContentPreviewById.get(postId) ?? ''
      );
    });
    const knownCommentIds = new Set(
      items
        .filter(item => item.type === PostNotificationType.comment)
        .map(item => item.commentId)
        .filter(Boolean)
    );

    for (const notification of legacyCommentNotifications) {
      const commentId = this.stringifyObjectId(notification.commentId);

      if (knownCommentIds.has(commentId)) {
        continue;
      }

      items.push(
        this.buildPostNotificationItemFromComment(
          notification,
          postContentPreviewById.get(
            this.stringifyObjectId(notification.postId)
          ) ?? ''
        )
      );
    }

    return items.sort((left, right) => {
      const leftTime = Date.parse(left.createdAt);
      const rightTime = Date.parse(right.createdAt);

      return (
        (Number.isFinite(rightTime) ? rightTime : 0) -
        (Number.isFinite(leftTime) ? leftTime : 0)
      );
    });
  }

  private buildPostContentPreview(content?: string): string {
    return (content || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  }

  private async createCommentNotification(
    post: PostEntity,
    comment: PostCommentEntity,
    user?: UserEntity | null,
    agent?: AgentEntity | null
  ): Promise<void> {
    const ownerId = this.stringifyObjectId(post.userId);
    const actorUserId = comment.userId
      ? this.stringifyObjectId(comment.userId)
      : '';

    if (comment.type === PostCommentType.user && actorUserId === ownerId) {
      return;
    }

    const notification = new PostCommentNotificationEntity();
    notification.userId = post.userId;
    notification.postId = post.id;
    notification.commentId = comment.id;
    notification.commentType = comment.type;
    notification.actorUserId = comment.userId;
    notification.actorAgentId = comment.agentId;
    notification.actorName =
      agent?.name?.trim() || user?.name?.trim() || '新评论';
    notification.actorAvatar =
      agent?.avatar?.trim() || user?.avatar?.trim() || '';
    notification.commentPreview = (comment.content?.trim() || '').slice(0, 120);
    notification.replyToUserName = await this.resolveCommentReplyName(comment);
    notification.postThumbnail =
      Array.isArray(post.images) && post.images.length > 0
        ? post.images.find(image => typeof image === 'string' && image.trim())
        : '';
    notification.isSeen = false;
    notification.isRead = false;
    notification.createdAt = comment.createdAt ?? new Date();
    notification.updatedAt = comment.updatedAt ?? notification.createdAt;

    await this.commentNotificationModel.save(notification);

    try {
      await this.createPostCommentNotification(post, comment, notification);
    } catch (error) {
      await this.deleteNotificationsByCommentId(comment.id).catch(
        cleanupError => {
          this.logger.warn(
            '[post-comment-notification] failed to roll back partial notifications, commentId=%s, error=%s',
            this.stringifyObjectId(comment.id),
            String(cleanupError)
          );
        }
      );
      throw error;
    }
  }

  private async createPostCommentNotification(
    post: PostEntity,
    comment: PostCommentEntity,
    commentNotification: PostCommentNotificationEntity
  ): Promise<void> {
    const notification = new PostNotificationEntity();
    notification.userId = post.userId;
    notification.postId = post.id;
    notification.type = PostNotificationType.comment;
    notification.commentId = comment.id;
    notification.commentType = comment.type;
    notification.actorUserId = comment.userId;
    notification.actorAgentId = comment.agentId;
    notification.actorName = commentNotification.actorName;
    notification.actorAvatar = commentNotification.actorAvatar;
    notification.contentPreview = commentNotification.commentPreview;
    notification.replyToUserName = commentNotification.replyToUserName;
    notification.postThumbnail = commentNotification.postThumbnail;
    notification.isSeen = false;
    notification.isRead = false;
    notification.createdAt = comment.createdAt ?? new Date();
    notification.updatedAt = notification.createdAt;

    await this.notificationModel.save(notification);
  }

  private async createLikeNotification(
    post: PostEntity,
    userId: MongoObjectId,
    user?: UserEntity | null
  ): Promise<void> {
    if (
      this.stringifyObjectId(userId) === this.stringifyObjectId(post.userId)
    ) {
      return;
    }

    const now = new Date();
    const notification = new PostNotificationEntity();
    notification.userId = post.userId;
    notification.postId = post.id;
    notification.type = PostNotificationType.like;
    notification.actorUserId = userId;
    notification.actorName = user?.name?.trim() || '新共鸣';
    notification.actorAvatar = user?.avatar?.trim() || '';
    notification.contentPreview = '与你的动态产生了共鸣';
    notification.postThumbnail =
      Array.isArray(post.images) && post.images.length > 0
        ? post.images.find(image => typeof image === 'string' && image.trim())
        : '';
    notification.isSeen = false;
    notification.isRead = false;
    notification.createdAt = now;
    notification.updatedAt = now;

    try {
      await this.notificationModel.save(notification);
    } catch (error) {
      const duplicateCode = (error as { code?: number } | undefined)?.code;

      if (duplicateCode !== 11000) {
        throw error;
      }
    }
  }

  private async deleteLikeNotification(
    postId: MongoObjectId,
    userId: MongoObjectId
  ): Promise<void> {
    await this.notificationModel.deleteOne({
      postId,
      actorUserId: userId,
      type: PostNotificationType.like,
    } as never);
  }

  private async deleteNotificationsByCommentId(
    commentId: MongoObjectId
  ): Promise<void> {
    await Promise.all([
      this.notificationModel.deleteOne({
        commentId,
        type: PostNotificationType.comment,
      } as never),
      this.commentNotificationModel.deleteOne({
        commentId,
      } as never),
    ]);
  }

  private async rollbackCreatedComment(
    comment: PostCommentEntity
  ): Promise<void> {
    const commentId = this.stringifyObjectId(comment.id);

    await this.deleteNotificationsByCommentId(comment.id).catch(error => {
      this.logger.warn(
        '[post-comment] failed to roll back notifications, commentId=%s, error=%s',
        commentId,
        String(error)
      );
    });
    await this.commentModel
      .deleteOne({
        _id: comment.id,
      } as never)
      .catch(error => {
        this.logger.warn(
          '[post-comment] failed to roll back comment, commentId=%s, error=%s',
          commentId,
          String(error)
        );
      });
  }

  private async resolveCommentReplyName(
    comment: PostCommentEntity
  ): Promise<string> {
    if (comment.replyToAgentId) {
      const agent = await this.findAgentById(comment.replyToAgentId);
      return agent?.name?.trim() || '';
    }

    if (comment.replyToUserId) {
      const user = await this.findUserById(comment.replyToUserId);
      return user?.name?.trim() || '';
    }

    return '';
  }

  private async findReplyTarget(
    postId: MongoObjectId,
    replyToCommentId?: string
  ): Promise<PostCommentEntity | null> {
    const trimmedId = replyToCommentId?.trim();

    if (!trimmedId) {
      return null;
    }

    const objectId = this.parseObjectId(trimmedId);
    const commentById = await this.commentModel.findOne({
      where: {
        id: objectId,
      },
    });
    const replyTarget = commentById
      ? commentById
      : await this.commentModel.findOne({
          where: {
            _id: objectId,
          } as never,
        });

    if (
      !replyTarget ||
      this.stringifyObjectId(replyTarget.postId) !==
        this.stringifyObjectId(postId)
    ) {
      throw new AppError('COMMENT_NOT_FOUND', 'comment not found', 404);
    }

    return replyTarget;
  }

  private async findCommentById(
    postId: MongoObjectId,
    commentId: MongoObjectId | string
  ): Promise<PostCommentEntity | null> {
    const objectId = this.normalizeObjectId(commentId);

    if (!objectId) {
      return null;
    }

    const commentById = await this.commentModel.findOne({
      where: {
        id: objectId,
      },
    });
    const comment =
      commentById ??
      (await this.commentModel.findOne({
        where: {
          _id: objectId,
        } as never,
      }));

    if (
      !comment ||
      this.stringifyObjectId(comment.postId) !== this.stringifyObjectId(postId)
    ) {
      return null;
    }

    return comment;
  }

  private isAgentCommentReplyTrigger(
    comment: PostCommentEntity,
    agent: AgentEntity,
    repliedComment?: PostCommentEntity | null
  ): boolean {
    return (
      comment.type === PostCommentType.user &&
      Boolean(comment.userId) &&
      Boolean(comment.replyToAgentId) &&
      this.stringifyObjectId(comment.replyToAgentId!) ===
        this.stringifyObjectId(agent.id) &&
      this.isCommentAuthoredByAgent(repliedComment, agent.id)
    );
  }

  private isCommentAuthoredByAgent(
    comment: PostCommentEntity | null | undefined,
    agentId: MongoObjectId
  ): boolean {
    if (!comment?.agentId) {
      return false;
    }

    return (
      this.stringifyObjectId(comment.agentId) ===
      this.stringifyObjectId(agentId)
    );
  }

  private async isUserVip(userId: MongoObjectId, now: Date): Promise<boolean> {
    const memberships = await this.userMembershipModel.find({
      where: {
        userId,
        status: UserMembershipStatus.active,
      },
      order: {
        updatedAt: 'DESC',
      },
    });

    return memberships.some(
      membership =>
        membership.lifetime ||
        Boolean(membership.expiredAt && membership.expiredAt > now)
    );
  }

  private async shouldAutoReplyToPost(
    post: PostEntity,
    now: Date
  ): Promise<boolean> {
    if (await this.isUserVip(post.userId, now)) {
      return true;
    }

    const dayStart = this.getBeijingDayStart(now);
    const todayPostCount = await this.postModel.count({
      userId: post.userId,
      isDeleted: { $ne: true },
      createdAt: { $gte: dayStart, $lte: post.createdAt },
    } as never);

    return todayPostCount <= POST_AUTO_REPLY_DAILY_LIMIT.nonVipLimit;
  }

  private getBeijingDayStart(value: Date): Date {
    const offsetMs = 8 * 60 * 60 * 1000;
    const shifted = new Date(value.getTime() + offsetMs);

    return new Date(
      Date.UTC(
        shifted.getUTCFullYear(),
        shifted.getUTCMonth(),
        shifted.getUTCDate()
      ) - offsetMs
    );
  }

  private normalizeContent(rawContent?: string): string {
    const content = rawContent?.trim() ?? '';

    if (content.length > 2000) {
      throw new AppError(
        'INVALID_POST_CONTENT',
        'post content must be 2000 characters or fewer',
        400
      );
    }

    return content;
  }

  private normalizeCommentContent(rawContent?: string): string {
    const content = rawContent?.trim() ?? '';

    if (!content) {
      throw new AppError(
        'INVALID_COMMENT_CONTENT',
        'comment content is required',
        400
      );
    }

    if (content.length > 500) {
      throw new AppError(
        'INVALID_COMMENT_CONTENT',
        'comment content must be 500 characters or fewer',
        400
      );
    }

    return content;
  }

  private async checkCommentContentSafety(
    auth: AuthenticatedUserPayload,
    content: string
  ): Promise<void> {
    const openid = await this.resolveCurrentWeappOpenid(auth);

    if (!openid) {
      return;
    }

    const result = await this.wechatPayService.checkMessageContentSafety({
      openid,
      content,
      scene: 2,
    });

    if (result.isSafe) {
      return;
    }

    this.logger.warn(
      '[post-comment-content-safety] rejected unsafe comment, userId=%s, suggest=%s, label=%s',
      auth.sub,
      result.suggest || '-',
      result.label ?? '-'
    );

    throw new AppError(
      'POST_COMMENT_CONTENT_UNSAFE',
      '发布内容含违规信息，请修改后再试',
      400
    );
  }

  private async resolveCurrentWeappOpenid(
    auth: AuthenticatedUserPayload
  ): Promise<string> {
    const accountId = auth?.accountId?.trim();

    if (!accountId) {
      throw new AppError('INVALID_TOKEN', 'token account is invalid', 401);
    }

    const objectId = this.parseObjectId(accountId);
    const accountById = await this.userAccountModel.findOne({
      where: {
        id: objectId,
      },
    });
    const account =
      accountById ??
      (await this.userAccountModel.findOne({
        where: {
          _id: objectId,
        } as never,
      }));

    if (!account) {
      throw new AppError('INVALID_TOKEN', 'token account is invalid', 401);
    }

    const openid =
      account.openId?.trim() ||
      this.resolveLegacyWeappOpenid(account.account) ||
      this.resolveLegacyWeappOpenid(auth.account) ||
      (await this.findRecoverableWeappOpenid(account.userId));

    if (openid) {
      return openid;
    }

    if (
      !this.isWeappAccount(account.account) &&
      !this.isWeappAccount(auth.account)
    ) {
      return '';
    }

    throw new AppError(
      'POST_COMMENT_SECURITY_UNAVAILABLE',
      'comment content security check is unavailable',
      503
    );
  }

  private async findRecoverableWeappOpenid(
    userId?: MongoObjectId
  ): Promise<string> {
    if (!userId) {
      return '';
    }

    const accounts = await this.userAccountModel.find({
      where: {
        userId,
      },
    });

    for (const account of accounts) {
      const openid =
        account.openId?.trim() ||
        this.resolveLegacyWeappOpenid(account.account);

      if (openid) {
        return openid;
      }
    }

    return '';
  }

  private resolveLegacyWeappOpenid(rawAccount?: string): string {
    const account = rawAccount?.trim() || '';

    if (!this.isWeappAccount(account)) {
      return '';
    }

    const legacyOpenid = account.slice(WEAPP_ACCOUNT_PREFIX.length).trim();

    return legacyOpenid && !WEAPP_ACCOUNT_HASH_PATTERN.test(legacyOpenid)
      ? legacyOpenid
      : '';
  }

  private isWeappAccount(rawAccount?: string): boolean {
    return (rawAccount?.trim() || '').startsWith(WEAPP_ACCOUNT_PREFIX);
  }

  private normalizeImages(rawImages?: string[]): string[] {
    if (!Array.isArray(rawImages)) {
      return [];
    }

    const images = rawImages
      .map(image => (typeof image === 'string' ? image.trim() : ''))
      .filter(Boolean);

    if (images.length > 9) {
      throw new AppError(
        'INVALID_POST_IMAGES',
        'post images must be 9 items or fewer',
        400
      );
    }

    for (const image of images) {
      if (image.length > 1000) {
        throw new AppError(
          'INVALID_POST_IMAGE',
          'post image reference is too long',
          400
        );
      }
    }

    return images.map(image =>
      this.postImageService.normalizeForStorage(image)
    );
  }

  private normalizePositiveInteger(
    value: number | string | undefined,
    fallback: number,
    max?: number
  ): number {
    const parsed =
      typeof value === 'number'
        ? value
        : typeof value === 'string'
        ? Number.parseInt(value, 10)
        : NaN;
    const normalized =
      Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;

    return typeof max === 'number' ? Math.min(normalized, max) : normalized;
  }

  private normalizeBoolean(value: boolean | string | undefined): boolean {
    if (typeof value === 'boolean') {
      return value;
    }

    if (typeof value !== 'string') {
      return false;
    }

    return ['1', 'true', 'yes'].includes(value.trim().toLowerCase());
  }

  private normalizeOptionalBoolean(
    value: boolean | string | undefined
  ): boolean | undefined {
    if (value === undefined) {
      return undefined;
    }

    if (typeof value === 'boolean') {
      return value;
    }

    const normalizedValue = value.trim().toLowerCase();

    if (['1', 'true', 'yes'].includes(normalizedValue)) {
      return true;
    }

    if (['0', 'false', 'no'].includes(normalizedValue)) {
      return false;
    }

    return undefined;
  }

  private async normalizeRemindAgentIds(
    ownerUserId: MongoObjectId,
    rawAgentIds?: string[]
  ): Promise<string[]> {
    const remindAgentIds = Array.from(
      new Set(
        (Array.isArray(rawAgentIds) ? rawAgentIds : [])
          .map(agentId => (typeof agentId === 'string' ? agentId.trim() : ''))
          .filter(Boolean)
      )
    );

    if (remindAgentIds.length === 0) {
      return this.resolveDefaultRemindAgentIds(ownerUserId);
    }

    if (remindAgentIds.length > 50) {
      throw new AppError(
        'INVALID_POST_REMIND_TARGETS',
        'remind targets must be 50 items or fewer',
        400
      );
    }

    for (const agentId of remindAgentIds) {
      if (agentId.length > 64) {
        throw new AppError(
          'INVALID_POST_REMIND_TARGET',
          'remind target is invalid',
          400
        );
      }
    }

    const validAgentIds: string[] = [];
    const ownerId = this.stringifyObjectId(ownerUserId);

    for (const agentId of remindAgentIds) {
      const agent = await this.findAgentById(agentId);
      if (!agent) {
        continue;
      }

      if (this.stringifyObjectId(agent.createdUserId) !== ownerId) {
        continue;
      }

      validAgentIds.push(this.stringifyObjectId(agent.id));
    }

    return validAgentIds;
  }

  private async resolveDefaultRemindAgentIds(
    ownerUserId: MongoObjectId
  ): Promise<string[]> {
    const defaultAgent = await this.agentModel.findOne({
      where: {
        createdUserId: ownerUserId,
        isDefault: true,
      },
    });

    if (defaultAgent) {
      return [this.stringifyObjectId(defaultAgent.id)];
    }

    const agents = await this.agentModel.find({
      where: {
        createdUserId: ownerUserId,
      },
      order: {
        updatedAt: 'DESC',
      },
      take: 1,
    });
    const fallbackAgent = agents[0];

    return fallbackAgent ? [this.stringifyObjectId(fallbackAgent.id)] : [];
  }

  private async enqueueRemindReplyJobs(post: PostEntity): Promise<void> {
    if (
      !Array.isArray(post.remindAgentIds) ||
      post.remindAgentIds.length === 0
    ) {
      return;
    }

    const queue = this.bullmqFramework.getQueue(POST_REMIND_REPLY_QUEUE);
    if (!queue) {
      this.logger.warn(
        '[post-remind-reply] queue not found, skip enqueue, postId=%s',
        this.stringifyObjectId(post.id)
      );
      return;
    }

    for (let index = 0; index < post.remindAgentIds.length; index++) {
      const agentId = post.remindAgentIds[index]?.trim();
      if (!agentId) {
        continue;
      }

      await queue.addJobToQueue(
        {
          postId: this.stringifyObjectId(post.id),
          agentId,
        },
        {
          jobId: `post:${this.stringifyObjectId(post.id)}:agent:${agentId}`,
          delay: 3000 + index * 2000,
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 2000,
          },
        }
      );
    }
  }

  private async enqueueAgentCommentReplyJob(
    post: PostEntity,
    comment: PostCommentEntity,
    replyToComment?: PostCommentEntity | null
  ): Promise<void> {
    if (
      comment.type !== PostCommentType.user ||
      !comment.replyToAgentId ||
      !this.isCommentAuthoredByAgent(replyToComment, comment.replyToAgentId)
    ) {
      return;
    }

    if (!(await this.isUserVip(post.userId, new Date()))) {
      return;
    }

    const queue = this.bullmqFramework.getQueue(POST_COMMENT_AGENT_REPLY_QUEUE);
    if (!queue) {
      this.logger.warn(
        '[post-remind-reply] queue not found, skip enqueue comment reply, postId=%s, commentId=%s',
        this.stringifyObjectId(post.id),
        this.stringifyObjectId(comment.id)
      );
      return;
    }

    const postId = this.stringifyObjectId(post.id);
    const agentId = this.stringifyObjectId(comment.replyToAgentId);
    const triggerCommentId = this.stringifyObjectId(comment.id);

    await queue.addJobToQueue(
      {
        postId,
        agentId,
        triggerCommentId,
      },
      {
        jobId: `post:${postId}:agent:${agentId}:comment:${triggerCommentId}`,
        delay: 3000,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
      }
    );
  }

  private async generateAgentPostReply(
    post: PostEntity,
    user: UserEntity,
    agent: AgentEntity,
    triggerCommentId?: MongoObjectId
  ): Promise<string> {
    const existingComments = await this.commentModel.find({
      where: {
        postId: post.id,
      },
      order: {
        createdAt: 'ASC',
      },
    });
    const momentImages = await this.buildMomentImageContext(post);
    const commentContext = this.buildMomentCommentContext(existingComments);
    const latestUserComment =
      (triggerCommentId
        ? commentContext.find(
            comment => comment.id === this.stringifyObjectId(triggerCommentId)
          )
        : null) ??
      [...commentContext]
        .reverse()
        .find(comment => comment.type === PostCommentType.user);
    const isFollowUpReply = Boolean(triggerCommentId && latestUserComment);
    const systemPrompt = buildMomentsSystemPrompt({
      userId: this.stringifyObjectId(post.userId),
      agentId: this.stringifyObjectId(agent.id),
      agent,
      context: {
        moment: {
          id: this.stringifyObjectId(post.id),
          userId: this.stringifyObjectId(post.userId),
          authorName: user.name?.trim() || '天之灵用户',
          content: post.content?.trim() || '',
          images: momentImages,
          createdAt: post.createdAt?.toISOString?.() ?? '',
        },
        comments: commentContext,
        latestUserComment: latestUserComment ?? null,
        userRepliedComment: latestUserComment?.repliedComment
          ? commentContext.find(
              comment => comment.id === latestUserComment.repliedComment?.id
            ) ?? null
          : null,
        task: isFollowUpReply
          ? '请直接回复 context.latestUserComment。context.userRepliedComment 是上一句；先回答问题或承认纠正，不要转回动态正文。'
          : '请基于这条动态内容发表一条自然简短、不要重复现有评论的评论；正文有明确问题时必须直接回答。',
      },
    });
    const result = await this.openAIService.generateText({
      systemPrompt,
      prompt: isFollowUpReply
        ? '请直接输出对当前用户评论的楼中楼回复正文。'
        : '请直接输出一条动态评论正文。',
      model: this.openAIService.getDefaultModel(),
      temperature: isFollowUpReply ? 0.45 : 1.05,
      topP: isFollowUpReply ? 0.85 : 0.95,
      presencePenalty: isFollowUpReply ? 0.1 : 0.6,
      frequencyPenalty: isFollowUpReply ? 0.1 : 0.35,
      maxTokens: 120,
      reasoningSplit: false,
    });

    const reply = this.normalizeGeneratedPostReply(result);
    const selected = this.selectMomentReply(
      post,
      agent,
      reply,
      existingComments,
      latestUserComment
    );
    return (
      selected || this.buildFallbackMomentReply(post, agent, latestUserComment)
    );
  }

  private normalizeGeneratedPostReply(result: {
    content?: string;
    response?: ChatCompletion;
  }): string {
    const primary =
      typeof result?.content === 'string' ? result.content.trim() : '';
    const parsed = this.extractReplyText(primary);
    if (parsed) {
      return parsed;
    }

    const fallback =
      typeof result?.response?.choices?.[0]?.message?.content === 'string'
        ? result.response.choices[0].message.content
        : '';
    return this.extractReplyText(fallback);
  }

  private extractReplyText(value?: string): string {
    const raw = this.stripReasoningArtifacts(value).trim();
    if (!raw) {
      return '';
    }

    try {
      const parsed = JSON.parse(raw) as { segments?: unknown };
      if (Array.isArray(parsed?.segments) && parsed.segments.length > 0) {
        const first =
          typeof parsed.segments[0] === 'string' ? parsed.segments[0] : '';
        const cleaned = this.cleanReplyText(first);
        if (cleaned) {
          return cleaned;
        }
      }
    } catch {
      // ignore malformed JSON and continue with plain text normalization
    }

    return this.cleanReplyText(raw);
  }

  private cleanReplyText(value: string): string {
    const cleaned = this.stripReasoningArtifacts(value)
      .replace(/```(?:json)?/gi, ' ')
      .replace(/```/g, ' ')
      .replace(/<\/fenge>/gi, ' ')
      .replace(/^\s*[-#*\d.]+\s*/g, '')
      .replace(/[“”"]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (!cleaned) {
      return '';
    }

    return cleaned.length > 120 ? cleaned.slice(0, 120).trim() : cleaned;
  }

  private stripReasoningArtifacts(value?: string): string {
    if (!value) {
      return '';
    }

    return value
      .replace(/<think[\s\S]*?<\/think>/gi, ' ')
      .replace(/<\/?think>/gi, ' ')
      .replace(/^\s*think\s*[:：]/gim, '')
      .replace(/^\s*reasoning\s*[:：]/gim, '')
      .trim();
  }

  private async buildMomentImageContext(
    post: PostEntity
  ): Promise<MomentImageContext[]> {
    const images = Array.isArray(post.images)
      ? post.images
          .map(image => (typeof image === 'string' ? image.trim() : ''))
          .filter(Boolean)
      : [];

    if (images.length === 0) {
      return [];
    }

    const descriptions = await Promise.all(
      images.map((image, index) =>
        this.describePostImage(image, index).catch(() => '')
      )
    );

    return images.map((image, index) => ({
      index: index + 1,
      url: this.postImageService.resolveForResponse(image).trim(),
      description: descriptions[index]?.trim() || '',
    }));
  }

  private async describePostImage(
    image: string,
    index: number
  ): Promise<string> {
    const imageUrl = this.postImageService.resolveForResponse(image).trim();

    if (!/^https?:\/\//i.test(imageUrl)) {
      this.logger.warn(
        '[post-remind-reply] skip image analysis due to invalid image url, postImageIndex=%s',
        index
      );
      return '';
    }

    try {
      const response = await this.openAIService.createVisionChatCompletion({
        model: this.openAIService.getVisionModel(),
        temperature: 0.2,
        topP: 0.8,
        reasoningSplit: false,
        messages: [
          {
            role: 'system',
            content:
              '你是一个朋友圈图片浅层理解助手。只描述图片中肉眼可见的主体、场景、动作、画面氛围和可见文字。照片里的人不一定是发布用户本人，也不一定和发布者有关系；不要推断或猜测人物身份、姓名、职业、年龄、亲属关系、朋友关系，以及图片人物与发布者、评论者、智能体之间的任何关系。不要把图片中的地点、人物或动物扩写成“某人现在在哪里、正在和谁做什么”的事实；不要根据画面脑补故事、情感、当前生活或逝去后的状态。只输出可用于自然评论的中性图片摘要，控制在80字内。',
          },
          {
            role: 'user',
            content: [
              {
                type: 'image_url',
                image_url: {
                  url: imageUrl,
                },
              },
              {
                type: 'text',
                text: '请理解这张朋友圈图片，并给出可用于自然评论的简洁描述。',
              },
            ],
          } as unknown as ChatCompletionMessageParam,
        ],
      });

      return typeof response.choices?.[0]?.message?.content === 'string'
        ? response.choices[0].message.content.trim()
        : '';
    } catch (error) {
      this.logger.warn(
        '[post-remind-reply] image analysis failed, postImageIndex=%s, url=%s, reason=%s',
        index,
        imageUrl,
        error instanceof Error ? error.message : String(error)
      );
      return '';
    }
  }

  private buildMomentCommentContext(
    comments: PostCommentEntity[]
  ): MomentCommentContext[] {
    if (!Array.isArray(comments) || comments.length === 0) {
      return [];
    }

    const latestComments = comments.slice(-20);
    const commentById = new Map(
      latestComments.map(comment => [
        this.stringifyObjectId(comment.id),
        comment,
      ])
    );

    return latestComments.map(comment => {
      const parentCommentId = comment.parentCommentId
        ? this.stringifyObjectId(comment.parentCommentId)
        : null;
      const repliedComment = parentCommentId
        ? commentById.get(parentCommentId) ?? null
        : null;

      return this.buildMomentCommentContextItem(comment, repliedComment);
    });
  }

  private buildMomentCommentContextItem(
    comment: PostCommentEntity,
    repliedComment?: PostCommentEntity | null
  ): MomentCommentContext {
    const type =
      comment.type === PostCommentType.agent || comment.agentId
        ? PostCommentType.agent
        : PostCommentType.user;
    const authorId = comment.agentId
      ? this.stringifyObjectId(comment.agentId)
      : comment.userId
      ? this.stringifyObjectId(comment.userId)
      : '';
    const repliedType = repliedComment
      ? repliedComment.type === PostCommentType.agent || repliedComment.agentId
        ? PostCommentType.agent
        : PostCommentType.user
      : null;

    return {
      id: this.stringifyObjectId(comment.id),
      type,
      authorId,
      authorName: this.resolveMomentCommentAuthorName(comment),
      content: comment.content?.trim() || '',
      parentCommentId: comment.parentCommentId
        ? this.stringifyObjectId(comment.parentCommentId)
        : null,
      replyToId: comment.replyToAgentId
        ? this.stringifyObjectId(comment.replyToAgentId)
        : comment.replyToUserId
        ? this.stringifyObjectId(comment.replyToUserId)
        : null,
      replyToName: null,
      repliedComment: repliedComment
        ? {
            id: this.stringifyObjectId(repliedComment.id),
            type: repliedType ?? PostCommentType.user,
            authorName: this.resolveMomentCommentAuthorName(repliedComment),
            content: repliedComment.content?.trim() || '',
          }
        : null,
      createdAt: comment.createdAt?.toISOString?.() ?? '',
    };
  }

  private resolveMomentCommentAuthorName(comment: PostCommentEntity): string {
    if (comment.agentId) {
      return `agent:${this.stringifyObjectId(comment.agentId)}`;
    }

    if (comment.userId) {
      return `user:${this.stringifyObjectId(comment.userId)}`;
    }

    return 'unknown';
  }

  private selectMomentReply(
    post: PostEntity,
    agent: AgentEntity,
    reply: string,
    existingComments: PostCommentEntity[],
    latestUserComment?: MomentCommentContext | null
  ): string {
    const cleaned = reply.trim();
    if (!cleaned) {
      return '';
    }

    if (
      this.isUnsafeOrUnresponsiveMomentReply(
        post,
        cleaned,
        existingComments,
        latestUserComment
      )
    ) {
      return this.buildFallbackMomentReply(post, agent, latestUserComment);
    }

    if (this.isGenericMomentReply(cleaned)) {
      return this.buildFallbackMomentReply(post, agent, latestUserComment);
    }

    if (this.isDuplicateMomentReply(cleaned, existingComments)) {
      return this.buildFallbackMomentReply(post, agent, latestUserComment);
    }

    return cleaned;
  }

  private isUnsafeOrUnresponsiveMomentReply(
    post: PostEntity,
    reply: string,
    existingComments: PostCommentEntity[],
    latestUserComment?: MomentCommentContext | null
  ): boolean {
    const currentUserText =
      latestUserComment?.content?.trim() || post.content?.trim() || '';
    const repliedAgentText =
      latestUserComment?.repliedComment?.type === PostCommentType.agent
        ? latestUserComment.repliedComment.content?.trim() || ''
        : '';
    const userFactText = [
      post.content?.trim() || '',
      ...existingComments
        .filter(comment => comment.type === PostCommentType.user)
        .map(comment => comment.content?.trim() || ''),
    ].join('\n');

    if (
      /(?:明天|一会儿|待会儿).{0,8}(?:上班|工作)|(?:还要|得|要去).{0,4}(?:上班|工作)/.test(
        reply
      ) &&
      !/(?:明天|一会儿|待会儿).{0,8}(?:上班|工作)|(?:还要|得|要去).{0,4}(?:上班|工作)/.test(
        userFactText
      )
    ) {
      return true;
    }

    if (
      /(?:老|总|经常|又).{0,5}(?:熬夜|不睡|睡得晚)|(?:不能|不要|别).{0,5}熬夜|对身体不好/.test(
        reply
      ) &&
      !/(?:老|总|经常|又).{0,5}(?:熬夜|不睡|睡得晚)|(?:睡不着|失眠|熬夜)/.test(
        currentUserText
      )
    ) {
      return true;
    }

    if (
      /还不睡|怎么还没睡|这么晚了还不睡/.test(reply) &&
      !/(?:还没睡|没睡|不睡|睡不着|失眠|熬夜)/.test(currentUserText)
    ) {
      return true;
    }

    if (
      /(?:我|爸|爸爸|妈|妈妈|爷爷|奶奶|外公|外婆|老公|老婆)(?:(?:现在|一直|就|还|也)\s*){0,3}(?:在|住在|待在|留在)(?:那边|这边|天堂|天上|彼岸|另一个世界|你身边|你旁边)|(?:我|爸|爸爸|妈|妈妈).{0,8}(?:在天上)?(?:看着你|看见你|都看在眼里)/.test(
        reply
      )
    ) {
      return true;
    }

    if (
      this.isMomentCurrentActivityQuestion(currentUserText) &&
      !/(?:没忙|没干|正回|在回|歇着|休息|我挺好|我们都还好|正(?:在)?(?:和|跟)你说话)/.test(
        reply
      )
    ) {
      return true;
    }

    if (
      this.isMomentCurrentTimeQuestion(currentUserText) &&
      !/(?:现在|已经).{0,8}(?:\d{1,2}|[零一二两三四五六七八九十]+)(?:点|[:：])/.test(
        reply
      )
    ) {
      return true;
    }

    if (
      this.isMomentContextCorrection(currentUserText, repliedAgentText) &&
      (/(?:那也|但是|不过|还是|不能)/.test(reply) ||
        !/(?:说错|记错|不该|乱猜|知道了|明白了|哦|嗯)/.test(reply))
    ) {
      return true;
    }

    return false;
  }

  private isDuplicateMomentReply(
    reply: string,
    comments: PostCommentEntity[]
  ): boolean {
    const normalizedReply = this.normalizeCommentComparisonText(reply);
    if (!normalizedReply) {
      return true;
    }

    return comments.some(comment => {
      const content = comment.content?.trim() || '';
      if (!content) {
        return false;
      }

      const normalizedComment = this.normalizeCommentComparisonText(content);
      return normalizedComment === normalizedReply;
    });
  }

  private isGenericMomentReply(reply: string): boolean {
    const normalized = this.normalizeCommentComparisonText(reply);
    if (!normalized) {
      return true;
    }

    const genericPatterns = [
      '嗯这样就很好我也替你开心',
      '我也替你开心',
      '这样就很好',
      '嗯我看到啦也记在心里了',
      '我看到啦也记在心里了',
      '心意我收到了',
    ];

    return genericPatterns.some(pattern => normalized.includes(pattern));
  }

  private normalizeCommentComparisonText(value: string): string {
    return value
      .replace(/[\s，。！？、；：“”‘’"'`~·,.!?:;()（）【】-]/g, '')
      .replace(/[[\]]/g, '')
      .trim();
  }

  private buildFallbackMomentReply(
    post: PostEntity,
    agent: AgentEntity,
    latestUserComment?: MomentCommentContext | null
  ): string {
    const content =
      latestUserComment?.content?.trim() || post.content?.trim() || '';
    const repliedAgentText =
      latestUserComment?.repliedComment?.type === PostCommentType.agent
        ? latestUserComment.repliedComment.content?.trim() || ''
        : '';
    const callMe = agent.agentCallMe?.trim() || '';
    const prefix = callMe ? `${callMe}，` : '';

    if (this.isMomentContextCorrection(content, repliedAgentText)) {
      if (/(?:不|没)(?:上班|工作)/.test(content)) {
        return '哦，是我说错了。你现在不上班，刚才不该乱猜。';
      }

      return '哦，是我说错了。刚才不该乱猜你的情况。';
    }

    if (this.isMomentCurrentTimeQuestion(content)) {
      return `知道，现在是${this.formatCurrentBeijingClock()}。刚才我没先回答你的话。`;
    }

    if (this.isMomentCurrentActivityQuestion(content)) {
      return `${prefix}没忙什么，正回你呢。`;
    }

    if (latestUserComment && /(?:不|没)(?:上班|工作)/.test(content)) {
      return '哦，知道了，你现在不上班。';
    }

    if (
      /(受伤|伤了|脚扭|扭伤|摔了|疼|痛|流血|崴脚|骨折|住院|难受|不舒服|生病|发烧)/.test(
        content
      )
    ) {
      return `${prefix}哎，怎么还伤着了，记得好好养着。`;
    }

    if (/(想你|想念|思念|惦记|清明|祭拜|难受|难过|伤心|舍不得)/.test(content)) {
      return `${prefix}我知道呢，心意我收到了。`;
    }

    if (
      /(开心|高兴|真好|哈哈|今天|出去玩|聚会|吃饭|风景|花|照片)/.test(content)
    ) {
      return `${prefix}嗯，看你这样，我心里也踏实些。`;
    }

    return latestUserComment
      ? `${prefix}嗯，我听着呢。`
      : `${prefix}嗯，我听见啦，你也照顾好自己。`;
  }

  private isMomentCurrentActivityQuestion(value: string): boolean {
    return /(?:你|您)(?:现在|这会儿|这时候)?(?:在)?(?:干嘛|干什么|做什么)(?:呢|呀|啊|吗|[？?]|$)/.test(
      value
    );
  }

  private isMomentCurrentTimeQuestion(value: string): boolean {
    return /(?:现在|这会儿)?(?:是)?几点|几点了|几点了吗/.test(value);
  }

  private isMomentContextCorrection(
    currentUserText: string,
    repliedAgentText: string
  ): boolean {
    if (!currentUserText || !repliedAgentText) {
      return false;
    }

    return (
      /(?:我)?(?:现在)?(?:不|没)(?:上班|工作)/.test(currentUserText) &&
      /(?:上班|工作)/.test(repliedAgentText)
    );
  }

  private formatCurrentBeijingClock(value = new Date()): string {
    const parts = new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(value);
    const partMap = new Map(parts.map(part => [part.type, part.value]));

    return `${partMap.get('hour')}:${partMap.get('minute')}`;
  }

  private async findAgentById(
    value: MongoObjectId | string | undefined
  ): Promise<AgentEntity | null> {
    const objectId = this.normalizeObjectId(value);

    if (!objectId) {
      return null;
    }

    const agentById = await this.agentModel.findOne({
      where: {
        id: objectId,
      },
    });

    if (agentById) {
      return agentById;
    }

    return this.agentModel.findOne({
      where: {
        _id: objectId,
      } as never,
    });
  }

  private normalizeObjectId(
    value: MongoObjectId | string | undefined
  ): MongoObjectId | null {
    if (!value) {
      return null;
    }

    if (value instanceof MongoObjectId) {
      return value;
    }

    try {
      return new MongoObjectId(value);
    } catch {
      return null;
    }
  }

  private parseObjectId(value: string): MongoObjectId {
    try {
      return new MongoObjectId(value);
    } catch {
      throw new AppError('INVALID_TOKEN', 'token subject is invalid', 401);
    }
  }

  private stringifyObjectId(value: MongoObjectId): string {
    return value?.toHexString?.() ?? String(value);
  }

  private async getPostById(postId: string): Promise<PostEntity> {
    const objectId = this.parseObjectId(postId);
    const postById = await this.postModel.findOne({
      where: {
        id: objectId,
      },
    });

    if (postById) {
      return postById;
    }

    const postByObjectId = await this.postModel.findOne({
      where: {
        _id: objectId,
      } as never,
    });

    if (postByObjectId) {
      return postByObjectId;
    }

    throw new AppError('POST_NOT_FOUND', 'post not found', 404);
  }
}
