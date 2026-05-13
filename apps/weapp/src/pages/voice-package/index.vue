<template>
  <page-scaffold
    class="voice-package-page"
    background="#ededed"
    bottom-background="#ffffff"
    body-padding="0"
    :scroll="true"
    :safe-area-top="false"
  >
    <template #header>
      <app-bar title="声音模型" background="#ffffff" border-color="#eeeeee" />
    </template>

    <view v-if="isCheckingAuth || isLoadingAgents" class="voice-package-state">
      <view class="voice-package-state__dot" />
      <text class="voice-package-state__text">
        {{ isCheckingAuth ? '正在恢复会话...' : '正在加载智能体...' }}
      </text>
    </view>

    <view v-else-if="agentsLoadError" class="voice-package-state">
      <text class="voice-package-state__title">声音模型加载失败</text>
      <text class="voice-package-state__text">{{ agentsLoadError }}</text>
      <view class="voice-package-state__button" @tap="handleRetryAgents">重试</view>
    </view>

    <view v-else-if="!agents.length" class="voice-package-state">
      <text class="voice-package-state__title">暂无可开通的智能体</text>
      <text class="voice-package-state__text">创建智能体后，可为 TA 重塑声音</text>
      <view class="voice-package-state__button" @tap="handleCreateAgent">创建智能体</view>
    </view>

    <view v-else class="voice-package-content">
      <view class="voice-package-hero">
        <swiper
          class="voice-package-hero__swiper"
          :current="selectedAgentIndex"
          :circular="agents.length > 1"
          @change="handleAgentSwiperChange"
        >
          <swiper-item v-for="agent in agents" :key="agent.id">
            <view class="voice-package-agent-card">
              <image
                v-if="agent.avatar"
                class="voice-package-agent-card__avatar"
                :src="agent.avatar"
                mode="aspectFill"
              />
              <view
                v-else
                class="voice-package-agent-card__avatar voice-package-agent-card__avatar--fallback"
              >
                {{ buildAgentFallback(agent.name) }}
              </view>
              <view class="voice-package-agent-card__info">
                <text class="voice-package-agent-card__name">
                  {{ agent.name || '未命名智能体' }}
                </text>
                <text class="voice-package-agent-card__desc">
                  {{ buildAgentDescription(agent) }}
                </text>
              </view>
              <view class="voice-package-agent-card__voice-icon">
                <view class="voice-package-agent-card__voice-bar voice-package-agent-card__voice-bar--1" />
                <view class="voice-package-agent-card__voice-bar voice-package-agent-card__voice-bar--2" />
                <view class="voice-package-agent-card__voice-bar voice-package-agent-card__voice-bar--3" />
                <view class="voice-package-agent-card__voice-bar voice-package-agent-card__voice-bar--4" />
              </view>
            </view>
          </swiper-item>
        </swiper>

        <text class="voice-package-hero__hint">←→ 左右滑动切换智能体</text>
      </view>

      <view v-if="isLoadingCenter" class="voice-package-panel-state">
        <view class="voice-package-state__dot" />
        <text class="voice-package-state__text">正在加载套餐...</text>
      </view>

      <view v-else-if="currentCenterError" class="voice-package-panel-state">
        <text class="voice-package-state__title">套餐加载失败</text>
        <text class="voice-package-state__text">{{ currentCenterError }}</text>
        <view class="voice-package-state__button" @tap="handleRetryCenter">重试</view>
      </view>

      <voice-package-payment-panel
        v-else
        :packages="currentPackages"
        :selected-package-id="selectedPackageId"
        :task="currentCenter?.task"
        :disabled="isPaying"
        :paying="isPaying"
        :show-payment="false"
        @select="handlePackageSelect"
        @pay="handlePay"
        @open-agreement="handleOpenAgreement"
      />
    </view>

    <template #bottom>
      <voice-package-payment-panel
        v-if="shouldShowPaymentBar"
        payment-only
        compact
        :packages="currentPackages"
        :selected-package-id="selectedPackageId"
        :task="currentCenter?.task"
        :disabled="isPaying"
        :paying="isPaying"
        @select="handlePackageSelect"
        @pay="handlePay"
        @open-agreement="handleOpenAgreement"
      />
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
import { getAgents, type AgentSummary } from '../../apis/agent'
import { createVoicePackageOrder } from '../../apis/order'
import {
  getAgentVoicePackageCenter,
  type AgentVoicePackageCenter,
  type VoicePackageRecord,
} from '../../apis/voice-package'
import { clearAuthSession } from '../../auth/session'
import type { AgreementDocumentType } from '../../legal/agreement-documents'
import AppBar from '../../components/app-bar/app-bar.vue'
import PageScaffold from '../../components/page-scaffold/page-scaffold.vue'
import VoicePackagePaymentPanel from '../../components/voice-package-payment-panel/voice-package-payment-panel.vue'
import { openAgreementDocument } from '../../utils/agreement-nav'
import { ensureAuthenticatedSession, redirectToAuthPage } from '../../utils/auth-guard'

const initialAgentId = ref('')
const agents = ref<AgentSummary[]>([])
const selectedAgentId = ref('')
const selectedPackageIdByAgentId = ref<Record<string, string>>({})
const centerByAgentId = ref<Record<string, AgentVoicePackageCenter | undefined>>({})
const centerLoadErrorByAgentId = ref<Record<string, string | undefined>>({})
const isCheckingAuth = ref(true)
const isLoadingAgents = ref(false)
const isLoadingCenter = ref(false)
const isPaying = ref(false)
const agentsLoadError = ref('')

const selectedAgent = computed(() => {
  return agents.value.find((agent) => agent.id === selectedAgentId.value) ?? null
})
const selectedAgentIndex = computed(() => {
  const index = agents.value.findIndex((agent) => agent.id === selectedAgentId.value)

  return index >= 0 ? index : 0
})
const currentCenter = computed(() => {
  return selectedAgentId.value ? centerByAgentId.value[selectedAgentId.value] : undefined
})
const currentCenterError = computed(() => {
  return selectedAgentId.value
    ? centerLoadErrorByAgentId.value[selectedAgentId.value] ?? ''
    : ''
})
const currentPackages = computed(() => currentCenter.value?.packages ?? [])
const selectedPackageId = computed(() => {
  if (!selectedAgentId.value) {
    return ''
  }

  return (
    selectedPackageIdByAgentId.value[selectedAgentId.value] ||
    currentPackages.value[0]?.id ||
    ''
  )
})
const selectedPackage = computed<VoicePackageRecord | undefined>(() => {
  return currentPackages.value.find((item) => item.id === selectedPackageId.value)
})
const selectedPackagePaid = computed(() => {
  const task = currentCenter.value?.task
  const voicePackage = selectedPackage.value

  if (!task || !voicePackage) {
    return false
  }

  const matchesPackage =
    task.voicePackageId === voicePackage.id || task.voicePackageCode === voicePackage.code

  return matchesPackage && task.status === 'paid'
})
const shouldShowPaymentBar = computed(() => {
  return Boolean(
    agents.value.length &&
      !isCheckingAuth.value &&
      !isLoadingAgents.value &&
      !agentsLoadError.value &&
      !isLoadingCenter.value &&
      !currentCenterError.value &&
      currentPackages.value.length,
  )
})

useLoad((options) => {
  initialAgentId.value = decodeRouteParam(options?.agentId)
  void preparePage()
})

useDidShow(() => {
  if (!isCheckingAuth.value && selectedAgentId.value && !isPaying.value) {
    void loadVoicePackageCenterForAgent(selectedAgentId.value, { force: true })
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

function buildAgentFallback(name: string) {
  const trimmedName = name.trim()

  return trimmedName ? trimmedName.slice(0, 1) : '灵'
}

function cleanPreview(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

function buildAgentDescription(agent: AgentSummary) {
  const description = cleanPreview(agent.description)

  if (description) {
    return description.length > 18 ? `${description.slice(0, 18)}...` : description
  }

  const callName = cleanPreview(agent.agentCallMe || agent.iCallAgent)

  return callName ? `${callName}，正在等待重塑声音...` : '左右切换，为 TA 选择声音模型'
}

async function preparePage() {
  isCheckingAuth.value = true
  const authenticated = await ensureAuthenticatedSession()

  if (!authenticated) {
    await redirectToAuthPage()
    return
  }

  isCheckingAuth.value = false
  await loadAgents()
}

async function loadAgents() {
  if (isLoadingAgents.value) {
    return
  }

  isLoadingAgents.value = true
  agentsLoadError.value = ''

  try {
    const items = await getAgents()
    agents.value = items
    selectedAgentId.value = resolveInitialAgentId(items)

    if (selectedAgentId.value) {
      await loadVoicePackageCenterForAgent(selectedAgentId.value, { force: true })
    }
  } catch (error) {
    if (error instanceof ApiException && error.requiresReLogin) {
      await clearAuthSession()
      await redirectToAuthPage()
      return
    }

    agentsLoadError.value =
      error instanceof ApiException ? error.message : '声音模型加载失败，请稍后重试'
  } finally {
    isLoadingAgents.value = false
  }
}

function resolveInitialAgentId(items: AgentSummary[]) {
  if (!items.length) {
    return ''
  }

  if (selectedAgentId.value && items.some((agent) => agent.id === selectedAgentId.value)) {
    return selectedAgentId.value
  }

  if (initialAgentId.value && items.some((agent) => agent.id === initialAgentId.value)) {
    return initialAgentId.value
  }

  return items.find((agent) => agent.isDefault)?.id ?? items[0]?.id ?? ''
}

async function loadVoicePackageCenterForAgent(
  agentId: string,
  options: { force?: boolean } = {},
) {
  if (!agentId) {
    return
  }

  if (!options.force && centerByAgentId.value[agentId]) {
    return
  }

  isLoadingCenter.value = true
  centerLoadErrorByAgentId.value = {
    ...centerLoadErrorByAgentId.value,
    [agentId]: '',
  }

  try {
    const center = await getAgentVoicePackageCenter(agentId)
    centerByAgentId.value = {
      ...centerByAgentId.value,
      [agentId]: center,
    }

    if (!selectedPackageIdByAgentId.value[agentId]) {
      selectedPackageIdByAgentId.value = {
        ...selectedPackageIdByAgentId.value,
        [agentId]: center.packages[0]?.id ?? '',
      }
    }
  } catch (error) {
    if (error instanceof ApiException && error.requiresReLogin) {
      await clearAuthSession()
      await redirectToAuthPage()
      return
    }

    centerLoadErrorByAgentId.value = {
      ...centerLoadErrorByAgentId.value,
      [agentId]:
        error instanceof ApiException ? error.message : '套餐加载失败，请稍后重试',
    }
  } finally {
    isLoadingCenter.value = false
  }
}

function handleAgentSwiperChange(event: { detail?: { current?: number } }) {
  const nextIndex = Number(event.detail?.current ?? 0)
  const nextAgent = agents.value[nextIndex]

  if (!nextAgent || nextAgent.id === selectedAgentId.value) {
    return
  }

  selectedAgentId.value = nextAgent.id
  void loadVoicePackageCenterForAgent(nextAgent.id)
}

function handlePackageSelect(packageId: string) {
  if (!selectedAgentId.value) {
    return
  }

  selectedPackageIdByAgentId.value = {
    ...selectedPackageIdByAgentId.value,
    [selectedAgentId.value]: packageId,
  }
}

async function handlePay() {
  const voicePackage = selectedPackage.value
  const agentId = selectedAgentId.value

  if (!voicePackage || !agentId || isPaying.value) {
    return
  }

  if (selectedPackagePaid.value) {
    showToast('该声音模型已购买')
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
      agentId,
      jsCode: code,
    })

    await Taro.requestPayment(result.payment)
    await Taro.redirectTo({
      url: `/pages/payment-result/index?orderId=${encodeURIComponent(result.order.id)}`,
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

function handleRetryAgents() {
  void loadAgents()
}

function handleRetryCenter() {
  if (selectedAgentId.value) {
    void loadVoicePackageCenterForAgent(selectedAgentId.value, { force: true })
  }
}

function handleCreateAgent() {
  void Taro.navigateTo({
    url: '/pages/agent-create/index',
  })
}

function handleOpenAgreement(type: AgreementDocumentType) {
  void openAgreementDocument(type)
}
</script>

<style lang="scss">
.voice-package-page {
  min-height: 100vh;
}

.voice-package-state,
.voice-package-panel-state {
  min-height: calc(100vh - 96px);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 32px;
  text-align: center;
}

.voice-package-panel-state {
  min-height: 360px;
  background: #ffffff;
}

.voice-package-state__dot {
  width: 22px;
  height: 22px;
  border: 3px solid rgba(236, 184, 114, 0.25);
  border-top-color: #ecb872;
  border-radius: 50%;
  animation: voice-package-spin 0.8s linear infinite;
}

.voice-package-state__title {
  color: #333333;
  font-size: 18px;
  line-height: 26px;
  font-weight: 600;
}

.voice-package-state__text {
  color: #777777;
  font-size: 14px;
  line-height: 22px;
}

.voice-package-state__button {
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

.voice-package-content {
  min-height: calc(100vh - 44px);
  background: #ffffff;
}

.voice-package-hero {
  padding: 32px 0 20px;
  background: #ededed;
}

.voice-package-hero__swiper {
  height: 140px;
}

.voice-package-agent-card {
  box-sizing: border-box;
  width: 327px;
  max-width: calc(100% - 64px);
  height: 132px;
  display: flex;
  align-items: center;
  gap: 20px;
  margin: 0 auto;
  padding: 0 32px;
  border-radius: 28px;
  background: #ffffff;
  box-shadow: 0 12px 28px rgba(172, 133, 82, 0.18);
}

.voice-package-agent-card__avatar {
  flex: 0 0 auto;
  width: 56px;
  height: 56px;
  overflow: hidden;
  border-radius: 18px;
  background: #eee8de;
}

.voice-package-agent-card__avatar--fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  color: #8a4c24;
  font-size: 30px;
  font-weight: 600;
}

.voice-package-agent-card__info {
  flex: 1;
  min-width: 0;
}

.voice-package-agent-card__name {
  display: block;
  overflow: hidden;
  color: #0a0a0a;
  font-size: 24px;
  line-height: 32px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.voice-package-agent-card__desc {
  display: -webkit-box;
  max-height: 34px;
  margin-top: 6px;
  overflow: hidden;
  color: #999999;
  font-size: 12px;
  line-height: 17px;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.voice-package-agent-card__voice-icon {
  flex: 0 0 auto;
  width: 56px;
  height: 56px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  border-radius: 50%;
  background: linear-gradient(135deg, #ff8e75 0%, #ff5f39 100%);
}

.voice-package-agent-card__voice-bar {
  width: 4px;
  border-radius: 999px;
  background: #ffffff;
}

.voice-package-agent-card__voice-bar--1 {
  height: 20px;
}

.voice-package-agent-card__voice-bar--2 {
  height: 32px;
}

.voice-package-agent-card__voice-bar--3 {
  height: 42px;
}

.voice-package-agent-card__voice-bar--4 {
  height: 26px;
}

.voice-package-hero__hint {
  display: block;
  margin-top: 14px;
  color: #999999;
  font-size: 14px;
  line-height: 20px;
  text-align: center;
}

@keyframes voice-package-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
