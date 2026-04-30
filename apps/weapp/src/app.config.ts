export default {
  pages: [
    'pages/index/index',
    'pages/contacts/index',
    'pages/me/index',
    'pages/chat/index',
    'pages/agent-detail/index',
    'pages/vip-center/index',
    'pages/payment-result/index',
    'pages/agent-create/index',
    'pages/agent-create-flow/index',
    'pages/auth/index',
    'pages/my-posts/index',
    'pages/post-create/index',
    'pages/user-settings/index',
    'pages/user-name-edit/index',
  ],
  window: {
    backgroundTextStyle: 'light',
    navigationBarBackgroundColor: '#fffaf3',
    navigationBarTitleText: '天之灵',
    navigationBarTextStyle: 'black'
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
