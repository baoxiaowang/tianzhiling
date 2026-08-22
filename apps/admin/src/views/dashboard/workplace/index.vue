<template>
  <div class="operations-dashboard">
    <header class="operations-dashboard__header">
      <div>
        <h1>运营工作台</h1>
        <p>先处理异常，再进入用户、智能体和内容完成具体工作。</p>
      </div>
      <a-space>
        <a-typography-text type="secondary">
          数据更新：{{ formatDate(overview?.generatedAt) }}
        </a-typography-text>
        <a-button :loading="loading" @click="fetchOverview">刷新</a-button>
      </a-space>
    </header>

    <a-spin :loading="loading">
      <a-grid :cols="24" :col-gap="16" :row-gap="16">
        <a-grid-item
          v-for="metric in overview?.metrics || []"
          :key="metric.key"
          :span="{ xs: 24, sm: 12, md: 8, xl: 4 }"
        >
          <a-card class="operations-dashboard__metric" :bordered="false">
            <div class="operations-dashboard__metric-label">
              {{ metric.label }}
              <span
                class="operations-dashboard__metric-dot"
                :class="`operations-dashboard__metric-dot--${metric.tone}`"
              />
            </div>
            <div class="operations-dashboard__metric-value">
              {{ formatNumber(metric.value) }}
            </div>
            <a-typography-text type="secondary">
              {{ metric.hint }}
            </a-typography-text>
          </a-card>
        </a-grid-item>

        <a-grid-item :span="{ xs: 24, lg: 16 }">
          <a-card title="待关注" :bordered="false">
            <template #extra>
              <a-link @click="router.push({ name: 'ChatQuality' })">
                查看聊天质量
              </a-link>
            </template>
            <a-list
              v-if="overview?.alerts.length"
              :data="overview.alerts"
              :bordered="false"
            >
              <template #item="{ item }">
                <a-list-item class="operations-dashboard__alert">
                  <a-list-item-meta
                    :title="item.title"
                    :description="item.description || '暂无补充信息'"
                  >
                    <template #avatar>
                      <a-tag :color="alertColor(item.category)">
                        {{ alertLabel(item.category) }}
                      </a-tag>
                    </template>
                  </a-list-item-meta>
                  <template #actions>
                    <span>{{ formatDate(item.occurredAt) }}</span>
                    <a-link
                      v-if="item.targetType && item.targetId"
                      @click="openAlert(item.targetType, item.targetId)"
                    >
                      查看
                    </a-link>
                  </template>
                </a-list-item>
              </template>
            </a-list>
            <a-empty v-else description="当前没有需要处理的异常" />
          </a-card>
        </a-grid-item>

        <a-grid-item :span="{ xs: 24, lg: 8 }">
          <a-card title="常用工作" :bordered="false">
            <div class="operations-dashboard__shortcuts">
              <button
                v-for="shortcut in shortcuts"
                :key="shortcut.routeName"
                type="button"
                @click="router.push({ name: shortcut.routeName })"
              >
                <strong>{{ shortcut.title }}</strong>
                <span>{{ shortcut.description }}</span>
              </button>
            </div>
          </a-card>
        </a-grid-item>
      </a-grid>
    </a-spin>
  </div>
</template>

<script lang="ts" setup>
  import { onMounted, ref } from 'vue';
  import { useRouter } from 'vue-router';
  import dayjs from 'dayjs';
  import { Message } from '@arco-design/web-vue';
  import type {
    AdminOperationsAlertDTO,
    AdminOperationsOverviewDTO,
  } from '@tzl/shared';
  import { queryOperationsOverview } from '@/api/operations';

  const router = useRouter();
  const loading = ref(false);
  const overview = ref<AdminOperationsOverviewDTO>();
  const shortcuts = [
    {
      title: '查找用户',
      description: '查看关系、智能体与动态',
      routeName: 'AppUserList',
    },
    {
      title: '智能体管理',
      description: '检查人设与真实聊天',
      routeName: 'AgentList',
    },
    {
      title: '内容运营',
      description: '置顶、风控与内容查看',
      routeName: 'PostList',
    },
    {
      title: '任务中心',
      description: '跟踪聊天截图导入进度',
      routeName: 'OperationsTaskCenter',
    },
    {
      title: '系统运行',
      description: '查看版本、内存与队列',
      routeName: 'OperationsSystem',
    },
  ];

  const fetchOverview = async () => {
    try {
      loading.value = true;
      const { data } = await queryOperationsOverview();
      overview.value = data;
    } catch (error) {
      Message.error('运营数据加载失败');
    } finally {
      loading.value = false;
    }
  };

  const openAlert = (
    targetType: NonNullable<AdminOperationsAlertDTO['targetType']>,
    targetId: string
  ) => {
    if (targetType === 'agent') {
      router.push({ name: 'AgentDetail', params: { id: targetId } });
      return;
    }
    if (targetType === 'user') {
      router.push({ name: 'AppUserDetail', params: { id: targetId } });
      return;
    }
    router.push({ name: 'PostList', query: { keyword: targetId } });
  };

  const alertLabel = (category: AdminOperationsAlertDTO['category']) =>
    ({ feedback: '反馈', chat: '聊天', import: '导入', content: '内容' }[
      category
    ]);

  const alertColor = (category: AdminOperationsAlertDTO['category']) =>
    ({ feedback: 'orangered', chat: 'red', import: 'orange', content: 'blue' }[
      category
    ]);

  const formatDate = (value?: string) =>
    value ? dayjs(value).format('MM-DD HH:mm') : '-';
  const formatNumber = (value: number) => value.toLocaleString('zh-CN');

  onMounted(fetchOverview);
</script>

<script lang="ts">
  export default { name: 'Dashboard' };
</script>

<style lang="less" scoped>
  .operations-dashboard {
    min-height: 100%;
    padding: 24px;
    background: var(--color-fill-2);

    &__header {
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      margin-bottom: 20px;

      h1 {
        margin: 0 0 8px;
        font-size: 24px;
      }

      p {
        margin: 0;
        color: var(--color-text-3);
      }
    }

    &__metric {
      min-height: 142px;
    }

    &__metric-label {
      display: flex;
      align-items: center;
      justify-content: space-between;
      color: var(--color-text-2);
    }

    &__metric-dot {
      width: 8px;
      height: 8px;
      background: rgb(var(--gray-5));
      border-radius: 50%;

      &--success {
        background: rgb(var(--green-6));
      }

      &--warning {
        background: rgb(var(--orange-6));
      }

      &--danger {
        background: rgb(var(--red-6));
      }
    }

    &__metric-value {
      margin: 16px 0 8px;
      font-weight: 600;
      font-size: 28px;
    }

    &__alert :deep(.arco-list-item-action) {
      align-items: center;
      color: var(--color-text-3);
    }

    &__shortcuts {
      display: grid;
      gap: 10px;

      button {
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding: 14px 16px;
        color: var(--color-text-1);
        text-align: left;
        background: var(--color-fill-1);
        border: 1px solid transparent;
        border-radius: 8px;
        cursor: pointer;

        &:hover {
          background: rgb(var(--arcoblue-1));
          border-color: rgb(var(--arcoblue-3));
        }

        span {
          color: var(--color-text-3);
          font-size: 12px;
        }
      }
    }
  }

  @media (max-width: 768px) {
    .operations-dashboard {
      padding: 16px;

      &__header {
        align-items: flex-start;
        flex-direction: column;
        gap: 12px;
      }
    }
  }
</style>
