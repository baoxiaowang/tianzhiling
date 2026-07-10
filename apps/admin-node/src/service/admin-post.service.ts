import { Inject, Provide } from '@midwayjs/core';
import { InjectEntityModel } from '@midwayjs/typeorm';
import { AppError } from '@tzl/shared';
import type {
  AdminPostAuthorDTO,
  AdminPostListDTO,
  AdminPostRecordDTO,
} from '@tzl/shared';
import {
  MongoObjectId,
  PostCommentEntity,
  PostEntity,
  PostLikeEntity,
  PostModerationStatus,
  UserAccountEntity,
  UserEntity,
} from '@tzl/entities';
import { MongoRepository } from 'typeorm';
import {
  ListAdminPostsQueryDTO,
  UpdateAdminPostModerationDTO,
} from '../dto/admin-post.dto';
import { AdminAvatarUrlService } from './admin-avatar-url.service';
import { AdminStorageFileService } from './admin-storage-file.service';

type MongoWhere = Record<string, unknown>;

@Provide()
export class AdminPostService {
  @InjectEntityModel(PostEntity)
  postModel: MongoRepository<PostEntity>;

  @InjectEntityModel(PostCommentEntity)
  commentModel: MongoRepository<PostCommentEntity>;

  @InjectEntityModel(PostLikeEntity)
  likeModel: MongoRepository<PostLikeEntity>;

  @InjectEntityModel(UserEntity)
  userModel: MongoRepository<UserEntity>;

  @InjectEntityModel(UserAccountEntity)
  userAccountModel: MongoRepository<UserAccountEntity>;

  @Inject()
  avatarUrlService: AdminAvatarUrlService;

  @Inject()
  storageFileService: AdminStorageFileService;

  async listPosts(query: ListAdminPostsQueryDTO): Promise<AdminPostListDTO> {
    const page = this.normalizePositiveInteger(query?.page, 1);
    const pageSize = Math.min(
      this.normalizePositiveInteger(query?.pageSize, 20),
      100
    );
    const where = await this.buildPostListWhere(query);
    const [total, posts] = await Promise.all([
      this.postModel.count(where),
      this.postModel.find({
        where: where as never,
        order: {
          createdAt: 'DESC',
        },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    const [ownerMap, commentCountMap, likeCountMap] = await Promise.all([
      this.getOwnerMapByPosts(posts),
      this.getCommentCountMap(posts),
      this.getLikeCountMap(posts),
    ]);

    return {
      items: posts.map(post =>
        this.buildPostItem(
          post,
          ownerMap.get(this.stringifyObjectId(post.userId)) ?? null,
          commentCountMap.get(this.stringifyObjectId(post.id)) ?? 0,
          likeCountMap.get(this.stringifyObjectId(post.id)) ?? 0
        )
      ),
      total,
      page,
      pageSize,
    };
  }

  async listUserPosts(
    userId: string,
    query: ListAdminPostsQueryDTO
  ): Promise<AdminPostListDTO> {
    this.parseObjectId(userId);

    return this.listPosts({
      ...query,
      userId,
    });
  }

  async updatePostModeration(
    postId: string,
    payload: UpdateAdminPostModerationDTO
  ): Promise<AdminPostRecordDTO> {
    const post = await this.getPostById(postId);
    const status = this.normalizeModerationStatus(payload?.moderationStatus);
    const now = new Date();

    post.moderationStatus = status;
    post.moderationReason =
      status === PostModerationStatus.riskControlled
        ? this.normalizeModerationReason(payload?.moderationReason)
        : '';
    post.moderatedAt = now;
    post.updatedAt = now;

    const savedPost = await this.postModel.save(post);
    const [ownerMap, comments, likes] = await Promise.all([
      this.getOwnerMapByPosts([savedPost]),
      this.getCommentCountMap([savedPost]),
      this.getLikeCountMap([savedPost]),
    ]);

    return this.buildPostItem(
      savedPost,
      ownerMap.get(this.stringifyObjectId(savedPost.userId)) ?? null,
      comments.get(this.stringifyObjectId(savedPost.id)) ?? 0,
      likes.get(this.stringifyObjectId(savedPost.id)) ?? 0
    );
  }

  private async buildPostListWhere(
    query: ListAdminPostsQueryDTO
  ): Promise<MongoWhere> {
    const clauses: MongoWhere[] = [
      {
        isDeleted: {
          $ne: true,
        },
      },
    ];
    const userId = query?.userId?.trim();
    const moderationStatus = this.normalizeOptionalModerationStatus(
      query?.moderationStatus
    );
    const keywordClause = await this.buildKeywordClause(
      query?.keyword?.trim() ?? ''
    );

    if (userId) {
      clauses.push({
        userId: this.parseObjectId(userId),
      });
    }

    if (moderationStatus === PostModerationStatus.riskControlled) {
      clauses.push({
        moderationStatus: PostModerationStatus.riskControlled,
      });
    } else if (moderationStatus === PostModerationStatus.normal) {
      clauses.push({
        $or: [
          { moderationStatus: PostModerationStatus.normal },
          { moderationStatus: { $exists: false } },
          { moderationStatus: '' },
          { moderationStatus: null },
        ],
      });
    }

    if (keywordClause) {
      clauses.push(keywordClause);
    }

    return clauses.length === 1
      ? clauses[0]
      : {
          $and: clauses,
        };
  }

  private async buildKeywordClause(keyword: string): Promise<MongoWhere | null> {
    if (!keyword) {
      return null;
    }

    const escapedKeyword = this.escapeRegExp(keyword);
    const filters: MongoWhere[] = [
      {
        content: {
          $regex: escapedKeyword,
          $options: 'i',
        },
      },
    ];
    const matchedUserIds = await this.findUserIdsByKeyword(keyword);

    if (matchedUserIds.length > 0) {
      filters.push({
        userId: {
          $in: matchedUserIds,
        },
      });
    }

    if (MongoObjectId.isValid(keyword)) {
      const objectId = new MongoObjectId(keyword);
      filters.push({ id: objectId });
      filters.push({ _id: objectId });
      filters.push({ userId: objectId });
    }

    return {
      $or: filters,
    };
  }

  private async findUserIdsByKeyword(keyword: string): Promise<MongoObjectId[]> {
    const escapedKeyword = this.escapeRegExp(keyword);
    const [users, accounts] = await Promise.all([
      this.userModel.find({
        where: {
          $or: [
            { name: { $regex: escapedKeyword, $options: 'i' } },
            { phone: { $regex: escapedKeyword, $options: 'i' } },
          ],
        } as never,
        take: 200,
      }),
      this.userAccountModel.find({
        where: {
          account: { $regex: escapedKeyword, $options: 'i' },
        } as never,
        take: 200,
      }),
    ]);
    const userIds = [
      ...users.map(user => user.id),
      ...accounts.map(account => account.userId).filter(Boolean),
    ];
    const seen = new Set<string>();

    return userIds.filter(userId => {
      const text = this.stringifyObjectId(userId);

      if (seen.has(text)) {
        return false;
      }

      seen.add(text);
      return true;
    });
  }

  private async getOwnerMapByPosts(
    posts: PostEntity[]
  ): Promise<Map<string, AdminPostAuthorDTO>> {
    if (posts.length === 0) {
      return new Map();
    }

    const userIds = Array.from(
      new Map(
        posts.map(post => [this.stringifyObjectId(post.userId), post.userId])
      ).values()
    );
    const [users, accounts] = await Promise.all([
      this.userModel.find({
        where: {
          $or: [{ id: { $in: userIds } }, { _id: { $in: userIds } }],
        } as never,
      }),
      this.userAccountModel.find({
        where: {
          userId: { $in: userIds },
        } as never,
      }),
    ]);
    const accountMap = new Map(
      accounts.map(account => [
        this.stringifyObjectId(account.userId),
        account,
      ])
    );

    return new Map(
      users.map(user => [
        this.stringifyObjectId(user.id),
        this.buildAuthorItem(
          user,
          accountMap.get(this.stringifyObjectId(user.id))
        ),
      ])
    );
  }

  private async getCommentCountMap(
    posts: PostEntity[]
  ): Promise<Map<string, number>> {
    const result = new Map<string, number>();

    if (posts.length === 0) {
      return result;
    }

    const postIds = posts.map(post => post.id);
    const comments = await this.commentModel.find({
      where: {
        postId: {
          $in: postIds,
        },
      } as never,
    });

    for (const comment of comments) {
      const postId = this.stringifyObjectId(comment.postId);
      result.set(postId, (result.get(postId) ?? 0) + 1);
    }

    return result;
  }

  private async getLikeCountMap(
    posts: PostEntity[]
  ): Promise<Map<string, number>> {
    const result = new Map<string, number>();

    if (posts.length === 0) {
      return result;
    }

    const postIds = posts.map(post => post.id);
    const likes = await this.likeModel.find({
      where: {
        postId: {
          $in: postIds,
        },
      } as never,
    });
    const likeUserIdsByPostId = new Map<string, Set<string>>();

    for (const like of likes) {
      const postId = this.stringifyObjectId(like.postId);
      const userIds = likeUserIdsByPostId.get(postId) ?? new Set<string>();
      userIds.add(this.stringifyObjectId(like.userId));
      likeUserIdsByPostId.set(postId, userIds);
    }

    for (const [postId, userIds] of likeUserIdsByPostId.entries()) {
      result.set(postId, userIds.size);
    }

    return result;
  }

  private buildPostItem(
    post: PostEntity,
    user: AdminPostAuthorDTO | null,
    commentCount: number,
    likeCount: number
  ): AdminPostRecordDTO {
    const moderationStatus = this.normalizeModerationStatus(
      post.moderationStatus
    );

    return {
      id: this.stringifyObjectId(post.id),
      userId: this.stringifyObjectId(post.userId),
      user,
      content: post.content?.trim() || '',
      images: this.resolveImages(post.images),
      remindAgentIds: Array.isArray(post.remindAgentIds)
        ? post.remindAgentIds
            .filter(agentId => typeof agentId === 'string')
            .map(agentId => agentId.trim())
            .filter(Boolean)
        : [],
      moderationStatus,
      moderationReason: post.moderationReason?.trim() || '',
      moderatedAt: this.formatDate(post.moderatedAt),
      isRiskControlled:
        moderationStatus === PostModerationStatus.riskControlled,
      likeCount,
      commentCount,
      createdAt: this.formatDate(post.createdAt),
      updatedAt: this.formatDate(post.updatedAt),
    };
  }

  private buildAuthorItem(
    user: UserEntity,
    account?: UserAccountEntity | null
  ): AdminPostAuthorDTO {
    return {
      id: this.stringifyObjectId(user.id),
      account: account?.account ?? user.phone ?? '',
      name: user.name ?? '',
      avatar: this.avatarUrlService.resolve(user.avatar),
      phone: user.phone ?? account?.account ?? '',
    };
  }

  private resolveImages(images?: string[]): string[] {
    return Array.isArray(images)
      ? images
          .filter(image => typeof image === 'string')
          .map(image => this.storageFileService.resolve(image))
          .filter(Boolean)
      : [];
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

  private normalizeOptionalModerationStatus(
    status?: string
  ): PostModerationStatus | undefined {
    if (!status) {
      return undefined;
    }

    return this.normalizeModerationStatus(status);
  }

  private normalizeModerationStatus(status?: string): PostModerationStatus {
    if (status === PostModerationStatus.riskControlled) {
      return PostModerationStatus.riskControlled;
    }

    if (!status || status === PostModerationStatus.normal) {
      return PostModerationStatus.normal;
    }

    throw new AppError('INVALID_POST_MODERATION_STATUS', 'invalid status', 400);
  }

  private normalizeModerationReason(rawReason?: string): string {
    const reason = rawReason?.trim() ?? '';

    if (reason.length > 200) {
      throw new AppError(
        'INVALID_POST_MODERATION_REASON',
        'moderation reason must be 200 characters or fewer',
        400
      );
    }

    return reason;
  }

  private normalizePositiveInteger(
    rawValue: string | number | undefined,
    fallback: number
  ): number {
    const value = Number(rawValue);

    if (!Number.isFinite(value) || value <= 0) {
      return fallback;
    }

    return Math.floor(value);
  }

  private parseObjectId(value: string): MongoObjectId {
    if (!MongoObjectId.isValid(value)) {
      throw new AppError('INVALID_POST_ID', 'invalid post id', 400);
    }

    return new MongoObjectId(value);
  }

  private stringifyObjectId(value: MongoObjectId): string {
    return value?.toHexString?.() ?? String(value);
  }

  private formatDate(value?: Date): string {
    if (!value) {
      return '';
    }

    return value instanceof Date
      ? value.toISOString()
      : new Date(value).toISOString();
  }

  private escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
