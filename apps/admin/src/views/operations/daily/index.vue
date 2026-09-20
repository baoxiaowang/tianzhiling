<template>
  <div class="daily-detail-page">
    <header class="daily-detail-page__header">
      <div>
        <h1>每日明细</h1>
        <p>每日用户活跃、订单、收入与推广费用</p>
      </div>
      <a-space>
        <a-typography-text v-if="lastUpdatedAt" type="secondary">
          最后更新 {{ lastUpdatedAt }}
        </a-typography-text>
        <a-month-picker
          v-model="month"
          value-format="YYYY-MM"
          :allow-clear="false"
          @change="() => fetch()"
        />
        <a-button type="primary" :loading="loading" @click="refresh">
          刷新
        </a-button>
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
          <a-table-column title="运营笔记" :width="240">
            <template #cell="{ record }">
              <a-textarea
                class="daily-detail-page__note-input"
                :model-value="noteValue(record)"
                :auto-size="{ minRows: 1, maxRows: 3 }"
                :max-length="500"
                placeholder="填写运营笔记"
                @input="(value) => onNoteChange(record, value)"
                @blur="flushNote(record)"
              />
            </template>
          </a-table-column>
        </template>
      </a-table>
    </a-spin>
  </div>
</template>

<script lang="ts" setup>
  import { onMounted, onUnmounted, reactive, ref } from 'vue';
  import dayjs from 'dayjs';
  import { Message } from '@arco-design/web-vue';
  import type { AdminOperationsDailyPointDTO } from '@tzl/shared';
  import {
    queryDailyDetail,
    updateDailyNote,
    updateDailyPromotionExpense,
  } from '@/api/operations';
  import { getDouyinPromotionExpense } from '@tzl/shared/src/douyin-promotion-expenses';

  /** 自动刷新间隔。后端每 30 分钟重算一次当日汇总，这里取分钟级保证及时可见。 */
  const AUTO_REFRESH_MS = 60 * 1000;
  /** 运营笔记是自由文本，防抖比推广费长一些，减少半句话被存进去的次数。 */
  const NOTE_SAVE_DEBOUNCE_MS = 1500;

  const month = ref(dayjs().format('YYYY-MM'));
  const loading = ref(false);
  const daily = ref<AdminOperationsDailyPointDTO[]>([]);
  const notes = ref<Record<string, string>>({});
  const lastUpdatedAt = ref('');
  const promotionDrafts = reactive<Record<string, number | undefined>>({});
  const savingDates = reactive<Record<string, boolean>>({});
  const promotionTimers: Record<string, ReturnType<typeof setTimeout>> = {};
  const noteDrafts = reactive<Record<string, string | undefined>>({});
  const savingNoteDates = reactive<Record<string, boolean>>({});
  const noteTimers: Record<string, ReturnType<typeof setTimeout>> = {};
  let autoRefreshTimer: ReturnType<typeof setInterval> | undefined;

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

  /* ---------- 运营笔记 ---------- */

  const noteValue = (record: AdminOperationsDailyPointDTO) =>
    noteDrafts[record.date] ?? notes.value[record.date] ?? '';

  const clearNoteTimer = (date: string) => {
    const timer = noteTimers[date];
    if (timer) {
      clearTimeout(timer);
      delete noteTimers[date];
    }
  };

  const scheduleNoteSave = (record: AdminOperationsDailyPointDTO) => {
    clearNoteTimer(record.date);
    noteTimers[record.date] = setTimeout(() => {
      delete noteTimers[record.date];
      saveNote(record);
    }, NOTE_SAVE_DEBOUNCE_MS);
  };

  const saveNote = async (record: AdminOperationsDailyPointDTO) => {
    const draft = noteDrafts[record.date];
    if (draft === undefined) return;
    if (draft === (notes.value[record.date] ?? '')) {
      delete noteDrafts[record.date];
      return;
    }
    if (savingNoteDates[record.date]) {
      // 已有请求在途，稍后再保存最新值
      scheduleNoteSave(record);
      return;
    }
    savingNoteDates[record.date] = true;
    try {
      const { data } = await updateDailyNote(record.date, draft);
      if (data.note) {
        notes.value[record.date] = data.note;
      } else {
        delete notes.value[record.date];
      }
      if (noteDrafts[record.date] === data.note) {
        delete noteDrafts[record.date];
      }
    } catch {
      Message.error('运营笔记保存失败');
      delete noteDrafts[record.date];
    } finally {
      savingNoteDates[record.date] = false;
      const pending = noteDrafts[record.date];
      if (
        pending !== undefined &&
        pending !== (notes.value[record.date] ?? '')
      ) {
        scheduleNoteSave(record);
      }
    }
  };

  const onNoteChange = (
    record: AdminOperationsDailyPointDTO,
    value: string
  ) => {
    noteDrafts[record.date] = typeof value === 'string' ? value : '';
    scheduleNoteSave(record);
  };

  const flushNote = (record: AdminOperationsDailyPointDTO) => {
    clearNoteTimer(record.date);
    saveNote(record);
  };

  const clearNoteDrafts = () => {
    Object.keys(noteDrafts).forEach((key) => {
      clearNoteTimer(key);
      delete noteDrafts[key];
    });
  };

  /** 有未提交的推广费或运营笔记编辑时不打断用户（自动刷新会跳过这一轮）。 */
  const hasPendingEdit = () =>
    Object.keys(promotionDrafts).length > 0 ||
    Object.keys(savingDates).some((key) => savingDates[key]) ||
    Object.keys(noteDrafts).length > 0 ||
    Object.keys(savingNoteDates).some((key) => savingNoteDates[key]);

  const stopAutoRefresh = () => {
    if (autoRefreshTimer) {
      clearInterval(autoRefreshTimer);
      autoRefreshTimer = undefined;
    }
  };

  const fetch = async (options?: { refresh?: boolean; silent?: boolean }) => {
    if (options?.silent && hasPendingEdit()) return;
    try {
      if (!options?.silent) loading.value = true;
      const { data } = await queryDailyDetail(month.value, {
        refresh: options?.refresh,
      });
      daily.value = data?.daily || [];
      notes.value = data?.notes || {};
      lastUpdatedAt.value = dayjs().format('HH:mm:ss');
      if (!options?.silent) {
        clearPromotionDrafts();
        clearNoteDrafts();
      }
    } catch {
      if (!options?.silent) Message.error('每日明细加载失败');
    } finally {
      if (!options?.silent) loading.value = false;
    }
  };

  /** 手动刷新：绕过后端当日的汇总重算，拿到最新数据 */
  const refresh = () => fetch({ refresh: true });

  const handleVisibilityChange = () => {
    // 页面回到前台时补一次，避免长时间挂在后台后显示过期数据
    if (!document.hidden) fetch({ silent: true });
  };

  onMounted(() => {
    fetch();
    stopAutoRefresh();
    autoRefreshTimer = setInterval(() => {
      if (document.hidden) return;
      fetch({ silent: true });
    }, AUTO_REFRESH_MS);
    document.addEventListener('visibilitychange', handleVisibilityChange);
  });

  onUnmounted(() => {
    stopAutoRefresh();
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    Object.keys(promotionTimers).forEach((key) => clearPromotionTimer(key));
  });
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
        text-align: center;
      }

      :deep(.arco-table-td) {
        white-space: nowrap;
        text-align: center;
      }

      :deep(.arco-table-cell) {
        justify-content: center;
        text-align: center;
      }
    }

    &__promotion-input {
      width: 120px;

      :deep(input) {
        text-align: center;
      }
    }

    &__note-input {
      width: 220px;

      :deep(textarea) {
        font-size: 13px;
        line-height: 1.4;
      }
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
