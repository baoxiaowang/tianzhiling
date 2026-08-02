const mockLogin = jest.fn()
const mockWeappLogin = jest.fn()
const mockAuthSession: { value: { accessToken?: string } | null } = {
  value: null,
}

jest.mock('@tarojs/taro', () => ({
  __esModule: true,
  default: {
    login: mockLogin,
  },
}))

jest.mock('../src/auth/api', () => ({
  ApiException: class ApiException extends Error {},
  weappLogin: mockWeappLogin,
  weappPhoneLogin: jest.fn(),
}))

jest.mock('../src/auth/session', () => ({
  authSession: mockAuthSession,
}))

import { silentWeappLogin } from '../src/auth/login-hooks'

describe('silentWeappLogin', () => {
  beforeEach(() => {
    mockLogin.mockReset()
    mockWeappLogin.mockReset()
    mockAuthSession.value = null
  })

  it('shares one in-flight login across concurrent startup callers', async () => {
    mockLogin.mockResolvedValue({ code: 'wx-code' })
    mockWeappLogin.mockResolvedValue({ accessToken: 'token' })

    const [first, second] = await Promise.all([
      silentWeappLogin(),
      silentWeappLogin(),
    ])

    expect(first).toEqual({ accessToken: 'token' })
    expect(second).toEqual({ accessToken: 'token' })
    expect(mockLogin).toHaveBeenCalledTimes(1)
    expect(mockWeappLogin).toHaveBeenCalledTimes(1)
  })

  it('returns an existing session without asking WeChat to log in', async () => {
    mockAuthSession.value = { accessToken: 'existing-token' }

    await expect(silentWeappLogin()).resolves.toEqual(mockAuthSession.value)
    expect(mockLogin).not.toHaveBeenCalled()
  })
})
