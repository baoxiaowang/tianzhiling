import {
  AgentEntity,
  AgentSex,
  MongoObjectId,
  PostCommentEntity,
  PostCommentNotificationEntity,
  PostCommentType,
  PostEntity,
  UserEntity,
} from '@tzl/entities';
import { PostService } from '../../src/service/post.service';

const USER_ID = '665000000000000000000001';
const AGENT_A_ID = '665000000000000000000010';
const AGENT_B_ID = '665000000000000000000011';
const POST_ID = '665000000000000000000100';
const POST_2_ID = '665000000000000000000101';
const POST_3_ID = '665000000000000000000102';
const COMMENT_ID = '665000000000000000000200';
const NOTIFICATION_ID = '665000000000000000000300';
const NOW = new Date('2026-05-13T08:00:00.000Z');
const AUTH = {
  sub: USER_ID,
  accountId: 'account-1',
  account: 'user',
  iat: 1778659200,
  exp: 1778688000,
  nonce: 'nonce',
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

function createService(
  agents: AgentEntity[] = [],
  options: {
    posts?: PostEntity[];
    notifications?: PostCommentNotificationEntity[];
    comments?: PostCommentEntity[];
  } = {}
) {
  const service = new PostService();
  const savedPosts: PostEntity[] = [];
  const posts = options.posts ?? [];
  const notifications = options.notifications ?? [];
  const comments = options.comments ?? [];
  const addJobToQueue = jest.fn(async () => undefined);

  service.postModel = {
    save: jest.fn(async (post: PostEntity) => {
      post.id = post.id ?? new MongoObjectId(POST_ID);
      savedPosts.push(post);
      return post;
    }),
    find: jest.fn(async ({ order, skip = 0, take }: any) => {
      let result = [...posts];

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
  service.likeModel = {
    find: jest.fn(async () => []),
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
    comments,
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

    const systemPrompt = generateText.mock.calls[0][0].systemPrompt as string;
    expect(systemPrompt).toContain('浅层视觉摘要');
    expect(systemPrompt).toContain('不要根据图片推断');
    expect(systemPrompt).toContain('这是用户本人');
    expect(systemPrompt).toContain(
      '画面里有盛开的花和公园步道，氛围轻松明亮。'
    );
    expect(systemPrompt).not.toContain('vision failed');
  });
});
