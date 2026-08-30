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
  children: [
    {
      path: 'daily',
      name: 'OperationsDaily',
      component: () => import('@/views/operations/daily/index.vue'),
      meta: {
        locale: 'menu.operations.daily',
        requiresAuth: true,
        roles: ['*'],
      },
    },
    {
      path: 'user-value',
      name: 'OperationsUserValue',
      component: () => import('@/views/operations/user-value/index.vue'),
      meta: {
        locale: 'menu.operations.userValue',
        requiresAuth: true,
        roles: ['*'],
      },
    },
  ],
};

export default OPERATIONS;
