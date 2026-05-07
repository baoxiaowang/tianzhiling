import localeMessageBox from '@/components/message-box/locale/zh-CN';
import localeLogin from '@/views/login/locale/zh-CN';

import localeWorkplace from '@/views/dashboard/workplace/locale/zh-CN';

import localeSettings from './zh-CN/settings';

export default {
  'menu.dashboard': '仪表盘',
  'menu.server.dashboard': '仪表盘-服务端',
  'menu.server.workplace': '工作台-服务端',
  'menu.server.monitor': '实时监控-服务端',
  'menu.list': '列表页',
  'menu.result': '结果页',
  'menu.exception': '异常页',
  'menu.form': '表单页',
  'menu.profile': '详情页',
  'menu.visualization': '数据可视化',
  'menu.user': '个人中心',
  'menu.appUser': '用户管理',
  'menu.appUser.list': 'App 用户',
  'menu.appUser.detail': '用户详情',
  'menu.agent': 'Agent 管理',
  'menu.agent.list': 'Agent 列表',
  'menu.agent.detail': 'Agent 详情',
  'menu.order': '订单管理',
  'menu.order.list': '我的订单',
  'menu.voiceModel': '声音模型',
  'menu.voiceModel.timbre': '音色管理',
  'menu.voiceModel.package': '声音套餐',
  'menu.voiceModel.trainingTask': '训练任务',
  'menu.membership': '会员权益',
  'menu.membership.vipPlan': 'VIP计划',
  'menu.membership.order': '会员订单',
  'menu.membership.entitlement': '权益管理',
  'menu.arcoWebsite': 'Arco Design',
  'menu.faq': '常见问题',
  'navbar.docs': '文档中心',
  'navbar.action.locale': '切换为中文',
  ...localeSettings,
  ...localeMessageBox,
  ...localeLogin,
  ...localeWorkplace,
};
