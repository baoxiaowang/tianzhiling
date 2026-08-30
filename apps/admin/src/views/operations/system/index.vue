<template>
  <div class="operations-page">
    <header class="operations-page__header">
      <div>
        <h1>系统运行</h1>
        <p>只读查看当前管理服务、版本和后台队列，不在这里直接修改生产配置。</p>
      </div>
      <a-button :loading="loading" @click="fetchRuntime">刷新</a-button>
    </header>

    <a-spin :loading="loading">
      <a-grid :cols="24" :col-gap="16" :row-gap="16">
        <a-grid-item :span="{ xs: 24, lg: 14 }">
          <a-card title="运行信息" :bordered="false">
            <a-descriptions :column="1" bordered>
              <a-descriptions-item label="服务">
                <a-tag color="green">{{ runtime?.service || '-' }} 正常</a-tag>
              </a-descriptions-item>
              <a-descriptions-item label="生产版本">
                <a-typography-text copyable>
                  {{ runtime?.releaseVersion || '-' }}
                </a-typography-text>
              </a-descriptions-item>
              <a-descriptions-item label="运行环境">
                {{ runtime?.nodeEnv || '-' }}
              </a-descriptions-item>
              <a-descriptions-item label="持续运行">
                {{ formatUptime(runtime?.uptimeSeconds) }}
              </a-descriptions-item>
              <a-descriptions-item label="数据时间">
                {{ formatDate(runtime?.generatedAt) }}
              </a-descriptions-item>
            </a-descriptions>
          </a-card>
        </a-grid-item>
        <a-grid-item :span="{ xs: 24, lg: 10 }">
          <a-card title="进程内存" :bordered="false">
            <a-statistic
              title="RSS"
              :value="runtime?.memory.rssMb || 0"
              suffix="MB"
            />
            <a-divider />
            <a-space size="large">
              <a-statistic
                title="已用堆内存"
                :value="runtime?.memory.heapUsedMb || 0"
                suffix="MB"
              />
              <a-statistic
                title="堆内存总量"
                :value="runtime?.memory.heapTotalMb || 0"
                suffix="MB"
              />
            </a-space>
          </a-card>
        </a-grid-item>
        <a-grid-item :span="24">
          <a-card title="后台队列" :bordered="false">
            <a-grid :cols="24" :col-gap="16" :row-gap="16">
              <a-grid-item
                v-for="item in queueCards"
                :key="item.key"
                :span="{ xs: 24, sm: 12, lg: 6 }"
              >
                <div class="operations-page__queue-card">
                  <span>{{ item.label }}</span>
                  <strong :class="{ 'operations-page__danger': item.danger }">
                    {{ item.value }}
                  </strong>
                  <a-link @click="router.push({ name: item.routeName })">
                    查看明细
                  </a-link>
                </div>
              </a-grid-item>
            </a-grid>
          </a-card>
        </a-grid-item>
      </a-grid>
    </a-spin>
  </div>
</template>

<script lang="ts" setup>
  import { computed, onMounted, ref } from 'vue';
  import { useRouter } from 'vue-router';
  import dayjs from 'dayjs';
  import { Message } from '@arco-design/web-vue';
  import type { AdminSystemRuntimeDTO } from '@tzl/shared';
  import { querySystemRuntime } from '@/api/operations';

  const router = useRouter();
  const loading = ref(false);
  const runtime = ref<AdminSystemRuntimeDTO>();
  const queueCards = computed(() => [
    {
      key: 'running-traces',
      label: '运行中的聊天链路',
      value: runtime.value?.queues.runningChatTraces || 0,
      danger: false,
      routeName: 'ChatQuality',
    },
    {
      key: 'failed-traces',
      label: '失败的聊天链路',
      value: runtime.value?.queues.failedChatTraces || 0,
      danger: Boolean(runtime.value?.queues.failedChatTraces),
      routeName: 'ChatQuality',
    },
  ]);

  const fetchRuntime = async () => {
    try {
      loading.value = true;
      const { data } = await querySystemRuntime();
      runtime.value = data;
    } catch (error) {
      Message.error('系统运行信息加载失败');
    } finally {
      loading.value = false;
    }
  };
  const formatDate = (value?: string) =>
    value ? dayjs(value).format('YYYY-MM-DD HH:mm:ss') : '-';
  const formatUptime = (seconds?: number) => {
    if (!Number.isFinite(seconds)) return '-';
    const days = Math.floor((seconds || 0) / 86400);
    const hours = Math.floor(((seconds || 0) % 86400) / 3600);
    const minutes = Math.floor(((seconds || 0) % 3600) / 60);
    return `${days} 天 ${hours} 小时 ${minutes} 分钟`;
  };

  onMounted(fetchRuntime);
</script>

<style lang="less" scoped>
  @import url('../operations-page.less');
</style>
