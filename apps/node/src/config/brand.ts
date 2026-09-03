/**
 * 品牌配置读取（Node 端）
 *
 * 单一真值源为仓库根目录 brand/<brand>.json；本模块读取 .env 中注入的
 * BRAND_NAME / BRAND_COMPANY（config.default.ts 启动时已加载进 process.env），
 * 不设置时默认"天之灵"。
 *
 * 说明：不缓存、每次读取 process.env，保证 .env 在任何时机加载后取值都正确。
 */

export interface NodeBrandConfig {
  key: string;
  name: string;
  companyName: string;
  customerService: {
    phone: string;
    wechatQr: string;
    email: string;
    wechatId: string;
  };
}

export function brandConfig(): NodeBrandConfig {
  return {
    key: process.env.BRAND || 'tianzhiling',
    name: process.env.BRAND_NAME || '天之灵',
    companyName: process.env.BRAND_COMPANY || '武汉市天之灵智能技术有限公司',
    customerService: {
      phone: process.env.BRAND_CUSTOMER_SERVICE_PHONE || '19986943631',
      wechatQr: process.env.BRAND_CUSTOMER_SERVICE_WECHAT_QR || '/weapp/service.png',
      email: process.env.BRAND_CUSTOMER_SERVICE_EMAIL || 'support@tianzhiling.chat',
      wechatId: process.env.BRAND_CUSTOMER_SERVICE_WECHAT_ID || '',
    },
  };
}

export function brandName(): string {
  return brandConfig().name;
}

export function brandCompanyName(): string {
  return brandConfig().companyName;
}
