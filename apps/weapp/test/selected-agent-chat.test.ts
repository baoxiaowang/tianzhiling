const mockNavigateTo = jest.fn()
const mockGetStorageSync = jest.fn()
const mockSetStorageSync = jest.fn()
const mockGetConversations = jest.fn()
const mockGetCachedConversations = jest.fn()
const mockGetEntryConversation = jest.fn()
const mockAuthSession = {
  value: {
    accessToken: 'token',
    user: { id: 'user-1' },
  },
}

jest.mock('@tarojs/taro', () => ({
  __esModule: true,
  default: {
    getStorageSync: mockGetStorageSync,
    setStorageSync: mockSetStorageSync,
    navigateTo: mockNavigateTo,
    showLoading: jest.fn(),
    hideLoading: jest.fn(),
    showToast: jest.fn(),
  },
}))

jest.mock('../src/apis/conversation', () => ({
  getCachedConversations: mockGetCachedConversations,
  getConversations: mockGetConversations,
  getEntryConversation: mockGetEntryConversation,
  parseConversationSummary: (value: Record<string, unknown>) => ({
    ...value,
    createdAt: value.createdAt ? new Date(String(value.createdAt)) : null,
    updatedAt: value.updatedAt ? new Date(String(value.updatedAt)) : null,
  }),
}))

jest.mock('../src/auth/session', () => ({
  authSession: mockAuthSession,
  restoreAuthSession: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('../src/utils/agent-create-navigation', () => ({
  openAgentCreatePage: jest.fn(),
}))

import { openSelectedAgentChat } from '../src/utils/selected-agent-chat'

describe('openSelectedAgentChat', () => {
  beforeEach(() => {
    mockNavigateTo.mockReset().mockResolvedValue(undefined)
    mockSetStorageSync.mockReset()
    mockGetConversations.mockReset()
    mockGetCachedConversations.mockReset().mockReturnValue([])
    mockGetEntryConversation.mockReset()
    mockGetStorageSync.mockReset().mockReturnValue(
      JSON.stringify({
        ownerId: 'user-1',
        conversation: {
          id: 'conversation-1',
          agentId: 'agent-1',
          agentName: '妈妈',
          agentAvatar: '',
          agentSex: 0,
          agentCallMe: '宝贝',
          iCallAgent: '妈妈',
          agentIsDefault: true,
          preview: '今天好吗',
          createdAt: '2026-08-01T00:00:00.000Z',
          updatedAt: '2026-08-01T00:00:00.000Z',
        },
      }),
    )
  })

  it('opens the remembered conversation without blocking on the list API', async () => {
    await expect(openSelectedAgentChat()).resolves.toBe(true)

    expect(mockGetConversations).not.toHaveBeenCalled()
    expect(mockNavigateTo).toHaveBeenCalledWith({
      url: expect.stringContaining('/pages/chat/index?conversationId=conversation-1'),
    })
    expect(mockSetStorageSync).toHaveBeenCalled()
  })

  it('uses the lightweight entry endpoint when there is no remembered conversation', async () => {
    mockGetStorageSync.mockReturnValue('')
    mockGetEntryConversation.mockResolvedValue({
      id: 'conversation-entry',
      agentId: 'agent-entry',
      agentName: '爸爸',
      agentAvatar: '',
      agentSex: 1,
      agentCallMe: '孩子',
      iCallAgent: '爸爸',
      agentIsDefault: true,
      preview: '',
      createdAt: null,
      updatedAt: null,
    })

    await expect(openSelectedAgentChat()).resolves.toBe(true)

    expect(mockGetEntryConversation).toHaveBeenCalledTimes(1)
    expect(mockGetConversations).not.toHaveBeenCalled()
    expect(mockNavigateTo).toHaveBeenCalledWith({
      url: expect.stringContaining('conversationId=conversation-entry'),
    })
  })

  it('keeps a remembered shared conversation selected over the owners default', async () => {
    mockGetStorageSync.mockReturnValue(
      JSON.stringify({
        ownerId: 'user-1',
        conversation: {
          id: 'conversation-shared',
          agentId: 'agent-shared',
          agentName: '奶奶',
          agentAvatar: '',
          agentSex: 0,
          agentCallMe: '闺女',
          iCallAgent: '奶奶',
          agentIsDefault: false,
          agentAccessRole: 'shared',
          preview: '',
          createdAt: '2026-08-01T00:00:00.000Z',
          updatedAt: '2026-08-01T00:00:00.000Z',
        },
      }),
    )
    mockGetCachedConversations.mockReturnValue([
      {
        id: 'conversation-owner',
        agentId: 'agent-owner',
        agentName: '爸爸',
        agentIsDefault: true,
      },
      {
        id: 'conversation-shared',
        agentId: 'agent-shared',
        agentName: '奶奶',
        agentIsDefault: false,
        agentAccessRole: 'shared',
      },
    ])

    await expect(openSelectedAgentChat()).resolves.toBe(true)

    expect(mockNavigateTo).toHaveBeenCalledWith({
      url: expect.stringContaining('conversationId=conversation-shared'),
    })
  })
})
