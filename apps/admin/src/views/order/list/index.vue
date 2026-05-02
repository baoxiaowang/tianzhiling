<template>
  <div class="order-page">
    <a-card class="order-page__card" :bordered="false">
      <template #title>我的订单</template>

      <a-form :model="searchForm" layout="inline" class="order-page__search">
        <a-form-item field="keyword" label="关键词">
          <a-input
            v-model="searchForm.keyword"
            allow-clear
            placeholder="搜索订单号、用户、手机号、交易号"
            @press-enter="handleSearch"
          />
        </a-form-item>
        <a-form-item field="status" label="订单状态">
          <a-select
            v-model="searchForm.status"
            allow-clear
            placeholder="全部"
            class="order-page__filter"
          >
            <a-option value="pending">待支付</a-option>
            <a-option value="paid">已支付</a-option>
            <a-option value="granting">发放中</a-option>
            <a-option value="completed">已完成</a-option>
            <a-option value="closed">已关闭</a-option>
            <a-option value="refunded">已退款</a-option>
            <a-option value="grant_failed">发放失败</a-option>
          </a-select>
        </a-form-item>
        <a-form-item field="source" label="来源">
          <a-select
            v-model="searchForm.source"
            allow-clear
            placeholder="全部"
            class="order-page__filter"
          >
            <a-option value="weapp">小程序</a-option>
            <a-option value="app">App</a-option>
            <a-option value="admin">管理端</a-option>
          </a-select>
        </a-form-item>
        <a-form-item>
          <a-space>
            <a-button type="primary" :loading="loading" @click="handleSearch">
              <template #icon>
                <icon-search />
              </template>
              查询
            </a-button>
            <a-button @click="resetSearch">重置</a-button>
          </a-space>
        </a-form-item>
      </a-form>

      <a-table
        row-key="id"
        :data="renderList"
        :loading="loading"
        :pagination="false"
        :bordered="false"
        :scroll="{ x: 1480 }"
      >
        <template #empty>
          <a-empty :description="emptyDescription">
            <a-button
              v-if="hasSearchCondition"
              type="text"
              @click="resetSearch"
            >
              清空筛选
            </a-button>
          </a-empty>
        </template>
        <template #columns>
          <a-table-column title="订单信息" data-index="orderNo" :width="260">
            <template #cell="{ record }">
              <div class="order-page__main">
                <a-typography-text
                  class="order-page__mono order-page__order-no"
                  copyable
                >
                  {{ record.orderNo }}
                </a-typography-text>
                <div class="order-page__title">{{ record.title || '-' }}</div>
              </div>
            </template>
          </a-table-column>
          <a-table-column title="用户" data-index="user" :width="220">
            <template #cell="{ record }">
              <div class="order-page__user">
                <div class="order-page__user-name">
                  {{ record.user?.name || '-' }}
                </div>
                <div class="order-page__muted">
                  {{ record.user?.phone || record.user?.account || '-' }}
                </div>
              </div>
            </template>
          </a-table-column>
          <a-table-column title="金额" data-index="payableAmount" :width="150">
            <template #cell="{ record }">
              <div>{{ formatAmount(record.payableAmount) }}</div>
              <div v-if="record.refundAmount" class="order-page__refund-amount">
                退 {{ formatAmount(record.refundAmount) }}
              </div>
            </template>
          </a-table-column>
          <a-table-column title="状态" data-index="status" :width="120">
            <template #cell="{ record }">
              <a-tag :color="getStatusColor(record.status)">
                {{ getStatusText(record.status) }}
              </a-tag>
            </template>
          </a-table-column>
          <a-table-column title="来源" data-index="source" :width="100">
            <template #cell="{ record }">
              {{ getSourceText(record.source) }}
            </template>
          </a-table-column>
          <a-table-column
            title="支付渠道"
            data-index="paymentProvider"
            :width="130"
          >
            <template #cell="{ record }">
              {{ getPaymentProviderText(record.paymentProvider) }}
            </template>
          </a-table-column>
          <a-table-column
            title="微信交易号"
            data-index="paymentTradeNo"
            :width="220"
          >
            <template #cell="{ record }">
              <a-tooltip
                v-if="record.paymentTradeNo"
                :content="record.paymentTradeNo"
              >
                <span class="order-page__mono order-page__ellipsis">
                  {{ record.paymentTradeNo }}
                </span>
              </a-tooltip>
              <span v-else>-</span>
            </template>
          </a-table-column>
          <a-table-column title="创建时间" data-index="createdAt" :width="170">
            <template #cell="{ record }">
              {{ formatDate(record.createdAt) }}
            </template>
          </a-table-column>
          <a-table-column title="支付时间" data-index="paidAt" :width="170">
            <template #cell="{ record }">
              {{ formatDate(record.paidAt) }}
            </template>
          </a-table-column>
          <a-table-column title="操作" :width="110" fixed="right">
            <template #cell="{ record }">
              <a-button type="text" size="small" @click="openDetail(record)">
                详情
              </a-button>
            </template>
          </a-table-column>
        </template>
      </a-table>

      <div class="order-page__pagination">
        <span class="order-page__total">
          共 {{ pagination.total }} 笔订单
        </span>
        <a-pagination
          :current="pagination.current"
          :page-size="pagination.pageSize"
          :total="pagination.total"
          show-page-size
          @change="onPageChange"
          @page-size-change="onPageSizeChange"
        />
      </div>
    </a-card>

    <a-drawer
      :visible="detailVisible"
      :width="520"
      title="订单详情"
      unmount-on-close
      @cancel="closeDetail"
    >
      <a-descriptions v-if="currentOrder" :column="1" bordered size="large">
        <a-descriptions-item label="订单号">
          <a-typography-text copyable>{{
            currentOrder.orderNo
          }}</a-typography-text>
        </a-descriptions-item>
        <a-descriptions-item label="订单标题">
          {{ currentOrder.title || '-' }}
        </a-descriptions-item>
        <a-descriptions-item label="订单状态">
          <a-tag :color="getStatusColor(currentOrder.status)">
            {{ getStatusText(currentOrder.status) }}
          </a-tag>
        </a-descriptions-item>
        <a-descriptions-item label="用户">
          {{ currentOrder.user?.name || '-' }}
          <span class="order-page__muted">
            {{ currentOrder.user?.phone || currentOrder.user?.account || '' }}
          </span>
        </a-descriptions-item>
        <a-descriptions-item label="应付金额">
          {{ formatAmount(currentOrder.payableAmount) }}
        </a-descriptions-item>
        <a-descriptions-item label="原价">
          {{ formatAmount(currentOrder.amount) }}
        </a-descriptions-item>
        <a-descriptions-item label="优惠金额">
          {{
            formatAmount(
              currentOrder.discountAmount + currentOrder.couponAmount
            )
          }}
        </a-descriptions-item>
        <a-descriptions-item label="已付金额">
          {{ formatOptionalAmount(currentOrder.paidAmount) }}
        </a-descriptions-item>
        <a-descriptions-item label="退款金额">
          {{ formatOptionalAmount(currentOrder.refundAmount) }}
        </a-descriptions-item>
        <a-descriptions-item label="支付渠道">
          {{ getPaymentProviderText(currentOrder.paymentProvider) }}
        </a-descriptions-item>
        <a-descriptions-item label="微信交易号">
          <a-typography-text v-if="currentOrder.paymentTradeNo" copyable>
            {{ currentOrder.paymentTradeNo }}
          </a-typography-text>
          <span v-else>-</span>
        </a-descriptions-item>
        <a-descriptions-item label="创建时间">
          {{ formatDate(currentOrder.createdAt) }}
        </a-descriptions-item>
        <a-descriptions-item label="支付时间">
          {{ formatDate(currentOrder.paidAt) }}
        </a-descriptions-item>
        <a-descriptions-item label="关闭时间">
          {{ formatDate(currentOrder.closedAt) }}
        </a-descriptions-item>
        <a-descriptions-item label="退款时间">
          {{ formatDate(currentOrder.refundedAt) }}
        </a-descriptions-item>
      </a-descriptions>
    </a-drawer>
  </div>
</template>

<script lang="ts" setup>
  import { computed, reactive, ref } from 'vue';
  import dayjs from 'dayjs';
  import { Message } from '@arco-design/web-vue';
  import type { OrderSourceDTO, OrderStatusDTO } from '@tzl/shared';
  import useLoading from '@/hooks/loading';
  import { OrderRecord, queryOrderList } from '@/api/order';

  const { loading, setLoading } = useLoading();
  const renderList = ref<OrderRecord[]>([]);
  const detailVisible = ref(false);
  const currentOrder = ref<OrderRecord>();
  const searchForm = reactive<{
    keyword: string;
    status?: OrderStatusDTO;
    source?: OrderSourceDTO;
  }>({
    keyword: '',
    status: undefined,
    source: undefined,
  });
  const pagination = reactive({
    current: 1,
    pageSize: 20,
    total: 0,
  });
  const statusMap: Record<OrderStatusDTO, { text: string; color: string }> = {
    pending: { text: '待支付', color: 'orange' },
    paid: { text: '已支付', color: 'blue' },
    granting: { text: '发放中', color: 'arcoblue' },
    completed: { text: '已完成', color: 'green' },
    closed: { text: '已关闭', color: 'gray' },
    refunded: { text: '已退款', color: 'purple' },
    grant_failed: { text: '发放失败', color: 'red' },
  };
  const sourceMap: Record<OrderSourceDTO, string> = {
    weapp: '小程序',
    app: 'App',
    admin: '管理端',
  };
  const requestParams = computed(() => ({
    keyword: searchForm.keyword.trim() || undefined,
    status: searchForm.status,
    orderType: 'vip_plan' as const,
    source: searchForm.source,
    page: pagination.current,
    pageSize: pagination.pageSize,
  }));
  const hasSearchCondition = computed(
    () =>
      Boolean(searchForm.keyword.trim()) ||
      Boolean(searchForm.status) ||
      Boolean(searchForm.source)
  );
  const emptyDescription = computed(() =>
    hasSearchCondition.value ? '未找到匹配订单' : '暂无订单数据'
  );

  const fetchData = async () => {
    try {
      setLoading(true);
      const { data } = await queryOrderList(requestParams.value);
      renderList.value = data.items;
      pagination.total = data.total;
      pagination.current = data.page;
      pagination.pageSize = data.pageSize;
    } catch (error) {
      Message.error('订单列表加载失败');
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = () => {
    pagination.current = 1;
    fetchData();
  };

  const resetSearch = () => {
    searchForm.keyword = '';
    searchForm.status = undefined;
    searchForm.source = undefined;
    pagination.current = 1;
    fetchData();
  };

  const onPageChange = (page: number) => {
    pagination.current = page;
    fetchData();
  };

  const onPageSizeChange = (pageSize: number) => {
    pagination.pageSize = pageSize;
    pagination.current = 1;
    fetchData();
  };

  const openDetail = (record: OrderRecord) => {
    currentOrder.value = record;
    detailVisible.value = true;
  };

  const closeDetail = () => {
    detailVisible.value = false;
    currentOrder.value = undefined;
  };

  const formatDate = (value?: string) => {
    return value ? dayjs(value).format('YYYY-MM-DD HH:mm') : '-';
  };

  const formatAmount = (value: number) => {
    return `¥${((value || 0) / 100).toFixed(2)}`;
  };

  const formatOptionalAmount = (value?: number) => {
    return value == null ? '-' : formatAmount(value);
  };

  const getStatusText = (status: OrderStatusDTO) => {
    return statusMap[status]?.text ?? status;
  };

  const getStatusColor = (status: OrderStatusDTO) => {
    return statusMap[status]?.color ?? 'gray';
  };

  const getSourceText = (source: OrderSourceDTO) => {
    return sourceMap[source] ?? source;
  };

  const getPaymentProviderText = (provider?: string) => {
    if (provider === 'wechat_pay') {
      return '微信支付';
    }

    return provider || '-';
  };

  fetchData();
</script>

<script lang="ts">
  export default {
    name: 'OrderList',
  };
</script>

<style lang="less" scoped>
  .order-page {
    min-height: 100%;
    padding: 16px 20px;
    background: var(--color-fill-2);

    &__card {
      min-height: calc(100vh - 112px);
      border-radius: 4px;
    }

    &__search {
      margin-bottom: 16px;
    }

    &__filter {
      width: 140px;
    }

    &__pagination {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-top: 16px;
    }

    &__total,
    &__muted {
      color: var(--color-text-2);
      font-size: 14px;
    }

    &__main,
    &__user {
      min-width: 0;
    }

    &__order-no {
      max-width: 220px;
    }

    &__title,
    &__user-name {
      margin-top: 4px;
      overflow: hidden;
      color: var(--color-text-1);
      font-weight: 500;
      white-space: nowrap;
      text-overflow: ellipsis;
    }

    &__mono {
      display: inline-block;
      overflow: hidden;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas,
        'Liberation Mono', monospace;
      white-space: nowrap;
      text-overflow: ellipsis;
      vertical-align: bottom;
    }

    &__ellipsis {
      max-width: 180px;
    }

    &__refund-amount {
      margin-top: 4px;
      color: rgb(var(--red-6));
      font-size: 12px;
    }
  }
</style>
