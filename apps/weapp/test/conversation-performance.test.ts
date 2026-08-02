const mockGet = jest.fn()
const mockGetWithOptions = jest.fn()
const mockStorage = new Map<string, string>()
let mockAuthClearListener: (() => void) | undefined

jest.mock('@tarojs/taro', () => ({
  __esModule: true,
  default: {
    getStorageSync: jest.fn((key: string) => mockStorage.get(key) ?? ''),
    setStorageSync: jest.fn((key: string, value: string) => {
      mockStorage.set(key, value)
    }),
    removeStorageSync: jest.fn((key: string) => {
      mockStorage.delete(key)
    }),
  },
}))

jest.mock('../src/api/api-client', () => ({
  del: jest.fn(),
  get: mockGet,
  getWithOptions: mockGetWithOptions,
  post: jest.fn(),
}))

jest.mock('../src/auth/session', () => ({
  authSession: {
    value: {
      user: { id: 'user-1' },
    },
  },
  registerAuthSessionClearListener: jest.fn((listener: () => void) => {
    mockAuthClearListener = listener
  }),
}))

import {
  getCachedConversationMessages,
  getConversationChatBootstrap,
  getConversationPage,
} from '../src/apis/conversation'

describe('conversation performance APIs', () => {
  beforeEach(() => {
    mockGet.mockReset()
    mockGetWithOptions.mockReset()
    mockStorage.clear()
  })

  it('requests a bounded conversation page', async () => {
    mockGet.mockResolvedValue({
      items: [],
      page: 2,
      pageSize: 40,
      hasMore: true,
    })

    await expect(
      getConversationPage({ page: 2, pageSize: 40 })
    ).resolves.toEqual({
      items: [],
      page: 2,
      pageSize: 40,
      hasMore: true,
    })

    expect(mockGet).toHaveBeenCalledWith(
      '/api/conversation?page=2&pageSize=40'
    )
  })

  it('caches the latest lightweight bootstrap messages by account', async () => {
    mockGet.mockResolvedValue({
      items: [
        {
          id: 'message-1',
          conversationId: 'conversation-1',
          role: 'assistant',
          type: 'text',
          content: '今天好吗',
          status: 'sent',
          createdAt: '2026-08-01T00:00:00.000Z',
          updatedAt: '2026-08-01T00:00:00.000Z',
        },
      ],
      pageSize: 30,
      hasMore: true,
      agent: {
        id: 'agent-1',
        name: '妈妈',
      },
      chatQuota: {
        isVip: false,
        remainingCount: 2,
      },
    })

    const result = await getConversationChatBootstrap('conversation-1', {
      pageSize: 30,
      lightweight: true,
    })
    const cached = getCachedConversationMessages('conversation-1')

    expect(result.items[0].content).toBe('今天好吗')
    expect(result.agent?.name).toBe('妈妈')
    expect(cached?.items[0].createdAt).toEqual(
      new Date('2026-08-01T00:00:00.000Z')
    )
    expect(cached?.hasMore).toBe(true)

    mockAuthClearListener?.()
    expect(getCachedConversationMessages('conversation-1')).toBeUndefined()
  })
})
