import {
  AgentEntity,
  AgentSex,
  MongoObjectId,
  PostEntity,
  UserEntity,
} from '@tzl/entities';
import { PostService } from '../../src/service/post.service';

const USER_ID = '665000000000000000000001';
const AGENT_A_ID = '665000000000000000000010';
const AGENT_B_ID = '665000000000000000000011';
const POST_ID = '665000000000000000000100';
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

function createService(agents: AgentEntity[] = []) {
  const service = new PostService();
  const savedPosts: PostEntity[] = [];
  const addJobToQueue = jest.fn(async () => undefined);

  service.postModel = {
    save: jest.fn(async (post: PostEntity) => {
      post.id = post.id ?? new MongoObjectId(POST_ID);
      savedPosts.push(post);
      return post;
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
    find: jest.fn(async ({ where, order, take }: any) => {
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
    find: jest.fn(async () => []),
  } as any;
  service.openAIService = {
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

    const systemPrompt = generateText.mock.calls[0][0].systemPrompt as string;
    expect(systemPrompt).toContain('图片数量：2');
    expect(systemPrompt).toContain('图片内容：');
    expect(systemPrompt).toContain(
      '画面里有盛开的花和公园步道，氛围轻松明亮。'
    );
    expect(systemPrompt).not.toContain('vision failed');
  });
});
