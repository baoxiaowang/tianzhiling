import { DEFAULT_LAYOUT } from '../base';
import { AppRouteRecordRaw } from '../types';

const DASHBOARD: AppRouteRecordRaw = {
  path: '/dashboard',
  name: 'dashboard',
  component: DEFAULT_LAYOUT,
  meta: {
    locale: 'menu.dashboard',
    requiresAuth: true,
    icon: 'icon-dashboard',
    order: 0,
  },
  children: [
    {
      path: 'workplace',
      name: 'Workplace',
      component: () => import('@/views/dashboard/workplace/index.vue'),
      meta: {
        locale: 'menu.dashboard.workplace',
        requiresAuth: true,
        roles: ['*'],
      },
    },
    {
      path: 'daily',
      name: 'DashboardDaily',
      component: () => import('@/views/dashboard/daily/index.vue'),
      meta: {
        locale: 'menu.dashboard.daily',
        requiresAuth: true,
        roles: ['*'],
        hideInMenu: true,
        activeMenu: 'Workplace',
      },
    },
  ],
};

export default DASHBOARD;
