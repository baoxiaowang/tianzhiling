import { DEFAULT_LAYOUT } from '../base';
import { AppRouteRecordRaw } from '../types';

const APP_USER: AppRouteRecordRaw = {
  path: '/app-users',
  name: 'appUsers',
  component: DEFAULT_LAYOUT,
  meta: {
    locale: 'menu.appUser',
    requiresAuth: true,
    icon: 'icon-user-group',
    order: 1,
  },
  redirect: '/app-users/list',
  children: [
    {
      path: 'list',
      name: 'AppUserList',
      component: () => import('@/views/app-user/list/index.vue'),
      meta: {
        activeMenu: 'appUsers',
        locale: 'menu.appUser.list',
        requiresAuth: true,
        roles: ['*'],
      },
    },
    {
      path: 'members',
      name: 'AppUserMembers',
      component: () => import('@/views/app-user/classified-list/index.vue'),
      meta: {
        locale: 'menu.appUser.members',
        requiresAuth: true,
        roles: ['*'],
      },
    },
    {
      path: 'voice-services',
      name: 'AppUserVoiceServices',
      component: () => import('@/views/app-user/classified-list/index.vue'),
      meta: {
        locale: 'menu.appUser.voiceServices',
        requiresAuth: true,
        roles: ['*'],
      },
    },
    {
      path: 'detail/:id',
      name: 'AppUserDetail',
      component: () => import('@/views/app-user/detail/index.vue'),
      meta: {
        activeMenu: 'AppUserList',
        locale: 'menu.appUser.detail',
        requiresAuth: true,
        roles: ['*'],
        hideInMenu: true,
      },
    },
  ],
};

export default APP_USER;
