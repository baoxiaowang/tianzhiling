export class ApiException extends Error {
  code?: string
  details?: string

  constructor(message: string, options?: { code?: string; details?: string }) {
    super(message)
    this.name = 'ApiException'
    this.code = options?.code
    this.details = options?.details
  }

  get requiresReLogin() {
    return [
      'USER_NOT_FOUND',
      'UNAUTHORIZED',
      'INVALID_AUTHORIZATION',
      'INVALID_TOKEN',
      'TOKEN_REVOKED',
      'TOKEN_EXPIRED',
    ].includes(this.code ?? '')
  }

  static fromCode(
    code: string | undefined,
    fallback: string,
    details?: string
  ) {
    return new ApiException(this.messageForCode(code, fallback), {
      code,
      details,
    })
  }

  private static messageForCode(code: string | undefined, fallback: string) {
    switch (code) {
      case 'USER_NOT_FOUND':
        return '用户信息不存在，请重新登录'
      case 'UNAUTHORIZED':
      case 'INVALID_AUTHORIZATION':
      case 'INVALID_TOKEN':
      case 'TOKEN_REVOKED':
      case 'TOKEN_EXPIRED':
        return '登录状态已失效，请重新登录'
      case 'INVALID_PHONE':
        return '请输入正确的中国大陆手机号'
      case 'INVALID_SMS_CODE':
        return '请输入正确的短信验证码'
      case 'SMS_CODE_NOT_FOUND':
        return '验证码不存在，请重新获取'
      case 'SMS_CODE_EXPIRED':
        return '验证码已过期，请重新获取'
      case 'SMS_CODE_SENT_TOO_FREQUENTLY':
        return '验证码发送过于频繁，请稍后再试'
      case 'INVALID_LOGIN_PARAMS':
      case 'INVALID_CREDENTIALS':
        return '手机号或密码错误'
      case 'PASSWORD_NOT_SET':
        return '该账号暂未设置密码，请使用短信验证码登录'
      case 'SMS_NOT_ENABLED':
      case 'SMS_CONFIG_MISSING':
      case 'SMS_PROVIDER_REQUEST_FAILED':
      case 'SMS_PROVIDER_SEND_FAILED':
      case 'SMS_PROVIDER_INVALID_RESPONSE':
      case 'SMS_PROVIDER_NETWORK_ERROR':
        return '验证码发送失败，请稍后重试'
      default:
        return fallback
    }
  }
}
