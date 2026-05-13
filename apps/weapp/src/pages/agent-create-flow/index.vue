<template>
  <page-scaffold
    class="agent-create-flow"
    body-padding="0"
    :safe-area-bottom="false"
    :safe-area-top="false"
    :scroll="false"
  >
    <template #header>
      <app-bar
        class="agent-create-flow__appbar"
        title="创建 Agent"
        background="transparent"
        @back="handleBack"
      />
    </template>

    <video
      :id="agentFlowVideoId"
      class="agent-create-flow__bg"
      :src="agentFlowVideo"
      :poster="agentFlowVideoCover"
      autoplay
      :loop="true"
      :muted="true"
      object-fit="cover"
      :controls="false"
      :show-center-play-btn="false"
      :show-play-btn="false"
      :show-fullscreen-btn="false"
      :enable-progress-gesture="false"
      :enable-play-gesture="false"
      :vslide-gesture="false"
      :show-mute-btn="false"
      @loadedmetadata="playAgentFlowVideo"
      @ended="restartAgentFlowVideo"
    />
    <view class="agent-create-flow__shade" />

    <view class="agent-create-flow__body">
      <view
        class="agent-create-flow__content"
        :class="{ 'agent-create-flow__content--avatar': currentStep === 'avatar' }"
      >
        <view class="agent-create-flow__chat" :style="chatStyle">
          <view class="agent-create-flow__messages">
            <view class="agent-create-flow__message-stack">
              <view class="agent-create-flow__question agent-create-flow__question--current">
                <text class="agent-create-flow__question-text">{{ currentQuestion }}</text>
              </view>

              <template
                v-for="entry in reversedFilledEntries"
                :key="entry.step"
              >
                <view class="agent-create-flow__answer-row">
                  <view class="agent-create-flow__answer">
                    <text class="agent-create-flow__answer-text">{{ entry.answer }}</text>
                  </view>
                </view>
                <view class="agent-create-flow__question" @tap="selectStep(entry.step)">
                  <text class="agent-create-flow__question-text">{{ entry.question }}</text>
                </view>
              </template>
            </view>
          </view>

          <view v-if="currentStep === 'avatar'" class="agent-avatar-card" @tap="handleAvatarTap">
            <view class="agent-avatar-card__inner">
              <image
                v-if="avatarPreviewUrl"
                class="agent-avatar-card__image"
                :src="avatarPreviewUrl"
                mode="aspectFill"
              />
              <view v-else class="agent-avatar-card__placeholder">
                <view class="agent-avatar-card__camera">
                  <view class="agent-avatar-card__camera-body" />
                  <view class="agent-avatar-card__camera-lens" />
                  <view class="agent-avatar-card__camera-plus agent-avatar-card__camera-plus--h" />
                  <view class="agent-avatar-card__camera-plus agent-avatar-card__camera-plus--v" />
                </view>
              </view>
              <view v-if="isUploadingAvatar" class="agent-avatar-card__uploading">
                <view class="agent-avatar-card__spinner" />
              </view>
            </view>
          </view>
        </view>
      </view>
    </view>

    <template #bottom>
      <view class="agent-create-flow__panel" :style="panelStyle">
        <view v-if="currentStep === 'gender'" class="agent-gender-panel">
          <view
            class="agent-gender-panel__option"
            :class="{ 'is-selected': gender === 'male' }"
            @tap="selectGender('male')"
          >
            <text class="agent-gender-panel__label">男</text>
          </view>
          <view
            class="agent-gender-panel__option"
            :class="{ 'is-selected': gender === 'female' }"
            @tap="selectGender('female')"
          >
            <text class="agent-gender-panel__label">女</text>
          </view>
        </view>

        <view v-else-if="currentStep === 'avatar'" class="agent-avatar-actions">
          <view
            class="agent-avatar-actions__choose"
            :class="{ 'is-disabled': isBusy }"
            @tap="handleAvatarTap"
          >
            {{ avatarPreviewUrl ? '重新选择头像' : '从相册选择头像' }}
          </view>
          <view
            class="agent-avatar-actions__submit"
            :class="{ 'is-disabled': !canContinue }"
            @tap="handleContinue"
          >
            <view v-if="isSubmitting" class="agent-avatar-actions__spinner" />
            <text v-else class="agent-avatar-actions__submit-text">完成创建</text>
          </view>
        </view>

        <view v-else class="agent-text-panel">
          <input
            :value="activeInputValue"
            class="agent-text-panel__input"
            type="text"
            :maxlength="activeInputMaxLength"
            :focus="shouldFocusInput"
            :placeholder="currentPlaceholder"
            placeholder-style="color: rgba(255, 255, 255, 0.6);"
            :confirm-type="activeConfirmType"
            :confirm-hold="shouldHoldKeyboardOnConfirm"
            :adjust-position="false"
            cursor-spacing="16"
            @input="handleActiveInput"
            @focus="handleInputFocus"
            @blur="handleInputBlur"
            @keyboardheightchange="handleKeyboardHeightChange"
            @confirm="handleContinue"
          />
          <view
            class="agent-text-panel__continue"
            :class="{ 'is-disabled': !canContinue }"
            @touchstart="handleContinueTouchStart"
            @tap="handleContinue"
          >
            <view v-if="isSubmitting" class="agent-text-panel__spinner" />
            <text v-else class="agent-text-panel__arrow">→</text>
          </view>
        </view>
      </view>
    </template>
  </page-scaffold>
</template>

<script lang="ts">
export default {
  name: 'AgentCreateFlowPage',
}
</script>

<script setup lang="ts">
import Taro, { useDidHide, useDidShow } from '@tarojs/taro'
import { computed, nextTick, ref } from 'vue'
import { ApiException } from '../../api/api-exception'
import {
  getConversations,
  type ConversationSummary,
} from '../../apis/conversation'
import { createAgent, updateAgentAvatar } from '../../apis/agent'
import { uploadLocalImage } from '../../apis/storage'
import AppBar from '../../components/app-bar/app-bar.vue'
import PageScaffold from '../../components/page-scaffold/page-scaffold.vue'
import { clearAuthSession } from '../../auth/session'

const agentFlowVideoId = 'agent-create-flow-bg-video'
const agentFlowVideo = 'https://oss.soullink.top/weapp/agent-bg.mp4'
const agentFlowVideoCover = 'https://oss.soullink.top/weapp/agent-bg-cover.png'

type AgentFormStep =
  | 'gender'
  | 'relationToThem'
  | 'relationToMe'
  | 'avatar'

type AgentGender = 'male' | 'female'

interface ChatEntry {
  step: AgentFormStep
  question: string
  answer: string
}

interface AgentFormStepConfig {
  step: AgentFormStep
  question: string
  placeholder: string
  maxLength: number
  isTextInput: boolean
  getAnswer: () => string
  isComplete: () => boolean
}

const currentStep = ref<AgentFormStep>('gender')
const relationToThem = ref('')
const relationToMe = ref('')
const gender = ref<AgentGender | null>(null)
const avatarPreviewUrl = ref('')
const avatarObjectKey = ref('')
const isSubmitting = ref(false)
const isUploadingAvatar = ref(false)
const shouldFocusInput = ref(true)
const shouldRefocusAfterTextButtonTap = ref(false)
const keyboardHeight = ref(0)
const isInputFocused = ref(false)

const formSteps: AgentFormStepConfig[] = [
  {
    step: 'gender',
    question: 'TA 的性别是？',
    placeholder: '',
    maxLength: 0,
    isTextInput: false,
    getAnswer: () => {
      if (!gender.value) {
        return ''
      }

      return gender.value === 'male' ? '男' : '女'
    },
    isComplete: () => gender.value !== null,
  },
  {
    step: 'relationToThem',
    question: '你怎么称呼 TA？',
    placeholder: '如：爷爷，奶奶',
    maxLength: 20,
    isTextInput: true,
    getAnswer: () => relationToThem.value.trim(),
    isComplete: () => relationToThem.value.trim().length > 0,
  },
  {
    step: 'relationToMe',
    question: 'TA 怎么称呼你？',
    placeholder: '如：丫头，小宝',
    maxLength: 20,
    isTextInput: true,
    getAnswer: () => relationToMe.value.trim(),
    isComplete: () => relationToMe.value.trim().length > 0,
  },
  {
    step: 'avatar',
    question: '为 TA 选一张头像吧',
    placeholder: '',
    maxLength: 0,
    isTextInput: false,
    getAnswer: () => (avatarPreviewUrl.value ? '已选择头像' : ''),
    isComplete: () => true,
  },
]

const formStepKeys = formSteps.map((item) => item.step)
const currentStepIndex = computed(() => {
  return formSteps.findIndex((item) => item.step === currentStep.value)
})
const currentStepConfig = computed(() => {
  return formSteps[currentStepIndex.value] ?? formSteps[0]
})

const isBusy = computed(() => isSubmitting.value || isUploadingAvatar.value)
const isTextInputStep = computed(() => {
  return currentStepConfig.value.isTextInput
})
const shouldFollowKeyboard = computed(() => {
  return isTextInputStep.value && isInputFocused.value && keyboardHeight.value > 0
})
const panelStyle = computed(() => {
  return {
    paddingBottom: shouldFollowKeyboard.value
      ? '8px'
      : 'calc(env(safe-area-inset-bottom) + 24px)',
    transform: shouldFollowKeyboard.value
      ? `translateY(-${keyboardHeight.value}px)`
      : 'translateY(0)',
  }
})
const chatStyle = computed(() => {
  return {
    transform: shouldFollowKeyboard.value
      ? `translateY(-${keyboardHeight.value}px)`
      : 'translateY(0)',
  }
})
const currentQuestion = computed(() => {
  return currentStepConfig.value.question
})
const currentPlaceholder = computed(() => {
  return currentStepConfig.value.placeholder
})
const activeInputMaxLength = computed(() => {
  return currentStepConfig.value.maxLength
})
const nextStepKey = computed(() => {
  return formStepKeys[currentStepIndex.value + 1]
})
const shouldHoldKeyboardOnConfirm = computed(() => {
  return Boolean(nextStepKey.value && isTextInputStepKey(nextStepKey.value))
})
const activeConfirmType = computed(() => {
  return shouldHoldKeyboardOnConfirm.value ? 'next' : 'done'
})
const activeInputValue = computed({
  get() {
    switch (currentStep.value) {
      case 'relationToThem':
        return relationToThem.value
      case 'relationToMe':
        return relationToMe.value
      case 'gender':
      case 'avatar':
        return ''
      default:
        return ''
    }
  },
  set(value: string) {
    switch (currentStep.value) {
      case 'relationToThem':
        relationToThem.value = value
        break
      case 'relationToMe':
        relationToMe.value = value
        break
      case 'gender':
      case 'avatar':
        break
    }
  },
})
const canContinue = computed(() => {
  if (isBusy.value) {
    return false
  }

  return currentStepConfig.value.isComplete()
})
const filledEntries = computed<ChatEntry[]>(() => {
  return formSteps
    .filter((entry) => entry.step !== currentStep.value)
    .map((entry) => ({
      step: entry.step,
      question: entry.question,
      answer: entry.getAnswer(),
    }))
    .filter((entry) => entry.answer.trim().length > 0)
})
const reversedFilledEntries = computed<ChatEntry[]>(() => {
  return [...filledEntries.value].reverse()
})

function resetKeyboardState() {
  isInputFocused.value = false
  keyboardHeight.value = 0
  void Taro.hideKeyboard()
}

function playAgentFlowVideo() {
  void nextTick(() => {
    try {
      Taro.createVideoContext(agentFlowVideoId).play()
    } catch {
      // The video may not be ready yet; autoplay and loadedmetadata will retry.
    }
  })
}

function restartAgentFlowVideo() {
  void nextTick(() => {
    try {
      const videoContext = Taro.createVideoContext(agentFlowVideoId)
      videoContext.seek(0)
      videoContext.play()
    } catch {
      // The video may not be ready yet; loop and didShow will retry.
    }
  })
}

function isTextInputStepKey(step?: AgentFormStep) {
  return Boolean(step && formSteps.some((item) => item.step === step && item.isTextInput))
}

function syncInputFocus(previousStep?: AgentFormStep) {
  if (!isTextInputStep.value) {
    shouldFocusInput.value = false
    resetKeyboardState()
    return
  }

  if (previousStep && isTextInputStepKey(previousStep)) {
    shouldFocusInput.value = true
    return
  }

  shouldFocusInput.value = false

  void nextTick(() => {
    shouldFocusInput.value = true
  })
}

function showToast(message: string) {
  void Taro.showToast({
    title: message,
    icon: 'none',
    duration: 1800,
  })
}

type TaroInputDetail = {
  value?: string
}

function handleActiveInput(event: InputEvent) {
  const detail = (event as unknown as { detail?: TaroInputDetail }).detail
  activeInputValue.value = detail?.value ?? ''
}

function handleInputFocus() {
  isInputFocused.value = true
}

function handleInputBlur() {
  if (shouldRefocusAfterTextButtonTap.value) {
    shouldRefocusAfterTextButtonTap.value = false
    shouldFocusInput.value = false

    void nextTick(() => {
      shouldFocusInput.value = true
    })
    return
  }

  isInputFocused.value = false
  keyboardHeight.value = 0
}

function handleKeyboardHeightChange(event: { detail?: { height?: number } }) {
  keyboardHeight.value = event.detail?.height ?? 0

  if (keyboardHeight.value <= 0) {
    isInputFocused.value = false
  }
}

function isUserCanceled(error: unknown) {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'errMsg' in error &&
      String(error.errMsg).toLowerCase().includes('cancel'),
  )
}

async function editAvatarImage(filePath: string) {
  const result = await Taro.editImage({
    src: filePath,
  })

  return result.tempFilePath
}

function buildChatPageUrl(conversation: ConversationSummary) {
  const query = [
    ['conversationId', conversation.id],
    ['agentId', conversation.agentId],
    ['agentName', conversation.agentName.trim() || '未命名联系人'],
    ['agentAvatar', conversation.agentAvatar],
    ['agentSex', String(conversation.agentSex)],
    ['agentCallMe', conversation.agentCallMe],
    ['iCallAgent', conversation.iCallAgent],
    ['preview', conversation.preview],
    ['createdAt', conversation.createdAt?.toISOString() ?? ''],
  ]
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&')

  return `/pages/chat/index?${query}`
}

async function openCreatedAgentConversation(agentId: string) {
  const conversations = await getConversations()
  const conversation = conversations.find((item) => item.agentId === agentId)

  if (!conversation) {
    throw new Error('CONVERSATION_NOT_FOUND')
  }

  await Taro.reLaunch({
    url: buildChatPageUrl(conversation),
  })
}

async function redirectToAuth() {
  await clearAuthSession()
  await Taro.reLaunch({
    url: '/pages/auth/index',
  })
}

function handleBack() {
  if (isSubmitting.value) {
    return
  }

  const currentIndex = formStepKeys.indexOf(currentStep.value)
  if (currentIndex <= 0) {
    void Taro.navigateBack()
    return
  }

  const previousStep = currentStep.value
  currentStep.value = formStepKeys[currentIndex - 1]
  syncInputFocus(previousStep)
}

function selectStep(step: AgentFormStep) {
  if (isBusy.value || step === currentStep.value) {
    return
  }

  const previousStep = currentStep.value
  currentStep.value = step
  syncInputFocus(previousStep)
}

function selectGender(value: AgentGender) {
  if (isBusy.value) {
    return
  }

  gender.value = value
  setTimeout(() => {
    void goToNextStep()
  }, 120)
}

async function handleContinue() {
  await goToNextStep()
}

function handleContinueTouchStart() {
  shouldRefocusAfterTextButtonTap.value = shouldHoldKeyboardOnConfirm.value
}

async function goToNextStep() {
  if (!canContinue.value) {
    return
  }

  if (currentStep.value === 'avatar') {
    await submitCreation()
    return
  }

  const currentIndex = formStepKeys.indexOf(currentStep.value)
  const nextStep = formStepKeys[currentIndex + 1]

  if (!nextStep) {
    return
  }

  const previousStep = currentStep.value
  currentStep.value = nextStep
  syncInputFocus(previousStep)
}

async function handleAvatarTap() {
  if (isBusy.value) {
    return
  }

  try {
    const result = await Taro.chooseImage({
      count: 1,
      sizeType: ['compressed'],
      sourceType: ['album'],
    })

    const filePath = result.tempFilePaths[0]
    if (!filePath) {
      return
    }

    const editedFilePath = await editAvatarImage(filePath)
    if (!editedFilePath) {
      return
    }

    isUploadingAvatar.value = true
    const upload = await uploadLocalImage(editedFilePath, {
      folder: 'avatars',
      fileName: `agent_avatar_${Date.now()}.jpg`,
    })

    avatarPreviewUrl.value = upload.publicUrl
    avatarObjectKey.value = upload.objectKey
  } catch (error) {
    if (error instanceof ApiException && error.requiresReLogin) {
      await redirectToAuth()
      return
    }

    if (isUserCanceled(error)) {
      return
    }

    showToast(
      error instanceof ApiException
        ? error.message
        : '头像上传失败，请稍后重试',
    )
  } finally {
    isUploadingAvatar.value = false
  }
}

async function submitCreation() {
  if (isSubmitting.value || isUploadingAvatar.value) {
    return
  }

  isSubmitting.value = true

  const fallbackAgentName = relationToThem.value.trim() || 'TA'

  try {
    let agent = await createAgent({
      name: fallbackAgentName,
      sex: gender.value === 'male' ? 1 : 0,
      iCallAgent: relationToThem.value.trim(),
      agentCallMe: relationToMe.value.trim(),
    })

    if (avatarObjectKey.value.trim()) {
      agent = await updateAgentAvatar(agent.id, avatarObjectKey.value.trim())
    }

    await Taro.showToast({
      title: `已创建 Agent：${agent.name || fallbackAgentName}`,
      icon: 'none',
      duration: 1200,
    })

    try {
      await openCreatedAgentConversation(agent.id)
      return
    } catch {
      showToast('已创建成功，请在通讯录中进入聊天')
      setTimeout(() => {
        void Taro.navigateBack({ delta: 2 })
      }, 400)
    }
  } catch (error) {
    if (error instanceof ApiException && error.requiresReLogin) {
      await redirectToAuth()
      return
    }

    showToast(
      error instanceof ApiException
        ? error.message
        : '创建 Agent 失败，请稍后重试',
    )
  } finally {
    isSubmitting.value = false
  }
}

useDidHide(() => {
  resetKeyboardState()
})

useDidShow(() => {
  playAgentFlowVideo()
})
</script>

<style lang="scss">
page {
  height: 100%;
  overflow: hidden;
}

.agent-create-flow {
  position: relative;
  height: 100vh;
  min-height: 100vh;
  background: #090d1a;
}

.agent-create-flow__appbar {
  position: relative;
  z-index: 3;
}

.agent-create-flow__appbar .app-bar__title {
  color: $tzl-color-surface-base;
}

.agent-create-flow__bg,
.agent-create-flow__shade {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

.agent-create-flow__bg {
  pointer-events: none;
  object-fit: cover;
}

.agent-create-flow__shade {
  pointer-events: none;
  background: linear-gradient(
    180deg,
    rgba(0, 0, 0, 0.12) 0%,
    rgba(0, 0, 0, 0) 46%,
    rgba(0, 0, 0, 0.18) 100%
  );
}

.agent-create-flow__body {
  position: relative;
  z-index: 1;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.agent-create-flow__content {
  min-height: 100%;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  padding: 0 24px 16px;
}

.agent-create-flow__content--avatar {
  padding-bottom: 16px;
}

.agent-create-flow__chat {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  transition: transform 180ms ease;
  will-change: transform;
}

.agent-create-flow__messages {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
}

.agent-create-flow__message-stack {
  min-height: 280px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column-reverse;
  justify-content: flex-start;
  gap: 12px;
  padding: 24px 0 18px;
}

.agent-create-flow__question {
  align-self: flex-start;
  max-width: 180px;
  padding: 14px 20px;
  border-radius: 88px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(0, 0, 0, 0.42);
}

.agent-create-flow__question--current {
  margin-top: 6px;
}

.agent-create-flow__question-text {
  font-size: 16px;
  line-height: 20px;
  font-weight: 500;
  color: $tzl-color-surface-base;
}

.agent-create-flow__answer-row {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 6px;
}

.agent-create-flow__answer {
  max-width: 220px;
  padding: 12px 18px;
  border-radius: 88px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.14);
}

.agent-create-flow__answer-text {
  font-size: 15px;
  line-height: 20px;
  font-weight: 500;
  color: $tzl-color-surface-base;
}

.agent-create-flow__panel {
  box-sizing: border-box;
  padding: 16px 24px calc(env(safe-area-inset-bottom) + 24px);
  background: linear-gradient(
    180deg,
    rgba(9, 13, 26, 0) 0%,
    rgba(9, 13, 26, 0.46) 26%,
    rgba(9, 13, 26, 0.72) 100%
  );
  transition: transform 180ms ease, padding-bottom 180ms ease;
  will-change: transform;
}

.agent-text-panel {
  min-height: 56px;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 8px 6px 20px;
  border-radius: 28px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(0, 0, 0, 0.4);
}

.agent-text-panel__input {
  flex: 1;
  min-width: 0;
  height: 44px;
  font-size: 16px;
  font-weight: 500;
  color: $tzl-color-surface-base;
}

.agent-text-panel__continue {
  flex-shrink: 0;
  width: 44px;
  height: 44px;
  border-radius: 999px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.18);
}

.agent-text-panel__continue.is-disabled {
  background: rgba(255, 255, 255, 0.08);
}

.agent-text-panel__arrow {
  font-size: 24px;
  line-height: 1;
  color: $tzl-color-surface-base;
}

.agent-text-panel__continue.is-disabled .agent-text-panel__arrow {
  color: rgba(255, 255, 255, 0.45);
}

.agent-text-panel__spinner,
.agent-avatar-actions__spinner,
.agent-avatar-card__spinner {
  width: 20px;
  height: 20px;
  border: 2px solid rgba(255, 255, 255, 0.25);
  border-top-color: $tzl-color-surface-base;
  border-radius: 50%;
  animation: agent-spinner 0.9s linear infinite;
}

.agent-gender-panel {
  display: flex;
  gap: 12px;
}

.agent-gender-panel__option {
  flex: 1;
  height: 56px;
  border-radius: 88px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.38);
}

.agent-gender-panel__option.is-selected {
  border-color: rgba(255, 255, 255, 0.44);
  background: rgba(167, 210, 255, 0.2);
}

.agent-gender-panel__label {
  font-size: 18px;
  line-height: 24px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.88);
}

.agent-gender-panel__option.is-selected .agent-gender-panel__label {
  color: $tzl-color-surface-base;
}

.agent-avatar-card {
  flex-shrink: 0;
  align-self: center;
  width: 160px;
  height: 160px;
  box-sizing: border-box;
  margin: 4px 0 18px;
  padding: 18px;
  border-radius: 28px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(0, 0, 0, 0.38);
  box-shadow: 0 20px 28px rgba(0, 0, 0, 0.18);
}

.agent-avatar-card__inner {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.agent-avatar-card__image,
.agent-avatar-card__placeholder,
.agent-avatar-card__uploading {
  width: 92px;
  height: 92px;
  border-radius: 28px;
}

.agent-avatar-card__placeholder {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.1);
}

.agent-avatar-card__uploading {
  position: absolute;
  left: 50%;
  top: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.36);
  transform: translate(-50%, -50%);
}

.agent-avatar-card__camera {
  position: relative;
  width: 34px;
  height: 30px;
}

.agent-avatar-card__camera-body {
  position: absolute;
  left: 2px;
  bottom: 0;
  width: 26px;
  height: 20px;
  border: 2px solid rgba(255, 255, 255, 0.92);
  border-radius: 7px;
}

.agent-avatar-card__camera-lens {
  position: absolute;
  left: 10px;
  bottom: 6px;
  width: 10px;
  height: 10px;
  border: 2px solid rgba(255, 255, 255, 0.92);
  border-radius: 50%;
}

.agent-avatar-card__camera-plus {
  position: absolute;
  right: 0;
  top: 1px;
  background: rgba(255, 255, 255, 0.92);
  border-radius: 999px;
}

.agent-avatar-card__camera-plus--h {
  width: 10px;
  height: 2px;
  top: 5px;
}

.agent-avatar-card__camera-plus--v {
  width: 2px;
  height: 10px;
  right: 4px;
}

.agent-avatar-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.agent-avatar-actions__choose {
  min-height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  line-height: 20px;
  color: rgba(255, 255, 255, 0.84);
}

.agent-avatar-actions__choose.is-disabled {
  opacity: 0.5;
}

.agent-avatar-actions__submit {
  height: 52px;
  border-radius: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: $tzl-color-surface-base;
}

.agent-avatar-actions__submit.is-disabled {
  background: rgba(255, 255, 255, 0.38);
}

.agent-avatar-actions__submit-text {
  font-size: 15px;
  line-height: 22px;
  font-weight: 700;
  color: #10131e;
}

.agent-avatar-actions__submit.is-disabled .agent-avatar-actions__submit-text {
  color: rgba(16, 19, 30, 0.4);
}

@keyframes agent-spinner {
  from {
    transform: rotate(0deg);
  }

  to {
    transform: rotate(360deg);
  }
}
</style>
