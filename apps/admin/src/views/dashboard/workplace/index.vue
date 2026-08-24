<template>
  <div class="data-dashboard">
    <header class="data-dashboard__header">
      <div>
        <h1>数据统计</h1>
        <p>每日数据是主表，累计与本月数据用于快速判断经营变化。</p>
      </div>
      <a-space>
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
      <section class="data-dashboard__summary">
        <article v-for="item in summary" :key="item.label">
          <span>{{ item.label }}</span>
          <strong>{{
            item.money ? formatMoney(item.value) : formatNumber(item.value)
          }}</strong>
          <small>{{ item.hint }}</small>
        </article>
      </section>

      <a-grid
        :cols="24"
        :col-gap="16"
        :row-gap="16"
        class="data-dashboard__analysis"
      >
        <a-grid-item :span="{ xs: 24, xl: 16 }">
          <a-card :bordered="false" title="本月每日趋势">
            <template #extra>
              <a-radio-group v-model="trendMetric" type="button" size="small">
                <a-radio value="newUsers">新增用户</a-radio>
                <a-radio value="newUserMessages">新用户消息</a-radio>
                <a-radio value="userMessages">全部消息</a-radio>
              </a-radio-group>
            </template>
            <Chart height="280px" :option="trendChartOption" />
          </a-card>
        </a-grid-item>

        <a-grid-item :span="{ xs: 24, xl: 8 }">
          <a-card :bordered="false" title="今日新用户路径">
            <div class="data-dashboard__funnel">
              <div v-for="item in todayFunnel" :key="item.label">
                <header>
                  <span>{{ item.label }}</span>
                  <strong>{{ formatNumber(item.value) }}</strong>
                </header>
                <a-progress
                  :percent="item.rate / 100"
                  :show-text="false"
                  :stroke-width="7"
                />
                <small>{{ item.rate.toFixed(1) }}%</small>
              </div>
            </div>
          </a-card>
        </a-grid-item>

        <a-grid-item :span="24">
          <a-card :bordered="false">
            <template #title>
              {{ report?.month || month }} 每日数据明细
            </template>
            <template #extra>
              <a-typography-text type="secondary">
                聊天次数按用户发送消息统计，系统回复不重复计入
              </a-typography-text>
            </template>
            <a-table
              row-key="date"
              :data="dailyRows"
              :pagination="false"
              :scroll="{ x: 1260 }"
              stripe
            >
              <template #columns>
                <a-table-column title="日期" data-index="date" :width="118">
                  <template #cell="{ record }">
                    <strong v-if="record.date === report?.today">今天</strong>
                    <span v-else>{{ formatDay(record.date) }}</span>
                  </template>
                </a-table-column>
                <a-table-column
                  title="新增用户"
                  data-index="newUsers"
                  :width="108"
                />
                <a-table-column
                  title="新用户聊天人数"
                  data-index="newUserChatUsers"
                  :width="138"
                >
                  <template #cell="{ record }">
                    <strong>{{ formatNumber(record.newUserChatUsers) }}</strong>
                    <small>
                      {{ formatRate(record.newUserChatUsers, record.newUsers) }}
                    </small>
                  </template>
                </a-table-column>
                <a-table-column
                  title="新用户消息数"
                  data-index="newUserMessages"
                  :width="130"
                />
                <a-table-column
                  title="全部聊天人数"
                  data-index="allChatUsers"
                  :width="130"
                />
                <a-table-column
                  title="全部消息数"
                  data-index="userMessages"
                  :width="118"
                />
                <a-table-column
                  title="付费人数"
                  data-index="paidUsers"
                  :width="100"
                />
                <a-table-column
                  title="订单数"
                  data-index="paidOrders"
                  :width="90"
                />
                <a-table-column title="实付金额" :width="120">
                  <template #cell="{ record }">
                    <strong>{{ formatMoney(record.paidRevenue) }}</strong>
                  </template>
                </a-table-column>
              </template>
            </a-table>
          </a-card>
        </a-grid-item>
      </a-grid>
    </a-spin>
  </div>
</template>

<script lang="ts" setup>
  import { computed, onMounted, ref } from 'vue';
  import dayjs from 'dayjs';
  import { Message } from '@arco-design/web-vue';
  import type { AdminOperationsReportDTO } from '@tzl/shared';
  import { queryOperationsReport } from '@/api/operations';

  const loading = ref(false);
  const month = ref(dayjs().format('YYYY-MM'));
  const trendMetric = ref<'newUsers' | 'newUserMessages' | 'userMessages'>(
    'newUsers'
  );
  const report = ref<AdminOperationsReportDTO>();

  const summary = computed(() => [
    {
      label: '总用户',
      value: report.value?.allTime.users || 0,
      hint: '当前累计',
    },
    {
      label: '本月新增用户',
      value: report.value?.totals.newUsers || 0,
      hint: '截至所选月当前日期',
    },
    {
      label: '总聊天用户',
      value: report.value?.allTime.chatUsers || 0,
      hint: '至少发过一条消息',
    },
    {
      label: '累计聊天消息',
      value: report.value?.allTime.userMessages || 0,
      hint: '用户发送',
    },
    {
      label: '累计付费用户',
      value: report.value?.allTime.payingUsers || 0,
      hint: '去重人数',
    },
    {
      label: '累计收入',
      value: report.value?.allTime.netRevenue || 0,
      hint: '扣除已退款',
      money: true,
    },
    {
      label: '本月收入',
      value: report.value?.totals.netRevenue || 0,
      hint: '所选月份净收入',
      money: true,
    },
  ]);

  const dailyRows = computed(() => [...(report.value?.daily || [])].reverse());
  const trendMeta = computed(() => {
    const map = {
      newUsers: { name: '新增用户', color: '#7662cf' },
      newUserMessages: { name: '新用户消息', color: '#bf7795' },
      userMessages: { name: '全部消息', color: '#5f91bd' },
    };

    return map[trendMetric.value];
  });
  const trendChartOption = computed(() => ({
    tooltip: { trigger: 'axis' },
    grid: { left: 54, right: 24, top: 28, bottom: 38 },
    xAxis: {
      type: 'category',
      data: (report.value?.daily || []).map((item) => formatDay(item.date)),
      axisLabel: { interval: 4 },
    },
    yAxis: { type: 'value', minInterval: 1 },
    series: [
      {
        name: trendMeta.value.name,
        type: 'bar',
        data: (report.value?.daily || []).map(
          (item) => item[trendMetric.value]
        ),
        itemStyle: {
          color: trendMeta.value.color,
          borderRadius: [5, 5, 0, 0],
        },
      },
    ],
  }));

  const todayFunnel = computed(() => {
    const today = report.value?.todayTotals;
    const base = today?.newUsers || 0;
    const entries = [
      { label: '新增用户', value: base },
      { label: '创建智能体', value: today?.newAgents || 0 },
      { label: '开始聊天', value: today?.newUserChatUsers || 0 },
      { label: '发送 ≥ 5 条', value: today?.newUserFiveMessageUsers || 0 },
      { label: '当天付费', value: today?.sameDayPayingUsers || 0 },
    ];

    return entries.map((item) => ({
      ...item,
      rate: base > 0 ? Math.min((item.value / base) * 100, 100) : 0,
    }));
  });

  const fetchData = async () => {
    try {
      loading.value = true;
      const { data } = await queryOperationsReport(month.value);
      report.value = data;
    } catch (error) {
      Message.error('数据统计加载失败');
    } finally {
      loading.value = false;
    }
  };

  const formatNumber = (value: number) =>
    Number(value || 0).toLocaleString('zh-CN');
  const formatMoney = (value: number) =>
    `¥${Number(value || 0).toLocaleString('zh-CN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  const formatDay = (value: string) => dayjs(value).format('MM-DD');
  const formatRate = (value: number, total: number) =>
    total > 0 ? `${((value / total) * 100).toFixed(1)}%` : '0.0%';

  onMounted(fetchData);
</script>

<script lang="ts">
  export default { name: 'Dashboard' };
</script>

<style lang="less" scoped>
  .data-dashboard {
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

    &__summary {
      display: grid;
      grid-template-columns: repeat(7, minmax(0, 1fr));
      overflow: hidden;
      background: var(--color-bg-2);
      border: 1px solid var(--color-border-2);
      border-radius: 8px;

      article {
        min-width: 0;
        padding: 14px;
        border-right: 1px solid var(--color-border-2);

        &:last-child {
          background: rgb(var(--purple-1));
          border-right: 0;
        }

        span,
        small {
          display: block;
          overflow: hidden;
          color: var(--color-text-3);
          font-size: 12px;
          white-space: nowrap;
          text-overflow: ellipsis;
        }

        strong {
          display: block;
          margin: 8px 0 4px;
          overflow: hidden;
          font-weight: 500;
          font-size: 20px;
          white-space: nowrap;
          text-overflow: ellipsis;
        }
      }
    }

    &__analysis {
      margin-top: 16px;
    }

    &__funnel {
      display: grid;
      gap: 14px;

      header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 6px;
      }

      strong {
        font-weight: 500;
      }

      small {
        display: block;
        margin-top: 3px;
        color: var(--color-text-3);
        text-align: right;
      }
    }

    :deep(.arco-table-td) small {
      display: block;
      margin-top: 3px;
      color: var(--color-text-3);
    }
  }

  @media (max-width: 1200px) {
    .data-dashboard__summary {
      grid-template-columns: repeat(4, minmax(0, 1fr));

      article:nth-child(4) {
        border-right: 0;
      }
    }
  }

  @media (max-width: 768px) {
    .data-dashboard {
      padding: 16px;

      &__header {
        align-items: flex-start;
        flex-direction: column;
      }

      &__summary {
        grid-template-columns: repeat(2, minmax(0, 1fr));

        article:nth-child(2n) {
          border-right: 0;
        }
      }
    }
  }
</style>
