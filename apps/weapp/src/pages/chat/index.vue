<template>
  <page-scaffold
    class="chat-page"
    background="#ededed"
    header-background="#f7f7f7"
    bottom-background="#f7f7f7"
    :body-padding="bodyPadding"
    :scroll="true"
    :scroll-into-view="scrollIntoViewTarget"
    :scroll-with-animation="scrollWithAnimation"
    :show-scrollbar="false"
    :safe-area-top="false"
    :safe-area-bottom="false"
    @scroll-to-upper="handleChatScrollToUpper"
  >
    <template #header>
      <view class="chat-page__nav" :style="navStyle">
        <back-capsule
          class="chat-page__nav-capsule"
          :menus="[]"
          back-home-url="/pages/index/index"
          @menu-select="handleNavMenuSelect"
        >
          <template #menu-icon>
            <Category color="#000" size="14"></Category>
          </template>
        </back-capsule>
        <text class="chat-page__nav-title">{{ pageTitle }}</text>
      </view>
    </template>

    <view class="chat-page__body" @tap="handleChatBodyTap">
      <view v-if="isCheckingAuth" class="chat-feedback">
        <view class="chat-feedback__spinner" />
        <text class="chat-feedback__title">
          正在恢复会话...
        </text>
      </view>

      <view v-else-if="loadError && !displayRows.length" class="chat-feedback">
        <text class="chat-feedback__title">{{ loadError }}</text>
        <text class="chat-feedback__action" @tap="handleRetry">重新加载</text>
      </view>

      <view v-else-if="isLoading && !displayRows.length" class="chat-feedback">
        <view class="chat-feedback__spinner" />
        <text class="chat-feedback__title">正在加载聊天记录...</text>
      </view>

      <view v-else-if="!displayRows.length" class="chat-feedback">
        <text class="chat-feedback__title">还没有消息</text>
        <text class="chat-feedback__desc">和 TA 打个招呼，开始第一句对话吧</text>
      </view>

      <view v-else class="chat-message-list">
        <view
          class="chat-message-list__history-status"
          :class="{
            'chat-message-list__history-status--action': isHistoryStatusAction,
            'chat-message-list__history-status--hidden': !historyStatusText,
          }"
          @tap.stop="handleHistoryStatusTap"
        >
          {{ historyStatusText || '占位' }}
        </view>

        <template v-for="item in visibleDisplayRows" :key="item.key">
          <view v-if="item.kind === 'time'" class="chat-message-list__time">
            {{ item.label }}
          </view>

          <view v-else-if="item.kind === 'system'" class="chat-message-list__system">
            {{ item.text }}
          </view>

          <view
            v-else
            :id="item.anchorId"
            class="chat-row"
            :class="{
              'chat-row--agent': !item.isUser,
              'chat-row--user': item.isUser,
            }"
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

            <view
              class="chat-message-unit"
              :class="{
                'chat-message-unit--agent': !item.isUser,
                'chat-message-unit--user': item.isUser,
              }"
            >
              <view
                v-if="activeMessageActionRowKey === item.key"
                class="chat-message-actions"
                :class="{
                  'chat-message-actions--agent': !item.isUser,
                  'chat-message-actions--user': item.isUser,
                }"
                @tap.stop
              >
                <view class="chat-message-actions__panel">
                  <view
                    v-for="action in item.actions"
                    :key="action.key"
                    class="chat-message-actions__button"
                    @tap.stop="handleMessageActionTap(item.messageId, action.key, item.text)"
                  >
                    <text>{{ action.label }}</text>
                  </view>
                </view>
                <view class="chat-message-actions__arrow" />
              </view>

              <chat-message-bubble
                :type="item.type"
                :text="item.text"
                :image-url="item.imageUrl"
                :voice-duration-ms="item.voiceDurationMs"
                :has-voice-playback="item.hasVoicePlayback"
                :is-voice-active="activeVoiceMessageId === item.messageId"
                :is-voice-playing="activeVoiceMessageId === item.messageId && isVoicePlaying"
                :is-voice-loading="activeVoiceMessageId === item.messageId && isVoicePlaybackLoading"
                :is-user="item.isUser"
                :is-sending="item.isSending"
                :quoted-text="item.quotedText"
                :quoted-label="item.quotedLabel"
                @message-tap="handleMessageTap"
                @voice-tap="handleVoiceMessageTap(item.messageId)"
                @message-long-press="handleMessageLongPress(item.messageId, item.key, item.text)"
              />
            </view>

            <template v-if="item.isUser">
              <image
                v-if="currentUserAvatar"
                class="chat-avatar chat-avatar--user"
                :src="currentUserAvatar"
                mode="aspectFill"
                @tap.stop="handleCurrentUserAvatarTap"
              />
              <view
                v-else
                class="chat-avatar chat-avatar--user chat-avatar--fallback chat-avatar--self"
                @tap.stop="handleCurrentUserAvatarTap"
              >
                {{ currentUserAvatarFallback }}
              </view>
            </template>
          </view>

          <view
            v-if="item.kind === 'message' && item.isFailed"
            class="chat-message-list__failed"
          >
            {{ item.isUser ? '发送失败' : '回复失败' }}
          </view>
        </template>

        <view id="chat-bottom-anchor" class="chat-message-list__bottom-anchor" />
      </view>

      <view class="chat-page__ai-watermark">
        <text>由AI生成</text>
      </view>
    </view>

    <view
      v-if="isComposerPanelVisible"
      class="chat-composer-backdrop"
      @tap="hideComposerPanels"
    />

    <template #bottom>
      <chat-composer
        :composer-style="composerStyle"
        :draft-message="draftMessage"
        :draft-cursor="draftCursor"
        :cursor-control-enabled="isDraftCursorControlled"
        :max-length="CHAT_TEXT_MAX_LENGTH"
        :is-voice-mode="isVoiceMode"
        :is-voice-gesture-active="isVoiceGestureActive"
        :is-transcribing-voice="isTranscribingVoice"
        :voice-button-label="voiceComposerButtonLabel"
        :is-emoji-panel-visible="isEmojiPanelVisible"
        :is-more-panel-visible="isMorePanelVisible"
        :show-send-button="showSendButton"
        :is-send-disabled="isTextSendSubmitting"
        :quoted-text="quotedMessageText"
        :quoted-label="quotedMessageLabel"
        @voice-mode-toggle="handleVoiceModeToggle"
        @voice-touch-start="handleVoiceTouchStart"
        @voice-touch-move="handleVoiceTouchMove"
        @voice-touch-end="handleVoiceTouchEnd"
        @voice-touch-cancel="handleVoiceTouchCancel"
        @draft-input="handleDraftInput"
        @send="handleSend"
        @input-focus="handleInputFocus"
        @input-blur="handleInputBlur"
        @keyboard-height-change="handleKeyboardHeightChange"
        @emoji-toggle="handleEmojiToggle"
        @more-toggle="handleMoreToggle"
        @emoji-select="handleEmojiSelect"
        @emoji-delete="handleEmojiDelete"
        @more-action="handleMoreAction"
        @quote-cancel="clearQuotedMessage"
      />
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

    <template #overlay>
      <nut-dialog
        close-on-click-overlay
        v-model:visible="isChatQuotaDialogVisible"
        title="温馨提示"
        custom-class="chat-quota-dialog"
        text-align="left"
        :lock-scroll="true"
        :overlay-style="chatQuotaDialogOverlayStyle"
        :z-index="CHAT_QUOTA_DIALOG_Z_INDEX"
      >
        <view class="chat-quota-dialog__content">
          {{ chatQuotaDialogContent }}
        </view>

        <template #footer>
          <view
            class="chat-quota-dialog__footer"
            :class="{ 'chat-quota-dialog__footer--single': isChatQuotaExhaustedDialog }"
          >
            <view
              v-if="!isChatQuotaExhaustedDialog"
              class="chat-quota-dialog__secondary"
              @tap="handleChatQuotaDialogContinue"
            >
              再聊一句
            </view>
            <view
              class="chat-quota-dialog__primary"
              :class="{ 'chat-quota-dialog__primary--single': isChatQuotaExhaustedDialog }"
              @tap="handleChatQuotaDialogUpgrade"
            >
              开通会员
            </view>
          </view>
        </template>
      </nut-dialog>

      <nut-dialog
        v-model:visible="isVoicePrivacyDialogVisible"
        title="语音功能授权"
        custom-class="chat-privacy-dialog"
        text-align="left"
        :close-on-click-overlay="false"
        :lock-scroll="true"
        :overlay-style="chatQuotaDialogOverlayStyle"
        :z-index="CHAT_QUOTA_DIALOG_Z_INDEX + 1"
      >
        <view class="chat-privacy-dialog__content">
          发送语音需要你同意{{ voicePrivacyContractName }}，我们会使用麦克风录制语音消息和语音转文字。
        </view>
        <view class="chat-privacy-dialog__link" @tap="handleVoicePrivacyContractTap">
          查看隐私保护指引
        </view>

        <template #footer>
          <view class="chat-privacy-dialog__footer">
            <view
              class="chat-privacy-dialog__secondary"
              @tap="handleVoicePrivacyDisagree"
            >
              暂不使用
            </view>
            <button
              :id="VOICE_PRIVACY_AGREE_BUTTON_ID"
              class="chat-privacy-dialog__primary"
              open-type="agreePrivacyAuthorization"
              @agreeprivacyauthorization="handleVoicePrivacyAgree"
            >
              同意并继续
            </button>
          </view>
        </template>
      </nut-dialog>

      <nut-popup
        v-model:visible="isFeedbackPopupVisible"
        position="bottom"
        round
        :z-index="CHAT_QUOTA_DIALOG_Z_INDEX + 2"
        closeable
        close-icon-position="top-right"
        :safe-area-inset-bottom="true"
      >
        <view class="chat-feedback-popup">
          <view class="chat-feedback-popup__title">反馈这条回复</view>
          <view class="chat-feedback-popup__desc">
            选择原因后提交，Ta 会调整后续回复
          </view>

          <view class="chat-feedback-popup__options">
            <view
              v-for="option in FEEDBACK_OPTIONS"
              :key="option.type"
              class="chat-feedback-popup__option"
              :class="{
                'chat-feedback-popup__option--active':
                  selectedFeedbackType === option.type,
              }"
              @tap="selectedFeedbackType = option.type"
            >
              {{ option.label }}
            </view>
          </view>

          <textarea
            class="chat-feedback-popup__textarea"
            :value="feedbackContent"
            maxlength="500"
            :placeholder="feedbackTextareaPlaceholder"
            placeholder-class="chat-feedback-popup__textarea-placeholder"
            :show-confirm-bar="false"
            @input="handleFeedbackContentInput"
          />

          <view class="chat-feedback-popup__footer">
            <view class="chat-feedback-popup__cancel" @tap="closeFeedbackPopup">
              取消
            </view>
            <view
              class="chat-feedback-popup__submit"
              :class="{ 'chat-feedback-popup__submit--disabled': isSubmittingFeedback }"
              @tap="handleFeedbackSubmit"
            >
              {{ isSubmittingFeedback ? '提交中...' : '提交' }}
            </view>
          </view>
        </view>
      </nut-popup>
    </template>
  </page-scaffold>
</template>

<script lang="ts">
export default {
  name: 'ChatIndexPage',
}
</script>

<script setup lang="ts">
import { Category } from '@nutui/icons-vue-taro'

import Taro, { useDidHide, useDidShow, useLoad, useUnload } from '@tarojs/taro'
import type { ITouchEvent } from '@tarojs/components/types/common'
import { computed, nextTick, ref } from 'vue'
import { ApiConfig } from '../../api/api-config'
import { ApiException } from '../../api/api-exception'
import { getAgentDetail } from '../../apis/agent'
import {
  deleteConversationMessage,
  generateConversationMessageVoice,
  getConversationChatQuota,
  getConversationMessagesPage,
  markConversationMessageMemory,
  sendConversationMessageAsync,
  submitConversationMessageFeedback,
  transcribeConversationVoice,
  type ConversationMessage,
  type ConversationMessageFeedbackType,
  type ConversationImagePayload,
  type ConversationChatQuotaSnapshot,
  type SendConversationMessageResult,
  type ConversationVoicePayload,
} from '../../apis/conversation'
import { preloadVipPurchaseCenter } from '../../apis/membership'
import { uploadLocalFile, uploadLocalImage } from '../../apis/storage'
import BackCapsule from '../../components/back-capsule/back-capsule.vue'
import ChatComposer from '../../components/chat-composer/chat-composer.vue'
import ChatMessageBubble from '../../components/chat-message-bubble/chat-message-bubble.vue'
import {
  isChatImageOperationCanceled,
  pickChatImageForSend,
  type ChatImageSourceType,
  type PickedChatImage,
} from '../../components/chat-more-panel/image'
import type { ChatMoreActionItem } from '../../components/chat-more-panel/types'
import PageScaffold from '../../components/page-scaffold/page-scaffold.vue'
import { authSession, restoreAuthSession } from '../../auth/session'
import { ensureInnerAudioPlaybackOptions } from '../../utils/audio'
import { normalizeEmojiText } from '../../utils/emoji-text'
import { readMenuButtonMetrics } from '../../utils/menu-button'
import { useSafeAreaInsets } from '../../utils/safe-area'

type VoiceTouchEvent = ITouchEvent | TouchEvent

type AssistantSegmentRevealTimer = {
  timer: ReturnType<typeof setTimeout>
  resolve: (active: boolean) => void
}

type DraftInputEvent = InputEvent | {
  detail?: {
    value?: string
    cursor?: number
  }
}

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
      hasVoicePlayback: boolean
      actions: MessageActionItem[]
      isUser: boolean
      isSending: boolean
      isFailed: boolean
      anchorId: string
      quotedText: string
      quotedLabel: string
    }

type VoiceDragTarget = 'send' | 'cancel' | 'transcribe'

type ChatQuotaDialogType = 'remaining' | 'exhausted'

type WechatAppMicrophoneAuthorizeStatus =
  | 'authorized'
  | 'denied'
  | 'not determined'
  | 'unknown'

type TaroSystemPermissionApi = typeof Taro & {
  getAppAuthorizeSetting?: () => {
    microphoneAuthorized?: unknown
  }
  openAppAuthorizeSetting?: (option?: Record<string, unknown>) => Promise<unknown>
  getSystemInfoSync?: () => {
    microphoneAuthorized?: boolean
  }
}

type VoicePrivacyResolveOption =
  | {
      event: 'exposureAuthorization'
    }
  | {
      event: 'agree'
      buttonId: string
    }
  | {
      event: 'disagree'
    }

type VoicePrivacyResolve = (option: VoicePrivacyResolveOption) => void

type VoicePrivacySettingResult = {
  needAuthorization?: boolean
  privacyContractName?: string
}

type TaroPrivacyApi = typeof Taro & {
  getPrivacySetting?: (option: {
    success?: (result: VoicePrivacySettingResult) => void
    fail?: (error: unknown) => void
  }) => void
  requirePrivacyAuthorize?: (option: {
    success?: () => void
    fail?: (error: unknown) => void
  }) => void
  openPrivacyContract?: (option?: {
    fail?: (error: unknown) => void
  }) => void
  onNeedPrivacyAuthorization?: (
    listener: (resolve: VoicePrivacyResolve) => void
  ) => void
}

type TouchPoint = {
  x: number
  y: number
}

type RecorderStopResult = {
  tempFilePath: string
  duration: number
  fileSize: number
}

type RecorderErrorLike = {
  errMsg?: string
}

type MessageActionKey = 'quote' | 'generateVoice' | 'feedback' | 'remember' | 'delete'

type MessageActionItem = {
  key: MessageActionKey
  label: string
}

const ASSISTANT_SEGMENT_REVEAL_CONFIG = {
  defaultDelayMs: 2200,
  longSegmentDelayMs: 2800,
  longSegmentLengthThreshold: 24,
} as const
const CHAT_TEXT_MAX_LENGTH = 500
const CHAT_MESSAGE_PAGE_SIZE = 30
const CHAT_MAX_LOADED_MESSAGES = 180
const CHAT_RENDER_MESSAGE_WINDOW = 120
const AGENT_REPLY_POLL_INTERVAL_MS = 1500
const AGENT_REPLY_POLL_TIMEOUT_MS = 60 * 1000
const AGENT_REPLY_RESUME_WINDOW_MS = 5 * 60 * 1000
const VOICE_PRIVACY_AGREE_BUTTON_ID = 'chat-voice-privacy-agree-btn'
const VOICE_PLAYBACK_ERROR_MUTE_MS = 3000
const CHAT_QUOTA_DIALOG_CONTENT = {
  remaining: '宝，今日仅剩最后 1 句对话机会了，好好珍惜彼此吧～想畅聊点击【开通会员】',
  exhausted:
    '宝，今日对话结束啦（非会员试用期每天 30句）～可以明天再来哦，先好好生活吧，记得在心里牵挂TA～想畅聊点击【开通会员】',
} as const
const CHAT_QUOTA_DIALOG_Z_INDEX = 10000
const CHAT_MESSAGE_RENDER_FALLBACK_TEXT = '该消息暂无法显示'
const QUOTE_MESSAGE_ACTION: MessageActionItem = { key: 'quote', label: '引用' }
const GENERATE_VOICE_MESSAGE_ACTION: MessageActionItem = {
  key: 'generateVoice',
  label: '转语音',
}
const FEEDBACK_MESSAGE_ACTION: MessageActionItem = {
  key: 'feedback',
  label: '反馈',
}
const REMEMBER_MESSAGE_ACTION: MessageActionItem = {
  key: 'remember',
  label: '记忆！',
}
const DELETE_MESSAGE_ACTION: MessageActionItem = { key: 'delete', label: '删除' }
const FEEDBACK_OPTIONS: Array<{
  type: ConversationMessageFeedbackType
  label: string
}> = [
  { type: 'accurate', label: '很贴切' },
  { type: 'unlike', label: '不像本人' },
  { type: 'wrong_fact', label: '说错了' },
  { type: 'fabricated', label: '瞎编了' },
  { type: 'uncomfortable', label: '回复不舒服' },
  { type: 'other', label: '其他' },
]

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
const isTextSendSubmitting = ref(false)
const isCheckingChatQuota = ref(false)
const isWaitingAgentReply = ref(false)
const loadError = ref('')
const isLoadingHistory = ref(false)
const historyLoadError = ref('')
const hasMoreHistory = ref(false)
const isViewingHistoryWindow = ref(false)
const didInitialShow = ref(false)
const draftMessage = ref('')
const draftCursor = ref(0)
const isDraftCursorControlled = ref(false)
const keyboardHeight = ref(0)
const activeMessageActionRowKey = ref('')
let messageActionTapMutedUntil = 0
const isInputFocused = ref(false)
const isEmojiPanelVisible = ref(false)
const isMorePanelVisible = ref(false)
const isVoiceMode = ref(false)
const isVoicePressPreviewing = ref(false)
const isVoiceRecording = ref(false)
const isTranscribingVoice = ref(false)
const isCheckingRecordPermission = ref(false)
const isVoicePrivacyDialogVisible = ref(false)
const voicePrivacyContractName = ref('《天之灵隐私保护指引》')
const voiceDragTarget = ref<VoiceDragTarget>('send')
const voiceGestureStartPoint = ref<TouchPoint | null>(null)
const recordingStartedAt = ref<number | null>(null)
const activeVoiceMessageId = ref('')
const isVoicePlaying = ref(false)
const isVoicePlaybackLoading = ref(false)
const messages = ref<ConversationMessage[]>([])
const scrollIntoViewTarget = ref('')
const scrollWithAnimation = ref(true)
const hasCompletedInitialMessagesScroll = ref(false)
const isChatQuotaDialogVisible = ref(false)
const chatQuotaDialogType = ref<ChatQuotaDialogType>('remaining')
const chatQuotaIsVip = ref(false)
const chatQuotaRemainingCount = ref<number | null>(null)
const isFeedbackPopupVisible = ref(false)
const selectedFeedbackMessageId = ref('')
const selectedFeedbackType = ref<ConversationMessageFeedbackType>('unlike')
const feedbackContent = ref('')
const feedbackTextareaPlaceholder = computed(() => {
  if (selectedFeedbackType.value === 'accurate') {
    return '可以补充哪里好，Ta 会持续优化'
  }

  return '可以补充哪里不对，Ta 会记住并调整'
})
const isSubmittingFeedback = ref(false)
const quotedMessageId = ref('')
const quotedMessageText = ref('')
const quotedMessageLabel = ref('引用')
const chatQuotaDialogOverlayStyle = {
  background: 'rgba(0, 0, 0, 0.72)',
  zIndex: CHAT_QUOTA_DIALOG_Z_INDEX,
}

let ensureSessionPromise: Promise<void> | null = null
let refreshMessagesPromise: Promise<void> | null = null
let refreshChatQuotaPromise: Promise<ConversationChatQuotaSnapshot | undefined> | null = null
let voiceStartTimer: ReturnType<typeof setTimeout> | null = null
let pendingRecorderStop:
  | {
      resolve: (result: RecorderStopResult) => void
      reject: (error: unknown) => void
    }
  | null = null
let lastRecorderStopResult: RecorderStopResult | null = null
let lastRecorderErrorMessage = ''
let pendingVoicePrivacyResolves: VoicePrivacyResolve[] = []
let voicePrivacyAuthorizationPromise: Promise<boolean> | null = null
let voiceAudioContext: Taro.InnerAudioContext | null = null
let isPickingChatImage = false
let isChatPageVisible = true
let voicePlaybackErrorMutedUntil = 0
let isSwitchingComposerPanel = false
let replyPollingTimer: ReturnType<typeof setTimeout> | null = null
let replyPollingStartedAt = 0
let replyPollingAfterUserCreatedAt: Date | null = null
let scrollToBottomPromise: Promise<void> | null = null
const deletingMessageIds = new Set<string>()
const generatingVoiceMessageIds = new Set<string>()
const voiceDurationProbeContexts = new Map<string, Taro.InnerAudioContext>()
const assistantSegmentRevealTimers = new Set<AssistantSegmentRevealTimer>()
let assistantSegmentRevealGeneration = 0

const recorderManager = Taro.getRecorderManager()

recorderManager.onStop((result) => {
  lastRecorderErrorMessage = ''
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
  lastRecorderErrorMessage = normalizeRecorderErrorMessage(error)

  if (pendingRecorderStop) {
    pendingRecorderStop.reject(error)
    pendingRecorderStop = null
  }
})

registerVoicePrivacyAuthorizationListener()

const safeAreaInsets = useSafeAreaInsets()
const menuButtonMetrics = readMenuButtonMetrics()
const navStyle = {
  height: `${menuButtonMetrics.totalHeight}px`,
  paddingTop: `${menuButtonMetrics.statusBarHeight}px`,
}
const pageTitle = computed(() => {
  if (isWaitingAgentReply.value) {
    return '正在输入...'
  }

  const trimmedName = agentName.value.trim()
  return trimmedName || '对话'
})
const currentUserAvatar = computed(() => authSession.value?.user.avatar.trim() ?? '')
const isCurrentUserVip = computed(() => Boolean(authSession.value?.user.isVip) || chatQuotaIsVip.value)
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
  return (
    draftMessage.value.trim().length > 0
    && !isSending.value
    && !isTextSendSubmitting.value
    && !isCheckingChatQuota.value
    && !isTranscribingVoice.value
  )
})
const showSendButton = computed(() => canSend.value && !isVoiceMode.value)
const isChatQuotaExhaustedDialog = computed(() => chatQuotaDialogType.value === 'exhausted')
const chatQuotaDialogContent = computed(() => {
  if (isChatQuotaExhaustedDialog.value) {
    return CHAT_QUOTA_DIALOG_CONTENT.exhausted
  }

  return CHAT_QUOTA_DIALOG_CONTENT.remaining
})
const isVoiceGestureActive = computed(() => {
  return isVoicePressPreviewing.value || isVoiceRecording.value
})
const isVoiceOverlayVisible = computed(() => isVoiceMode.value && isVoiceGestureActive.value)
const isComposerPanelVisible = computed(() => {
  return isEmojiPanelVisible.value || isMorePanelVisible.value
})
const showNoMoreHistoryHint = computed(() => {
  return (
    !hasMoreHistory.value
    && !isLoadingHistory.value
    && !historyLoadError.value
    && messages.value.length >= CHAT_MESSAGE_PAGE_SIZE
  )
})
const historyStatusText = computed(() => {
  if (isLoadingHistory.value) {
    return '正在加载更早消息...'
  }

  if (historyLoadError.value) {
    return '加载失败，点此重试'
  }

  if (showNoMoreHistoryHint.value) {
    return '没有更早消息了'
  }

  return ''
})
const isHistoryStatusAction = computed(() => {
  return Boolean(historyLoadError.value && !isLoadingHistory.value)
})
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

  renderMessages.value.forEach((message, messageIndex) => {
    try {
      appendMessageDisplayRows(rows, message, renderMessages.value[messageIndex - 1])
    } catch {
      rows.push(buildMessageRenderFallbackRow(message, messageIndex))
    }
  })

  return rows
})
const renderMessages = computed(() => {
  if (messages.value.length <= CHAT_RENDER_MESSAGE_WINDOW) {
    return messages.value
  }

  return isViewingHistoryWindow.value
    ? messages.value.slice(0, CHAT_RENDER_MESSAGE_WINDOW)
    : messages.value.slice(-CHAT_RENDER_MESSAGE_WINDOW)
})
const visibleDisplayRows = computed(() => displayRows.value)
const messageDisplayRowCounts = computed(() => {
  const counts = new Map<string, number>()

  displayRows.value.forEach((row) => {
    if (row.kind !== 'message') {
      return
    }

    counts.set(row.messageId, (counts.get(row.messageId) ?? 0) + 1)
  })

  return counts
})

function appendMessageDisplayRows(
  rows: DisplayRow[],
  message: ConversationMessage,
  previous?: ConversationMessage,
) {
  if (shouldShowTimeDivider(message, previous)) {
    rows.push({
      key: `time-${message.id}`,
      kind: 'time',
      label: formatMessageTime(message.createdAt ?? message.updatedAt),
    })
  }

  const normalizedText = normalizeEmojiText(buildMessageText(message))

  if (message.type === 'image' && message.role !== 'system') {
    rows.push({
      key: `message-${message.id}-image`,
      kind: 'message',
      messageId: message.id,
      type: 'image',
      text: normalizedText,
      imageUrl: resolveImageMessageUrl(message.image),
      voiceDurationMs: 0,
      hasVoicePlayback: false,
      actions: getMessageActionItems(message),
      isUser: message.role === 'user',
      isSending: message.status === 'sending',
      isFailed: message.status === 'failed',
      anchorId: buildMessageAnchorId(message.id),
      quotedText: '',
      quotedLabel: '',
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
      hasVoicePlayback: hasResolvableVoicePayload(message.voice),
      actions: getMessageActionItems(message),
      isUser: message.role === 'user',
      isSending: message.status === 'sending',
      isFailed: message.status === 'failed',
      anchorId: buildMessageAnchorId(message.id),
      quotedText: '',
      quotedLabel: '',
    })
    return
  }

  const textSegments =
    message.type === 'text' && message.segments.length
      ? message.segments.map((segment) => normalizeEmojiText(segment))
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
    const shouldAttachVoicePlayback =
      message.role === 'assistant'
      && segmentIndex === textSegments.length - 1
      && hasResolvableVoicePayload(message.voice)

    rows.push({
      key: `message-${message.id}-${segmentIndex}`,
      kind: 'message',
      messageId: message.id,
      type: 'text',
      text: segment,
      imageUrl: '',
      voiceDurationMs: shouldAttachVoicePlayback
        ? message.voice?.durationMs ?? 1000
        : 0,
      hasVoicePlayback: shouldAttachVoicePlayback,
      actions: getMessageActionItems(message, segment),
      isUser: message.role === 'user',
      isSending: message.status === 'sending',
      isFailed: segmentIndex === textSegments.length - 1 && message.status === 'failed',
      anchorId: segmentIndex === 0 ? buildMessageAnchorId(message.id) : '',
      quotedText: shouldShowQuotedMessageInRow(message, segmentIndex, textSegments.length)
        ? getQuotedMessageText(message)
        : '',
      quotedLabel: shouldShowQuotedMessageInRow(message, segmentIndex, textSegments.length)
        ? getQuotedMessageLabel(message)
        : '',
    })
  })
}

function buildMessageRenderFallbackRow(
  message: Partial<ConversationMessage> | null | undefined,
  messageIndex: number,
): DisplayRow {
  const messageId = typeof message?.id === 'string' && message.id
    ? message.id
    : `unknown-${messageIndex}`

  return {
    key: `message-render-fallback-${messageId}-${messageIndex}`,
    kind: 'system',
    text: CHAT_MESSAGE_RENDER_FALLBACK_TEXT,
  }
}

function limitLoadedMessages(items: ConversationMessage[]) {
  if (items.length <= CHAT_MAX_LOADED_MESSAGES) {
    return items
  }

  return items.slice(-CHAT_MAX_LOADED_MESSAGES)
}

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

  preloadVipCenterWhenAuthenticated()
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

function scheduleAfterInitialRender(task: () => void) {
  setTimeout(task, 300)
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

  preloadVipCenterWhenAuthenticated()

  if (!conversationId.value) {
    loadError.value = '缺少会话信息，请返回通讯录重新进入'
    isLoading.value = false
    return
  }

  isLoading.value = messages.value.length === 0
  void refreshMessages({ showLoading: messages.value.length === 0 })
  scheduleAfterInitialRender(() => {
    void refreshAgentSnapshot()
    void refreshChatQuotaSnapshot()
  })
}

function buildMessageAnchorId(messageId: string) {
  return `chat-message-${messageId.replace(/[^A-Za-z0-9_-]/g, '-')}`
}

function getMessageTimeValue(message: ConversationMessage) {
  return (message.createdAt ?? message.updatedAt)?.getTime() ?? 0
}

function compareConversationMessages(
  left: ConversationMessage,
  right: ConversationMessage,
) {
  const timeDiff = getMessageTimeValue(left) - getMessageTimeValue(right)

  if (timeDiff !== 0) {
    return timeDiff
  }

  return left.id.localeCompare(right.id)
}

function mergeConversationMessages(
  currentMessages: ConversationMessage[],
  nextMessages: ConversationMessage[],
) {
  const messageById = new Map<string, ConversationMessage>()

  currentMessages.forEach((message) => {
    messageById.set(message.id, message)
  })
  nextMessages.forEach((message) => {
    messageById.set(message.id, message)
  })

  return Array.from(messageById.values()).sort(compareConversationMessages)
}

function findOldestLoadedMessage() {
  return messages.value.find((message) => {
    return !message.id.startsWith('local-') && Boolean(message.createdAt ?? message.updatedAt)
  })
}

async function refreshAgentSnapshot() {
  if (!agentId.value) {
    return
  }

  try {
    const latestAgent = await getAgentDetail(agentId.value)
    agentName.value = latestAgent.name.trim() || agentName.value
    agentAvatar.value = latestAgent.avatar.trim()
    agentSex.value = latestAgent.sex
    agentCallMe.value = latestAgent.agentCallMe.trim() || agentCallMe.value
    iCallAgent.value = latestAgent.iCallAgent.trim() || iCallAgent.value
  } catch (error) {
    if (error instanceof ApiException && error.requiresReLogin) {
      await redirectToAuth()
    }
  }
}

async function runWithAgentReplyStatus(task: () => Promise<void>) {
  isWaitingAgentReply.value = true

  try {
    await task()
  } finally {
    isWaitingAgentReply.value = false
  }
}

function getAssistantSegmentRevealDelay(segment: string) {
  return segment.trim().length >= ASSISTANT_SEGMENT_REVEAL_CONFIG.longSegmentLengthThreshold
    ? ASSISTANT_SEGMENT_REVEAL_CONFIG.longSegmentDelayMs
    : ASSISTANT_SEGMENT_REVEAL_CONFIG.defaultDelayMs
}

function waitForAssistantSegmentDelay(delayMs: number) {
  const generation = assistantSegmentRevealGeneration

  return new Promise<boolean>((resolve) => {
    const entry: AssistantSegmentRevealTimer = {
      timer: setTimeout(() => {
        assistantSegmentRevealTimers.delete(entry)
        resolve(generation === assistantSegmentRevealGeneration)
      }, delayMs),
      resolve,
    }

    assistantSegmentRevealTimers.add(entry)
  })
}

function clearAssistantSegmentRevealTimers() {
  assistantSegmentRevealGeneration += 1
  assistantSegmentRevealTimers.forEach((entry) => {
    clearTimeout(entry.timer)
    entry.resolve(false)
  })
  assistantSegmentRevealTimers.clear()
}

async function revealAssistantMessage(message: ConversationMessage) {
  if (message.type !== 'text' || message.segments.length <= 1) {
    messages.value = limitLoadedMessages([...messages.value, message])
    return
  }

  const fullSegments = message.segments
  messages.value = limitLoadedMessages([
    ...messages.value,
    {
      ...message,
      segments: fullSegments.slice(0, 1),
    },
  ])
  await scrollToBottom()

  for (let index = 1; index < fullSegments.length; index += 1) {
    const shouldContinue = await waitForAssistantSegmentDelay(
      getAssistantSegmentRevealDelay(fullSegments[index]),
    )
    if (!shouldContinue) {
      return
    }

    messages.value = messages.value.map((item) =>
      item.id === message.id
        ? {
            ...item,
            segments: fullSegments.slice(0, index + 1),
          }
        : item
    )
    await scrollToBottom()
  }
}

async function revealAssistantMessages(items: ConversationMessage[]) {
  for (let index = 0; index < items.length; index += 1) {
    const message = items[index]

    if (index > 0) {
      const shouldContinue = await waitForAssistantSegmentDelay(
        getAssistantSegmentRevealDelay(buildMessageText(message)),
      )

      if (!shouldContinue) {
        return
      }
    }

    await revealAssistantMessage(message)
    await scrollToBottom()
  }
}

function getAssistantMessagesFromResult(result: SendConversationMessageResult) {
  if (result.assistantMessages?.length) {
    return result.assistantMessages
  }

  return result.assistantMessage ? [result.assistantMessage] : []
}

async function appendConversationResult(
  tempMessageId: string,
  result: SendConversationMessageResult,
) {
  isViewingHistoryWindow.value = false
  messages.value = messages.value.filter((message) => message.id !== tempMessageId)
  messages.value = limitLoadedMessages([...messages.value, result.userMessage])
  handleChatQuotaAfterSend(result)

  const assistantMessages = getAssistantMessagesFromResult(result)
  if (!assistantMessages.length) {
    return
  }

  await revealAssistantMessages(assistantMessages)
  probeMissingAssistantVoiceDurations(assistantMessages)
}

function handleChatQuotaAfterSend(result: SendConversationMessageResult) {
  updateChatQuotaSnapshot(result.chatQuota)

  if (result.chatQuota?.isVip) {
    return
  }

  if (result.chatQuota?.remainingCount === 1) {
    showChatQuotaDialog('remaining')
  }
}

function updateChatQuotaSnapshot(chatQuota?: ConversationChatQuotaSnapshot) {
  if (!chatQuota) {
    return
  }

  if (chatQuota.isVip) {
    chatQuotaIsVip.value = true
    chatQuotaRemainingCount.value = null
    return
  }

  chatQuotaIsVip.value = false

  if (typeof chatQuota.remainingCount === 'number') {
    chatQuotaRemainingCount.value = chatQuota.remainingCount
  }
}

function isNonVipChatQuotaExhausted() {
  return !isCurrentUserVip.value
    && chatQuotaRemainingCount.value !== null
    && chatQuotaRemainingCount.value <= 0
}

function isChatQuotaLimitError(error: unknown) {
  return error instanceof ApiException && error.code === 'NON_VIP_CHAT_LIMIT_EXCEEDED'
}

function showChatQuotaDialog(type: ChatQuotaDialogType) {
  chatQuotaDialogType.value = type
  isChatQuotaDialogVisible.value = true
  hideComposerPanels()
  hideMessageActions()
  isInputFocused.value = false
  keyboardHeight.value = 0
  void Taro.hideKeyboard()
}

function showChatQuotaExhaustedDialog() {
  chatQuotaIsVip.value = false
  chatQuotaRemainingCount.value = 0
  showChatQuotaDialog('exhausted')
}

async function ensureChatQuotaAvailableBeforeSend() {
  if (isCurrentUserVip.value) {
    chatQuotaRemainingCount.value = null
    return true
  }

  if (isNonVipChatQuotaExhausted()) {
    showChatQuotaExhaustedDialog()
    return false
  }

  if (!conversationId.value || chatQuotaRemainingCount.value !== null) {
    return true
  }

  isCheckingChatQuota.value = true

  try {
    const chatQuota = await refreshChatQuotaSnapshot()

    if (!chatQuota) {
      showToast('发送前校验失败，请稍后重试')
      return false
    }

    if (!chatQuota.isVip && typeof chatQuota.remainingCount === 'number') {
      if (chatQuota.remainingCount <= 0) {
        showChatQuotaExhaustedDialog()
        return false
      }
    }
  } catch (error) {
    if (error instanceof ApiException && error.requiresReLogin) {
      await redirectToAuth()
      return false
    }

    showToast('发送前校验失败，请稍后重试')
    return false
  } finally {
    isCheckingChatQuota.value = false
  }

  return true
}

function handleChatQuotaDialogContinue() {
  isChatQuotaDialogVisible.value = false
}

function handleChatQuotaDialogUpgrade() {
  isChatQuotaDialogVisible.value = false

  void Taro.navigateTo({
    url: '/pages/vip-center/index',
  })
}

useDidShow(() => {
  if (!didInitialShow.value) {
    didInitialShow.value = true
    return
  }

  if (!conversationId.value || !agentId.value || isCheckingAuth.value) {
    return
  }

  void refreshMessages({ showLoading: false })
  scheduleAfterInitialRender(() => {
    void refreshAgentSnapshot()
    void refreshChatQuotaSnapshot({ resetBeforeFetch: true })
  })
})

async function refreshChatQuotaSnapshot(
  options: { resetBeforeFetch?: boolean } = {},
) {
  if (!conversationId.value) {
    return undefined
  }

  if (isCurrentUserVip.value) {
    chatQuotaIsVip.value = true
    chatQuotaRemainingCount.value = null
    return { isVip: true } satisfies ConversationChatQuotaSnapshot
  }

  if (options.resetBeforeFetch) {
    chatQuotaRemainingCount.value = null
  }

  if (refreshChatQuotaPromise) {
    return refreshChatQuotaPromise
  }

  refreshChatQuotaPromise = getConversationChatQuota(conversationId.value)
    .then((chatQuota) => {
      if (chatQuota) {
        updateChatQuotaSnapshot(chatQuota)
      }

      return chatQuota
    })
    .catch(async (error: unknown) => {
      if (error instanceof ApiException && error.requiresReLogin) {
        await redirectToAuth()
      }

      return undefined
    })
    .finally(() => {
      refreshChatQuotaPromise = null
    })

  return refreshChatQuotaPromise
}

async function refreshMessages(options: { showLoading?: boolean } = {}) {
  if (refreshMessagesPromise) {
    return refreshMessagesPromise
  }

  const shouldShowLoading = options.showLoading ?? messages.value.length === 0
  const shouldScrollWithoutAnimation = !hasCompletedInitialMessagesScroll.value || shouldShowLoading

  if (shouldShowLoading) {
    isLoading.value = true
  }

  loadError.value = ''

  refreshMessagesPromise = getConversationMessagesPage(conversationId.value, {
    pageSize: CHAT_MESSAGE_PAGE_SIZE,
    lightweight: true,
  })
    .then(async (result) => {
      isViewingHistoryWindow.value = false
      messages.value = limitLoadedMessages(result.items)
      hasMoreHistory.value = result.hasMore
      historyLoadError.value = ''
      probeMissingAssistantVoiceDurations(result.items)
      resumePendingReplyPollingFromMessages(result.items)
    })
    .catch(async (error: unknown) => {
      await handleApiError(error, '加载聊天记录失败，请稍后重试')
    })
    .finally(async () => {
      isLoading.value = false
      refreshMessagesPromise = null

      if (!loadError.value && messages.value.length > 0) {
        await scrollToBottom({ animated: !shouldScrollWithoutAnimation })
        hasCompletedInitialMessagesScroll.value = true
      }
    })

  return refreshMessagesPromise
}

async function loadOlderMessages() {
  if (
    isLoadingHistory.value
    || isLoading.value
    || !hasMoreHistory.value
    || !conversationId.value
  ) {
    return
  }

  const oldestMessage = findOldestLoadedMessage()
  const beforeCreatedAt = oldestMessage?.createdAt ?? oldestMessage?.updatedAt

  if (!oldestMessage || !beforeCreatedAt) {
    hasMoreHistory.value = false
    return
  }

  const anchorId = buildMessageAnchorId(oldestMessage.id)

  isLoadingHistory.value = true
  historyLoadError.value = ''
  let shouldDelayHideLoading = false

  try {
    const result = await getConversationMessagesPage(conversationId.value, {
      pageSize: CHAT_MESSAGE_PAGE_SIZE,
      beforeCreatedAt,
      lightweight: true,
    })

    messages.value = mergeConversationMessages(messages.value, result.items)
    isViewingHistoryWindow.value = true
    hasMoreHistory.value = result.hasMore
    probeMissingAssistantVoiceDurations(result.items)
    await scrollToMessageAnchor(anchorId)
    shouldDelayHideLoading = true
  } catch (error) {
    if (error instanceof ApiException && error.requiresReLogin) {
      await redirectToAuth()
      return
    }

    historyLoadError.value = '加载失败'
  } finally {
    if (shouldDelayHideLoading) {
      await waitForHistoryScrollSettle()
    }

    isLoadingHistory.value = false
  }
}

function handleChatScrollToUpper() {
  void loadOlderMessages()
}

function handleHistoryStatusTap() {
  if (!isHistoryStatusAction.value) {
    return
  }

  void loadOlderMessages()
}

function resumePendingReplyPollingFromMessages(items: ConversationMessage[]) {
  const latestAssistantTime = findLatestMessageCreatedAt(items, 'assistant')
  const latestUserTime = findLatestMessageCreatedAt(items, 'user')

  if (
    latestUserTime
    && Date.now() - latestUserTime.getTime() <= AGENT_REPLY_RESUME_WINDOW_MS
    && (!latestAssistantTime || latestUserTime > latestAssistantTime)
  ) {
    startReplyPolling(latestUserTime)
    return
  }

  stopReplyPolling()
}

function findLatestMessageCreatedAt(
  items: ConversationMessage[],
  role: 'user' | 'assistant',
) {
  return items.reduce<Date | null>((latest, message) => {
    if (message.role !== role || message.status !== 'sent') {
      return latest
    }

    const createdAt = message.createdAt ?? message.updatedAt
    if (!createdAt) {
      return latest
    }

    return !latest || createdAt > latest ? createdAt : latest
  }, null)
}

function startReplyPolling(afterUserCreatedAt: Date) {
  replyPollingAfterUserCreatedAt = afterUserCreatedAt
  replyPollingStartedAt = Date.now()
  isWaitingAgentReply.value = true
  scheduleReplyPolling(0)
}

function scheduleReplyPolling(delayMs = AGENT_REPLY_POLL_INTERVAL_MS) {
  if (!conversationId.value || !replyPollingAfterUserCreatedAt) {
    stopReplyPolling()
    return
  }

  if (replyPollingTimer) {
    clearTimeout(replyPollingTimer)
  }

  replyPollingTimer = setTimeout(() => {
    replyPollingTimer = null
    void pollConversationReply()
  }, delayMs)
}

async function pollConversationReply() {
  const pendingAfter = replyPollingAfterUserCreatedAt
  if (!conversationId.value || !pendingAfter) {
    stopReplyPolling()
    return
  }

  if (Date.now() - replyPollingStartedAt >= AGENT_REPLY_POLL_TIMEOUT_MS) {
    stopReplyPolling()
    showToast('TA 还在想，稍后下拉刷新看看')
    return
  }

  try {
    const result = await getConversationMessagesPage(conversationId.value, {
      pageSize: CHAT_MESSAGE_PAGE_SIZE,
      lightweight: true,
    })
    const items = result.items

    await reconcilePolledMessages(items, pendingAfter)
    probeMissingAssistantVoiceDurations(items)

    if (hasAssistantReplyResultAfter(messages.value, pendingAfter)) {
      stopReplyPolling()
      return
    }
  } catch (error) {
    if (error instanceof ApiException && error.requiresReLogin) {
      stopReplyPolling()
      await redirectToAuth()
      return
    }
  }

  scheduleReplyPolling()
}

async function reconcilePolledMessages(
  items: ConversationMessage[],
  pendingAfter: Date,
) {
  isViewingHistoryWindow.value = false
  const currentMessageIds = new Set(messages.value.map((message) => message.id))
  const newAssistantMessages = items.filter((message) => {
    const createdAt = message.createdAt ?? message.updatedAt
    return (
      message.role === 'assistant'
      && isAssistantReplyResultStatus(message.status)
      && Boolean(createdAt && createdAt > pendingAfter)
      && !currentMessageIds.has(message.id)
    )
  })
  const newAssistantIds = new Set(newAssistantMessages.map((message) => message.id))

  messages.value = limitLoadedMessages(
    mergeConversationMessages(
      messages.value,
      items.filter((message) => !newAssistantIds.has(message.id)),
    )
  )

  await revealAssistantMessages(newAssistantMessages)
  await scrollToBottom()
}

function hasAssistantReplyResultAfter(items: ConversationMessage[], after: Date) {
  return items.some((message) => {
    const createdAt = message.createdAt ?? message.updatedAt
    return (
      message.role === 'assistant'
      && isAssistantReplyResultStatus(message.status)
      && Boolean(createdAt && createdAt > after)
    )
  })
}

function isAssistantReplyResultStatus(status: string) {
  return status === 'sent' || status === 'failed'
}

function stopReplyPolling() {
  if (replyPollingTimer) {
    clearTimeout(replyPollingTimer)
    replyPollingTimer = null
  }

  replyPollingAfterUserCreatedAt = null
  isWaitingAgentReply.value = false
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

async function scrollToBottom(options: { animated?: boolean } = {}) {
  const animated = options.animated ?? true

  if (scrollToBottomPromise) {
    return scrollToBottomPromise
  }

  scrollToBottomPromise = Promise.resolve()
    .then(async () => {
      scrollWithAnimation.value = animated
      await nextTick()
      scrollIntoViewTarget.value = ''
      await nextTick()
      await new Promise<void>((resolve) => {
        setTimeout(() => {
          scrollWithAnimation.value = animated
          scrollIntoViewTarget.value = 'chat-bottom-anchor'
          resolve()
        }, 0)
      })
    })
    .finally(() => {
      scrollToBottomPromise = null
    })

  return scrollToBottomPromise
}

async function scrollToMessageAnchor(anchorId: string) {
  if (!anchorId) {
    return
  }

  scrollWithAnimation.value = false
  await nextTick()
  scrollIntoViewTarget.value = ''
  await nextTick()
  await new Promise<void>((resolve) => {
    setTimeout(() => {
      scrollWithAnimation.value = false
      scrollIntoViewTarget.value = anchorId
      resolve()
    }, 0)
  })
}

async function waitForHistoryScrollSettle() {
  await nextTick()
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 80)
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

function shouldShowQuotedMessageInRow(
  message: ConversationMessage,
  segmentIndex: number,
  segmentCount: number,
) {
  return (
    message.role === 'user' &&
    message.type === 'text' &&
    segmentIndex === segmentCount - 1 &&
    Boolean(getQuotedMessageText(message))
  )
}

function getQuotedMessageText(message: ConversationMessage) {
  const content = message.quote?.content?.trim()

  if (!content) {
    return ''
  }

  return normalizeEmojiText(content.replace(/\s+/g, ' '))
}

function getQuotedMessageLabel(message: ConversationMessage) {
  const quote = message.quote
  const role = quote?.role?.trim()

  if (role === 'user') {
    return '我'
  }

  if (role === 'assistant') {
    return pageTitle.value
  }

  return ''
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

function hasResolvableVoicePayload(voice?: ConversationVoicePayload) {
  return Boolean(resolveVoiceMessageUrl(voice))
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

function muteVoicePlaybackErrors(durationMs = VOICE_PLAYBACK_ERROR_MUTE_MS) {
  voicePlaybackErrorMutedUntil = Math.max(
    voicePlaybackErrorMutedUntil,
    Date.now() + durationMs
  )
}

function handlePendingAction(name: string) {
  showToast(`${name}待接入`)
}

function handleMemorialPhotoAction() {
  if (!agentId.value) {
    showToast('缺少联系人资料，请从通讯录重新进入')
    return
  }

  if (!conversationId.value) {
    showToast('缺少会话信息，请返回通讯录重新进入')
    return
  }

  hideComposerPanels()
  isInputFocused.value = false
  keyboardHeight.value = 0
  void Taro.hideKeyboard()

  const query = [
    ['conversationId', conversationId.value],
    ['agentId', agentId.value],
    ['agentName', agentName.value.trim() || 'TA'],
  ]
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&')

  void Taro.navigateTo({
    url: `/pages/memorial-photo/index?${query}`,
  })
}

function handleNavMenuSelect() {
  handleAgentAvatarTap()
}

function handleAgentAvatarTap() {
  if (!agentId.value) {
    showToast('缺少联系人资料，请从通讯录重新进入')
    return
  }

  if (!conversationId.value) {
    showToast('缺少会话信息，请返回通讯录重新进入')
    return
  }

  const query = [
    ['conversationId', conversationId.value],
    ['agentId', agentId.value],
    ['agentName', agentName.value.trim() || '对话'],
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

function handleCurrentUserAvatarTap() {
  void Taro.switchTab({
    url: '/pages/me/index',
  })
}

function handleRetry() {
  void refreshMessages({ showLoading: true })
}

function handleDraftInput(event: DraftInputEvent) {
  const detail = 'detail' in event && typeof event.detail === 'object' ? event.detail : undefined
  const rawValue = detail?.value ?? ''
  const nextValue = limitChatText(rawValue)
  const nextCursor = detail?.cursor

  if (nextValue !== rawValue) {
    showToast(`最多输入${CHAT_TEXT_MAX_LENGTH}字`)
  }

  draftMessage.value = nextValue
  isDraftCursorControlled.value = false
  draftCursor.value =
    typeof nextCursor === 'number' && nextCursor >= 0
      ? clampCursor(nextCursor, nextValue)
      : nextValue.length
}

function handleInputFocus() {
  hideMessageActions()
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
  if (isMessageActionTapMuted()) {
    return
  }

  hideMessageActions()
  hideComposerPanels()
}

function hideComposerPanels() {
  isEmojiPanelVisible.value = false
  isMorePanelVisible.value = false
}

function hideMessageActions() {
  const wasVisible = Boolean(activeMessageActionRowKey.value)
  activeMessageActionRowKey.value = ''
  return wasVisible
}

function muteMessageActionTap(durationMs = 350) {
  messageActionTapMutedUntil = Date.now() + durationMs
}

function isMessageActionTapMuted() {
  return Date.now() < messageActionTapMutedUntil
}

function handleMessageTap() {
  if (isMessageActionTapMuted()) {
    return
  }

  if (hideMessageActions()) {
    return
  }
}

function shouldOfferVoiceGeneration(message?: ConversationMessage) {
  return Boolean(
    message
      && message.role === 'assistant'
      && message.type === 'text'
      && message.status === 'sent'
      && !hasResolvableVoicePayload(message.voice),
  )
}

function shouldOfferFeedback(message?: ConversationMessage) {
  return Boolean(
    message
      && message.role === 'assistant'
      && message.type === 'text'
      && message.status === 'sent'
      && !isLocalOnlyMessageId(message.id),
  )
}

function getMessageActionItems(
  message?: ConversationMessage,
  copyText = '',
): MessageActionItem[] {
  if (!message) {
    return []
  }

  if (message.role === 'user') {
    return [
      ...(copyText.trim() ? [QUOTE_MESSAGE_ACTION] : []),
      ...(message.status === 'sent' && !isLocalOnlyMessageId(message.id)
        ? [REMEMBER_MESSAGE_ACTION]
        : []),
      DELETE_MESSAGE_ACTION,
    ]
  }

  return [
    ...(copyText.trim() ? [QUOTE_MESSAGE_ACTION] : []),
    ...(shouldOfferVoiceGeneration(message) ? [GENERATE_VOICE_MESSAGE_ACTION] : []),
    ...(shouldOfferFeedback(message) ? [FEEDBACK_MESSAGE_ACTION] : []),
    DELETE_MESSAGE_ACTION,
  ]
}

async function generateMessageVoice(message: ConversationMessage) {
  if (!conversationId.value || generatingVoiceMessageIds.has(message.id)) {
    if (generatingVoiceMessageIds.has(message.id)) {
      showToast('语音生成中')
    }
    return
  }

  generatingVoiceMessageIds.add(message.id)

  try {
    showToast('语音生成中')
    const updatedMessage = await generateConversationMessageVoice(
      conversationId.value,
      message.id,
    )
    messages.value = messages.value.map((item) =>
      item.id === updatedMessage.id ? updatedMessage : item
    )
    probeMissingAssistantVoiceDurations([updatedMessage])
    showToast('已生成语音')
  } catch (error) {
    if (error instanceof ApiException && error.requiresReLogin) {
      await redirectToAuth()
      return
    }

    showToast(error instanceof ApiException ? error.message : '语音生成失败，请稍后重试')
  } finally {
    generatingVoiceMessageIds.delete(message.id)
  }
}

function handleMessageLongPress(messageId: string, rowKey: string, copyText = '') {
  void showMessageActions(messageId, rowKey, copyText)
}

async function showMessageActions(messageId: string, rowKey: string, copyText = '') {
  const message = messages.value.find((item) => item.id === messageId)
  if (!message) {
    return
  }

  if (hasMultipleDisplayRowsForMessage(messageId)) {
    await showLegacyMessageActionSheet(message, copyText)
    return
  }

  if (activeMessageActionRowKey.value === rowKey) {
    hideMessageActions()
    muteMessageActionTap()
    return
  }

  hideComposerPanels()
  isInputFocused.value = false
  keyboardHeight.value = 0
  void Taro.hideKeyboard()
  activeMessageActionRowKey.value = rowKey
  muteMessageActionTap()
}

function hasMultipleDisplayRowsForMessage(messageId: string) {
  return (messageDisplayRowCounts.value.get(messageId) ?? 0) > 1
}

async function showLegacyMessageActionSheet(message: ConversationMessage, copyText = '') {
  const actions = getMessageActionItems(message, copyText)
  if (!actions.length) {
    return
  }

  hideMessageActions()
  hideComposerPanels()
  isInputFocused.value = false
  keyboardHeight.value = 0
  void Taro.hideKeyboard()

  try {
    const result = await Taro.showActionSheet({
      itemList: actions.map((action) => action.label),
      ...(actions.length === 1 && actions[0].key === 'delete'
        ? { itemColor: '#e54d42' }
        : {}),
    })
    const action = actions[result.tapIndex]

    if (action) {
      await runMessageAction(message, action.key, copyText)
    }
  } catch {}
}

async function handleMessageActionTap(
  messageId: string,
  action: MessageActionKey,
  copyText = '',
) {
  const message = messages.value.find((item) => item.id === messageId)
  hideMessageActions()

  if (!message) {
    return
  }

  await runMessageAction(message, action, copyText)
}

async function runMessageAction(
  message: ConversationMessage,
  action: MessageActionKey,
  copyText = '',
) {
  if (action === 'quote') {
    quoteMessageContent(message, copyText)
    return
  }

  if (action === 'generateVoice') {
    await generateMessageVoice(message)
    return
  }

  if (action === 'feedback') {
    openFeedbackPopup(message)
    return
  }

  if (action === 'remember') {
    await rememberMessageInConversation(message)
    return
  }

  if (action === 'delete') {
    await deleteMessageFromConversation(message)
  }
}

function openFeedbackPopup(message: ConversationMessage) {
  if (!shouldOfferFeedback(message)) {
    showToast('回复生成中，稍后再反馈')
    return
  }

  selectedFeedbackMessageId.value = message.id
  selectedFeedbackType.value = 'unlike'
  feedbackContent.value = ''
  isFeedbackPopupVisible.value = true
}

function closeFeedbackPopup() {
  if (isSubmittingFeedback.value) {
    return
  }

  isFeedbackPopupVisible.value = false
}

function handleFeedbackContentInput(event: InputEvent | { detail?: { value?: string } }) {
  const value = 'detail' in event ? event.detail?.value : undefined
  feedbackContent.value = typeof value === 'string' ? value : ''
}

function buildFeedbackPayload() {
  if (selectedFeedbackType.value !== 'accurate') {
    return {
      type: selectedFeedbackType.value,
      content: feedbackContent.value,
    }
  }

  const content = feedbackContent.value.trim()

  return {
    type: 'other' as const,
    content: content ? `很贴切。${content}` : '很贴切',
  }
}

async function handleFeedbackSubmit() {
  if (
    !conversationId.value ||
    !selectedFeedbackMessageId.value ||
    isSubmittingFeedback.value
  ) {
    return
  }

  isSubmittingFeedback.value = true
  const currentConversationId = conversationId.value
  const currentFeedbackMessageId = selectedFeedbackMessageId.value
  const payload = buildFeedbackPayload()

  isFeedbackPopupVisible.value = false
  isSubmittingFeedback.value = false
  showToast('已收到反馈')

  void submitConversationMessageFeedback(
    currentConversationId,
    currentFeedbackMessageId,
    payload,
  ).catch(async (error) => {
    if (error instanceof ApiException && error.requiresReLogin) {
      await redirectToAuth()
      return
    }

    console.warn('[chat] feedback submission failed', error)
  })
}

function quoteMessageContent(message: ConversationMessage, content: string) {
  const text = content.trim()
  if (!text) {
    return
  }

  if (message.status !== 'sent' || isLocalOnlyMessageId(message.id)) {
    showToast('消息发送中，暂不能引用')
    return
  }

  quotedMessageId.value = message.id
  quotedMessageText.value = text
  quotedMessageLabel.value = message.role === 'user' ? '引用自己' : `引用${pageTitle.value}`
  isVoiceMode.value = false
  hideComposerPanels()
}

function clearQuotedMessage() {
  quotedMessageId.value = ''
  quotedMessageText.value = ''
  quotedMessageLabel.value = '引用'
}

function restoreQuotedMessageFromOptions(options: {
  restoreQuoteMessageId?: string
  restoreQuoteText?: string
  restoreQuoteLabel?: string
}) {
  if (!options.restoreQuoteMessageId || !options.restoreQuoteText) {
    return
  }

  quotedMessageId.value = options.restoreQuoteMessageId
  quotedMessageText.value = options.restoreQuoteText
  quotedMessageLabel.value = options.restoreQuoteLabel || '引用'
}

async function rememberMessageInConversation(message: ConversationMessage) {
  if (message.role !== 'user') {
    return
  }

  if (message.status !== 'sent' || isLocalOnlyMessageId(message.id)) {
    showToast('消息发送中，暂不能记忆')
    return
  }

  if (!conversationId.value) {
    return
  }

  try {
    await markConversationMessageMemory(conversationId.value, message.id)
    showToast('Ta 会永远记住这句话的')
  } catch (error) {
    if (error instanceof ApiException && error.requiresReLogin) {
      await redirectToAuth()
      return
    }

    if (error instanceof ApiException && error.code === 'RESOURCE_NOT_FOUND') {
      showToast('Ta 会永远记住这句话的')
      return
    }

    showToast(error instanceof ApiException ? error.message : '记忆失败，请稍后重试')
  }
}

async function deleteMessageFromConversation(message: ConversationMessage) {
  if (message.status === 'sending') {
    showToast('消息发送中，暂不能删除')
    return
  }

  if (isLocalOnlyMessageId(message.id)) {
    if (message.status === 'failed') {
      removeMessageFromState(message.id)
      return
    }

    showToast('消息发送中，暂不能删除')
    return
  }

  if (!conversationId.value || deletingMessageIds.has(message.id)) {
    return
  }

  deletingMessageIds.add(message.id)

  try {
    await deleteConversationMessage(conversationId.value, message.id)
    removeMessageFromState(message.id)
    showToast('已删除')
  } catch (error) {
    if (error instanceof ApiException && error.requiresReLogin) {
      await redirectToAuth()
      return
    }

    showToast(error instanceof ApiException ? error.message : '删除失败，请稍后重试')
  } finally {
    deletingMessageIds.delete(message.id)
  }
}

function removeMessageFromState(messageId: string) {
  const removedMessage = messages.value.find((message) => message.id === messageId)

  hideMessageActions()

  if (activeVoiceMessageId.value === messageId) {
    stopVoicePlayback({ muteErrors: true })
  }

  const nextMessages = messages.value.filter((message) => message.id !== messageId)
  messages.value = nextMessages

  if (removedMessage?.role === 'user') {
    resumePendingReplyPollingFromMessages(nextMessages)
  }
}

function isLocalOnlyMessageId(messageId: string) {
  return messageId.startsWith('local-')
}

function handleKeyboardHeightChange(event: { detail?: { height?: number } }) {
  keyboardHeight.value = event.detail?.height ?? 0

  if (keyboardHeight.value <= 0) {
    isInputFocused.value = false
  }

  void scrollToBottom()
}

useDidShow(() => {
  isChatPageVisible = true
  muteVoicePlaybackErrors(800)
  preloadVipCenterWhenAuthenticated()
})

function preloadVipCenterWhenAuthenticated() {
  if (authSession.value) {
    preloadVipPurchaseCenter()
  }
}

useDidHide(() => {
  isChatPageVisible = false
  stopReplyPolling()
  isInputFocused.value = false
  keyboardHeight.value = 0
  isEmojiPanelVisible.value = false
  isMorePanelVisible.value = false
  activeMessageActionRowKey.value = ''
  clearVoiceStartTimer()
  if (isVoiceRecording.value) {
    void finishVoiceGesture({ cancelledBySystem: true })
  } else {
    resetVoiceGestureState()
  }
  destroyVoiceAudioContext({ muteErrors: true })
})

useUnload(() => {
  isChatPageVisible = false
  stopReplyPolling()
  clearAssistantSegmentRevealTimers()
  clearVoiceStartTimer()
  if (isVoiceRecording.value) {
    try {
      recorderManager.stop()
    } catch {}
  }
  destroyVoiceAudioContext({ muteErrors: true })
})

async function handleVoiceModeToggle() {
  if (
    isSending.value ||
    isWaitingAgentReply.value ||
    isTranscribingVoice.value ||
    isVoiceGestureActive.value ||
    isCheckingRecordPermission.value
  ) {
    return
  }

  const nextIsVoiceMode = !isVoiceMode.value
  if (nextIsVoiceMode && !(await ensureRecordPermission())) {
    return
  }

  hideMessageActions()
  isVoiceMode.value = nextIsVoiceMode
  isEmojiPanelVisible.value = false
  isMorePanelVisible.value = false
  isInputFocused.value = false
  keyboardHeight.value = 0
  void Taro.hideKeyboard()
  void scrollToBottom()
}

function handleVoiceTouchStart(event: VoiceTouchEvent) {
  if (
    !isVoiceMode.value ||
    isSending.value ||
    isWaitingAgentReply.value ||
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

function handleVoiceTouchMove(event: VoiceTouchEvent) {
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

function handleVoiceTouchEnd(event: VoiceTouchEvent) {
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

function getTouchPoint(event: VoiceTouchEvent): TouchPoint | null {
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
  if (isCheckingRecordPermission.value) {
    return false
  }

  isCheckingRecordPermission.value = true

  try {
    const hasPrivacyAuthorization = await ensureVoicePrivacyAuthorization()

    if (!hasPrivacyAuthorization) {
      return false
    }

    const wechatAppMicStatus = getWechatAppMicrophoneAuthorizeStatus()

    if (wechatAppMicStatus === 'denied') {
      const hasWechatAppMicPermission = await showWechatAppMicrophoneSettingPrompt()

      if (!hasWechatAppMicPermission) {
        return false
      }
    }

    const setting = await Taro.getSetting()
    const authSetting = setting.authSetting as Record<string, boolean | undefined>

    if (authSetting['scope.record']) {
      return true
    }

    if (authSetting['scope.record'] === false) {
      return await showRecordPermissionSettingPrompt()
    }

    return await requestRecordPermission()
  } catch {
    showRecordPermissionUnavailablePrompt()
    return false
  } finally {
    isCheckingRecordPermission.value = false
  }
}

async function ensureVoicePrivacyAuthorization() {
  if (voicePrivacyAuthorizationPromise) {
    return await voicePrivacyAuthorizationPromise
  }

  voicePrivacyAuthorizationPromise = doEnsureVoicePrivacyAuthorization()

  try {
    return await voicePrivacyAuthorizationPromise
  } finally {
    voicePrivacyAuthorizationPromise = null
  }
}

async function doEnsureVoicePrivacyAuthorization() {
  const privacyApi = Taro as TaroPrivacyApi

  if (
    typeof privacyApi.getPrivacySetting !== 'function' ||
    typeof privacyApi.requirePrivacyAuthorize !== 'function'
  ) {
    return true
  }

  const privacySetting = await getVoicePrivacySetting()
  const contractName = privacySetting.privacyContractName?.trim()

  if (contractName) {
    voicePrivacyContractName.value = `《${contractName}》`
  }

  if (!privacySetting.needAuthorization) {
    return true
  }

  return await requestVoicePrivacyAuthorization()
}

function getVoicePrivacySetting() {
  const privacyApi = Taro as TaroPrivacyApi

  return new Promise<VoicePrivacySettingResult>((resolve, reject) => {
    privacyApi.getPrivacySetting?.({
      success: resolve,
      fail: reject,
    })
  }).catch(() => ({}))
}

function requestVoicePrivacyAuthorization() {
  const privacyApi = Taro as TaroPrivacyApi

  return new Promise<boolean>((resolve) => {
    privacyApi.requirePrivacyAuthorize?.({
      success: () => {
        isVoicePrivacyDialogVisible.value = false
        resolve(true)
      },
      fail: (error) => {
        const message = describeRecorderErrorForUser(error)

        if (message) {
          showToast(message)
        }

        resolve(false)
      },
    })
  })
}

function registerVoicePrivacyAuthorizationListener() {
  const privacyApi = Taro as TaroPrivacyApi

  if (typeof privacyApi.onNeedPrivacyAuthorization !== 'function') {
    return
  }

  privacyApi.onNeedPrivacyAuthorization((resolve) => {
    pendingVoicePrivacyResolves.push(resolve)
    isVoicePrivacyDialogVisible.value = true

    try {
      resolve({
        event: 'exposureAuthorization',
      })
    } catch {}
  })
}

function handleVoicePrivacyAgree() {
  resolveVoicePrivacyAuthorization('agree')
}

function handleVoicePrivacyDisagree() {
  resolveVoicePrivacyAuthorization('disagree')
}

function handleVoicePrivacyContractTap() {
  const privacyApi = Taro as TaroPrivacyApi

  if (typeof privacyApi.openPrivacyContract !== 'function') {
    return
  }

  privacyApi.openPrivacyContract({
    fail: () => {
      showToast('隐私保护指引打开失败，请稍后重试')
    },
  })
}

function resolveVoicePrivacyAuthorization(event: 'agree' | 'disagree') {
  const resolves = pendingVoicePrivacyResolves
  pendingVoicePrivacyResolves = []
  isVoicePrivacyDialogVisible.value = false

  resolves.forEach((resolve) => {
    try {
      if (event === 'agree') {
        resolve({
          event,
          buttonId: VOICE_PRIVACY_AGREE_BUTTON_ID,
        })
        return
      }

      resolve({
        event,
      })
    } catch {}
  })
}

function getWechatAppMicrophoneAuthorizeStatus(): WechatAppMicrophoneAuthorizeStatus {
  const taroSystemPermission = Taro as TaroSystemPermissionApi

  if (typeof taroSystemPermission.getAppAuthorizeSetting === 'function') {
    try {
      const status = normalizeWechatAppMicrophoneAuthorizeStatus(
        taroSystemPermission.getAppAuthorizeSetting().microphoneAuthorized
      )

      if (status !== 'unknown') {
        return status
      }
    } catch {
      // Fall through to the legacy system info field for older clients.
    }
  }

  if (typeof taroSystemPermission.getSystemInfoSync === 'function') {
    try {
      return normalizeWechatAppMicrophoneAuthorizeStatus(
        taroSystemPermission.getSystemInfoSync().microphoneAuthorized
      )
    } catch {
      return 'unknown'
    }
  }

  return 'unknown'
}

function normalizeWechatAppMicrophoneAuthorizeStatus(
  value: unknown
): WechatAppMicrophoneAuthorizeStatus {
  if (value === 'authorized' || value === true) {
    return 'authorized'
  }

  if (value === 'denied' || value === false) {
    return 'denied'
  }

  if (value === 'not determined' || value === 'non determined') {
    return 'not determined'
  }

  return 'unknown'
}

async function requestRecordPermission() {
  const result = await Taro.showModal({
    title: '开启语音授权',
    content: '需要开启麦克风权限后才能发送语音消息和语音转文字',
    confirmText: '开启',
    cancelText: '取消',
    confirmColor: '#22c55e',
  })

  if (!result.confirm) {
    return false
  }

  try {
    await Taro.authorize({ scope: 'scope.record' })
    return true
  } catch {
    const setting = await Taro.getSetting()
    const authSetting = setting.authSetting as Record<string, boolean | undefined>

    if (authSetting['scope.record'] === false) {
      return await showRecordPermissionSettingPrompt()
    }

    showRecordPermissionUnavailablePrompt()
    return false
  }
}

async function showWechatAppMicrophoneSettingPrompt() {
  const result = await Taro.showModal({
    title: '无法开启麦克风',
    content: '请在手机系统设置中允许微信使用麦克风后，再回到小程序发送语音',
    confirmText: '去设置',
    cancelText: '取消',
    confirmColor: '#22c55e',
  })

  if (!result.confirm) {
    return false
  }

  const taroSystemPermission = Taro as TaroSystemPermissionApi

  if (typeof taroSystemPermission.openAppAuthorizeSetting === 'function') {
    try {
      await taroSystemPermission.openAppAuthorizeSetting({})
    } catch {
      showRecordPermissionUnavailablePrompt()
      return false
    }
  } else {
    showRecordPermissionUnavailablePrompt()
    return false
  }

  return getWechatAppMicrophoneAuthorizeStatus() !== 'denied'
}

async function showRecordPermissionSettingPrompt() {
  const result = await Taro.showModal({
    title: '麦克风权限未开启',
    content: '需要开启麦克风权限后才能发送语音消息和语音转文字',
    confirmText: '去开启',
    cancelText: '取消',
    confirmColor: '#22c55e',
  })

  if (!result.confirm) {
    return false
  }

  try {
    const setting = await Taro.openSetting()
    const authSetting = setting.authSetting as Record<string, boolean | undefined>
    return Boolean(authSetting['scope.record'])
  } catch {
    return false
  }
}

function showRecordPermissionUnavailablePrompt() {
  void Taro.showModal({
    title: '无法开启麦克风',
    content: '请在手机系统设置中允许微信使用麦克风后，再回到小程序发送语音',
    confirmText: '知道了',
    showCancel: false,
    confirmColor: '#22c55e',
  })
}

function normalizeRecorderErrorMessage(error: unknown) {
  if (!error) {
    return ''
  }

  if (typeof error === 'string') {
    return error.trim()
  }

  if (error instanceof Error) {
    return error.message.trim()
  }

  const errMsg = (error as RecorderErrorLike).errMsg
  return typeof errMsg === 'string' ? errMsg.trim() : ''
}

function describeRecorderErrorForUser(error: unknown) {
  const message = normalizeRecorderErrorMessage(error) || lastRecorderErrorMessage

  if (!message) {
    return ''
  }

  if (/privacy|隐私/i.test(message)) {
    return '请先同意隐私保护指引后再发送语音'
  }

  if (/auth|authorize|permission|scope\.record|麦克风|录音权限/i.test(message)) {
    return '请在权限设置中允许使用麦克风后再发送语音'
  }

  if (/interruption|interrupt|occupied|takeover|system|background|中断|占用/i.test(message)) {
    return '录音被系统中断，请稍后重试'
  }

  return ''
}

function showRecorderFailureToast(error?: unknown) {
  showToast(describeRecorderErrorForUser(error) || '录音失败，请稍后重试')
}

async function startVoiceRecording() {
  if (
    !isVoicePressPreviewing.value ||
    isVoiceRecording.value ||
    isSending.value ||
    isWaitingAgentReply.value ||
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
    lastRecorderErrorMessage = ''
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
  } catch (error) {
    resetVoiceGestureState()
    showToast(describeRecorderErrorForUser(error) || '录音启动失败，请稍后重试')
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
  let recorderError: unknown
  try {
    recorded = await stopRecorder()
  } catch (error) {
    recorderError = error
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
    showRecorderFailureToast(recorderError)
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
  hideMessageActions()
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
  hideMessageActions()
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

  if (action === 'memorial-photo') {
    handleMemorialPhotoAction()
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
  const limitedValue = limitChatText(nextValue)

  if (limitedValue !== nextValue) {
    showToast(`最多输入${CHAT_TEXT_MAX_LENGTH}字`)
  }

  draftMessage.value = limitedValue
  setDraftCursor(clampCursor(cursor + emoji.length, limitedValue))
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
  setDraftCursor(nextLeft.length)
}

function setDraftCursor(cursor: number) {
  draftCursor.value = cursor
  isDraftCursorControlled.value = true
  setTimeout(() => {
    isDraftCursorControlled.value = false
  }, 80)
}

function clampCursor(cursor: number, value: string) {
  if (!Number.isFinite(cursor)) {
    return value.length
  }

  return Math.min(Math.max(Math.floor(cursor), 0), value.length)
}

function limitChatText(value: string) {
  const chars = Array.from(value)

  if (chars.length <= CHAT_TEXT_MAX_LENGTH) {
    return value
  }

  return chars.slice(0, CHAT_TEXT_MAX_LENGTH).join('')
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
  const content = limitChatText(draftMessage.value.trim())
  if (
    !content
    || isTextSendSubmitting.value
    || isSending.value
    || isCheckingChatQuota.value
    || isTranscribingVoice.value
    || !conversationId.value
  ) {
    return
  }

  if (!(await ensureChatQuotaAvailableBeforeSend())) {
    return
  }

  hideMessageActions()

  if (content !== draftMessage.value.trim()) {
    showToast(`最多输入${CHAT_TEXT_MAX_LENGTH}字`)
  }

  const originalDraft = limitChatText(draftMessage.value)
  const originalDraftCursor = clampCursor(draftCursor.value, originalDraft)
  const originalQuotedMessageId = quotedMessageId.value
  const originalQuotedMessageText = quotedMessageText.value
  const originalQuotedMessageLabel = quotedMessageLabel.value

  draftMessage.value = ''
  draftCursor.value = 0
  clearQuotedMessage()
  await sendTextMessageContent(content, {
    restoreDraft: originalDraft,
    restoreCursor: originalDraftCursor,
    restoreQuoteMessageId: originalQuotedMessageId,
    restoreQuoteText: originalQuotedMessageText,
    restoreQuoteLabel: originalQuotedMessageLabel,
    skipQuotaCheck: true,
  })
}

async function sendTextMessageContent(
  content: string,
  options: {
    restoreDraft?: string
    restoreCursor?: number
    restoreQuoteMessageId?: string
    restoreQuoteText?: string
    restoreQuoteLabel?: string
    skipQuotaCheck?: boolean
  } = {},
) {
  if (!options.skipQuotaCheck && !(await ensureChatQuotaAvailableBeforeSend())) {
    if (typeof options.restoreDraft === 'string') {
      draftMessage.value = options.restoreDraft
      draftCursor.value = options.restoreCursor ?? options.restoreDraft.length
      restoreQuotedMessageFromOptions(options)
    }
    return
  }

  const tempId = `local-${Date.now()}`

  isTextSendSubmitting.value = true
  isMorePanelVisible.value = false
  isViewingHistoryWindow.value = false
  messages.value = limitLoadedMessages([
    ...messages.value,
    {
      id: tempId,
      conversationId: conversationId.value,
      role: 'user',
      type: 'text',
      content,
      segments: [content],
      status: 'sending',
      quote: options.restoreQuoteMessageId
        ? {
            messageId: options.restoreQuoteMessageId,
            role: options.restoreQuoteLabel === '引用自己' ? 'user' : 'assistant',
            content: options.restoreQuoteText,
          }
        : undefined,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ])
  await scrollToBottom()

  try {
    const result = await sendTextMessageWithQuoteFallback(content, {
      quotedMessageId: options.restoreQuoteMessageId,
    })

    await appendConversationResult(tempId, result)
    if (result.replyPending) {
      const pendingAfter = result.userMessage.createdAt ?? result.userMessage.updatedAt ?? new Date()
      startReplyPolling(pendingAfter)
    }
    loadError.value = ''
    await scrollToBottom()
  } catch (error) {
    isTextSendSubmitting.value = false

    if (error instanceof ApiException && error.requiresReLogin) {
      await redirectToAuth()
      return
    }

    if (isChatQuotaLimitError(error)) {
      if (typeof options.restoreDraft === 'string') {
        draftMessage.value = options.restoreDraft
        draftCursor.value = options.restoreCursor ?? options.restoreDraft.length
        restoreQuotedMessageFromOptions(options)
      }
      messages.value = messages.value.filter((message) => message.id !== tempId)
      showChatQuotaExhaustedDialog()
      await scrollToBottom()
      return
    }

    if (typeof options.restoreDraft === 'string') {
      draftMessage.value = options.restoreDraft
      draftCursor.value = options.restoreCursor ?? options.restoreDraft.length
      restoreQuotedMessageFromOptions(options)
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

  isTextSendSubmitting.value = false
}

async function sendTextMessageWithQuoteFallback(
  content: string,
  options: { quotedMessageId?: string } = {},
) {
  try {
    return await sendConversationMessageAsync(conversationId.value, {
      content,
      type: 'text',
      quotedMessageId: options.quotedMessageId,
    })
  } catch (error) {
    if (
      !options.quotedMessageId ||
      (error instanceof ApiException &&
        (error.requiresReLogin || isChatQuotaLimitError(error)))
    ) {
      throw error
    }

    return sendConversationMessageAsync(conversationId.value, {
      content,
      type: 'text',
    })
  }
}

async function pickAndSendImage(sourceType: ChatImageSourceType) {
  if (
    isSending.value
    || isWaitingAgentReply.value
    || isCheckingChatQuota.value
    || isTranscribingVoice.value
    || !conversationId.value
  ) {
    return
  }

  if (!(await ensureChatQuotaAvailableBeforeSend())) {
    return
  }

  isPickingChatImage = true
  muteVoicePlaybackErrors()
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
  if (!sourcePath || isSending.value || isWaitingAgentReply.value || !conversationId.value) {
    return
  }

  const fileName = image.fileName
  const mimeType = image.mimeType
  const tempId = `local-image-${Date.now()}`
  const now = new Date()

  isSending.value = true
  isMorePanelVisible.value = false
  isViewingHistoryWindow.value = false
  messages.value = limitLoadedMessages([
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
  ])
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

    const result = await sendConversationMessageAsync(conversationId.value, {
      type: 'image',
      objectKey: uploaded.objectKey,
      mimeType,
    })

    await appendConversationResult(tempId, result)
    if (result.replyPending) {
      const pendingAfter = result.userMessage.createdAt ?? result.userMessage.updatedAt ?? new Date()
      startReplyPolling(pendingAfter)
    }
    loadError.value = ''
    await scrollToBottom()
  } catch (error) {
    if (error instanceof ApiException && error.requiresReLogin) {
      await redirectToAuth()
      return
    }

    if (isChatQuotaLimitError(error)) {
      messages.value = messages.value.filter((message) => message.id !== tempId)
      showChatQuotaExhaustedDialog()
      await scrollToBottom()
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
  if (
    !sourcePath
    || isSending.value
    || isWaitingAgentReply.value
    || isCheckingChatQuota.value
    || !conversationId.value
  ) {
    return
  }

  if (!(await ensureChatQuotaAvailableBeforeSend())) {
    return
  }

  const mimeType = 'audio/aac'
  const tempId = `local-voice-${Date.now()}`
  const now = new Date()

  isSending.value = true
  isMorePanelVisible.value = false
  isViewingHistoryWindow.value = false
  messages.value = limitLoadedMessages([
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
  ])
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

    const result = await sendConversationMessageAsync(conversationId.value, {
      type: 'voice',
      objectKey: uploaded.objectKey,
      mimeType,
      durationMs,
    })

    await appendConversationResult(tempId, result)
    if (result.replyPending) {
      const pendingAfter = result.userMessage.createdAt ?? result.userMessage.updatedAt ?? new Date()
      startReplyPolling(pendingAfter)
    }
    loadError.value = ''
    await scrollToBottom()
  } catch (error) {
    if (error instanceof ApiException && error.requiresReLogin) {
      await redirectToAuth()
      return
    }

    if (isChatQuotaLimitError(error)) {
      messages.value = messages.value.filter((message) => message.id !== tempId)
      showChatQuotaExhaustedDialog()
      await scrollToBottom()
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
  if (
    !sourcePath
    || isSending.value
    || isWaitingAgentReply.value
    || isCheckingChatQuota.value
    || !conversationId.value
  ) {
    return
  }

  if (!(await ensureChatQuotaAvailableBeforeSend())) {
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

async function handleVoiceMessageTap(messageId: string) {
  hideMessageActions()

  const message = messages.value.find((item) => item.id === messageId)
  if (!message) {
    return
  }

  const sourceUrl = resolveVoiceMessageUrl(message.voice)
  if (!sourceUrl) {
    showToast('语音文件不可用')
    return
  }

  voicePlaybackErrorMutedUntil = 0
  await ensureInnerAudioPlaybackOptions()
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
    if (message.id !== messageId || !message.voice) {
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
      !message.voice ||
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
    const failedMessageId = activeVoiceMessageId.value
    isVoicePlaying.value = false
    isVoicePlaybackLoading.value = false
    activeVoiceMessageId.value = ''
    if (
      !failedMessageId ||
      !isChatPageVisible ||
      isPickingChatImage ||
      Date.now() < voicePlaybackErrorMutedUntil
    ) {
      return
    }
    showToast('语音播放失败，请稍后重试')
  })
  voiceAudioContext = audio

  return audio
}

function stopVoicePlayback(options: { muteErrors?: boolean } = {}) {
  if (!voiceAudioContext) {
    return
  }

  if (options.muteErrors) {
    muteVoicePlaybackErrors()
  }

  try {
    voiceAudioContext.stop()
  } catch {}
  activeVoiceMessageId.value = ''
  isVoicePlaying.value = false
  isVoicePlaybackLoading.value = false
}

function destroyVoiceAudioContext(options: { muteErrors?: boolean } = {}) {
  if (options.muteErrors) {
    muteVoicePlaybackErrors()
  }

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

.chat-page__settings-icon {
  position: relative;
  width: 16px;
  height: 16px;
}

.chat-page__settings-ring,
.chat-page__settings-ring::before,
.chat-page__settings-ring::after {
  content: '';
  position: absolute;
  left: 1.5px;
  right: 1.5px;
  height: 2px;
  border-radius: 999px;
  background: #111111;
}

.chat-page__settings-ring {
  top: 2px;
}

.chat-page__settings-ring::before {
  top: 5.5px;
}

.chat-page__settings-ring::after {
  top: 11px;
}

.chat-page__settings-dot,
.chat-page__settings-dot::before,
.chat-page__settings-dot::after {
  content: '';
  position: absolute;
  width: 4.5px;
  height: 4.5px;
  border: 1px solid #111111;
  border-radius: 50%;
  box-sizing: border-box;
  background: #ffffff;
}

.chat-page__settings-dot {
  top: 0.75px;
  right: 2.5px;
}

.chat-page__settings-dot::before {
  top: 5.5px;
  left: -9px;
}

.chat-page__settings-dot::after {
  top: 11px;
  left: 0;
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
  position: relative;
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

.chat-feedback-popup {
  padding: 24px 20px 18px;
  background: #ffffff;
  box-sizing: border-box;
}

.chat-feedback-popup__title {
  font-size: 18px;
  line-height: 26px;
  font-weight: 700;
  color: #111111;
}

.chat-feedback-popup__desc {
  margin-top: 4px;
  font-size: 13px;
  line-height: 20px;
  color: #667085;
}

.chat-feedback-popup__options {
  margin-top: 18px;
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.chat-feedback-popup__option {
  min-width: 82px;
  height: 36px;
  padding: 0 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  background: #ffffff;
  box-sizing: border-box;
  font-size: 14px;
  line-height: 20px;
  color: #344054;
}

.chat-feedback-popup__option--active {
  border-color: #111111;
  background: #111111;
  color: #ffffff;
  font-weight: 600;
}

.chat-feedback-popup__textarea {
  margin-top: 16px;
  width: 100%;
  height: 92px;
  padding: 10px 12px;
  border-radius: 6px;
  background: #f6f7f8;
  box-sizing: border-box;
  font-size: 14px;
  line-height: 20px;
  color: #111111;
}

.chat-feedback-popup__textarea-placeholder {
  color: #98a2b3;
}

.chat-feedback-popup__footer {
  margin-top: 18px;
  display: flex;
  gap: 10px;
}

.chat-feedback-popup__cancel,
.chat-feedback-popup__submit {
  height: 44px;
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  font-size: 15px;
  line-height: 22px;
  font-weight: 600;
}

.chat-feedback-popup__cancel {
  background: #f2f4f7;
  color: #344054;
}

.chat-feedback-popup__submit {
  background: #111111;
  color: #ffffff;
}

.chat-feedback-popup__submit--disabled {
  opacity: 0.56;
}

.chat-message-list {
  position: relative;
  display: flex;
  flex-direction: column;
  padding: 0 12px 24px;
  box-sizing: border-box;
}

.chat-message-list__history-status {
  margin: 2px auto 12px;
  padding: 4px 10px;
  min-height: 18px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.72);
  font-size: 12px;
  line-height: 18px;
  color: #9a9a9a;
}

.chat-message-list__history-status--action {
  color: #576b95;
}

.chat-message-list__history-status--hidden {
  visibility: hidden;
  pointer-events: none;
}

.chat-message-list__time {
  margin-bottom: 14px;
  text-align: center;
  font-size: 12px;
  line-height: 16px;
  color: #9b9b9b;
}

.chat-message-list__system {
  margin-bottom: 14px;
  text-align: center;
  font-size: 12px;
  line-height: 16px;
  color: #9b9b9b;
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

.chat-page__ai-watermark {
  position: absolute;
  right: 22px;
  bottom: 12px;
  z-index: 2;
  pointer-events: none;
  font-size: 11px;
  line-height: 16px;
  font-weight: 500;
  color: rgba(17, 17, 17, 0.36);
}

.chat-bottom {
  background: #f7f7f7;
}

.chat-composer-backdrop {
  position: fixed;
  inset: 0;
  z-index: 9;
  background: transparent;
}

.chat-row {
  --chat-message-bubble-max-width: 264px;
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-bottom: 12px;
}

.chat-row--agent {
  --chat-message-bubble-max-width: calc(100vw - 128px);
}

.chat-row--user {
  justify-content: flex-end;
}

.chat-message-unit {
  position: relative;
  display: flex;
  min-width: 0;
  max-width: var(--chat-message-bubble-max-width, 264px);
  flex-direction: column;
  align-items: flex-start;
}

.chat-message-unit--user {
  align-items: flex-end;
}

.chat-message-actions {
  position: absolute;
  bottom: calc(100% + 8px);
  z-index: 8;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.chat-message-actions--agent {
  left: 0;
}

.chat-message-actions--user {
  right: 0;
}

.chat-message-actions__panel {
  display: flex;
  min-width: 68px;
  max-width: calc(100vw - 32px);
  height: 42px;
  overflow: hidden;
  border-radius: 6px;
  background: rgba(22, 22, 22, 0.96);
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.22);
}

.chat-message-actions__button {
  display: flex;
  min-width: 68px;
  height: 42px;
  padding: 0 16px;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  color: #ffffff;
  font-size: 15px;
  line-height: 22px;
  white-space: nowrap;
}

.chat-message-actions__button + .chat-message-actions__button {
  border-left: 1px solid rgba(255, 255, 255, 0.14);
}

.chat-message-actions__arrow {
  width: 10px;
  height: 10px;
  margin-top: -5px;
  border-radius: 1px;
  background: rgba(22, 22, 22, 0.96);
  transform: rotate(45deg);
}

.chat-message-actions--agent .chat-message-actions__arrow {
  margin-left: 24px;
  align-self: flex-start;
}

.chat-message-actions--user .chat-message-actions__arrow {
  margin-right: 24px;
  align-self: flex-end;
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
  border-radius: 4px;
  background: #eef2f7;
}

.chat-avatar--user {
  width: 40px;
  height: 40px;
  border-radius: 4px;
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
  min-height: 52px;
  padding: 6px 8px;
  box-sizing: border-box;
  background: #f7f7f7;
  border-top: 0.5px solid #d9d9d9;
}

.chat-composer__icon-button {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  flex-shrink: 0;
}

.chat-composer__input-shell {
  flex: 1;
  min-width: 0;
  height: 36px;
  padding: 0 10px;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  border: 0.5px solid #e5e5e5;
  border-radius: 5px;
  background: #ffffff;
}

.chat-composer__voice-button {
  flex: 1;
  min-width: 0;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 0.5px solid #e5e5e5;
  border-radius: 5px;
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
  width: 48px;
  height: 32px;
  flex-shrink: 0;
  border-radius: 4px;
  background: #07c160;
  color: #ffffff;
  font-size: 14px;
  line-height: 20px;
  font-weight: 600;
}

.chat-composer__send--disabled {
  opacity: 0.6;
}

.chat-quota-dialog.nut-dialog {
  width: 283px;
  min-height: 176px;
  padding: 17px 18px 16px;
  box-sizing: border-box;
  border-radius: 16px;
}

.chat-quota-dialog .nut-dialog__header {
  height: 22px;
  font-size: 16px;
  line-height: 22px;
  font-weight: 600;
  color: #000000;
}

.chat-quota-dialog .nut-dialog__content {
  width: 100%;
  margin: 12px 0 10px;
  max-height: none;
  overflow: visible;
  color: #000000;
  font-size: 12px;
  line-height: 22px;
  text-align: left;
}

.chat-quota-dialog__content {
  width: 100%;
  color: #000000;
  font-size: 12px;
  line-height: 22px;
  word-break: break-word;
}

.chat-quota-dialog .nut-dialog__footer {
  width: 100%;
  justify-content: space-between;
}

.chat-quota-dialog__footer {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.chat-quota-dialog__footer--single {
  justify-content: center;
}

.chat-quota-dialog__secondary,
.chat-quota-dialog__primary {
  width: 104px;
  height: 36px;
  border-radius: 58px;
  text-align: center;
  font-size: 14px;
  line-height: 36px;
  font-weight: 500;
  letter-spacing: 0.1172px;
  box-sizing: border-box;
}

.chat-quota-dialog__secondary {
  background: #f6f6f6;
  color: #6b6b6b;
}

.chat-quota-dialog__primary {
  background: linear-gradient(90deg, #ffa404 0%, #fd5747 100%);
  color: #ffffff;
}

.chat-quota-dialog__primary--single {
  flex-shrink: 0;
}

.chat-privacy-dialog.nut-dialog {
  width: 300px;
  min-height: 188px;
  padding: 17px 18px 16px;
  box-sizing: border-box;
  border-radius: 16px;
}

.chat-privacy-dialog .nut-dialog__header {
  height: 22px;
  font-size: 16px;
  line-height: 22px;
  font-weight: 600;
  color: #000000;
}

.chat-privacy-dialog .nut-dialog__content {
  width: 100%;
  margin: 12px 0 10px;
  max-height: none;
  overflow: visible;
  color: #000000;
  font-size: 12px;
  line-height: 22px;
  text-align: left;
}

.chat-privacy-dialog__content {
  width: 100%;
  color: #000000;
  font-size: 12px;
  line-height: 22px;
  word-break: break-word;
}

.chat-privacy-dialog__link {
  margin-top: 8px;
  color: #07c160;
  font-size: 12px;
  line-height: 18px;
}

.chat-privacy-dialog .nut-dialog__footer {
  width: 100%;
  justify-content: space-between;
}

.chat-privacy-dialog__footer {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.chat-privacy-dialog__secondary,
.chat-privacy-dialog__primary {
  width: 116px;
  height: 36px;
  border-radius: 58px;
  text-align: center;
  font-size: 14px;
  line-height: 36px;
  font-weight: 500;
  letter-spacing: 0;
  box-sizing: border-box;
}

.chat-privacy-dialog__secondary {
  background: #f6f6f6;
  color: #6b6b6b;
}

.chat-privacy-dialog__primary {
  display: block;
  margin: 0;
  padding: 0;
  border: 0;
  background: #07c160;
  color: #ffffff;
}

.chat-privacy-dialog__primary::after {
  border: 0;
}

.chat-composer__mic,
.chat-composer__keyboard,
.chat-composer__emoji,
.chat-composer__plus {
  position: relative;
  width: 38px;
  height: 38px;
}

.chat-composer__mic {
  display: flex;
  align-items: center;
  justify-content: center;
}

.chat-composer__mic-icon {
  width: 38px;
  height: 38px;
  display: block;
}

.chat-composer__keyboard {
  display: flex;
  align-items: center;
  justify-content: center;
}

.chat-composer__keyboard-icon {
  width: 38px;
  height: 38px;
  display: block;
}

.chat-composer__emoji {
  display: flex;
  align-items: center;
  justify-content: center;
}

.chat-composer__emoji-icon {
  width: 38px;
  height: 38px;
  display: block;
}

.chat-composer__plus {
  display: flex;
  align-items: center;
  justify-content: center;
}

.chat-composer__plus-icon {
  width: 38px;
  height: 38px;
  display: block;
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
