<template>
  <div class="daily-detail-page">
    <header class="daily-detail-page__header">
      <div>
        <h1>每日明细</h1>
        <p>每日用户活跃、订单、收入与推广费用</p>
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
        class="daily-detail-page__table"
        row-key="date"
        :data="daily"
        :pagination="false"
      >
        <template #columns>
          <a-table-column title="序号" :width="56">
            <template #cell="{ rowIndex }">{{ rowIndex + 1 }}</template>
          </a-table-column>
          <a-table-column title="日期" data-index="date" :width="96" />
          <a-table-column title="新增用户" data-index="newUsers" />
          <a-table-column title="聊天人数" data-index="allChatUsers" />
          <a-table-column
            title="3 日新客聊天"
            data-index="newUserChatUsers"
            :width="116"
          />
          <a-table-column title="用户消息" data-index="userMessages" />
          <a-table-column title="净收入">
            <template #cell="{ record }">
              <strong>{{ formatMoney(record.netRevenue) }}</strong>
            </template>
          </a-table-column>
          <a-table-column title="累计收入">
            <template #cell="{ record }">
              {{ formatMoney(record.cohortRevenue) }}
            </template>
          </a-table-column>
          <a-table-column title="推广费" :width="170">
            <template #cell="{ record }">
              <a-input-number
                class="daily-detail-page__promotion-input"
                :model-value="promotionDraft(record)"
                :min="0"
                :precision="2"
                :step="0.01"
                size="small"
                @change="(value) => onPromotionChange(record, value)"
                @press-enter="flushPromotion(record)"
                @blur="flushPromotion(record)"
              />
            </template>
          </a-table-column>
          <a-table-column title="盈利">
            <template #cell="{ record }">
              <strong>{{ formatMoney(profitFor(record)) }}</strong>
            </template>
          </a-table-column>
          <a-table-column title="单客收益">
            <template #cell="{ record }">
              {{
                record.newUsers > 0
                  ? formatMoney(record.cohortRevenue / record.newUsers)
                  : '—'
              }}
            </template>
          </a-table-column>
        </template>
      </a-table>
    </a-spin>
  </div>
</template>

<script lang="ts" setup>
  import { computed, onMounted, onUnmounted, reactive, ref } from 'vue';
  import dayjs from 'dayjs';
  import { Message } from '@arco-design/web-vue';
  import type {
    AdminOperationsDailyPointDTO,
    AdminOperationsReportDTO,
  } from '@tzl/shared';
  import {
    queryOperationsReport,
    updateDailyPromotionExpense,
  } from '@/api/operations';
  import { getDouyinPromotionExpense } from '@tzl/shared/src/douyin-promotion-expenses';

  const month = ref(dayjs().format('YYYY-MM'));
  const loading = ref(false);
  const report = ref<AdminOperationsReportDTO>();
  const promotionDrafts = reactive<Record<string, number | undefined>>({});
  const savingDates = reactive<Record<string, boolean>>({});
  const promotionTimers: Record<string, ReturnType<typeof setTimeout>> = {};

  const daily = computed(() => report.value?.daily || []);

  const formatMoney = (value?: number) =>
    `¥${Number(value || 0).toLocaleString('zh-CN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;

  const promotionExpenseFor = (record: AdminOperationsDailyPointDTO) =>
    record.promotionExpense ?? getDouyinPromotionExpense(record.date);

  const profitFor = (record: AdminOperationsDailyPointDTO) =>
    record.profit ??
    Number((record.cohortRevenue - promotionExpenseFor(record)).toFixed(2));

  const promotionDraft = (record: AdminOperationsDailyPointDTO) =>
    promotionDrafts[record.date] ?? promotionExpenseFor(record);

  const clearPromotionTimer = (date: string) => {
    const timer = promotionTimers[date];
    if (timer) {
      clearTimeout(timer);
      delete promotionTimers[date];
    }
  };

  const schedulePromotionSave = (record: AdminOperationsDailyPointDTO) => {
    clearPromotionTimer(record.date);
    promotionTimers[record.date] = setTimeout(() => {
      delete promotionTimers[record.date];
      savePromotion(record);
    }, 600);
  };

  const savePromotion = async (record: AdminOperationsDailyPointDTO) => {
    const draft = promotionDrafts[record.date];
    if (draft === undefined) return;
    if (Number(draft) === Number(promotionExpenseFor(record))) {
      delete promotionDrafts[record.date];
      return;
    }
    if (savingDates[record.date]) {
      // 已有请求在途，稍后再保存最新值
      schedulePromotionSave(record);
      return;
    }
    savingDates[record.date] = true;
    try {
      const { data } = await updateDailyPromotionExpense(record.date, draft);
      record.promotionExpense = data.promotionExpense;
      record.profit = data.profit;
      record.promotionExpenseManual = data.promotionExpenseManual;
      if (
        Number(promotionDrafts[record.date]) === Number(data.promotionExpense)
      ) {
        delete promotionDrafts[record.date];
      }
    } catch {
      Message.error('推广费保存失败');
      delete promotionDrafts[record.date];
    } finally {
      savingDates[record.date] = false;
      const pending = promotionDrafts[record.date];
      if (
        pending !== undefined &&
        Number(pending) !== Number(promotionExpenseFor(record))
      ) {
        schedulePromotionSave(record);
      }
    }
  };

  const onPromotionChange = (
    record: AdminOperationsDailyPointDTO,
    value: number | undefined
  ) => {
    promotionDrafts[record.date] =
      typeof value === 'number' && Number.isFinite(value) ? value : undefined;
    schedulePromotionSave(record);
  };

  const flushPromotion = (record: AdminOperationsDailyPointDTO) => {
    clearPromotionTimer(record.date);
    savePromotion(record);
  };

  const clearPromotionDrafts = () => {
    Object.keys(promotionDrafts).forEach((key) => {
      clearPromotionTimer(key);
      delete promotionDrafts[key];
    });
  };

  onUnmounted(() => {
    Object.keys(promotionTimers).forEach((key) => clearPromotionTimer(key));
  });

  const fetch = async () => {
    try {
      loading.value = true;
      const { data } = await queryOperationsReport(month.value);
      report.value = data;
      clearPromotionDrafts();
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
    width: 100%;
    min-width: 0;
    min-height: 100%;
    box-sizing: border-box;
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

    &__table {
      width: 100%;
      min-width: 0;

      :deep(.arco-table-th) {
        white-space: normal;
        line-height: 1.35;
      }

      :deep(.arco-table-td) {
        white-space: nowrap;
      }
    }

    &__promotion-input {
      width: 120px;
    }

    @media (max-width: 900px) {
      padding: 16px;

      &__header {
        align-items: flex-start;
        flex-direction: column;
      }

      &__table {
        overflow-x: auto;

        :deep(.arco-table) {
          min-width: 860px;
        }
      }
    }
  }
</style>
