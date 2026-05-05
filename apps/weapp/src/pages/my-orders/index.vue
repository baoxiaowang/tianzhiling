<template>
  <page-scaffold
    class="my-orders-page"
    background="#efeff4"
    body-padding="0"
    :scroll="false"
    :safe-area-top="false"
    require-auth
    auth-loading-text="正在恢复订单信息..."
    login-placeholder-subtitle="登录后可查看你的订单记录"
  >
    <template #header>
      <app-bar title="我的订单" background="#f6f6f6" :show-capsule="true" />
    </template>

    <view v-if="isCheckingAuth || isLoading" class="my-orders-state">
      <view class="my-orders-state__dot" />
      <text class="my-orders-state__text">
        {{ isCheckingAuth ? '正在恢复会话...' : '正在加载订单...' }}
      </text>
    </view>

    <view v-else-if="loadError" class="my-orders-state">
      <text class="my-orders-state__title">订单加载失败</text>
      <text class="my-orders-state__text">{{ loadError }}</text>
      <view class="my-orders-state__button" @tap="handleRetry">重试</view>
    </view>

    <view v-else-if="!orders.length" class="my-orders-state">
      <text class="my-orders-state__title">暂无订单</text>
      <text class="my-orders-state__text">开通会员后，订单记录会展示在这里。</text>
      <view class="my-orders-state__button" @tap="handleOpenVipCenter">去开通会员</view>
    </view>

    <scroll-view v-else scroll-y class="my-orders-scroll">
      <view class="my-orders-list">
        <view v-for="order in sortedOrders" :key="order.id" class="my-orders-card">
          <view class="my-orders-card__content">
            <view class="my-orders-card__status-block">
              <text class="my-orders-card__label my-orders-card__label--status">
                订单状态：
              </text>
              <view class="my-orders-card__summary">
                <text class="my-orders-card__status">{{ getStatusText(order.status) }}</text>
                <text class="my-orders-card__price">{{ formatPrice(order.payableAmount) }}</text>
              </view>
            </view>

            <view class="my-orders-card__detail-list">
              <view class="my-orders-card__row">
                <text class="my-orders-card__label">产品名称：</text>
                <text class="my-orders-card__value">{{ order.title || '-' }}</text>
              </view>
              <view class="my-orders-card__row">
                <text class="my-orders-card__label">到期时间：</text>
                <text class="my-orders-card__value">{{ getExpireText(order) }}</text>
              </view>
              <view class="my-orders-card__row">
                <text class="my-orders-card__label">下单时间：</text>
                <text class="my-orders-card__value">{{ formatDateTime(order.createdAt) }}</text>
              </view>
              <view class="my-orders-card__row">
                <text class="my-orders-card__label">订单编号：</text>
                <copyable-text
                  :text="order.orderNo"
                  content-class="my-orders-card__value my-orders-card__value--mono"
                  success-text="订单编号已复制"
                />
              </view>
            </view>
          </view>
        </view>
      </view>
    </scroll-view>
  </page-scaffold>
</template>

<script lang="ts">
export default {
  name: 'MyOrdersPage',
}
</script>

<script setup lang="ts">
import Taro, { useDidShow } from '@tarojs/taro'
import { computed, ref } from 'vue'
import { ApiException } from '../../api/api-exception'
import { listOrders, type OrderRecord, type OrderStatusDTO } from '../../apis/order'
import { clearAuthSession } from '../../auth/session'
import AppBar from '../../components/app-bar/app-bar.vue'
import CopyableText from '../../components/copyable-text/copyable-text.vue'
import PageScaffold from '../../components/page-scaffold/page-scaffold.vue'
import { ensureAuthenticatedSession, redirectToAuthPage } from '../../utils/auth-guard'

const orders = ref<OrderRecord[]>([])
const isCheckingAuth = ref(true)
const isLoading = ref(false)
const loadError = ref('')
const hasLoadedOrders = ref(false)

const sortedOrders = computed(() => {
  return [...orders.value].sort((first, second) => {
    return getTime(second.createdAt) - getTime(first.createdAt)
  })
})

useDidShow(() => {
  void preparePage()
})

async function preparePage() {
  if (!hasLoadedOrders.value) {
    isCheckingAuth.value = true
  }

  const authenticated = await ensureAuthenticatedSession()

  if (!authenticated) {
    await redirectToAuthPage()
    return
  }

  isCheckingAuth.value = false
  await loadOrders()
}

async function loadOrders() {
  isLoading.value = true
  loadError.value = ''

  try {
    const result = await listOrders()
    orders.value = result.items
    hasLoadedOrders.value = true
  } catch (error) {
    orders.value = []

    if (error instanceof ApiException && error.requiresReLogin) {
      await clearAuthSession()
      await redirectToAuthPage()
      return
    }

    loadError.value = error instanceof Error && error.message
      ? error.message
      : '订单列表加载失败，请稍后重试。'
  } finally {
    isLoading.value = false
  }
}

function handleRetry() {
  void preparePage()
}

async function handleOpenVipCenter() {
  await Taro.navigateTo({
    url: '/pages/vip-center/index',
  })
}

function getStatusText(status: OrderStatusDTO) {
  const statusMap: Record<OrderStatusDTO, string> = {
    pending: '支付中',
    paid: '已支付',
    granting: '发放中',
    completed: '已完成',
    closed: '已关闭',
    refunded: '已退款',
    grant_failed: '发放失败',
  }

  return statusMap[status] ?? '支付中'
}

function getExpireText(order: OrderRecord) {
  if (order.orderType !== 'vip_plan') {
    return '-'
  }

  return '无限期'
}

function formatPrice(amount: number) {
  const yuan = amount / 100

  if (Number.isInteger(yuan)) {
    return `￥${yuan}`
  }

  return `￥${yuan.toFixed(2)}`
}

function formatDateTime(value: string) {
  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return value || '-'
  }

  const year = date.getFullYear()
  const month = padDatePart(date.getMonth() + 1)
  const day = padDatePart(date.getDate())
  const hour = padDatePart(date.getHours())
  const minute = padDatePart(date.getMinutes())
  const second = padDatePart(date.getSeconds())

  return `${year}-${month}-${day} ${hour}:${minute}:${second}`
}

function padDatePart(value: number) {
  return String(value).padStart(2, '0')
}

function getTime(value: string) {
  const time = new Date(value).getTime()

  return Number.isNaN(time) ? 0 : time
}
</script>

<style lang="scss">
.my-orders-page {
  min-height: 100vh;
}

.my-orders-scroll {
  height: 100%;
  box-sizing: border-box;
  background: #efeff4;
}

.my-orders-list {
  min-height: 100%;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 24px;
  padding: 40px 17px calc(32px + env(safe-area-inset-bottom));
  background: #efeff4;
}

.my-orders-card {
  width: 341px;
  box-sizing: border-box;
  border-radius: 12px;
  background: #ffffff;
  overflow: hidden;
}

.my-orders-card__content {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 21px;
  width: 100%;
  padding: 20px 28px;
}

.my-orders-card__status-block {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 100%;
}

.my-orders-card__summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  gap: 12px;
}

.my-orders-card__status {
  flex-shrink: 0;
  color: #3d3d3d;
  font-size: 24px;
  line-height: 24px;
  font-weight: 600;
}

.my-orders-card__price {
  min-width: 0;
  color: #f7864d;
  font-size: 24px;
  line-height: 24px;
  font-weight: 600;
  letter-spacing: 0.32px;
  text-align: right;
}

.my-orders-card__detail-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100%;
}

.my-orders-card__row {
  display: flex;
  align-items: flex-start;
  width: 100%;
  min-height: 24px;
}

.my-orders-card__label {
  flex-shrink: 0;
  color: #3d3d3d;
  font-size: 16px;
  line-height: 24px;
  font-weight: 600;
}

.my-orders-card__label--status {
  width: 100%;
}

.my-orders-card__value {
  min-width: 0;
  flex: 1;
  color: #3d3d3d;
  font-size: 14px;
  line-height: 24px;
  font-weight: 400;
  word-break: break-all;
}

.my-orders-card__value--mono {
  font-family: Menlo, Monaco, Consolas, 'Courier New', monospace;
  font-size: 13px;
}

.my-orders-state {
  min-height: 100%;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 40px 32px;
  text-align: center;
  background: #efeff4;
}

.my-orders-state__dot {
  width: 14px;
  height: 14px;
  border-radius: 999px;
  background: $tzl-gradient-primary;
  box-shadow: $tzl-shadow-primary-sm;
}

.my-orders-state__title {
  color: #333333;
  font-size: 18px;
  line-height: 26px;
  font-weight: 600;
}

.my-orders-state__text {
  color: $tzl-color-text-muted;
  font-size: 14px;
  line-height: 22px;
}

.my-orders-state__button {
  margin-top: 8px;
  padding: 8px 18px;
  border-radius: 12px;
  color: #ffffff;
  font-size: 14px;
  line-height: 20px;
  font-weight: 600;
  background: $tzl-gradient-primary;
  box-shadow: $tzl-shadow-primary-sm;
}
</style>
