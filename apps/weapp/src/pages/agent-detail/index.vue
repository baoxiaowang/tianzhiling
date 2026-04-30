<template>
  <page-scaffold
    class="agent-detail-page"
    background="#f5f5f7"
    body-padding="0"
    :scroll="true"
    :safe-area-top="false"
  >
    <template #header>
      <app-bar title="" background="#ffffff" />
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
      <view class="agent-detail-section agent-detail-header">
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
          <text class="agent-detail-header__name">{{ displayName }}</text>
          <text class="agent-detail-header__sub">
            {{ sexLabel }}是你正在纪念的重要存在
          </text>
        </view>

        <view class="agent-detail-header__more">
          <MoreX size="18" color="#9a9ca3" />
        </view>
      </view>

      <view class="agent-detail-spacer" />

      <view class="agent-detail-section agent-detail-section--cell">
        <nut-cell
          title="朋友资料"
          :sub-title="profileDescription"
          is-link
          center
          class="agent-detail-cell agent-detail-cell--profile"
          @click="handleProfileTap"
        />
      </view>

      <view class="agent-detail-spacer" />

      <view class="agent-detail-section agent-detail-section--cell">
        <nut-cell
          v-for="(item, index) in capabilityTiles"
          :key="item"
          :title="item"
          is-link
          center
          class="agent-detail-cell"
          :class="{ 'agent-detail-cell--divider': index !== capabilityTiles.length - 1 }"
          @click="handlePendingTap(item)"
        />
      </view>

      <view class="agent-detail-spacer" />

      <view class="agent-detail-section agent-detail-section--cell">
        <nut-cell
          title="好友动态"
          is-link
          center
          class="agent-detail-cell agent-detail-cell--moments"
          @click="handlePendingTap('好友动态')"
        >
          <template #desc>
            <view class="agent-detail-moments__thumbs">
              <view class="agent-detail-moments__thumb">
                <image
                  v-if="displayAvatar"
                  class="agent-detail-moments__thumb-image"
                  :src="displayAvatar"
                  mode="aspectFill"
                />
              </view>
              <view class="agent-detail-moments__thumb">
                <image
                  v-if="displayAvatar"
                  class="agent-detail-moments__thumb-image"
                  :src="displayAvatar"
                  mode="aspectFill"
                />
              </view>
            </view>
          </template>
        </nut-cell>
      </view>

      <view class="agent-detail-spacer" />

      <view class="agent-detail-section agent-detail-section--cell">
        <nut-cell center class="agent-detail-cell agent-detail-action-cell" @click="handleSendMessage">
          <template #title>
            <view class="agent-detail-action">
              <Message size="19" color="#637897" />
              <text class="agent-detail-action__text">发消息</text>
            </view>
          </template>
        </nut-cell>
      </view>

      <view class="agent-detail-hairline" />

      <view class="agent-detail-section agent-detail-section--cell">
        <nut-cell
          center
          class="agent-detail-cell agent-detail-action-cell"
          @click="handlePendingTap('音视频通话')"
        >
          <template #title>
            <view class="agent-detail-action">
              <Voice size="19" color="#637897" />
              <text class="agent-detail-action__text">音视频通话</text>
            </view>
          </template>
        </nut-cell>
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
import Taro, { useLoad } from '@tarojs/taro'
import { Message, MoreX, Voice } from '@nutui/icons-vue-taro'
import { computed, ref } from 'vue'
import { ApiException } from '../../api/api-exception'
import { getAgentDetail, type AgentSummary } from '../../apis/agent'
import { clearAuthSession } from '../../auth/session'
import AppBar from '../../components/app-bar/app-bar.vue'
import PageScaffold from '../../components/page-scaffold/page-scaffold.vue'
import { ensureAuthenticatedSession, redirectToAuthPage } from '../../utils/auth-guard'

const capabilityTiles = ['声音模型', 'VIP与增值配置', '导入聊天记录'] as const

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
  showToast('朋友资料编辑待接入')
}

function handlePendingTap(title: string) {
  if (title === 'VIP与增值配置') {
    void Taro.navigateTo({
      url: '/pages/vip-center/index',
    })
    return
  }

  showToast(`${title}待接入`)
}

function handleSendMessage() {
  void Taro.navigateBack({
    delta: 1,
  })
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
  padding-bottom: 24px;
}

.agent-detail-section {
  background: #ffffff;
}

.agent-detail-header {
  display: flex;
  align-items: center;
  min-height: 106px;
  padding: 18px 16px 28px 20px;
}

.agent-detail-header__avatar-wrap {
  flex-shrink: 0;
  width: 60px;
  height: 60px;
}

.agent-detail-header__avatar {
  width: 60px;
  height: 60px;
  border-radius: 14px;
  background: #eef2f7;
}

.agent-detail-header__avatar--fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  color: #ffffff;
  font-size: 24px;
  line-height: 32px;
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
  margin-left: 14px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.agent-detail-header__name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #222222;
  font-size: 18px;
  line-height: 26px;
  font-weight: 700;
}

.agent-detail-header__sub {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #9a9ca3;
  font-size: 13px;
  line-height: 18px;
}

.agent-detail-header__more {
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  border: 1px solid #d9dadd;
  border-radius: 999px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 2px;
}

.agent-detail-spacer {
  height: 8px;
}

.agent-detail-section--cell {
  --nut-cell-background: #ffffff;
  --nut-cell-border-radius: 0;
  --nut-cell-box-shadow: none;
  --nut-cell-color: #111111;
  --nut-cell-desc-color: #8a8f98;
  --nut-cell-title-font: 16px;
  --nut-cell-title-desc-font: 13px;
  --nut-cell-line-height: 24px;
  --nut-cell-padding: 0 16px;
  --nut-cell-default-icon-margin: 0 8px 0 0;
}

.agent-detail-cell {
  position: relative;
  min-height: 60px;
  margin: 0;
  color: #111111;
}

.agent-detail-cell--profile,
.agent-detail-cell--moments {
  min-height: 72px;
}

.agent-detail-cell--divider::after {
  content: '';
  position: absolute;
  left: 16px;
  right: 0;
  bottom: 0;
  height: 0.5px;
  background: #eaecef;
}

.agent-detail-cell .nut-cell__title,
.agent-detail-cell .title {
  color: #111111;
  font-size: 16px;
  line-height: 24px;
  font-weight: 500;
}

.agent-detail-cell .nut-cell__title-desc {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #8a8f98;
  font-size: 13px;
  line-height: 18px;
  margin-top: 6px;
}

.agent-detail-cell .nut-cell__value {
  min-width: 0;
  display: flex;
  justify-content: flex-end;
  align-items: center;
}

.agent-detail-moments__thumbs {
  min-width: 0;
  display: flex;
  justify-content: flex-end;
  gap: 4px;
}

.agent-detail-moments__thumb {
  width: 38px;
  height: 38px;
  border-radius: 2px;
  background: #f2f3f5;
  overflow: hidden;
}

.agent-detail-moments__thumb-image {
  width: 100%;
  height: 100%;
}

.agent-detail-action-cell {
  min-height: 56px;
}

.agent-detail-action-cell .nut-cell__title {
  align-items: center;
}

.agent-detail-action {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.agent-detail-action__text {
  color: #637897;
  font-size: 16px;
  line-height: 24px;
  font-weight: 500;
}

.agent-detail-hairline {
  height: 0.5px;
  background: #eaecef;
}
</style>
