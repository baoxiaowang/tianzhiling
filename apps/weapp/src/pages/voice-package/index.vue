<template>
  <page-scaffold
    class="voice-package-page"
    background="#f7f8fa"
    bottom-background="#ffffff"
    body-padding="0"
    :scroll="true"
    :safe-area-top="false"
  >
    <template #header>
      <app-bar title="声音套餐" background="#ffffff" border-color="#eeeeee" />
    </template>

    <view v-if="isCheckingAuth || isLoading" class="voice-package-state">
      <view class="voice-package-state__dot" />
      <text class="voice-package-state__text">
        {{ isCheckingAuth ? '正在恢复会话...' : '正在加载套餐...' }}
      </text>
    </view>

    <view v-else-if="loadError" class="voice-package-state">
      <text class="voice-package-state__title">声音套餐加载失败</text>
      <text class="voice-package-state__text">{{ loadError }}</text>
      <view class="voice-package-state__button" @tap="handleRetry">重试</view>
    </view>

    <view v-else class="voice-package">
      <view v-if="currentTask" class="voice-package-task">
        <text class="voice-package-task__title">当前声音训练</text>
        <text class="voice-package-task__status">
          {{ formatTaskStatus(currentTask.status) }}
        </text>
        <text class="voice-package-task__desc">
          {{ taskDescription }}
        </text>
      </view>

      <view v-if="packages.length" class="voice-package-list">
        <view
          v-for="item in packages"
          :key="item.id"
          class="voice-package-card"
          :class="{ 'voice-package-card--selected': selectedPackageId === item.id }"
          @tap="selectPackage(item.id)"
        >
          <view class="voice-package-card__header">
            <text class="voice-package-card__name">{{ item.name }}</text>
            <text v-if="item.estimatedServiceDays" class="voice-package-card__days">
              {{ item.estimatedServiceDays }}天交付
            </text>
          </view>
          <text v-if="item.description" class="voice-package-card__desc">
            {{ item.description }}
          </text>
          <view class="voice-package-card__price-row">
            <text class="voice-package-card__price">
              {{ formatPrice(item.priceAmount) }}
            </text>
            <text v-if="item.originalPriceAmount" class="voice-package-card__original">
              {{ formatPrice(item.originalPriceAmount) }}
            </text>
          </view>
          <view v-if="item.deliverables.length" class="voice-package-card__tags">
            <text
              v-for="deliverable in item.deliverables"
              :key="deliverable.title"
              class="voice-package-card__tag"
            >
              {{ deliverable.title }}
            </text>
          </view>
          <text v-if="item.materialRequirement" class="voice-package-card__material">
            {{ item.materialRequirement }}
          </text>
        </view>
      </view>

      <view v-else class="voice-package-empty">暂无可购买的声音套餐</view>
    </view>

    <template #bottom>
      <view v-if="showPaymentBar" class="voice-package-payment">
        <nut-button
          block
          shape="round"
          type="primary"
          class="voice-package-payment__button"
          :disabled="!selectedPackage || isPaying || hasActiveTask"
          :loading="isPaying"
          @click="handlePay"
        >
          {{ paymentButtonText }}
        </nut-button>
      </view>
    </template>
  </page-scaffold>
</template>

<script lang="ts">
export default {
  name: 'VoicePackagePage',
}
</script>

<script setup lang="ts">
import Taro, { useDidShow, useLoad } from '@tarojs/taro'
import { computed, ref } from 'vue'
import { ApiException } from '../../api/api-exception'
import { createVoicePackageOrder } from '../../apis/order'
import {
  getAgentVoicePackageCenter,
  type VoicePackageRecord,
  type VoiceTrainingTaskRecord,
} from '../../apis/voice-package'
import { clearAuthSession } from '../../auth/session'
import AppBar from '../../components/app-bar/app-bar.vue'
import PageScaffold from '../../components/page-scaffold/page-scaffold.vue'
import { ensureAuthenticatedSession, redirectToAuthPage } from '../../utils/auth-guard'

const agentId = ref('')
const packages = ref<VoicePackageRecord[]>([])
const currentTask = ref<VoiceTrainingTaskRecord>()
const selectedPackageId = ref('')
const isCheckingAuth = ref(true)
const isLoading = ref(false)
const isPaying = ref(false)
const loadError = ref('')

const selectedPackage = computed(() => {
  return packages.value.find((item) => item.id === selectedPackageId.value)
})
const hasActiveTask = computed(() => {
  const status = currentTask.value?.status
  return Boolean(
    status &&
      status !== 'completed' &&
      status !== 'failed' &&
      status !== 'refunded',
  )
})
const showPaymentBar = computed(() => {
  return Boolean(!isCheckingAuth.value && !loadError.value && packages.value.length)
})
const paymentButtonText = computed(() => {
  if (hasActiveTask.value) {
    return '已有训练任务'
  }

  if (!selectedPackage.value) {
    return '请选择套餐'
  }

  return `支付 ${formatPrice(selectedPackage.value.priceAmount)}`
})
const taskDescription = computed(() => {
  const task = currentTask.value

  if (!task) {
    return ''
  }

  if (task.status === 'completed') {
    return '声音训练已完成，音色已经绑定到当前智能体。'
  }

  if (task.status === 'failed') {
    return '训练暂未完成，人工会根据情况继续跟进。'
  }

  return '人工会介入处理声音素材、训练音色，并最终绑定到当前智能体。'
})

useLoad((options) => {
  agentId.value = decodeRouteParam(options?.agentId)
  void preparePage()
})

useDidShow(() => {
  if (agentId.value && !isCheckingAuth.value) {
    void loadCenter()
  }
})

function decodeRouteParam(value?: string) {
  if (typeof value !== 'string') {
    return ''
  }

  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function showToast(title: string) {
  void Taro.showToast({
    title,
    icon: 'none',
    duration: 1800,
  })
}

async function preparePage() {
  isCheckingAuth.value = true
  const authenticated = await ensureAuthenticatedSession()

  if (!authenticated) {
    await redirectToAuthPage()
    return
  }

  isCheckingAuth.value = false
  await loadCenter()
}

async function loadCenter() {
  if (!agentId.value) {
    loadError.value = '缺少智能体信息，请返回后重新进入'
    return
  }

  isLoading.value = true
  loadError.value = ''

  try {
    const center = await getAgentVoicePackageCenter(agentId.value)
    packages.value = center.packages
    currentTask.value = center.task
    selectedPackageId.value =
      selectedPackageId.value || center.packages[0]?.id || ''
  } catch (error) {
    if (error instanceof ApiException && error.requiresReLogin) {
      await clearAuthSession()
      await redirectToAuthPage()
      return
    }

    loadError.value =
      error instanceof ApiException
        ? error.message
        : '声音套餐加载失败，请稍后重试'
  } finally {
    isLoading.value = false
  }
}

function handleRetry() {
  void loadCenter()
}

function selectPackage(packageId: string) {
  if (hasActiveTask.value) {
    showToast('当前智能体已有训练任务')
    return
  }

  selectedPackageId.value = packageId
}

async function handlePay() {
  const voicePackage = selectedPackage.value

  if (!voicePackage || !agentId.value || isPaying.value || hasActiveTask.value) {
    return
  }

  try {
    isPaying.value = true
    const loginResult = await Taro.login()
    const code = loginResult.code?.trim()

    if (!code) {
      throw new Error('微信登录失败，请稍后重试')
    }

    const result = await createVoicePackageOrder({
      voicePackageId: voicePackage.id,
      agentId: agentId.value,
      jsCode: code,
    })

    await Taro.requestPayment(result.payment)
    await Taro.redirectTo({
      url: `/pages/payment-result/index?orderId=${encodeURIComponent(
        result.order.id,
      )}`,
    })
  } catch (error) {
    const message =
      error instanceof ApiException || error instanceof Error
        ? error.message
        : '支付失败，请稍后重试'

    showToast(message || '支付失败，请稍后重试')
  } finally {
    isPaying.value = false
  }
}

function formatTaskStatus(status: string) {
  switch (status) {
    case 'paid':
      return '已支付'
    case 'awaiting_material':
      return '待补充素材'
    case 'processing':
      return '处理中'
    case 'training':
      return '训练中'
    case 'completed':
      return '已完成'
    case 'failed':
      return '失败'
    case 'refunded':
      return '已退款'
    default:
      return ''
  }
}

function formatPrice(amount: number) {
  return `¥${(amount / 100).toFixed(2)}`
}
</script>

<style lang="scss">
.voice-package-page {
  min-height: 100vh;
}

.voice-package-state {
  min-height: calc(100vh - 96px);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 32px;
  text-align: center;
}

.voice-package-state__dot {
  width: 14px;
  height: 14px;
  border-radius: 999px;
  background: #39cd80;
}

.voice-package-state__title {
  color: #111111;
  font-size: 16px;
  line-height: 24px;
  font-weight: 600;
}

.voice-package-state__text {
  color: #8a8f98;
  font-size: 14px;
  line-height: 20px;
}

.voice-package-state__button {
  margin-top: 8px;
  color: #16a34a;
  font-size: 14px;
  line-height: 22px;
}

.voice-package {
  box-sizing: border-box;
  min-height: 100%;
  padding: 16px 16px 112px;
}

.voice-package-task,
.voice-package-card {
  box-sizing: border-box;
  border-radius: 12px;
  background: #ffffff;
}

.voice-package-task {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 16px;
  margin-bottom: 12px;
}

.voice-package-task__title,
.voice-package-card__name {
  color: #111111;
  font-size: 17px;
  line-height: 24px;
  font-weight: 600;
}

.voice-package-task__status {
  width: fit-content;
  padding: 3px 9px;
  border-radius: 999px;
  color: #0f8f4b;
  background: #e8f8ef;
  font-size: 12px;
  line-height: 18px;
}

.voice-package-task__desc,
.voice-package-card__desc,
.voice-package-card__material {
  color: #6b7280;
  font-size: 13px;
  line-height: 20px;
}

.voice-package-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.voice-package-card {
  padding: 16px;
  border: 1px solid transparent;
}

.voice-package-card--selected {
  border-color: #39cd80;
  box-shadow: 0 8px 24px rgba(57, 205, 128, 0.16);
}

.voice-package-card__header,
.voice-package-card__price-row,
.voice-package-card__tags {
  display: flex;
  align-items: center;
}

.voice-package-card__header {
  justify-content: space-between;
  gap: 12px;
}

.voice-package-card__days {
  color: #16a34a;
  font-size: 12px;
  line-height: 18px;
}

.voice-package-card__price-row {
  gap: 8px;
  margin-top: 10px;
}

.voice-package-card__price {
  color: #111111;
  font-size: 24px;
  line-height: 32px;
  font-weight: 700;
}

.voice-package-card__original {
  color: #9ca3af;
  font-size: 13px;
  line-height: 20px;
  text-decoration: line-through;
}

.voice-package-card__tags {
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 10px;
}

.voice-package-card__tag {
  padding: 3px 8px;
  border-radius: 999px;
  color: #3f3f46;
  background: #f2f3f5;
  font-size: 12px;
  line-height: 18px;
}

.voice-package-card__material {
  display: block;
  margin-top: 10px;
}

.voice-package-empty {
  padding: 40px 0;
  color: #8a8f98;
  font-size: 14px;
  line-height: 22px;
  text-align: center;
}

.voice-package-payment {
  box-sizing: border-box;
  padding: 10px 16px calc(10px + env(safe-area-inset-bottom));
}

.voice-package-payment__button .nut-button__text {
  font-size: 16px;
  font-weight: 600;
}
</style>
