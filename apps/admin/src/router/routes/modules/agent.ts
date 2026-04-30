import { DEFAULT_LAYOUT } from '../base';
import { AppRouteRecordRaw } from '../types';

const AGENT: AppRouteRecordRaw = {
  path: '/agents',
  name: 'agents',
  component: DEFAULT_LAYOUT,
  meta: {
    locale: 'menu.agent',
    requiresAuth: true,
    icon: 'icon-robot',
    order: 2,
    hideChildrenInMenu: true,
  },
  redirect: '/agents/list',
  children: [
    {
      path: 'list',
      name: 'AgentList',
      component: () => import('@/views/agent/list/index.vue'),
      meta: {
        locale: 'menu.agent.list',
        requiresAuth: true,
        roles: ['*'],
        activeMenu: 'agents',
      },
    },
    {
      path: 'detail/:id',
      name: 'AgentDetail',
      component: () => import('@/views/agent/detail/index.vue'),
      meta: {
        locale: 'menu.agent.detail',
        requiresAuth: true,
        roles: ['*'],
        hideInMenu: true,
        activeMenu: 'AgentList',
      },
    },
  ],
};

export default AGENT;
