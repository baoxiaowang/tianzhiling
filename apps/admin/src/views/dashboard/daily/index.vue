<template>
  <div class="daily-data-page">
    <header class="daily-data-page__header">
      <div>
        <h1>本月每日数据明细</h1>
        <p>按北京时间统计；聊天只计算用户发送的消息，不重复计算系统回复。</p>
      </div>
      <a-space>
        <a-button type="text" @click="goDashboard">返回数据仪表盘</a-button>
        <a-month-picker
          v-model="month"
          value-format="YYYY-MM"
          :allow-clear="false"
          @change="fetchData"
        />
        <a-button :loading="loading" @click="fetchData">刷新</a-button>
      </a-space>
    </header>

    <a-spin :loading="loading">
      <section class="daily-data-page__summary">
        <article>
          <span>本月新增用户</span>
          <strong>{{ formatNumber(report?.totals.newUsers) }}</strong>
        </article>
        <article>
          <span>注册 3 天内用户消息</span>
          <strong>{{ formatNumber(report?.totals.newUserMessages) }}</strong>
        </article>
        <article>
          <span>本月总消息数</span>
          <strong>{{ formatNumber(report?.totals.userMessages) }}</strong>
        </article>
        <article class="is-key">
          <span>本月实际收入</span>
          <strong>{{ formatMoney(report?.totals.netRevenue) }}</strong>
        </article>
      </section>

      <a-card class="daily-data-page__table-card" :bordered="false">
        <template #title>{{ report?.month || month }} 每日数据</template>
        <template #extra>
          <a-typography-text type="secondary">
            当天收入 = 当天支付流水 − 当天退款流水
          </a-typography-text>
        </template>
        <a-table
          row-key="date"
          :data="dailyRows"
          :pagination="false"
          :scroll="{ x: 1760 }"
          size="large"
          stripe
        >
          <template #columns>
            <a-table-column title="日期" data-index="date" :width="130">
              <template #cell="{ record }">
                <strong v-if="record.date === report?.today">今天</strong>
                <span v-else>{{ record.date }}</span>
              </template>
            </a-table-column>
            <a-table-column
              title="新增用户"
              data-index="newUsers"
              :width="120"
            />
            <a-table-column
              title="3 日内新用户聊天人数"
              data-index="newUserChatUsers"
              :width="180"
            />
            <a-table-column
              title="3 日内新用户消息数"
              data-index="newUserMessages"
              :width="170"
            />
            <a-table-column
              title="老用户消息数"
              data-index="oldUserMessages"
              :width="145"
            />
            <a-table-column
              title="总聊天人数"
              data-index="allChatUsers"
              :width="135"
            />
            <a-table-column
              title="总消息数"
              data-index="userMessages"
              :width="125"
            />
            <a-table-column
              title="付费人数"
              data-index="paidUsers"
              :width="115"
            />
            <a-table-column
              title="支付订单数"
              data-index="paidOrders"
              :width="125"
            />
            <a-table-column title="支付收入" :width="130">
              <template #cell="{ record }">
                {{ formatMoney(record.paidRevenue) }}
              </template>
            </a-table-column>
            <a-table-column title="退款金额" :width="125">
              <template #cell="{ record }">
                {{ formatMoney(record.refundedRevenue) }}
              </template>
            </a-table-column>
            <a-table-column title="当天收入" :width="140" fixed="right">
              <template #cell="{ record }">
                <strong class="daily-data-page__income">
                  {{ formatMoney(record.netRevenue) }}
                </strong>
              </template>
            </a-table-column>
          </template>
        </a-table>
      </a-card>
    </a-spin>
  </div>
</template>

<script lang="ts" setup>
  import { computed, onMounted, ref } from 'vue';
  import { useRoute, useRouter } from 'vue-router';
  import dayjs from 'dayjs';
  import { Message } from '@arco-design/web-vue';
  import type { AdminOperationsReportDTO } from '@tzl/shared';
  import { queryOperationsReport } from '@/api/operations';

  const route = useRoute();
  const router = useRouter();
  const initialMonth = /^\d{4}-(0[1-9]|1[0-2])$/.test(
    String(route.query.month || '')
  )
    ? String(route.query.month)
    : dayjs().format('YYYY-MM');

  const loading = ref(false);
  const month = ref(initialMonth);
  const report = ref<AdminOperationsReportDTO>();

  const dailyRows = computed(() =>
    [...(report.value?.daily || [])].reverse().map((item) => ({
      ...item,
      oldUserMessages: Math.max(item.userMessages - item.newUserMessages, 0),
    }))
  );

  const fetchData = async () => {
    try {
      loading.value = true;
      const { data } = await queryOperationsReport(month.value);
      report.value = data;
      router.replace({ query: { month: month.value } });
    } catch (error) {
      Message.error('每日数据明细加载失败');
    } finally {
      loading.value = false;
    }
  };

  const goDashboard = () =>
    router.push({ name: 'Workplace', query: { month: month.value } });
  const formatNumber = (value?: number) =>
    Number(value || 0).toLocaleString('zh-CN');
  const formatMoney = (value?: number) =>
    `¥${Number(value || 0).toLocaleString('zh-CN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;

  onMounted(fetchData);
</script>

<script lang="ts">
  export default { name: 'DashboardDaily' };
</script>

<style lang="less" scoped>
  .daily-data-page {
    min-height: 100%;
    padding: 24px;
    background: var(--color-fill-2);

    :deep(.arco-spin),
    :deep(.arco-spin-children) {
      display: block;
      width: 100%;
    }

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

    &__summary {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      overflow: hidden;
      background: var(--color-bg-2);
      border: 1px solid var(--color-border-2);
      border-radius: 8px;

      article {
        padding: 16px 18px;
        border-right: 1px solid var(--color-border-2);

        &:last-child {
          border-right: 0;
        }

        &.is-key {
          background: rgb(var(--green-1));
        }

        span {
          display: block;
          color: var(--color-text-3);
        }

        strong {
          display: block;
          margin-top: 8px;
          font-weight: 500;
          font-size: 24px;
        }
      }
    }

    &__table-card {
      width: 100%;
      margin-top: 16px;
    }

    &__income {
      color: rgb(var(--green-7));
      font-size: 15px;
    }

    :deep(.arco-table-th) {
      height: 52px;
      font-size: 14px;
    }

    :deep(.arco-table-td) {
      height: 58px;
      font-size: 14px;
    }
  }

  @media (max-width: 900px) {
    .daily-data-page {
      padding: 16px;

      &__header {
        align-items: flex-start;
        flex-direction: column;
      }

      &__summary {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }
  }
</style>
