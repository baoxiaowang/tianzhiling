<template>
  <div class="order-page" :class="{ 'order-page--embedded': embedded }">
    <a-card
      class="order-page__card"
      :class="{ 'order-page__card--embedded': embedded }"
      :bordered="false"
      :title="embedded ? undefined : pageTitle"
    >
      <template v-if="canCreateAdminOrder" #extra>
        <a-button type="primary" @click="openCreateModal">
          <template #icon>
            <icon-plus />
          </template>
          创建订单
        </a-button>
      </template>

      <a-form :model="searchForm" layout="inline" class="order-page__search">
        <a-form-item field="keyword" label="关键词">
          <a-input
            v-model="searchForm.keyword"
            allow-clear
            placeholder="搜索订单号、用户、手机号、交易号、智能体ID"
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
            <a-option value="refund_requested">申请退款</a-option>
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
        :scroll="{ x: 1780 }"
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
                  <a-link
                    v-if="canOpenOrderUser(record)"
                    @click="openUserDetail(record)"
                  >
                    {{ resolveOrderUserName(record) }}
                  </a-link>
                  <span v-else>{{ resolveOrderUserName(record) }}</span>
                </div>
                <div class="order-page__muted">
                  {{ resolveOrderUserContact(record) }}
                </div>
              </div>
            </template>
          </a-table-column>
          <a-table-column title="智能体ID" data-index="agentId" :width="220">
            <template #cell="{ record }">
              <a-typography-text
                v-if="record.agentId"
                class="order-page__mono order-page__agent-id"
                copyable
              >
                {{ record.agentId }}
              </a-typography-text>
              <span v-else>-</span>
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
            title="微信发货"
            data-index="virtualGoodsProvideStatus"
            :width="130"
          >
            <template #cell="{ record }">
              <template v-if="getVirtualGoodsProvideStatus(record)">
                <a-tooltip
                  v-if="getVirtualGoodsProvideError(record)"
                  :content="getVirtualGoodsProvideError(record)"
                >
                  <a-tag :color="getVirtualGoodsProvideStatusColor(record)">
                    {{ getVirtualGoodsProvideStatusText(record) }}
                  </a-tag>
                </a-tooltip>
                <a-tag
                  v-else
                  :color="getVirtualGoodsProvideStatusColor(record)"
                >
                  {{ getVirtualGoodsProvideStatusText(record) }}
                </a-tag>
              </template>
              <span v-else>-</span>
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
          <a-table-column title="操作" :width="220" fixed="right">
            <template #cell="{ record }">
              <a-space>
                <a-button type="text" size="small" @click="openDetail(record)">
                  详情
                </a-button>
                <a-button
                  v-if="canSyncPaymentStatus(record)"
                  type="text"
                  size="small"
                  :loading="syncLoadingId === record.id"
                  @click="handleSyncPaymentStatus(record)"
                >
                  <template #icon>
                    <icon-refresh />
                  </template>
                  刷新状态
                </a-button>
                <a-popconfirm
                  v-if="canRefundOrder(record)"
                  :content="getRefundConfirmContent(record)"
                  ok-text="退订"
                  cancel-text="取消"
                  position="left"
                  @ok="handleRefund(record)"
                >
                  <a-button
                    type="text"
                    status="danger"
                    size="small"
                    :loading="refundLoadingId === record.id"
                  >
                    退订
                  </a-button>
                </a-popconfirm>
              </a-space>
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
          <a-link
            v-if="canOpenOrderUser(currentOrder)"
            @click="openUserDetail(currentOrder)"
          >
            {{ resolveOrderUserName(currentOrder) }}
          </a-link>
          <span v-else>{{ resolveOrderUserName(currentOrder) }}</span>
          <span class="order-page__muted">
            {{ resolveOrderUserContact(currentOrder) }}
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
        <a-descriptions-item
          v-if="isVirtualPaymentOrder(currentOrder)"
          label="微信发货状态"
        >
          <a-tooltip
            v-if="getVirtualGoodsProvideError(currentOrder)"
            :content="getVirtualGoodsProvideError(currentOrder)"
          >
            <a-tag :color="getVirtualGoodsProvideStatusColor(currentOrder)">
              {{ getVirtualGoodsProvideStatusText(currentOrder) }}
            </a-tag>
          </a-tooltip>
          <a-tag
            v-else
            :color="getVirtualGoodsProvideStatusColor(currentOrder)"
          >
            {{ getVirtualGoodsProvideStatusText(currentOrder) }}
          </a-tag>
        </a-descriptions-item>
        <a-descriptions-item
          v-if="isVirtualPaymentOrder(currentOrder)"
          label="微信发货时间"
        >
          {{ formatDate(currentOrder.virtualGoodsProvidedAt) }}
        </a-descriptions-item>
        <a-descriptions-item
          v-if="isVirtualPaymentOrder(currentOrder)"
          label="发货失败时间"
        >
          {{ formatDate(currentOrder.virtualGoodsProvideFailedAt) }}
        </a-descriptions-item>
        <a-descriptions-item
          v-if="
            isVirtualPaymentOrder(currentOrder) &&
            currentOrder.virtualGoodsProvideError
          "
          label="发货失败原因"
        >
          {{ currentOrder.virtualGoodsProvideError }}
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

    <a-modal
      v-model:visible="createVisible"
      :title="createModalTitle"
      :footer="false"
      unmount-on-close
      @cancel="closeCreateModal"
    >
      <a-form :model="createForm" layout="vertical">
        <a-form-item
          field="orderType"
          label="订单类型"
          :rules="[{ required: true, message: '请选择订单类型' }]"
        >
          <a-select
            v-model="createForm.orderType"
            class="order-page__full"
            @change="handleCreateOrderTypeChange"
          >
            <a-option value="vip_plan">会员订单</a-option>
            <a-option value="voice_package">声音套餐订单</a-option>
          </a-select>
        </a-form-item>
        <a-form-item
          field="userId"
          label="用户"
          :rules="[{ required: true, message: '请选择用户' }]"
        >
          <a-select
            v-model="createForm.userId"
            allow-clear
            allow-search
            :filter-option="false"
            :loading="userOptionsLoading"
            placeholder="搜索手机号、昵称或用户ID"
            class="order-page__full"
            @change="handleCreateUserChange"
            @search="handleUserSearch"
          >
            <a-option
              v-for="item in userOptions"
              :key="item.id"
              :value="item.id"
            >
              {{ formatUserOption(item) }}
            </a-option>
          </a-select>
        </a-form-item>
        <a-form-item
          v-if="isCreateVipPlanOrder"
          field="vipPlanId"
          label="VIP计划"
          :rules="[{ required: true, message: '请选择VIP计划' }]"
        >
          <a-select
            v-model="createForm.vipPlanId"
            allow-clear
            :loading="vipPlanOptionsLoading"
            placeholder="选择启用中的VIP计划"
            class="order-page__full"
          >
            <a-option
              v-for="item in vipPlanOptions"
              :key="item.id"
              :value="item.id"
            >
              {{ formatVipPlanOption(item) }}
            </a-option>
          </a-select>
        </a-form-item>
        <a-form-item
          v-if="isCreateVoicePackageOrder"
          field="voicePackageId"
          label="声音套餐"
          :rules="[{ required: true, message: '请选择声音套餐' }]"
        >
          <a-select
            v-model="createForm.voicePackageId"
            allow-clear
            :loading="voicePackageOptionsLoading"
            placeholder="选择启用中的声音套餐"
            class="order-page__full"
          >
            <a-option
              v-for="item in voicePackageOptions"
              :key="item.id"
              :value="item.id"
            >
              {{ formatVoicePackageOption(item) }}
            </a-option>
          </a-select>
        </a-form-item>
        <a-form-item
          v-if="isCreateVoicePackageOrder"
          field="agentId"
          label="智能体"
          :rules="[{ required: true, message: '请选择智能体' }]"
        >
          <a-select
            v-model="createForm.agentId"
            allow-clear
            allow-search
            :disabled="!createForm.userId"
            :filter-option="false"
            :loading="agentOptionsLoading"
            placeholder="先选择用户，再选择该用户的智能体"
            class="order-page__full"
            @search="handleAgentSearch"
          >
            <a-option
              v-for="item in agentOptions"
              :key="item.id"
              :value="item.id"
            >
              {{ formatAgentOption(item) }}
            </a-option>
          </a-select>
        </a-form-item>
      </a-form>
      <div class="order-page__modal-footer">
        <a-space>
          <a-button @click="closeCreateModal">取消</a-button>
          <a-button
            type="primary"
            :loading="createSubmitting"
            @click="handleCreateOrder"
          >
            {{ createSubmitText }}
          </a-button>
        </a-space>
      </div>
    </a-modal>
  </div>
</template>

<script lang="ts" setup>
  import { computed, reactive, ref, watch } from 'vue';
  import { useRouter } from 'vue-router';
  import dayjs from 'dayjs';
  import { Message } from '@arco-design/web-vue';
  import type {
    OrderSourceDTO,
    OrderStatusDTO,
    OrderTypeDTO,
    VirtualGoodsProvideStatusDTO,
  } from '@tzl/shared';
  import useLoading from '@/hooks/loading';
  import {
    queryAppUserAgents,
    queryAppUserList,
    type AppUserAgentRecord,
    type AppUserRecord,
  } from '@/api/app-user';
  import { queryVipPlanList, type VipPlanRecord } from '@/api/membership';
  import {
    queryVoicePackageList,
    type VoicePackageRecord,
  } from '@/api/voice-package';
  import {
    createAdminOrder as createAdminOrderApi,
    OrderRecord,
    queryOrderList,
    refundOrder as refundOrderApi,
    syncOrderPaymentStatus as syncOrderPaymentStatusApi,
  } from '@/api/order';

  const props = withDefaults(
    defineProps<{
      title?: string;
      orderType?: 'vip_plan' | 'voice_package';
      userId?: string;
      embedded?: boolean;
    }>(),
    {
      title: '',
      orderType: undefined,
      userId: '',
      embedded: false,
    }
  );

  const { loading, setLoading } = useLoading();
  const router = useRouter();
  const renderList = ref<OrderRecord[]>([]);
  const detailVisible = ref(false);
  const currentOrder = ref<OrderRecord>();
  const refundLoadingId = ref('');
  const syncLoadingId = ref('');
  const createVisible = ref(false);
  const createSubmitting = ref(false);
  const userOptionsLoading = ref(false);
  const vipPlanOptionsLoading = ref(false);
  const voicePackageOptionsLoading = ref(false);
  const agentOptionsLoading = ref(false);
  const userOptions = ref<AppUserRecord[]>([]);
  const vipPlanOptions = ref<VipPlanRecord[]>([]);
  const voicePackageOptions = ref<VoicePackageRecord[]>([]);
  const agentOptions = ref<AppUserAgentRecord[]>([]);
  let userSearchRequestId = 0;
  let agentSearchRequestId = 0;
  const searchForm = reactive<{
    keyword: string;
    status?: OrderStatusDTO | '';
    source?: OrderSourceDTO | '';
  }>({
    keyword: '',
    status: undefined,
    source: undefined,
  });
  const createForm = reactive<{
    orderType: OrderTypeDTO;
    userId: string;
    vipPlanId: string;
    voicePackageId: string;
    agentId: string;
  }>({
    orderType: 'vip_plan',
    userId: '',
    vipPlanId: '',
    voicePackageId: '',
    agentId: '',
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
    refund_requested: { text: '申请退款', color: 'orange' },
    refunded: { text: '已退款', color: 'purple' },
    grant_failed: { text: '发放失败', color: 'red' },
  };
  const sourceMap: Record<OrderSourceDTO, string> = {
    weapp: '小程序',
    app: 'App',
    admin: '管理端',
  };
  const virtualGoodsProvideStatusMap: Record<
    VirtualGoodsProvideStatusDTO,
    { text: string; color: string }
  > = {
    pending: { text: '待发货', color: 'orange' },
    provided: { text: '已发货', color: 'green' },
    failed: { text: '发货失败', color: 'red' },
  };
  const orderTypeTitleMap: Record<string, string> = {
    vip_plan: '会员订单',
    voice_package: '声音套餐订单',
  };
  const pageTitle = computed(() => {
    if (props.title) {
      return props.title;
    }

    return props.orderType ? orderTypeTitleMap[props.orderType] : '我的订单';
  });
  const requestParams = computed(() => ({
    keyword: searchForm.keyword.trim() || undefined,
    status: searchForm.status || undefined,
    orderType: props.orderType,
    source: searchForm.source || undefined,
    userId: props.userId || undefined,
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
  const canCreateAdminOrder = computed(
    () => !props.orderType && !props.embedded && !props.userId
  );
  const isCreateVipPlanOrder = computed(
    () => createForm.orderType === 'vip_plan'
  );
  const isCreateVoicePackageOrder = computed(
    () => createForm.orderType === 'voice_package'
  );
  const createModalTitle = computed(() =>
    isCreateVoicePackageOrder.value ? '创建声音套餐订单' : '创建会员订单'
  );
  const createSubmitText = computed(() =>
    isCreateVoicePackageOrder.value ? '创建声音套餐订单' : '创建会员订单'
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

  const canRefundOrder = (record: OrderRecord) => {
    return (
      (record.orderType === 'vip_plan' ||
        record.orderType === 'voice_package') &&
      (record.status === 'completed' ||
        record.status === 'paid' ||
        record.status === 'refund_requested' ||
        record.status === 'grant_failed')
    );
  };

  const canSyncPaymentStatus = (record: OrderRecord) => {
    if (
      isVirtualPaymentOrder(record) &&
      record.status === 'completed' &&
      !isVirtualGoodsProvided(record)
    ) {
      return true;
    }

    const isWechatPayment =
      !record.paymentProvider ||
      record.paymentProvider === 'wechat_pay' ||
      record.paymentProvider === 'wechat_virtual_pay';

    return (
      isWechatPayment &&
      (record.status === 'pending' || record.status === 'closed')
    );
  };

  const replaceOrderRecord = (record: OrderRecord) => {
    const index = renderList.value.findIndex((item) => item.id === record.id);

    if (index >= 0) {
      renderList.value[index] = record;
    }

    if (currentOrder.value?.id === record.id) {
      currentOrder.value = record;
    }
  };

  const handleSyncPaymentStatus = async (record: OrderRecord) => {
    if (syncLoadingId.value) {
      return;
    }

    const previousStatus = record.status;
    const previousVirtualGoodsProvideStatus =
      getVirtualGoodsProvideStatus(record);
    syncLoadingId.value = record.id;

    try {
      const { data } = await syncOrderPaymentStatusApi(record.id);

      replaceOrderRecord(data);
      showSyncPaymentStatusMessage(
        data,
        previousStatus,
        previousVirtualGoodsProvideStatus
      );
    } catch (error) {
      Message.error(
        error instanceof Error && error.message
          ? error.message
          : '刷新订单状态失败，请稍后重试'
      );
    } finally {
      syncLoadingId.value = '';
    }
  };

  const openCreateModal = () => {
    resetCreateForm();
    createVisible.value = true;
    fetchUserOptions();
    fetchVipPlanOptions();
    fetchVoicePackageOptions();
  };

  const closeCreateModal = () => {
    if (createSubmitting.value) {
      return;
    }

    createVisible.value = false;
  };

  const resetCreateForm = () => {
    createForm.orderType = 'vip_plan';
    createForm.userId = '';
    createForm.vipPlanId = '';
    createForm.voicePackageId = '';
    createForm.agentId = '';
    agentOptions.value = [];
  };

  const fetchUserOptions = async (keyword = '') => {
    userSearchRequestId += 1;
    const requestId = userSearchRequestId;

    try {
      userOptionsLoading.value = true;
      const { data } = await queryAppUserList({
        keyword: keyword.trim() || undefined,
        page: 1,
        pageSize: 20,
      });

      if (requestId === userSearchRequestId) {
        userOptions.value = data.items;
      }
    } catch (error) {
      if (requestId === userSearchRequestId) {
        userOptions.value = [];
        Message.error('用户列表加载失败');
      }
    } finally {
      if (requestId === userSearchRequestId) {
        userOptionsLoading.value = false;
      }
    }
  };

  const handleUserSearch = (value: string) => {
    fetchUserOptions(value);
  };

  const handleCreateOrderTypeChange = () => {
    createForm.vipPlanId = '';
    createForm.voicePackageId = '';
    createForm.agentId = '';

    if (isCreateVoicePackageOrder.value && createForm.userId) {
      fetchAgentOptions(createForm.userId);
    }
  };

  const handleCreateUserChange = () => {
    createForm.agentId = '';
    agentOptions.value = [];

    if (isCreateVoicePackageOrder.value && createForm.userId) {
      fetchAgentOptions(createForm.userId);
    }
  };

  const fetchVipPlanOptions = async () => {
    try {
      vipPlanOptionsLoading.value = true;
      const { data } = await queryVipPlanList({
        status: 'active',
        page: 1,
        pageSize: 100,
      });

      vipPlanOptions.value = data.items;
    } catch (error) {
      vipPlanOptions.value = [];
      Message.error('VIP计划加载失败');
    } finally {
      vipPlanOptionsLoading.value = false;
    }
  };

  const fetchVoicePackageOptions = async () => {
    try {
      voicePackageOptionsLoading.value = true;
      const { data } = await queryVoicePackageList({
        status: 'active',
        page: 1,
        pageSize: 100,
      });

      voicePackageOptions.value = data.items;
    } catch (error) {
      voicePackageOptions.value = [];
      Message.error('声音套餐加载失败');
    } finally {
      voicePackageOptionsLoading.value = false;
    }
  };

  const fetchAgentOptions = async (userId: string, keyword = '') => {
    if (!userId) {
      agentOptions.value = [];
      return;
    }

    agentSearchRequestId += 1;
    const requestId = agentSearchRequestId;

    try {
      agentOptionsLoading.value = true;
      const { data } = await queryAppUserAgents(userId, {
        keyword: keyword.trim() || undefined,
        page: 1,
        pageSize: 20,
      });

      if (requestId === agentSearchRequestId) {
        agentOptions.value = data.items;
      }
    } catch (error) {
      if (requestId === agentSearchRequestId) {
        agentOptions.value = [];
        Message.error('智能体列表加载失败');
      }
    } finally {
      if (requestId === agentSearchRequestId) {
        agentOptionsLoading.value = false;
      }
    }
  };

  const handleAgentSearch = (value: string) => {
    fetchAgentOptions(createForm.userId, value);
  };

  const handleCreateOrder = async () => {
    if (createSubmitting.value) {
      return;
    }

    if (!createForm.userId) {
      Message.warning('请选择用户');
      return;
    }

    if (isCreateVipPlanOrder.value && !createForm.vipPlanId) {
      Message.warning('请选择VIP计划');
      return;
    }

    if (isCreateVoicePackageOrder.value && !createForm.voicePackageId) {
      Message.warning('请选择声音套餐');
      return;
    }

    if (isCreateVoicePackageOrder.value && !createForm.agentId) {
      Message.warning('请选择智能体');
      return;
    }

    try {
      createSubmitting.value = true;
      await createAdminOrderApi({
        orderType: createForm.orderType,
        userId: createForm.userId,
        vipPlanId: isCreateVipPlanOrder.value
          ? createForm.vipPlanId
          : undefined,
        voicePackageId: isCreateVoicePackageOrder.value
          ? createForm.voicePackageId
          : undefined,
        agentId: isCreateVoicePackageOrder.value
          ? createForm.agentId
          : undefined,
      });
      createVisible.value = false;
      Message.success(`${createSubmitText.value}已创建`);
      fetchData();
    } catch (error) {
      Message.error(
        error instanceof Error && error.message
          ? error.message
          : '创建订单失败，请稍后重试'
      );
    } finally {
      createSubmitting.value = false;
    }
  };

  const handleRefund = async (record: OrderRecord) => {
    if (refundLoadingId.value) {
      return;
    }

    refundLoadingId.value = record.id;

    try {
      const { data } = await refundOrderApi(record.id);

      replaceOrderRecord(data);

      Message.success(getRefundSuccessText(record));
    } catch (error) {
      Message.error(
        error instanceof Error && error.message
          ? error.message
          : '退订失败，请稍后重试'
      );
    } finally {
      refundLoadingId.value = '';
    }
  };

  const canOpenOrderUser = (record: OrderRecord) => {
    return Boolean(record.userId);
  };

  const openUserDetail = (record: OrderRecord) => {
    if (!record.userId) {
      return;
    }

    router.push({
      name: 'AppUserDetail',
      params: {
        id: record.userId,
      },
    });
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

    if (provider === 'wechat_virtual_pay') {
      return '微信虚拟支付';
    }

    if (provider === 'admin_manual') {
      return '管理端创建';
    }

    return provider || '-';
  };

  const isVirtualPaymentOrder = (record: OrderRecord) => {
    return record.paymentProvider === 'wechat_virtual_pay';
  };

  const getVirtualGoodsProvideStatus = (
    record: OrderRecord
  ): VirtualGoodsProvideStatusDTO | undefined => {
    if (!isVirtualPaymentOrder(record)) {
      return undefined;
    }

    if (record.virtualGoodsProvideStatus) {
      return record.virtualGoodsProvideStatus;
    }

    if (record.virtualGoodsProvidedAt) {
      return 'provided';
    }

    return record.status === 'completed' ? 'pending' : undefined;
  };

  const isVirtualGoodsProvided = (record: OrderRecord) => {
    return getVirtualGoodsProvideStatus(record) === 'provided';
  };

  const getVirtualGoodsProvideStatusText = (record: OrderRecord) => {
    const status = getVirtualGoodsProvideStatus(record);
    return status ? virtualGoodsProvideStatusMap[status].text : '-';
  };

  const getVirtualGoodsProvideStatusColor = (record: OrderRecord) => {
    const status = getVirtualGoodsProvideStatus(record);
    return status ? virtualGoodsProvideStatusMap[status].color : 'gray';
  };

  const getVirtualGoodsProvideError = (record: OrderRecord) => {
    return getVirtualGoodsProvideStatus(record) === 'failed'
      ? record.virtualGoodsProvideError || ''
      : '';
  };

  const showSyncPaymentStatusMessage = (
    record: OrderRecord,
    previousStatus: OrderStatusDTO,
    previousVirtualGoodsProvideStatus?: VirtualGoodsProvideStatusDTO
  ) => {
    if (isVirtualPaymentOrder(record) && record.status === 'completed') {
      const virtualGoodsProvideStatus = getVirtualGoodsProvideStatus(record);

      if (virtualGoodsProvideStatus === 'failed') {
        Message.error(
          record.virtualGoodsProvideError ||
            '微信发货同步失败，请检查配置后重试'
        );
        return;
      }

      if (
        virtualGoodsProvideStatus === 'provided' &&
        previousVirtualGoodsProvideStatus !== 'provided'
      ) {
        Message.success('微信发货状态已同步为已发货');
        return;
      }

      if (virtualGoodsProvideStatus === 'pending') {
        Message.warning('订单状态已刷新，微信发货仍待确认');
        return;
      }
    }

    Message.success(
      record.status === previousStatus
        ? '已从微信刷新订单状态'
        : `已从微信同步为${getStatusText(record.status)}`
    );
  };

  const getRefundConfirmContent = (record: OrderRecord) => {
    if (record.paymentProvider === 'admin_manual') {
      return record.orderType === 'voice_package'
        ? '确认退订该声音套餐订单？系统会撤回声音训练任务。'
        : '确认退订该会员订单？系统会收回会员权益。';
    }

    return record.orderType === 'voice_package'
      ? '确认退订该声音套餐订单？系统会发起微信退款并撤回声音训练任务。'
      : '确认退订该会员订单？系统会发起微信退款并收回会员权益。';
  };

  const getRefundSuccessText = (record: OrderRecord) => {
    if (record.paymentProvider === 'admin_manual') {
      return record.orderType === 'voice_package'
        ? '退订成功，声音训练任务已撤回'
        : '退订成功，会员权益已收回';
    }

    return record.orderType === 'voice_package'
      ? '退订退款已提交，声音训练任务已撤回'
      : '退订退款已提交，会员权益已收回';
  };

  const resolveOrderUserName = (record: OrderRecord) => {
    return record.user?.name || record.user?.account || '用户ID';
  };

  const resolveOrderUserContact = (record: OrderRecord) => {
    return record.user?.phone || record.user?.account || record.userId || '-';
  };

  const formatUserOption = (record: AppUserRecord) => {
    return [
      record.name || record.account || record.phone || record.id,
      record.phone && record.phone !== record.name ? record.phone : '',
      record.account &&
      record.account !== record.phone &&
      record.account !== record.name
        ? record.account
        : '',
    ]
      .filter(Boolean)
      .join(' / ');
  };

  const formatVipPlanOption = (record: VipPlanRecord) => {
    const duration = record.lifetime ? '永久' : `${record.durationDays ?? 0}天`;

    return `${record.name} / ${formatAmount(record.priceAmount)} / ${duration}`;
  };

  const formatVoicePackageOption = (record: VoicePackageRecord) => {
    return `${record.name} / ${formatAmount(record.priceAmount)}`;
  };

  const formatAgentOption = (record: AppUserAgentRecord) => {
    return record.name ? `${record.name} / ${record.id}` : record.id;
  };

  watch(
    () => [props.orderType, props.userId],
    () => {
      pagination.current = 1;
      closeDetail();
      fetchData();
    }
  );

  fetchData();
</script>

<script lang="ts">
  export default {
    name: 'OrderListPanel',
  };
</script>

<style lang="less" scoped>
  .order-page {
    min-height: 100%;
    padding: 16px 20px;
    background: var(--color-fill-2);

    &--embedded {
      padding: 0;
      background: transparent;
    }

    &__card {
      min-height: calc(100vh - 112px);
      border-radius: 4px;

      &--embedded {
        min-height: 0;
      }
    }

    &__search {
      margin-bottom: 16px;
    }

    &__filter {
      width: 140px;
    }

    &__full {
      width: 100%;
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

    &__agent-id {
      max-width: 180px;
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

    &__modal-footer {
      display: flex;
      justify-content: flex-end;
      margin-top: 24px;
    }
  }
</style>
