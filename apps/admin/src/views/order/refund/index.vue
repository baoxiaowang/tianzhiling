<template>
  <order-list-panel
    title="退款管理"
    status="refund_requested"
    hide-status-filter
    empty-description="暂无退款申请"
  />
</template>

<script lang="ts" setup>
  import OrderListPanel from '@/views/order/list/components/order-list-panel.vue';
</script>

<script lang="ts">
  export default {
    name: 'OrderRefundList',
  };
</script>
