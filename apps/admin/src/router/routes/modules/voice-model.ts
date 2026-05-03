import { DEFAULT_LAYOUT } from '../base';
import { AppRouteRecordRaw } from '../types';

const VOICE_MODEL: AppRouteRecordRaw = {
  path: '/voice-models',
  name: 'voiceModels',
  component: DEFAULT_LAYOUT,
  meta: {
    locale: 'menu.voiceModel',
    requiresAuth: true,
    icon: 'icon-sound',
    order: 3,
  },
  redirect: '/voice-models/timbres',
  children: [
    {
      path: 'timbres',
      name: 'VoiceTimbreList',
      component: () => import('@/views/voice-model/timbre/index.vue'),
      meta: {
        locale: 'menu.voiceModel.timbre',
        requiresAuth: true,
        roles: ['*'],
      },
    },
  ],
};

export default VOICE_MODEL;
