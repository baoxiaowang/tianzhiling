<template>
  <a-table
    :data="data"
    :pagination="false"
    :scroll="{ x: abnormal ? 1880 : 1500, y: 600 }"
    row-key="id"
  >
    <template #columns>
      <a-table-column title="付款时间" :width="170">
        <template #cell="{ record }">{{
          formatDate(record.orderedAt)
        }}</template>
      </a-table-column>
      <a-table-column title="购买产品" data-index="productName" :width="170" />
      <a-table-column title="价格" :width="100">
        <template #cell="{ record }">{{ formatMoney(record.amount) }}</template>
      </a-table-column>
      <a-table-column
        title="智能体名"
        data-index="agentNames"
        :width="230"
        ellipsis
        tooltip
      />
      <a-table-column
        title="用户名"
        data-index="userName"
        :width="170"
        ellipsis
        tooltip
      />
      <a-table-column title="关系" :width="110">
        <template #cell="{ record }">
          <a-tag
            :color="record.relationship === '未识别' ? 'orange' : 'arcoblue'"
            >{{ record.relationship }}</a-tag
          >
        </template>
      </a-table-column>
      <a-table-column
        title="下单互动数"
        data-index="interactionCount"
        :width="120"
      />
      <a-table-column title="智能体创建时间" :width="170">
        <template #cell="{ record }">{{
          formatDate(record.agentCreatedAt)
        }}</template>
      </a-table-column>
      <a-table-column title="付款周期" :width="110">
        <template #cell="{ record }">{{ record.paymentCycleDays }} 天</template>
      </a-table-column>
      <template v-if="abnormal">
        <a-table-column
          title="订单状态"
          data-index="statusLabel"
          :width="120"
        />
        <a-table-column title="异常类型" :width="180">
          <template #cell="{ record }">{{
            record.abnormalTypes.join(' + ')
          }}</template>
        </a-table-column>
        <a-table-column
          title="异常说明"
          data-index="abnormalReason"
          :width="250"
        />
        <a-table-column
          title="支付渠道"
          data-index="paymentProvider"
          :width="140"
        />
        <a-table-column title="来源" data-index="source" :width="100" />
      </template>
      <a-table-column title="订单号" data-index="orderNo" :width="240" />
    </template>
  </a-table>
</template>

<script lang="ts" setup>
  import dayjs from 'dayjs';
  import type { AdminMonthlyOrderRecordDTO } from '@tzl/shared';

  withDefaults(
    defineProps<{ data: AdminMonthlyOrderRecordDTO[]; abnormal?: boolean }>(),
    {
      abnormal: false,
    }
  );
  const formatMoney = (value?: number) => `¥${Number(value || 0).toFixed(2)}`;
  const formatDate = (value?: string) =>
    value ? dayjs(value).format('YYYY/MM/DD HH:mm') : '-';
</script>
