<template>
  <order-list-panel :title="pageTitle" :order-type="routeOrderType" />
</template>

<script lang="ts" setup>
  import { computed } from 'vue';
  import { useRoute } from 'vue-router';
  import OrderListPanel from './components/order-list-panel.vue';

  const route = useRoute();
  const routeOrderType = computed(() =>
    route.meta.orderType === 'vip_plan' ? 'vip_plan' : undefined
  );
  const pageTitle = computed(() =>
    routeOrderType.value === 'vip_plan' ? '会员订单' : '我的订单'
  );
</script>

<script lang="ts">
  export default {
    name: 'OrderList',
  };
</script>
