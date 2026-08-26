<template>
  <div class="data-dashboard">
    <header class="data-dashboard__header">
      <div>
        <h1>数据仪表盘</h1>
        <p>查看当前总量、本月增长、聊天活跃和实际收入。</p>
      </div>
      <a-space>
        <a-button type="text" @click="goDaily">查看每日数据明细</a-button>
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
          <a-card
            class="data-dashboard__chart-card"
            :bordered="false"
            title="本月每日趋势"
          >
            <template #extra>
              <a-radio-group v-model="trendMetric" type="button" size="small">
                <a-radio value="newUsers">新增用户</a-radio>
                <a-radio value="netRevenue">当天收入</a-radio>
                <a-radio value="userMessages">总消息数</a-radio>
              </a-radio-group>
            </template>
            <Chart height="320px" :option="trendChartOption" />
          </a-card>
        </a-grid-item>

        <a-grid-item :span="{ xs: 24, xl: 8 }">
          <a-card
            class="data-dashboard__chart-card"
            :bordered="false"
            title="本月新老用户聊天消息"
          >
            <template #extra>
              <a-typography-text type="secondary">
                新用户指注册未满 3 天
              </a-typography-text>
            </template>
            <Chart height="320px" :option="userTypeChartOption" />
          </a-card>
        </a-grid-item>
      </a-grid>
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

  const loading = ref(false);
  const route = useRoute();
  const router = useRouter();
  const initialMonth = /^\d{4}-(0[1-9]|1[0-2])$/.test(
    String(route.query.month || '')
  )
    ? String(route.query.month)
    : dayjs().format('YYYY-MM');
  const month = ref(initialMonth);
  const trendMetric = ref<'newUsers' | 'netRevenue' | 'userMessages'>(
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

  const trendMeta = computed(() => {
    const map = {
      newUsers: { name: '新增用户', color: '#7662cf', money: false },
      netRevenue: { name: '当天收入', color: '#36a375', money: true },
      userMessages: { name: '总消息数', color: '#5f91bd', money: false },
    };

    return map[trendMetric.value];
  });
  const trendChartOption = computed(() => ({
    tooltip: {
      trigger: 'axis',
      valueFormatter: (value: number) =>
        trendMeta.value.money ? formatMoney(value) : formatNumber(value),
    },
    grid: { left: 66, right: 28, top: 34, bottom: 38 },
    xAxis: {
      type: 'category',
      data: (report.value?.daily || []).map((item) => formatDay(item.date)),
      axisLabel: { interval: 4 },
    },
    yAxis: {
      type: 'value',
      minInterval: trendMeta.value.money ? undefined : 1,
      name: trendMeta.value.money ? '元' : '',
    },
    series: [
      {
        name: trendMeta.value.name,
        type: 'line',
        smooth: true,
        symbolSize: 8,
        data: (report.value?.daily || []).map(
          (item) => item[trendMetric.value]
        ),
        itemStyle: {
          color: trendMeta.value.color,
        },
        lineStyle: { width: 3 },
        areaStyle: { opacity: 0.1 },
      },
    ],
  }));

  const userTypeChartOption = computed(() => {
    const newUserMessages = report.value?.totals.newUserMessages || 0;
    const oldUserMessages = Math.max(
      (report.value?.totals.userMessages || 0) - newUserMessages,
      0
    );

    return {
      tooltip: {
        trigger: 'item',
        formatter: '{b}<br/>{c} 条（{d}%）',
      },
      legend: {
        bottom: 8,
        left: 'center',
      },
      series: [
        {
          name: '聊天消息',
          type: 'pie',
          radius: ['46%', '70%'],
          center: ['50%', '45%'],
          avoidLabelOverlap: true,
          label: {
            show: true,
            formatter: '{b}\n{c} 条',
          },
          data: [
            {
              name: '注册 3 天内新用户',
              value: newUserMessages,
              itemStyle: { color: '#7662cf' },
            },
            {
              name: '老用户',
              value: oldUserMessages,
              itemStyle: { color: '#5f91bd' },
            },
          ],
        },
      ],
    };
  });

  const goDaily = () =>
    router.push({ name: 'DashboardDaily', query: { month: month.value } });

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

      :deep(.arco-card) {
        height: 100%;
      }
    }

    &__chart-card {
      width: 100%;
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
