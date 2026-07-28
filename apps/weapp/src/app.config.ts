export default {
  pages: [
    'pages/onboarding/index',
    'pages/index/index',
    'pages/contacts/index',
    'pages/me/index',
    'pages/chat/index',
    'pages/agent-detail/index',
    'pages/agent-create/index',
    'pages/agent-create-flow/index',
  ],
  subPackages: [
    {
      root: 'pages/chat-album',
      pages: ['index'],
    },
    {
      root: 'pages/memorial-photo',
      pages: ['index'],
    },
    {
      root: 'pages/agent-profile',
      pages: ['index'],
    },
    {
      root: 'pages/agent-form',
      pages: ['index'],
    },
    {
      root: 'pages/vip-center',
      pages: ['index'],
    },
    {
      root: 'pages/voice-package',
      pages: ['index'],
    },
    {
      root: 'pages/voice-package-success',
      pages: ['index'],
    },
    {
      root: 'pages/customer-service',
      pages: ['index'],
    },
    {
      root: 'pages/agreement',
      pages: ['index'],
    },
    {
      root: 'pages/payment-result',
      pages: ['index'],
    },
    {
      root: 'pages/auth',
      pages: ['index'],
    },
    {
      root: 'pages/my-messages',
      pages: ['index'],
    },
    {
      root: 'pages/my-posts',
      pages: ['index'],
    },
    {
      root: 'pages/post-detail',
      pages: ['index'],
    },
    {
      root: 'pages/my-orders',
      pages: ['index'],
    },
    {
      root: 'pages/post-create',
      pages: ['index'],
    },
    {
      root: 'pages/user-settings',
      pages: ['index'],
    },
    {
      root: 'pages/user-name-edit',
      pages: ['index'],
    },
    {
      root: 'pages/dev-login',
      pages: ['index'],
    },
  ],
  window: {
    backgroundTextStyle: 'light',
    navigationBarBackgroundColor: '#fffaf3',
    navigationBarTitleText: '天之灵',
    navigationBarTextStyle: 'black'
  },
  permission: {
    'scope.record': {
      desc: '用于发送语音消息和语音转文字',
    },
  },
  preloadRule: {
    'pages/index/index': {
      network: 'all',
      packages: ['pages/vip-center'],
    },
    'pages/chat/index': {
      network: 'all',
      packages: ['pages/vip-center'],
    },
  },
  tabBar: {
    custom: true,
    color: '#9ca3af',
    selectedColor: '#22c55e',
    backgroundColor: '#ffffff',
    list: [
      {
        pagePath: 'pages/index/index',
        text: '朋友圈',
      },
      {
        pagePath: 'pages/contacts/index',
        text: '通讯录',
      },
      {
        pagePath: 'pages/me/index',
        text: '我的',
      },
    ],
  }
}
