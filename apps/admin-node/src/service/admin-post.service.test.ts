import {
  MongoObjectId,
  PostCommentEntity,
  PostEntity,
  PostLikeEntity,
  PostModerationStatus,
} from '@tzl/entities';
import { AdminPostService } from './admin-post.service';

const USER_ID = '665000000000000000000001';
const POST_ID = '665000000000000000000100';
const POST_2_ID = '665000000000000000000101';
const NOW = new Date('2026-05-13T08:00:00.000Z');

function sameObjectId(left?: MongoObjectId, right?: MongoObjectId) {
  return left?.toHexString?.() === right?.toHexString?.();
}

function createPost(overrides: Partial<PostEntity> = {}): PostEntity {
  const post = new PostEntity();

  Object.assign(post, {
    id: new MongoObjectId(POST_ID),
    userId: new MongoObjectId(USER_ID),
    content: '今天去公园散步',
    images: ['moments/flower.jpg'],
    remindAgentIds: [],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  });

  return post;
}

function createComment(postId: string): PostCommentEntity {
  const comment = new PostCommentEntity();

  Object.assign(comment, {
    id: new MongoObjectId(),
    postId: new MongoObjectId(postId),
    userId: new MongoObjectId(USER_ID),
    content: '评论',
    createdAt: NOW,
    updatedAt: NOW,
  });

  return comment;
}

function createLike(postId: string, userId = USER_ID): PostLikeEntity {
  const like = new PostLikeEntity();

  Object.assign(like, {
    id: new MongoObjectId(),
    postId: new MongoObjectId(postId),
    userId: new MongoObjectId(userId),
    createdAt: NOW,
    updatedAt: NOW,
  });

  return like;
}

function matchesValue(value: unknown, expected: unknown): boolean {
  if (expected && typeof expected === 'object' && '$in' in expected) {
    return ((expected as { $in: MongoObjectId[] }).$in).some(item =>
      matchesValue(value, item)
    );
  }

  if (value instanceof MongoObjectId && expected instanceof MongoObjectId) {
    return sameObjectId(value, expected);
  }

  return value === expected;
}

function matchesPostWhere(post: PostEntity, where: any): boolean {
  if (!where || Object.keys(where).length === 0) {
    return true;
  }

  if (where.$and) {
    return where.$and.every((clause: any) => matchesPostWhere(post, clause));
  }

  if (where.$or) {
    return where.$or.some((clause: any) => matchesPostWhere(post, clause));
  }

  return Object.keys(where).every(key => {
    const expected = where[key];
    const value = key === '_id' ? post.id : (post as any)[key];

    if (expected && typeof expected === 'object') {
      if ('$ne' in expected) {
        return value !== expected.$ne;
      }

      if ('$exists' in expected) {
        return expected.$exists ? value !== undefined : value === undefined;
      }

      if ('$regex' in expected) {
        return new RegExp(expected.$regex, expected.$options).test(
          String(value ?? '')
        );
      }

      if ('$in' in expected) {
        return matchesValue(value, expected);
      }
    }

    return matchesValue(value, expected);
  });
}

function createService(
  posts: PostEntity[],
  comments: PostCommentEntity[] = [],
  likes: PostLikeEntity[] = []
) {
  const service = new AdminPostService();
  const userId = new MongoObjectId(USER_ID);
  const user = {
    id: userId,
    name: 'Alice',
    avatar: 'users/alice.png',
    phone: '13800000000',
  };
  const account = {
    id: new MongoObjectId(),
    userId,
    account: 'alice-account',
  };

  service.postModel = {
    count: jest.fn(async (where: any) => {
      return posts.filter(post => matchesPostWhere(post, where)).length;
    }),
    find: jest.fn(async ({ where, order, skip = 0, take }: any) => {
      let result = posts.filter(post => matchesPostWhere(post, where));

      if (order?.createdAt === 'DESC') {
        result = result.sort(
          (left, right) => right.createdAt.getTime() - left.createdAt.getTime()
        );
      }

      return result.slice(skip, skip + take);
    }),
    findOne: jest.fn(async ({ where }: any = {}) => {
      return (
        posts.find(post => sameObjectId(post.id, where?.id ?? where?._id)) ??
        null
      );
    }),
    save: jest.fn(async (post: PostEntity) => post),
  } as any;
  service.commentModel = {
    find: jest.fn(async ({ where }: any = {}) => {
      return comments.filter(comment =>
        where?.postId?.$in?.some((postId: MongoObjectId) =>
          sameObjectId(comment.postId, postId)
        )
      );
    }),
  } as any;
  service.likeModel = {
    find: jest.fn(async ({ where }: any = {}) => {
      return likes.filter(like =>
        where?.postId?.$in?.some((postId: MongoObjectId) =>
          sameObjectId(like.postId, postId)
        )
      );
    }),
  } as any;
  service.userModel = {
    find: jest.fn(async () => [user]),
  } as any;
  service.userAccountModel = {
    find: jest.fn(async () => [account]),
  } as any;
  service.avatarUrlService = {
    resolve: jest.fn((avatar?: string) => {
      const value = avatar?.trim() ?? '';
      return value ? `https://cdn.example.com/${value}` : '';
    }),
  } as any;
  service.storageFileService = {
    resolve: jest.fn((value?: string) => {
      const image = value?.trim() ?? '';
      return image ? `https://cdn.example.com/${image}` : '';
    }),
  } as any;

  return service;
}

describe('AdminPostService', () => {
  it('lists posts with owner, counts, and moderation status', async () => {
    const riskPost = createPost({
      moderationStatus: PostModerationStatus.riskControlled,
      moderationReason: '疑似违规',
    });
    const service = createService(
      [riskPost],
      [createComment(POST_ID)],
      [
        createLike(POST_ID, '665000000000000000000011'),
        createLike(POST_ID, '665000000000000000000012'),
      ]
    );

    const result = await service.listPosts({
      userId: USER_ID,
      moderationStatus: 'risk_controlled',
      page: '1',
      pageSize: '10',
    });

    expect(service.postModel.count).toHaveBeenCalledWith(
      expect.objectContaining({
        $and: expect.any(Array),
      })
    );
    expect(result).toEqual({
      items: [
        expect.objectContaining({
          id: POST_ID,
          userId: USER_ID,
          content: '今天去公园散步',
          images: ['https://cdn.example.com/moments/flower.jpg'],
          moderationStatus: 'risk_controlled',
          moderationReason: '疑似违规',
          isRiskControlled: true,
          commentCount: 1,
          likeCount: 2,
          user: expect.objectContaining({
            account: 'alice-account',
            avatar: 'https://cdn.example.com/users/alice.png',
          }),
        }),
      ],
      total: 1,
      page: 1,
      pageSize: 10,
    });
  });

  it('treats old posts without moderation status as normal', async () => {
    const normalPost = createPost({
      id: new MongoObjectId(POST_ID),
      moderationStatus: undefined,
    });
    const riskPost = createPost({
      id: new MongoObjectId(POST_2_ID),
      moderationStatus: PostModerationStatus.riskControlled,
    });
    const service = createService([normalPost, riskPost]);

    const result = await service.listPosts({
      moderationStatus: 'normal',
      page: 1,
      pageSize: 20,
    });

    expect(result.items.map(item => item.id)).toEqual([POST_ID]);
    expect(result.items[0].moderationStatus).toBe('normal');
  });

  it('updates post moderation status and reason', async () => {
    const post = createPost();
    const service = createService([post]);

    const result = await service.updatePostModeration(POST_ID, {
      moderationStatus: 'risk_controlled',
      moderationReason: ' 内容不适合公开 ',
    });

    expect(post.moderationStatus).toBe(PostModerationStatus.riskControlled);
    expect(post.moderationReason).toBe('内容不适合公开');
    expect(post.moderatedAt).toBeInstanceOf(Date);
    expect(post.updatedAt).toBe(post.moderatedAt);
    expect(service.postModel.save).toHaveBeenCalledWith(post);
    expect(result).toEqual(
      expect.objectContaining({
        id: POST_ID,
        moderationStatus: 'risk_controlled',
        moderationReason: '内容不适合公开',
        isRiskControlled: true,
      })
    );
  });
});
