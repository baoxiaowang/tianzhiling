<template>
  <page-scaffold
    class="agent-profile-page"
    background="#f6f6f8"
    header-background="#ffffff"
    bottom-background="#ffffff"
    body-padding="0"
    :scroll="true"
    :scroll-into-view="scrollIntoViewTarget"
    :scroll-with-animation="true"
    :show-scrollbar="false"
    :safe-area-top="false"
    :safe-area-bottom="true"
  >
    <template #header>
      <app-bar title="亲友资料" background="#ffffff" border-color="#eeeeF2" />
    </template>

    <view v-if="isCheckingAuth || isLoading" class="agent-profile-state">
      <view class="agent-profile-state__messenger">
        <image
          class="agent-profile-state__image"
          :src="messengerImageUrl"
          mode="aspectFit"
        />
      </view>
      <text class="agent-profile-state__text">
        {{ messengerArrivalText }}
      </text>
    </view>

    <view v-else-if="showBlockingError" class="agent-profile-state">
      <text class="agent-profile-state__title">暂时没能找到 TA 的资料</text>
      <text class="agent-profile-state__text">{{ loadError }}</text>
      <view class="agent-profile-state__button" @tap="handleRetry">重试</view>
    </view>

    <view v-else-if="isCompleted" class="agent-profile-complete">
      <view class="agent-profile-complete__visual">
        <image
          class="agent-profile-complete__image"
          :src="messengerImageUrl"
          mode="aspectFit"
        />
        <view class="agent-profile-complete__check">
          <Check color="#ffffff" size="16" />
        </view>
      </view>
      <text class="agent-profile-complete__title">我已经记住 TA 了</text>
      <text class="agent-profile-complete__desc">
        你讲的这些，会帮助 TA 更自然地记得自己，也更懂你们之间的故事。
      </text>

      <view class="agent-profile-complete__memories">
        <view
          v-for="section in completedMemorySections"
          :key="section.field"
          class="agent-profile-complete__memory"
        >
          <view class="agent-profile-complete__memory-mark">
            <Check color="#297b69" size="12" />
          </view>
          <text class="agent-profile-complete__memory-label">
            {{ section.label }}
          </text>
          <text class="agent-profile-complete__memory-text">
            {{ section.text }}
          </text>
        </view>
      </view>
    </view>

    <view v-else class="agent-profile-workspace">
      <view class="agent-profile-messenger">
        <view
          class="agent-profile-messenger__visual"
          :class="{
            'agent-profile-messenger__visual--listening': isVoiceRecording,
          }"
        >
          <view class="agent-profile-messenger__halo" />
          <template v-if="isVoiceRecording">
            <view
              class="agent-profile-messenger__listening-ring agent-profile-messenger__listening-ring--first"
            />
            <view
              class="agent-profile-messenger__listening-ring agent-profile-messenger__listening-ring--second"
            />
          </template>
          <image
            class="agent-profile-messenger__image"
            :src="messengerImageUrl"
            mode="aspectFit"
          />
        </view>
        <view class="agent-profile-messenger__identity">
          <text class="agent-profile-messenger__name">天之灵小使者</text>
          <text
            class="agent-profile-messenger__desc"
            :class="{
              'agent-profile-messenger__desc--listening': isVoiceRecording,
            }"
          >
            {{ messengerDescription }}
          </text>
        </view>
        <view
          v-if="hasSavedProfile"
          class="agent-profile-messenger__detail-link"
          @tap="handleOpenProfileDetail"
        >
          <text>查看资料</text>
          <ArrowRight color="#77747f" size="12" />
        </view>
      </view>

      <view class="agent-profile-prompt">
        <template v-if="isThinking || isAssistantPromptPreparing">
          <text class="agent-profile-prompt__thinking">
            {{ assistantWaitingText }}
          </text>
          <view class="agent-profile-prompt__dots">
            <view class="agent-profile-thinking-dot" />
            <view class="agent-profile-thinking-dot" />
            <view class="agent-profile-thinking-dot" />
          </view>
        </template>
        <view v-else class="agent-profile-prompt__content">
          <view class="agent-profile-prompt__copy">
            <text class="agent-profile-prompt__text">
              {{ visibleAssistantPrompt }}
            </text>
            <text
              v-if="isAssistantTextRevealing"
              class="agent-profile-prompt__cursor"
            >
              |
            </text>
          </view>
          <view
            class="agent-profile-prompt__speech"
            :class="{
              'agent-profile-prompt__speech--active': isAssistantSpeechPlaying,
            }"
            :aria-label="assistantSpeechControlLabel"
            @tap="handleAssistantSpeechTap"
          >
            <view
              v-if="isAssistantSpeechLoading"
              class="agent-profile-prompt__speech-loading"
            >
              <Loading color="#77728f" size="16" />
            </view>
            <PlayStop
              v-else-if="isAssistantSpeechPlaying"
              color="#ffffff"
              size="15"
            />
            <Voice v-else color="#77728f" size="17" />
          </view>
        </view>
      </view>

      <view class="agent-profile-input-area">
        <view class="agent-profile-text-input">
          <textarea
            class="agent-profile-text-input__field"
            :value="inputValue"
            placeholder="可以直接说，也可以写下性格、经历、习惯或共同回忆..."
            placeholder-class="agent-profile-text-input__placeholder"
            maxlength="1200"
            confirm-type="send"
            :show-confirm-bar="false"
            :adjust-position="true"
            :cursor-spacing="18"
            :disabled="
              isThinking || isGenerating || isVoiceBusy || isDeletingEntry
            "
            @input="handleInput"
            @confirm="handleSend"
          />
          <view class="agent-profile-text-input__footer">
            <text class="agent-profile-text-input__privacy">
              这些内容只用于完善他的记忆
            </text>
            <view
              class="agent-profile-text-input__send"
              :class="{
                'agent-profile-text-input__send--disabled': !canSend,
              }"
              @tap="handleSend"
            >
              <text>记录这段</text>
              <Right color="#ffffff" size="15" />
            </view>
          </view>
        </view>
        <view class="agent-profile-voice-tool">
          <button
            class="agent-profile-voice-tool__button"
            :class="{
              'agent-profile-voice-tool__button--recording': isVoiceRecording,
              'agent-profile-voice-tool__button--busy':
                isVoicePreparing || isTranscribingVoice,
            }"
            open-type="agreePrivacyAuthorization"
            :aria-label="isVoiceRecording ? '停止语音输入' : '开始语音输入'"
            @tap="handleVoiceButtonTap"
            @agreeprivacyauthorization="handleVoicePrivacyAgreed"
          >
            <view class="agent-profile-voice-tool__icon">
              <view
                v-if="isVoicePreparing || isTranscribingVoice"
                class="agent-profile-voice-tool__loading"
              >
                <Loading color="#ffffff" size="21" />
              </view>
              <PlayStop
                v-else-if="isVoiceRecording"
                color="#ffffff"
                size="20"
              />
              <Microphone v-else color="#ffffff" size="22" />
            </view>
          </button>
        </view>
      </view>

      <view v-if="userEntries.length" class="agent-profile-entries">
        <view class="agent-profile-entries__heading">
          <view>
            <text class="agent-profile-entries__title">本次已记录的讲述</text>
            <text class="agent-profile-entries__desc">{{
              memoryStatusText
            }}</text>
          </view>
          <text class="agent-profile-entries__count">
            {{ userEntries.length }} 段
          </text>
        </view>
        <view
          v-for="(entry, index) in userEntries"
          :key="entry.id"
          class="agent-profile-entry"
        >
          <view class="agent-profile-entry__index">{{ index + 1 }}</view>
          <text class="agent-profile-entry__text">{{ entry.text }}</text>
          <view
            class="agent-profile-entry__delete"
            :class="{
              'agent-profile-entry__delete--disabled':
                isThinking || isVoiceBusy || isGenerating,
            }"
            aria-label="删除这段讲述"
            @tap="handleDeleteEntryTap(entry)"
          >
            <view
              v-if="deletingEntryId === entry.id"
              class="agent-profile-entry__delete-loading"
            >
              <Loading color="#9a6767" size="17" />
            </view>
            <Del v-else color="#9a6767" size="17" />
          </view>
        </view>
        <view id="agent-profile-entries-end" class="agent-profile-anchor" />
      </view>
    </view>

    <template #bottom>
      <view
        v-if="agent && !isCompleted && canGenerate"
        class="agent-profile-finish-bar"
      >
        <view
          class="agent-profile-finish-bar__button"
          :class="{
            'agent-profile-finish-bar__button--disabled':
              isThinking || isVoiceBusy || isDeletingEntry,
          }"
          @tap="handleFinishTap"
        >
          <Check color="#ffffff" size="15" />
          <text>我讲完了，生成记忆</text>
        </view>
      </view>

      <view v-else-if="isCompleted" class="agent-profile-complete-actions">
        <view
          class="agent-profile-complete-actions__primary"
          @tap="handleOpenProfileDetail"
        >
          查看完整亲友资料
        </view>
        <view class="agent-profile-complete-actions__secondary-row">
          <view
            class="agent-profile-complete-actions__secondary"
            @tap="handleContinueInterview"
          >
            继续告诉小使者
          </view>
          <view
            class="agent-profile-complete-actions__secondary"
            @tap="handleReturnToAgent"
          >
            回到 TA 的主页
          </view>
        </view>
      </view>
    </template>

    <template #overlay>
      <view v-if="isGenerating" class="agent-profile-generating">
        <view class="agent-profile-generating__visual">
          <view class="agent-profile-generating__ring" />
          <image
            class="agent-profile-generating__image"
            :src="messengerImageUrl"
            mode="aspectFit"
          />
        </view>
        <text class="agent-profile-generating__title">正在生成 TA 的记忆</text>
        <text class="agent-profile-generating__desc">
          我在把你讲的每个细节轻轻放好
        </text>
      </view>

      <nut-dialog
        v-model:visible="isFinishDialogVisible"
        title="现在生成 TA 的记忆吗？"
        custom-class="agent-profile-finish-dialog"
        text-align="left"
        :close-on-click-overlay="false"
        :lock-scroll="true"
        :z-index="120"
      >
        <view class="agent-profile-finish-dialog__content">
          不需要答完所有问题。生成后，这些内容会写入亲友资料，你之后仍然可以继续补充。
        </view>
        <template #footer>
          <view class="agent-profile-finish-dialog__footer">
            <view
              class="agent-profile-finish-dialog__secondary"
              @tap="handleFinishDialogCancel"
            >
              再讲一点
            </view>
            <view
              class="agent-profile-finish-dialog__primary"
              @tap="handleFinishDialogConfirm"
            >
              确认生成
            </view>
          </view>
        </template>
      </nut-dialog>

      <nut-dialog
        v-model:visible="isDeleteDialogVisible"
        title="删除这段讲述吗？"
        custom-class="agent-profile-delete-dialog"
        text-align="left"
        :close-on-click-overlay="false"
        :lock-scroll="true"
        :z-index="121"
      >
        <view class="agent-profile-delete-dialog__content">
          删除后，小使者会根据剩余内容重新整理记忆草稿。
        </view>
        <template #footer>
          <view class="agent-profile-delete-dialog__footer">
            <view
              class="agent-profile-delete-dialog__secondary"
              @tap="handleDeleteDialogCancel"
            >
              取消
            </view>
            <view
              class="agent-profile-delete-dialog__primary"
              @tap="handleDeleteDialogConfirm"
            >
              删除
            </view>
          </view>
        </template>
      </nut-dialog>
    </template>
  </page-scaffold>
</template>

<script lang="ts">
export default {
  name: "AgentProfilePage",
};
</script>

<script setup lang="ts">
import {
  ArrowRight,
  Check,
  Del,
  Loading,
  Microphone,
  PlayStop,
  Right,
  Voice,
} from "@nutui/icons-vue-taro";
import type {
  AgentProfileInterviewDraftDTO,
  AgentProfileMemoryField,
  UpdateAgentProfileDTO,
} from "@tzl/shared";
import Taro, { useLoad, useUnload } from "@tarojs/taro";
import { computed, nextTick, ref, watch } from "vue";
import { ApiException } from "../../api/api-exception";
import {
  createAgentProfileMessengerSpeech,
  getAgentDetail,
  interviewAgentProfile,
  markAgentGuideSeen,
  updateAgentProfile,
  type AgentSummary,
} from "../../apis/agent";
import {
  getConversations,
  transcribeConversationVoice,
} from "../../apis/conversation";
import { uploadLocalFile } from "../../apis/storage";
import messengerImageUrl from "../../assets/images/agent-create/header-mark.png";
import { clearAuthSession } from "../../auth/session";
import AppBar from "../../components/app-bar/app-bar.vue";
import PageScaffold from "../../components/page-scaffold/page-scaffold.vue";
import {
  ensureAuthenticatedSession,
  redirectToAuthPage,
} from "../../utils/auth-guard";
import {
  buildAgentProfileInitialGreeting,
  resolveAssistantPlaybackCharacterCount,
} from "../../utils/agent-profile-messenger";
import { getPrewarmedAgentProfileGreetingSpeech } from "../../utils/agent-profile-messenger-prewarm";
import { ensureInnerAudioPlaybackOptions } from "../../utils/audio";

interface InterviewMessage {
  id: string;
  role: "assistant" | "user";
  text: string;
}

interface MemorySection {
  field: AgentProfileMemoryField;
  label: string;
}

interface RecorderStopResult {
  tempFilePath: string;
  duration: number;
  fileSize: number;
}

interface VoicePrivacySettingResult {
  needAuthorization?: boolean;
}

interface RealtimeRecognitionResult {
  result?: string;
  Result?: string;
  tempFilePath?: string;
  duration?: number;
  fileSize?: number;
  retcode?: number;
  msg?: string;
}

interface RealtimeRecognitionManager {
  start: (options: { duration: number; lang: "zh_CN" }) => void;
  stop: () => void;
  onStart?: (result?: unknown) => void;
  onRecognize?: (result: RealtimeRecognitionResult) => void;
  onStop?: (result: RealtimeRecognitionResult) => void;
  onError?: (result: RealtimeRecognitionResult) => void;
}

interface WechatSIPlugin {
  getRecordRecognitionManager?: () => RealtimeRecognitionManager;
}

declare const requirePlugin: (name: "WechatSI") => WechatSIPlugin;

type TaroPrivacyApi = typeof Taro & {
  getPrivacySetting?: (option: {
    success?: (result: VoicePrivacySettingResult) => void;
    fail?: (error: unknown) => void;
  }) => void;
};

const memorySections: MemorySection[] = [
  { field: "personalityTraits", label: "TA 的样子" },
  { field: "lifeExperience", label: "人生经历" },
  { field: "hobbies", label: "喜欢的事" },
  { field: "languageHabits", label: "熟悉的话语" },
  { field: "sharedMemories", label: "你们的回忆" },
];
const profileFieldOrder = memorySections.map((section) => section.field);
const assistantWaitingMessages = {
  thinking: [
    "小使者正在回想你刚才的话",
    "小使者正在寻找记忆的线索",
    "小使者正在想下一个问题",
  ],
  speaking: [
    "小使者正在组织语言",
    "小使者正在把问题轻轻说出来",
    "小使者马上就开口了",
  ],
} as const;
const voiceListeningMessages = [
  "我在认真听",
  "正在轻轻记下你说的话",
  "不用着急，慢慢说",
  "我一直在这里听着",
] as const;

type AssistantWaitingStage = keyof typeof assistantWaitingMessages;

const agent = ref<AgentSummary | null>(null);
const agentId = ref("");
const routeAgentName = ref("");
const draft = ref(createEmptyDraft());
const interviewBaselineDraft = ref(createEmptyDraft());
const messages = ref<InterviewMessage[]>([]);
const inputValue = ref("");
const nextFocusField = ref<AgentProfileMemoryField | "">("personalityTraits");
const turnCount = ref(0);
const isCheckingAuth = ref(true);
const isLoading = ref(false);
const isThinking = ref(false);
const isGenerating = ref(false);
const isCompleted = ref(false);
const isFinishDialogVisible = ref(false);
const isDeleteDialogVisible = ref(false);
const isDeletingEntry = ref(false);
const deletingEntryId = ref("");
const pendingDeleteEntry = ref<InterviewMessage | null>(null);
const isVoicePreparing = ref(false);
const isVoiceRecording = ref(false);
const isTranscribingVoice = ref(false);
const isRealtimeVoiceSession = ref(false);
const voiceListeningMessageIndex = ref(0);
const displayedAssistantPrompt = ref("");
const isAssistantPromptPreparing = ref(false);
const isAssistantTextRevealing = ref(false);
const isAssistantSpeechLoading = ref(false);
const isAssistantSpeechPlaying = ref(false);
const assistantWaitingText = ref(assistantWaitingMessages.thinking[0]);
const loadError = ref("");
const scrollIntoViewTarget = ref("");
const conversationId = ref("");
let messageSequence = 0;
let pendingVoiceStartAfterPrivacy = false;
let isPageUnloading = false;
let realtimeRecognitionManager: RealtimeRecognitionManager | null = null;
let isRealtimeRecognitionDisabled = false;
let realtimeVoiceBaseText = "";
let realtimeVoicePartialText = "";
let activeAssistantPromptText = "";
let cachedAssistantSpeechText = "";
let cachedAssistantSpeechUrl = "";
let assistantPresentationGeneration = 0;
let assistantRevealTimer: ReturnType<typeof setTimeout> | null = null;
let assistantPlaybackStartTimer: ReturnType<typeof setTimeout> | null = null;
let assistantWaitingTimer: ReturnType<typeof setInterval> | null = null;
let voiceListeningTimer: ReturnType<typeof setInterval> | null = null;
let assistantAudioContext: Taro.InnerAudioContext | null = null;

const recorderManager = Taro.getRecorderManager();

const handleRealtimeRecognitionStart = () => {
  if (isPageUnloading) {
    return;
  }

  isVoicePreparing.value = false;
  isVoiceRecording.value = true;
};

const handleRealtimeRecognitionUpdate = (result: RealtimeRecognitionResult) => {
  if (isPageUnloading) {
    return;
  }

  const transcript = readRealtimeRecognitionText(result);
  if (!transcript) {
    return;
  }

  realtimeVoicePartialText = transcript;
  inputValue.value = joinVoiceInput(realtimeVoiceBaseText, transcript);
};

const handleRealtimeRecognitionStop = (result: RealtimeRecognitionResult) => {
  isVoicePreparing.value = false;
  isVoiceRecording.value = false;
  isRealtimeVoiceSession.value = false;

  if (isPageUnloading) {
    return;
  }

  const transcript =
    readRealtimeRecognitionText(result) || realtimeVoicePartialText;
  const sourcePath = result.tempFilePath?.trim() || "";
  const duration = result.duration || 0;

  if (transcript) {
    inputValue.value = joinVoiceInput(realtimeVoiceBaseText, transcript);
    showToast("语音已实时转成文字，请确认后记录");
    resetRealtimeVoiceDraft();
    return;
  }

  resetRealtimeVoiceDraft();

  if (sourcePath && duration >= 600) {
    void transcribeRecordedVoice(sourcePath);
    return;
  }

  showToast(duration < 600 ? "说话时间太短" : "暂未识别到语音内容");
};

const handleRealtimeRecognitionError = (result: RealtimeRecognitionResult) => {
  isVoicePreparing.value = false;
  isVoiceRecording.value = false;
  isRealtimeVoiceSession.value = false;
  isRealtimeRecognitionDisabled = true;

  if (isPageUnloading) {
    return;
  }

  inputValue.value = joinVoiceInput(
    realtimeVoiceBaseText,
    realtimeVoicePartialText
  );
  resetRealtimeVoiceDraft();
  showToast(
    result.msg
      ? `实时识别暂不可用：${result.msg}`
      : "实时识别暂不可用，已切换普通语音模式"
  );
};

const handleRecorderStop = (result: RecorderStopResult) => {
  isVoiceRecording.value = false;

  if (isPageUnloading) {
    return;
  }

  const sourcePath = result.tempFilePath?.trim() || "";
  if (!sourcePath) {
    showToast("录音失败，请稍后重试");
    return;
  }

  if ((result.duration || 0) < 600) {
    showToast("说话时间太短");
    return;
  }

  void transcribeRecordedVoice(sourcePath);
};

const handleRecorderError = (error: unknown) => {
  isVoiceRecording.value = false;
  isVoicePreparing.value = false;
  showToast(describeRecorderError(error));
};

recorderManager.onStop(handleRecorderStop);
recorderManager.onError(handleRecorderError);

const showBlockingError = computed(() =>
  Boolean(loadError.value && !agent.value)
);
const coveredFields = computed(() =>
  profileFieldOrder.filter((field) => Boolean(draft.value[field].trim()))
);
const canGenerate = computed(() => coveredFields.value.length > 0);
const hasSavedProfile = computed(() => {
  const detail = agent.value;
  return detail
    ? profileFieldOrder.some((field) => Boolean(detail[field].trim()))
    : false;
});
const isVoiceBusy = computed(
  () =>
    isVoicePreparing.value ||
    isVoiceRecording.value ||
    isTranscribingVoice.value
);
const canSend = computed(
  () =>
    Boolean(inputValue.value.trim()) &&
    !isThinking.value &&
    !isGenerating.value &&
    !isDeletingEntry.value &&
    !isVoiceBusy.value
);
const latestAssistantPrompt = computed(() => {
  for (let index = messages.value.length - 1; index >= 0; index -= 1) {
    const message = messages.value[index];
    if (message.role === "assistant") {
      return message.text;
    }
  }

  return "跟我讲讲 TA 是什么样的人吧。";
});
const visibleAssistantPrompt = computed(
  () => displayedAssistantPrompt.value || latestAssistantPrompt.value
);
const assistantSpeechControlLabel = computed(() => {
  if (isAssistantSpeechLoading.value) {
    return "正在准备小使者语音";
  }
  if (isAssistantSpeechPlaying.value) {
    return "停止朗读";
  }
  return "朗读小使者的话";
});
const messengerArrivalText = computed(() => {
  const name = agent.value?.name?.trim() || routeAgentName.value.trim() || "TA";
  return `${name}的小使者正在赶来`;
});
const messengerDescription = computed(() => {
  if (isVoicePreparing.value) {
    return "我准备好听你说了";
  }
  if (isTranscribingVoice.value) {
    return "正在把刚才的话轻轻记下来";
  }
  if (isVoiceRecording.value) {
    return voiceListeningMessages[voiceListeningMessageIndex.value];
  }

  return "我会把你的讲述整理成他的记忆";
});
const userEntries = computed(() =>
  messages.value.filter((message) => message.role === "user")
);
const memoryStatusText = computed(() => {
  if (coveredFields.value.length >= 3) {
    return "这些已经足够生成一份记忆了";
  }

  return "我已经记住一些了";
});
const completedMemorySections = computed(() =>
  memorySections
    .filter((section) => Boolean(draft.value[section.field].trim()))
    .map((section) => ({
      ...section,
      text: draft.value[section.field],
    }))
);

watch(isVoiceRecording, (recording) => {
  if (recording) {
    startVoiceListeningCycle();
    return;
  }

  stopVoiceListeningCycle();
});

useLoad((options) => {
  agentId.value = decodeRouteParam(options?.agentId);
  routeAgentName.value = decodeRouteParam(options?.agentName);
  void preparePage();
});

useUnload(() => {
  isPageUnloading = true;
  stopAssistantPresentation({ completeText: false });
  stopVoiceListeningCycle();

  if (isVoiceRecording.value) {
    try {
      if (isRealtimeVoiceSession.value && realtimeRecognitionManager) {
        realtimeRecognitionManager.stop();
      } else {
        recorderManager.stop();
      }
    } catch {}
  }

  if (realtimeRecognitionManager) {
    realtimeRecognitionManager.onStart = undefined;
    realtimeRecognitionManager.onRecognize = undefined;
    realtimeRecognitionManager.onStop = undefined;
    realtimeRecognitionManager.onError = undefined;
  }

  const recorderWithOff = recorderManager as typeof recorderManager & {
    offStop?: (callback: typeof handleRecorderStop) => void;
    offError?: (callback: typeof handleRecorderError) => void;
  };
  recorderWithOff.offStop?.(handleRecorderStop);
  recorderWithOff.offError?.(handleRecorderError);
});

function startVoiceListeningCycle() {
  stopVoiceListeningCycle();
  voiceListeningMessageIndex.value = 0;
  voiceListeningTimer = setInterval(() => {
    voiceListeningMessageIndex.value =
      (voiceListeningMessageIndex.value + 1) % voiceListeningMessages.length;
  }, 2800);
}

function stopVoiceListeningCycle() {
  if (voiceListeningTimer) {
    clearInterval(voiceListeningTimer);
    voiceListeningTimer = null;
  }
  voiceListeningMessageIndex.value = 0;
}

function createEmptyDraft(): AgentProfileInterviewDraftDTO {
  return {
    lifeExperience: "",
    personalityTraits: "",
    languageHabits: "",
    hobbies: "",
    sharedMemories: "",
  };
}

function createDraftFromAgent(
  detail: AgentSummary
): AgentProfileInterviewDraftDTO {
  return {
    lifeExperience: detail.lifeExperience,
    personalityTraits: detail.personalityTraits,
    languageHabits: detail.languageHabits,
    hobbies: detail.hobbies,
    sharedMemories: detail.sharedMemories,
  };
}

function decodeRouteParam(value?: string) {
  if (typeof value !== "string") {
    return "";
  }

  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function extractInputValue(event: unknown) {
  if (!event || typeof event !== "object") {
    return "";
  }

  const detail = "detail" in event ? event.detail : undefined;

  if (detail && typeof detail === "object" && "value" in detail) {
    return typeof detail.value === "string" ? detail.value : "";
  }

  return "";
}

function showToast(title: string) {
  void Taro.showToast({
    title,
    icon: "none",
    duration: 1800,
  });
}

async function preparePage() {
  isCheckingAuth.value = true;
  const authenticated = await ensureAuthenticatedSession();

  if (!authenticated) {
    await redirectToAuthPage();
    return;
  }

  isCheckingAuth.value = false;
  await loadAgentDetail();
}

async function loadAgentDetail() {
  if (!agentId.value) {
    loadError.value = "缺少联系人资料，请返回后重新进入";
    return;
  }

  isLoading.value = true;
  loadError.value = "";

  let initialGreeting = "";

  try {
    const detail = await getAgentDetail(agentId.value);
    const savedDraft = createDraftFromAgent(detail);
    agent.value = detail;
    draft.value = savedDraft;
    interviewBaselineDraft.value = { ...savedDraft };
    nextFocusField.value = resolveNextFocusField(draft.value);
    initialGreeting = buildAgentProfileInitialGreeting(detail);
    messages.value = [createMessage("assistant", initialGreeting)];
    isCompleted.value = false;
    scrollToLatest();
    void markAgentGuideSeen(agentId.value, "agent-profile").catch(
      () => undefined
    );
  } catch (error) {
    if (await handleAuthError(error)) {
      return;
    }

    loadError.value =
      error instanceof ApiException
        ? error.message
        : "资料加载失败，请稍后重试";
  } finally {
    isLoading.value = false;
    if (initialGreeting && !isPageUnloading) {
      void nextTick(() => presentAssistantPrompt(initialGreeting));
    }
  }
}

function createMessage(
  role: InterviewMessage["role"],
  text: string
): InterviewMessage {
  messageSequence += 1;
  return {
    id: `${Date.now()}-${messageSequence}`,
    role,
    text,
  };
}

function clearAssistantTimers() {
  if (assistantRevealTimer) {
    clearTimeout(assistantRevealTimer);
    assistantRevealTimer = null;
  }
  if (assistantPlaybackStartTimer) {
    clearTimeout(assistantPlaybackStartTimer);
    assistantPlaybackStartTimer = null;
  }
  stopAssistantWaiting();
}

function startAssistantWaiting(stage: AssistantWaitingStage) {
  stopAssistantWaiting();
  const messages = assistantWaitingMessages[stage];
  let index = 0;
  assistantWaitingText.value = messages[index];
  assistantWaitingTimer = setInterval(() => {
    index = (index + 1) % messages.length;
    assistantWaitingText.value = messages[index];
  }, 1800);
}

function stopAssistantWaiting() {
  if (assistantWaitingTimer) {
    clearInterval(assistantWaitingTimer);
    assistantWaitingTimer = null;
  }
}

function destroyAssistantAudioContext() {
  const audio = assistantAudioContext;
  assistantAudioContext = null;

  if (!audio) {
    return;
  }

  try {
    audio.stop();
  } catch {}
  try {
    audio.destroy();
  } catch {}
}

function stopAssistantPresentation(options: { completeText: boolean }) {
  assistantPresentationGeneration += 1;
  clearAssistantTimers();
  destroyAssistantAudioContext();
  isAssistantPromptPreparing.value = false;
  isAssistantTextRevealing.value = false;
  isAssistantSpeechLoading.value = false;
  isAssistantSpeechPlaying.value = false;

  if (options.completeText && activeAssistantPromptText) {
    displayedAssistantPrompt.value = activeAssistantPromptText;
  }
}

function assistantCharacterDelay(character: string) {
  if (/[。！？!?]/.test(character)) {
    return 220;
  }
  if (/[，、；：,;:]/.test(character)) {
    return 130;
  }
  return 78;
}

function startAssistantTextReveal(text: string, generation: number) {
  if (generation !== assistantPresentationGeneration || isPageUnloading) {
    return;
  }

  const characters = Array.from(text);
  let visibleCharacterCount = 0;
  stopAssistantWaiting();
  isAssistantPromptPreparing.value = false;
  isAssistantSpeechLoading.value = false;
  isAssistantTextRevealing.value = Boolean(characters.length);

  const revealNextCharacter = () => {
    if (generation !== assistantPresentationGeneration || isPageUnloading) {
      return;
    }

    visibleCharacterCount += 1;
    displayedAssistantPrompt.value = characters
      .slice(0, visibleCharacterCount)
      .join("");

    if (visibleCharacterCount >= characters.length) {
      isAssistantTextRevealing.value = false;
      assistantRevealTimer = null;
      return;
    }

    assistantRevealTimer = setTimeout(
      revealNextCharacter,
      assistantCharacterDelay(characters[visibleCharacterCount - 1])
    );
  };

  if (!characters.length) {
    displayedAssistantPrompt.value = "";
    return;
  }

  revealNextCharacter();
}

function syncAssistantTextToPlayback(
  text: string,
  generation: number,
  audio: Taro.InnerAudioContext
) {
  if (
    generation !== assistantPresentationGeneration ||
    assistantAudioContext !== audio ||
    isPageUnloading
  ) {
    return;
  }

  const characters = Array.from(text);
  const duration = Number(audio.duration || 0);
  const currentTime = Number(audio.currentTime || 0);

  if (!characters.length || duration <= 0 || currentTime < 0) {
    return;
  }

  const visibleCharacterCount = resolveAssistantPlaybackCharacterCount({
    currentTime,
    duration,
    totalCharacters: characters.length,
  });

  if (!visibleCharacterCount) {
    return;
  }
  displayedAssistantPrompt.value = characters
    .slice(0, visibleCharacterCount)
    .join("");
  isAssistantTextRevealing.value = visibleCharacterCount < characters.length;
}

async function requestAssistantSpeech(text: string) {
  const prewarmedSource = await getPrewarmedAgentProfileGreetingSpeech(text);

  if (prewarmedSource?.trim()) {
    return prewarmedSource.trim();
  }

  try {
    const result = await createAgentProfileMessengerSpeech(agentId.value, text);
    if (result.url.trim()) {
      return result.url.trim();
    }
  } catch {}

  return "";
}

function playAssistantSpeech(options: {
  source: string;
  text: string;
  generation: number;
  revealTextOnPlay: boolean;
  showFailureToast: boolean;
}) {
  const { source, text, generation, revealTextOnPlay, showFailureToast } =
    options;
  const characters = Array.from(text);

  destroyAssistantAudioContext();
  void ensureInnerAudioPlaybackOptions();
  const audio = Taro.createInnerAudioContext();
  assistantAudioContext = audio;
  audio.obeyMuteSwitch = false;
  audio.onPlay(() => {
    if (
      assistantAudioContext !== audio ||
      generation !== assistantPresentationGeneration
    ) {
      return;
    }
    if (assistantPlaybackStartTimer) {
      clearTimeout(assistantPlaybackStartTimer);
      assistantPlaybackStartTimer = null;
    }
    stopAssistantWaiting();
    if (revealTextOnPlay) {
      displayedAssistantPrompt.value = characters.slice(0, 1).join("");
      isAssistantTextRevealing.value = characters.length > 1;
    }
    isAssistantPromptPreparing.value = false;
    isAssistantSpeechLoading.value = false;
    isAssistantSpeechPlaying.value = true;
  });
  audio.onTimeUpdate(() => {
    if (revealTextOnPlay) {
      syncAssistantTextToPlayback(text, generation, audio);
    }
  });
  audio.onEnded(() => {
    if (assistantAudioContext !== audio) {
      return;
    }
    assistantAudioContext = null;
    if (revealTextOnPlay) {
      displayedAssistantPrompt.value = text;
      isAssistantTextRevealing.value = false;
    }
    isAssistantSpeechPlaying.value = false;
    isAssistantSpeechLoading.value = false;
    audio.destroy();
  });
  audio.onStop(() => {
    if (assistantAudioContext === audio) {
      isAssistantSpeechPlaying.value = false;
      isAssistantSpeechLoading.value = false;
    }
  });
  audio.onError(() => {
    if (assistantAudioContext !== audio) {
      return;
    }
    assistantAudioContext = null;
    if (assistantPlaybackStartTimer) {
      clearTimeout(assistantPlaybackStartTimer);
      assistantPlaybackStartTimer = null;
    }
    cachedAssistantSpeechUrl = "";
    isAssistantSpeechPlaying.value = false;
    isAssistantSpeechLoading.value = false;
    audio.destroy();
    if (revealTextOnPlay) {
      startAssistantTextReveal(text, generation);
    }
    if (showFailureToast && !isPageUnloading) {
      showToast("语音暂时无法播放");
    }
  });
  audio.src = source;
  audio.play();

  if (revealTextOnPlay) {
    assistantPlaybackStartTimer = setTimeout(() => {
      if (
        generation !== assistantPresentationGeneration ||
        isAssistantSpeechPlaying.value
      ) {
        return;
      }
      destroyAssistantAudioContext();
      startAssistantTextReveal(text, generation);
    }, 8000);
  }
}

async function presentAssistantPrompt(text: string) {
  const normalizedText = text.trim();
  if (!normalizedText || isPageUnloading) {
    return;
  }

  stopAssistantPresentation({ completeText: false });
  const generation = assistantPresentationGeneration;
  activeAssistantPromptText = normalizedText;
  displayedAssistantPrompt.value = "";
  cachedAssistantSpeechText = normalizedText;
  cachedAssistantSpeechUrl = "";
  isAssistantPromptPreparing.value = true;
  isAssistantSpeechLoading.value = true;
  startAssistantWaiting("speaking");

  const source = await requestAssistantSpeech(normalizedText);
  if (generation !== assistantPresentationGeneration || isPageUnloading) {
    return;
  }

  if (!source) {
    startAssistantTextReveal(normalizedText, generation);
    return;
  }

  cachedAssistantSpeechUrl = source;
  playAssistantSpeech({
    source,
    text: normalizedText,
    generation,
    revealTextOnPlay: true,
    showFailureToast: false,
  });
}

async function handleAssistantSpeechTap() {
  if (isAssistantSpeechPlaying.value || isAssistantSpeechLoading.value) {
    stopAssistantPresentation({ completeText: true });
    return;
  }

  const text = latestAssistantPrompt.value.trim();
  if (!text) {
    return;
  }

  stopAssistantPresentation({ completeText: true });
  const generation = assistantPresentationGeneration;
  activeAssistantPromptText = text;
  isAssistantSpeechLoading.value = true;
  let source =
    cachedAssistantSpeechText === text ? cachedAssistantSpeechUrl : "";

  if (!source) {
    cachedAssistantSpeechText = text;
    source = await requestAssistantSpeech(text);
  }

  if (generation !== assistantPresentationGeneration || isPageUnloading) {
    return;
  }

  if (!source) {
    isAssistantSpeechLoading.value = false;
    showToast("语音暂时无法播放");
    return;
  }

  cachedAssistantSpeechUrl = source;
  playAssistantSpeech({
    source,
    text,
    generation,
    revealTextOnPlay: false,
    showFailureToast: true,
  });
}

function handleRetry() {
  void loadAgentDetail();
}

function handleInput(event: unknown) {
  inputValue.value = extractInputValue(event);
}

async function handleVoiceButtonTap() {
  if (isVoiceRecording.value) {
    try {
      if (isRealtimeVoiceSession.value && realtimeRecognitionManager) {
        realtimeRecognitionManager.stop();
      } else {
        recorderManager.stop();
      }
    } catch (error) {
      handleActiveVoiceError(error);
    }
    return;
  }

  if (
    isVoiceBusy.value ||
    isThinking.value ||
    isGenerating.value ||
    isDeletingEntry.value
  ) {
    return;
  }

  stopAssistantPresentation({ completeText: true });

  if (await isVoicePrivacyAuthorizationNeeded()) {
    pendingVoiceStartAfterPrivacy = true;
    return;
  }

  await startVoiceRecording();
}

function handleVoicePrivacyAgreed() {
  if (!pendingVoiceStartAfterPrivacy) {
    return;
  }

  pendingVoiceStartAfterPrivacy = false;
  void startVoiceRecording();
}

async function isVoicePrivacyAuthorizationNeeded() {
  const privacyApi = Taro as TaroPrivacyApi;

  if (typeof privacyApi.getPrivacySetting !== "function") {
    return false;
  }

  return await new Promise<boolean>((resolve) => {
    privacyApi.getPrivacySetting?.({
      success: (result) => resolve(Boolean(result.needAuthorization)),
      fail: () => resolve(false),
    });
  });
}

async function startVoiceRecording() {
  if (
    isVoiceBusy.value ||
    isThinking.value ||
    isGenerating.value ||
    isDeletingEntry.value
  ) {
    return;
  }

  isVoicePreparing.value = true;

  try {
    if (!(await ensureRecordPermission())) {
      return;
    }

    const realtimeManager = getRealtimeRecognitionManager();
    if (realtimeManager) {
      realtimeVoiceBaseText = inputValue.value.trim();
      realtimeVoicePartialText = "";
      isRealtimeVoiceSession.value = true;
      realtimeManager.start({
        duration: 60000,
        lang: "zh_CN",
      });
      isVoiceRecording.value = true;
      return;
    }

    await ensureConversationId();
    recorderManager.start({
      duration: 60000,
      sampleRate: 16000,
      numberOfChannels: 1,
      encodeBitRate: 48000,
      format: "aac",
      audioSource: "auto",
    });
    isVoiceRecording.value = true;
  } catch (error) {
    showToast(describeRecorderError(error));
  } finally {
    isVoicePreparing.value = false;
  }
}

function getRealtimeRecognitionManager() {
  if (isRealtimeRecognitionDisabled) {
    return null;
  }

  if (realtimeRecognitionManager) {
    return realtimeRecognitionManager;
  }

  try {
    const plugin = requirePlugin("WechatSI");
    const manager = plugin.getRecordRecognitionManager?.();

    if (!manager) {
      isRealtimeRecognitionDisabled = true;
      return null;
    }

    manager.onStart = handleRealtimeRecognitionStart;
    manager.onRecognize = handleRealtimeRecognitionUpdate;
    manager.onStop = handleRealtimeRecognitionStop;
    manager.onError = handleRealtimeRecognitionError;
    realtimeRecognitionManager = manager;
    return manager;
  } catch {
    isRealtimeRecognitionDisabled = true;
    return null;
  }
}

function readRealtimeRecognitionText(result: RealtimeRecognitionResult) {
  return (result.result || result.Result || "").trim();
}

function joinVoiceInput(baseText: string, transcript: string) {
  const base = baseText.trim();
  const voiceText = transcript.trim();

  if (!base) {
    return voiceText;
  }
  if (!voiceText) {
    return base;
  }

  const separator = /[，。！？；：,.!?;:]$/.test(base) ? "" : "，";
  return `${base}${separator}${voiceText}`;
}

function resetRealtimeVoiceDraft() {
  realtimeVoiceBaseText = "";
  realtimeVoicePartialText = "";
}

function handleActiveVoiceError(error: unknown) {
  if (isRealtimeVoiceSession.value) {
    handleRealtimeRecognitionError({
      msg: describeRecorderError(error),
    });
    return;
  }

  handleRecorderError(error);
}

async function ensureRecordPermission() {
  const setting = await Taro.getSetting();
  const authSetting = setting.authSetting as Record<
    string,
    boolean | undefined
  >;

  if (authSetting["scope.record"]) {
    return true;
  }

  if (authSetting["scope.record"] === false) {
    const result = await Taro.showModal({
      title: "开启麦克风",
      content: "需要开启麦克风权限，才能把你的讲述转成文字",
      confirmText: "去开启",
      cancelText: "取消",
      confirmColor: "#24222b",
    });

    if (!result.confirm) {
      return false;
    }

    const openedSetting = await Taro.openSetting();
    const openedAuthSetting = openedSetting.authSetting as Record<
      string,
      boolean | undefined
    >;
    return Boolean(openedAuthSetting["scope.record"]);
  }

  try {
    await Taro.authorize({ scope: "scope.record" });
    return true;
  } catch {
    showToast("请允许使用麦克风后再试");
    return false;
  }
}

async function ensureConversationId() {
  if (conversationId.value) {
    return conversationId.value;
  }

  const conversations = await getConversations();
  const matched = conversations.find((item) => item.agentId === agentId.value);

  if (!matched?.id) {
    throw new Error("没有找到 TA 的聊天，请返回后重试");
  }

  conversationId.value = matched.id;
  return matched.id;
}

async function transcribeRecordedVoice(sourcePath: string) {
  isTranscribingVoice.value = true;

  try {
    const activeConversationId = await ensureConversationId();
    const recordingFile = resolveRecordingFile(sourcePath);
    const uploaded = await uploadLocalFile(sourcePath, {
      folder: "profile-interview-voice",
      fileName: `profile_voice_${Date.now()}${recordingFile.extension}`,
      contentType: recordingFile.mimeType,
    });
    const transcript = await transcribeConversationVoice(activeConversationId, {
      objectKey: uploaded.objectKey,
      mimeType: recordingFile.mimeType,
    });

    if (!transcript.trim()) {
      showToast("暂未识别到语音内容");
      return;
    }

    inputValue.value = [inputValue.value.trim(), transcript.trim()]
      .filter(Boolean)
      .join("，");
    showToast("已转成文字，请确认后发送");
  } catch (error) {
    if (await handleAuthError(error)) {
      return;
    }

    showToast(
      error instanceof ApiException
        ? error.message
        : error instanceof Error
        ? error.message
        : "语音转文字失败，请稍后重试"
    );
  } finally {
    isTranscribingVoice.value = false;
  }
}

function resolveRecordingFile(sourcePath: string) {
  const extension = sourcePath.match(/\.(aac|m4a|mp3|wav)(?:\?|$)/i)?.[1];
  const normalizedExtension = extension?.toLowerCase() || "aac";
  const mimeTypes: Record<string, string> = {
    aac: "audio/aac",
    m4a: "audio/mp4",
    mp3: "audio/mpeg",
    wav: "audio/wav",
  };

  return {
    extension: `.${normalizedExtension}`,
    mimeType: mimeTypes[normalizedExtension] || "audio/aac",
  };
}

function describeRecorderError(error: unknown) {
  const message =
    error instanceof Error
      ? error.message
      : error && typeof error === "object" && "errMsg" in error
      ? String(error.errMsg)
      : "";

  if (/auth|permission|scope\.record|麦克风/i.test(message)) {
    return "请在权限设置中允许使用麦克风后再试";
  }

  if (/privacy|隐私/i.test(message)) {
    return "请先同意隐私保护指引后再使用语音";
  }

  return message || "录音失败，请稍后重试";
}

async function handleSend() {
  const content = inputValue.value.trim();

  if (!content || !agent.value || !canSend.value) {
    return;
  }

  stopAssistantPresentation({ completeText: true });
  messages.value.push(createMessage("user", content));
  inputValue.value = "";
  isThinking.value = true;
  startAssistantWaiting("thinking");
  scrollToLatest();

  let assistantReply = "";

  try {
    const result = await interviewAgentProfile(agentId.value, {
      input: content,
      draft: draft.value,
      focusField: nextFocusField.value,
      turnCount: turnCount.value,
    });
    draft.value = result.draft;
    nextFocusField.value = result.nextFocusField;
    turnCount.value += 1;
    assistantReply = result.reply || buildLocalQuestion(result.nextFocusField);
  } catch (error) {
    if (await handleAuthError(error)) {
      return;
    }

    const fallback = buildLocalInterviewTurn(content);
    draft.value = fallback.draft;
    nextFocusField.value = fallback.nextFocusField;
    turnCount.value += 1;
    assistantReply = fallback.reply;
  } finally {
    isThinking.value = false;
    if (assistantReply && !isPageUnloading) {
      messages.value.push(createMessage("assistant", assistantReply));
      void presentAssistantPrompt(assistantReply);
    } else {
      stopAssistantWaiting();
    }
    scrollToLatest();
  }
}

function handleDeleteEntryTap(entry: InterviewMessage) {
  if (
    entry.role !== "user" ||
    isThinking.value ||
    isVoiceBusy.value ||
    isGenerating.value ||
    isDeletingEntry.value
  ) {
    return;
  }

  pendingDeleteEntry.value = entry;
  isDeleteDialogVisible.value = true;
}

function handleDeleteDialogCancel() {
  isDeleteDialogVisible.value = false;
  pendingDeleteEntry.value = null;
}

function handleDeleteDialogConfirm() {
  const entry = pendingDeleteEntry.value;
  isDeleteDialogVisible.value = false;
  pendingDeleteEntry.value = null;

  if (!entry) {
    return;
  }

  void deleteEntryAndRebuildDraft(entry.id);
}

async function deleteEntryAndRebuildDraft(entryId: string) {
  if (isDeletingEntry.value || !agent.value) {
    return;
  }

  const remainingEntries = userEntries.value.filter(
    (entry) => entry.id !== entryId
  );
  if (remainingEntries.length === userEntries.value.length) {
    return;
  }

  stopAssistantPresentation({ completeText: true });
  deletingEntryId.value = entryId;
  isDeletingEntry.value = true;
  isThinking.value = true;
  startAssistantWaiting("thinking");
  draft.value = { ...interviewBaselineDraft.value };
  nextFocusField.value = resolveNextFocusField(draft.value);
  turnCount.value = 0;
  let finalReply = buildAgentProfileInitialGreeting(agent.value);

  let shouldPresentFinalReply = false;

  try {
    for (const entry of remainingEntries) {
      try {
        const result = await interviewAgentProfile(agentId.value, {
          input: entry.text,
          draft: draft.value,
          focusField: nextFocusField.value,
          turnCount: turnCount.value,
        });
        draft.value = result.draft;
        nextFocusField.value = result.nextFocusField;
        turnCount.value += 1;
        finalReply = result.reply || buildLocalQuestion(result.nextFocusField);
      } catch (error) {
        if (await handleAuthError(error)) {
          return;
        }

        const fallback = buildLocalInterviewTurn(entry.text);
        draft.value = fallback.draft;
        nextFocusField.value = fallback.nextFocusField;
        turnCount.value += 1;
        finalReply = fallback.reply;
      }
    }

    messages.value = [
      createMessage("assistant", finalReply),
      ...remainingEntries,
    ];
    shouldPresentFinalReply = true;
    showToast("已删除并重新整理");
  } finally {
    deletingEntryId.value = "";
    isDeletingEntry.value = false;
    isThinking.value = false;
    if (shouldPresentFinalReply && !isPageUnloading) {
      void presentAssistantPrompt(finalReply);
    } else {
      stopAssistantWaiting();
    }
  }
}

function buildLocalInterviewTurn(content: string) {
  const startedWithCompleteOutline = profileFieldOrder.every((field) =>
    Boolean(draft.value[field].trim())
  );
  const nextDraft = { ...draft.value };
  const targetField =
    nextFocusField.value ||
    resolveNextFocusField(nextDraft) ||
    "sharedMemories";

  if (targetField) {
    nextDraft[targetField] = [nextDraft[targetField], content]
      .filter(Boolean)
      .join("；")
      .slice(0, 1000);
  }

  const missingField = resolveNextFocusField(nextDraft);
  const nextField = missingField
    ? resolveBroadCoverageField(nextDraft, targetField)
    : startedWithCompleteOutline
    ? ""
    : resolveDepthFocusField(nextDraft, targetField);
  return {
    draft: nextDraft,
    nextFocusField: nextField,
    reply: missingField
      ? buildLocalQuestion(nextField)
      : nextField
      ? buildLocalDepthQuestion(nextField)
      : buildLocalQuestion(""),
  };
}

function resolveBroadCoverageField(
  value: AgentProfileInterviewDraftDTO,
  previousField: AgentProfileMemoryField
): AgentProfileMemoryField | "" {
  const missingFields = profileFieldOrder.filter(
    (field) => !value[field].trim()
  );
  const alternatives = missingFields.filter((field) => field !== previousField);

  return alternatives[0] || missingFields[0] || "";
}

function resolveDepthFocusField(
  value: AgentProfileInterviewDraftDTO,
  previousField: AgentProfileMemoryField
): AgentProfileMemoryField {
  const alternatives = profileFieldOrder.filter(
    (field) => field !== previousField
  );
  const candidates = alternatives.length ? alternatives : profileFieldOrder;

  return [...candidates].sort(
    (left, right) => value[left].length - value[right].length
  )[0];
}

function resolveNextFocusField(
  value: AgentProfileInterviewDraftDTO
): AgentProfileMemoryField | "" {
  return profileFieldOrder.find((field) => !value[field].trim()) || "";
}

function buildLocalQuestion(field: AgentProfileMemoryField | "") {
  const name = agent.value?.name?.trim() || "TA";
  const questions: Record<AgentProfileMemoryField, string> = {
    personalityTraits: `谢谢，我记住了。一想到${name}，你最先想起 TA 怎样的性格？`,
    lifeExperience: `谢谢，我记住了。${name}的人生里，有没有一段很重要的经历？`,
    hobbies: `听起来很鲜活。${name}平时最喜欢做什么？`,
    languageHabits: `我好像更了解 TA 了。${name}有没有常说的一句话？`,
    sharedMemories: `最后再听你讲讲，你和${name}最想留住的一段回忆吧。`,
  };

  return field
    ? questions[field]
    : "我已经记住不少了。你可以现在生成记忆，也可以再讲一点。";
}

function buildLocalDepthQuestion(field: AgentProfileMemoryField) {
  const name = agent.value?.name?.trim() || "TA";
  const questions: Record<AgentProfileMemoryField, string> = {
    personalityTraits: `我大致认识${name}了。有没有一件小事，最能看出 TA 的性格？`,
    lifeExperience: `${name}的人生轮廓我记住了。哪段经历对 TA 的影响最深？`,
    hobbies: `关于${name}喜欢的事，哪一种最能让 TA 开心？`,
    languageHabits: `${name}这样说话时，通常是什么样的语气？`,
    sharedMemories: "这些回忆里，哪一个小细节最让你想念？",
  };

  return questions[field];
}

async function handleGenerateMemory() {
  if (
    !agent.value ||
    !canGenerate.value ||
    isThinking.value ||
    isGenerating.value ||
    isDeletingEntry.value ||
    isVoiceBusy.value
  ) {
    return;
  }

  stopAssistantPresentation({ completeText: true });
  isGenerating.value = true;
  const startedAt = Date.now();

  try {
    const payload: UpdateAgentProfileDTO = {
      lifeExperience: draft.value.lifeExperience.trim(),
      personalityTraits: draft.value.personalityTraits.trim(),
      languageHabits: draft.value.languageHabits.trim(),
      hobbies: draft.value.hobbies.trim(),
      sharedMemories: draft.value.sharedMemories.trim(),
    };
    const savedAgent = await updateAgentProfile(agentId.value, payload);
    const remainingAnimation = Math.max(0, 900 - (Date.now() - startedAt));

    if (remainingAnimation) {
      await new Promise((resolve) => setTimeout(resolve, remainingAnimation));
    }

    agent.value = savedAgent;
    draft.value = createDraftFromAgent(savedAgent);
    interviewBaselineDraft.value = { ...draft.value };
    isCompleted.value = true;
  } catch (error) {
    if (await handleAuthError(error)) {
      return;
    }

    showToast(
      error instanceof ApiException ? error.message : "记忆生成失败，请稍后重试"
    );
  } finally {
    isGenerating.value = false;
  }
}

function handleFinishTap() {
  if (
    !canGenerate.value ||
    isThinking.value ||
    isVoiceBusy.value ||
    isDeletingEntry.value
  ) {
    return;
  }

  isFinishDialogVisible.value = true;
}

function handleFinishDialogCancel() {
  isFinishDialogVisible.value = false;
}

function handleFinishDialogConfirm() {
  isFinishDialogVisible.value = false;
  void handleGenerateMemory();
}

function handleContinueInterview() {
  const reply = "我还在听。你还想让我记住关于 TA 的什么？";
  isCompleted.value = false;
  messages.value = [createMessage("assistant", reply)];
  nextFocusField.value = resolveNextFocusField(draft.value);
  void presentAssistantPrompt(reply);
  nextTick(scrollToLatest);
}

async function handleReturnToAgent() {
  stopAssistantPresentation({ completeText: true });
  try {
    await Taro.navigateBack({ delta: 1 });
  } catch {
    await Taro.redirectTo({
      url: `/pages/agent-detail/index?agentId=${encodeURIComponent(
        agentId.value
      )}`,
    });
  }
}

async function handleOpenProfileDetail() {
  if (!agentId.value) {
    showToast("缺少联系人资料");
    return;
  }

  stopAssistantPresentation({ completeText: true });
  await Taro.navigateTo({
    url: `/pages/agent-profile-detail/index?agentId=${encodeURIComponent(
      agentId.value
    )}&source=interview`,
  });
}

async function handleAuthError(error: unknown) {
  if (!(error instanceof ApiException) || !error.requiresReLogin) {
    return false;
  }

  await clearAuthSession();
  await redirectToAuthPage();
  return true;
}

function scrollToLatest() {
  if (!userEntries.value.length) {
    return;
  }

  scrollIntoViewTarget.value = "";
  void nextTick(() => {
    scrollIntoViewTarget.value = "agent-profile-entries-end";
  });
}
</script>

<style lang="scss">
.agent-profile-page {
  min-height: 100vh;
}

.agent-profile-state {
  min-height: 100%;
  padding: 48px 32px 96px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  text-align: center;
  background: #ffffff;
}

.agent-profile-state__messenger {
  width: 72px;
  height: 72px;
  margin-bottom: 6px;
  animation: agent-profile-float 3.2s ease-in-out infinite;
}

.agent-profile-state__image {
  width: 100%;
  height: 100%;
}

.agent-profile-state__title {
  color: #1f1e25;
  font-size: 18px;
  line-height: 26px;
  font-weight: 600;
}

.agent-profile-state__text {
  max-width: 280px;
  color: #85838d;
  font-size: 14px;
  line-height: 22px;
}

.agent-profile-state__button {
  height: 42px;
  min-width: 112px;
  margin-top: 8px;
  padding: 0 22px;
  border-radius: 8px;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #ffffff;
  background: #1f1e25;
  font-size: 15px;
}

.agent-profile-workspace {
  min-height: 100%;
  background: #f6f6f8;
}

.agent-profile-messenger {
  min-height: 194px;
  padding: 22px 24px 18px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  align-items: center;
  background: #ffffff;
}

.agent-profile-messenger__visual {
  position: relative;
  flex: 0 0 94px;
  width: 94px;
  height: 94px;
  display: flex;
  align-items: center;
  justify-content: center;
  animation: agent-profile-float 3.4s ease-in-out infinite;
}

.agent-profile-messenger__halo {
  position: absolute;
  inset: 13px;
  border-radius: 50%;
  box-shadow: 0 0 24px rgba(86, 119, 194, 0.28),
    0 0 44px rgba(193, 143, 190, 0.22);
  animation: agent-profile-breathe 2.8s ease-in-out infinite;
}

.agent-profile-messenger__listening-ring {
  position: absolute;
  z-index: 0;
  inset: 10px;
  border: 1px solid rgba(63, 125, 114, 0.38);
  border-radius: 50%;
  pointer-events: none;
  animation: agent-profile-listening-wave 2.8s ease-out infinite;
}

.agent-profile-messenger__listening-ring--second {
  animation-delay: 1.4s;
}

.agent-profile-messenger__visual--listening .agent-profile-messenger__halo {
  box-shadow: 0 0 26px rgba(63, 125, 114, 0.32),
    0 0 48px rgba(121, 166, 151, 0.22);
}

.agent-profile-messenger__visual--listening .agent-profile-messenger__image {
  filter: drop-shadow(0 5px 12px rgba(63, 125, 114, 0.24));
  animation: agent-profile-attentive 1.9s ease-in-out infinite;
}

.agent-profile-messenger__image {
  position: relative;
  z-index: 1;
  width: 94px;
  height: 94px;
}

.agent-profile-messenger__identity {
  width: 100%;
  margin-top: 7px;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}

.agent-profile-messenger__name {
  color: #24222b;
  font-size: 16px;
  line-height: 24px;
  font-weight: 600;
}

.agent-profile-messenger__desc {
  margin-top: 2px;
  color: #92909a;
  font-size: 12px;
  line-height: 19px;
}

.agent-profile-messenger__desc--listening {
  color: #3f7d72;
  font-weight: 500;
}

.agent-profile-messenger__detail-link {
  flex: 0 0 auto;
  height: 28px;
  margin-top: 4px;
  padding: 0 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 3px;
  color: #77747f;
  font-size: 12px;
  line-height: 18px;
}

.agent-profile-prompt {
  min-height: 80px;
  padding: 16px 28px 18px;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  text-align: center;
  border-top: 1px solid #f0f0f3;
  border-bottom: 1px solid #eeeef2;
  background: #ffffff;
}

.agent-profile-prompt__text {
  color: #37353e;
  font-size: 15px;
  line-height: 24px;
  font-weight: 500;
  word-break: break-word;
}

.agent-profile-prompt__content {
  width: 100%;
  max-width: 322px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 9px;
}

.agent-profile-prompt__copy {
  flex: 0 1 auto;
  min-width: 0;
  max-width: 282px;
}

.agent-profile-prompt__cursor {
  margin-left: 1px;
  color: #8d86ae;
  font-size: 14px;
  line-height: 24px;
  animation: agent-profile-cursor 780ms ease-in-out infinite;
}

.agent-profile-prompt__speech {
  flex: 0 0 30px;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f1f0f5;
  transition: background 160ms ease;
}

.agent-profile-prompt__speech--active {
  background: #77728f;
}

.agent-profile-prompt__speech-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  animation: agent-profile-spin 1.2s linear infinite;
}

.agent-profile-prompt__thinking {
  color: #77747f;
  font-size: 14px;
  line-height: 22px;
}

.agent-profile-prompt__dots {
  display: flex;
  align-items: center;
  gap: 4px;
}

.agent-profile-thinking-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #8d86ae;
  animation: agent-profile-thinking 1.1s ease-in-out infinite;
}

.agent-profile-thinking-dot:nth-child(2) {
  animation-delay: 150ms;
}

.agent-profile-thinking-dot:nth-child(3) {
  animation-delay: 300ms;
}

.agent-profile-input-area {
  padding: 16px 18px 24px;
  box-sizing: border-box;
  background: #ffffff;
}

.agent-profile-text-input {
  min-height: 166px;
  padding: 13px;
  box-sizing: border-box;
  border: 1px solid #e5e5e9;
  border-radius: 8px;
  background: #f6f6f8;
}

.agent-profile-text-input__field {
  width: 100%;
  height: 112px;
  color: #24222b;
  font-size: 15px;
  line-height: 23px;
}

.agent-profile-text-input__placeholder {
  color: #aaa8b0;
}

.agent-profile-text-input__footer {
  min-height: 42px;
  padding-top: 7px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.agent-profile-voice-tool {
  margin-top: 12px;
  display: flex;
  justify-content: center;
}

.agent-profile-voice-tool__button {
  width: 64px;
  height: 64px;
  min-height: 64px;
  margin: 0;
  padding: 0;
  box-sizing: border-box;
  border: 0;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
  background: #24222b;
  box-shadow: 0 5px 14px rgba(36, 34, 43, 0.16);
  transition: background 160ms ease, box-shadow 160ms ease;
}

.agent-profile-voice-tool__button::after {
  border: 0;
}

.agent-profile-voice-tool__button--recording {
  background: #3f7d72;
  animation: agent-profile-recording 1.2s ease-in-out infinite;
}

.agent-profile-voice-tool__button--busy {
  background: #77728f;
}

.agent-profile-voice-tool__icon {
  width: 64px;
  height: 64px;
  flex: 0 0 64px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.agent-profile-voice-tool__loading {
  display: flex;
  align-items: center;
  justify-content: center;
  animation: agent-profile-spin 1.2s linear infinite;
}

.agent-profile-text-input__privacy {
  display: block;
  min-width: 0;
  flex: 1;
  color: #aaa8b0;
  font-size: 11px;
  line-height: 17px;
}

.agent-profile-text-input__send {
  flex: 0 0 auto;
  height: 38px;
  padding: 0 13px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  color: #ffffff;
  background: #24222b;
  font-size: 13px;
  line-height: 20px;
  font-weight: 600;
  transition: opacity 160ms ease;
}

.agent-profile-text-input__send--disabled {
  opacity: 0.28;
}

.agent-profile-entries {
  margin-top: 8px;
  padding: 21px 18px 30px;
  box-sizing: border-box;
  background: #ffffff;
}

.agent-profile-entries__heading {
  padding-bottom: 14px;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  border-bottom: 1px solid #ececf0;
}

.agent-profile-entries__heading > view {
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.agent-profile-entries__title {
  color: #24222b;
  font-size: 15px;
  line-height: 23px;
  font-weight: 600;
}

.agent-profile-entries__desc {
  margin-top: 2px;
  color: #8f8d96;
  font-size: 12px;
  line-height: 19px;
}

.agent-profile-entries__count {
  flex: 0 0 auto;
  margin-top: 2px;
  color: #297b69;
  font-size: 12px;
  line-height: 19px;
  font-weight: 600;
}

.agent-profile-entry {
  padding: 15px 0;
  display: flex;
  align-items: flex-start;
  gap: 11px;
  border-bottom: 1px solid #f0f0f3;
  animation: agent-profile-entry-in 240ms ease-out both;
}

.agent-profile-entry__index {
  flex: 0 0 24px;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #297b69;
  background: #eaf4f1;
  font-size: 11px;
  line-height: 1;
  font-weight: 600;
}

.agent-profile-entry__text {
  flex: 1;
  min-width: 0;
  color: #47454e;
  font-size: 14px;
  line-height: 23px;
  word-break: break-word;
}

.agent-profile-entry__delete {
  flex: 0 0 36px;
  width: 36px;
  height: 36px;
  margin-top: -6px;
  margin-right: -6px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #faf4f4;
  transition: opacity 160ms ease, background 160ms ease;
}

.agent-profile-entry__delete--disabled {
  opacity: 0.35;
}

.agent-profile-entry__delete-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  animation: agent-profile-spin 1.2s linear infinite;
}

.agent-profile-anchor {
  width: 100%;
  height: 1px;
}

.agent-profile-finish-bar {
  padding: 10px 16px 8px;
  border-top: 1px solid #ececf0;
  background: #ffffff;
}

.agent-profile-finish-bar__button {
  height: 46px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  color: #ffffff;
  background: #297b69;
  font-size: 15px;
  line-height: 23px;
  font-weight: 600;
  transition: opacity 160ms ease;
}

.agent-profile-finish-bar__button--disabled {
  opacity: 0.45;
}

.agent-profile-generating {
  position: absolute;
  z-index: 100;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 28px;
  box-sizing: border-box;
  text-align: center;
  background: rgba(255, 255, 255, 0.97);
}

.agent-profile-generating__visual {
  position: relative;
  width: 112px;
  height: 112px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.agent-profile-generating__ring {
  position: absolute;
  inset: 7px;
  border: 1px solid rgba(108, 120, 194, 0.2);
  border-top-color: rgba(108, 120, 194, 0.74);
  border-radius: 50%;
  animation: agent-profile-spin 1.8s linear infinite;
}

.agent-profile-generating__image {
  width: 82px;
  height: 82px;
  animation: agent-profile-breathe 2s ease-in-out infinite;
}

.agent-profile-generating__title {
  margin-top: 18px;
  color: #24222b;
  font-size: 20px;
  line-height: 28px;
  font-weight: 600;
}

.agent-profile-generating__desc {
  margin-top: 7px;
  color: #8e8b96;
  font-size: 14px;
  line-height: 22px;
}

.agent-profile-complete {
  min-height: 100%;
  padding: 42px 24px 32px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  align-items: center;
  background: #ffffff;
}

.agent-profile-complete__visual {
  position: relative;
  width: 96px;
  height: 96px;
  animation: agent-profile-complete-in 480ms ease-out both;
}

.agent-profile-complete__image {
  width: 96px;
  height: 96px;
}

.agent-profile-complete__check {
  position: absolute;
  right: 1px;
  bottom: 4px;
  width: 28px;
  height: 28px;
  border: 3px solid #ffffff;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #297b69;
}

.agent-profile-complete__title {
  margin-top: 18px;
  color: #24222b;
  font-size: 22px;
  line-height: 31px;
  font-weight: 600;
}

.agent-profile-complete__desc {
  max-width: 300px;
  margin-top: 8px;
  color: #898791;
  font-size: 14px;
  line-height: 22px;
  text-align: center;
}

.agent-profile-complete__memories {
  width: 100%;
  margin-top: 30px;
  border-top: 1px solid #ececf0;
}

.agent-profile-complete__memory {
  min-height: 56px;
  padding: 12px 0;
  box-sizing: border-box;
  display: flex;
  align-items: start;
  gap: 7px;
  border-bottom: 1px solid #f0f0f3;
}

.agent-profile-complete__memory-mark {
  width: 18px;
  height: 18px;
  margin-top: 2px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #eaf4f1;
}

.agent-profile-complete__memory-label {
  flex: 0 0 78px;
  color: #37353e;
  font-size: 13px;
  line-height: 22px;
  font-weight: 600;
}

.agent-profile-complete__memory-text {
  flex: 1;
  min-width: 0;
  max-height: 44px;
  overflow: hidden;
  color: #87858e;
  font-size: 13px;
  line-height: 22px;
  word-break: break-word;
}

.agent-profile-complete-actions {
  padding: 10px 16px 8px;
  border-top: 1px solid #ececf0;
  background: #ffffff;
}

.agent-profile-complete-actions__primary {
  height: 46px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #ffffff;
  background: #24222b;
  font-size: 15px;
  font-weight: 600;
}

.agent-profile-complete-actions__secondary {
  flex: 1;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #77747f;
  font-size: 13px;
}

.agent-profile-complete-actions__secondary-row {
  display: flex;
  align-items: center;
}

.agent-profile-complete-actions__secondary
  + .agent-profile-complete-actions__secondary {
  position: relative;
}

.agent-profile-complete-actions__secondary
  + .agent-profile-complete-actions__secondary::before {
  position: absolute;
  left: 0;
  width: 1px;
  height: 14px;
  content: "";
  background: #dedde3;
}

.agent-profile-finish-dialog__content {
  color: #6f6c76;
  font-size: 14px;
  line-height: 23px;
}

.agent-profile-finish-dialog__footer {
  width: 100%;
  padding-top: 4px;
  box-sizing: border-box;
  display: flex;
  align-items: center;
}

.agent-profile-finish-dialog__secondary,
.agent-profile-finish-dialog__primary {
  flex: 1;
  min-width: 0;
  height: 42px;
  padding: 0 14px;
  box-sizing: border-box;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  line-height: 20px;
  font-weight: 600;
  white-space: nowrap;
}

.agent-profile-finish-dialog__secondary {
  flex: 0 0 104px;
  margin-right: 12px;
  color: #56535d;
  background: #f0f0f3;
}

.agent-profile-finish-dialog__primary {
  color: #ffffff;
  background: #297b69;
}

.agent-profile-delete-dialog__content {
  color: #6f6c76;
  font-size: 14px;
  line-height: 23px;
}

.agent-profile-delete-dialog__footer {
  display: flex;
  align-items: center;
  gap: 10px;
}

.agent-profile-delete-dialog__secondary,
.agent-profile-delete-dialog__primary {
  flex: 1;
  height: 42px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: 600;
}

.agent-profile-delete-dialog__secondary {
  color: #56535d;
  background: #f0f0f3;
}

.agent-profile-delete-dialog__primary {
  color: #ffffff;
  background: #b84f4f;
}

@keyframes agent-profile-float {
  0%,
  100% {
    transform: translate3d(0, 0, 0);
  }

  50% {
    transform: translate3d(0, -6px, 0);
  }
}

@keyframes agent-profile-breathe {
  0%,
  100% {
    opacity: 0.72;
    transform: scale(0.96);
  }

  50% {
    opacity: 1;
    transform: scale(1.04);
  }
}

@keyframes agent-profile-thinking {
  0%,
  60%,
  100% {
    opacity: 0.35;
    transform: translateY(0);
  }

  30% {
    opacity: 1;
    transform: translateY(-3px);
  }
}

@keyframes agent-profile-cursor {
  0%,
  100% {
    opacity: 0.25;
  }

  50% {
    opacity: 1;
  }
}

@keyframes agent-profile-entry-in {
  from {
    opacity: 0;
    transform: translateY(8px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes agent-profile-spin {
  to {
    transform: rotate(360deg);
  }
}

@keyframes agent-profile-recording {
  0%,
  100% {
    box-shadow: 0 0 0 3px #e6f1ee, 0 3px 10px rgba(63, 125, 114, 0.18);
  }

  50% {
    box-shadow: 0 0 0 7px rgba(230, 241, 238, 0.66),
      0 3px 12px rgba(63, 125, 114, 0.22);
  }
}

@keyframes agent-profile-listening-wave {
  0% {
    opacity: 0.5;
    transform: scale(0.88);
  }

  75%,
  100% {
    opacity: 0;
    transform: scale(1.45);
  }
}

@keyframes agent-profile-attentive {
  0%,
  100% {
    transform: scale(0.98);
  }

  50% {
    transform: scale(1.04);
  }
}

@keyframes agent-profile-complete-in {
  from {
    opacity: 0;
    transform: translateY(12px) scale(0.92);
  }

  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}
</style>
