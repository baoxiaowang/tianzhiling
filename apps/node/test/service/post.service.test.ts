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
  UserMembershipEntity,
  UserMembershipStatus,
} from '@tzl/entities';
import {
  POST_COMMENT_AGENT_REPLY_QUEUE,
  PostService,
} from '../../src/service/post.service';

const USER_ID = '665000000000000000000001';
const OTHER_USER_ID = '665000000000000000000002';
const AGENT_A_ID = '665000000000000000000010';
const AGENT_B_ID = '665000000000000000000011';
const POST_ID = '665000000000000000000100';
const POST_2_ID = '665000000000000000000101';
const POST_3_ID = '665000000000000000000102';
const COMMENT_ID = '665000000000000000000200';
const AGENT_COMMENT_ID = '665000000000000000000201';
const USER_REPLY_COMMENT_ID = '665000000000000000000202';
const NOTIFICATION_ID = '665000000000000000000300';
const POST_NOTIFICATION_ID = '665000000000000000000400';
const ACCOUNT_ID = '665000000000000000000600';
const MEMBERSHIP_ID = '665000000000000000000700';
const VIP_PLAN_ID = '665000000000000000000701';
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

function createUser(overrides: Partial<UserEntity> = {}): UserEntity {
  const user = new UserEntity();

  Object.assign(user, {
    id: new MongoObjectId(USER_ID),
    name: '用户',
    avatar: '',
    ...overrides,
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

function createPostCommentEntity(
  overrides: Partial<PostCommentEntity> = {}
): PostCommentEntity {
  const comment = new PostCommentEntity();

  Object.assign(comment, {
    id: new MongoObjectId(COMMENT_ID),
    postId: new MongoObjectId(POST_ID),
    userId: new MongoObjectId(USER_ID),
    type: PostCommentType.user,
    content: '我也很想她',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  });

  return comment;
}

function createMembership(
  overrides: Partial<UserMembershipEntity> = {}
): UserMembershipEntity {
  const membership = new UserMembershipEntity();

  Object.assign(membership, {
    id: new MongoObjectId(MEMBERSHIP_ID),
    userId: new MongoObjectId(USER_ID),
    vipPlanId: new MongoObjectId(VIP_PLAN_ID),
    vipPlanCode: 'vip_month',
    sourceOrderId: new MongoObjectId('665000000000000000000702'),
    status: UserMembershipStatus.active,
    startedAt: new Date('2026-05-01T08:00:00.000Z'),
    expiredAt: new Date('2099-05-01T08:00:00.000Z'),
    lifetime: false,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  });

  return membership;
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
    isSeen: false,
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
    isSeen: false,
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
    memberships?: UserMembershipEntity[];
    users?: UserEntity[];
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
  const memberships = options.memberships ?? [];
  const users = options.users ?? [createUser()];
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

      if (Array.isArray(where?._id?.$in)) {
        result = result.filter(post =>
          where._id.$in.some((id: MongoObjectId) => sameObjectId(post.id, id))
        );
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
    count: jest.fn(async ({ userId, isDeleted, createdAt }: any = {}) => {
      let result = [...posts];

      if (userId) {
        result = result.filter(post => sameObjectId(post.userId, userId));
      }

      if (isDeleted?.$ne === true) {
        result = result.filter(post => post.isDeleted !== true);
      }

      if (createdAt?.$gte) {
        result = result.filter(
          post => post.createdAt.getTime() >= createdAt.$gte.getTime()
        );
      }

      if (createdAt?.$lt) {
        result = result.filter(
          post => post.createdAt.getTime() < createdAt.$lt.getTime()
        );
      }

      if (createdAt?.$lte) {
        result = result.filter(
          post => post.createdAt.getTime() <= createdAt.$lte.getTime()
        );
      }

      return result.length;
    }),
  } as any;
  service.userModel = {
    findOne: jest.fn(
      async ({ where }: any) =>
        users.find(user => sameObjectId(user.id, where?.id ?? where?._id)) ??
        null
    ),
    save: jest.fn(async (user: UserEntity) => user),
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
  service.userMembershipModel = {
    find: jest.fn(async ({ where }: any = {}) => {
      return memberships.filter(membership => {
        const matchesUser = where?.userId
          ? sameObjectId(membership.userId, where.userId)
          : true;
        const matchesStatus =
          where?.status === undefined || membership.status === where.status;

        return matchesUser && matchesStatus;
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
        const id = where?.id ?? where?._id;
        const matchesId = id ? sameObjectId(comment.id, id) : true;
        const matchesPost = where?.postId
          ? Array.isArray(where.postId.$in)
            ? where.postId.$in.some((id: MongoObjectId) =>
                sameObjectId(comment.postId, id)
              )
            : sameObjectId(comment.postId, where.postId)
          : true;
        const matchesAgent = where?.agentId
          ? sameObjectId(comment.agentId, where.agentId)
          : true;
        const matchesParent = where?.parentCommentId
          ? sameObjectId(comment.parentCommentId, where.parentCommentId)
          : true;

        return matchesId && matchesPost && matchesAgent && matchesParent;
      });
    }),
    findOne: jest.fn(async ({ where }: any = {}) => {
      return (
        comments.find(comment => {
          const id = where?.id ?? where?._id;
          const matchesId = id ? sameObjectId(comment.id, id) : true;
          const matchesPost = where?.postId
            ? sameObjectId(comment.postId, where.postId)
            : true;
          const matchesAgent = where?.agentId
            ? sameObjectId(comment.agentId, where.agentId)
            : true;
          const matchesParent = where?.parentCommentId
            ? sameObjectId(comment.parentCommentId, where.parentCommentId)
            : true;

          return matchesId && matchesPost && matchesAgent && matchesParent;
        }) ?? null
      );
    }),
    save: jest.fn(async (comment: PostCommentEntity) => {
      if (!comment.id) {
        const nextCommentId =
          comments.length === 0
            ? COMMENT_ID
            : `665000000000000000000${String(800 + comments.length).padStart(
                3,
                '0'
              )}`;

        comment.id = new MongoObjectId(nextCommentId);
      }
      comments.push(comment);
      return comment;
    }),
    deleteOne: jest.fn(async (query: any = {}) => {
      const index = comments.findIndex(comment => {
        const id = query.id ?? query._id;
        return id ? sameObjectId(comment.id, id) : false;
      });

      if (index >= 0) {
        comments.splice(index, 1);
      }

      return { deletedCount: index >= 0 ? 1 : 0 };
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
        const matchesComment = where?.commentId
          ? sameObjectId(notification.commentId, where.commentId)
          : true;
        const matchesCreatedAt = where?.createdAt?.$gt
          ? notification.createdAt > where.createdAt.$gt
          : true;

        return (
          matchesUser &&
          matchesRead &&
          matchesPost &&
          matchesComment &&
          matchesCreatedAt
        );
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
    findOne: jest.fn(async ({ where }: any = {}) => {
      return (
        notifications.find(notification => {
          const id = where?.id ?? where?._id;
          const matchesId = id ? sameObjectId(notification.id, id) : true;
          const matchesUser = where?.userId
            ? sameObjectId(notification.userId, where.userId)
            : true;

          return matchesId && matchesUser;
        }) ?? null
      );
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
    deleteOne: jest.fn(async (query: any = {}) => {
      const index = notifications.findIndex(notification => {
        const id = query.id ?? query._id;
        const matchesId = id ? sameObjectId(notification.id, id) : true;
        const matchesPost = query.postId
          ? sameObjectId(notification.postId, query.postId)
          : true;
        const matchesComment = query.commentId
          ? sameObjectId(notification.commentId, query.commentId)
          : true;

        return matchesId && matchesPost && matchesComment;
      });

      if (index >= 0) {
        notifications.splice(index, 1);
      }

      return { deletedCount: index >= 0 ? 1 : 0 };
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
        const matchesComment = where?.commentId
          ? sameObjectId(notification.commentId, where.commentId)
          : true;
        const matchesType =
          where?.type === undefined || notification.type === where.type;
        const matchesCreatedAt = where?.createdAt?.$gt
          ? notification.createdAt > where.createdAt.$gt
          : true;

        return (
          matchesUser &&
          matchesRead &&
          matchesPost &&
          matchesComment &&
          matchesType &&
          matchesCreatedAt
        );
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
    findOne: jest.fn(async ({ where }: any = {}) => {
      return (
        postNotifications.find(notification => {
          const id = where?.id ?? where?._id;
          const matchesId = id ? sameObjectId(notification.id, id) : true;
          const matchesUser = where?.userId
            ? sameObjectId(notification.userId, where.userId)
            : true;

          return matchesId && matchesUser;
        }) ?? null
      );
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
        const id = query.id ?? query._id;
        const matchesId = id ? sameObjectId(notification.id, id) : true;
        const matchesPost = query.postId
          ? sameObjectId(notification.postId, query.postId)
          : true;
        const matchesActor = query.actorUserId
          ? sameObjectId(notification.actorUserId, query.actorUserId)
          : true;
        const matchesComment = query.commentId
          ? sameObjectId(notification.commentId, query.commentId)
          : true;
        const matchesType =
          query.type === undefined || notification.type === query.type;

        return (
          matchesId &&
          matchesPost &&
          matchesActor &&
          matchesComment &&
          matchesType
        );
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

  it('blocks post creation when the user is risk controlled', async () => {
    const riskControlledUser = createUser({
      riskControlUntilAt: new Date('2099-01-01T00:00:00.000Z'),
    });
    const { service, savedPosts, addJobToQueue } = createService([], {
      users: [riskControlledUser],
    });

    await expect(
      service.createPost(AUTH, {
        content: '今天很好',
      })
    ).rejects.toMatchObject({
      code: 'USER_RISK_CONTROLLED',
      status: 403,
      data: {
        riskControlUntilAt: '2099-01-01T00:00:00.000Z',
      },
    });

    expect(savedPosts).toHaveLength(0);
    expect(service.postModel.save).not.toHaveBeenCalled();
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

describe('PostService auto reply daily limit', () => {
  function createTodayPost(id: string, createdAt: string): PostEntity {
    return createPost({
      id: new MongoObjectId(id),
      createdAt: new Date(createdAt),
      updatedAt: new Date(createdAt),
      remindAgentIds: [AGENT_A_ID],
    });
  }

  it('skips the agent auto reply for the fourth non-vip post of the day', async () => {
    jest.useFakeTimers().setSystemTime(NOW);
    try {
      const agent = createAgent(AGENT_A_ID);
      const existing = [
        createTodayPost(POST_2_ID, '2026-05-13T01:00:00.000Z'),
        createTodayPost(POST_3_ID, '2026-05-13T02:00:00.000Z'),
        createTodayPost('665000000000000000000103', '2026-05-13T03:00:00.000Z'),
      ];
      const post = createPost({ remindAgentIds: [AGENT_A_ID] });
      const { service, comments } = createService([agent], {
        posts: [post, ...existing],
      });

      await service.processRemindReplyJob({
        postId: POST_ID,
        agentId: AGENT_A_ID,
      });

      expect(comments).toHaveLength(0);
      expect(service.openAIService.generateText).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('still replies for the third non-vip post of the day', async () => {
    jest.useFakeTimers().setSystemTime(NOW);
    try {
      const agent = createAgent(AGENT_A_ID);
      const existing = [
        createTodayPost(POST_2_ID, '2026-05-13T01:00:00.000Z'),
        createTodayPost(POST_3_ID, '2026-05-13T02:00:00.000Z'),
      ];
      const post = createPost({ remindAgentIds: [AGENT_A_ID] });
      const { service, comments } = createService([agent], {
        posts: [post, ...existing],
      });

      await service.processRemindReplyJob({
        postId: POST_ID,
        agentId: AGENT_A_ID,
      });

      expect(comments.length).toBeGreaterThan(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('keeps replying for vip users beyond the non-vip daily limit', async () => {
    jest.useFakeTimers().setSystemTime(NOW);
    try {
      const agent = createAgent(AGENT_A_ID);
      const membership = createMembership();
      const existing = [
        createTodayPost(POST_2_ID, '2026-05-13T01:00:00.000Z'),
        createTodayPost(POST_3_ID, '2026-05-13T02:00:00.000Z'),
        createTodayPost('665000000000000000000103', '2026-05-13T03:00:00.000Z'),
      ];
      const post = createPost({ remindAgentIds: [AGENT_A_ID] });
      const { service, comments } = createService([agent], {
        posts: [post, ...existing],
        memberships: [membership],
      });

      await service.processRemindReplyJob({
        postId: POST_ID,
        agentId: AGENT_A_ID,
      });

      expect(comments.length).toBeGreaterThan(0);
    } finally {
      jest.useRealTimers();
    }
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
    expect(
      service.wechatPayService.checkMessageContentSafety
    ).toHaveBeenCalledWith({
      openid: 'openid-1',
      content: '我也很想她',
      scene: 2,
    });
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

    expect(
      service.wechatPayService.checkMessageContentSafety
    ).toHaveBeenCalledWith({
      openid: 'openid-from-token',
      content: '我也很想她',
      scene: 2,
    });
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
    expect(
      service.wechatPayService.checkMessageContentSafety
    ).toHaveBeenCalledWith({
      openid: 'openid-linked-account',
      content: '普通评论',
      scene: 2,
    });
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

describe('PostService agent comment follow-up replies', () => {
  function createAgentComment(agent: AgentEntity) {
    return createPostCommentEntity({
      id: new MongoObjectId(AGENT_COMMENT_ID),
      userId: undefined,
      agentId: agent.id,
      type: PostCommentType.agent,
      content: '花开得真好看呢',
    });
  }

  function createUserReplyToAgent(agent: AgentEntity) {
    return createPostCommentEntity({
      id: new MongoObjectId(USER_REPLY_COMMENT_ID),
      parentCommentId: new MongoObjectId(AGENT_COMMENT_ID),
      replyToAgentId: agent.id,
      content: '奶奶你听得到吗',
      createdAt: new Date('2026-05-13T08:01:00.000Z'),
      updatedAt: new Date('2026-05-13T08:01:00.000Z'),
    });
  }

  it('does not enqueue follow-up replies for non-vip or expired users', async () => {
    const agent = createAgent(AGENT_A_ID);
    const post = createPost();
    const expiredMembership = createMembership({
      expiredAt: new Date('2000-01-01T00:00:00.000Z'),
    });
    const nonVip = createService([agent], {
      posts: [post],
      comments: [createAgentComment(agent)],
    });
    const expiredVip = createService([agent], {
      posts: [post],
      comments: [createAgentComment(agent)],
      memberships: [expiredMembership],
    });

    await nonVip.service.createComment(AUTH, POST_ID, {
      content: '奶奶你听得到吗',
      replyToCommentId: AGENT_COMMENT_ID,
    });
    await expiredVip.service.createComment(AUTH, POST_ID, {
      content: '奶奶你听得到吗',
      replyToCommentId: AGENT_COMMENT_ID,
    });

    expect(nonVip.addJobToQueue).not.toHaveBeenCalled();
    expect(expiredVip.addJobToQueue).not.toHaveBeenCalled();
  });

  it('enqueues a follow-up reply for active vip users replying to an agent', async () => {
    const agent = createAgent(AGENT_A_ID);
    const post = createPost();
    const { service, addJobToQueue } = createService([agent], {
      posts: [post],
      comments: [createAgentComment(agent)],
      memberships: [createMembership({ lifetime: true, expiredAt: undefined })],
    });

    const result = await service.createComment(AUTH, POST_ID, {
      content: '奶奶你听得到吗',
      replyToCommentId: AGENT_COMMENT_ID,
    });

    expect(service.bullmqFramework.getQueue).toHaveBeenCalledWith(
      POST_COMMENT_AGENT_REPLY_QUEUE
    );
    expect(addJobToQueue).toHaveBeenCalledWith(
      {
        postId: POST_ID,
        agentId: AGENT_A_ID,
        triggerCommentId: result.id,
      },
      expect.objectContaining({
        jobId: `post:${POST_ID}:agent:${AGENT_A_ID}:comment:${result.id}`,
      })
    );
  });

  it('does not enqueue when users reply to a user comment', async () => {
    const agent = createAgent(AGENT_A_ID);
    const userReplyToAgent = createUserReplyToAgent(agent);
    const { service, addJobToQueue } = createService([agent], {
      posts: [createPost()],
      comments: [createAgentComment(agent), userReplyToAgent],
      memberships: [createMembership({ lifetime: true, expiredAt: undefined })],
    });

    await service.createComment(AUTH, POST_ID, {
      content: '我也这样想',
      replyToCommentId: USER_REPLY_COMMENT_ID,
    });

    expect(addJobToQueue).not.toHaveBeenCalled();
  });

  it('creates an agent follow-up comment for a valid trigger comment', async () => {
    const agent = createAgent(AGENT_A_ID);
    const agentComment = createAgentComment(agent);
    const userReply = createUserReplyToAgent(agent);
    const { service, comments, notifications } = createService([agent], {
      posts: [createPost()],
      comments: [agentComment, userReply],
      memberships: [createMembership({ lifetime: true, expiredAt: undefined })],
    });
    (service.openAIService.generateText as jest.Mock).mockResolvedValueOnce({
      content: '我在呢，慢慢说',
      reasoning: [],
      response: {},
    });

    await service.processRemindReplyJob({
      postId: POST_ID,
      agentId: AGENT_A_ID,
      triggerCommentId: USER_REPLY_COMMENT_ID,
    });

    const savedReply = comments[2];
    expect(savedReply).toEqual(
      expect.objectContaining({
        postId: new MongoObjectId(POST_ID),
        agentId: new MongoObjectId(AGENT_A_ID),
        type: PostCommentType.agent,
        content: '我在呢，慢慢说',
        parentCommentId: new MongoObjectId(USER_REPLY_COMMENT_ID),
        replyToUserId: new MongoObjectId(USER_ID),
      })
    );
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toEqual(
      expect.objectContaining({
        actorName: '奶奶',
        commentPreview: '我在呢，慢慢说',
      })
    );
  });

  it('does not duplicate an agent follow-up for the same trigger comment', async () => {
    const agent = createAgent(AGENT_A_ID);
    const userReply = createUserReplyToAgent(agent);
    const existingReply = createPostCommentEntity({
      id: new MongoObjectId('665000000000000000000203'),
      userId: undefined,
      agentId: agent.id,
      type: PostCommentType.agent,
      parentCommentId: userReply.id,
      replyToUserId: userReply.userId,
      content: '我听着呢',
    });
    const { service, comments } = createService([agent], {
      posts: [createPost()],
      comments: [createAgentComment(agent), userReply, existingReply],
      memberships: [createMembership({ lifetime: true, expiredAt: undefined })],
    });

    await service.processRemindReplyJob({
      postId: POST_ID,
      agentId: AGENT_A_ID,
      triggerCommentId: USER_REPLY_COMMENT_ID,
    });

    expect(comments).toHaveLength(3);
    expect(service.openAIService.generateText).not.toHaveBeenCalled();
  });

  it('skips invalid follow-up triggers and hidden posts', async () => {
    const agent = createAgent(AGENT_A_ID, {
      createdUserId: new MongoObjectId(OTHER_USER_ID),
    });
    const userReply = createUserReplyToAgent(agent);
    const unauthorized = createService([agent], {
      posts: [createPost()],
      comments: [userReply],
      memberships: [createMembership({ lifetime: true, expiredAt: undefined })],
    });
    const hidden = createService([createAgent(AGENT_A_ID)], {
      posts: [createPost({ isDeleted: true })],
      comments: [userReply],
      memberships: [createMembership({ lifetime: true, expiredAt: undefined })],
    });

    await unauthorized.service.processRemindReplyJob({
      postId: POST_ID,
      agentId: AGENT_A_ID,
      triggerCommentId: USER_REPLY_COMMENT_ID,
    });
    await hidden.service.processRemindReplyJob({
      postId: POST_ID,
      agentId: AGENT_A_ID,
      triggerCommentId: USER_REPLY_COMMENT_ID,
    });

    expect(unauthorized.comments).toHaveLength(1);
    expect(hidden.comments).toHaveLength(1);
  });

  it('uses the trigger comment as latest user comment in the prompt context', async () => {
    const agent = createAgent(AGENT_A_ID);
    const user = createUser();
    const laterUserComment = createPostCommentEntity({
      id: new MongoObjectId('665000000000000000000204'),
      content: '后来的普通评论',
      createdAt: new Date('2026-05-13T08:02:00.000Z'),
      updatedAt: new Date('2026-05-13T08:02:00.000Z'),
    });
    const { service } = createService([agent], {
      comments: [
        createAgentComment(agent),
        createUserReplyToAgent(agent),
        laterUserComment,
      ],
    });

    await (service as any).generateAgentPostReply(
      createPost(),
      user,
      agent,
      new MongoObjectId(USER_REPLY_COMMENT_ID)
    );

    const systemPrompt = (service.openAIService.generateText as jest.Mock).mock
      .calls[0][0].systemPrompt as string;
    const contextJson = systemPrompt.match(/```json\n([\s\S]*?)\n```/)?.[1];
    const context = JSON.parse(contextJson ?? '{}');

    expect(context.latestUserComment.id).toBe(USER_REPLY_COMMENT_ID);
    expect(context.latestUserComment.content).toBe('奶奶你听得到吗');
    expect(context.userRepliedComment.id).toBe(AGENT_COMMENT_ID);
  });

  it('answers a direct current-activity question from the dynamic post', async () => {
    const agent = createAgent(AGENT_A_ID, {
      name: '爸爸',
      iCallAgent: '爸爸',
      agentCallMe: '儿子',
      sex: AgentSex.man,
    });
    const post = createPost({
      content: '你现在在干嘛？',
    });
    const { service } = createService([agent]);
    (service.openAIService.generateText as jest.Mock).mockResolvedValueOnce({
      content: '儿子，这么晚了还不睡啊？',
      reasoning: [],
      response: {},
    });

    const reply = await (service as any).generateAgentPostReply(
      post,
      createUser(),
      agent
    );

    expect(reply).toBe('儿子，没忙什么，正回你呢。');
    const request = (service.openAIService.generateText as jest.Mock).mock
      .calls[0][0];
    expect(request.systemPrompt).toContain('正文有明确问题时必须直接回答');
    expect(request.prompt).toBe('请直接输出一条动态评论正文。');
  });

  it('replaces a moment reply that fixes the agent in heaven and claims real-world viewing', async () => {
    const agent = createAgent(AGENT_A_ID, {
      name: '爸爸',
      iCallAgent: '爸爸',
      agentCallMe: '儿子',
      sex: AgentSex.man,
    });
    const post = createPost({
      content: '爸爸，我想你了',
    });
    const { service } = createService([agent]);
    (service.openAIService.generateText as jest.Mock).mockResolvedValueOnce({
      content: '儿子，爸爸一直在天上看着你，你的事我都看在眼里。',
      reasoning: [],
      response: {},
    });

    const reply = await (service as any).generateAgentPostReply(
      post,
      createUser(),
      agent
    );

    expect(reply).toBe('儿子，我知道呢，心意我收到了。');
    expect(reply).not.toContain('天上');
    expect(reply).not.toContain('看着你');
  });

  it('answers the current time instead of inventing a work schedule', async () => {
    const agent = createAgent(AGENT_A_ID, {
      name: '爸爸',
      iCallAgent: '爸爸',
      agentCallMe: '儿子',
      sex: AgentSex.man,
    });
    const agentComment = createPostCommentEntity({
      id: new MongoObjectId(AGENT_COMMENT_ID),
      userId: undefined,
      agentId: agent.id,
      type: PostCommentType.agent,
      content: '儿子，这么晚了还不睡啊？',
    });
    const userReply = createPostCommentEntity({
      id: new MongoObjectId(USER_REPLY_COMMENT_ID),
      parentCommentId: agentComment.id,
      replyToAgentId: agent.id,
      content: '你知道现在几点了吗？',
      createdAt: new Date('2026-05-13T08:01:00.000Z'),
      updatedAt: new Date('2026-05-13T08:01:00.000Z'),
    });
    const { service } = createService([agent], {
      comments: [agentComment, userReply],
    });
    (service.openAIService.generateText as jest.Mock).mockResolvedValueOnce({
      content: '这么晚了还不睡，明天咋上班啊。',
      reasoning: [],
      response: {},
    });

    const reply = await (service as any).generateAgentPostReply(
      createPost({ content: '你现在在干嘛？' }),
      createUser(),
      agent,
      userReply.id
    );

    expect(reply).toMatch(/^知道，现在是\d{2}:\d{2}。刚才我没先回答你的话。$/);
    expect(reply).not.toContain('上班');
    const request = (service.openAIService.generateText as jest.Mock).mock
      .calls[0][0];
    expect(request.temperature).toBe(0.45);
    expect(request.topP).toBe(0.85);
    expect(request.prompt).toBe('请直接输出对当前用户评论的楼中楼回复正文。');
    expect(request.systemPrompt).toContain(
      '先回答问题或承认纠正，不要转回动态正文'
    );
  });

  it('accepts a contextual correction without changing the reason to lecture', async () => {
    const agent = createAgent(AGENT_A_ID, {
      name: '爸爸',
      iCallAgent: '爸爸',
      agentCallMe: '儿子',
      sex: AgentSex.man,
    });
    const agentComment = createPostCommentEntity({
      id: new MongoObjectId('665000000000000000000203'),
      userId: undefined,
      agentId: agent.id,
      type: PostCommentType.agent,
      content: '这么晚了还不睡，明天咋上班啊。',
    });
    const userReply = createPostCommentEntity({
      id: new MongoObjectId('665000000000000000000204'),
      parentCommentId: agentComment.id,
      replyToAgentId: agent.id,
      content: '我现在不上班的',
      createdAt: new Date('2026-05-13T08:02:00.000Z'),
      updatedAt: new Date('2026-05-13T08:02:00.000Z'),
    });
    const { service } = createService([agent], {
      comments: [agentComment, userReply],
    });
    (service.openAIService.generateText as jest.Mock).mockResolvedValueOnce({
      content: '那也不能老熬夜，对身体不好。',
      reasoning: [],
      response: {},
    });

    const reply = await (service as any).generateAgentPostReply(
      createPost({ content: '你现在在干嘛？' }),
      createUser(),
      agent,
      userReply.id
    );

    expect(reply).toBe('哦，是我说错了。你现在不上班，刚才不该乱猜。');
    expect(reply).not.toContain('熬夜');
    expect(reply).not.toContain('身体不好');
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

  it('loads comments for a post page with one batched query', async () => {
    const posts = [
      createPost({ id: new MongoObjectId(POST_ID) }),
      createPost({ id: new MongoObjectId(POST_2_ID) }),
    ];
    const comments = [
      createPostCommentEntity({
        id: new MongoObjectId(COMMENT_ID),
        postId: new MongoObjectId(POST_ID),
      }),
      createPostCommentEntity({
        id: new MongoObjectId(AGENT_COMMENT_ID),
        postId: new MongoObjectId(POST_2_ID),
      }),
    ];
    const { service } = createService([], { posts, comments });

    const result = await service.listPosts(AUTH, { page: 1, pageSize: 2 });

    expect(service.commentModel.find).toHaveBeenCalledTimes(1);
    expect(service.commentModel.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          postId: {
            $in: expect.arrayContaining([
              new MongoObjectId(POST_ID),
              new MongoObjectId(POST_2_ID),
            ]),
          },
        },
      })
    );
    expect(result.items.map(item => item.comments.length)).toEqual([1, 1]);
  });

  it('returns only two comment previews for lightweight post lists', async () => {
    const post = createPost({ id: new MongoObjectId(POST_ID) });
    const comments = [
      createPostCommentEntity({
        id: new MongoObjectId('665000000000000000000041'),
        postId: post.id,
        content: '第一条',
      }),
      createPostCommentEntity({
        id: new MongoObjectId('665000000000000000000042'),
        postId: post.id,
        content: '第二条',
      }),
      createPostCommentEntity({
        id: new MongoObjectId('665000000000000000000043'),
        postId: post.id,
        content: '第三条',
      }),
    ];
    const { service } = createService([], { posts: [post], comments });

    const result = await service.listPosts(AUTH, {
      page: 1,
      pageSize: 10,
      lightweight: true,
    });

    expect(result.items[0].commentCount).toBe(3);
    expect(result.items[0].comments.map(item => item.content)).toEqual([
      '第一条',
      '第二条',
    ]);
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
    const postNotification = createPostNotification();
    const unrelatedPostNotification = createPostNotification({
      id: new MongoObjectId('665000000000000000000402'),
      postId: new MongoObjectId(POST_2_ID),
    });
    const legacyNotification = createNotification();
    const unrelatedLegacyNotification = createNotification({
      id: new MongoObjectId('665000000000000000000302'),
      postId: new MongoObjectId(POST_2_ID),
    });
    const { service, notifications, postNotifications } = createService([], {
      posts: [post],
      notifications: [legacyNotification, unrelatedLegacyNotification],
      postNotifications: [postNotification, unrelatedPostNotification],
    });

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
    expect(notifications).toEqual([unrelatedLegacyNotification]);
    expect(postNotifications).toEqual([unrelatedPostNotification]);
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
    const mirroredUnread = createPostNotification({
      commentId: unread.commentId,
    });
    const mirroredUnreadLater = createPostNotification({
      id: new MongoObjectId('665000000000000000000401'),
      commentId: unreadLater.commentId,
    });
    const { service } = createService([], {
      notifications,
      postNotifications: [mirroredUnread, mirroredUnreadLater],
    });

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
    expect(mirroredUnread.isRead).toBe(true);
    expect(mirroredUnreadLater.isRead).toBe(true);
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
    expect(summary.unseenCount).toBe(1);
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
    const { service, notifications, postNotifications } = createService(
      [agent],
      {
        posts: [post],
      }
    );

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
      posts: [createPost()],
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

  it('marks the message entrance seen without clearing item unread state', async () => {
    const user = createUser();
    const legacyComment = createNotification({
      id: new MongoObjectId(NOTIFICATION_ID),
      commentId: new MongoObjectId(COMMENT_ID),
    });
    const commentNotification = createPostNotification({
      id: new MongoObjectId(POST_NOTIFICATION_ID),
      type: PostNotificationType.comment,
      commentId: new MongoObjectId(COMMENT_ID),
    });
    const likeNotification = createPostNotification({
      id: new MongoObjectId('665000000000000000000401'),
      type: PostNotificationType.like,
      commentId: undefined,
      commentType: undefined,
    });
    const { service } = createService([], {
      posts: [createPost()],
      notifications: [legacyComment],
      postNotifications: [commentNotification, likeNotification],
      users: [user],
    });

    const result = await service.seePostNotifications(AUTH);
    const summary = await service.getUnreadPostNotificationSummary(AUTH);

    expect(result).toEqual({
      seenCount: 2,
      unseenCount: 0,
      unreadCount: 2,
    });
    expect(commentNotification.isSeen).toBe(true);
    expect(legacyComment.isSeen).toBe(true);
    expect(likeNotification.isSeen).toBe(true);
    expect(commentNotification.isRead).toBe(false);
    expect(legacyComment.isRead).toBe(false);
    expect(likeNotification.isRead).toBe(false);
    expect(user.postNotificationSeenAt).toEqual(NOW);
    expect(summary.unreadCount).toBe(2);
    expect(summary.unseenCount).toBe(0);
    expect(summary.latestUnseen).toBeNull();
  });

  it('shows only interactions created after the message entrance cursor', async () => {
    const user = createUser();
    const olderNotification = createPostNotification({
      createdAt: new Date('2026-05-13T08:00:00.000Z'),
      contentPreview: '较早的互动',
    });
    const { service, postNotifications } = createService([], {
      posts: [createPost()],
      postNotifications: [olderNotification],
      users: [user],
    });

    expect(await service.getPostNotificationEntrySummary(AUTH)).toEqual(
      expect.objectContaining({
        unseenCount: 1,
      })
    );

    await service.seePostNotifications(AUTH);

    postNotifications.push(
      createPostNotification({
        id: new MongoObjectId('665000000000000000000401'),
        type: PostNotificationType.like,
        commentId: undefined,
        commentType: undefined,
        createdAt: new Date('2026-05-13T09:00:00.000Z'),
        contentPreview: '新的互动',
      })
    );

    const entrySummary = await service.getPostNotificationEntrySummary(AUTH);
    const compatibleSummary = await service.getUnreadPostNotificationSummary(
      AUTH
    );

    expect(entrySummary.unseenCount).toBe(1);
    expect(entrySummary.latestUnseen?.contentPreview).toBe('新的互动');
    expect(compatibleSummary.unreadCount).toBe(2);
    expect(compatibleSummary.unseenCount).toBe(1);
    expect(compatibleSummary.latestUnseen?.contentPreview).toBe('新的互动');
  });

  it('marks only the selected notification and its legacy duplicate as read', async () => {
    const legacyComment = createNotification({
      id: new MongoObjectId(NOTIFICATION_ID),
      commentId: new MongoObjectId(COMMENT_ID),
    });
    const commentNotification = createPostNotification({
      id: new MongoObjectId(POST_NOTIFICATION_ID),
      type: PostNotificationType.comment,
      commentId: new MongoObjectId(COMMENT_ID),
    });
    const likeNotification = createPostNotification({
      id: new MongoObjectId('665000000000000000000401'),
      type: PostNotificationType.like,
      commentId: undefined,
      commentType: undefined,
    });
    const { service } = createService([], {
      posts: [createPost()],
      notifications: [legacyComment],
      postNotifications: [commentNotification, likeNotification],
    });

    const result = await service.readPostNotification(
      AUTH,
      POST_NOTIFICATION_ID
    );

    expect(result).toEqual({
      notificationId: POST_NOTIFICATION_ID,
      readCount: 2,
      unreadCount: 1,
    });
    expect(commentNotification.isRead).toBe(true);
    expect(commentNotification.isSeen).toBe(true);
    expect(legacyComment.isRead).toBe(true);
    expect(legacyComment.isSeen).toBe(true);
    expect(likeNotification.isRead).toBe(false);
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
      posts: [createPost()],
      notifications: [legacyComment, legacyOnlyComment],
      postNotifications: [duplicatePostComment, likeNotification],
    });

    const result = await service.listPostNotifications(AUTH);

    expect(result.items.map(item => item.contentPreview)).toEqual([
      '与你的动态产生了共鸣',
      '新版评论通知',
      '仅旧集合存在的评论',
    ]);
    expect(result.items.map(item => item.postContentPreview)).toEqual([
      '今天去公园散步',
      '今天去公园散步',
      '今天去公园散步',
    ]);
    expect(result.items).toHaveLength(3);
  });

  it('filters unread and history notification pages independently', async () => {
    const unreadNotification = createPostNotification({
      contentPreview: '未读互动',
      isRead: false,
    });
    const readNotification = createPostNotification({
      id: new MongoObjectId('665000000000000000000401'),
      contentPreview: '历史互动',
      isRead: true,
    });
    const { service } = createService([], {
      posts: [createPost()],
      postNotifications: [unreadNotification, readNotification],
    });

    const unreadResult = await service.listPostNotifications(AUTH, {
      read: false,
    });
    const historyResult = await service.listPostNotifications(AUTH, {
      read: true,
    });

    expect(unreadResult.items.map(item => item.contentPreview)).toEqual([
      '未读互动',
    ]);
    expect(historyResult.items.map(item => item.contentPreview)).toEqual([
      '历史互动',
    ]);
    expect(unreadResult.readFilterApplied).toBe(true);
    expect(historyResult.readFilterApplied).toBe(true);
  });

  it('removes notifications whose posts have been deleted', async () => {
    const deletedPost = createPost({
      isDeleted: true,
    });
    const validPost = createPost({
      id: new MongoObjectId('665000000000000000000901'),
    });
    const deletedPostNotification = createPostNotification({
      id: new MongoObjectId(POST_NOTIFICATION_ID),
      postId: new MongoObjectId(POST_ID),
      contentPreview: '已删除动态的新通知',
      createdAt: new Date('2026-05-13T10:00:00.000Z'),
    });
    const deletedLegacyNotification = createNotification({
      id: new MongoObjectId(NOTIFICATION_ID),
      postId: new MongoObjectId(POST_ID),
      commentPreview: '已删除动态的旧通知',
      createdAt: new Date('2026-05-13T09:00:00.000Z'),
    });
    const validNotification = createPostNotification({
      id: new MongoObjectId('665000000000000000000401'),
      postId: validPost.id,
      contentPreview: '保留的通知',
      createdAt: new Date('2026-05-13T08:00:00.000Z'),
    });
    const notifications = [deletedLegacyNotification];
    const postNotifications = [deletedPostNotification, validNotification];
    const { service } = createService([], {
      posts: [deletedPost, validPost],
      notifications,
      postNotifications,
    });

    const result = await service.listPostNotifications(AUTH);
    const summary = await service.getUnreadPostNotificationSummary(AUTH);

    expect(result.items.map(item => item.contentPreview)).toEqual([
      '保留的通知',
    ]);
    expect(summary.unreadCount).toBe(1);
    expect(summary.latest?.contentPreview).toBe('保留的通知');
    expect(notifications).toHaveLength(0);
    expect(postNotifications).toEqual([validNotification]);
  });

  it('does not prune notifications when loading the related post fails transiently', async () => {
    const notification = createPostNotification();
    const { service, postNotifications } = createService([], {
      posts: [createPost()],
      postNotifications: [notification],
    });
    (service.postModel.find as jest.Mock).mockRejectedValueOnce(
      new Error('database temporarily unavailable')
    );

    await expect(service.listPostNotifications(AUTH)).rejects.toThrow(
      'database temporarily unavailable'
    );
    expect(postNotifications).toEqual([notification]);
    expect(service.notificationModel.deleteOne).not.toHaveBeenCalled();
  });

  it('rolls back a new like when creating its notification fails', async () => {
    const post = createPost({
      userId: new MongoObjectId(OTHER_USER_ID),
    });
    const { service, likes } = createService([], {
      posts: [post],
    });
    (service.notificationModel.save as jest.Mock).mockRejectedValueOnce(
      new Error('notification write failed')
    );

    await expect(service.likePost(AUTH, POST_ID)).rejects.toThrow(
      'notification write failed'
    );
    expect(likes).toHaveLength(0);
  });

  it('rolls back a new comment and partial notifications when notification creation fails', async () => {
    const post = createPost({
      userId: new MongoObjectId(OTHER_USER_ID),
    });
    const { service, comments, notifications, postNotifications } =
      createService([], {
        posts: [post],
      });
    (service.notificationModel.save as jest.Mock).mockRejectedValueOnce(
      new Error('notification write failed')
    );

    await expect(
      service.createComment(AUTH, POST_ID, {
        content: '这是一条评论',
      })
    ).rejects.toThrow('notification write failed');
    expect(comments).toHaveLength(0);
    expect(notifications).toHaveLength(0);
    expect(postNotifications).toHaveLength(0);
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
