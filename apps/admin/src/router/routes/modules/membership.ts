import { DEFAULT_LAYOUT } from '../base';
import { AppRouteRecordRaw } from '../types';

const MEMBERSHIP: AppRouteRecordRaw = {
  path: '/membership',
  name: 'membership',
  component: DEFAULT_LAYOUT,
  meta: {
    locale: 'menu.membership',
    requiresAuth: true,
    icon: 'icon-gift',
    order: 3,
  },
  redirect: '/membership/vip-plans',
  children: [
    {
      path: 'vip-plans',
      name: 'VipPlanList',
      component: () => import('@/views/membership/vip-plan/index.vue'),
      meta: {
        locale: 'menu.membership.vipPlan',
        requiresAuth: true,
        roles: ['*'],
      },
    },
    {
      path: 'orders',
      name: 'MembershipOrderList',
      component: () => import('@/views/order/list/index.vue'),
      meta: {
        locale: 'menu.membership.order',
        requiresAuth: true,
        roles: ['*'],
        orderType: 'vip_plan',
      },
    },
    {
      path: 'entitlements',
      name: 'EntitlementList',
      component: () => import('@/views/membership/entitlement/index.vue'),
      meta: {
        locale: 'menu.membership.entitlement',
        requiresAuth: true,
        roles: ['*'],
      },
    },
  ],
};

export default MEMBERSHIP;
