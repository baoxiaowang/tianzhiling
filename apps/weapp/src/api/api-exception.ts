import { brand } from '../config/brand'

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
      'ACCOUNT_CANCELED',
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
      case 'ACCOUNT_CANCELED':
      case 'ACCOUNT_ALREADY_CANCELED':
        return '账号已注销'
      case 'ACCOUNT_CANCELLATION_CONFIRMATION_REQUIRED':
        return '请输入“确认注销”后继续'
      case 'ACCOUNT_CANCELLATION_WECHAT_VERIFICATION_REQUIRED':
        return '请完成微信身份验证后再注销'
      case 'ACCOUNT_CANCELLATION_IDENTITY_MISMATCH':
        return '当前微信身份与登录账号不一致'
      case 'ACCOUNT_CANCELLATION_BLOCKED':
        return '还有未完成的业务，请处理后再注销'
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
      case 'WEAPP_ACCOUNT_NOT_FOUND':
        return '请先完成微信授权登录'
      case 'WEAPP_PHONE_BIND_REQUIRED':
        return '请授权手机号完成登录'
      case 'WEAPP_OPENID_BOUND_TO_OTHER_USER':
        return '该微信已绑定其它手机号'
      case 'WECHAT_MINI_PROGRAM_CONFIG_MISSING':
        return '小程序登录配置缺失，请联系管理员'
      case 'INVALID_DEV_LOGIN_ACCOUNT':
        return '请输入用户 Account'
      case 'INVALID_DEV_LOGIN_OPENID':
        return '请输入用户 OpenID'
      case 'DEV_LOGIN_ACCOUNT_OPENID_MISMATCH':
        return 'Account 和 OpenID 不匹配'
      case 'WECHAT_PAY_CONFIG_MISSING':
        return '微信支付配置缺失，请联系管理员'
      case 'POST_COMMENT_CONTENT_UNSAFE':
        return '发布内容含违规信息，请修改后再试'
      case 'POST_COMMENT_SECURITY_UNAVAILABLE':
      case 'WECHAT_MSG_SEC_CHECK_FAILED':
      case 'WECHAT_MSG_SEC_CHECK_OPENID_MISSING':
      case 'WECHAT_MSG_SEC_CHECK_CONTENT_MISSING':
        return '评论发布失败，请稍后重试'
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
      case 'INVALID_AGENT_SHARE_INVITE_TOKEN':
        return '邀请信息不完整，请让邀请人重新分享'
      case 'AGENT_SHARE_INVITE_NOT_FOUND':
        return '这份邀请已经失效或被撤回'
      case 'AGENT_SHARE_INVITE_EXPIRED':
        return '这份邀请已经过期，请让邀请人重新分享'
      case 'AGENT_SHARE_OWNER_REQUIRED':
        return '只有创建者可以邀请亲友'
      case 'AGENT_SHARE_MEMBER_NOT_FOUND':
      case 'AGENT_SHARE_ACCESS_REVOKED':
        return `你已无法继续访问这个${brand.name}`
      case 'INVALID_WECHAT_MINI_PROGRAM_SCENE':
      case 'INVALID_WECHAT_MINI_PROGRAM_PAGE':
      case 'WECHAT_MINI_PROGRAM_CODE_FAILED':
      case 'WECHAT_MINI_PROGRAM_CODE_EMPTY':
        return '邀请二维码生成失败，请稍后重试'
      case 'INVALID_AGENT_AVATAR':
        return '头像上传结果无效，请重新选择'
      case 'INVALID_MEMORIAL_AGENT_PHOTOS':
        return '请上传 1-3 张 TA 的照片'
      case 'INVALID_MEMORIAL_USER_PHOTO':
        return '请上传你的照片'
      case 'MEMORIAL_PHOTO_ASSET_UNAVAILABLE':
        return '图片暂不可访问，请重新上传后再试'
      case 'BAILIAN_IMAGE_DISABLED':
      case 'BAILIAN_IMAGE_API_KEY_MISSING':
      case 'BAILIAN_IMAGE_HTTP_ERROR':
      case 'BAILIAN_IMAGE_GENERATION_FAILED':
      case 'BAILIAN_IMAGE_INVALID_RESPONSE':
      case 'BAILIAN_IMAGE_EMPTY_RESULT':
      case 'BAILIAN_IMAGE_DOWNLOAD_FAILED':
      case 'BAILIAN_IMAGE_DOWNLOAD_EMPTY':
      case 'BAILIAN_IMAGE_REQUEST_FAILED':
        return '合照生成失败，请稍后重试'
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
