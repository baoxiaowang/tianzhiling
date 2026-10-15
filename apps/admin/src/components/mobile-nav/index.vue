<template>
  <nav class="mobile-tabbar">
    <button
      v-for="item in items"
      :key="item.key"
      type="button"
      class="mobile-tabbar__item"
      :class="{ 'is-active': item.key === activeKey }"
      @click="handleClick(item)"
    >
      <component :is="item.icon" class="mobile-tabbar__icon" />
      <span class="mobile-tabbar__label">{{ item.label }}</span>
    </button>
  </nav>
</template>

<script lang="ts" setup>
  import { computed, inject } from 'vue';
  import { useRoute, useRouter } from 'vue-router';
  import {
    IconApps,
    IconUserGroup,
    IconHome,
    IconUnorderedList,
    IconVoice,
  } from '@arco-design/web-vue/es/icon';

  type TabItem = {
    key: string;
    label: string;
    icon: unknown;
    path?: string;
  };

  const router = useRouter();
  const route = useRoute();
  const toggleDrawerMenu = inject<(() => void) | undefined>('toggleDrawerMenu');

  const items: TabItem[] = [
    {
      key: 'dashboard',
      label: '数据',
      icon: IconHome,
      path: '/dashboard/workplace',
    },
    {
      key: 'orders',
      label: '订单',
      icon: IconUnorderedList,
      path: '/orders/list',
    },
    {
      key: 'users',
      label: '用户',
      icon: IconUserGroup,
      path: '/app-users/list',
    },
    {
      key: 'voice',
      label: '声音',
      icon: IconVoice,
      path: '/voice-models/timbres',
    },
    { key: 'more', label: '全部', icon: IconApps },
  ];

  const activeKey = computed(() => {
    const found = items.find(
      (item) =>
        item.path &&
        route.path.startsWith(item.path.split('/').slice(0, 2).join('/'))
    );
    return found?.key || '';
  });

  const handleClick = (item: TabItem) => {
    if (item.path) {
      if (route.path !== item.path) router.push(item.path);
      return;
    }
    toggleDrawerMenu?.();
  };
</script>

<style lang="less" scoped>
  .mobile-tabbar {
    position: fixed;
    right: 0;
    bottom: 0;
    left: 0;
    z-index: 90;
    display: flex;
    align-items: stretch;
    height: 56px;
    padding-bottom: env(safe-area-inset-bottom, 0);
    background-color: var(--color-bg-2);
    border-top: 1px solid var(--color-border-2);
  }

  .mobile-tabbar__item {
    display: flex;
    flex: 1 1 0;
    flex-direction: column;
    gap: 2px;
    align-items: center;
    justify-content: center;
    min-width: 0;
    padding: 6px 2px;
    font-size: 11px;
    color: var(--color-text-3);
    cursor: pointer;
    background: transparent;
    border: 0;
  }

  .mobile-tabbar__item.is-active {
    color: rgb(var(--primary-6));
  }

  .mobile-tabbar__icon {
    font-size: 20px;
  }

  .mobile-tabbar__label {
    line-height: 1.1;
  }
</style>
