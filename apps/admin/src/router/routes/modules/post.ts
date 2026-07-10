import { DEFAULT_LAYOUT } from '../base';
import { AppRouteRecordRaw } from '../types';

const POST: AppRouteRecordRaw = {
  path: '/posts',
  name: 'posts',
  component: DEFAULT_LAYOUT,
  meta: {
    locale: 'menu.post',
    requiresAuth: true,
    icon: 'icon-message',
    order: 5,
    hideChildrenInMenu: true,
  },
  redirect: '/posts/list',
  children: [
    {
      path: 'list',
      name: 'PostList',
      component: () => import('@/views/post/list/index.vue'),
      meta: {
        activeMenu: 'posts',
        locale: 'menu.post.list',
        requiresAuth: true,
        roles: ['*'],
      },
    },
  ],
};

export default POST;
