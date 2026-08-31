/**
 * 品牌配置（管理后台端）
 *
 * 单一真值源为仓库根目录 brand/<brand>.json；
 * 构建时由 Vite define 注入（见 config/vite.config.base.ts），
 * 不注入任何参数时默认产出"天之灵"品牌。
 */
/* eslint-disable import/prefer-default-export */
export const brand = {
  /** 品牌标识 key */
  key: BRAND ?? 'tianzhiling',
  /** 产品名 */
  name: BRAND_NAME ?? '天之灵',
  /** 公司主体（协议与合规用） */
  companyName: BRAND_COMPANY ?? '武汉市天之灵智能技术有限公司',
  /** 后台标题 */
  adminTitle: BRAND_ADMIN_TITLE ?? '天之灵管理后台',
} as const;
