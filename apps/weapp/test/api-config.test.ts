function loadApiConfig(platform: string, apiBaseUrl: string) {
  jest.resetModules();
  process.env.TARO_APP_API_BASE_URL = apiBaseUrl;
  process.env.TARO_APP_ASSET_BASE_URL = apiBaseUrl;
  process.env.TARO_APP_DEVTOOLS_API_BASE_URL = "http://127.0.0.1:7001";
  jest.doMock("@tarojs/taro", () => ({
    __esModule: true,
    default: {
      getSystemInfoSync: () => ({ platform }),
    },
  }));

  return require("../src/api/api-config") as typeof import("../src/api/api-config");
}

describe("ApiConfig local development routing", () => {
  const originalApiBaseUrl = process.env.TARO_APP_API_BASE_URL;
  const originalAssetBaseUrl = process.env.TARO_APP_ASSET_BASE_URL;
  const originalDevtoolsApiBaseUrl = process.env.TARO_APP_DEVTOOLS_API_BASE_URL;

  afterEach(() => {
    process.env.TARO_APP_API_BASE_URL = originalApiBaseUrl;
    process.env.TARO_APP_ASSET_BASE_URL = originalAssetBaseUrl;
    process.env.TARO_APP_DEVTOOLS_API_BASE_URL = originalDevtoolsApiBaseUrl;
    jest.resetModules();
  });

  it("uses loopback for a private-network API inside WeChat DevTools", () => {
    const { ApiConfig } = loadApiConfig(
      "devtools",
      "http://192.168.31.149:7001"
    );

    expect(ApiConfig.baseUrl).toBe("http://127.0.0.1:7001");
    expect(ApiConfig.assetBaseUrl).toBe("http://127.0.0.1:7001");
  });

  it("keeps the LAN address for physical-device testing", () => {
    const { ApiConfig } = loadApiConfig("ios", "http://192.168.31.149:7001");

    expect(ApiConfig.baseUrl).toBe("http://192.168.31.149:7001");
  });

  it("does not rewrite a public HTTPS API", () => {
    const { ApiConfig } = loadApiConfig("devtools", "https://tianzhiling.chat");

    expect(ApiConfig.baseUrl).toBe("https://tianzhiling.chat");
  });
});
