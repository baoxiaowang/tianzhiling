import Taro from "@tarojs/taro";
import { OSS_MEDIA_BASE_URL } from "@tzl/shared";

const baseUrl = process.env.TARO_APP_API_BASE_URL ?? "";
const assetBaseUrl = process.env.TARO_APP_ASSET_BASE_URL ?? "";
const mediaBaseUrl = process.env.TARO_APP_MEDIA_BASE_URL ?? OSS_MEDIA_BASE_URL;
const devtoolsApiBaseUrl = process.env.TARO_APP_DEVTOOLS_API_BASE_URL ?? "";
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
