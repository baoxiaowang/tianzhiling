/**
 * 品牌配置（微信小程序端）
 *
 * 单一真值源为仓库根目录 brand/<brand>.json；
 * 构建时由 Taro config defineConstants 注入（见 config/index.ts），
 * 不注入任何参数时默认产出"天之灵"品牌。
 *
 * 域名类默认值一律由 BRAND_DOMAIN 拼出（而不是写死另一品牌的域名）：
 * 否则未了言包里会残留天之灵域名字面量，被发布校验拦下。
 */
const brandDomain = BRAND_DOMAIN || 'tianzhiling.chat'

export const brand = {
  /** 品牌标识 key */
  key: BRAND ?? 'tianzhiling',
  /** 产品名（也是智能体/实体名） */
  name: BRAND_NAME ?? '天之灵',
  /** 公司主体（协议与合规用） */
  companyName: BRAND_COMPANY ?? '武汉市天之灵智能技术有限公司',
  /** 导航栏标题 */
  navigationBarTitle: BRAND_WEAPP_NAV_TITLE ?? '天之灵',
  /** 管理后台域名（声音工作台等跳转白名单用） */
  adminDomain: BRAND_ADMIN_DOMAIN || `admin.${brandDomain}`,
  /** 小程序 AppID */
  weappAppid: BRAND_WEAPP_APPID ?? 'wxb6bcebdb61af0461',
  /**
   * 小程序接口地址（品牌注入）。
   *
   * 不再由 `.env.production` 决定：生产包必须按品牌注入，
   * 否则会出现「未了言小程序请求天之灵后端」的串品牌事故。
   */
  weappApiBaseUrl: BRAND_WEAPP_API_BASE_URL || `https://${brandDomain}`,
  /** 小程序静态资源地址（品牌注入） */
  weappAssetBaseUrl: BRAND_WEAPP_ASSET_BASE_URL || `https://${brandDomain}`,
  /** 小程序媒体资源地址（品牌注入） */
  weappMediaBaseUrl: BRAND_WEAPP_MEDIA_BASE_URL || `https://oss.${brandDomain}`,
  /** 客服信息 */
  customerService: {
    /** 客服热线 */
    phone: BRAND_CUSTOMER_SERVICE_PHONE ?? '19986943631',
    /** 客服微信二维码 OSS 路径 */
    wechatQr: BRAND_CUSTOMER_SERVICE_WECHAT_QR ?? '/weapp/service.png',
    /** 客服邮箱 */
    email: BRAND_CUSTOMER_SERVICE_EMAIL ?? `support@${brandDomain}`,
    /** 客服微信号（可选，用于展示） */
    wechatId: BRAND_CUSTOMER_SERVICE_WECHAT_ID ?? '',
  },
} as const;
