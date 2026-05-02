<template>
  <page-scaffold
    class="contacts-tab-page"
    body-padding="0"
    background="#ffffff"
    :safe-area-top="false"
    scroll
    :safe-area-bottom="false"
    require-auth
    auth-loading-text="正在恢复通讯录..."
    login-placeholder-title="登录后查看通讯录"
    login-placeholder-subtitle="授权后可查看已经开始聊天的联系人"
    login-placeholder-action-text="登录查看"
  >
    <template #header>
      <app-bar
        title="通讯录"
        :menus="session ? navMenus : []"
        :show-capsule="Boolean(session)"
        :show-back="false"
        @menu-select="handleNavMenuSelect"
      >
        <template #capsule-menu>
          <view class="contacts-page__capsule-add">
            <view class="contacts-page__capsule-add-line contacts-page__capsule-add-line--horizontal" />
            <view class="contacts-page__capsule-add-line contacts-page__capsule-add-line--vertical" />
          </view>
        </template>
      </app-bar>
    </template>

    <view v-if="isCheckingAuth" class="loading-state">
      <view class="loading-state__dot" />
      <text class="loading-state__text">
        正在恢复通讯录...
      </text>
    </view>

    <view v-else-if="session" class="contacts-page">
      <view class="contacts-search">
        <view class="contacts-search__icon" />
        <input
          v-model="contactKeyword"
          class="contacts-search__input"
          type="text"
          confirm-type="search"
          maxlength="20"
          placeholder="搜索"
          placeholder-style="color: #99a1af;"
        />
      </view>

      <scroll-view scroll-y class="contacts-list-scroll">
        <view v-if="isContactsLoading" class="contacts-feedback contacts-feedback--loading">
          <view class="contacts-feedback__spinner" />
          <text class="contacts-feedback__title">正在加载通讯录...</text>
        </view>

        <view v-else-if="contactsLoadError" class="contacts-feedback">
          <text class="contacts-feedback__title">{{ contactsLoadError }}</text>
          <text class="contacts-feedback__action" @tap="handleContactsRetry">重新加载</text>
        </view>

        <view v-else-if="!filteredConversations.length" class="contacts-feedback">
          <text class="contacts-feedback__title">{{ contactsEmptyTitle }}</text>
          <text class="contacts-feedback__desc">{{ contactsEmptyDescription }}</text>
        </view>

        <view v-else class="contacts-list">
          <view
            v-for="conversation in filteredConversations"
            :key="conversation.id"
            class="contacts-item"
            @tap="handleConversationTap(conversation)"
          >
            <image
              v-if="conversation.agentAvatar"
              class="contacts-item__avatar"
              :src="conversation.agentAvatar"
              mode="aspectFill"
            />
            <view
              v-else
              class="contacts-item__avatar contacts-item__avatar--fallback"
              :class="{
                'contacts-item__avatar--male': conversation.agentSex === 1,
                'contacts-item__avatar--female': conversation.agentSex !== 1,
              }"
            >
              {{ buildConversationFallback(conversation.agentName) }}
            </view>

            <view class="contacts-item__content">
              <view class="contacts-item__headline">
                <text class="contacts-item__name">{{ resolveConversationName(conversation) }}</text>
                <text class="contacts-item__time">
                  {{ formatConversationUpdatedAt(conversation.updatedAt) }}
                </text>
              </view>
              <text class="contacts-item__preview">
                {{ buildConversationPreview(conversation.preview) }}
              </text>
            </view>
          </view>
        </view>
      </scroll-view>
    </view>
  </page-scaffold>
</template>

<script lang="ts">
export default {
  name: 'ContactsTabPage',
}
</script>

<script setup lang="ts">
import Taro, { useDidShow } from '@tarojs/taro'
import { computed, ref } from 'vue'
import { ApiException } from '../../api/api-exception'
import { getConversations, type ConversationSummary } from '../../apis/conversation'
import { authSession } from '../../auth/session'
import AppBar from '../../components/app-bar/app-bar.vue'
import PageScaffold from '../../components/page-scaffold/page-scaffold.vue'
import { ensureAuthenticatedSession } from '../../utils/auth-guard'
import { syncCustomTabBar } from '../../utils/custom-tab-bar'

const isCheckingAuth = ref(true)
const isContactsLoading = ref(true)
const contactKeyword = ref('')
const contactsLoadError = ref('')
const conversations = ref<ConversationSummary[]>([])

let refreshContactsPromise: Promise<void> | null = null

const navMenus = [
  {
    key: 'create-agent',
    text: '添加',
  },
] as const

const session = computed(() => authSession.value)
const filteredConversations = computed(() => {
  const keyword = contactKeyword.value.trim().toLowerCase()

  if (!keyword) {
    return conversations.value
  }

  return conversations.value.filter((conversation) => {
    return [
      conversation.agentName,
      conversation.iCallAgent,
      conversation.agentCallMe,
    ]
      .map((value) => value.trim().toLowerCase())
      .some((value) => value.includes(keyword))
  })
})
const contactsEmptyTitle = computed(() => {
  return contactKeyword.value.trim() ? '没有找到匹配的联系人' : '还没有联系人'
})
const contactsEmptyDescription = computed(() => {
  return contactKeyword.value.trim()
    ? '换个关键词试试，支持按联系人昵称和互称搜索。'
    : '通讯录会展示你已经开始聊天的联系人。'
})

async function handleCreateAgent() {
  await Taro.navigateTo({
    url: '/pages/agent-create/index',
  })
}

function handleNavMenuSelect() {
  void handleCreateAgent()
}

function handleContactsRetry() {
  void refreshContactsData({ showLoading: true })
}

function handleConversationTap(conversation: ConversationSummary) {
  const query = [
    ['conversationId', conversation.id],
    ['agentId', conversation.agentId],
    ['agentName', resolveConversationName(conversation)],
    ['agentAvatar', conversation.agentAvatar],
    ['agentSex', String(conversation.agentSex)],
    ['agentCallMe', conversation.agentCallMe],
    ['iCallAgent', conversation.iCallAgent],
    ['preview', conversation.preview],
    ['createdAt', conversation.createdAt?.toISOString() ?? ''],
  ]
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&')

  void Taro.navigateTo({
    url: `/pages/chat/index?${query}`,
  })
}

function resolveConversationName(conversation: ConversationSummary) {
  const trimmedName = conversation.agentName.trim()
  return trimmedName ? trimmedName : '未命名联系人'
}

function buildConversationFallback(name: string) {
  const trimmedName = name.trim()
  return trimmedName ? trimmedName.slice(0, 1) : 'A'
}

function buildConversationPreview(preview: string) {
  const segments = preview
    .split('</fenge>')
    .map((item) => item.trim())
    .filter(Boolean)
  const rawPreview = segments.length ? segments[segments.length - 1] : preview.trim()
  const cleanedPreview = rawPreview.replace(/<[^>]+>/g, '').trim()

  return cleanedPreview || '点击开始和 TA 对话'
}

function formatConversationUpdatedAt(value: Date | null) {
  if (!value) {
    return ''
  }

  const now = new Date()
  const isSameDay =
    now.getFullYear() === value.getFullYear() &&
    now.getMonth() === value.getMonth() &&
    now.getDate() === value.getDate()

  if (isSameDay) {
    const hour = String(value.getHours()).padStart(2, '0')
    const minute = String(value.getMinutes()).padStart(2, '0')
    return `${hour}:${minute}`
  }

  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${month}-${day}`
}

async function refreshContactsData(options: { showLoading?: boolean } = {}) {
  if (refreshContactsPromise) {
    return refreshContactsPromise
  }

  if (options.showLoading ?? conversations.value.length === 0) {
    isContactsLoading.value = true
  }

  contactsLoadError.value = ''

  refreshContactsPromise = getConversations()
    .then((items) => {
      conversations.value = items
    })
    .catch((error: unknown) => {
      if (error instanceof ApiException && error.requiresReLogin) {
        contactsLoadError.value = error.message
        return
      }

      contactsLoadError.value =
        error instanceof ApiException
          ? error.message
          : '加载通讯录失败，请稍后重试'
    })
    .finally(() => {
      isContactsLoading.value = false
      refreshContactsPromise = null
    })

  return refreshContactsPromise
}

async function preparePage() {
  isCheckingAuth.value = true

  const authenticated = await ensureAuthenticatedSession()

  if (!authenticated || !authSession.value) {
    isContactsLoading.value = false
    isCheckingAuth.value = false
    return
  }

  await refreshContactsData({
    showLoading: conversations.value.length === 0,
  })
  isCheckingAuth.value = false
}

useDidShow(() => {
  syncCustomTabBar('/pages/contacts/index')
  void preparePage()
})
</script>

<style lang="scss">
.contacts-tab-page {
  min-height: 100vh;
}

.loading-state {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
}

.loading-state__dot {
  width: 14px;
  height: 14px;
  border-radius: 999px;
  background: $tzl-gradient-primary;
  box-shadow: $tzl-shadow-primary-sm;
}

.loading-state__text {
  font-size: 14px;
  color: $tzl-color-text-muted;
}

.contacts-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: $tzl-color-surface-base;
}

.contacts-search {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 36px;
  margin: 8px 16px 2px;
  padding: 0 12px;
  border-radius: 8px;
  background: #f3f4f6;
}

.contacts-page__capsule-add {
  position: relative;
  width: 16px;
  height: 16px;
}

.contacts-page__capsule-add-line {
  position: absolute;
  top: 50%;
  left: 50%;
  background: #111111;
  border-radius: 999px;
  transform: translate(-50%, -50%);
}

.contacts-page__capsule-add-line--horizontal {
  width: 14px;
  height: 2px;
}

.contacts-page__capsule-add-line--vertical {
  width: 2px;
  height: 14px;
}

.contacts-search__icon {
  position: relative;
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}

.contacts-search__icon::before,
.contacts-search__icon::after {
  content: '';
  position: absolute;
  box-sizing: border-box;
}

.contacts-search__icon::before {
  left: 0;
  top: 0;
  width: 11px;
  height: 11px;
  border: 1.6px solid #98a2b3;
  border-radius: 50%;
}

.contacts-search__icon::after {
  right: 1px;
  bottom: 1px;
  width: 6px;
  height: 1.6px;
  background: #98a2b3;
  border-radius: 999px;
  transform: rotate(45deg);
  transform-origin: center;
}

.contacts-search__input {
  flex: 1;
  min-width: 0;
  height: 100%;
  font-size: 14px;
  color: #111827;
}

.contacts-list-scroll {
  flex: 1;
  min-height: 0;
  padding-bottom: 110px;
}

.contacts-list {
  background: $tzl-color-surface-base;
}

.contacts-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 72px;
  padding: 0 16px;
  background: $tzl-color-surface-base;
}

.contacts-item::after {
  content: '';
  position: absolute;
  left: 76px;
  right: 0;
  bottom: 0;
  height: 0.5px;
  background: #f0f2f5;
}

.contacts-item:last-child::after {
  display: none;
}

.contacts-item__avatar {
  flex-shrink: 0;
  width: 48px;
  height: 48px;
  border-radius: 8px;
  background: #eef2f7;
}

.contacts-item__avatar--fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  color: $tzl-color-surface-base;
  font-size: 20px;
  font-weight: 700;
}

.contacts-item__avatar--male {
  background: linear-gradient(135deg, #b6dbff 0%, #5d8fff 100%);
}

.contacts-item__avatar--female {
  background: linear-gradient(135deg, #ffd9e5 0%, #ff8daa 100%);
}

.contacts-item__content {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 2px;
}

.contacts-item__headline {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.contacts-item__name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 16px;
  line-height: 24px;
  font-weight: 600;
  color: #101828;
}

.contacts-item__time {
  flex-shrink: 0;
  font-size: 12px;
  line-height: 16px;
  color: #99a1af;
}

.contacts-item__preview {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
  line-height: 20px;
  color: #99a1af;
}

.contacts-feedback {
  min-height: calc(100vh - 260px);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 32px;
  text-align: center;
}

.contacts-feedback--loading {
  gap: 12px;
}

.contacts-feedback__spinner {
  width: 18px;
  height: 18px;
  border: 2px solid rgba(255, 138, 54, 0.18);
  border-top-color: $tzl-color-primary;
  border-radius: 50%;
  animation: contacts-spinner 0.9s linear infinite;
}

.contacts-feedback__title {
  font-size: 16px;
  line-height: 24px;
  font-weight: 600;
  color: #344054;
}

.contacts-feedback__desc {
  font-size: 14px;
  line-height: 20px;
  color: #98a2b3;
}

.contacts-feedback__action {
  margin-top: 4px;
  font-size: 15px;
  line-height: 22px;
  font-weight: 600;
  color: $tzl-color-primary;
}

@keyframes contacts-spinner {
  from {
    transform: rotate(0deg);
  }

  to {
    transform: rotate(360deg);
  }
}
</style>
