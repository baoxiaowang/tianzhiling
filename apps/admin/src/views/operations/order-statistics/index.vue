<template>
  <div class="monthly-order-page">
    <header class="monthly-order-page__header">
      <div>
        <h1>订单统计</h1>
        <p>按月度订单明细生成方法统计；购买订单和退款流水分开归集。</p>
      </div>
      <a-space>
        <a-month-picker
          v-model="month"
          value-format="YYYY-MM"
          :allow-clear="false"
          @change="fetch"
        />
        <a-button type="primary" :loading="refreshing" @click="refreshAndSave"
          >重新计算并保存</a-button
        >
      </a-space>
    </header>

    <a-alert v-if="report" class="monthly-order-page__snapshot">
      月度快照更新于
      {{
        formatDateTime(report.snapshot.updatedAt)
      }}。购买按下单月份归集；退款按退款申请月份单独归集，不回写原购买月份。
    </a-alert>

    <a-spin :loading="loading">
      <div class="monthly-order-page__summary">
        <article
          ><span>当月全部订单</span
          ><strong>{{ formatCount(report?.totals.allOrders) }}</strong
          ><small
            >有效 {{ formatCount(report?.totals.validOrders) }} / 异常
            {{ formatCount(report?.totals.abnormalOrders) }}</small
          ></article
        >
        <article
          ><span>有效订单金额</span
          ><strong>{{ formatMoney(report?.totals.validAmount) }}</strong
          ><small>真实、已完成购买订单</small></article
        >
        <article
          ><span>退款流水</span
          ><strong>{{ formatCount(report?.totals.completedRefunds) }}</strong
          ><small>{{
            formatMoney(report?.totals.refundedAmount)
          }}</small></article
        >
        <article
          ><span>月度净额</span
          ><strong>{{ formatMoney(report?.totals.netAmount) }}</strong
          ><small>有效订单金额 − 当月退款</small></article
        >
      </div>

      <a-tabs default-active-key="valid" lazy-load>
        <a-tab-pane
          key="valid"
          :title="`有效订单明细（${report?.validOrders.length || 0}）`"
        >
          <order-detail-table :data="report?.validOrders || []" />
        </a-tab-pane>
        <a-tab-pane
          key="abnormal"
          :title="`异常订单清单（${report?.abnormalOrders.length || 0}）`"
        >
          <order-detail-table :data="report?.abnormalOrders || []" abnormal />
        </a-tab-pane>
        <a-tab-pane
          key="refund"
          :title="`退款流水（${report?.refundOrders.length || 0}）`"
        >
          <a-table
            :data="report?.refundOrders || []"
            :pagination="{ pageSize: 20, showTotal: true }"
            :scroll="{ x: 1500 }"
            row-key="id"
          >
            <template #columns>
              <a-table-column title="退款时间" :width="170"
                ><template #cell="{ record }">{{
                  formatDateTime(record.occurredAt)
                }}</template></a-table-column
              >
              <a-table-column
                title="退款类型"
                data-index="refundTypeLabel"
                :width="160"
              />
              <a-table-column title="退款金额" :width="120"
                ><template #cell="{ record }"
                  ><strong class="monthly-order-page__negative"
                    >-{{ formatMoney(record.amount) }}</strong
                  ></template
                ></a-table-column
              >
              <a-table-column
                title="购买产品"
                data-index="productName"
                :width="170"
              />
              <a-table-column
                title="用户名"
                data-index="userName"
                :width="170"
              />
              <a-table-column
                title="原订单号"
                data-index="originalOrderNo"
                :width="240"
              />
              <a-table-column
                title="退款单号"
                data-index="refundNo"
                :width="260"
              />
              <a-table-column
                title="支付渠道"
                data-index="paymentProvider"
                :width="140"
              />
              <a-table-column title="来源" data-index="source" :width="100" />
            </template>
          </a-table>
        </a-tab-pane>
        <a-tab-pane key="summary" title="统计汇总">
          <div class="monthly-order-page__distributions">
            <section
              v-for="item in distributions"
              :key="item.title"
              class="monthly-order-page__distribution"
            >
              <h3>{{ item.title }}</h3>
              <div
                v-for="row in item.data"
                :key="row.label"
                class="monthly-order-page__distribution-row"
              >
                <span>{{ row.label }}</span
                ><strong>{{ row.count }}</strong
                ><span>{{ row.percentage.toFixed(1) }}%</span>
              </div>
              <a-empty v-if="!item.data.length" description="暂无数据" />
            </section>
          </div>
        </a-tab-pane>
      </a-tabs>
    </a-spin>
  </div>
</template>

<script lang="ts" setup>
  import { computed, onMounted, ref } from 'vue';
  import dayjs from 'dayjs';
  import { Message } from '@arco-design/web-vue';
  import type { AdminMonthlyOrderReportDTO } from '@tzl/shared';
  import {
    queryMonthlyOrderReport,
    refreshMonthlyOrderReport,
  } from '@/api/operations';
  import OrderDetailTable from './order-detail-table.vue';

  const month = ref(dayjs().format('YYYY-MM'));
  const loading = ref(false);
  const refreshing = ref(false);
  const report = ref<AdminMonthlyOrderReportDTO>();
  const formatMoney = (value?: number) =>
    `¥${Number(value || 0).toLocaleString('zh-CN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  const formatCount = (value?: number) =>
    Number(value || 0).toLocaleString('zh-CN');
  const formatDateTime = (value?: string) =>
    value ? dayjs(value).format('YYYY/MM/DD HH:mm') : '-';
  const distributions = computed(() => [
    { title: '订单状态分布', data: report.value?.statusDistribution || [] },
    {
      title: '有效订单产品分布',
      data: report.value?.productDistribution || [],
    },
    {
      title: '有效订单关系分布',
      data: report.value?.relationshipDistribution || [],
    },
    {
      title: '异常类型分布',
      data: report.value?.abnormalTypeDistribution || [],
    },
    { title: '退款类型分布', data: report.value?.refundTypeDistribution || [] },
  ]);

  const fetch = async () => {
    try {
      loading.value = true;
      report.value = (await queryMonthlyOrderReport(month.value)).data;
    } catch {
      Message.error('月度订单明细加载失败');
    } finally {
      loading.value = false;
    }
  };
  const refreshAndSave = async () => {
    try {
      refreshing.value = true;
      report.value = (await refreshMonthlyOrderReport(month.value)).data;
      Message.success('月度订单明细已重新计算并保存');
    } catch {
      Message.error('月度订单明细更新失败');
    } finally {
      refreshing.value = false;
    }
  };
  onMounted(fetch);
</script>

<script lang="ts">
  export default { name: 'OperationsOrderStatistics' };
</script>

<style lang="less" scoped>
  .monthly-order-page {
    min-height: 100%;
    padding: 24px;
    background: var(--color-fill-2);

    &__header {
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 16px;

      h1 {
        margin: 0 0 6px;
        font-size: 24px;
      }

      p {
        margin: 0;
        color: var(--color-text-3);
      }
    }

    &__snapshot {
      margin-bottom: 16px;
    }

    &__summary {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 14px;
      margin-bottom: 18px;

      article {
        display: flex;
        flex-direction: column;
        gap: 7px;
        padding: 18px;
        border-radius: 8px;
        background: var(--color-bg-2);
      }

      span,
      small {
        color: var(--color-text-3);
      }

      strong {
        font-size: 24px;
      }
    }

    &__negative {
      color: rgb(var(--red-6));
    }

    &__distributions {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 16px;
    }

    &__distribution {
      padding: 16px;
      border-radius: 8px;
      background: var(--color-bg-2);

      h3 {
        margin: 0 0 12px;
      }
    }

    &__distribution-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 60px 70px;
      gap: 8px;
      padding: 9px 0;
      border-top: 1px solid var(--color-border-1);

      strong,
      span:last-child {
        text-align: right;
      }
    }
  }
  @media (max-width: 1000px) {
    .monthly-order-page {
      &__summary {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      &__distributions {
        grid-template-columns: 1fr;
      }
    }
  }
</style>
