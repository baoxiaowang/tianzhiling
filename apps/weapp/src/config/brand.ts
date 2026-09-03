/**
 * 品牌配置（微信小程序端）
 *
 * 单一真值源为仓库根目录 brand/<brand>.json；
 * 构建时由 Taro config defineConstants 注入（见 config/index.ts），
 * 不注入任何参数时默认产出"天之灵"品牌。
 */
export const brand = {
  /** 品牌标识 key */
  key: BRAND ?? 'tianzhiling',
  /** 产品名（也是智能体/实体名） */
  name: BRAND_NAME ?? '天之灵',
  /** 公司主体（协议与合规用） */
  companyName: BRAND_COMPANY ?? '武汉市天之灵智能技术有限公司',
  /** 导航栏标题 */
  navigationBarTitle: BRAND_WEAPP_NAV_TITLE ?? '天之灵',
  /** 小程序 AppID */
  weappAppid: BRAND_WEAPP_APPID ?? 'wxb6bcebdb61af0461',
  /** 客服信息 */
  customerService: {
    /** 客服热线 */
    phone: BRAND_CUSTOMER_SERVICE_PHONE ?? '19986943631',
    /** 客服微信二维码 OSS 路径 */
    wechatQr: BRAND_CUSTOMER_SERVICE_WECHAT_QR ?? '/weapp/service.png',
    /** 客服邮箱 */
    email: BRAND_CUSTOMER_SERVICE_EMAIL ?? 'support@tianzhiling.chat',
    /** 客服微信号（可选，用于展示） */
    wechatId: BRAND_CUSTOMER_SERVICE_WECHAT_ID ?? '',
  },
} as const;
