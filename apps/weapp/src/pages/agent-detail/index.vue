<template>
  <page-scaffold
    class="agent-detail-page"
    background="#efeff4"
    header-background="#f6f6f6"
    body-padding="0"
    :scroll="true"
    :safe-area-top="false"
    :safe-area-bottom="false"
  >
    <template #header>
      <app-bar title="" background="#f6f6f6" />
    </template>

    <view v-if="isCheckingAuth || isLoading" class="agent-detail-state">
      <view class="agent-detail-state__dot" />
      <text class="agent-detail-state__text">
        {{ isCheckingAuth ? '正在恢复会话...' : '正在加载资料...' }}
      </text>
    </view>

    <view v-else-if="showBlockingError" class="agent-detail-state">
      <text class="agent-detail-state__title">资料暂时加载失败</text>
      <text class="agent-detail-state__text">{{ loadError }}</text>
      <view class="agent-detail-state__button" @tap="handleRetry">重试</view>
    </view>

    <view v-else class="agent-detail">
      <view class="agent-detail-header">
        <view class="agent-detail-header__avatar-wrap">
          <image
            v-if="displayAvatar"
            class="agent-detail-header__avatar"
            :src="displayAvatar"
            mode="aspectFill"
          />
          <view
            v-else
            class="agent-detail-header__avatar agent-detail-header__avatar--fallback"
            :class="avatarFallbackClass"
          >
            {{ avatarFallback }}
          </view>
        </view>

        <view class="agent-detail-header__meta">
          <view class="agent-detail-header__name-row">
            <text class="agent-detail-header__name">{{ displayName }}</text>
          </view>
          <text class="agent-detail-header__sub">{{ headerSubtitle }}</text>
        </view>

        <view class="agent-detail-header__tools">
          <view class="agent-detail-header__tool agent-detail-header__tool--qr" @tap="handleQrTap" />
          <view class="agent-detail-header__tool agent-detail-header__tool--edit" @tap="handleOpenAgentForm" />
        </view>
      </view>

      <view class="agent-detail-spacer" />

      <view class="agent-detail-list">
        <view class="agent-detail-list__item agent-detail-list__item--profile" @tap="handleProfileTap">
          <view class="agent-detail-list__content">
            <text class="agent-detail-list__title">亲友资料</text>
            <text class="agent-detail-list__desc">完善亲友资料，有助于更自然地与 TA 对话</text>
          </view>
          <view class="agent-detail-list__arrow" />
        </view>

        <view class="agent-detail-list__item agent-detail-list__item--switch">
          <text class="agent-detail-list__title">设为默认智能体</text>
          <switch
            class="agent-detail-default-switch"
            :checked="isDefaultAgent"
            color="#39cd80"
            @change="handleDefaultAgentChange"
          />
        </view>

        <view class="agent-detail-list__item" @tap="handleVoiceModelTap">
          <text class="agent-detail-list__title">声音模型</text>
          <view class="agent-detail-list__right">
            <text v-if="voiceModelStatus" class="agent-detail-list__value">{{ voiceModelStatus }}</text>
            <view class="agent-detail-list__arrow" />
          </view>
        </view>

        <view class="agent-detail-list__item agent-detail-list__item--album" @tap="handleChatAlbumTap">
          <view class="agent-detail-album__main">
            <text class="agent-detail-list__title">聊天相册</text>
            <view class="agent-detail-album__thumbs">
              <view
                v-for="index in 3"
                :key="index"
                class="agent-detail-album__thumb"
              >
                <image
                  v-if="displayAvatar"
                  class="agent-detail-album__thumb-image"
                  :src="displayAvatar"
                  mode="aspectFill"
                />
              </view>
            </view>
          </view>
          <view class="agent-detail-list__arrow" />
        </view>
      </view>

      <view class="agent-detail-spacer" />

      <view class="agent-detail-actions">
        <view class="agent-detail-action-button" @tap="handleSendMessage">
          <Message size="20" color="#0a0a0a" />
          <text class="agent-detail-action-button__text">发消息</text>
        </view>
        <view class="agent-detail-action-button" @tap="handleAudioCallTap">
          <view class="agent-detail-action-button__phone" />
          <text class="agent-detail-action-button__text">音频通话</text>
        </view>
      </view>
    </view>
  </page-scaffold>
</template>

<script lang="ts">
export default {
  name: 'AgentDetailPage',
}
</script>

<script setup lang="ts">
import Taro, { useDidShow, useLoad } from '@tarojs/taro'
import { Message } from '@nutui/icons-vue-taro'
import { computed, ref } from 'vue'
import { ApiException } from '../../api/api-exception'
import { getAgentDetail, type AgentSummary } from '../../apis/agent'
import { clearAuthSession } from '../../auth/session'
import AppBar from '../../components/app-bar/app-bar.vue'
import PageScaffold from '../../components/page-scaffold/page-scaffold.vue'
import { ensureAuthenticatedSession, redirectToAuthPage } from '../../utils/auth-guard'

const agent = ref<AgentSummary | null>(null)
const agentId = ref('')
const fallbackName = ref('')
const fallbackAvatar = ref('')
const fallbackSex = ref(0)
const fallbackAgentCallMe = ref('')
const fallbackICallAgent = ref('')
const fallbackPreview = ref('')
const fallbackCreatedAt = ref<Date | null>(null)
const isCheckingAuth = ref(true)
const isLoading = ref(false)
const loadError = ref('')
const didInitialShow = ref(false)
const isDefaultAgent = ref(true)

const displayName = computed(() => {
  const name = agent.value?.name.trim() || fallbackName.value.trim()
  return name || '未命名智能体'
})
const displayAvatar = computed(() => {
  return agent.value?.avatar.trim() || fallbackAvatar.value.trim()
})
const displaySex = computed(() => {
  return agent.value?.sex ?? fallbackSex.value
})
const sexLabel = computed(() => (displaySex.value === 1 ? '他' : '她'))
const headerSubtitle = computed(() => {
  const description = agent.value?.description.trim() || fallbackPreview.value.trim()
  const cleanedDescription = description ? cleanPreview(description) : ''

  return cleanedDescription || `${sexLabel.value}是你正在纪念的重要存在`
})
const voiceModelStatus = computed(() => {
  const timbreId = agent.value?.voiceTimbreId?.trim()
  return timbreId ? '已设置' : ''
})
const avatarFallback = computed(() => displayName.value.slice(0, 1))
const avatarFallbackClass = computed(() => {
  return displaySex.value === 1
    ? 'agent-detail-header__avatar--male'
    : 'agent-detail-header__avatar--female'
})
const hasFallbackSnapshot = computed(() => {
  return Boolean(
    fallbackName.value.trim() ||
      fallbackAvatar.value.trim() ||
      fallbackPreview.value.trim() ||
      fallbackAgentCallMe.value.trim() ||
      fallbackICallAgent.value.trim(),
  )
})
const showBlockingError = computed(() => {
  return Boolean(loadError.value && !agent.value && !hasFallbackSnapshot.value)
})
const profileDescription = computed(() => {
  const description = agent.value?.description.trim() || fallbackPreview.value.trim()

  if (description) {
    return cleanPreview(description)
  }

  const createdAt = agent.value?.createdAt ?? fallbackCreatedAt.value
  const year = createdAt?.getFullYear()
  const relation = agent.value?.iCallAgent.trim() || fallbackICallAgent.value.trim()
  const callMe = agent.value?.agentCallMe.trim() || fallbackAgentCallMe.value.trim()
  const parts: string[] = []

  if (year) {
    parts.push(`${year}年`)
  }

  if (relation) {
    parts.push(`你称呼${sexLabel.value}为“${relation}”`)
  } else {
    parts.push(`${sexLabel.value}是你正在纪念的重要存在`)
  }

  if (callMe) {
    parts.push(`${sexLabel.value}会叫你“${callMe}”`)
  }

  return `${parts.join('，')}。`
})

useLoad((options) => {
  agentId.value = decodeRouteParam(options?.agentId)
  fallbackName.value = decodeRouteParam(options?.agentName)
  fallbackAvatar.value = decodeRouteParam(options?.agentAvatar)
  fallbackSex.value = Number.parseInt(decodeRouteParam(options?.agentSex), 10) || 0
  fallbackAgentCallMe.value = decodeRouteParam(options?.agentCallMe)
  fallbackICallAgent.value = decodeRouteParam(options?.iCallAgent)
  fallbackPreview.value = decodeRouteParam(options?.preview)
  fallbackCreatedAt.value = parseDate(decodeRouteParam(options?.createdAt))

  void preparePage()
})

useDidShow(() => {
  if (!didInitialShow.value) {
    didInitialShow.value = true
    return
  }

  if (agentId.value && !isCheckingAuth.value) {
    void loadAgentDetail()
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

function parseDate(value: string) {
  if (!value.trim()) {
    return null
  }

  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function cleanPreview(value: string) {
  const segments = value
    .split('</fenge>')
    .map((item) => item.trim())
    .filter(Boolean)
  const raw = segments.length ? segments[segments.length - 1] : value.trim()
  return raw.replace(/<[^>]+>/g, '').trim()
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
  await loadAgentDetail()
}

async function loadAgentDetail() {
  if (!agentId.value) {
    loadError.value = '缺少联系人资料，请返回通讯录重新进入'
    return
  }

  isLoading.value = true
  loadError.value = ''

  try {
    agent.value = await getAgentDetail(agentId.value)
  } catch (error) {
    if (error instanceof ApiException && error.requiresReLogin) {
      await clearAuthSession()
      await redirectToAuthPage()
      return
    }

    loadError.value =
      error instanceof ApiException
        ? error.message
        : '资料加载失败，请稍后重试'
  } finally {
    isLoading.value = false
  }
}

function handleRetry() {
  void loadAgentDetail()
}

function handleProfileTap() {
  void handleOpenAgentForm()
}

async function handleOpenAgentForm() {
  if (!agentId.value) {
    showToast('缺少联系人资料，请返回通讯录重新进入')
    return
  }

  await Taro.navigateTo({
    url: buildAgentFormUrl(),
  })
}

function buildAgentFormUrl() {
  const createdAt = agent.value?.createdAt ?? fallbackCreatedAt.value
  const query = [
    ['agentId', agentId.value],
    ['agentName', displayName.value],
    ['agentAvatar', displayAvatar.value],
    ['agentSex', String(displaySex.value)],
    [
      'agentCallMe',
      agent.value?.agentCallMe.trim() || fallbackAgentCallMe.value.trim(),
    ],
    [
      'iCallAgent',
      agent.value?.iCallAgent.trim() || fallbackICallAgent.value.trim(),
    ],
    ['preview', profileDescription.value],
    ['createdAt', createdAt?.toISOString() ?? ''],
  ]
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&')

  return `/pages/agent-form/index?${query}`
}

function handleSendMessage() {
  void Taro.navigateBack({
    delta: 1,
  })
}

function handleQrTap() {
  showToast('二维码功能待接入')
}

function handleDefaultAgentChange(event: Event) {
  const value = (event as Event & { detail?: { value?: boolean } }).detail?.value
  isDefaultAgent.value = Boolean(value)
  showToast(isDefaultAgent.value ? '已设为默认智能体' : '已取消默认智能体')
}

function handleVoiceModelTap() {
  showToast('声音模型待接入')
}

function handleChatAlbumTap() {
  showToast('聊天相册待接入')
}

function handleAudioCallTap() {
  showToast('音频通话待接入')
}
</script>

<style lang="scss">
.agent-detail-page {
  min-height: 100vh;
}

.agent-detail-state {
  min-height: calc(100vh - 96px);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 32px;
  text-align: center;
}

.agent-detail-state__dot {
  width: 14px;
  height: 14px;
  border-radius: 999px;
  background: $tzl-gradient-primary;
  box-shadow: $tzl-shadow-primary-sm;
}

.agent-detail-state__title {
  color: #111111;
  font-size: 16px;
  line-height: 24px;
  font-weight: 600;
}

.agent-detail-state__text {
  color: #8a8f98;
  font-size: 14px;
  line-height: 20px;
}

.agent-detail-state__button {
  margin-top: 8px;
  padding: 8px 18px;
  border-radius: 12px;
  color: #ffffff;
  font-size: 14px;
  line-height: 20px;
  background: #111111;
}

.agent-detail {
  min-height: 100%;
  padding-bottom: 32px;
  background: #efeff4;
}

.agent-detail-header {
  display: flex;
  align-items: center;
  gap: 16px;
  height: 120px;
  box-sizing: border-box;
  padding: 0 18px;
  background: #ffffff;
}

.agent-detail-header__avatar-wrap {
  flex-shrink: 0;
  width: 72px;
  height: 72px;
}

.agent-detail-header__avatar {
  width: 72px;
  height: 72px;
  border-radius: 8px;
  background: #eef2f7;
}

.agent-detail-header__avatar--fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  color: #ffffff;
  font-size: 28px;
  line-height: 36px;
  font-weight: 700;
}

.agent-detail-header__avatar--male {
  background: linear-gradient(135deg, #b6dbff 0%, #5d8fff 100%);
}

.agent-detail-header__avatar--female {
  background: linear-gradient(135deg, #ffd9e5 0%, #ff8daa 100%);
}

.agent-detail-header__meta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 10px;
}

.agent-detail-header__name-row {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}

.agent-detail-header__name {
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #000000;
  font-size: 20px;
  line-height: 29px;
  font-weight: 500;
}

.agent-detail-header__sub {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #999999;
  font-size: 14px;
  line-height: 22px;
  font-weight: 500;
}

.agent-detail-header__tools {
  flex-shrink: 0;
  width: 19px;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 18px;
}

.agent-detail-header__tool {
  position: relative;
  width: 18px;
  height: 18px;
  color: #9a9ca3;
}

.agent-detail-header__tool--qr {
  box-sizing: border-box;
  border: 2px solid currentColor;
  border-radius: 2px;
}

.agent-detail-header__tool--qr::before,
.agent-detail-header__tool--qr::after {
  content: '';
  position: absolute;
  background: currentColor;
}

.agent-detail-header__tool--qr::before {
  left: 4px;
  top: 4px;
  width: 3px;
  height: 3px;
  box-shadow: 7px 0 0 currentColor, 0 7px 0 currentColor, 7px 7px 0 currentColor;
}

.agent-detail-header__tool--edit::before {
  content: '';
  position: absolute;
  left: 4px;
  top: 3px;
  width: 10px;
  height: 12px;
  border: 2px solid currentColor;
  border-top: 0;
  transform: rotate(-35deg);
}

.agent-detail-header__tool--edit::after {
  content: '';
  position: absolute;
  left: 11px;
  top: 1px;
  width: 3px;
  height: 7px;
  border-radius: 2px;
  background: currentColor;
  transform: rotate(-35deg);
}

.agent-detail-spacer {
  height: 10px;
}

.agent-detail-list,
.agent-detail-actions {
  background: #ffffff;
}

.agent-detail-list__item {
  position: relative;
  min-height: 58px;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 0 16px;
  background: #ffffff;
}

.agent-detail-list__item::after,
.agent-detail-action-button:first-child::after {
  content: '';
  position: absolute;
  left: 16px;
  right: 0;
  bottom: 0;
  height: 1px;
  transform: scaleY(0.5);
  transform-origin: bottom;
  background: #e5e5e5;
}

.agent-detail-list__item--profile {
  min-height: 71px;
}

.agent-detail-list__item--album {
  min-height: 80px;
}

.agent-detail-list__item--switch {
  min-height: 58px;
}

.agent-detail-list__content {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.agent-detail-list__title {
  color: #0a0a0a;
  font-size: 16px;
  line-height: 24px;
  font-weight: 500;
}

.agent-detail-list__desc {
  max-width: 300px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #999999;
  font-size: 14px;
  line-height: 18px;
}

.agent-detail-list__right {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 4px;
}

.agent-detail-list__value {
  color: #999999;
  font-size: 14px;
  line-height: 20px;
}

.agent-detail-list__arrow {
  flex-shrink: 0;
  width: 10px;
  height: 10px;
  border-top: 1.6px solid #b6b6b6;
  border-right: 1.6px solid #b6b6b6;
  transform: rotate(45deg);
}

.agent-detail-default-switch {
  transform: scale(0.76);
  transform-origin: right center;
}

.agent-detail-album__main {
  min-width: 0;
  flex: 1;
  display: flex;
  align-items: center;
  gap: 10px;
}

.agent-detail-album__thumbs {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 4px;
}

.agent-detail-album__thumb {
  width: 44px;
  height: 44px;
  border-radius: 4px;
  overflow: hidden;
  background: #f2f3f5;
}

.agent-detail-album__thumb-image {
  width: 100%;
  height: 100%;
}

.agent-detail-actions {
  display: flex;
  flex-direction: column;
}

.agent-detail-action-button {
  position: relative;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background: #ffffff;
}

.agent-detail-action-button__text {
  color: #0a0a0a;
  font-size: 16px;
  line-height: 24px;
  font-weight: 500;
}

.agent-detail-action-button__phone {
  position: relative;
  width: 20px;
  height: 20px;
  border: 2px solid #0a0a0a;
  border-radius: 6px 6px 10px 10px;
  transform: rotate(-36deg);
}

.agent-detail-action-button__phone::before {
  content: '';
  position: absolute;
  left: 4px;
  top: -5px;
  width: 8px;
  height: 4px;
  border-radius: 3px;
  background: #0a0a0a;
}

.agent-detail-action-button__phone::after {
  content: '';
  position: absolute;
  left: 5px;
  bottom: -5px;
  width: 7px;
  height: 4px;
  border-radius: 3px;
  background: #0a0a0a;
}

</style>
