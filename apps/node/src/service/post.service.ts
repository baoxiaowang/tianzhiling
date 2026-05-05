import { Inject, Logger, Provide } from '@midwayjs/core';
import { ILogger } from '@midwayjs/logger';
import { InjectEntityModel } from '@midwayjs/typeorm';
import * as bullmq from '@midwayjs/bullmq';
import type { ChatCompletion } from 'openai/resources/chat/completions';
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
  PostEntity,
  UserEntity,
} from '@tzl/entities';
import { AuthenticatedUserPayload } from '../interface';
import { OpenAIService } from './agents/openai';
import { buildMomentsSystemPrompt } from '../promte/moments';
import { PostImageService } from './post-image.service';

export const POST_REMIND_REPLY_QUEUE = 'post-remind-reply';

export interface PostRemindReplyJobData {
  postId: string;
  agentId: string;
}

export interface PostItem {
  id: string;
  userId: string;
  authorName: string;
  authorAvatar: string;
  content: string;
  images: string[];
  remindAgentIds: string[];
  likeCount: number;
  likedByMe: boolean;
  commentCount: number;
  comments: PostCommentItem[];
  createdAt: string;
  updatedAt: string;
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
  isRead: boolean;
  createdAt: string;
}

export interface PostCommentNotificationSummary {
  unreadCount: number;
  latest: PostCommentNotificationItem | null;
}

interface PostLikeSummary {
  likeCountByPostId: Map<string, number>;
  likedPostIds: Set<string>;
}

@Provide()
export class PostService {
  @Logger()
  logger: ILogger;

  @Inject()
  postImageService: PostImageService;

  @Inject()
  openAIService: OpenAIService;

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

  @InjectEntityModel(AgentEntity)
  agentModel: MongoRepository<AgentEntity>;

  @InjectEntityModel(UserEntity)
  userModel: MongoRepository<UserEntity>;

  async listPosts(auth?: AuthenticatedUserPayload): Promise<PostItem[]> {
    const posts = await this.postModel.find({
      order: {
        createdAt: 'DESC',
      },
    });
    const currentUserId = auth?.sub ? this.parseObjectId(auth.sub) : null;
    const likeSummary = await this.buildLikeSummary(posts, currentUserId);

    const authorCache = new Map<string, UserEntity | null>();
    const agentCache = new Map<string, AgentEntity | null>();
    const commentCountCache = new Map<string, number>();
    const commentsCache = new Map<string, PostCommentItem[]>();

    return Promise.all(
      posts.map(async post => {
        const userId = this.stringifyObjectId(post.userId);
        const postId = this.stringifyObjectId(post.id);

        if (!authorCache.has(userId)) {
          const user = await this.findUserById(post.userId);
          authorCache.set(userId, user);
        }

        if (!commentCountCache.has(postId)) {
          const comments = await this.listCommentItemsByPostId(
            post.id,
            authorCache,
            agentCache
          );
          commentsCache.set(postId, comments);
          commentCountCache.set(postId, comments.length);
        }

        return this.buildPostItem(
          post,
          authorCache.get(userId) ?? null,
          likeSummary.likeCountByPostId.get(postId) ?? 0,
          likeSummary.likedPostIds.has(postId),
          commentCountCache.get(postId) ?? 0,
          commentsCache.get(postId) ?? []
        );
      })
    );
  }

  async getPostDetail(
    postId: string,
    auth?: AuthenticatedUserPayload
  ): Promise<PostItem> {
    const post = await this.getPostById(postId);
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
    const notifications = await this.commentNotificationModel.find({
      where: {
        userId,
        isRead: false,
      },
      order: {
        createdAt: 'DESC',
      },
      take: 50,
    });

    return {
      unreadCount: notifications.length,
      latest:
        notifications.length > 0
          ? this.buildCommentNotificationItem(notifications[0])
          : null,
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
      notification.isRead = true;
      notification.readAt = now;
      notification.updatedAt = now;
    }

    if (notifications.length > 0) {
      await this.commentNotificationModel.save(notifications);
    }

    const unreadCount = await this.commentNotificationModel.count({
      where: {
        userId,
        isRead: false,
      },
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

    const now = new Date();
    const post = new PostEntity();
    post.userId = userId;
    post.content = content;
    post.images = images;
    post.remindAgentIds = remindAgentIds;
    post.createdAt = now;
    post.updatedAt = now;

    const savedPost = await this.postModel.save(post);
    await this.enqueueRemindReplyJobs(savedPost);

    return this.buildPostItem(savedPost, user, 0, false, 0, []);
  }

  async likePost(
    auth: AuthenticatedUserPayload,
    postId: string
  ): Promise<PostItem> {
    const post = await this.getPostById(postId);
    const userId = this.parseObjectId(auth.sub);
    const existing = await this.findLike(post.id, userId);

    if (!existing) {
      const now = new Date();
      const like = new PostLikeEntity();
      like.postId = post.id;
      like.userId = userId;
      like.createdAt = now;
      like.updatedAt = now;

      try {
        await this.likeModel.save(like);
      } catch (error) {
        const duplicateCode = (error as { code?: number } | undefined)?.code;

        if (duplicateCode !== 11000) {
          throw error;
        }
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

    await this.likeModel.deleteOne({
      postId: post.id,
      userId,
    } as never);

    return this.getPostDetail(postId, auth);
  }

  async listComments(postId: string): Promise<PostCommentItem[]> {
    const post = await this.getPostById(postId);
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
    const content = this.normalizeCommentContent(payload?.content);
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
    await this.createCommentNotification(post, savedComment, user, null);

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

    if (!postId || !agentId) {
      this.logger.warn(
        '[post-remind-reply] skip invalid job payload, postId=%s, agentId=%s',
        postId,
        agentId
      );
      return;
    }

    const post = await this.getPostById(postId);
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
    if (
      this.stringifyObjectId(agent.createdUserId) !== ownerUserId ||
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

    const now = new Date();
    const comment = new PostCommentEntity();
    comment.postId = post.id;
    comment.agentId = agent.id;
    comment.type = PostCommentType.agent;
    comment.content = content;
    comment.createdAt = now;
    comment.updatedAt = now;

    await this.commentModel.save(comment);
    await this.createCommentNotification(post, comment, null, agent);
    this.logger.info(
      '[post-remind-reply] created agent comment, postId=%s, agentId=%s',
      postId,
      agentId
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
    return {
      id: this.stringifyObjectId(post.id),
      userId: this.stringifyObjectId(post.userId),
      authorName: user?.name?.trim() || '天之灵用户',
      authorAvatar: this.postImageService.resolveForResponse(
        user?.avatar?.trim() || ''
      ),
      content: post.content?.trim() || '',
      images: Array.isArray(post.images)
        ? post.images
            .filter(image => typeof image === 'string')
            .map(image => this.postImageService.resolveForResponse(image))
            .filter(Boolean)
        : [],
      remindAgentIds: Array.isArray(post.remindAgentIds)
        ? post.remindAgentIds
            .filter(agentId => typeof agentId === 'string')
            .map(agentId => agentId.trim())
            .filter(Boolean)
        : [],
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
    const likes = await this.likeModel.find({
      where: {
        postId: {
          $in: postIds,
        },
      } as never,
    });
    const currentUserIdText = currentUserId
      ? this.stringifyObjectId(currentUserId)
      : '';

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

    return Promise.all(
      comments.map(async comment => {
        const userId = comment.userId
          ? this.stringifyObjectId(comment.userId)
          : '';

        if (userId && !authorCache.has(userId)) {
          const user = await this.findUserById(comment.userId);
          authorCache.set(userId, user);
        }

        const agentId = comment.agentId
          ? this.stringifyObjectId(comment.agentId)
          : '';

        if (agentId && !agentCache.has(agentId)) {
          const agent = await this.findAgentById(comment.agentId);
          agentCache.set(agentId, agent);
        }

        const replyToUserId = comment.replyToUserId
          ? this.stringifyObjectId(comment.replyToUserId)
          : '';

        if (replyToUserId && !authorCache.has(replyToUserId)) {
          const replyToUser = await this.findUserById(comment.replyToUserId!);
          authorCache.set(replyToUserId, replyToUser);
        }

        const replyToAgentId = comment.replyToAgentId
          ? this.stringifyObjectId(comment.replyToAgentId)
          : '';

        if (replyToAgentId && !agentCache.has(replyToAgentId)) {
          const replyToAgent = await this.findAgentById(comment.replyToAgentId);
          agentCache.set(replyToAgentId, replyToAgent);
        }

        return this.buildCommentItem(
          comment,
          userId ? authorCache.get(userId) ?? null : null,
          replyToUserId ? authorCache.get(replyToUserId) ?? null : null,
          agentId ? agentCache.get(agentId) ?? null : null,
          replyToAgentId ? agentCache.get(replyToAgentId) ?? null : null
        );
      })
    );
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
      isRead: notification.isRead === true,
      createdAt: notification.createdAt?.toISOString?.() ?? '',
    };
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
    notification.isRead = false;
    notification.createdAt = comment.createdAt ?? new Date();
    notification.updatedAt = comment.updatedAt ?? notification.createdAt;

    await this.commentNotificationModel.save(notification);
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

  private async normalizeRemindAgentIds(
    ownerUserId: MongoObjectId,
    rawAgentIds?: string[]
  ): Promise<string[]> {
    if (!Array.isArray(rawAgentIds)) {
      return [];
    }

    const remindAgentIds = Array.from(
      new Set(
        rawAgentIds
          .map(agentId => (typeof agentId === 'string' ? agentId.trim() : ''))
          .filter(Boolean)
      )
    );

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

  private async generateAgentPostReply(
    post: PostEntity,
    user: UserEntity,
    agent: AgentEntity
  ): Promise<string> {
    const existingComments = await this.commentModel.find({
      where: {
        postId: post.id,
      },
      order: {
        createdAt: 'ASC',
      },
      take: 10,
    });
    const systemPrompt = buildMomentsSystemPrompt({
      userId: this.stringifyObjectId(post.userId),
      agentId: this.stringifyObjectId(agent.id),
      agent,
      momentDetail: this.buildMomentDetail(post, user),
      commentContent: this.buildMomentCommentContext(existingComments),
      message: '请基于这条朋友圈内容发表一条自然简短、不要重复现有评论的评论',
    });
    const result = await this.openAIService.generateText({
      systemPrompt,
      prompt: '请直接输出一条朋友圈评论正文。',
      temperature: 1.35,
      topP: 0.98,
      presencePenalty: 0.9,
      frequencyPenalty: 0.45,
      maxTokens: 120,
      reasoningSplit: false,
    });

    const reply = this.normalizeGeneratedPostReply(result);
    const selected = this.selectMomentReply(
      post,
      agent,
      reply,
      existingComments
    );
    return selected || this.buildFallbackMomentReply(post, agent);
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
      .replace(/^\s*[\-#*\d.]+\s*/g, '')
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

  private buildMomentDetail(post: PostEntity, user: UserEntity): string {
    const imageCount = Array.isArray(post.images) ? post.images.length : 0;

    return [
      `发布者：${user.name?.trim() || '对方'}`,
      `正文：${post.content?.trim() || '无正文'}`,
      `图片数量：${imageCount}`,
    ].join('\n');
  }

  private buildMomentCommentContext(comments: PostCommentEntity[]): string {
    if (!Array.isArray(comments) || comments.length === 0) {
      return '';
    }

    return comments
      .slice(-10)
      .map(comment => {
        const role = comment.agentId ? 'assistant' : 'user';
        const content = comment.content?.trim() || '';
        return content ? `${role}: ${content}` : '';
      })
      .filter(Boolean)
      .join('\n');
  }

  private selectMomentReply(
    post: PostEntity,
    agent: AgentEntity,
    reply: string,
    existingComments: PostCommentEntity[]
  ): string {
    const cleaned = reply.trim();
    if (!cleaned) {
      return '';
    }

    if (this.isGenericMomentReply(cleaned)) {
      return this.buildFallbackMomentReply(post, agent);
    }

    if (this.isDuplicateMomentReply(cleaned, existingComments)) {
      return this.buildFallbackMomentReply(post, agent);
    }

    return cleaned;
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
      .replace(/[\s，。！？、；：“”‘’"'`~·,.!?:;()（）【】\[\]-]/g, '')
      .trim();
  }

  private buildFallbackMomentReply(
    post: PostEntity,
    agent: AgentEntity
  ): string {
    const content = post.content?.trim() || '';
    const callMe = agent.agentCallMe?.trim() || '';
    const prefix = callMe ? `${callMe}，` : '';

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

    return `${prefix}嗯，我听见啦，你也照顾好自己。`;
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
