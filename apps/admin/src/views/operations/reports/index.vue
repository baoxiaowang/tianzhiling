<template>
  <div class="user-value-page">
    <header class="user-value-page__header">
      <div>
        <h1>每日运营统计</h1>
        <p>既能看每天发生了什么，也能按注册月份追踪每批用户最终创造的价值。</p>
      </div>
      <a-space>
        <a-month-picker
          v-model="endMonth"
          value-format="YYYY-MM"
          :allow-clear="false"
          @change="fetchUserValue"
        />
        <a-select
          v-model="monthCount"
          class="user-value-page__month-count"
          @change="fetchUserValue"
        >
          <a-option :value="6">近 6 个月</a-option>
          <a-option :value="12">近 12 个月</a-option>
        </a-select>
        <a-button :loading="loading" @click="refreshActive">刷新</a-button>
      </a-space>
    </header>

    <a-tabs v-model:active-key="activeTab" type="rounded">
      <a-tab-pane key="value" title="用户价值">
        <a-spin :loading="loading">
          <div class="user-value-page__definition">
            <a-tag color="purple">核心口径</a-tag>
            <strong>
              注册用户产值 = 该注册月用户累计实付金额 ÷ 该月新增注册用户数
            </strong>
            <span>后续月份发生的订单仍回流到用户原注册月份</span>
          </div>

          <section class="user-value-page__summary">
            <article>
              <span>{{ selectedCohort?.month || '-' }} 注册用户</span>
              <strong>{{ formatNumber(selectedCohort?.newUsers) }}</strong>
              <small>新增注册用户</small>
            </article>
            <article>
              <span>这批用户累计实付</span>
              <strong>{{ formatMoney(selectedCohort?.revenue) }}</strong>
              <small>已扣除订单退款</small>
            </article>
            <article class="is-key">
              <span>注册用户产值</span>
              <strong>{{ formatMoney(selectedCohort?.userValue) }}</strong>
              <small>平均每获取一个注册用户带来的收入</small>
            </article>
            <article>
              <span>累计付费率</span>
              <strong>{{ formatPercent(selectedCohort?.payRate) }}</strong>
              <small
                >{{
                  formatNumber(selectedCohort?.payingUsers)
                }}
                位付费用户</small
              >
            </article>
          </section>

          <a-card class="user-value-page__chart" :bordered="false">
            <template #title>{{ cohortChartTitle }}</template>
            <template #extra>
              <a-radio-group v-model="cohortMetric" type="button" size="small">
                <a-radio value="value">注册用户产值</a-radio>
                <a-radio value="revenue">累计实付</a-radio>
                <a-radio value="rate">付费率</a-radio>
              </a-radio-group>
            </template>
            <Chart height="300px" :option="cohortChartOption" />
          </a-card>

          <a-card
            class="user-value-page__table"
            :bordered="false"
            title="按注册月份查看用户最终价值"
          >
            <template #extra>
              <a-typography-text type="secondary">
                30 日产值用于同周期比较；未成熟月份不展示该值
              </a-typography-text>
            </template>
            <a-table
              row-key="month"
              :data="cohortRows"
              :pagination="false"
              :scroll="{ x: 1120 }"
              :row-class="cohortRowClass"
              @row-click="selectCohort"
            >
              <template #columns>
                <a-table-column
                  title="注册月份"
                  data-index="month"
                  :width="150"
                >
                  <template #cell="{ record }">
                    <strong>{{ record.month }}</strong>
                    <small>已观察 {{ record.observedDays }} 天</small>
                  </template>
                </a-table-column>
                <a-table-column
                  title="新增用户"
                  data-index="newUsers"
                  :width="120"
                />
                <a-table-column
                  title="付费用户"
                  data-index="payingUsers"
                  :width="120"
                />
                <a-table-column title="累计付费率" :width="130">
                  <template #cell="{ record }">{{
                    formatPercent(record.payRate)
                  }}</template>
                </a-table-column>
                <a-table-column title="7 日产值" :width="120">
                  <template #cell="{ record }">
                    {{
                      record.is7DayMature
                        ? formatMoney(record.value7Day)
                        : '观察中'
                    }}
                  </template>
                </a-table-column>
                <a-table-column title="30 日产值" :width="130">
                  <template #cell="{ record }">
                    {{
                      record.is30DayMature
                        ? formatMoney(record.value30Day)
                        : '观察中'
                    }}
                  </template>
                </a-table-column>
                <a-table-column title="当前累计实付" :width="150">
                  <template #cell="{ record }">{{
                    formatMoney(record.revenue)
                  }}</template>
                </a-table-column>
                <a-table-column title="注册用户产值" :width="150">
                  <template #cell="{ record }">
                    <strong class="user-value-page__key-value">
                      {{ formatMoney(record.userValue) }}
                    </strong>
                  </template>
                </a-table-column>
              </template>
            </a-table>
          </a-card>
        </a-spin>
      </a-tab-pane>

      <a-tab-pane key="daily" title="每日明细">
        <a-spin :loading="dailyLoading">
          <a-card :bordered="false">
            <template #title
              >{{ dailyReport?.month || endMonth }} 每日数据</template
            >
            <a-table
              row-key="date"
              :data="dailyReport?.daily || []"
              :pagination="false"
              :scroll="{ x: 1220 }"
            >
              <template #columns>
                <a-table-column title="日期" data-index="date" :width="130" />
                <a-table-column
                  title="新增用户"
                  data-index="newUsers"
                  :width="110"
                />
                <a-table-column
                  title="新用户聊天人数"
                  data-index="newUserChatUsers"
                  :width="140"
                />
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
                  :width="120"
                />
                <a-table-column
                  title="付费人数"
                  data-index="paidUsers"
                  :width="110"
                />
                <a-table-column
                  title="订单数"
                  data-index="paidOrders"
                  :width="100"
                />
                <a-table-column title="净收入" :width="130">
                  <template #cell="{ record }">
                    <strong>{{ formatMoney(record.netRevenue) }}</strong>
                  </template>
                </a-table-column>
              </template>
            </a-table>
          </a-card>
        </a-spin>
      </a-tab-pane>
    </a-tabs>
  </div>
</template>

<script lang="ts" setup>
  import { computed, onMounted, ref, watch } from 'vue';
  import dayjs from 'dayjs';
  import { Message } from '@arco-design/web-vue';
  import type { TableData } from '@arco-design/web-vue/es/table/interface';
  import type {
    AdminOperationsReportDTO,
    AdminUserValueReportDTO,
  } from '@tzl/shared';
  import {
    queryOperationsReport,
    queryUserValueReport,
  } from '@/api/operations';

  const activeTab = ref('value');
  const loading = ref(false);
  const dailyLoading = ref(false);
  const endMonth = ref(dayjs().format('YYYY-MM'));
  const monthCount = ref(6);
  const cohortMetric = ref<'value' | 'revenue' | 'rate'>('value');
  const report = ref<AdminUserValueReportDTO>();
  const dailyReport = ref<AdminOperationsReportDTO>();
  const selectedMonth = ref('');

  const cohortRows = computed(() => [...(report.value?.items || [])].reverse());
  const selectedCohort = computed(
    () =>
      report.value?.items.find((item) => item.month === selectedMonth.value) ||
      report.value?.items[report.value.items.length - 1]
  );
  const cohortMetricMeta = computed(() => {
    const map = {
      value: {
        title: '各注册月份的注册用户产值',
        key: 'userValue' as const,
        unit: '元/注册用户',
      },
      revenue: {
        title: '各注册月份用户的累计实付',
        key: 'revenue' as const,
        unit: '元',
      },
      rate: {
        title: '各注册月份用户的累计付费率',
        key: 'payRate' as const,
        unit: '%',
      },
    };

    return map[cohortMetric.value];
  });
  const cohortChartTitle = computed(() => cohortMetricMeta.value.title);
  const cohortChartOption = computed(() => {
    const items = report.value?.items || [];
    const { key } = cohortMetricMeta.value;

    return {
      tooltip: {
        trigger: 'axis',
        valueFormatter: (value: number) =>
          cohortMetric.value === 'rate'
            ? formatPercent(value)
            : formatMoney(value),
      },
      grid: { left: 68, right: 32, top: 30, bottom: 38 },
      xAxis: {
        type: 'category',
        data: items.map((item) => `${item.month.slice(5)} 月`),
      },
      yAxis: {
        type: 'value',
        name: cohortMetricMeta.value.unit,
        min: 0,
      },
      series: [
        {
          name: cohortMetricMeta.value.title,
          type: 'line',
          smooth: true,
          symbolSize: 9,
          data: items.map((item) => item[key]),
          itemStyle: { color: '#7662cf' },
          areaStyle: { color: 'rgba(118, 98, 207, 0.12)' },
          label: {
            show: true,
            formatter: ({ value }: { value: number }) =>
              cohortMetric.value === 'rate'
                ? formatPercent(value)
                : formatMoney(value),
          },
        },
      ],
    };
  });

  const fetchUserValue = async () => {
    try {
      loading.value = true;
      const { data } = await queryUserValueReport(
        endMonth.value,
        monthCount.value
      );
      report.value = data;
      selectedMonth.value =
        data.items[data.items.length - 1]?.month || selectedMonth.value;
    } catch (error) {
      Message.error('用户价值统计加载失败');
    } finally {
      loading.value = false;
    }
  };

  const fetchDaily = async () => {
    try {
      dailyLoading.value = true;
      const { data } = await queryOperationsReport(endMonth.value);
      dailyReport.value = data;
    } catch (error) {
      Message.error('每日运营明细加载失败');
    } finally {
      dailyLoading.value = false;
    }
  };

  const refreshActive = () =>
    activeTab.value === 'value' ? fetchUserValue() : fetchDaily();
  const selectCohort = (record: TableData) => {
    selectedMonth.value = String(record.month || '');
  };
  const cohortRowClass = (record: TableData) =>
    String(record.month || '') === selectedMonth.value
      ? 'user-value-page__selected-row'
      : '';
  const formatNumber = (value?: number) =>
    Number(value || 0).toLocaleString('zh-CN');
  const formatMoney = (value?: number) =>
    `¥${Number(value || 0).toLocaleString('zh-CN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  const formatPercent = (value?: number) => `${Number(value || 0).toFixed(1)}%`;

  watch(activeTab, (value) => {
    if (value === 'daily' && !dailyReport.value) {
      fetchDaily();
    }
  });
  watch(endMonth, () => {
    if (activeTab.value === 'daily') fetchDaily();
  });
  onMounted(fetchUserValue);
</script>

<style lang="less" scoped>
  .user-value-page {
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

    &__month-count {
      width: 120px;
    }

    &__definition {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 4px 0 12px;

      strong {
        font-weight: 500;
      }

      span {
        margin-left: auto;
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
        padding: 16px;
        border-right: 1px solid var(--color-border-2);

        &:last-child {
          border-right: 0;
        }

        &.is-key {
          background: rgb(var(--purple-1));
        }

        span,
        small {
          display: block;
          color: var(--color-text-3);
        }

        strong {
          display: block;
          margin: 8px 0 4px;
          font-weight: 500;
          font-size: 24px;
        }
      }
    }

    &__chart,
    &__table {
      margin-top: 16px;
    }

    &__key-value {
      color: rgb(var(--purple-6));
      font-size: 16px;
    }

    :deep(.user-value-page__selected-row .arco-table-td) {
      background: rgb(var(--purple-1));
    }

    :deep(.arco-table-td) small {
      display: block;
      margin-top: 3px;
      color: var(--color-text-3);
    }
  }

  @media (max-width: 900px) {
    .user-value-page {
      &__header {
        align-items: flex-start;
        flex-direction: column;
      }

      &__definition {
        align-items: flex-start;
        flex-wrap: wrap;

        span {
          width: 100%;
          margin-left: 0;
        }
      }

      &__summary {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }
  }
</style>
