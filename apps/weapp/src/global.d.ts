/**
 * 全局编译期注入常量声明
 *
 * 由 Taro config defineConstants 注入（见 config/index.ts），
 * 构建时若不注入，值为品牌默认（天之灵）。
 */
declare const BRAND: string
declare const BRAND_NAME: string
declare const BRAND_COMPANY: string
declare const BRAND_WEAPP_NAV_TITLE: string
declare const BRAND_WEAPP_APPID: string
declare const BRAND_CUSTOMER_SERVICE_PHONE: string
declare const BRAND_CUSTOMER_SERVICE_WECHAT_QR: string
declare const BRAND_CUSTOMER_SERVICE_EMAIL: string
declare const BRAND_CUSTOMER_SERVICE_WECHAT_ID: string
