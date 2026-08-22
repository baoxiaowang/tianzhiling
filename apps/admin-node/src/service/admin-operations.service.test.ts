import { MongoObjectId } from '@tzl/entities';
import { AdminOperationsService } from './admin-operations.service';

function createService() {
  const service = new AdminOperationsService();

  service.userModel = { count: jest.fn(), find: jest.fn() } as any;
  service.agentModel = { count: jest.fn(), find: jest.fn() } as any;
  service.conversationModel = { count: jest.fn() } as any;
  service.postModel = { count: jest.fn() } as any;
  service.feedbackModel = { count: jest.fn(), find: jest.fn() } as any;
  service.chatTraceModel = { count: jest.fn(), find: jest.fn() } as any;
  service.chatImportModel = { count: jest.fn(), find: jest.fn() } as any;

  return service;
}

describe('AdminOperationsService', () => {
  it('builds a real operations overview without including voice or orders', async () => {
    const service = createService();
    jest.mocked(service.userModel.count).mockResolvedValue(10 as never);
    jest.mocked(service.agentModel.count).mockResolvedValue(8 as never);
    jest.mocked(service.conversationModel.count).mockResolvedValue(7 as never);
    jest.mocked(service.postModel.count).mockResolvedValue(6 as never);
    jest
      .mocked(service.chatImportModel.count)
      .mockResolvedValueOnce(1 as never)
      .mockResolvedValueOnce(4 as never);
    jest.mocked(service.feedbackModel.count).mockResolvedValue(3 as never);
    jest.mocked(service.chatTraceModel.count).mockResolvedValue(2 as never);
    jest.mocked(service.feedbackModel.find).mockResolvedValue([] as never);
    jest.mocked(service.chatTraceModel.find).mockResolvedValue([] as never);
    jest.mocked(service.chatImportModel.find).mockResolvedValue([] as never);

    const result = await service.getOverview();

    expect(result.metrics.map(item => item.key)).toEqual([
      'users',
      'agents',
      'conversations',
      'posts',
      'activeImports',
      'attention',
    ]);
    expect(result.metrics.find(item => item.key === 'attention')?.value).toBe(
      9
    );
    expect(service.agentModel.count).toHaveBeenCalledWith({
      $or: [
        { messengerOfAgentId: { $exists: false } },
        { messengerOfAgentId: null },
      ],
    });
  });

  it('returns recent feedback with linked user and agent names', async () => {
    const service = createService();
    const userId = new MongoObjectId();
    const agentId = new MongoObjectId();
    jest.mocked(service.feedbackModel.count).mockResolvedValue(1 as never);
    jest.mocked(service.chatTraceModel.count).mockResolvedValue(0 as never);
    jest.mocked(service.feedbackModel.find).mockResolvedValue([
      {
        id: new MongoObjectId(),
        userId,
        agentId,
        conversationId: new MongoObjectId(),
        messageId: new MongoObjectId(),
        type: 'unlike',
        content: '不像本人',
        assistantContent: '测试回复',
        createdAt: new Date('2026-08-22T01:00:00.000Z'),
      },
    ] as never);
    jest.mocked(service.chatTraceModel.find).mockResolvedValue([] as never);
    jest
      .mocked(service.userModel.find)
      .mockResolvedValue([{ id: userId, name: '小星' }] as never);
    jest
      .mocked(service.agentModel.find)
      .mockResolvedValue([{ id: agentId, name: '爸爸' }] as never);

    const result = await service.getChatQuality();

    expect(result.feedback).toHaveLength(1);
    expect(result.feedback[0]).toMatchObject({
      type: 'unlike',
      userName: '小星',
      agentName: '爸爸',
      assistantContent: '测试回复',
    });
  });

  it('paginates chat-import tasks and exposes progress and failures', async () => {
    const service = createService();
    const taskId = new MongoObjectId();
    jest.mocked(service.chatImportModel.count).mockResolvedValue(1 as never);
    jest.mocked(service.chatImportModel.find).mockResolvedValue([
      {
        id: taskId,
        userId: new MongoObjectId(),
        agentId: new MongoObjectId(),
        conversationId: new MongoObjectId(),
        status: 'partial_failed',
        screenshotCount: 3,
        recognizedCount: 2,
        duplicateCount: 1,
        retryCount: 2,
        errorCode: 'OCR_PARTIAL_FAILED',
        errorDetail: '一张截图识别失败',
        createdAt: new Date('2026-08-22T01:00:00.000Z'),
        updatedAt: new Date('2026-08-22T01:01:00.000Z'),
      },
    ] as never);

    const result = await service.listTasks({
      page: '1',
      pageSize: '20',
      status: 'partial_failed',
    });

    expect(result.total).toBe(1);
    expect(result.items[0]).toMatchObject({
      id: taskId.toHexString(),
      progressCurrent: 2,
      progressTotal: 3,
      duplicateCount: 1,
      errorCode: 'OCR_PARTIAL_FAILED',
    });
  });
});
