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

    <view class="chat-page__body" @tap="handleChatBodyTap">

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
                  @tap.stop="handleAgentAvatarTap"
                />
                <view
                  v-else
                  class="chat-avatar chat-avatar--agent chat-avatar--fallback"
                  :class="agentAvatarFallbackClass"
                  @tap.stop="handleAgentAvatarTap"
                >
                  {{ agentAvatarFallback }}
                </view>
              </template>

              <chat-message-bubble
                :type="item.type"
                :text="item.text"
                :image-url="item.imageUrl"
                :voice-duration-ms="item.voiceDurationMs"
                :is-voice-active="activeVoiceMessageId === item.messageId"
                :is-voice-playing="activeVoiceMessageId === item.messageId && isVoicePlaying"
                :is-voice-loading="activeVoiceMessageId === item.messageId && isVoicePlaybackLoading"
                :is-user="item.isUser"
                :is-sending="item.isSending"
                @voice-tap="handleVoiceMessageTap(item.messageId)"
              />

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
          <view
            class="chat-composer__icon-button"
            :class="{ 'chat-composer__icon-button--selected': isVoiceMode }"
            @tap="handleVoiceModeToggle"
          >
            <view class="chat-composer__mic">
              <view class="chat-composer__mic-head" />
              <view class="chat-composer__mic-stem" />
              <view class="chat-composer__mic-base" />
            </view>
          </view>

          <view
            v-if="isVoiceMode"
            class="chat-composer__voice-button"
            :class="{
              'chat-composer__voice-button--pressing': isVoiceGestureActive,
              'chat-composer__voice-button--loading': isTranscribingVoice,
            }"
            @touchstart="handleVoiceTouchStart"
            @touchmove="handleVoiceTouchMove"
            @touchend="handleVoiceTouchEnd"
            @touchcancel="handleVoiceTouchCancel"
          >
            <view v-if="isTranscribingVoice" class="chat-composer__voice-loading" />
            <text class="chat-composer__voice-button-text">{{ voiceComposerButtonLabel }}</text>
          </view>

          <view v-else class="chat-composer__input-shell">
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
            v-if="!showSendButton"
            class="chat-composer__icon-button"
            :class="{ 'chat-composer__icon-button--selected': isMorePanelVisible }"
            @tap="handleMoreToggle"
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

        <chat-more-panel
          :visible="isMorePanelVisible"
          @action="handleMoreAction"
        />
      </view>
    </template>

    <template #floating>
      <view v-if="isVoiceOverlayVisible" class="voice-recording-overlay">
        <view
          class="voice-recording-overlay__status"
          :class="`voice-recording-overlay__status--${voiceDragTarget}`"
        >
          <view class="voice-recording-overlay__glyph">
            <view v-if="voiceDragTarget === 'cancel'" class="voice-recording-overlay__cancel-icon" />
            <view v-else-if="voiceDragTarget === 'transcribe'" class="voice-recording-overlay__text-icon">文</view>
            <view v-else class="voice-recording-overlay__waveform">
              <view class="voice-recording-overlay__bar voice-recording-overlay__bar--1" />
              <view class="voice-recording-overlay__bar voice-recording-overlay__bar--2" />
              <view class="voice-recording-overlay__bar voice-recording-overlay__bar--3" />
              <view class="voice-recording-overlay__bar voice-recording-overlay__bar--4" />
            </view>
          </view>
          <text class="voice-recording-overlay__status-text">{{ voiceStatusText }}</text>
        </view>
        <view class="voice-recording-overlay__panel" :style="voiceOverlayPanelStyle">
          <view
            class="voice-recording-overlay__chip voice-recording-overlay__chip--cancel"
            :class="{ 'voice-recording-overlay__chip--active-cancel': voiceDragTarget === 'cancel' }"
          >
            取消
          </view>
          <view
            class="voice-recording-overlay__chip voice-recording-overlay__chip--transcribe"
            :class="{ 'voice-recording-overlay__chip--active-transcribe': voiceDragTarget === 'transcribe' }"
          >
            滑到这里 转文字
          </view>
          <text class="voice-recording-overlay__hint">上滑取消，右滑转文字</text>
          <text class="voice-recording-overlay__footer">{{ voiceFooterText }}</text>
        </view>
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
import Taro, { useDidHide, useLoad, useUnload } from '@tarojs/taro'
import type { ITouchEvent } from '@tarojs/components/types/common'
import { computed, nextTick, ref } from 'vue'
import { ApiConfig } from '../../api/api-config'
import { ApiException } from '../../api/api-exception'
import {
  getConversationMessages,
  sendConversationMessage,
  transcribeConversationVoice,
  type ConversationMessage,
  type ConversationImagePayload,
  type ConversationVoicePayload,
} from '../../apis/conversation'
import { uploadLocalFile, uploadLocalImage } from '../../apis/storage'
import BackCapsule from '../../components/back-capsule/back-capsule.vue'
import ChatMessageBubble from '../../components/chat-message-bubble/chat-message-bubble.vue'
import ChatMorePanel from '../../components/chat-more-panel/chat-more-panel.vue'
import {
  isChatImageOperationCanceled,
  pickChatImageForSend,
  type ChatImageSourceType,
  type PickedChatImage,
} from '../../components/chat-more-panel/image'
import type { ChatMoreActionItem } from '../../components/chat-more-panel/types'
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
      messageId: string
      type: 'text' | 'image' | 'voice'
      text: string
      imageUrl: string
      voiceDurationMs: number
      isUser: boolean
      isSending: boolean
      isFailed: boolean
    }

type NavMenuItem = {
  key: string
  text: string
}

type VoiceDragTarget = 'send' | 'cancel' | 'transcribe'

type TouchPoint = {
  x: number
  y: number
}

type RecorderStopResult = {
  tempFilePath: string
  duration: number
  fileSize: number
}

const conversationId = ref('')
const agentId = ref('')
const agentName = ref('')
const agentAvatar = ref('')
const agentSex = ref(0)
const agentCallMe = ref('')
const iCallAgent = ref('')
const conversationPreview = ref('')
const conversationCreatedAt = ref('')

const isCheckingAuth = ref(true)
const isLoading = ref(true)
const isSending = ref(false)
const loadError = ref('')
const draftMessage = ref('')
const draftCursor = ref(0)
const keyboardHeight = ref(0)
const isInputFocused = ref(false)
const isEmojiPanelVisible = ref(false)
const isMorePanelVisible = ref(false)
const isVoiceMode = ref(false)
const isVoicePressPreviewing = ref(false)
const isVoiceRecording = ref(false)
const isTranscribingVoice = ref(false)
const voiceDragTarget = ref<VoiceDragTarget>('send')
const voiceGestureStartPoint = ref<TouchPoint | null>(null)
const recordingStartedAt = ref<number | null>(null)
const activeVoiceMessageId = ref('')
const isVoicePlaying = ref(false)
const isVoicePlaybackLoading = ref(false)
const messages = ref<ConversationMessage[]>([])
const scrollIntoViewTarget = ref('')

let ensureSessionPromise: Promise<void> | null = null
let refreshMessagesPromise: Promise<void> | null = null
let voiceStartTimer: ReturnType<typeof setTimeout> | null = null
let pendingRecorderStop:
  | {
      resolve: (result: RecorderStopResult) => void
      reject: (error: unknown) => void
    }
  | null = null
let lastRecorderStopResult: RecorderStopResult | null = null
let voiceAudioContext: Taro.InnerAudioContext | null = null
let isPickingChatImage = false
let voicePlaybackErrorMutedUntil = 0
let isSwitchingComposerPanel = false
const voiceDurationProbeContexts = new Map<string, Taro.InnerAudioContext>()

const recorderManager = Taro.getRecorderManager()

recorderManager.onStop((result) => {
  const normalizedResult = {
    tempFilePath: result.tempFilePath,
    duration: result.duration,
    fileSize: result.fileSize,
  }

  if (pendingRecorderStop) {
    pendingRecorderStop.resolve(normalizedResult)
    pendingRecorderStop = null
    return
  }

  lastRecorderStopResult = normalizedResult
})

recorderManager.onError((error) => {
  if (pendingRecorderStop) {
    pendingRecorderStop.reject(error)
    pendingRecorderStop = null
  }
})

const safeAreaInsets = useSafeAreaInsets()
const menuButtonMetrics = readMenuButtonMetrics()
const navStyle = {
  height: `${menuButtonMetrics.totalHeight}px`,
  paddingTop: `${menuButtonMetrics.statusBarHeight}px`,
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
const canSend = computed(() => {
  return draftMessage.value.trim().length > 0 && !isSending.value && !isTranscribingVoice.value
})
const showSendButton = computed(() => canSend.value && !isVoiceMode.value)
const isVoiceGestureActive = computed(() => {
  return isVoicePressPreviewing.value || isVoiceRecording.value
})
const isVoiceOverlayVisible = computed(() => isVoiceMode.value && isVoiceGestureActive.value)
const voiceComposerButtonLabel = computed(() => {
  if (isTranscribingVoice.value) {
    return '转文字中...'
  }

  if (voiceDragTarget.value === 'cancel' && isVoiceGestureActive.value) {
    return '松开 取消'
  }

  if (voiceDragTarget.value === 'transcribe' && isVoiceGestureActive.value) {
    return '松开 转文字'
  }

  return isVoiceGestureActive.value ? '松开 发送' : '按住 说话'
})
const voiceStatusText = computed(() => {
  if (voiceDragTarget.value === 'cancel') {
    return '松开取消'
  }

  if (voiceDragTarget.value === 'transcribe') {
    return '松开转文字'
  }

  return '松开发送'
})
const voiceFooterText = computed(() => {
  if (voiceDragTarget.value === 'cancel') {
    return '松开 取消'
  }

  if (voiceDragTarget.value === 'transcribe') {
    return '松开 转文字'
  }

  return '松开 发送'
})
const voiceOverlayPanelStyle = computed(() => {
  return {
    paddingBottom: `${safeAreaInsets.value.bottom}px`,
  }
})
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

    if (message.type === 'image' && message.role !== 'system') {
      rows.push({
        key: `message-${message.id}-image`,
        kind: 'message',
        messageId: message.id,
        type: 'image',
        text: normalizedText,
        imageUrl: resolveImageMessageUrl(message.image),
        voiceDurationMs: 0,
        isUser: message.role === 'user',
        isSending: message.status === 'sending',
        isFailed: message.status === 'failed',
      })
      return
    }

    if (message.type === 'voice' && message.role !== 'system') {
      rows.push({
        key: `message-${message.id}-voice`,
        kind: 'message',
        messageId: message.id,
        type: 'voice',
        text: normalizedText,
        imageUrl: '',
        voiceDurationMs: message.voice?.durationMs ?? 1000,
        isUser: message.role === 'user',
        isSending: message.status === 'sending',
        isFailed: message.status === 'failed',
      })
      return
    }

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
        messageId: message.id,
        type: 'text',
        text: segment,
        imageUrl: '',
        voiceDurationMs: 0,
        isUser: message.role === 'user',
        isSending: message.status === 'sending',
        isFailed: segmentIndex === textSegments.length - 1 && message.status === 'failed',
      })
    })
  })

  return rows
})

useLoad((options) => {
  conversationId.value = decodeRouteParam(options?.conversationId)
  agentId.value = decodeRouteParam(options?.agentId)
  agentName.value = decodeRouteParam(options?.agentName)
  agentAvatar.value = decodeRouteParam(options?.agentAvatar)
  agentSex.value = Number.parseInt(decodeRouteParam(options?.agentSex), 10) || 0
  agentCallMe.value = decodeRouteParam(options?.agentCallMe)
  iCallAgent.value = decodeRouteParam(options?.iCallAgent)
  conversationPreview.value = decodeRouteParam(options?.preview)
  conversationCreatedAt.value = decodeRouteParam(options?.createdAt)

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
      probeMissingAssistantVoiceDurations(items)
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

function resolveImageMessageUrl(image?: ConversationImagePayload) {
  const directUrl = image?.url?.trim()
  if (directUrl) {
    return directUrl
  }

  const objectKey = image?.objectKey?.trim()
  if (!objectKey || !ApiConfig.mediaBaseUrl) {
    return ''
  }

  const encodedKey = objectKey
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')

  return `${ApiConfig.mediaBaseUrl}/${encodedKey}`
}

function resolveVoiceMessageUrl(voice?: ConversationVoicePayload) {
  const directUrl = voice?.url?.trim()
  if (directUrl) {
    return directUrl
  }

  const objectKey = voice?.objectKey?.trim()
  if (!objectKey || !ApiConfig.mediaBaseUrl) {
    return ''
  }

  const encodedKey = objectKey
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')

  return `${ApiConfig.mediaBaseUrl}/${encodedKey}`
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

function handleAgentAvatarTap() {
  if (!agentId.value) {
    showToast('缺少联系人资料，请从通讯录重新进入')
    return
  }

  const query = [
    ['agentId', agentId.value],
    ['agentName', pageTitle.value],
    ['agentAvatar', agentAvatar.value],
    ['agentSex', String(agentSex.value)],
    ['agentCallMe', agentCallMe.value],
    ['iCallAgent', iCallAgent.value],
    ['preview', conversationPreview.value],
    ['createdAt', conversationCreatedAt.value],
  ]
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&')

  void Taro.navigateTo({
    url: `/pages/agent-detail/index?${query}`,
  })
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
  isMorePanelVisible.value = false
  void scrollToBottom()
}

function handleInputBlur() {
  isInputFocused.value = false
  keyboardHeight.value = 0
  if (isSwitchingComposerPanel) {
    return
  }

  hideComposerPanels()
}

function handleChatBodyTap() {
  hideComposerPanels()
}

function hideComposerPanels() {
  isEmojiPanelVisible.value = false
  isMorePanelVisible.value = false
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
  isMorePanelVisible.value = false
  clearVoiceStartTimer()
  if (isVoiceRecording.value) {
    void finishVoiceGesture({ cancelledBySystem: true })
  } else {
    resetVoiceGestureState()
  }
  stopVoicePlayback()
})

useUnload(() => {
  clearVoiceStartTimer()
  if (isVoiceRecording.value) {
    try {
      recorderManager.stop()
    } catch {}
  }
  destroyVoiceAudioContext()
})

function handleVoiceModeToggle() {
  if (isSending.value || isTranscribingVoice.value || isVoiceGestureActive.value) {
    return
  }

  isVoiceMode.value = !isVoiceMode.value
  isEmojiPanelVisible.value = false
  isMorePanelVisible.value = false
  isInputFocused.value = false
  keyboardHeight.value = 0
  void Taro.hideKeyboard()
  void scrollToBottom()
}

function handleVoiceTouchStart(event: ITouchEvent) {
  if (
    !isVoiceMode.value ||
    isSending.value ||
    isTranscribingVoice.value ||
    isVoiceGestureActive.value
  ) {
    return
  }

  const point = getTouchPoint(event)
  if (!point) {
    return
  }

  event.preventDefault?.()
  isEmojiPanelVisible.value = false
  isMorePanelVisible.value = false
  isInputFocused.value = false
  keyboardHeight.value = 0
  voiceGestureStartPoint.value = point
  voiceDragTarget.value = 'send'
  isVoicePressPreviewing.value = true
  void Taro.hideKeyboard()

  clearVoiceStartTimer()
  voiceStartTimer = setTimeout(() => {
    voiceStartTimer = null
    void startVoiceRecording()
  }, 350)
}

function handleVoiceTouchMove(event: ITouchEvent) {
  if (!isVoiceGestureActive.value) {
    return
  }

  const point = getTouchPoint(event)
  if (!point) {
    return
  }

  event.preventDefault?.()
  voiceDragTarget.value = resolveVoiceDragTarget(point)
}

function handleVoiceTouchEnd(event: ITouchEvent) {
  if (!isVoiceGestureActive.value) {
    return
  }

  event.preventDefault?.()
  const point = getTouchPoint(event)
  if (point) {
    voiceDragTarget.value = resolveVoiceDragTarget(point)
  }

  if (!isVoiceRecording.value) {
    clearVoiceStartTimer()
    resetVoiceGestureState()
    return
  }

  void finishVoiceGesture()
}

function handleVoiceTouchCancel() {
  if (!isVoiceGestureActive.value) {
    return
  }

  clearVoiceStartTimer()
  if (isVoiceRecording.value) {
    void finishVoiceGesture({ cancelledBySystem: true })
    return
  }

  resetVoiceGestureState()
}

function getTouchPoint(event: ITouchEvent): TouchPoint | null {
  const touch = event.touches?.[0] ?? event.changedTouches?.[0]
  if (!touch) {
    return null
  }

  return {
    x: touch.clientX,
    y: touch.clientY,
  }
}

function clearVoiceStartTimer() {
  if (!voiceStartTimer) {
    return
  }

  clearTimeout(voiceStartTimer)
  voiceStartTimer = null
}

function resetVoiceGestureState() {
  isVoicePressPreviewing.value = false
  isVoiceRecording.value = false
  voiceDragTarget.value = 'send'
  voiceGestureStartPoint.value = null
  recordingStartedAt.value = null
}

async function ensureRecordPermission() {
  try {
    const setting = await Taro.getSetting()
    const authSetting = setting.authSetting as Record<string, boolean | undefined>

    if (authSetting['scope.record']) {
      return true
    }

    if (authSetting['scope.record'] === false) {
      showToast('请在设置中开启麦克风权限')
      void Taro.openSetting()
      return false
    }

    await Taro.authorize({ scope: 'scope.record' })
    return true
  } catch {
    showToast('请先开启麦克风权限')
    return false
  }
}

async function startVoiceRecording() {
  if (
    !isVoicePressPreviewing.value ||
    isVoiceRecording.value ||
    isSending.value ||
    isTranscribingVoice.value
  ) {
    return
  }

  const hasPermission = await ensureRecordPermission()
  if (!hasPermission || !isVoicePressPreviewing.value) {
    resetVoiceGestureState()
    return
  }

  try {
    lastRecorderStopResult = null
    recorderManager.start({
      duration: 600000,
      sampleRate: 44100,
      numberOfChannels: 1,
      encodeBitRate: 128000,
      format: 'aac',
      audioSource: 'auto',
    })
    recordingStartedAt.value = Date.now()
    isVoicePressPreviewing.value = false
    isVoiceRecording.value = true
  } catch {
    resetVoiceGestureState()
    showToast('录音启动失败，请稍后重试')
  }
}

function stopRecorder() {
  return new Promise<RecorderStopResult>((resolve, reject) => {
    if (lastRecorderStopResult) {
      const result = lastRecorderStopResult
      lastRecorderStopResult = null
      resolve(result)
      return
    }

    pendingRecorderStop = { resolve, reject }
    try {
      recorderManager.stop()
    } catch (error) {
      pendingRecorderStop = null
      reject(error)
    }
  })
}

async function finishVoiceGesture(options: { cancelledBySystem?: boolean } = {}) {
  if (!isVoiceRecording.value) {
    return
  }

  const target = voiceDragTarget.value
  const startedAt = recordingStartedAt.value
  const shouldTranscribe = !options.cancelledBySystem && target === 'transcribe'
  resetVoiceGestureState()
  if (shouldTranscribe) {
    isTranscribingVoice.value = true
  }

  let recorded: RecorderStopResult | null = null
  try {
    recorded = await stopRecorder()
  } catch {
    recorded = null
  }

  const filePath = recorded?.tempFilePath?.trim() ?? ''
  if (options.cancelledBySystem || target === 'cancel') {
    showToast('已取消录音')
    return
  }

  if (!filePath) {
    if (shouldTranscribe) {
      isTranscribingVoice.value = false
    }
    showToast('录音失败，请稍后重试')
    return
  }

  const durationMs =
    recorded?.duration && recorded.duration > 0
      ? recorded.duration
      : startedAt
        ? Date.now() - startedAt
        : 0

  if (durationMs < 500) {
    if (shouldTranscribe) {
      isTranscribingVoice.value = false
    }
    showToast('说话时间太短')
    return
  }

  if (target === 'transcribe') {
    await sendVoiceTranscription(filePath)
    return
  }

  await sendVoiceMessage(filePath, durationMs)
}

function resolveVoiceDragTarget(point: TouchPoint): VoiceDragTarget {
  const windowInfo = Taro.getWindowInfo()
  const safeBottom = safeAreaInsets.value.bottom
  const chipTop = windowInfo.windowHeight - safeBottom - 220
  const chipBottom = windowInfo.windowHeight - safeBottom - 72
  const isInChipBand = point.y >= chipTop && point.y <= chipBottom
  const horizontalDeadZone = 24

  if (isInChipBand && point.x >= windowInfo.windowWidth / 2 + horizontalDeadZone) {
    return 'transcribe'
  }

  if (isInChipBand && point.x <= windowInfo.windowWidth / 2 - horizontalDeadZone) {
    return 'cancel'
  }

  const startPoint = voiceGestureStartPoint.value
  if (!startPoint) {
    return 'send'
  }

  const deltaX = point.x - startPoint.x
  const deltaY = point.y - startPoint.y

  if (deltaY < -72) {
    return 'cancel'
  }

  if (Math.abs(deltaX) >= 72 && Math.abs(deltaY) <= 160) {
    return deltaX > 0 ? 'transcribe' : 'cancel'
  }

  return 'send'
}

function handleEmojiToggle() {
  markComposerPanelSwitching()
  isEmojiPanelVisible.value = !isEmojiPanelVisible.value
  if (isEmojiPanelVisible.value) {
    isMorePanelVisible.value = false
    isInputFocused.value = false
    keyboardHeight.value = 0
    void Taro.hideKeyboard()
    void scrollToBottom()
  }
}

function handleMoreToggle() {
  markComposerPanelSwitching()
  isMorePanelVisible.value = !isMorePanelVisible.value
  if (isMorePanelVisible.value) {
    isEmojiPanelVisible.value = false
    isInputFocused.value = false
    keyboardHeight.value = 0
    void Taro.hideKeyboard()
    void scrollToBottom()
  }
}

function markComposerPanelSwitching() {
  isSwitchingComposerPanel = true
  setTimeout(() => {
    isSwitchingComposerPanel = false
  }, 120)
}

function handleMoreAction(item: ChatMoreActionItem) {
  const action = item.key

  if (action === 'photo') {
    void pickAndSendImage('album')
    return
  }

  if (action === 'camera') {
    void pickAndSendImage('camera')
    return
  }

  handlePendingAction(item.label)
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
  if (!content || isSending.value || isTranscribingVoice.value || !conversationId.value) {
    return
  }

  const originalDraft = draftMessage.value
  const originalDraftCursor = draftCursor.value

  draftMessage.value = ''
  draftCursor.value = 0
  await sendTextMessageContent(content, {
    restoreDraft: originalDraft,
    restoreCursor: originalDraftCursor,
  })
}

async function sendTextMessageContent(
  content: string,
  options: { restoreDraft?: string; restoreCursor?: number } = {},
) {
  const tempId = `local-${Date.now()}`

  isSending.value = true
  isMorePanelVisible.value = false
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
    if (result.assistantMessage) {
      probeMissingAssistantVoiceDurations([result.assistantMessage])
    }
    loadError.value = ''
    await scrollToBottom()
  } catch (error) {
    isSending.value = false

    if (error instanceof ApiException && error.requiresReLogin) {
      isSending.value = false
      await redirectToAuth()
      return
    }

    if (typeof options.restoreDraft === 'string') {
      draftMessage.value = options.restoreDraft
      draftCursor.value = options.restoreCursor ?? options.restoreDraft.length
    }
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

async function pickAndSendImage(sourceType: ChatImageSourceType) {
  if (isSending.value || isTranscribingVoice.value || !conversationId.value) {
    return
  }

  isPickingChatImage = true
  voicePlaybackErrorMutedUntil = Date.now() + 3000
  destroyVoiceAudioContext()

  try {
    const pickedImage = await pickChatImageForSend(sourceType)
    if (!pickedImage) {
      return
    }

    await sendImageMessage(pickedImage)
  } catch (error) {
    if (isChatImageOperationCanceled(error)) {
      return
    }

    if (error instanceof ApiException && error.requiresReLogin) {
      await redirectToAuth()
      return
    }

    showToast(error instanceof ApiException ? error.message : '选择图片失败，请稍后重试')
  } finally {
    isPickingChatImage = false
  }
}

async function sendImageMessage(image: PickedChatImage) {
  const sourcePath = image.filePath.trim()
  if (!sourcePath || isSending.value || !conversationId.value) {
    return
  }

  const fileName = image.fileName
  const mimeType = image.mimeType
  const tempId = `local-image-${Date.now()}`
  const now = new Date()

  isSending.value = true
  isMorePanelVisible.value = false
  messages.value = [
    ...messages.value,
    {
      id: tempId,
      conversationId: conversationId.value,
      role: 'user',
      type: 'image',
      content: '[图片]',
      segments: [],
      status: 'sending',
      image: {
        url: sourcePath,
        mimeType,
      },
      createdAt: now,
      updatedAt: now,
    },
  ]
  await scrollToBottom()

  try {
    const uploaded = await uploadLocalImage(sourcePath, {
      folder: 'conversation-images',
      fileName,
    })

    messages.value = messages.value.map((message) =>
      message.id === tempId
        ? {
            ...message,
            status: 'sent',
            image: {
              objectKey: uploaded.objectKey,
              url: sourcePath,
              mimeType,
            },
          }
        : message
    )

    const result = await sendConversationMessage(conversationId.value, {
      type: 'image',
      objectKey: uploaded.objectKey,
      mimeType,
    })

    messages.value = messages.value.filter((message) => message.id !== tempId)
    messages.value = [
      ...messages.value,
      result.userMessage,
      ...(result.assistantMessage ? [result.assistantMessage] : []),
    ]
    if (result.assistantMessage) {
      probeMissingAssistantVoiceDurations([result.assistantMessage])
    }
    loadError.value = ''
    await scrollToBottom()
  } catch (error) {
    if (error instanceof ApiException && error.requiresReLogin) {
      await redirectToAuth()
      return
    }

    messages.value = messages.value.map((message) =>
      message.id === tempId
        ? {
            ...message,
            status: 'failed',
          }
        : message
    )
    showToast(error instanceof ApiException ? error.message : '发送图片失败，请稍后重试')
    await scrollToBottom()
  } finally {
    isSending.value = false
  }
}

async function sendVoiceMessage(filePath: string, durationMs: number) {
  const sourcePath = filePath.trim()
  if (!sourcePath || isSending.value || !conversationId.value) {
    return
  }

  const mimeType = 'audio/aac'
  const tempId = `local-voice-${Date.now()}`
  const now = new Date()

  isSending.value = true
  isMorePanelVisible.value = false
  messages.value = [
    ...messages.value,
    {
      id: tempId,
      conversationId: conversationId.value,
      role: 'user',
      type: 'voice',
      content: '[语音]',
      segments: [],
      status: 'sending',
      voice: {
        url: sourcePath,
        mimeType,
        durationMs,
      },
      createdAt: now,
      updatedAt: now,
    },
  ]
  await scrollToBottom()

  try {
    const uploaded = await uploadLocalFile(sourcePath, {
      folder: 'conversation-voice',
      fileName: `voice_${Date.now()}.aac`,
      contentType: mimeType,
    })

    messages.value = messages.value.map((message) =>
      message.id === tempId
        ? {
            ...message,
            status: 'sent',
            voice: {
              objectKey: uploaded.objectKey,
              url: sourcePath,
              mimeType,
              durationMs,
            },
          }
        : message
    )

    const result = await sendConversationMessage(conversationId.value, {
      type: 'voice',
      objectKey: uploaded.objectKey,
      mimeType,
      durationMs,
    })

    messages.value = messages.value.filter((message) => message.id !== tempId)
    messages.value = [
      ...messages.value,
      result.userMessage,
      ...(result.assistantMessage ? [result.assistantMessage] : []),
    ]
    if (result.assistantMessage) {
      probeMissingAssistantVoiceDurations([result.assistantMessage])
    }
    loadError.value = ''
    await scrollToBottom()
  } catch (error) {
    if (error instanceof ApiException && error.requiresReLogin) {
      await redirectToAuth()
      return
    }

    messages.value = messages.value.map((message) =>
      message.id === tempId
        ? {
            ...message,
            status: 'failed',
          }
        : message
    )
    showToast(error instanceof ApiException ? error.message : '发送语音失败，请稍后重试')
    await scrollToBottom()
  } finally {
    isSending.value = false
  }
}

async function sendVoiceTranscription(filePath: string) {
  const sourcePath = filePath.trim()
  if (!sourcePath || isSending.value || !conversationId.value) {
    return
  }

  const mimeType = 'audio/aac'

  isSending.value = true
  isTranscribingVoice.value = true
  try {
    const uploaded = await uploadLocalFile(sourcePath, {
      folder: 'conversation-voice',
      fileName: `voice_${Date.now()}.aac`,
      contentType: mimeType,
    })
    const transcript = await transcribeConversationVoice(conversationId.value, {
      objectKey: uploaded.objectKey,
      mimeType,
    })
    const content = transcript.trim()

    isSending.value = false
    isTranscribingVoice.value = false
    if (!content) {
      showToast('暂未识别到语音内容')
      return
    }

    await sendTextMessageContent(content)
  } catch (error) {
    isSending.value = false
    isTranscribingVoice.value = false
    if (error instanceof ApiException && error.requiresReLogin) {
      await redirectToAuth()
      return
    }

    showToast(error instanceof ApiException ? error.message : '语音转文字失败，请稍后重试')
  }
}

function handleVoiceMessageTap(messageId: string) {
  const message = messages.value.find((item) => item.id === messageId)
  if (!message || message.type !== 'voice') {
    return
  }

  const sourceUrl = resolveVoiceMessageUrl(message.voice)
  if (!sourceUrl) {
    showToast('语音文件不可用')
    return
  }

  voicePlaybackErrorMutedUntil = 0
  const audio = ensureVoiceAudioContext()

  if (activeVoiceMessageId.value === messageId) {
    if (isVoicePlaying.value) {
      audio.pause()
      return
    }

    audio.play()
    return
  }

  try {
    audio.stop()
  } catch {}

  activeVoiceMessageId.value = messageId
  isVoicePlaybackLoading.value = true
  isVoicePlaying.value = false
  audio.src = sourceUrl
  syncActiveVoiceDuration()
  audio.play()
}

function updateVoiceMessageDuration(messageId: string, durationMs: number) {
  if (!messageId || !Number.isFinite(durationMs) || durationMs <= 0) {
    return
  }

  const normalizedDurationMs = Math.round(durationMs)

  messages.value = messages.value.map((message) => {
    if (message.id !== messageId || message.type !== 'voice' || !message.voice) {
      return message
    }

    if ((message.voice.durationMs ?? 0) > 0) {
      return message
    }

    return {
      ...message,
      voice: {
        ...message.voice,
        durationMs: normalizedDurationMs,
      },
    }
  })
}

function syncActiveVoiceDuration() {
  if (!voiceAudioContext || !activeVoiceMessageId.value) {
    return
  }

  const durationSeconds = voiceAudioContext.duration
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return
  }

  updateVoiceMessageDuration(activeVoiceMessageId.value, durationSeconds * 1000)
}

function probeMissingAssistantVoiceDurations(items: ConversationMessage[]) {
  items.forEach((message) => {
    if (
      message.role !== 'assistant' ||
      message.type !== 'voice' ||
      message.status === 'sending' ||
      (message.voice?.durationMs ?? 0) > 0 ||
      voiceDurationProbeContexts.has(message.id)
    ) {
      return
    }

    const sourceUrl = resolveVoiceMessageUrl(message.voice)
    if (!sourceUrl) {
      return
    }

    const audio = Taro.createInnerAudioContext()
    voiceDurationProbeContexts.set(message.id, audio)

    const cleanup = () => {
      const cachedAudio = voiceDurationProbeContexts.get(message.id)
      if (cachedAudio !== audio) {
        return
      }

      voiceDurationProbeContexts.delete(message.id)
      try {
        audio.destroy()
      } catch {}
    }
    const syncDuration = () => {
      const durationSeconds = audio.duration
      if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
        return
      }

      updateVoiceMessageDuration(message.id, durationSeconds * 1000)
      cleanup()
    }

    audio.onCanplay(() => {
      setTimeout(syncDuration, 80)
      setTimeout(syncDuration, 500)
    })
    audio.onError(cleanup)
    audio.src = sourceUrl
    setTimeout(cleanup, 5000)
  })
}

function ensureVoiceAudioContext() {
  if (voiceAudioContext) {
    return voiceAudioContext
  }

  const audio = Taro.createInnerAudioContext()
  audio.obeyMuteSwitch = false
  audio.onCanplay(() => {
    setTimeout(syncActiveVoiceDuration, 80)
    setTimeout(syncActiveVoiceDuration, 500)
  })
  audio.onPlay(() => {
    syncActiveVoiceDuration()
    isVoicePlaybackLoading.value = false
    isVoicePlaying.value = true
  })
  audio.onTimeUpdate(syncActiveVoiceDuration)
  audio.onPause(() => {
    isVoicePlaying.value = false
  })
  audio.onStop(() => {
    isVoicePlaying.value = false
    isVoicePlaybackLoading.value = false
  })
  audio.onEnded(() => {
    isVoicePlaying.value = false
    isVoicePlaybackLoading.value = false
    activeVoiceMessageId.value = ''
  })
  audio.onError(() => {
    isVoicePlaying.value = false
    isVoicePlaybackLoading.value = false
    activeVoiceMessageId.value = ''
    if (isPickingChatImage || Date.now() < voicePlaybackErrorMutedUntil) {
      return
    }
    showToast('语音播放失败，请稍后重试')
  })
  voiceAudioContext = audio

  return audio
}

function stopVoicePlayback() {
  if (!voiceAudioContext) {
    return
  }

  try {
    voiceAudioContext.stop()
  } catch {}
  activeVoiceMessageId.value = ''
  isVoicePlaying.value = false
  isVoicePlaybackLoading.value = false
}

function destroyVoiceAudioContext() {
  if (!voiceAudioContext) {
    destroyVoiceDurationProbeContexts()
    return
  }

  try {
    voiceAudioContext.destroy()
  } catch {}
  voiceAudioContext = null
  activeVoiceMessageId.value = ''
  isVoicePlaying.value = false
  isVoicePlaybackLoading.value = false
  destroyVoiceDurationProbeContexts()
}

function destroyVoiceDurationProbeContexts() {
  voiceDurationProbeContexts.forEach((audio) => {
    try {
      audio.destroy()
    } catch {}
  })
  voiceDurationProbeContexts.clear()
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

.chat-composer__icon-button--selected .chat-composer__plus-line {
  background: #07c160;
}

.chat-composer__icon-button--selected .chat-composer__mic-head {
  border-color: #07c160;
}

.chat-composer__icon-button--selected .chat-composer__mic-stem,
.chat-composer__icon-button--selected .chat-composer__mic-base {
  background: #07c160;
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

.chat-composer__voice-button {
  flex: 1;
  min-width: 0;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 0.5px solid #e5e5e5;
  border-radius: 10px;
  background: #ffffff;
  color: #111111;
  font-size: 15px;
  line-height: 22px;
  font-weight: 500;
  box-sizing: border-box;
}

.chat-composer__voice-button--loading {
  border-color: rgba(7, 193, 96, 0.28);
  background: #eaf9f0;
  color: #078c49;
  font-weight: 600;
}

.chat-composer__voice-button--pressing {
  border-color: #bcbcbc;
  background: #e2e2e2;
  font-weight: 600;
}

.chat-composer__voice-loading {
  width: 14px;
  height: 14px;
  border: 2px solid rgba(7, 193, 96, 0.18);
  border-top-color: #07c160;
  border-radius: 50%;
  animation: chat-spin 0.8s linear infinite;
  box-sizing: border-box;
}

.chat-composer__voice-button-text {
  font-size: inherit;
  line-height: inherit;
  font-weight: inherit;
  color: inherit;
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

.voice-recording-overlay {
  position: fixed;
  inset: 0;
  z-index: 200;
  pointer-events: none;
  background: linear-gradient(180deg, rgba(0, 0, 0, 0.07) 0%, rgba(0, 0, 0, 0.66) 100%);
}

.voice-recording-overlay__status {
  position: absolute;
  top: 36%;
  left: 50%;
  width: 178px;
  height: 104px;
  padding: 16px 18px 14px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  border-radius: 18px;
  background: #39c779;
  box-shadow: 0 10px 20px rgba(0, 0, 0, 0.16);
  box-sizing: border-box;
  transform: translateX(-50%);
}

.voice-recording-overlay__status--cancel {
  background: #e95c4b;
}

.voice-recording-overlay__status--transcribe {
  background: #22b983;
}

.voice-recording-overlay__glyph {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.voice-recording-overlay__status-text {
  margin-top: 8px;
  color: #ffffff;
  font-size: 15px;
  line-height: 22px;
  font-weight: 600;
}

.voice-recording-overlay__waveform {
  display: flex;
  align-items: center;
  gap: 5px;
  height: 34px;
}

.voice-recording-overlay__bar {
  width: 5px;
  border-radius: 999px;
  background: #ffffff;
  animation: voice-recording-wave 0.88s ease-in-out infinite;
}

.voice-recording-overlay__bar--1 {
  height: 16px;
}

.voice-recording-overlay__bar--2 {
  height: 28px;
  animation-delay: 0.12s;
}

.voice-recording-overlay__bar--3 {
  height: 22px;
  animation-delay: 0.24s;
}

.voice-recording-overlay__bar--4 {
  height: 32px;
  animation-delay: 0.36s;
}

.voice-recording-overlay__cancel-icon {
  position: relative;
  width: 36px;
  height: 36px;
  border: 3px solid #ffffff;
  border-radius: 50%;
  box-sizing: border-box;
}

.voice-recording-overlay__cancel-icon::before,
.voice-recording-overlay__cancel-icon::after {
  content: '';
  position: absolute;
  left: 8px;
  top: 15px;
  width: 15px;
  height: 3px;
  border-radius: 999px;
  background: #ffffff;
}

.voice-recording-overlay__cancel-icon::before {
  transform: rotate(45deg);
}

.voice-recording-overlay__cancel-icon::after {
  transform: rotate(-45deg);
}

.voice-recording-overlay__text-icon {
  width: 38px;
  height: 38px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 2px solid #ffffff;
  border-radius: 12px;
  color: #ffffff;
  font-size: 22px;
  line-height: 30px;
  font-weight: 700;
  box-sizing: border-box;
}

.voice-recording-overlay__panel {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  height: 188px;
  box-sizing: content-box;
}

.voice-recording-overlay__panel::before {
  content: '';
  position: absolute;
  right: -16%;
  bottom: -108px;
  left: -16%;
  height: 196px;
  border-radius: 50% 50% 0 0 / 62% 62% 0 0;
  background: #ffffff;
}

.voice-recording-overlay__chip {
  position: absolute;
  bottom: 102px;
  width: 44%;
  max-width: 174px;
  height: 70px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.94);
  color: #344054;
  font-size: 15px;
  line-height: 22px;
  font-weight: 600;
  box-shadow: 0 8px 18px rgba(0, 0, 0, 0.12);
  box-sizing: border-box;
}

.voice-recording-overlay__chip--cancel {
  left: 8px;
  transform: rotate(-6deg);
}

.voice-recording-overlay__chip--transcribe {
  right: 8px;
  transform: rotate(6deg);
}

.voice-recording-overlay__chip--active-cancel {
  background: #e95c4b;
  color: #ffffff;
}

.voice-recording-overlay__chip--active-transcribe {
  background: #07c160;
  color: #ffffff;
}

.voice-recording-overlay__hint,
.voice-recording-overlay__footer {
  position: absolute;
  right: 0;
  left: 0;
  text-align: center;
}

.voice-recording-overlay__hint {
  bottom: 78px;
  color: rgba(255, 255, 255, 0.9);
  font-size: 14px;
  line-height: 20px;
  font-weight: 500;
}

.voice-recording-overlay__footer {
  bottom: 24px;
  color: #111111;
  font-size: 16px;
  line-height: 22px;
  font-weight: 600;
}

@keyframes voice-recording-wave {
  0%,
  100% {
    transform: scaleY(0.65);
  }

  50% {
    transform: scaleY(1);
  }
}
</style>
