<template>
  <page-scaffold
    class="voice-package-success-page"
    background="#efeff4"
    bottom-background="#ffffff"
    body-padding="0"
    :scroll="true"
    :safe-area-top="false"
  >
    <template #header>
      <app-bar title="购买成功" background="#ffffff" border-color="#eeeeee" />
    </template>

    <view v-if="isCheckingAuth || isLoading" class="voice-package-success-state">
      <view class="voice-package-success-state__dot" />
      <text class="voice-package-success-state__text">
        {{ isCheckingAuth ? '正在恢复会话...' : '正在加载声音模型...' }}
      </text>
    </view>

    <view v-else-if="loadError" class="voice-package-success-state">
      <text class="voice-package-success-state__title">声音模型加载失败</text>
      <text class="voice-package-success-state__text">{{ loadError }}</text>
      <view class="voice-package-success-state__button" @tap="handleRetry">重试</view>
    </view>

    <view v-else class="voice-package-success">
      <view v-if="purchasedPackageName" class="voice-package-success-package">
        <text class="voice-package-success-package__label">已购买套餐</text>
        <text class="voice-package-success-package__name">{{ purchasedPackageName }}</text>
      </view>
      <view class="voice-package-success-service">
        <voice-customer-service-card />
      </view>
    </view>

    <nut-popup
      v-model:visible="voicePackagePopupVisible"
      class="voice-package-success-popup"
      position="bottom"
      round
      :close-on-click-overlay="!isPaying"
      :overlay-style="voicePackagePopupOverlayStyle"
    >
      <view class="voice-package-success-popup__content">
        <voice-package-sheet
          :packages="voicePackages"
          :selected-package-id="selectedPackageId"
          :task="voicePackageTask"
          :disabled="isPaying"
          @select="handlePackageSelect"
        />
        <view class="voice-package-success-popup__payment">
          <nut-button
            block
            shape="round"
            type="primary"
            class="voice-package-success-popup__button"
            :disabled="paymentDisabled"
            :loading="isPaying"
            @click="handlePay"
          >
            {{ paymentText }}
          </nut-button>
        </view>
      </view>
    </nut-popup>

    <template #bottom>
      <view
        v-if="canShowBottomAction && !voicePackagePopupVisible"
        class="voice-package-success-actions"
      >
        <nut-button
          block
          shape="round"
          type="primary"
          class="voice-package-success-actions__button"
          :disabled="!voicePackages.length"
          @click="handleBuyOtherPackage"
        >
          购买其他套餐
        </nut-button>
      </view>
    </template>
  </page-scaffold>
</template>

<script lang="ts">
export default {
  name: 'VoicePackageSuccessPage',
}
</script>

<script setup lang="ts">
import Taro, { useDidShow, useLoad } from '@tarojs/taro'
import { computed, ref } from 'vue'
import { ApiException } from '../../api/api-exception'
import {
  createVoicePackageOrder,
  createVoicePackageVirtualPaymentOrder,
} from '../../apis/order'
import {
  getAgentVoicePackageCenter,
  type AgentVoicePackageCenter,
  type VoicePackageRecord,
} from '../../apis/voice-package'
import { clearAuthSession } from '../../auth/session'
import AppBar from '../../components/app-bar/app-bar.vue'
import PageScaffold from '../../components/page-scaffold/page-scaffold.vue'
import VoiceCustomerServiceCard from '../../components/voice-customer-service-card/voice-customer-service-card.vue'
import VoicePackageSheet from '../../components/voice-package-sheet/voice-package-sheet.vue'
import { ensureAuthenticatedSession, redirectToAuthPage } from '../../utils/auth-guard'
import {
  isWechatPaymentCancel,
  requestWechatVirtualPaymentWithFallback,
  showWechatVirtualPaymentError,
} from '../../utils/virtual-payment'

const agentId = ref('')
const voicePackageCenter = ref<AgentVoicePackageCenter | null>(null)
const selectedPackageId = ref('')
const isCheckingAuth = ref(true)
const isLoading = ref(false)
const isPaying = ref(false)
const loadError = ref('')
const voicePackagePopupVisible = ref(false)
const voicePackagePopupOverlayStyle = {
  backgroundColor: 'rgba(0, 0, 0, 0.45)',
}

const voicePackages = computed(() => voicePackageCenter.value?.packages ?? [])
const voicePackageTask = computed(() => voicePackageCenter.value?.task)
const selectedPackage = computed<VoicePackageRecord | undefined>(() => {
  return voicePackages.value.find((item) => item.id === selectedPackageId.value)
})
const selectedPackagePaid = computed(() => {
  const voicePackage = selectedPackage.value

  return Boolean(voicePackage && isVoicePackagePaid(voicePackage))
})
const purchasedPackageName = computed(() => {
  const taskName = voicePackageTask.value?.voicePackageName?.trim()

  if (taskName) {
    return taskName
  }

  const center = voicePackageCenter.value
  const packageName = center ? findVoiceTaskPackage(center)?.name.trim() : ''

  return packageName || ''
})
const paymentDisabled = computed(() => {
  return !selectedPackage.value || selectedPackagePaid.value || isPaying.value
})
const paymentText = computed(() => {
  if (!selectedPackage.value) {
    return '请选择套餐'
  }

  if (selectedPackagePaid.value) {
    return '已支付，等待人工处理'
  }

  return `支付 ${formatVoicePackagePrice(selectedPackage.value.priceAmount)} 为TA重塑声音`
})
const canShowBottomAction = computed(() => {
  return Boolean(
    !isCheckingAuth.value &&
      !isLoading.value &&
      !loadError.value &&
      voicePackageCenter.value,
  )
})

useLoad((options) => {
  agentId.value = decodeRouteParam(options?.agentId)
  void preparePage()
})

useDidShow(() => {
  if (!isCheckingAuth.value && agentId.value && !isPaying.value) {
    void loadVoicePackageCenter({ forceSelection: false })
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

  if (!agentId.value) {
    isCheckingAuth.value = false
    loadError.value = '缺少联系人信息，请返回通讯录重新进入。'
    return
  }

  const authenticated = await ensureAuthenticatedSession()

  if (!authenticated) {
    await redirectToAuthPage()
    return
  }

  isCheckingAuth.value = false
  await loadVoicePackageCenter({ forceSelection: true })
}

async function loadVoicePackageCenter(options: { forceSelection?: boolean } = {}) {
  if (!agentId.value || isLoading.value) {
    return
  }

  isLoading.value = true
  loadError.value = ''

  try {
    const center = await getAgentVoicePackageCenter(agentId.value)
    voicePackageCenter.value = center

    if (options.forceSelection || !selectedPackageId.value) {
      selectedPackageId.value =
        findFirstPurchasablePackage(center)?.id ||
        findVoiceTaskPackage(center)?.id ||
        center.packages[0]?.id ||
        ''
    }

    if (!findVoiceTaskPackage(center)) {
      loadError.value = '暂未找到已购买的声音模型，请返回后重新选择套餐。'
    }
  } catch (error) {
    if (error instanceof ApiException && error.requiresReLogin) {
      await clearAuthSession()
      await redirectToAuthPage()
      return
    }

    loadError.value =
      error instanceof ApiException ? error.message : '声音模型加载失败，请稍后重试'
  } finally {
    isLoading.value = false
  }
}

function handleRetry() {
  void loadVoicePackageCenter({ forceSelection: true })
}

function handleBuyOtherPackage() {
  const center = voicePackageCenter.value

  if (!center?.packages.length) {
    showToast('暂无可购买的声音套餐')
    return
  }

  selectedPackageId.value =
    findFirstPurchasablePackage(center)?.id ||
    selectedPackageId.value ||
    center.packages[0]?.id ||
    ''
  voicePackagePopupVisible.value = true
}

function handlePackageSelect(packageId: string) {
  if (isPaying.value) {
    return
  }

  const voicePackage = voicePackages.value.find((item) => item.id === packageId)

  if (!voicePackage || isVoicePackagePaid(voicePackage)) {
    return
  }

  selectedPackageId.value = packageId
}

async function handlePay() {
  const voicePackage = selectedPackage.value

  if (!voicePackage || !agentId.value || isPaying.value) {
    return
  }

  if (isVoicePackagePaid(voicePackage)) {
    showToast('该声音套餐已购买')
    return
  }

  try {
    isPaying.value = true
    const loginResult = await Taro.login()
    const code = loginResult.code?.trim()

    if (!code) {
      throw new Error('微信登录失败，请稍后重试')
    }

    let paidOrderId = ''

    if (voicePackage.virtualPaymentProductId) {
      const result = await createVoicePackageVirtualPaymentOrder({
        voicePackageId: voicePackage.id,
        agentId: agentId.value,
        jsCode: code,
      })
      const paidOrder = await requestWechatVirtualPaymentWithFallback(result, async () => {
        const fallbackLoginResult = await Taro.login()
        const fallbackCode = fallbackLoginResult.code?.trim()

        if (!fallbackCode) {
          throw new Error('微信登录失败，请稍后重试')
        }

        return createVoicePackageOrder({
          voicePackageId: voicePackage.id,
          agentId: agentId.value,
          jsCode: fallbackCode,
        })
      })
      paidOrderId = paidOrder.id
    } else {
      const result = await createVoicePackageOrder({
        voicePackageId: voicePackage.id,
        agentId: agentId.value,
        jsCode: code,
      })

      await Taro.requestPayment(result.payment)
      paidOrderId = result.order.id
    }
    voicePackagePopupVisible.value = false
    await Taro.redirectTo({
      url: `/pages/payment-result/index?orderId=${encodeURIComponent(paidOrderId)}`,
    })
  } catch (error) {
    if (isWechatPaymentCancel(error)) {
      showToast('支付已取消')
      return
    }

    if (await showWechatVirtualPaymentError(error)) {
      return
    }

    const message =
      error instanceof ApiException && error.code === 'VOICE_TRAINING_TASK_EXISTS'
        ? '已有声音训练任务处理中，请完成后再购买其他套餐'
        : error instanceof ApiException || error instanceof Error
          ? error.message
          : '支付失败，请稍后重试'

    showToast(message || '支付失败，请稍后重试')
  } finally {
    isPaying.value = false
  }
}

function findFirstPurchasablePackage(center: AgentVoicePackageCenter) {
  return center.packages.find((voicePackage) => !isVoicePackagePaid(voicePackage))
}

function findVoiceTaskPackage(center: AgentVoicePackageCenter) {
  const task = center.task

  if (!task || !isPaidVoiceTaskStatus(task.status)) {
    return undefined
  }

  return center.packages.find((voicePackage) => {
    return (
      voicePackage.id === task.voicePackageId ||
      voicePackage.code === task.voicePackageCode
    )
  })
}

function isVoicePackagePaid(voicePackage: VoicePackageRecord) {
  const task = voicePackageTask.value

  if (!task || !isPaidVoiceTaskStatus(task.status)) {
    return false
  }

  return task.voicePackageId === voicePackage.id || task.voicePackageCode === voicePackage.code
}

function isPaidVoiceTaskStatus(status: string) {
  return (
    status === 'paid' ||
    status === 'awaiting_material' ||
    status === 'processing' ||
    status === 'training' ||
    status === 'completed'
  )
}

function formatVoicePackagePrice(amount: number) {
  const yuan = amount / 100

  return Number.isInteger(yuan) ? `￥${yuan}` : `￥${yuan.toFixed(2)}`
}
</script>

<style lang="scss">
.voice-package-success-page {
  min-height: 100vh;
}

.voice-package-success-state {
  min-height: calc(100vh - 148px);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 32px;
  text-align: center;
}

.voice-package-success-state__dot {
  width: 22px;
  height: 22px;
  border: 3px solid rgba(236, 184, 114, 0.25);
  border-top-color: #ecb872;
  border-radius: 50%;
  animation: voice-package-success-spin 0.8s linear infinite;
}

.voice-package-success-state__title {
  color: #333333;
  font-size: 18px;
  line-height: 26px;
  font-weight: 600;
}

.voice-package-success-state__text {
  color: #777777;
  font-size: 14px;
  line-height: 22px;
}

.voice-package-success-state__button {
  min-width: 96px;
  margin-top: 8px;
  padding: 9px 18px;
  border-radius: 999px;
  background: #ecb872;
  color: #602a0c;
  font-size: 14px;
  line-height: 20px;
  font-weight: 600;
}

.voice-package-success {
  min-height: calc(100vh - 176px);
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  padding: 40px 0 20px;
  background: #efeff4;
}

.voice-package-success-service {
  flex: 1;
  min-height: 0;
  width: 100%;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 10px 0 20px;
}

.voice-package-success-package {
  box-sizing: border-box;
  width: 327px;
  max-width: calc(100% - 48px);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin: 0 auto;
  padding: 12px 16px;
  border-radius: 8px;
  background: #ffffff;
}

.voice-package-success-package__label {
  flex: 0 0 auto;
  color: #777777;
  font-size: 14px;
  line-height: 20px;
}

.voice-package-success-package__name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: #3d3d3d;
  font-size: 16px;
  line-height: 22px;
  font-weight: 600;
  text-align: right;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.voice-package-success-actions {
  box-sizing: border-box;
  padding: 10px 33px;
  background: #ffffff;
}

.voice-package-success-actions__button,
.voice-package-success-popup__button {
  height: 56px;
  border: 0;
  background: linear-gradient(90deg, #fce8cc 0%, #ecb872 94.52%);
}

.voice-package-success-actions__button .nut-button__text,
.voice-package-success-popup__button .nut-button__text {
  color: #602a0c;
  font-size: 16px;
  font-weight: 600;
}

.voice-package-success-popup {
  overflow: hidden;
  background: transparent;
}

.voice-package-success-popup__content {
  overflow: hidden;
  border-radius: 16px 16px 0 0;
  background: #ffffff;
}

.voice-package-success-popup__payment {
  box-sizing: border-box;
  margin-top: -1px;
  padding: 0 33px calc(10px + env(safe-area-inset-bottom));
  background: #ffffff;
}

@keyframes voice-package-success-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
