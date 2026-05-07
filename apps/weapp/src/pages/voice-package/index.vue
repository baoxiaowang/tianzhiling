<template>
  <page-scaffold
    class="voice-package-page"
    background="#ededed"
    body-padding="0"
    :scroll="true"
    :safe-area-top="false"
  >
    <template #header>
      <app-bar title="声音模型" background="#ffffff" border-color="#eeeeee" />
    </template>

    <view v-if="isCheckingAuth || isLoading" class="voice-package-state">
      <view class="voice-package-state__dot" />
      <text class="voice-package-state__text">
        {{ isCheckingAuth ? '正在恢复会话...' : '正在加载套餐...' }}
      </text>
    </view>

    <view v-else-if="loadError" class="voice-package-state">
      <text class="voice-package-state__title">声音模型加载失败</text>
      <text class="voice-package-state__text">{{ loadError }}</text>
      <view class="voice-package-state__button" @tap="handleRetry">重试</view>
    </view>

    <view v-else class="voice-package">
      <voice-package-sheet
        :packages="packages"
        :selected-package-id="selectedPackageId"
        :disabled="isPaying || hasActiveTask"
        @select="handlePackageSelect"
      />
    </view>
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
import VoicePackageSheet from '../../components/voice-package-sheet/voice-package-sheet.vue'
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
        : '声音模型加载失败，请稍后重试'
  } finally {
    isLoading.value = false
  }
}

function handleRetry() {
  void loadCenter()
}

async function handlePackageSelect(packageId: string) {
  if (isPaying.value) {
    return
  }

  if (hasActiveTask.value) {
    showToast('当前智能体已有声音训练任务')
    return
  }

  selectedPackageId.value = packageId
  await handlePay()
}

async function handlePay() {
  const voicePackage = selectedPackage.value

  if (!voicePackage || !agentId.value || isPaying.value) {
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
  padding-top: 16px;
}
</style>
