<template>
  <div class="operations-page">
    <header class="operations-page__header">
      <div>
        <h1>任务中心</h1>
        <p>统一跟踪聊天截图识别与导入，不再通过页面是否转圈判断结果。</p>
      </div>
      <a-space>
        <a-select
          v-model="filters.status"
          allow-clear
          placeholder="全部状态"
          style="width: 180px"
          @change="reload"
        >
          <a-option
            v-for="option in statusOptions"
            :key="option.value"
            :value="option.value"
          >
            {{ option.label }}
          </a-option>
        </a-select>
        <a-button :loading="loading" @click="fetchTasks">刷新</a-button>
      </a-space>
    </header>

    <a-card :bordered="false">
      <a-table
        row-key="id"
        :data="tasks"
        :loading="loading"
        :pagination="false"
        :scroll="{ x: 1280 }"
      >
        <template #columns>
          <a-table-column title="任务" :width="230">
            <template #cell="{ record }">
              <strong>{{ record.title }}</strong>
              <div class="operations-page__muted">{{ record.id }}</div>
            </template>
          </a-table-column>
          <a-table-column title="状态" :width="130">
            <template #cell="{ record }">
              <a-tag :color="statusColor(record.status)">
                {{ statusLabel(record.status) }}
              </a-tag>
            </template>
          </a-table-column>
          <a-table-column title="进度" :width="220">
            <template #cell="{ record }">
              <a-progress
                :percent="
                  progressPercent(record.progressCurrent, record.progressTotal)
                "
                :show-text="false"
                size="small"
              />
              <div class="operations-page__muted">
                已识别 {{ record.progressCurrent }} /
                {{ record.progressTotal }}， 去重 {{ record.duplicateCount }}
              </div>
            </template>
          </a-table-column>
          <a-table-column title="用户 / 智能体" :width="240">
            <template #cell="{ record }">
              <div class="operations-page__identity">
                <a-link @click="goUser(record.userId)"
                  >用户 {{ shortId(record.userId) }}</a-link
                >
                <a-link @click="goAgent(record.agentId)"
                  >智能体 {{ shortId(record.agentId) }}</a-link
                >
              </div>
            </template>
          </a-table-column>
          <a-table-column title="错误" :width="280">
            <template #cell="{ record }">
              <template v-if="record.errorCode || record.errorDetail">
                <strong>{{ record.errorCode || '执行失败' }}</strong>
                <div class="operations-page__muted">
                  {{ record.errorDetail || '-' }}
                </div>
              </template>
              <span v-else>-</span>
            </template>
          </a-table-column>
          <a-table-column title="重试" data-index="retryCount" :width="90" />
          <a-table-column title="开始时间" :width="170">
            <template #cell="{ record }">{{
              formatDate(record.startedAt)
            }}</template>
          </a-table-column>
          <a-table-column title="更新时间" :width="170">
            <template #cell="{ record }">{{
              formatDate(record.updatedAt)
            }}</template>
          </a-table-column>
          <a-table-column title="操作" :width="110" fixed="right">
            <template #cell="{ record }">
              <a-link @click="goAgent(record.agentId)">查看对话</a-link>
            </template>
          </a-table-column>
        </template>
      </a-table>

      <div class="operations-page__pagination">
        <span>共 {{ pagination.total }} 个任务</span>
        <a-pagination
          :current="pagination.current"
          :page-size="pagination.pageSize"
          :total="pagination.total"
          show-page-size
          @change="onPageChange"
          @page-size-change="onPageSizeChange"
        />
      </div>
    </a-card>
  </div>
</template>

<script lang="ts" setup>
  import { onMounted, reactive, ref } from 'vue';
  import { useRouter } from 'vue-router';
  import dayjs from 'dayjs';
  import { Message } from '@arco-design/web-vue';
  import type { AdminOperationsTaskDTO } from '@tzl/shared';
  import { queryOperationsTasks } from '@/api/operations';

  const router = useRouter();
  const loading = ref(false);
  const tasks = ref<AdminOperationsTaskDTO[]>([]);
  const filters = reactive({ status: '' });
  const pagination = reactive({ current: 1, pageSize: 20, total: 0 });
  const statusOptions = [
    { value: 'queued', label: '等待中' },
    { value: 'recognizing', label: '识别中' },
    { value: 'importing', label: '导入中' },
    { value: 'completed', label: '已完成' },
    { value: 'partial_failed', label: '部分失败' },
    { value: 'failed', label: '失败' },
    { value: 'canceled', label: '已取消' },
  ];

  const fetchTasks = async () => {
    try {
      loading.value = true;
      const { data } = await queryOperationsTasks({
        page: pagination.current,
        pageSize: pagination.pageSize,
        status: filters.status || undefined,
      });
      tasks.value = data.items;
      pagination.total = data.total;
      pagination.current = data.page;
      pagination.pageSize = data.pageSize;
    } catch (error) {
      Message.error('任务列表加载失败');
    } finally {
      loading.value = false;
    }
  };

  const reload = () => {
    pagination.current = 1;
    fetchTasks();
  };
  const onPageChange = (value: number) => {
    pagination.current = value;
    fetchTasks();
  };
  const onPageSizeChange = (value: number) => {
    pagination.pageSize = value;
    reload();
  };
  const statusLabel = (value: string) =>
    ({
      draft: '草稿',
      uploading: '上传中',
      queued: '等待中',
      recognizing: '识别中',
      needs_review: '待确认',
      importing: '导入中',
      extracting_memory: '提取记忆',
      needs_memory_review: '待审核记忆',
      completed: '已完成',
      partial_failed: '部分失败',
      failed: '失败',
      canceled: '已取消',
    }[value] ||
    value ||
    '未知');
  const statusColor = (value: string) => {
    if (value === 'completed') return 'green';
    if (['failed', 'partial_failed'].includes(value)) return 'red';
    if (value === 'canceled') return 'gray';
    return 'arcoblue';
  };
  const progressPercent = (current: number, total: number) =>
    total > 0 ? Math.min(current / total, 1) : 0;
  const shortId = (value: string) => (value ? value.slice(-8) : '-');
  const formatDate = (value?: string) =>
    value ? dayjs(value).format('YYYY-MM-DD HH:mm') : '-';
  const goAgent = (id: string) =>
    id && router.push({ name: 'AgentDetail', params: { id } });
  const goUser = (id: string) =>
    id && router.push({ name: 'AppUserDetail', params: { id } });

  onMounted(fetchTasks);
</script>

<style lang="less" scoped>
  @import url('../operations-page.less');
</style>
