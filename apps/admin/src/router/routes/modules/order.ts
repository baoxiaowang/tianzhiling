import { DEFAULT_LAYOUT } from '../base';
import { AppRouteRecordRaw } from '../types';

const ORDER: AppRouteRecordRaw = {
  path: '/orders',
  name: 'orders',
  component: DEFAULT_LAYOUT,
  meta: {
    locale: 'menu.order',
    requiresAuth: true,
    icon: 'icon-list',
    order: 4,
  },
  redirect: '/orders/list',
  children: [
    {
      path: 'list',
      name: 'OrderList',
      component: () => import('@/views/order/list/index.vue'),
      meta: {
        locale: 'menu.order.list',
        requiresAuth: true,
        roles: ['*'],
      },
    },
  ],
};

export default ORDER;
