<template>
  <page-scaffold
    class="chat-page"
    background="#ededed"
    header-background="#f7f7f7"
    bottom-background="#f7f7f7"
    :body-padding="bodyPadding"
    :scroll="true"
    :scroll-into-view="scrollIntoViewTarget"
    :scroll-with-animation="true"
    :show-scrollbar="false"
    :safe-area-top="false"
    :safe-area-bottom="false"
  >
    <template #header>
      <view class="chat-page__nav" :style="navStyle">
        <back-capsule
          class="chat-page__nav-capsule"
          :menus="navMenus"
          back-home-url="/pages/index/index"
          @menu-select="handleNavMenuSelect"
        />
        <text class="chat-page__nav-title">{{ pageTitle }}</text>
      </view>
    </template>

    <view class="chat-page__body">

        <view v-if="isCheckingAuth || isLoading" class="chat-feedback">
          <view class="chat-feedback__spinner" />
          <text class="chat-feedback__title">
            {{ isCheckingAuth ? '正在恢复会话...' : '正在加载聊天记录...' }}
          </text>
        </view>

        <view v-else-if="loadError && !displayRows.length" class="chat-feedback">
          <text class="chat-feedback__title">{{ loadError }}</text>
          <text class="chat-feedback__action" @tap="handleRetry">重新加载</text>
        </view>

        <view v-else-if="!displayRows.length" class="chat-feedback">
          <text class="chat-feedback__title">还没有消息</text>
          <text class="chat-feedback__desc">和 TA 打个招呼，开始第一句对话吧</text>
        </view>

        <view v-else class="chat-message-list">
          <template v-for="item in displayRows" :key="item.key">
            <view v-if="item.kind === 'time'" class="chat-message-list__time">
              {{ item.label }}
            </view>

            <view v-else-if="item.kind === 'system'" class="chat-message-list__system">
              {{ item.text }}
            </view>

            <view
              v-else
              class="chat-row"
              :class="{ 'chat-row--user': item.isUser }"
            >
              <template v-if="!item.isUser">
                <image
                  v-if="agentAvatar"
                  class="chat-avatar chat-avatar--agent"
                  :src="agentAvatar"
                  mode="aspectFill"
                />
                <view
                  v-else
                  class="chat-avatar chat-avatar--agent chat-avatar--fallback"
                  :class="agentAvatarFallbackClass"
                >
                  {{ agentAvatarFallback }}
                </view>
              </template>

              <view class="chat-bubble" :class="{ 'chat-bubble--user': item.isUser }">
                <text class="chat-bubble__text">{{ item.text }}</text>
              </view>

              <template v-if="item.isUser">
                <image
                  v-if="currentUserAvatar"
                  class="chat-avatar chat-avatar--user"
                  :src="currentUserAvatar"
                  mode="aspectFill"
                />
                <view v-else class="chat-avatar chat-avatar--user chat-avatar--fallback chat-avatar--self">
                  {{ currentUserAvatarFallback }}
                </view>
              </template>
            </view>

            <view
              v-if="item.kind === 'message' && item.isFailed"
              class="chat-message-list__failed"
            >
              发送失败
            </view>
          </template>

          <view id="chat-bottom-anchor" class="chat-message-list__bottom-anchor" />
        </view>
    </view>

    <template #bottom>
      <view class="chat-bottom" :style="composerStyle">
        <view class="chat-composer">
          <view class="chat-composer__icon-button" @tap="handlePendingAction('语音消息')">
            <view class="chat-composer__mic">
              <view class="chat-composer__mic-head" />
              <view class="chat-composer__mic-stem" />
              <view class="chat-composer__mic-base" />
            </view>
          </view>

          <view class="chat-composer__input-shell">
            <input
              :value="draftMessage"
              class="chat-composer__input"
              type="text"
              maxlength="2000"
              confirm-type="send"
              :cursor="draftCursor"
              :adjust-position="false"
              cursor-spacing="16"
              placeholder="微信"
              placeholder-style="color: #999999;"
              @input="handleDraftInput"
              @confirm="handleSend"
              @focus="handleInputFocus"
              @blur="handleInputBlur"
              @keyboardheightchange="handleKeyboardHeightChange"
            />
          </view>

          <view
            class="chat-composer__icon-button"
            :class="{ 'chat-composer__icon-button--selected': isEmojiPanelVisible }"
            @tap="handleEmojiToggle"
          >
            <view class="chat-composer__emoji">
              <view class="chat-composer__emoji-eye chat-composer__emoji-eye--left" />
              <view class="chat-composer__emoji-eye chat-composer__emoji-eye--right" />
              <view class="chat-composer__emoji-mouth" />
            </view>
          </view>

          <view
            v-if="!canSend"
            class="chat-composer__icon-button"
            @tap="handlePendingAction('更多能力')"
          >
            <view class="chat-composer__plus">
              <view class="chat-composer__plus-line chat-composer__plus-line--horizontal" />
              <view class="chat-composer__plus-line chat-composer__plus-line--vertical" />
            </view>
          </view>

          <view
            v-else
            class="chat-composer__send"
            :class="{ 'chat-composer__send--disabled': isSending }"
            @tap="handleSend"
          >
            发送
          </view>
        </view>

        <emoji-picker-panel
          :visible="isEmojiPanelVisible"
          @emoji-select="handleEmojiSelect"
          @backspace="handleEmojiDelete"
        />
      </view>
    </template>
  </page-scaffold>
</template>

<script lang="ts">
export default {
  name: 'ChatIndexPage',
}
</script>

<script setup lang="ts">
import Taro, { useDidHide, useLoad } from '@tarojs/taro'
import { computed, nextTick, ref } from 'vue'
import { ApiException } from '../../api/api-exception'
import {
  getConversationMessages,
  sendConversationMessage,
  type ConversationMessage,
} from '../../apis/conversation'
import BackCapsule from '../../components/back-capsule/back-capsule.vue'
import EmojiPickerPanel from '../../components/emoji-picker-panel/emoji-picker-panel.vue'
import PageScaffold from '../../components/page-scaffold/page-scaffold.vue'
import { authSession, restoreAuthSession } from '../../auth/session'
import { readMenuButtonMetrics } from '../../utils/menu-button'
import { useSafeAreaInsets } from '../../utils/safe-area'

type DisplayRow =
  | {
      key: string
      kind: 'time'
      label: string
    }
  | {
      key: string
      kind: 'system'
      text: string
    }
  | {
      key: string
      kind: 'message'
      text: string
      isUser: boolean
      isFailed: boolean
    }

type NavMenuItem = {
  key: string
  text: string
}

const conversationId = ref('')
const agentName = ref('')
const agentAvatar = ref('')
const agentSex = ref(0)

const isCheckingAuth = ref(true)
const isLoading = ref(true)
const isSending = ref(false)
const loadError = ref('')
const draftMessage = ref('')
const draftCursor = ref(0)
const keyboardHeight = ref(0)
const isInputFocused = ref(false)
const isEmojiPanelVisible = ref(false)
const messages = ref<ConversationMessage[]>([])
const scrollIntoViewTarget = ref('')

let ensureSessionPromise: Promise<void> | null = null
let refreshMessagesPromise: Promise<void> | null = null

const safeAreaInsets = useSafeAreaInsets()
const menuButtonMetrics = readMenuButtonMetrics()
const navStyle = {
  height: `${menuButtonMetrics.totalHeight}px`,
}
const navMenus: NavMenuItem[] = [
  {
    key: 'more-actions',
    text: '更多功能',
  },
]
const pageTitle = computed(() => {
  const trimmedName = agentName.value.trim()
  return trimmedName || '对话'
})
const currentUserAvatar = computed(() => authSession.value?.user.avatar.trim() ?? '')
const currentUserAvatarFallback = computed(() => {
  const name = authSession.value?.user.name.trim()
  return name ? name.slice(0, 1) : '我'
})
const agentAvatarFallback = computed(() => {
  const trimmedName = agentName.value.trim()
  return trimmedName ? trimmedName.slice(0, 1) : 'A'
})
const agentAvatarFallbackClass = computed(() => {
  return agentSex.value === 1
    ? 'chat-avatar--male'
    : 'chat-avatar--female'
})
const composerStyle = computed(() => {
  const basePaddingBottom = isInputFocused.value && keyboardHeight.value > 0
    ? '0px'
    : `${safeAreaInsets.value.bottom}px`

  return {
    paddingBottom: basePaddingBottom,
    transform:
      isInputFocused.value && keyboardHeight.value > 0
        ? `translateY(-${keyboardHeight.value}px)`
        : 'translateY(0)',
  }
})
const bodyPadding = computed(() => {
  const bottomPadding =
    isInputFocused.value && keyboardHeight.value > 0
      ? `${keyboardHeight.value}px`
      : '0px'

  return `0 0 ${bottomPadding} 0`
})
const canSend = computed(() => draftMessage.value.trim().length > 0 && !isSending.value)
const displayRows = computed<DisplayRow[]>(() => {
  const rows: DisplayRow[] = []

  messages.value.forEach((message, messageIndex) => {
    if (shouldShowTimeDivider(message, messages.value[messageIndex - 1])) {
      rows.push({
        key: `time-${message.id}`,
        kind: 'time',
        label: formatMessageTime(message.createdAt ?? message.updatedAt),
      })
    }

    const normalizedText = buildMessageText(message)
    const textSegments =
      message.type === 'text' && message.segments.length
        ? message.segments
        : normalizedText
          ? [normalizedText]
          : []

    if (message.role === 'system') {
      if (normalizedText) {
        rows.push({
          key: `system-${message.id}`,
          kind: 'system',
          text: normalizedText,
        })
      }
      return
    }

    textSegments.forEach((segment, segmentIndex) => {
      rows.push({
        key: `message-${message.id}-${segmentIndex}`,
        kind: 'message',
        text: segment,
        isUser: message.role === 'user',
        isFailed: segmentIndex === textSegments.length - 1 && message.status === 'failed',
      })
    })
  })

  return rows
})

useLoad((options) => {
  conversationId.value = decodeRouteParam(options?.conversationId)
  agentName.value = decodeRouteParam(options?.agentName)
  agentAvatar.value = decodeRouteParam(options?.agentAvatar)
  agentSex.value = Number.parseInt(decodeRouteParam(options?.agentSex), 10) || 0

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

async function redirectToAuth() {
  await Taro.reLaunch({
    url: '/pages/auth/index',
  })
}

async function ensureAuthenticated() {
  if (ensureSessionPromise) {
    return ensureSessionPromise
  }

  ensureSessionPromise = Promise.resolve()
    .then(async () => {
      isCheckingAuth.value = true
      await restoreAuthSession()

      if (!authSession.value) {
        await redirectToAuth()
        return
      }
    })
    .finally(() => {
      ensureSessionPromise = null
      isCheckingAuth.value = false
    })

  return ensureSessionPromise
}

async function preparePage() {
  await ensureAuthenticated()

  if (!authSession.value) {
    return
  }

  if (!conversationId.value) {
    loadError.value = '缺少会话信息，请返回通讯录重新进入'
    isLoading.value = false
    return
  }

  await refreshMessages({ showLoading: true })
}

async function refreshMessages(options: { showLoading?: boolean } = {}) {
  if (refreshMessagesPromise) {
    return refreshMessagesPromise
  }

  if (options.showLoading ?? messages.value.length === 0) {
    isLoading.value = true
  }

  loadError.value = ''

  refreshMessagesPromise = getConversationMessages(conversationId.value)
    .then(async (items) => {
      messages.value = items
      await scrollToBottom()
    })
    .catch(async (error: unknown) => {
      await handleApiError(error, '加载聊天记录失败，请稍后重试')
    })
    .finally(() => {
      isLoading.value = false
      refreshMessagesPromise = null
    })

  return refreshMessagesPromise
}

async function handleApiError(error: unknown, fallbackMessage: string) {
  if (error instanceof ApiException) {
    if (error.requiresReLogin) {
      await redirectToAuth()
      return
    }

    loadError.value = error.message
    return
  }

  loadError.value = fallbackMessage
}

async function scrollToBottom() {
  await nextTick()
  scrollIntoViewTarget.value = ''
  await nextTick()
  await new Promise<void>((resolve) => {
    setTimeout(() => {
      scrollIntoViewTarget.value = 'chat-bottom-anchor'
      resolve()
    }, 0)
  })
}

function buildMessageText(message: ConversationMessage) {
  if (message.type === 'voice') {
    const transcript = message.voice?.transcript?.trim() || message.content.trim()
    if (transcript) {
      return transcript
    }

    return message.voice?.durationMs
      ? `[语音消息 ${formatVoiceDuration(message.voice.durationMs)}]`
      : '[语音消息]'
  }

  if (message.type === 'image') {
    return message.image?.analysis?.trim() || message.content.trim() || '[图片消息]'
  }

  return message.content.trim()
}

function shouldShowTimeDivider(message: ConversationMessage, previous?: ConversationMessage) {
  const currentTime = message.createdAt ?? message.updatedAt
  if (!currentTime) {
    return false
  }

  if (!previous) {
    return true
  }

  const previousTime = previous.createdAt ?? previous.updatedAt
  if (!previousTime) {
    return true
  }

  return currentTime.getTime() - previousTime.getTime() >= 5 * 60 * 1000
}

function formatMessageTime(value: Date | null) {
  if (!value) {
    return ''
  }

  const now = new Date()
  const currentDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const targetDay = new Date(
    value.getFullYear(),
    value.getMonth(),
    value.getDate()
  ).getTime()
  const diffDays = Math.round((currentDay - targetDay) / (24 * 60 * 60 * 1000))
  const hour = String(value.getHours()).padStart(2, '0')
  const minute = String(value.getMinutes()).padStart(2, '0')

  if (diffDays === 0) {
    return `${hour}:${minute}`
  }

  if (diffDays === 1) {
    return `昨天 ${hour}:${minute}`
  }

  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')

  return `${month}-${day} ${hour}:${minute}`
}

function formatVoiceDuration(durationMs: number) {
  const totalSeconds = Math.max(1, Math.round(durationMs / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60

  if (minutes === 0) {
    return `${seconds}秒`
  }

  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

function showToast(title: string) {
  void Taro.showToast({
    title,
    icon: 'none',
    duration: 1800,
  })
}

function handlePendingAction(name: string) {
  showToast(`${name}待接入`)
}

function handleNavMenuSelect(payload: { item: NavMenuItem }) {
  handlePendingAction(payload.item.text)
}

function handleRetry() {
  void refreshMessages({ showLoading: true })
}

function handleDraftInput(event: { detail?: { value?: string } }) {
  const nextValue = event.detail?.value ?? ''
  const nextCursor = (event.detail as { cursor?: number } | undefined)?.cursor

  draftMessage.value = nextValue
  draftCursor.value =
    typeof nextCursor === 'number' && nextCursor >= 0
      ? nextCursor
      : nextValue.length
}

function handleInputFocus() {
  isInputFocused.value = true
  isEmojiPanelVisible.value = false
  void scrollToBottom()
}

function handleInputBlur() {
  isInputFocused.value = false
  keyboardHeight.value = 0
}

function handleKeyboardHeightChange(event: { detail?: { height?: number } }) {
  keyboardHeight.value = event.detail?.height ?? 0

  if (keyboardHeight.value <= 0) {
    isInputFocused.value = false
  }

  void scrollToBottom()
}

useDidHide(() => {
  isInputFocused.value = false
  keyboardHeight.value = 0
  isEmojiPanelVisible.value = false
})

function handleEmojiToggle() {
  isEmojiPanelVisible.value = !isEmojiPanelVisible.value
  if (isEmojiPanelVisible.value) {
    isInputFocused.value = false
    keyboardHeight.value = 0
    void Taro.hideKeyboard()
    void scrollToBottom()
  }
}

function handleEmojiSelect(emoji: string) {
  const cursor = clampCursor(draftCursor.value, draftMessage.value)
  const nextValue =
    draftMessage.value.slice(0, cursor) +
    emoji +
    draftMessage.value.slice(cursor)

  draftMessage.value = nextValue
  draftCursor.value = cursor + emoji.length
  void scrollToBottom()
}

function handleEmojiDelete() {
  const value = draftMessage.value
  if (!value) {
    return
  }

  const cursor = clampCursor(draftCursor.value, value)
  if (cursor <= 0) {
    return
  }

  const left = value.slice(0, cursor)
  const right = value.slice(cursor)
  const nextLeft = removeLastGrapheme(left)

  draftMessage.value = `${nextLeft}${right}`
  draftCursor.value = nextLeft.length
}

function clampCursor(cursor: number, value: string) {
  if (!Number.isFinite(cursor)) {
    return value.length
  }

  return Math.min(Math.max(Math.floor(cursor), 0), value.length)
}

function removeLastGrapheme(value: string) {
  if (!value) {
    return ''
  }

  const chars = Array.from(value)
  const last = chars[chars.length - 1]
  if (last === '\ufe0f' && chars.length > 1) {
    chars.pop()
    chars.pop()
    return chars.join('')
  }

  chars.pop()
  return chars.join('')
}

async function handleSend() {
  const content = draftMessage.value.trim()
  if (!content || isSending.value || !conversationId.value) {
    return
  }

  const tempId = `local-${Date.now()}`
  const originalDraft = draftMessage.value
  const originalDraftCursor = draftCursor.value

  draftMessage.value = ''
  draftCursor.value = 0
  isSending.value = true
  messages.value = [
    ...messages.value,
    {
      id: tempId,
      conversationId: conversationId.value,
      role: 'user',
      type: 'text',
      content,
      segments: [content],
      status: 'sending',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ]
  await scrollToBottom()

  try {
    const result = await sendConversationMessage(conversationId.value, {
      content,
      type: 'text',
    })

    messages.value = messages.value.filter((message) => message.id !== tempId)
    messages.value = [
      ...messages.value,
      result.userMessage,
      ...(result.assistantMessage ? [result.assistantMessage] : []),
    ]
    loadError.value = ''
    await scrollToBottom()
  } catch (error) {
    isSending.value = false

    if (error instanceof ApiException && error.requiresReLogin) {
      await redirectToAuth()
      return
    }

    draftMessage.value = originalDraft
    draftCursor.value = originalDraftCursor
    messages.value = messages.value.map((message) =>
      message.id === tempId
        ? {
            ...message,
            status: 'failed',
          }
        : message
    )
    showToast(error instanceof ApiException ? error.message : '发送失败，请稍后重试')
    await scrollToBottom()
    return
  }

  isSending.value = false
}
</script>

<style lang="scss">
.chat-page {
  min-height: 100vh;
}

.chat-page__nav {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 24px;
  box-sizing: border-box;
  background: #f7f7f7;
  border-bottom: 0.5px solid #d9d9d9;
}

.chat-page__nav-capsule {
  position: absolute;
  z-index: 2;
}

.chat-page__nav-title {
  min-width: 0;
  max-width: calc(100% - 144px);
  text-align: center;
  font-size: 18px;
  line-height: 28px;
  font-weight: 600;
  color: #111111;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chat-page__body {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.chat-page__scroll {
  flex: 1;
  min-height: 0;
}

.chat-feedback {
  min-height: calc(100vh - 220px);
  padding: 80px 32px 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  box-sizing: border-box;
}

.chat-feedback__spinner {
  width: 18px;
  height: 18px;
  border: 2px solid rgba(17, 17, 17, 0.12);
  border-top-color: #111111;
  border-radius: 50%;
  animation: chat-spin 0.8s linear infinite;
}

.chat-feedback__title {
  text-align: center;
  font-size: 15px;
  line-height: 22px;
  color: #344054;
}

.chat-feedback__desc {
  text-align: center;
  font-size: 13px;
  line-height: 20px;
  color: #98a2b3;
}

.chat-feedback__action {
  font-size: 15px;
  line-height: 22px;
  font-weight: 600;
  color: #111111;
}

.chat-message-list {
  display: flex;
  flex-direction: column;
  padding: 0 16px;
  box-sizing: border-box;
}

.chat-message-list__time {
  margin-bottom: 16px;
  text-align: center;
  font-size: 12px;
  line-height: 16px;
  color: #b2b2b2;
}

.chat-message-list__system {
  margin-bottom: 16px;
  text-align: center;
  font-size: 12px;
  line-height: 16px;
  color: #b2b2b2;
}

.chat-message-list__failed {
  margin: -10px 48px 16px 0;
  text-align: right;
  font-size: 11px;
  line-height: 16px;
  font-weight: 500;
  color: #e5484d;
}

.chat-message-list__bottom-anchor {
  margin-top: auto;
  width: 1px;
  height: 1px;
}

.chat-bottom {
  background: #f7f7f7;
  transition: transform 0.2s ease;
}

.chat-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-bottom: 16px;
}

.chat-row--user {
  justify-content: flex-end;
}

.chat-avatar {
  flex-shrink: 0;
  overflow: hidden;
  color: #ffffff;
  font-size: 16px;
  font-weight: 700;
}

.chat-avatar--agent {
  width: 40px;
  height: 40px;
  border-radius: 8px;
  background: #eef2f7;
}

.chat-avatar--user {
  width: 40px;
  height: 40px;
  border-radius: 999px;
  background: #eef2f7;
}

.chat-avatar--fallback {
  display: flex;
  align-items: center;
  justify-content: center;
}

.chat-avatar--self {
  background: linear-gradient(135deg, #ffd28d 0%, #ff9b26 100%);
}

.chat-avatar--male {
  background: linear-gradient(135deg, #b6dbff 0%, #5d8fff 100%);
}

.chat-avatar--female {
  background: linear-gradient(135deg, #ffd9e5 0%, #ff8daa 100%);
}

.chat-bubble {
  max-width: 264px;
  padding: 10px 12px;
  border-radius: 10px;
  background: #ffffff;
  box-sizing: border-box;
}

.chat-bubble--user {
  background: #95ec69;
}

.chat-bubble__text {
  display: block;
  color: #111111;
  font-size: 16px;
  line-height: 22.4px;
  word-break: break-word;
  white-space: pre-wrap;
}

.chat-composer {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 72px;
  padding: 12px;
  box-sizing: border-box;
  background: #f7f7f7;
  border-top: 0.5px solid #d9d9d9;
}

.chat-composer__icon-button {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  flex-shrink: 0;
}

.chat-composer__icon-button--selected .chat-composer__emoji {
  border-color: #07c160;
}

.chat-composer__icon-button--selected .chat-composer__emoji-eye {
  background: #07c160;
}

.chat-composer__icon-button--selected .chat-composer__emoji-mouth {
  border-color: #07c160;
}

.chat-composer__input-shell {
  flex: 1;
  min-width: 0;
  height: 40px;
  padding: 0 12px;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  border: 0.5px solid #e5e5e5;
  border-radius: 10px;
  background: #ffffff;
}

.chat-composer__input {
  flex: 1;
  min-width: 0;
  height: 100%;
  font-size: 15px;
  color: #111111;
}

.chat-composer__send {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 52px;
  height: 32px;
  flex-shrink: 0;
  border-radius: 8px;
  background: #07c160;
  color: #ffffff;
  font-size: 14px;
  line-height: 20px;
  font-weight: 600;
}

.chat-composer__send--disabled {
  opacity: 0.6;
}

.chat-composer__mic,
.chat-composer__emoji,
.chat-composer__plus {
  position: relative;
  width: 28px;
  height: 28px;
}

.chat-composer__mic-head,
.chat-composer__mic-stem,
.chat-composer__mic-base,
.chat-composer__emoji-eye,
.chat-composer__emoji-mouth,
.chat-composer__plus-line {
  position: absolute;
  box-sizing: border-box;
}

.chat-composer__mic-head {
  left: 8px;
  top: 3px;
  width: 12px;
  height: 16px;
  border: 2px solid #5e5e5e;
  border-radius: 10px;
}

.chat-composer__mic-stem {
  left: 13px;
  top: 19px;
  width: 2px;
  height: 5px;
  background: #5e5e5e;
  border-radius: 999px;
}

.chat-composer__mic-base {
  left: 8px;
  top: 23px;
  width: 12px;
  height: 3px;
  border-radius: 999px;
  background: #5e5e5e;
}

.chat-composer__emoji {
  border: 2px solid #5e5e5e;
  border-radius: 50%;
}

.chat-composer__emoji-eye {
  top: 8px;
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: #5e5e5e;
}

.chat-composer__emoji-eye--left {
  left: 7px;
}

.chat-composer__emoji-eye--right {
  right: 7px;
}

.chat-composer__emoji-mouth {
  left: 7px;
  bottom: 6px;
  width: 10px;
  height: 5px;
  border-bottom: 2px solid #5e5e5e;
  border-radius: 0 0 10px 10px;
}

.chat-composer__plus-line {
  left: 50%;
  top: 50%;
  background: #5e5e5e;
  border-radius: 999px;
  transform: translate(-50%, -50%);
}

.chat-composer__plus-line--horizontal {
  width: 18px;
  height: 2px;
}

.chat-composer__plus-line--vertical {
  width: 2px;
  height: 18px;
}

@keyframes chat-spin {
  from {
    transform: rotate(0deg);
  }

  to {
    transform: rotate(360deg);
  }
}
</style>
