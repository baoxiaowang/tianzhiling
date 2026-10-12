import Taro from "@tarojs/taro";
import { brand } from "../config/brand";

const configuredBaseUrl = process.env.TARO_APP_API_BASE_URL ?? "";
const configuredAssetBaseUrl = process.env.TARO_APP_ASSET_BASE_URL ?? "";
const configuredMediaBaseUrl = process.env.TARO_APP_MEDIA_BASE_URL ?? "";
const devtoolsApiBaseUrl = process.env.TARO_APP_DEVTOOLS_API_BASE_URL ?? "";

/**
 * 生产地址按品牌注入（brand/<brand>.json → config defineConstants）。
 *
 * 显式 TARO_APP_* 仍优先：本地联调（.env.development 的局域网地址）
 * 与特殊部署可以覆盖；生产构建留空，避免串到另一品牌的接口。
 *
 * 这里不再回落 @tzl/shared 的 OSS 常量：否则未了言包里会残留天之灵的
 * 媒体域名（发布校验会直接拦下）。
 */
const baseUrl = configuredBaseUrl || brand.weappApiBaseUrl;
const assetBaseUrl = configuredAssetBaseUrl || brand.weappAssetBaseUrl;
const mediaBaseUrl = configuredMediaBaseUrl || brand.weappMediaBaseUrl;
const LOCAL_API_URL_PATTERN =
  /^http:\/\/(?:localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+)(?::\d+)?(?:\/|$)/i;

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

function normalizeConfiguredUrl(value: string) {
  const trimmed = value.trim();

  if (!trimmed) {
    return "";
  }

  return trimTrailingSlash(trimmed);
}

function getDevtoolsApiBaseUrl() {
  if (!LOCAL_API_URL_PATTERN.test(normalizeConfiguredUrl(baseUrl))) {
    return "";
  }

  try {
    if (Taro.getSystemInfoSync().platform !== "devtools") {
      return "";
    }
  } catch {
    return "";
  }

  return normalizeConfiguredUrl(devtoolsApiBaseUrl);
}

export const ApiConfig = {
  get baseUrl() {
    return getDevtoolsApiBaseUrl() || normalizeConfiguredUrl(baseUrl);
  },

  get assetBaseUrl() {
    const configured = normalizeConfiguredUrl(assetBaseUrl);

    return getDevtoolsApiBaseUrl() || configured || this.baseUrl;
  },

  get mediaBaseUrl() {
    return normalizeConfiguredUrl(mediaBaseUrl);
  },
};

export function isLocalApiEnvironment() {
  return LOCAL_API_URL_PATTERN.test(ApiConfig.baseUrl);
}
