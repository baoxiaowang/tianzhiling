<template>
  <page-scaffold
    class="payment-result-page"
    background="#f7f8fa"
    bottom-background="#ffffff"
    body-padding="0"
    :scroll="false"
    :safe-area-top="false"
  >
    <template #header>
      <app-bar title="支付结果" background="#ffffff" border-color="#eeeeee" />
    </template>

    <view class="payment-result">
      <view class="payment-result-card">
        <view class="payment-result-icon" :class="iconClass">
          <Check v-if="resultType === 'success'" size="42" color="#ffffff" />
          <Clock v-else-if="resultType === 'processing'" size="42" color="#ffffff" />
          <Close v-else size="42" color="#ffffff" />
        </view>
        <text class="payment-result-title">{{ resultTitle }}</text>
        <text class="payment-result-desc">{{ resultDescription }}</text>

        <view v-if="order" class="payment-result-order">
          <view class="payment-result-order__row">
            <text class="payment-result-order__label">订单名称</text>
            <text class="payment-result-order__value">{{ order.title || '-' }}</text>
          </view>
          <view class="payment-result-order__row">
            <text class="payment-result-order__label">订单金额</text>
            <text class="payment-result-order__value">{{ formatPrice(order.payableAmount) }}</text>
          </view>
          <view class="payment-result-order__row">
            <text class="payment-result-order__label">订单状态</text>
            <text class="payment-result-order__value">{{ statusText }}</text>
          </view>
        </view>

        <view v-if="resultType === 'processing'" class="payment-result-progress">
          <view class="payment-result-progress__dot" />
          <text>正在同步微信支付结果</text>
        </view>
      </view>
    </view>

    <template #bottom>
      <view class="payment-result-actions">
        <nut-button
          v-if="canRetry"
          block
          shape="round"
          type="primary"
          class="payment-result-actions__button"
          :loading="isPolling"
          @click="handleRetry"
        >
          重新查询
        </nut-button>
        <nut-button
          v-else
          block
          shape="round"
          type="primary"
          class="payment-result-actions__button"
          @click="handleBackToOrderSource"
        >
          {{ actionText }}
        </nut-button>
      </view>
    </template>
  </page-scaffold>
</template>

<script lang="ts">
export default {
  name: 'PaymentResultPage',
}
</script>

<script setup lang="ts">
import Taro, { useDidHide, useDidShow, useLoad, useUnload } from '@tarojs/taro'
import { Check, Clock, Close } from '@nutui/icons-vue-taro'
import { computed, ref } from 'vue'
import { ApiException } from '../../api/api-exception'
import {
  syncOrderPayment,
  type OrderRecord,
  type OrderStatusDTO,
} from '../../apis/order'
import { clearAuthSession } from '../../auth/session'
import AppBar from '../../components/app-bar/app-bar.vue'
import PageScaffold from '../../components/page-scaffold/page-scaffold.vue'
import { ensureAuthenticatedSession, redirectToAuthPage } from '../../utils/auth-guard'

type ResultType = 'processing' | 'success' | 'failed'

const pollIntervalMs = 1500
const maxPollAttempts = 20

const orderId = ref('')
const order = ref<OrderRecord | null>(null)
const isPolling = ref(false)
const isReadyToPoll = ref(false)
const pollAttempts = ref(0)
const resultType = ref<ResultType>('processing')
const queryError = ref('')

let pollTimer: ReturnType<typeof setTimeout> | null = null
let isPageAlive = true

const iconClass = computed(() => {
  return {
    'payment-result-icon--success': resultType.value === 'success',
    'payment-result-icon--processing': resultType.value === 'processing',
    'payment-result-icon--failed': resultType.value === 'failed',
  }
})
const statusText = computed(() => {
  return getStatusText(order.value?.status)
})
const isVoicePackageOrder = computed(() => {
  return order.value?.orderType === 'voice_package'
})
const actionText = computed(() => {
  if (isVoicePackageOrder.value) {
    return resultType.value === 'success' ? '查看声音任务' : '返回智能体详情'
  }

  return resultType.value === 'success' ? '查看会员权益' : '返回会员中心'
})
const resultTitle = computed(() => {
  if (resultType.value === 'success') {
    return isVoicePackageOrder.value ? '声音套餐已购买' : '会员已开通'
  }

  if (resultType.value === 'failed') {
    return queryError.value ? '结果查询失败' : '支付结果异常'
  }

  return order.value?.status === 'granting' || order.value?.status === 'paid'
    ? isVoicePackageOrder.value
      ? '任务创建中'
      : '权益同步中'
    : '正在确认支付结果'
})
const resultDescription = computed(() => {
  if (resultType.value === 'success') {
    return isVoicePackageOrder.value
      ? '训练任务已经创建，人工会继续跟进声音训练。'
      : '会员权益已经生效，可以返回会员中心查看。'
  }

  if (resultType.value === 'failed') {
    return queryError.value || getFailedDescription(order.value?.status)
  }

  if (pollAttempts.value >= maxPollAttempts) {
    return '微信支付结果同步较慢，请稍后重新查询。'
  }

  return isVoicePackageOrder.value
    ? '支付完成后需要等待微信回调和任务创建，请不要重复支付。'
    : '支付完成后需要等待微信回调和权益发放，请不要重复支付。'
})
const canRetry = computed(() => {
  return (
    Boolean(orderId.value) &&
    !isPolling.value &&
    resultType.value !== 'success' &&
    (Boolean(queryError.value) || pollAttempts.value >= maxPollAttempts)
  )
})

useLoad((options) => {
  void preparePage(options)
})

useDidHide(() => {
  clearPollTimer()
})

useDidShow(() => {
  isPageAlive = true

  if (
    isReadyToPoll.value &&
    orderId.value &&
    resultType.value === 'processing' &&
    !isPolling.value &&
    !pollTimer
  ) {
    scheduleNextPoll(0)
  }
})

useUnload(() => {
  isPageAlive = false
  clearPollTimer()
})

async function preparePage(options?: Record<string, unknown>) {
  isPageAlive = true
  clearPollTimer()
  isReadyToPoll.value = false
  orderId.value = String(options?.orderId ?? '').trim()

  if (!orderId.value) {
    resultType.value = 'failed'
    queryError.value = '订单信息缺失，请返回后重新发起支付。'
    return
  }

  const authenticated = await ensureAuthenticatedSession()

  if (!authenticated) {
    await redirectToAuthPage()
    return
  }

  isReadyToPoll.value = true
  startPolling()
}

function startPolling() {
  clearPollTimer()
  pollAttempts.value = 0
  queryError.value = ''
  resultType.value = 'processing'
  void pollOrderStatus()
}

async function pollOrderStatus() {
  if (!orderId.value || !isPageAlive) {
    return
  }

  pollAttempts.value += 1
  isPolling.value = true

  try {
    const latestOrder = await syncOrderPayment(orderId.value)

    if (!isPageAlive) {
      return
    }

    order.value = latestOrder
    queryError.value = ''

    if (latestOrder.status === 'completed') {
      resultType.value = 'success'
      return
    }

    if (isFailedStatus(latestOrder.status)) {
      resultType.value = 'failed'
      return
    }

    if (pollAttempts.value >= maxPollAttempts) {
      resultType.value = 'processing'
      return
    }

    scheduleNextPoll(pollIntervalMs)
  } catch (error) {
    if (!isPageAlive) {
      return
    }

    if (error instanceof ApiException && error.requiresReLogin) {
      resultType.value = 'failed'
      queryError.value = error.message
      await clearAuthSession()
      await redirectToAuthPage()
      return
    }

    if (error instanceof ApiException && !isRetryableOrderQueryError(error)) {
      resultType.value = 'failed'
      queryError.value = error.message
      return
    }

    if (pollAttempts.value >= maxPollAttempts) {
      resultType.value = 'failed'
      queryError.value =
        error instanceof Error && error.message ? error.message : '订单结果查询失败，请稍后重试。'
      return
    }

    scheduleNextPoll(pollIntervalMs)
  } finally {
    if (isPageAlive) {
      isPolling.value = false
    }
  }
}

function scheduleNextPoll(delayMs: number) {
  clearPollTimer()
  pollTimer = setTimeout(() => {
    void pollOrderStatus()
  }, delayMs)
}

function clearPollTimer() {
  if (pollTimer) {
    clearTimeout(pollTimer)
    pollTimer = null
  }
}

function isFailedStatus(status?: OrderStatusDTO) {
  return status === 'closed' || status === 'refunded' || status === 'grant_failed'
}

function isRetryableOrderQueryError(error: ApiException) {
  return !['INVALID_ORDER_ID', 'ORDER_NOT_FOUND'].includes(error.code ?? '')
}

function getStatusText(status?: OrderStatusDTO) {
  switch (status) {
    case 'completed':
      return '已完成'
    case 'granting':
      return order.value?.orderType === 'voice_package'
        ? '任务创建中'
        : '权益发放中'
    case 'paid':
      return '已支付'
    case 'closed':
      return '已关闭'
    case 'refunded':
      return '已退款'
    case 'grant_failed':
      return '权益发放失败'
    case 'pending':
    default:
      return '待确认'
  }
}

function getFailedDescription(status?: OrderStatusDTO) {
  if (status === 'grant_failed') {
    return order.value?.orderType === 'voice_package'
      ? '支付成功但训练任务创建失败，请联系客服处理。'
      : '支付成功但权益发放失败，请联系客服处理。'
  }

  if (status === 'closed') {
    return order.value?.orderType === 'voice_package'
      ? '订单已关闭，请返回智能体详情重新发起支付。'
      : '订单已关闭，请返回会员中心重新发起支付。'
  }

  if (status === 'refunded') {
    return order.value?.orderType === 'voice_package'
      ? '订单已退款，如需声音训练请重新购买。'
      : '订单已退款，如需开通会员请重新购买。'
  }

  return '订单状态暂时异常，请稍后重试或联系客服处理。'
}

function formatPrice(amount: number) {
  return `¥${(amount / 100).toFixed(2)}`
}

function handleRetry() {
  startPolling()
}

async function handleBackToOrderSource() {
  if (order.value?.orderType === 'voice_package' && order.value.agentId) {
    await Taro.redirectTo({
      url: `/pages/agent-detail/index?agentId=${encodeURIComponent(
        order.value.agentId
      )}`,
    })
    return
  }

  await Taro.redirectTo({
    url: '/pages/vip-center/index',
  })
}
</script>

<style lang="scss">
.payment-result-page {
  min-height: 100vh;
}

.payment-result {
  box-sizing: border-box;
  min-height: 100%;
  padding: 24px 16px 120px;
}

.payment-result-card {
  display: flex;
  box-sizing: border-box;
  flex-direction: column;
  align-items: center;
  padding: 36px 20px 24px;
  border-radius: 8px;
  background: #ffffff;
}

.payment-result-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 72px;
  height: 72px;
  border-radius: 50%;
}

.payment-result-icon--success {
  background: #22c55e;
}

.payment-result-icon--processing {
  background: #3b82f6;
}

.payment-result-icon--failed {
  background: #ef4444;
}

.payment-result-title {
  margin-top: 20px;
  color: #111827;
  font-size: 22px;
  font-weight: 700;
  line-height: 30px;
}

.payment-result-desc {
  margin-top: 10px;
  color: #6b7280;
  font-size: 14px;
  line-height: 22px;
  text-align: center;
}

.payment-result-order {
  box-sizing: border-box;
  width: 100%;
  margin-top: 28px;
  padding: 6px 0;
  border-top: 1px solid #f1f5f9;
}

.payment-result-order__row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 0;
  border-bottom: 1px solid #f1f5f9;
}

.payment-result-order__label {
  flex: 0 0 auto;
  color: #6b7280;
  font-size: 14px;
  line-height: 20px;
}

.payment-result-order__value {
  min-width: 0;
  color: #111827;
  font-size: 14px;
  font-weight: 600;
  line-height: 20px;
  text-align: right;
  word-break: break-all;
}

.payment-result-progress {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 20px;
  color: #6b7280;
  font-size: 13px;
  line-height: 18px;
}

.payment-result-progress__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #3b82f6;
  animation: payment-result-pulse 1.2s ease-in-out infinite;
}

.payment-result-actions {
  box-sizing: border-box;
  padding: 12px 16px 18px;
  background: #ffffff;
}

.payment-result-actions__button {
  height: 48px;
  border: none;
  background: #22c55e;
  color: #ffffff;
  font-size: 16px;
  font-weight: 700;
}

.payment-result-actions__button .nut-button__text {
  color: #ffffff;
}

@keyframes payment-result-pulse {
  0%,
  100% {
    opacity: 0.35;
    transform: scale(0.8);
  }

  50% {
    opacity: 1;
    transform: scale(1);
  }
}
</style>
