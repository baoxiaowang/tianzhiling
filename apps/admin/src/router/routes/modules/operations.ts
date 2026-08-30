import { DEFAULT_LAYOUT } from '../base';
import { AppRouteRecordRaw } from '../types';

const OPERATIONS: AppRouteRecordRaw = {
  path: '/operations',
  name: 'operations',
  component: DEFAULT_LAYOUT,
  meta: {
    locale: 'menu.operations',
    requiresAuth: true,
    icon: 'icon-apps',
    order: 3,
  },
  redirect: '/operations/reports',
  children: [
    {
      path: 'reports',
      name: 'OperationsReports',
      component: () => import('@/views/operations/reports/index.vue'),
      meta: {
        locale: 'menu.operations.reports',
        requiresAuth: true,
        roles: ['*'],
      },
    },
    {
      path: 'tasks',
      name: 'OperationsTaskCenter',
      component: () => import('@/views/operations/task-center/index.vue'),
      meta: {
        locale: 'menu.operations.taskCenter',
        requiresAuth: true,
        roles: ['*'],
      },
    },
  ],
};

export default OPERATIONS;
