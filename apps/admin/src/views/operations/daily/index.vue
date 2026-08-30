<template>
  <div class="daily-detail-page">
    <header class="daily-detail-page__header">
      <div>
        <h1>每日明细</h1>
        <p>每日用户活跃、订单和收入数据</p>
      </div>
      <a-space>
        <a-month-picker
          v-model="month"
          value-format="YYYY-MM"
          :allow-clear="false"
          @change="fetch"
        />
        <a-button :loading="loading" @click="fetch">刷新</a-button>
      </a-space>
    </header>

    <a-spin :loading="loading">
      <a-table
        row-key="date"
        :data="daily"
        :pagination="false"
        :scroll="{ x: 1220 }"
      >
        <template #columns>
          <a-table-column title="日期" data-index="date" :width="130" />
          <a-table-column title="新增用户" data-index="newUsers" :width="110" />
          <a-table-column
            title="全部聊天人数"
            data-index="allChatUsers"
            :width="130"
          />
          <a-table-column
            title="3 日内新用户聊天人数"
            data-index="newUserChatUsers"
            :width="140"
          />
          <a-table-column
            title="全部消息数"
            data-index="userMessages"
            :width="120"
          />
          <a-table-column title="净收入" :width="130">
            <template #cell="{ record }">
              <strong>{{ formatMoney(record.netRevenue) }}</strong>
            </template>
          </a-table-column>
        </template>
      </a-table>
    </a-spin>
  </div>
</template>

<script lang="ts" setup>
  import { computed, onMounted, ref } from 'vue';
  import dayjs from 'dayjs';
  import { Message } from '@arco-design/web-vue';
  import type { AdminOperationsReportDTO } from '@tzl/shared';
  import { queryOperationsReport } from '@/api/operations';

  const month = ref(dayjs().format('YYYY-MM'));
  const loading = ref(false);
  const report = ref<AdminOperationsReportDTO>();

  const daily = computed(() => report.value?.daily || []);

  const formatMoney = (value?: number) =>
    `¥${Number(value || 0).toLocaleString('zh-CN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;

  const fetch = async () => {
    try {
      loading.value = true;
      const { data } = await queryOperationsReport(month.value);
      report.value = data;
    } catch {
      Message.error('每日明细加载失败');
    } finally {
      loading.value = false;
    }
  };

  onMounted(fetch);
</script>

<style lang="less" scoped>
  .daily-detail-page {
    min-height: 100%;
    padding: 24px;
    background: var(--color-fill-2);

    &__header {
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 18px;

      h1 {
        margin: 0 0 6px;
        font-size: 24px;
      }

      p {
        margin: 0;
        color: var(--color-text-3);
      }
    }
  }
</style>
