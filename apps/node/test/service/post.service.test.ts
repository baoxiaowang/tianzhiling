import {
  AgentEntity,
  AgentSex,
  MongoObjectId,
  PostCommentEntity,
  PostCommentNotificationEntity,
  PostCommentType,
  PostEntity,
  PostLikeEntity,
  PostModerationStatus,
  PostNotificationEntity,
  PostNotificationType,
  UserEntity,
  UserAccountEntity,
} from '@tzl/entities';
import { PostService } from '../../src/service/post.service';

const USER_ID = '665000000000000000000001';
const OTHER_USER_ID = '665000000000000000000002';
const AGENT_A_ID = '665000000000000000000010';
const AGENT_B_ID = '665000000000000000000011';
const POST_ID = '665000000000000000000100';
const POST_2_ID = '665000000000000000000101';
const POST_3_ID = '665000000000000000000102';
const COMMENT_ID = '665000000000000000000200';
const NOTIFICATION_ID = '665000000000000000000300';
const POST_NOTIFICATION_ID = '665000000000000000000400';
const ACCOUNT_ID = '665000000000000000000600';
const NOW = new Date('2026-05-13T08:00:00.000Z');
const AUTH = {
  sub: USER_ID,
  accountId: ACCOUNT_ID,
  account: 'user',
  iat: 1778659200,
  exp: 1778688000,
  nonce: 'nonce',
};
const OTHER_AUTH = {
  ...AUTH,
  sub: OTHER_USER_ID,
  accountId: 'account-2',
  account: 'other-user',
};

function sameObjectId(left?: MongoObjectId, right?: MongoObjectId) {
  return left?.toHexString?.() === right?.toHexString?.();
}

function createAgent(
  id: string,
  overrides: Partial<AgentEntity> = {}
): AgentEntity {
  const agent = new AgentEntity();

  Object.assign(agent, {
    id: new MongoObjectId(id),
    createdUserId: new MongoObjectId(USER_ID),
    name: '奶奶',
    avatar: '',
    sex: AgentSex.woman,
    iCallAgent: '奶奶',
    agentCallMe: '小宝',
    description: '',
    lifeExperience: '',
    personalityTraits: '',
    languageHabits: '',
    hobbies: '',
    sharedMemories: '',
    status: 1,
    isDefault: false,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  });

  return agent;
}

function createUser(): UserEntity {
  const user = new UserEntity();

  Object.assign(user, {
    id: new MongoObjectId(USER_ID),
    name: '用户',
    avatar: '',
  });

  return user;
}

function createUserAccount(
  overrides: Partial<UserAccountEntity> = {}
): UserAccountEntity {
  const account = new UserAccountEntity();

  Object.assign(account, {
    id: new MongoObjectId(ACCOUNT_ID),
    userId: new MongoObjectId(USER_ID),
    account: 'weapp:account-hash',
    password: '',
    openId: 'openid-1',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  });

  return account;
}

function createPost(overrides: Partial<PostEntity> = {}): PostEntity {
  const post = new PostEntity();

  Object.assign(post, {
    id: new MongoObjectId(POST_ID),
    userId: new MongoObjectId(USER_ID),
    content: '今天去公园散步',
    images: [],
    remindAgentIds: [],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  });

  return post;
}

function createNotification(
  overrides: Partial<PostCommentNotificationEntity> = {}
): PostCommentNotificationEntity {
  const notification = new PostCommentNotificationEntity();

  Object.assign(notification, {
    id: new MongoObjectId(NOTIFICATION_ID),
    userId: new MongoObjectId(USER_ID),
    postId: new MongoObjectId(POST_ID),
    commentId: new MongoObjectId(COMMENT_ID),
    commentType: PostCommentType.user,
    actorName: '小宁',
    actorAvatar: 'avatars/xiaoning.png',
    commentPreview: '我也好想她！',
    replyToUserName: '柠檬',
    postThumbnail: 'moments/flower.jpg',
    isRead: false,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  });

  return notification;
}

function createPostNotification(
  overrides: Partial<PostNotificationEntity> = {}
): PostNotificationEntity {
  const notification = new PostNotificationEntity();

  Object.assign(notification, {
    id: new MongoObjectId(POST_NOTIFICATION_ID),
    userId: new MongoObjectId(USER_ID),
    postId: new MongoObjectId(POST_ID),
    type: PostNotificationType.comment,
    commentId: new MongoObjectId(COMMENT_ID),
    commentType: PostCommentType.user,
    actorName: '小宁',
    actorAvatar: 'avatars/xiaoning.png',
    contentPreview: '我也好想她！',
    replyToUserName: '柠檬',
    postThumbnail: 'moments/flower.jpg',
    isRead: false,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  });

  return notification;
}

function createService(
  agents: AgentEntity[] = [],
  options: {
    posts?: PostEntity[];
    notifications?: PostCommentNotificationEntity[];
    postNotifications?: PostNotificationEntity[];
    comments?: PostCommentEntity[];
    likes?: PostLikeEntity[];
    userAccounts?: UserAccountEntity[];
  } = {}
) {
  const service = new PostService();
  const savedPosts: PostEntity[] = [];
  const posts = options.posts ?? [];
  const notifications = options.notifications ?? [];
  const postNotifications = options.postNotifications ?? [];
  const comments = options.comments ?? [];
  const likes = options.likes ?? [];
  const userAccounts = options.userAccounts ?? [createUserAccount()];
  const addJobToQueue = jest.fn(async () => undefined);

  service.postModel = {
    save: jest.fn(async (post: PostEntity) => {
      post.id = post.id ?? new MongoObjectId(POST_ID);
      savedPosts.push(post);
      return post;
    }),
    find: jest.fn(async ({ where, order, skip = 0, take }: any) => {
      let result = [...posts];

      if (where?.userId) {
        result = result.filter(post => sameObjectId(post.userId, where.userId));
      }

      if (where?.isDeleted?.$ne === true) {
        result = result.filter(post => post.isDeleted !== true);
      }

      if (where?.moderationStatus?.$ne) {
        result = result.filter(
          post => post.moderationStatus !== where.moderationStatus.$ne
        );
      } else if (where?.moderationStatus) {
        result = result.filter(
          post => post.moderationStatus === where.moderationStatus
        );
      }

      if (order?.createdAt === 'DESC') {
        result = result.sort(
          (left, right) => right.createdAt.getTime() - left.createdAt.getTime()
        );
      }

      return typeof take === 'number'
        ? result.slice(skip, skip + take)
        : result.slice(skip);
    }),
    findOne: jest.fn(async ({ where }: any = {}) => {
      return (
        posts.find(post => sameObjectId(post.id, where?.id ?? where?._id)) ??
        null
      );
    }),
  } as any;
  service.userModel = {
    findOne: jest.fn(async ({ where }: any) =>
      sameObjectId(where?.id ?? where?._id, new MongoObjectId(USER_ID))
        ? createUser()
        : null
    ),
  } as any;
  service.userAccountModel = {
    findOne: jest.fn(async ({ where }: any = {}) => {
      return (
        userAccounts.find(account =>
          sameObjectId(account.id, where?.id ?? where?._id)
        ) ?? null
      );
    }),
    find: jest.fn(async ({ where }: any = {}) => {
      return userAccounts.filter(account => {
        const matchesUser = where?.userId
          ? sameObjectId(account.userId, where.userId)
          : true;

        return matchesUser;
      });
    }),
  } as any;
  service.agentModel = {
    findOne: jest.fn(async ({ where }: any) => {
      const id = where?.id ?? where?._id;

      return (
        agents.find(agent => {
          const matchesId = id ? sameObjectId(agent.id, id) : true;
          const matchesUser = where?.createdUserId
            ? sameObjectId(agent.createdUserId, where.createdUserId)
            : true;
          const matchesDefault =
            where?.isDefault === undefined ||
            agent.isDefault === where.isDefault;

          return matchesId && matchesUser && matchesDefault;
        }) ?? null
      );
    }),
    find: jest.fn(async ({ where, order, skip = 0, take }: any) => {
      let result = agents.filter(agent =>
        sameObjectId(agent.createdUserId, where?.createdUserId)
      );

      if (order?.updatedAt === 'DESC') {
        result = result.sort(
          (left, right) => right.updatedAt.getTime() - left.updatedAt.getTime()
        );
      }

      return typeof take === 'number' ? result.slice(0, take) : result;
    }),
  } as any;
  service.postImageService = {
    normalizeForStorage: jest.fn((value: string) => value),
    resolveForResponse: jest.fn((value: string) =>
      /^https?:\/\//i.test(value) ? value : `https://cdn.example.com/${value}`
    ),
  } as any;
  service.bullmqFramework = {
    getQueue: jest.fn(() => ({ addJobToQueue })),
  } as any;
  service.commentModel = {
    find: jest.fn(async ({ where }: any = {}) => {
      return comments.filter(comment => {
        const matchesPost = where?.postId
          ? sameObjectId(comment.postId, where.postId)
          : true;
        const matchesAgent = where?.agentId
          ? sameObjectId(comment.agentId, where.agentId)
          : true;

        return matchesPost && matchesAgent;
      });
    }),
    findOne: jest.fn(async ({ where }: any = {}) => {
      return (
        comments.find(comment => {
          const matchesPost = where?.postId
            ? sameObjectId(comment.postId, where.postId)
            : true;
          const matchesAgent = where?.agentId
            ? sameObjectId(comment.agentId, where.agentId)
            : true;

          return matchesPost && matchesAgent;
        }) ?? null
      );
    }),
    save: jest.fn(async (comment: PostCommentEntity) => {
      comment.id = comment.id ?? new MongoObjectId(COMMENT_ID);
      comments.push(comment);
      return comment;
    }),
  } as any;
  service.commentNotificationModel = {
    find: jest.fn(async ({ where, order, skip = 0, take }: any) => {
      let result = notifications.filter(notification => {
        const matchesUser = where?.userId
          ? sameObjectId(notification.userId, where.userId)
          : true;
        const matchesRead =
          where?.isRead === undefined || notification.isRead === where.isRead;
        const matchesPost = where?.postId
          ? sameObjectId(notification.postId, where.postId)
          : true;

        return matchesUser && matchesRead && matchesPost;
      });

      if (order?.createdAt === 'DESC') {
        result = result.sort(
          (left, right) => right.createdAt.getTime() - left.createdAt.getTime()
        );
      }

      return typeof take === 'number'
        ? result.slice(skip, skip + take)
        : result.slice(skip);
    }),
    count: jest.fn(async (query: any = {}) => {
      return notifications.filter(notification => {
        const matchesUser = query.userId
          ? sameObjectId(notification.userId, query.userId)
          : true;
        const matchesRead =
          query.isRead === undefined || notification.isRead === query.isRead;

        return matchesUser && matchesRead;
      }).length;
    }),
    save: jest.fn(async value => {
      if (Array.isArray(value)) {
        return value;
      }

      value.id = value.id ?? new MongoObjectId(NOTIFICATION_ID);
      notifications.push(value);
      return value;
    }),
  } as any;
  service.notificationModel = {
    find: jest.fn(async ({ where, order, skip = 0, take }: any = {}) => {
      let result = postNotifications.filter(notification => {
        const matchesUser = where?.userId
          ? sameObjectId(notification.userId, where.userId)
          : true;
        const matchesRead =
          where?.isRead === undefined || notification.isRead === where.isRead;
        const matchesPost = where?.postId
          ? sameObjectId(notification.postId, where.postId)
          : true;

        return matchesUser && matchesRead && matchesPost;
      });

      if (order?.createdAt === 'DESC') {
        result = result.sort(
          (left, right) => right.createdAt.getTime() - left.createdAt.getTime()
        );
      }

      return typeof take === 'number'
        ? result.slice(skip, skip + take)
        : result.slice(skip);
    }),
    count: jest.fn(async (query: any = {}) => {
      return postNotifications.filter(notification => {
        const matchesUser = query.userId
          ? sameObjectId(notification.userId, query.userId)
          : true;
        const matchesRead =
          query.isRead === undefined || notification.isRead === query.isRead;

        return matchesUser && matchesRead;
      }).length;
    }),
    save: jest.fn(async value => {
      if (Array.isArray(value)) {
        return value;
      }

      value.id = value.id ?? new MongoObjectId(POST_NOTIFICATION_ID);
      postNotifications.push(value);
      return value;
    }),
    deleteOne: jest.fn(async (query: any = {}) => {
      const index = postNotifications.findIndex(notification => {
        const matchesPost = query.postId
          ? sameObjectId(notification.postId, query.postId)
          : true;
        const matchesActor = query.actorUserId
          ? sameObjectId(notification.actorUserId, query.actorUserId)
          : true;
        const matchesType =
          query.type === undefined || notification.type === query.type;

        return matchesPost && matchesActor && matchesType;
      });

      if (index >= 0) {
        postNotifications.splice(index, 1);
      }

      return { deletedCount: index >= 0 ? 1 : 0 };
    }),
  } as any;
  service.likeModel = {
    find: jest.fn(async () => likes),
    findOne: jest.fn(async ({ where }: any = {}) => {
      return (
        likes.find(like => {
          const matchesPost = where?.postId
            ? sameObjectId(like.postId, where.postId)
            : true;
          const matchesUser = where?.userId
            ? sameObjectId(like.userId, where.userId)
            : true;

          return matchesPost && matchesUser;
        }) ?? null
      );
    }),
    save: jest.fn(async (like: PostLikeEntity) => {
      like.id = like.id ?? new MongoObjectId('665000000000000000000500');
      likes.push(like);
      return like;
    }),
    deleteOne: jest.fn(async (query: any = {}) => {
      const index = likes.findIndex(like => {
        const matchesPost = query.postId
          ? sameObjectId(like.postId, query.postId)
          : true;
        const matchesUser = query.userId
          ? sameObjectId(like.userId, query.userId)
          : true;

        return matchesPost && matchesUser;
      });

      if (index >= 0) {
        likes.splice(index, 1);
      }

      return { deletedCount: index >= 0 ? 1 : 0 };
    }),
  } as any;
  service.openAIService = {
    getDefaultModel: jest.fn(() => 'text-model'),
    getVisionModel: jest.fn(() => 'vision-model'),
    createVisionChatCompletion: jest.fn(),
    generateText: jest.fn(async () => ({
      content: '花开得真好看呢',
      reasoning: [],
      response: {},
    })),
  } as any;
  service.wechatPayService = {
    checkMessageContentSafety: jest.fn(async () => ({
      isSafe: true,
      suggest: 'pass',
      label: 100,
      response: {
        errcode: 0,
        result: {
          suggest: 'pass',
          label: 100,
        },
      },
    })),
  } as any;
  service.logger = {
    warn: jest.fn(),
    info: jest.fn(),
  } as any;

  return {
    service,
    savedPosts,
    addJobToQueue,
    posts,
    notifications,
    postNotifications,
    comments,
    likes,
  };
}

describe('PostService createPost remind agent fallback', () => {
  it('reminds the default agent when no remind target is provided', async () => {
    const defaultAgent = createAgent(AGENT_A_ID, { isDefault: true });
    const otherAgent = createAgent(AGENT_B_ID);
    const { service, savedPosts, addJobToQueue } = createService([
      defaultAgent,
      otherAgent,
    ]);

    const result = await service.createPost(AUTH, {
      content: '今天很好',
    });

    expect(result.remindAgentIds).toEqual([AGENT_A_ID]);
    expect(savedPosts[0].remindAgentIds).toEqual([AGENT_A_ID]);
    expect(addJobToQueue).toHaveBeenCalledWith(
      expect.objectContaining({
        postId: POST_ID,
        agentId: AGENT_A_ID,
      }),
      expect.any(Object)
    );
  });

  it('reminds the first updated agent when the user has no default agent', async () => {
    const olderAgent = createAgent(AGENT_A_ID, {
      updatedAt: new Date('2026-05-12T08:00:00.000Z'),
    });
    const newerAgent = createAgent(AGENT_B_ID, {
      updatedAt: new Date('2026-05-13T08:00:00.000Z'),
    });
    const { service, savedPosts } = createService([olderAgent, newerAgent]);

    const result = await service.createPost(AUTH, {
      content: '今天很好',
      remindAgentIds: [],
    });

    expect(result.remindAgentIds).toEqual([AGENT_B_ID]);
    expect(savedPosts[0].remindAgentIds).toEqual([AGENT_B_ID]);
  });

  it('does not remind any agent when the user has no agents', async () => {
    const { service, savedPosts, addJobToQueue } = createService([]);

    const result = await service.createPost(AUTH, {
      content: '今天很好',
    });

    expect(result.remindAgentIds).toEqual([]);
    expect(savedPosts[0].remindAgentIds).toEqual([]);
    expect(addJobToQueue).not.toHaveBeenCalled();
  });

  it('creates an unread notification when an agent replies to a post', async () => {
    const agent = createAgent(AGENT_A_ID);
    const post = createPost({
      remindAgentIds: [AGENT_A_ID],
      images: ['moments/flower.jpg'],
    });
    const { service, notifications } = createService([agent], {
      posts: [post],
    });

    await service.processRemindReplyJob({
      postId: POST_ID,
      agentId: AGENT_A_ID,
    });

    const summary = await service.getUnreadCommentNotificationSummary(AUTH);

    expect(notifications).toHaveLength(1);
    expect(summary.unreadCount).toBe(1);
    expect(summary.latest).toEqual(
      expect.objectContaining({
        actorName: '奶奶',
        commentPreview: '花开得真好看呢',
        isRead: false,
        postId: POST_ID,
      })
    );
  });
});

describe('PostService comment content safety', () => {
  it('checks user comments with WeChat msgSecCheck before saving', async () => {
    const post = createPost();
    const { service, comments } = createService([], {
      posts: [post],
    });

    const result = await service.createComment(AUTH, POST_ID, {
      content: '我也很想她',
    });

    expect(
      service.wechatPayService.checkMessageContentSafety
    ).toHaveBeenCalledWith({
      openid: 'openid-1',
      content: '我也很想她',
      scene: 2,
    });
    expect(comments).toHaveLength(1);
    expect(result.content).toBe('我也很想她');
  });

  it('rejects unsafe user comments without saving the comment', async () => {
    const post = createPost();
    const { service, comments } = createService([], {
      posts: [post],
    });

    (
      service.wechatPayService.checkMessageContentSafety as jest.Mock
    ).mockResolvedValue({
      isSafe: false,
      suggest: 'risky',
      label: 20001,
      response: {
        errcode: 0,
        result: {
          suggest: 'risky',
          label: 20001,
        },
      },
    });

    await expect(
      service.createComment(AUTH, POST_ID, {
        content: '违规评论',
      })
    ).rejects.toMatchObject({
      code: 'POST_COMMENT_CONTENT_UNSAFE',
      status: 400,
    });

    expect(comments).toHaveLength(0);
    expect(service.commentModel.save).not.toHaveBeenCalled();
  });

  it('falls back to Mongo _id when resolving the current weapp account', async () => {
    const post = createPost();
    const { service, comments } = createService([], {
      posts: [post],
    });
    const account = createUserAccount();

    service.userAccountModel.findOne = jest.fn(async ({ where }: any = {}) => {
      return where?._id && sameObjectId(account.id, where._id) ? account : null;
    });

    await service.createComment(AUTH, POST_ID, {
      content: '我也很想她',
    });

    expect(service.userAccountModel.findOne).toHaveBeenCalledWith({
      where: {
        id: new MongoObjectId(ACCOUNT_ID),
      },
    });
    expect(service.userAccountModel.findOne).toHaveBeenCalledWith({
      where: {
        _id: new MongoObjectId(ACCOUNT_ID),
      },
    });
    expect(service.wechatPayService.checkMessageContentSafety).toHaveBeenCalledWith(
      {
        openid: 'openid-1',
        content: '我也很想她',
        scene: 2,
      }
    );
    expect(comments).toHaveLength(1);
  });

  it('uses legacy weapp openid from the current auth payload', async () => {
    const post = createPost();
    const { service, comments } = createService([], {
      posts: [post],
      userAccounts: [
        createUserAccount({
          openId: '',
          account: 'weapp:abcdef123456',
        }),
      ],
    });

    await service.createComment(
      {
        ...AUTH,
        account: 'weapp:openid-from-token',
      },
      POST_ID,
      {
        content: '我也很想她',
      }
    );

    expect(service.wechatPayService.checkMessageContentSafety).toHaveBeenCalledWith(
      {
        openid: 'openid-from-token',
        content: '我也很想她',
        scene: 2,
      }
    );
    expect(comments).toHaveLength(1);
  });

  it('uses another weapp account openId from the current user', async () => {
    const post = createPost();
    const { service, comments } = createService([], {
      posts: [post],
      userAccounts: [
        createUserAccount({
          openId: '',
          account: 'weapp:abcdef123456',
        }),
        createUserAccount({
          id: new MongoObjectId('665000000000000000000601'),
          account: 'weapp:anotherhash',
          openId: 'openid-linked-account',
        }),
      ],
    });

    await service.createComment(AUTH, POST_ID, {
      content: '普通评论',
    });

    expect(service.userAccountModel.find).toHaveBeenCalledWith({
      where: {
        userId: new MongoObjectId(USER_ID),
      },
    });
    expect(service.wechatPayService.checkMessageContentSafety).toHaveBeenCalledWith(
      {
        openid: 'openid-linked-account',
        content: '普通评论',
        scene: 2,
      }
    );
    expect(comments).toHaveLength(1);
  });

  it('does not save comments when WeChat content safety is unavailable', async () => {
    const post = createPost();
    const { service, comments } = createService([], {
      posts: [post],
    });

    (
      service.wechatPayService.checkMessageContentSafety as jest.Mock
    ).mockRejectedValue(new Error('wechat network failed'));

    await expect(
      service.createComment(AUTH, POST_ID, {
        content: '普通评论',
      })
    ).rejects.toThrow('wechat network failed');

    expect(comments).toHaveLength(0);
    expect(service.commentModel.save).not.toHaveBeenCalled();
  });

  it('blocks legacy hashed weapp accounts without a recoverable openid', async () => {
    const post = createPost();
    const { service, comments } = createService([], {
      posts: [post],
      userAccounts: [
        createUserAccount({
          openId: '',
          account: 'weapp:abcdef123456',
        }),
      ],
    });

    await expect(
      service.createComment(AUTH, POST_ID, {
        content: '普通评论',
      })
    ).rejects.toMatchObject({
      code: 'POST_COMMENT_SECURITY_UNAVAILABLE',
      status: 503,
    });

    expect(
      service.wechatPayService.checkMessageContentSafety
    ).not.toHaveBeenCalled();
    expect(comments).toHaveLength(0);
  });
});

describe('PostService post pagination', () => {
  it('returns the first post page with hasMore', async () => {
    const posts = [
      createPost({
        id: new MongoObjectId(POST_ID),
        createdAt: new Date('2026-05-13T10:00:00.000Z'),
        updatedAt: new Date('2026-05-13T10:00:00.000Z'),
      }),
      createPost({
        id: new MongoObjectId(POST_2_ID),
        createdAt: new Date('2026-05-13T09:00:00.000Z'),
        updatedAt: new Date('2026-05-13T09:00:00.000Z'),
      }),
      createPost({
        id: new MongoObjectId(POST_3_ID),
        createdAt: new Date('2026-05-13T08:00:00.000Z'),
        updatedAt: new Date('2026-05-13T08:00:00.000Z'),
      }),
    ];
    const { service } = createService([], { posts });

    const result = await service.listPosts(AUTH, {
      page: 1,
      pageSize: 2,
    });

    expect(result.items.map(item => item.id)).toEqual([POST_ID, POST_2_ID]);
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(2);
    expect(result.hasMore).toBe(true);
  });

  it('returns later post pages and clamps page size', async () => {
    const posts = [
      createPost({
        id: new MongoObjectId(POST_ID),
        createdAt: new Date('2026-05-13T10:00:00.000Z'),
      }),
      createPost({
        id: new MongoObjectId(POST_2_ID),
        createdAt: new Date('2026-05-13T09:00:00.000Z'),
      }),
      createPost({
        id: new MongoObjectId(POST_3_ID),
        createdAt: new Date('2026-05-13T08:00:00.000Z'),
      }),
    ];
    const { service } = createService([], { posts });

    const result = await service.listPosts(AUTH, {
      page: '2',
      pageSize: '2',
    });
    const clamped = await service.listPosts(AUTH, {
      pageSize: '99',
    });

    expect(result.items.map(item => item.id)).toEqual([POST_3_ID]);
    expect(result.hasMore).toBe(false);
    expect(clamped.pageSize).toBe(20);
  });

  it('filters to the authenticated user when listing my posts', async () => {
    const posts = [
      createPost({
        id: new MongoObjectId('665000000000000000000110'),
        userId: new MongoObjectId(OTHER_USER_ID),
        createdAt: new Date('2026-05-13T12:00:00.000Z'),
      }),
      createPost({
        id: new MongoObjectId('665000000000000000000111'),
        userId: new MongoObjectId(OTHER_USER_ID),
        createdAt: new Date('2026-05-13T11:00:00.000Z'),
      }),
      createPost({
        id: new MongoObjectId(POST_ID),
        userId: new MongoObjectId(USER_ID),
        createdAt: new Date('2026-05-13T10:00:00.000Z'),
      }),
      createPost({
        id: new MongoObjectId(POST_2_ID),
        userId: new MongoObjectId(USER_ID),
        createdAt: new Date('2026-05-13T09:00:00.000Z'),
      }),
    ];
    const { service } = createService([], { posts });

    const result = await service.listPosts(AUTH, {
      page: 1,
      pageSize: 2,
      mine: '1',
    });

    expect(result.items.map(item => item.id)).toEqual([POST_ID, POST_2_ID]);
    expect(result.hasMore).toBe(false);
  });

  it('hides deleted and risk-controlled posts from public feed', async () => {
    const posts = [
      createPost({
        id: new MongoObjectId(POST_ID),
        createdAt: new Date('2026-05-13T10:00:00.000Z'),
      }),
      createPost({
        id: new MongoObjectId(POST_2_ID),
        moderationStatus: PostModerationStatus.riskControlled,
        createdAt: new Date('2026-05-13T09:00:00.000Z'),
      }),
      createPost({
        id: new MongoObjectId(POST_3_ID),
        isDeleted: true,
        createdAt: new Date('2026-05-13T08:00:00.000Z'),
      }),
    ];
    const { service } = createService([], { posts });

    const result = await service.listPosts(undefined, {
      page: 1,
      pageSize: 10,
    });

    expect(result.items.map(item => item.id)).toEqual([POST_ID]);
  });

  it('keeps risk-controlled posts visible in my posts with status', async () => {
    const posts = [
      createPost({
        id: new MongoObjectId(POST_ID),
        moderationStatus: PostModerationStatus.riskControlled,
        moderationReason: '疑似违规',
        createdAt: new Date('2026-05-13T10:00:00.000Z'),
      }),
      createPost({
        id: new MongoObjectId(POST_2_ID),
        isDeleted: true,
        createdAt: new Date('2026-05-13T09:00:00.000Z'),
      }),
    ];
    const { service } = createService([], { posts });

    const result = await service.listPosts(AUTH, {
      mine: '1',
      page: 1,
      pageSize: 10,
    });

    expect(result.items).toEqual([
      expect.objectContaining({
        id: POST_ID,
        moderationStatus: PostModerationStatus.riskControlled,
        moderationReason: '疑似违规',
        isRiskControlled: true,
      }),
    ]);
  });

  it('soft deletes a post only for its owner', async () => {
    const post = createPost();
    const { service } = createService([], { posts: [post] });

    await expect(service.deletePost(OTHER_AUTH, POST_ID)).rejects.toMatchObject(
      {
        code: 'POST_NOT_FOUND',
        status: 404,
      }
    );

    const result = await service.deletePost(AUTH, POST_ID);

    expect(result).toEqual({
      id: POST_ID,
      deleted: true,
    });
    expect(post.isDeleted).toBe(true);
    expect(post.deletedAt).toBeInstanceOf(Date);
    expect(post.deletedByUserId).toEqual(new MongoObjectId(USER_ID));
    expect(service.postModel.save).toHaveBeenCalledWith(post);
  });

  it('allows only the owner to view a risk-controlled post detail', async () => {
    const post = createPost({
      moderationStatus: PostModerationStatus.riskControlled,
    });
    const { service } = createService([], { posts: [post] });

    await expect(
      service.getPostDetail(POST_ID, OTHER_AUTH)
    ).rejects.toMatchObject({
      code: 'POST_NOT_FOUND',
      status: 404,
    });

    const result = await service.getPostDetail(POST_ID, AUTH);

    expect(result).toEqual(
      expect.objectContaining({
        id: POST_ID,
        isRiskControlled: true,
      })
    );
  });
});

describe('PostService comment notification reads', () => {
  it('counts all unread notifications and returns the latest unread item', async () => {
    const notifications = [
      createNotification({
        id: new MongoObjectId(NOTIFICATION_ID),
        createdAt: new Date('2026-05-13T08:00:00.000Z'),
      }),
      createNotification({
        id: new MongoObjectId('665000000000000000000301'),
        commentId: new MongoObjectId('665000000000000000000201'),
        createdAt: new Date('2026-05-13T09:00:00.000Z'),
        commentPreview: '最新的一条',
      }),
      createNotification({
        id: new MongoObjectId('665000000000000000000302'),
        commentId: new MongoObjectId('665000000000000000000202'),
        createdAt: new Date('2026-05-13T10:00:00.000Z'),
        isRead: true,
      }),
    ];
    const { service } = createService([], { notifications });

    const result = await service.getUnreadCommentNotificationSummary(AUTH);

    expect(result.unreadCount).toBe(2);
    expect(result.latest?.commentPreview).toBe('最新的一条');
    expect(result.latest?.postThumbnail).toBe(
      'https://cdn.example.com/moments/flower.jpg'
    );
    expect(result.latest?.replyToUserName).toBe('柠檬');
  });

  it('lists all notifications by created time without marking read', async () => {
    const oldestUnread = createNotification({
      id: new MongoObjectId(NOTIFICATION_ID),
      createdAt: new Date('2026-05-13T08:00:00.000Z'),
      commentPreview: '较早未读',
    });
    const latestRead = createNotification({
      id: new MongoObjectId('665000000000000000000301'),
      commentId: new MongoObjectId('665000000000000000000201'),
      createdAt: new Date('2026-05-13T10:00:00.000Z'),
      commentPreview: '最新已读',
      isRead: true,
    });
    const notifications = [oldestUnread, latestRead];
    const { service } = createService([], { notifications });

    const result = await service.listCommentNotifications(AUTH, {
      page: 1,
      pageSize: 1,
    });
    const next = await service.listCommentNotifications(AUTH, {
      page: 2,
      pageSize: 1,
    });
    const clamped = await service.listCommentNotifications(AUTH, {
      pageSize: 99,
    });

    expect(result.items.map(item => item.commentPreview)).toEqual(['最新已读']);
    expect(result.hasMore).toBe(true);
    expect(next.items.map(item => item.commentPreview)).toEqual(['较早未读']);
    expect(next.hasMore).toBe(false);
    expect(clamped.pageSize).toBe(50);
    expect(oldestUnread.isRead).toBe(false);
    expect(latestRead.isRead).toBe(true);
  });

  it('returns unread notification snapshot before marking all as read', async () => {
    const unread = createNotification();
    const unreadLater = createNotification({
      id: new MongoObjectId('665000000000000000000301'),
      commentId: new MongoObjectId('665000000000000000000201'),
      createdAt: new Date('2026-05-13T09:00:00.000Z'),
      commentPreview: '后来的评论',
    });
    const notifications = [unread, unreadLater];
    const { service } = createService([], { notifications });

    const result = await service.readUnreadCommentNotifications(AUTH);

    expect(result.items.map(item => item.commentPreview)).toEqual([
      '后来的评论',
      '我也好想她！',
    ]);
    expect(result.readCount).toBe(2);
    expect(result.unreadCount).toBe(0);
    expect(unread.isRead).toBe(true);
    expect(unreadLater.isRead).toBe(true);
    expect(unread.readAt).toBeInstanceOf(Date);
    expect(unread.updatedAt).toBe(unread.readAt);
    expect(service.commentNotificationModel.save).toHaveBeenCalledWith(
      expect.arrayContaining([unread, unreadLater])
    );
  });
});

describe('PostService post notifications', () => {
  it('creates a like notification for the post owner without touching comment notifications', async () => {
    const post = createPost({
      userId: new MongoObjectId(OTHER_USER_ID),
      images: ['moments/flower.jpg'],
    });
    const { service, postNotifications, notifications } = createService([], {
      posts: [post],
    });

    await service.likePost(AUTH, POST_ID);

    expect(notifications).toHaveLength(0);
    expect(postNotifications).toHaveLength(1);
    expect(postNotifications[0]).toEqual(
      expect.objectContaining({
        userId: new MongoObjectId(OTHER_USER_ID),
        postId: new MongoObjectId(POST_ID),
        type: PostNotificationType.like,
        actorUserId: new MongoObjectId(USER_ID),
        actorName: '用户',
        contentPreview: '与你的动态产生了共鸣',
        isRead: false,
      })
    );

    const summary = await service.getUnreadPostNotificationSummary(OTHER_AUTH);
    expect(summary.unreadCount).toBe(1);
    expect(summary.latest).toEqual(
      expect.objectContaining({
        type: PostNotificationType.like,
        actorName: '用户',
        contentPreview: '与你的动态产生了共鸣',
        postThumbnail: 'https://cdn.example.com/moments/flower.jpg',
      })
    );
  });

  it('does not create a like notification when the owner likes their own post', async () => {
    const post = createPost();
    const { service, postNotifications } = createService([], {
      posts: [post],
    });

    await service.likePost(AUTH, POST_ID);

    expect(postNotifications).toHaveLength(0);
  });

  it('removes the like notification when a user cancels resonance', async () => {
    const post = createPost({
      userId: new MongoObjectId(OTHER_USER_ID),
    });
    const like = new PostLikeEntity();
    Object.assign(like, {
      id: new MongoObjectId('665000000000000000000500'),
      postId: new MongoObjectId(POST_ID),
      userId: new MongoObjectId(USER_ID),
      createdAt: NOW,
      updatedAt: NOW,
    });
    const likeNotification = createPostNotification({
      type: PostNotificationType.like,
      userId: new MongoObjectId(OTHER_USER_ID),
      actorUserId: new MongoObjectId(USER_ID),
      contentPreview: '与你的动态产生了共鸣',
    });
    const { service, postNotifications } = createService([], {
      posts: [post],
      likes: [like],
      postNotifications: [likeNotification],
    });

    await service.unlikePost(AUTH, POST_ID);

    expect(postNotifications).toHaveLength(0);
  });

  it('writes comment replies to both legacy comment notifications and post notifications', async () => {
    const agent = createAgent(AGENT_A_ID);
    const post = createPost({
      remindAgentIds: [AGENT_A_ID],
      images: ['moments/flower.jpg'],
    });
    const { service, notifications, postNotifications } = createService([agent], {
      posts: [post],
    });

    await service.processRemindReplyJob({
      postId: POST_ID,
      agentId: AGENT_A_ID,
    });

    expect(notifications).toHaveLength(1);
    expect(postNotifications).toHaveLength(1);
    expect(postNotifications[0]).toEqual(
      expect.objectContaining({
        type: PostNotificationType.comment,
        commentType: PostCommentType.agent,
        actorName: '奶奶',
        contentPreview: '花开得真好看呢',
        isRead: false,
      })
    );
  });

  it('returns unread post notification snapshots before marking them as read', async () => {
    const commentNotification = createPostNotification({
      id: new MongoObjectId(POST_NOTIFICATION_ID),
      type: PostNotificationType.comment,
      createdAt: new Date('2026-05-13T08:00:00.000Z'),
      contentPreview: '较早的评论',
    });
    const likeNotification = createPostNotification({
      id: new MongoObjectId('665000000000000000000401'),
      type: PostNotificationType.like,
      commentId: undefined,
      commentType: undefined,
      createdAt: new Date('2026-05-13T09:00:00.000Z'),
      contentPreview: '与你的动态产生了共鸣',
    });
    const { service } = createService([], {
      postNotifications: [commentNotification, likeNotification],
    });

    const result = await service.readUnreadPostNotifications(AUTH);

    expect(result.items.map(item => item.contentPreview)).toEqual([
      '与你的动态产生了共鸣',
      '较早的评论',
    ]);
    expect(result.readCount).toBe(2);
    expect(result.unreadCount).toBe(0);
    expect(commentNotification.isRead).toBe(true);
    expect(likeNotification.isRead).toBe(true);
    expect(commentNotification.readAt).toBeInstanceOf(Date);
  });

  it('keeps legacy comment notifications visible through the new post notification API', async () => {
    const legacyComment = createNotification({
      id: new MongoObjectId(NOTIFICATION_ID),
      commentId: new MongoObjectId(COMMENT_ID),
      commentPreview: '旧版评论通知',
      createdAt: new Date('2026-05-13T09:00:00.000Z'),
    });
    const legacyOnlyComment = createNotification({
      id: new MongoObjectId('665000000000000000000301'),
      commentId: new MongoObjectId('665000000000000000000201'),
      commentPreview: '仅旧集合存在的评论',
      createdAt: new Date('2026-05-13T08:00:00.000Z'),
    });
    const duplicatePostComment = createPostNotification({
      id: new MongoObjectId(POST_NOTIFICATION_ID),
      commentId: new MongoObjectId(COMMENT_ID),
      contentPreview: '新版评论通知',
      createdAt: new Date('2026-05-13T09:00:00.000Z'),
    });
    const likeNotification = createPostNotification({
      id: new MongoObjectId('665000000000000000000401'),
      type: PostNotificationType.like,
      commentId: undefined,
      commentType: undefined,
      contentPreview: '与你的动态产生了共鸣',
      createdAt: new Date('2026-05-13T10:00:00.000Z'),
    });
    const { service } = createService([], {
      notifications: [legacyComment, legacyOnlyComment],
      postNotifications: [duplicatePostComment, likeNotification],
    });

    const result = await service.listPostNotifications(AUTH);

    expect(result.items.map(item => item.contentPreview)).toEqual([
      '与你的动态产生了共鸣',
      '新版评论通知',
      '仅旧集合存在的评论',
    ]);
    expect(result.items).toHaveLength(3);
  });
});

describe('PostService moment image summaries', () => {
  it('adds successful image summaries to the moment prompt and filters failed images', async () => {
    const agent = createAgent(AGENT_A_ID);
    const user = createUser();
    const post = createPost({
      images: ['moments/flower.jpg', 'moments/broken.jpg'],
    });
    const { service } = createService([agent]);
    const createVisionChatCompletion = service.openAIService
      .createVisionChatCompletion as jest.Mock;
    const generateText = service.openAIService.generateText as jest.Mock;

    createVisionChatCompletion
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: '画面里有盛开的花和公园步道，氛围轻松明亮。',
            },
          },
        ],
      })
      .mockRejectedValueOnce(new Error('vision failed'));

    const reply = await (service as any).generateAgentPostReply(
      post,
      user,
      agent
    );

    expect(reply).toBe('花开得真好看呢');
    expect(createVisionChatCompletion).toHaveBeenCalledTimes(2);
    expect(generateText).toHaveBeenCalledTimes(1);

    const visionSystemPrompt = createVisionChatCompletion.mock.calls[0][0]
      .messages[0].content as string;
    expect(visionSystemPrompt).toContain('浅层理解助手');
    expect(visionSystemPrompt).toContain('不要推断或猜测人物身份');
    expect(visionSystemPrompt).toContain('照片里的人不一定是发布用户本人');
    expect(visionSystemPrompt).toContain('亲属关系');
    expect(visionSystemPrompt).toContain(
      '不要把图片中的地点、人物或动物扩写成“某人现在在哪里、正在和谁做什么”的事实'
    );
    expect(visionSystemPrompt).toContain('逝去后的状态');

    const systemPrompt = generateText.mock.calls[0][0].systemPrompt as string;
    expect(systemPrompt).toContain('浅层视觉摘要');
    expect(systemPrompt).toContain('不要根据图片推断');
    expect(systemPrompt).toContain('这是用户本人');
    expect(systemPrompt).toContain('事实边界优先级高于口语化和亲密感');
    expect(systemPrompt).toContain('不要把逝去后的“现在”写成具体生活现场');
    expect(systemPrompt).toContain('禁止输出“我和爸在后院玩”');
    expect(systemPrompt).toContain(
      '画面里有盛开的花和公园步道，氛围轻松明亮。'
    );
    expect(systemPrompt).not.toContain('vision failed');
  });
});
