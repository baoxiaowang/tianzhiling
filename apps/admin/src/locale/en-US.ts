import localeMessageBox from '@/components/message-box/locale/en-US';
import localeLogin from '@/views/login/locale/en-US';

import localeWorkplace from '@/views/dashboard/workplace/locale/en-US';

import localeSettings from './en-US/settings';

export default {
  'menu.dashboard': 'Dashboard',
  'menu.server.dashboard': 'Dashboard-Server',
  'menu.server.workplace': 'Workplace-Server',
  'menu.server.monitor': 'Monitor-Server',
  'menu.list': 'List',
  'menu.result': 'Result',
  'menu.exception': 'Exception',
  'menu.form': 'Form',
  'menu.profile': 'Profile',
  'menu.visualization': 'Data Visualization',
  'menu.user': 'User Center',
  'menu.appUser': 'User Management',
  'menu.appUser.list': 'App Users',
  'menu.appUser.detail': 'User Detail',
  'menu.agent': 'Agent Management',
  'menu.agent.list': 'Agent List',
  'menu.agent.detail': 'Agent Detail',
  'menu.order': 'Order Management',
  'menu.order.list': 'Orders',
  'menu.voiceModel': 'Voice Models',
  'menu.voiceModel.timbre': 'Timbre Management',
  'menu.membership': 'Membership',
  'menu.membership.vipPlan': 'VIP Plans',
  'menu.membership.order': 'Membership Orders',
  'menu.membership.entitlement': 'Entitlements',
  'menu.arcoWebsite': 'Arco Design',
  'menu.faq': 'FAQ',
  'navbar.docs': 'Docs',
  'navbar.action.locale': 'Switch to English',
  ...localeSettings,
  ...localeMessageBox,
  ...localeLogin,
  ...localeWorkplace,
};
