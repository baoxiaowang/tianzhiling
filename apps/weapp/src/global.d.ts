/**
 * 全局编译期注入常量声明
 *
 * 由 Taro config defineConstants 注入（见 config/index.ts），
 * 构建时若不注入，值为品牌默认（天之灵）。
 */
declare const BRAND: string
declare const BRAND_NAME: string
declare const BRAND_COMPANY: string
/** 品牌主域名（默认 tianzhiling.chat），品牌内默认地址由它拼接 */
declare const BRAND_DOMAIN: string
/** 品牌管理后台域名（默认 admin.tianzhiling.chat） */
declare const BRAND_ADMIN_DOMAIN: string
declare const BRAND_WEAPP_NAV_TITLE: string
declare const BRAND_WEAPP_APPID: string
/** 品牌接口地址（默认 https://tianzhiling.chat） */
declare const BRAND_WEAPP_API_BASE_URL: string
/** 品牌静态资源地址（默认 https://tianzhiling.chat） */
declare const BRAND_WEAPP_ASSET_BASE_URL: string
/** 品牌媒体资源地址（默认 https://oss.tianzhiling.chat） */
declare const BRAND_WEAPP_MEDIA_BASE_URL: string
declare const BRAND_CUSTOMER_SERVICE_PHONE: string
declare const BRAND_CUSTOMER_SERVICE_WECHAT_QR: string
declare const BRAND_CUSTOMER_SERVICE_EMAIL: string
declare const BRAND_CUSTOMER_SERVICE_WECHAT_ID: string
