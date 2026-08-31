const isVoiceTrainingTestMode =
  process.env.TARO_APP_VOICE_TRAINING_TEST_MODE === "true";

// 品牌导航标题：构建时通过 BRAND_WEAPP_NAV_TITLE 注入，默认天之灵
const brandNavTitle = process.env.BRAND_WEAPP_NAV_TITLE || "天之灵";

export default {
  lazyCodeLoading: "requiredComponents",
  pages: isVoiceTrainingTestMode
    ? [
        "pages/voice-training-test/index",
        "pages/onboarding/index",
        "pages/agent-share/index",
        "pages/index/index",
        "pages/contacts/index",
        "pages/me/index",
        "pages/chat/index",
      ]
    : [
        "pages/onboarding/index",
        "pages/agent-share/index",
        "pages/index/index",
        "pages/contacts/index",
        "pages/me/index",
        "pages/chat/index",
      ],
  subPackages: [
    {
      root: "pages/agent-detail",
      pages: ["index"],
    },
    {
      root: "pages/agent-create",
      pages: ["index"],
    },
    {
      root: "pages/agent-create-flow",
      pages: ["index"],
    },
    {
      root: "pages/chat-album",
      pages: ["index"],
    },
    {
      root: "pages/chat-import",
      pages: ["index"],
    },
    {
      root: "pages/memorial-photo",
      pages: ["index"],
    },
    {
      root: "pages/agent-profile",
      pages: ["index"],
    },
    {
      root: "pages/agent-profile-detail",
      pages: ["index"],
    },
    {
      root: "pages/agent-form",
      pages: ["index"],
    },
    {
      root: "pages/vip-center",
      pages: ["index"],
    },
    {
      root: "pages/voice-package",
      pages: ["index"],
    },
    {
      root: "pages/voice-library",
      pages: ["index"],
    },
    {
      root: "pages/voice-timbre-detail",
      pages: ["index"],
    },
    {
      root: "pages/voice-package-success",
      pages: ["index"],
    },
    {
      root: "pages/customer-service",
      pages: ["index"],
    },
    {
      root: "pages/agreement",
      pages: ["index"],
    },
    {
      root: "pages/payment-result",
      pages: ["index"],
    },
    {
      root: "pages/auth",
      pages: ["index"],
    },
    {
      root: "pages/my-messages",
      pages: ["index"],
    },
    {
      root: "pages/my-agents",
      pages: ["index"],
    },
    {
      root: "pages/my-posts",
      pages: ["index"],
    },
    {
      root: "pages/post-detail",
      pages: ["index"],
    },
    {
      root: "pages/my-orders",
      pages: ["index"],
    },
    {
      root: "pages/post-create",
      pages: ["index"],
    },
    {
      root: "pages/user-settings",
      pages: ["index"],
    },
    {
      root: "pages/account-cancellation",
      pages: ["index"],
    },
    {
      root: "pages/user-name-edit",
      pages: ["index"],
    },
    {
      root: "pages/dev-login",
      pages: ["index"],
    },
  ],
  window: {
    backgroundTextStyle: "light",
    navigationBarBackgroundColor: "#fffaf3",
    navigationBarTitleText: brandNavTitle,
    navigationBarTextStyle: "black",
  },
  networkTimeout: {
    uploadFile: 5 * 60 * 1000,
  },
  permission: {
    "scope.record": {
      desc: "用于发送语音消息和语音转文字",
    },
  },
  ...(isVoiceTrainingTestMode
    ? {}
    : {
        plugins: {
          WechatSI: {
            version: "0.3.5",
            provider: "wx069ba97219f66d99",
          },
        },
      }),
  preloadRule: {
    "pages/agent-create/index": {
      network: "all",
      packages: ["pages/agent-create-flow"],
    },
  },
  tabBar: {
    custom: true,
    color: "#9ca3af",
    selectedColor: "#22c55e",
    backgroundColor: "#ffffff",
    list: [
      {
        pagePath: "pages/index/index",
        text: "朋友圈",
      },
      {
        pagePath: "pages/contacts/index",
        text: "聊天",
      },
      {
        pagePath: "pages/me/index",
        text: "我的",
      },
    ],
  },
};
