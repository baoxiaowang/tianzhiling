<template>
  <div class="operations-page">
    <header class="operations-page__header">
      <div>
        <h1>每日运营统计</h1>
        <p>统一按北京时间统计用户、智能体、实时聊天消息和真实支付流水。</p>
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

    <a-grid :cols="24" :col-gap="16" :row-gap="16">
      <a-grid-item
        v-for="item in summary"
        :key="item.label"
        :span="{ xs: 24, sm: 12, xl: 4 }"
      >
        <a-card :bordered="false">
          <a-statistic
            :title="item.label"
            :value="item.value"
            :precision="item.money ? 2 : 0"
            :prefix="item.money ? '¥' : ''"
          />
        </a-card>
      </a-grid-item>

      <a-grid-item :span="24">
        <a-card :bordered="false">
          <template #title>{{ report?.month || month }} 每日明细</template>
          <template #extra>
            <a-typography-text type="secondary">
              用户消息不含截图导入的历史消息；收入排除一元试听和管理端订单
            </a-typography-text>
          </template>
          <a-table
            row-key="date"
            :data="report?.daily || []"
            :loading="loading"
            :pagination="false"
            :scroll="{ x: 1040 }"
          >
            <template #columns>
              <a-table-column title="日期" data-index="date" :width="140" />
              <a-table-column
                title="新增用户"
                data-index="newUsers"
                :width="120"
              />
              <a-table-column
                title="创建智能体"
                data-index="newAgents"
                :width="130"
              />
              <a-table-column
                title="用户→AI消息"
                data-index="userMessages"
                :width="150"
              />
              <a-table-column title="支付收入" :width="140">
                <template #cell="{ record }">{{
                  formatMoney(record.paidRevenue)
                }}</template>
              </a-table-column>
              <a-table-column title="退款" :width="140">
                <template #cell="{ record }">{{
                  formatMoney(record.refundedRevenue)
                }}</template>
              </a-table-column>
              <a-table-column title="净收入" :width="140">
                <template #cell="{ record }"
                  ><strong>{{
                    formatMoney(record.netRevenue)
                  }}</strong></template
                >
              </a-table-column>
            </template>
          </a-table>
        </a-card>
      </a-grid-item>
    </a-grid>
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
  const report = ref<AdminOperationsReportDTO>();
  const summary = computed(() => [
    { label: '本月新增用户', value: report.value?.totals.newUsers || 0 },
    { label: '创建智能体', value: report.value?.totals.newAgents || 0 },
    { label: '用户→AI消息', value: report.value?.totals.userMessages || 0 },
    {
      label: '支付收入',
      value: report.value?.totals.paidRevenue || 0,
      money: true,
    },
    {
      label: '退款',
      value: report.value?.totals.refundedRevenue || 0,
      money: true,
    },
    {
      label: '净收入',
      value: report.value?.totals.netRevenue || 0,
      money: true,
    },
  ]);

  const fetchData = async () => {
    try {
      loading.value = true;
      const { data } = await queryOperationsReport(month.value);
      report.value = data;
    } catch (error) {
      Message.error('每日运营统计加载失败');
    } finally {
      loading.value = false;
    }
  };
  const formatMoney = (value: number) =>
    `¥${Number(value || 0).toLocaleString('zh-CN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;

  onMounted(fetchData);
</script>

<style lang="less" scoped>
  @import url('../operations-page.less');
</style>
