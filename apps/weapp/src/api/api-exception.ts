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
      case 'INVALID_USER_NAME':
        return '昵称格式不正确，请重新输入'
      case 'INVALID_USER_AVATAR':
        return '头像上传结果无效，请重新选择'
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
      case 'INVALID_WECHAT_JS_CODE':
        return '微信登录凭证获取失败，请稍后重试'
      case 'WECHAT_CODE_SESSION_FAILED':
      case 'WECHAT_OPENID_MISSING':
        return '微信授权登录失败，请稍后重试'
      case 'INVALID_WECHAT_PHONE_CODE':
        return '请授权手机号后继续登录'
      case 'WECHAT_ACCESS_TOKEN_FAILED':
      case 'WECHAT_PHONE_NUMBER_FAILED':
      case 'WECHAT_PHONE_NUMBER_MISSING':
        return '微信手机号授权失败，请稍后重试'
      case 'WECHAT_PHONE_COUNTRY_UNSUPPORTED':
        return '暂只支持中国大陆手机号登录'
      case 'WEAPP_PHONE_BIND_REQUIRED':
        return '请授权手机号完成登录'
      case 'WEAPP_OPENID_BOUND_TO_OTHER_USER':
        return '该微信已绑定其它手机号'
      case 'WECHAT_MINI_PROGRAM_CONFIG_MISSING':
        return '小程序登录配置缺失，请联系管理员'
      case 'WECHAT_PAY_CONFIG_MISSING':
        return '微信支付配置缺失，请联系管理员'
      case 'SMS_NOT_ENABLED':
      case 'SMS_CONFIG_MISSING':
      case 'SMS_PROVIDER_REQUEST_FAILED':
      case 'SMS_PROVIDER_SEND_FAILED':
      case 'SMS_PROVIDER_INVALID_RESPONSE':
      case 'SMS_PROVIDER_NETWORK_ERROR':
        return '验证码发送失败，请稍后重试'
      case 'INVALID_AGENT_NAME':
        return '请输入 30 个字以内的纪念人昵称或备注名'
      case 'INVALID_AGENT_SEX':
        return '请选择 TA 的性别'
      case 'INVALID_AGENT_CALL_NAME':
        return '请输入 20 个字以内的称呼'
      case 'AGENT_NOT_FOUND':
        return '智能体资料不存在'
      case 'INVALID_AGENT_AVATAR':
        return '头像上传结果无效，请重新选择'
      case 'TENCENT_COS_CONFIG_MISSING':
      case 'TENCENT_COS_INVALID_FILE':
      case 'TENCENT_COS_DISABLED':
      case 'UPLOAD_FILE_MISSING':
      case 'OSS_CONFIG_MISSING':
      case 'OSS_INVALID_FILE':
        return '图片上传失败，请稍后重试'
      default:
        return fallback
    }
  }
}
