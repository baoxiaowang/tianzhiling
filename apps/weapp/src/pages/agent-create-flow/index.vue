<template>
  <page-scaffold
    class="agent-create-guide"
    background="#f6f6f8"
    header-background="#ffffff"
    bottom-background="#ffffff"
    body-padding="0"
    :scroll="true"
    :show-scrollbar="false"
    :safe-area-top="false"
    :safe-area-bottom="true"
  >
    <template #header>
      <app-bar
        title="唤醒天之灵"
        background="#ffffff"
        border-color="#eeeef2"
        @back="handleBack"
      />
    </template>

    <view v-if="isCheckingAuth" class="agent-create-guide__arrival">
      <view class="agent-create-guide__arrival-orb">
        <image
          class="agent-create-guide__arrival-image"
          :src="messengerImageUrl"
          mode="aspectFit"
        />
      </view>
      <text class="agent-create-guide__arrival-text">小使者正在赶来</text>
    </view>

    <view v-else class="agent-create-guide__workspace">
      <view class="agent-create-guide__messenger">
        <view
          class="agent-create-guide__messenger-visual"
          :class="{
            'agent-create-guide__messenger-visual--listening': isVoiceRecording,
          }"
        >
          <view class="agent-create-guide__messenger-halo" />
          <template v-if="isVoiceRecording">
            <view
              class="agent-create-guide__listening-ring agent-create-guide__listening-ring--first"
            />
            <view
              class="agent-create-guide__listening-ring agent-create-guide__listening-ring--second"
            />
          </template>
          <image
            class="agent-create-guide__messenger-image"
            :src="messengerImageUrl"
            mode="aspectFit"
          />
        </view>
        <text class="agent-create-guide__messenger-name">天之灵小使者</text>
        <text
          class="agent-create-guide__messenger-desc"
          :class="{
            'agent-create-guide__messenger-desc--listening': isVoiceRecording,
          }"
        >
          {{ messengerDescription }}
        </text>
      </view>

      <view class="agent-create-guide__progress">
        <text class="agent-create-guide__progress-label">
          基本信息 {{ currentStepNumber }}/4
        </text>
        <view class="agent-create-guide__progress-track">
          <view
            v-for="index in 4"
            :key="index"
            class="agent-create-guide__progress-segment"
            :class="{
              'agent-create-guide__progress-segment--active':
                index <= currentStepNumber,
            }"
          />
        </view>
      </view>

      <view class="agent-create-guide__prompt">
        <template v-if="isThinking || isAssistantPromptPreparing">
          <text class="agent-create-guide__prompt-waiting">
            {{ assistantWaitingText }}
          </text>
          <view class="agent-create-guide__prompt-dots">
            <view class="agent-create-guide__prompt-dot" />
            <view class="agent-create-guide__prompt-dot" />
            <view class="agent-create-guide__prompt-dot" />
          </view>
        </template>
        <view v-else class="agent-create-guide__prompt-content">
          <view class="agent-create-guide__prompt-copy">
            <text class="agent-create-guide__prompt-text">
              {{ visibleAssistantPrompt }}
            </text>
            <text
              v-if="isAssistantTextRevealing"
              class="agent-create-guide__prompt-cursor"
            >
              |
            </text>
          </view>
          <view
            class="agent-create-guide__speech"
            :class="{
              'agent-create-guide__speech--active': isAssistantSpeechPlaying,
            }"
            :aria-label="assistantSpeechControlLabel"
            @tap="handleAssistantSpeechTap"
          >
            <Loading
              v-if="isAssistantSpeechLoading"
              color="#77728f"
              size="16"
            />
            <PlayStop
              v-else-if="isAssistantSpeechPlaying"
              color="#ffffff"
              size="15"
            />
            <Voice v-else color="#77728f" size="17" />
          </view>
        </view>
      </view>

      <view
        v-if="completedSummaryRows.length"
        class="agent-create-guide__summary"
      >
        <view class="agent-create-guide__summary-heading">
          <text>小使者已经记住</text>
          <text class="agent-create-guide__summary-hint">点击可修改</text>
        </view>
        <view class="agent-create-guide__summary-items">
          <view
            v-for="row in completedSummaryRows"
            :key="row.key"
            class="agent-create-guide__summary-row"
            @tap="editStep(row.step)"
          >
            <text class="agent-create-guide__summary-value">
              {{ row.label }}：{{ row.value }}
            </text>
            <Edit color="#8a8791" size="13" />
          </view>
        </view>
      </view>

      <view
        v-if="currentStep === 'relationToThem'"
        class="agent-create-guide__choices"
      >
        <text class="agent-create-guide__choices-title">常见关系</text>
        <view class="agent-create-guide__choice-grid">
          <view
            v-for="item in relationOptions"
            :key="item.label"
            class="agent-create-guide__choice"
            :class="{
              'agent-create-guide__choice--selected':
                draft.relationToThem === item.label,
            }"
            @tap="selectRelation(item)"
          >
            {{ item.label }}
          </view>
        </view>
      </view>

      <view
        v-else-if="currentStep === 'agentName'"
        class="agent-create-guide__choices"
      >
        <text class="agent-create-guide__choices-title">聊天中的名称</text>
        <view
          class="agent-create-guide__choice-grid agent-create-guide__choice-grid--name"
        >
          <view
            class="agent-create-guide__choice"
            :class="{
              'agent-create-guide__choice--selected':
                agentNameInputKind === 'relation',
            }"
            @tap="selectAgentNameMode('relation')"
          >
            就叫“{{ draft.relationToThem }}”
          </view>
          <view
            class="agent-create-guide__choice"
            :class="{
              'agent-create-guide__choice--selected':
                agentNameInputKind === 'wechat',
            }"
            @tap="selectAgentNameMode('wechat')"
          >
            微信昵称/备注
          </view>
          <view
            class="agent-create-guide__choice"
            :class="{
              'agent-create-guide__choice--selected':
                agentNameInputKind === 'realName',
            }"
            @tap="selectAgentNameMode('realName')"
          >
            真实姓名
          </view>
        </view>
      </view>

      <view
        v-else-if="currentStep === 'relationToMe'"
        class="agent-create-guide__choices"
      >
        <text class="agent-create-guide__choices-title">常用称呼</text>
        <view class="agent-create-guide__choice-grid">
          <view
            v-for="label in userCallOptions"
            :key="label"
            class="agent-create-guide__choice"
            :class="{
              'agent-create-guide__choice--selected':
                draft.relationToMe === label,
            }"
            @tap="selectUserCall(label)"
          >
            {{ label }}
          </view>
        </view>
      </view>

      <view v-else class="agent-create-guide__avatar-step">
        <view
          class="agent-create-guide__avatar"
          :class="{
            'agent-create-guide__avatar--filled': Boolean(avatarPreviewUrl),
          }"
          @tap="handleAvatarTap"
        >
          <image
            v-if="avatarPreviewUrl"
            class="agent-create-guide__avatar-image"
            :src="avatarPreviewUrl"
            mode="aspectFill"
          />
          <view v-else class="agent-create-guide__avatar-placeholder">
            <Photograph color="#77728f" size="32" />
            <text>选择一张熟悉的照片</text>
          </view>
          <view
            v-if="isUploadingAvatar"
            class="agent-create-guide__avatar-loading"
          >
            <Loading color="#ffffff" size="22" />
          </view>
        </view>
        <nut-button
          class="agent-create-guide__avatar-button"
          size="small"
          plain
          :disabled="isBusy"
          @click="handleAvatarTap"
        >
          {{ avatarPreviewUrl ? "重新选择" : "从相册选择" }}
        </nut-button>
        <text class="agent-create-guide__avatar-tip">
          头像可以稍后在他的主页修改
        </text>
      </view>

      <view v-if="isTextInputStep" class="agent-create-guide__input-section">
        <view class="agent-create-guide__input-area">
          <textarea
            class="agent-create-guide__input"
            :value="inputValue"
            :placeholder="currentInputPlaceholder"
            placeholder-class="agent-create-guide__input-placeholder"
            maxlength="300"
            confirm-type="send"
            :show-confirm-bar="false"
            :disabled="isBusy"
            @input="handleInput"
            @confirm="handlePrimaryAction"
          />
          <view class="agent-create-guide__input-footer">
            <text class="agent-create-guide__input-tip">
              可以一句话告诉小使者多项信息
            </text>
          </view>
        </view>
        <button
          class="agent-create-guide__voice-button"
          :class="{
            'agent-create-guide__voice-button--recording': isVoiceRecording,
            'agent-create-guide__voice-button--busy': isVoicePreparing,
          }"
          open-type="agreePrivacyAuthorization"
          :aria-label="isVoiceRecording ? '停止语音输入' : '开始语音输入'"
          @tap="handleVoiceButtonTap"
          @agreeprivacyauthorization="handleVoicePrivacyAgreed"
        >
          <view class="agent-create-guide__voice-icon">
            <Loading v-if="isVoicePreparing" color="#ffffff" size="20" />
            <PlayStop v-else-if="isVoiceRecording" color="#ffffff" size="19" />
            <Microphone v-else color="#ffffff" size="21" />
          </view>
        </button>
      </view>
    </view>

    <template #bottom>
      <view v-if="!isCheckingAuth" class="agent-create-guide__actions">
        <nut-button
          v-if="currentStep !== 'relationToThem'"
          class="agent-create-guide__back-button"
          plain
          :disabled="isBusy"
          @click="handlePreviousStep"
        >
          上一步
        </nut-button>
        <nut-button
          class="agent-create-guide__primary-button"
          type="primary"
          :block="true"
          :loading="isSubmitting || isThinking"
          :disabled="!canContinue"
          @click="handlePrimaryAction"
        >
          <Check
            v-if="currentStep === 'avatar' && !isSubmitting"
            color="#ffffff"
            size="15"
          />
          <text>{{ primaryActionLabel }}</text>
          <Right
            v-if="currentStep !== 'avatar' && !isThinking"
            color="#ffffff"
            size="15"
          />
        </nut-button>
      </view>
    </template>

    <template #overlay>
      <view v-if="isSubmitting" class="agent-create-guide__creating">
        <view class="agent-create-guide__creating-visual">
          <view class="agent-create-guide__creating-ring" />
          <image
            class="agent-create-guide__creating-image"
            :src="messengerImageUrl"
            mode="aspectFit"
          />
        </view>
        <text class="agent-create-guide__creating-title">
          正在唤醒
          {{ draft.agentName || draft.relationToThem || "他" }} 的天之灵
        </text>
        <text class="agent-create-guide__creating-desc">
          小使者正在把基本信息轻轻放好
        </text>
      </view>
    </template>
  </page-scaffold>
</template>

<script lang="ts">
export default {
  name: "AgentCreateFlowPage",
};
</script>

<script setup lang="ts">
import {
  AGENT_CREATE_AVATAR_QUESTION,
  AGENT_CREATE_MESSENGER_GREETING,
  AGENT_CREATE_NAME_QUESTION,
  AGENT_CREATE_USER_CALL_QUESTION,
  type AgentCreateGuideDraftDTO,
  type AgentCreateGuideField,
  type AgentCreateGuideGender,
} from "@tzl/shared";
import {
  Check,
  Edit,
  Loading,
  Microphone,
  Photograph,
  PlayStop,
  Right,
  Voice,
} from "@nutui/icons-vue-taro";
import Taro from "@tarojs/taro";
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { ApiException } from "../../api/api-exception";
import {
  createAgent,
  interviewAgentCreation,
  updateAgentAvatar,
} from "../../apis/agent";
import {
  getConversations,
  type ConversationSummary,
} from "../../apis/conversation";
import { uploadLocalImage } from "../../apis/storage";
import messengerImageUrl from "../../assets/images/agent-create/header-mark.png";
import { clearAuthSession } from "../../auth/session";
import AppBar from "../../components/app-bar/app-bar.vue";
import PageScaffold from "../../components/page-scaffold/page-scaffold.vue";
import {
  getAgentCreateMessengerSpeech,
  prewarmAgentCreateMessengerSpeech,
} from "../../utils/agent-create-messenger-speech";
import {
  ensureAuthenticatedSession,
  redirectToAuthPage,
} from "../../utils/auth-guard";
import { ensureInnerAudioPlaybackOptions } from "../../utils/audio";
import { resolveAssistantPlaybackCharacterCount } from "../../utils/agent-profile-messenger";
import { prewarmAgentProfileInitialGreeting } from "../../utils/agent-profile-messenger-prewarm";

type CreateStep = AgentCreateGuideField | "avatar";

interface RelationOption {
  label: string;
  gender: AgentCreateGuideGender;
}

interface SummaryRow {
  key: string;
  step: AgentCreateGuideField;
  label: string;
  value: string;
}

interface RealtimeRecognitionResult {
  result?: string;
  Result?: string;
  msg?: string;
}

interface RealtimeRecognitionManager {
  start: (options: { duration: number; lang: "zh_CN" }) => void;
  stop: () => void;
  onStart?: () => void;
  onRecognize?: (result: RealtimeRecognitionResult) => void;
  onStop?: (result: RealtimeRecognitionResult) => void;
  onError?: (result: RealtimeRecognitionResult) => void;
}

interface WechatSIPlugin {
  getRecordRecognitionManager?: () => RealtimeRecognitionManager;
}

interface VoicePrivacySettingResult {
  needAuthorization?: boolean;
}

type TaroPrivacyApi = typeof Taro & {
  getPrivacySetting?: (option: {
    success?: (result: VoicePrivacySettingResult) => void;
    fail?: () => void;
  }) => void;
};

declare const requirePlugin: (name: "WechatSI") => WechatSIPlugin;

const creationSteps: CreateStep[] = [
  "relationToThem",
  "agentName",
  "relationToMe",
  "avatar",
];
const relationOptions: RelationOption[] = [
  { label: "妈妈", gender: "female" },
  { label: "爸爸", gender: "male" },
  { label: "奶奶", gender: "female" },
  { label: "爷爷", gender: "male" },
  { label: "外婆", gender: "female" },
  { label: "外公", gender: "male" },
  { label: "爱人", gender: "" },
  { label: "朋友", gender: "" },
];
const userCallOptions = ["孩子", "闺女", "儿子", "宝贝", "丫头", "输入小名"];
const voiceListeningMessages = [
  "我在认真听",
  "正在轻轻记下你说的话",
  "不用着急，慢慢说",
  "我一直在这里听着",
] as const;
const draft = ref<AgentCreateGuideDraftDTO>({
  relationToThem: "",
  realName: "",
  agentName: "",
  gender: "",
  relationToMe: "",
});
const currentStep = ref<CreateStep>("relationToThem");
const agentNameInputKind = ref<"relation" | "wechat" | "realName" | "">("");
const inputValue = ref("");
const turnCount = ref(0);
const avatarPreviewUrl = ref("");
const avatarObjectKey = ref("");
const isCheckingAuth = ref(true);
const isThinking = ref(false);
const isSubmitting = ref(false);
const isUploadingAvatar = ref(false);
const isVoicePreparing = ref(false);
const isVoiceRecording = ref(false);
const voiceListeningMessageIndex = ref(0);
const assistantPrompt = ref(AGENT_CREATE_MESSENGER_GREETING);
const displayedAssistantPrompt = ref("");
const isAssistantPromptPreparing = ref(false);
const isAssistantTextRevealing = ref(false);
const isAssistantSpeechLoading = ref(false);
const isAssistantSpeechPlaying = ref(false);
const assistantWaitingText = ref("小使者正在组织语言");
let isPageUnloading = false;
let pendingVoiceStartAfterPrivacy = false;
let voiceBaseText = "";
let voicePartialText = "";
let recognitionManager: RealtimeRecognitionManager | null = null;
let assistantAudioContext: Taro.InnerAudioContext | null = null;
let assistantRevealTimer: ReturnType<typeof setTimeout> | null = null;
let assistantPlaybackTimer: ReturnType<typeof setTimeout> | null = null;
let voiceListeningTimer: ReturnType<typeof setInterval> | null = null;
let assistantGeneration = 0;
let cachedSpeechText = "";
let cachedSpeechSource = "";

const isBusy = computed(
  () =>
    isThinking.value ||
    isSubmitting.value ||
    isUploadingAvatar.value ||
    isVoicePreparing.value ||
    isVoiceRecording.value
);
const messengerDescription = computed(() => {
  if (isVoicePreparing.value) {
    return "我准备好听你说了";
  }
  if (isVoiceRecording.value) {
    return voiceListeningMessages[voiceListeningMessageIndex.value];
  }

  return "我来帮你一步步唤醒他";
});
const currentStepNumber = computed(() => {
  return Math.max(1, creationSteps.indexOf(currentStep.value) + 1);
});
const isTextInputStep = computed(
  () =>
    currentStep.value === "relationToThem" ||
    currentStep.value === "agentName" ||
    currentStep.value === "relationToMe"
);
const currentInputPlaceholder = computed(() => {
  if (currentStep.value === "relationToThem") {
    return "例如：妈妈，也可以一起说他平时怎么称呼你";
  }
  if (currentStep.value === "agentName") {
    if (agentNameInputKind.value === "realName") {
      return "输入他的真实姓名";
    }
    if (agentNameInputKind.value === "wechat") {
      return "输入他的微信昵称或备注名";
    }

    return "输入聊天列表中显示的名称";
  }

  return "输入他对你的称呼";
});
const completedSummaryRows = computed<SummaryRow[]>(() => {
  const rows: SummaryRow[] = [];

  if (draft.value.relationToThem) {
    rows.push({
      key: "relationToThem",
      step: "relationToThem",
      label: "你想唤醒",
      value: draft.value.relationToThem,
    });
  }
  if (draft.value.agentName) {
    rows.push({
      key: "agentName",
      step: "agentName",
      label: "智能体名称",
      value: draft.value.agentName,
    });
  }
  if (draft.value.realName) {
    rows.push({
      key: "realName",
      step: "agentName",
      label: "真实姓名",
      value: draft.value.realName,
    });
  }
  if (draft.value.relationToMe) {
    rows.push({
      key: "relationToMe",
      step: "relationToMe",
      label: "他对你的称呼",
      value: draft.value.relationToMe,
    });
  }

  return rows.filter((row) => row.step !== currentStep.value);
});
const canContinue = computed(() => {
  if (isBusy.value) {
    return false;
  }

  if (currentStep.value === "relationToThem") {
    return Boolean(inputValue.value.trim() || draft.value.relationToThem);
  }
  if (currentStep.value === "agentName") {
    return Boolean(inputValue.value.trim() || draft.value.agentName);
  }
  if (currentStep.value === "relationToMe") {
    return Boolean(inputValue.value.trim() || draft.value.relationToMe);
  }

  return Boolean(
    draft.value.relationToThem &&
      draft.value.agentName &&
      draft.value.relationToMe
  );
});
const primaryActionLabel = computed(() => {
  if (currentStep.value === "avatar") {
    return "确认唤醒";
  }
  if (currentStep.value === "relationToThem") {
    return "告诉小使者";
  }
  if (currentStep.value === "agentName") {
    return "确认名称";
  }

  return "继续";
});
const visibleAssistantPrompt = computed(
  () => displayedAssistantPrompt.value || assistantPrompt.value
);
const assistantSpeechControlLabel = computed(() => {
  if (isAssistantSpeechPlaying.value) {
    return "停止播放";
  }
  if (isAssistantSpeechLoading.value) {
    return "语音加载中";
  }

  return "播放小使者语音";
});
function extractInputValue(event: unknown) {
  if (!event || typeof event !== "object") {
    return "";
  }

  const detail = "detail" in event ? event.detail : undefined;
  return detail && typeof detail === "object" && "value" in detail
    ? String(detail.value || "")
    : "";
}

function handleInput(event: unknown) {
  inputValue.value = extractInputValue(event);
}

function showToast(title: string) {
  void Taro.showToast({ title, icon: "none", duration: 1800 });
}

function selectRelation(option: RelationOption) {
  if (isBusy.value) {
    return;
  }

  draft.value.relationToThem = option.label;
  inputValue.value = option.label;
  if (option.gender) {
    draft.value.gender = option.gender;
  }
}

function selectAgentNameMode(kind: "relation" | "wechat" | "realName") {
  if (isBusy.value) {
    return;
  }

  agentNameInputKind.value = kind;
  if (kind === "relation") {
    draft.value.agentName = draft.value.relationToThem;
    inputValue.value = draft.value.relationToThem;
    return;
  }

  draft.value.agentName = "";
  inputValue.value = kind === "realName" ? draft.value.realName : "";
}

function selectUserCall(label: string) {
  if (isBusy.value) {
    return;
  }

  if (label === "输入小名") {
    draft.value.relationToMe = "";
    inputValue.value = "";
    return;
  }

  draft.value.relationToMe = label;
  inputValue.value = label;
}

function editStep(step: AgentCreateGuideField) {
  if (isBusy.value) {
    return;
  }

  currentStep.value = step;
  inputValue.value =
    step === "relationToThem"
      ? draft.value.relationToThem
      : step === "agentName"
      ? draft.value.agentName
      : step === "relationToMe"
      ? draft.value.relationToMe
      : "";
  void presentAssistantPrompt(questionForStep(step));
}

function questionForStep(step: CreateStep) {
  const questions: Record<CreateStep, string> = {
    relationToThem: AGENT_CREATE_MESSENGER_GREETING,
    agentName: AGENT_CREATE_NAME_QUESTION,
    relationToMe: AGENT_CREATE_USER_CALL_QUESTION,
    avatar: AGENT_CREATE_AVATAR_QUESTION,
  };

  return questions[step];
}

function resolveNextMissingStep(): CreateStep {
  if (!draft.value.relationToThem) {
    return "relationToThem";
  }
  if (!draft.value.agentName) {
    return "agentName";
  }
  if (!draft.value.relationToMe) {
    return "relationToMe";
  }

  return "avatar";
}

async function handlePrimaryAction() {
  if (!canContinue.value) {
    return;
  }

  if (currentStep.value === "avatar") {
    await submitCreation();
    return;
  }

  const content = buildCurrentAnswer();

  isThinking.value = true;
  assistantWaitingText.value = "小使者正在记下基本信息";
  stopAssistantPresentation({ completeText: true });

  try {
    const result = await interviewAgentCreation({
      input: content,
      draft: draft.value,
      focusField: currentStep.value,
      turnCount: turnCount.value,
    });
    draft.value = result.draft;
    turnCount.value += 1;
    inputValue.value = "";
    currentStep.value = result.nextFocusField || "avatar";
    if (currentStep.value !== "agentName") {
      agentNameInputKind.value = "";
    }
    assistantPrompt.value = result.reply || questionForStep(currentStep.value);
  } catch (error) {
    if (await handleAuthError(error)) {
      return;
    }

    showToast(
      error instanceof ApiException
        ? error.message
        : "小使者暂时没听清，请再试一次"
    );
    return;
  } finally {
    isThinking.value = false;
  }

  await presentAssistantPrompt(assistantPrompt.value);
}

function buildCurrentAnswer() {
  const input = inputValue.value.trim();

  if (currentStep.value === "agentName") {
    const name = input || draft.value.agentName;
    if (agentNameInputKind.value === "realName") {
      return `他的真实姓名是${name}，智能体名称就叫${name}`;
    }
    if (agentNameInputKind.value === "wechat") {
      return `他的微信昵称或备注名是${name}，智能体名称就叫${name}`;
    }

    return `智能体名称就叫${name}`;
  }

  return (
    input ||
    (currentStep.value === "relationToThem"
      ? draft.value.relationToThem
      : draft.value.relationToMe)
  );
}

function handlePreviousStep() {
  if (isBusy.value) {
    return;
  }

  const currentIndex = creationSteps.indexOf(currentStep.value);
  const previousStep = creationSteps[Math.max(0, currentIndex - 1)];
  currentStep.value = previousStep;
  inputValue.value =
    previousStep === "relationToThem"
      ? draft.value.relationToThem
      : previousStep === "agentName"
      ? draft.value.agentName
      : previousStep === "relationToMe"
      ? draft.value.relationToMe
      : "";
  void presentAssistantPrompt(questionForStep(previousStep));
}

async function handleAvatarTap() {
  if (isBusy.value) {
    return;
  }

  try {
    const result = await Taro.chooseImage({
      count: 1,
      sizeType: ["compressed"],
      sourceType: ["album"],
    });
    const selectedPath = result.tempFilePaths[0];

    if (!selectedPath) {
      return;
    }

    const edited = await editAvatarImage(selectedPath);
    isUploadingAvatar.value = true;
    const upload = await uploadLocalImage(edited, {
      folder: "avatars",
      fileName: `agent_avatar_${Date.now()}.jpg`,
    });
    avatarPreviewUrl.value = upload.publicUrl;
    avatarObjectKey.value = upload.objectKey;
  } catch (error) {
    if (await handleAuthError(error)) {
      return;
    }
    if (!isUserCanceled(error)) {
      showToast(
        error instanceof ApiException
          ? error.message
          : "头像选择失败，请稍后重试"
      );
    }
  } finally {
    isUploadingAvatar.value = false;
  }
}

async function editAvatarImage(filePath: string) {
  try {
    const result = await Taro.editImage({ src: filePath });
    return result.tempFilePath || filePath;
  } catch {
    return filePath;
  }
}

function isUserCanceled(error: unknown) {
  return Boolean(
    error &&
      typeof error === "object" &&
      "errMsg" in error &&
      String(error.errMsg).toLowerCase().includes("cancel")
  );
}

async function submitCreation() {
  if (!canContinue.value || isSubmitting.value) {
    return;
  }

  isSubmitting.value = true;

  try {
    let agent = await createAgent({
      name: draft.value.agentName,
      realName: draft.value.realName || undefined,
      sex:
        draft.value.gender === "male"
          ? 1
          : draft.value.gender === "female"
          ? 0
          : 2,
      iCallAgent: draft.value.relationToThem,
      agentCallMe: draft.value.relationToMe,
    });

    if (avatarObjectKey.value) {
      agent = await updateAgentAvatar(agent.id, avatarObjectKey.value);
    }

    void prewarmAgentProfileInitialGreeting(agent);
    await Taro.showToast({
      title: `已唤醒天之灵：${agent.name}`,
      icon: "none",
      duration: 1000,
    });

    try {
      await openCreatedAgentConversation(agent.id);
    } catch {
      showToast("已唤醒成功，请在联系人列表中进入聊天");
      setTimeout(() => {
        void Taro.reLaunch({ url: "/pages/index/index" });
      }, 500);
    }
  } catch (error) {
    if (await handleAuthError(error)) {
      return;
    }

    showToast(
      error instanceof ApiException
        ? error.message
        : "唤醒天之灵失败，请稍后重试"
    );
  } finally {
    isSubmitting.value = false;
  }
}

function buildChatPageUrl(conversation: ConversationSummary) {
  const query = [
    ["conversationId", conversation.id],
    ["agentId", conversation.agentId],
    ["agentName", conversation.agentName.trim() || "未命名联系人"],
    ["agentAvatar", conversation.agentAvatar],
    ["agentSex", String(conversation.agentSex)],
    ["agentCallMe", conversation.agentCallMe],
    ["iCallAgent", conversation.iCallAgent],
    ["preview", conversation.preview],
    ["createdAt", conversation.createdAt?.toISOString() ?? ""],
  ]
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join("&");

  return `/pages/chat/index?${query}`;
}

async function openCreatedAgentConversation(agentId: string) {
  const conversations = await getConversations({ force: true });
  const conversation = conversations.find((item) => item.agentId === agentId);

  if (!conversation) {
    throw new Error("CONVERSATION_NOT_FOUND");
  }

  await Taro.reLaunch({ url: buildChatPageUrl(conversation) });
}

async function handleAuthError(error: unknown) {
  if (!(error instanceof ApiException) || !error.requiresReLogin) {
    return false;
  }

  await clearAuthSession();
  await redirectToAuthPage();
  return true;
}

async function handleBack() {
  if (isBusy.value) {
    return;
  }

  if (Taro.getCurrentPages().length > 1) {
    await Taro.navigateBack();
    return;
  }

  await Taro.redirectTo({ url: "/pages/agent-create/index" });
}

async function initializePage() {
  const authenticated = await ensureAuthenticatedSession();

  if (!authenticated) {
    await redirectToAuthPage();
    return;
  }

  isCheckingAuth.value = false;
  void prewarmAgentCreateMessengerSpeech();
  await nextTick();
  await presentAssistantPrompt(AGENT_CREATE_MESSENGER_GREETING);
}

function clearAssistantTimers() {
  if (assistantRevealTimer) {
    clearTimeout(assistantRevealTimer);
    assistantRevealTimer = null;
  }
  if (assistantPlaybackTimer) {
    clearTimeout(assistantPlaybackTimer);
    assistantPlaybackTimer = null;
  }
}

function destroyAssistantAudio() {
  const audio = assistantAudioContext;
  assistantAudioContext = null;
  if (!audio) {
    return;
  }

  try {
    audio.stop();
  } catch {}
  audio.destroy();
}

function stopAssistantPresentation(options: { completeText: boolean }) {
  assistantGeneration += 1;
  clearAssistantTimers();
  destroyAssistantAudio();
  isAssistantPromptPreparing.value = false;
  isAssistantSpeechLoading.value = false;
  isAssistantSpeechPlaying.value = false;
  isAssistantTextRevealing.value = false;
  if (options.completeText) {
    displayedAssistantPrompt.value = assistantPrompt.value;
  }
}

function startTextReveal(text: string, generation: number) {
  const characters = Array.from(text);
  let visibleCount = 0;
  isAssistantPromptPreparing.value = false;
  isAssistantSpeechLoading.value = false;
  isAssistantTextRevealing.value = Boolean(characters.length);

  const revealNext = () => {
    if (generation !== assistantGeneration || isPageUnloading) {
      return;
    }

    visibleCount += 1;
    displayedAssistantPrompt.value = characters.slice(0, visibleCount).join("");

    if (visibleCount >= characters.length) {
      isAssistantTextRevealing.value = false;
      assistantRevealTimer = null;
      return;
    }

    assistantRevealTimer = setTimeout(revealNext, 42);
  };

  revealNext();
}

async function presentAssistantPrompt(text: string) {
  const normalized = text.trim();
  if (!normalized || isPageUnloading) {
    return;
  }

  assistantPrompt.value = normalized;
  stopAssistantPresentation({ completeText: false });
  const generation = assistantGeneration;
  displayedAssistantPrompt.value = "";
  isAssistantPromptPreparing.value = true;
  isAssistantSpeechLoading.value = true;
  cachedSpeechText = normalized;
  cachedSpeechSource = "";

  let source = "";
  try {
    source = await getAgentCreateMessengerSpeech(normalized);
  } catch {}

  if (generation !== assistantGeneration || isPageUnloading) {
    return;
  }

  if (!source) {
    startTextReveal(normalized, generation);
    return;
  }

  cachedSpeechSource = source;
  playAssistantSpeech(source, normalized, generation, true);
}

function playAssistantSpeech(
  source: string,
  text: string,
  generation: number,
  revealText: boolean
) {
  destroyAssistantAudio();
  void ensureInnerAudioPlaybackOptions();
  const audio = Taro.createInnerAudioContext();
  const characters = Array.from(text);
  assistantAudioContext = audio;
  audio.obeyMuteSwitch = false;
  audio.onPlay(() => {
    if (assistantAudioContext !== audio || generation !== assistantGeneration) {
      return;
    }
    isAssistantPromptPreparing.value = false;
    isAssistantSpeechLoading.value = false;
    isAssistantSpeechPlaying.value = true;
    if (revealText) {
      displayedAssistantPrompt.value = characters.slice(0, 1).join("");
      isAssistantTextRevealing.value = characters.length > 1;
    }
  });
  audio.onTimeUpdate(() => {
    if (!revealText || assistantAudioContext !== audio) {
      return;
    }
    const count = resolveAssistantPlaybackCharacterCount({
      currentTime: Number(audio.currentTime || 0),
      duration: Number(audio.duration || 0),
      totalCharacters: characters.length,
    });
    if (count) {
      displayedAssistantPrompt.value = characters.slice(0, count).join("");
      isAssistantTextRevealing.value = count < characters.length;
    }
  });
  audio.onEnded(() => {
    if (assistantAudioContext !== audio) {
      return;
    }
    assistantAudioContext = null;
    displayedAssistantPrompt.value = text;
    isAssistantTextRevealing.value = false;
    isAssistantSpeechPlaying.value = false;
    audio.destroy();
  });
  audio.onError(() => {
    if (assistantAudioContext !== audio) {
      return;
    }
    assistantAudioContext = null;
    isAssistantSpeechPlaying.value = false;
    isAssistantSpeechLoading.value = false;
    audio.destroy();
    if (revealText) {
      startTextReveal(text, generation);
    }
  });
  audio.src = source;
  audio.play();

  assistantPlaybackTimer = setTimeout(() => {
    if (generation === assistantGeneration && !isAssistantSpeechPlaying.value) {
      destroyAssistantAudio();
      startTextReveal(text, generation);
    }
  }, 6000);
}

async function handleAssistantSpeechTap() {
  if (isAssistantSpeechPlaying.value || isAssistantSpeechLoading.value) {
    stopAssistantPresentation({ completeText: true });
    return;
  }

  stopAssistantPresentation({ completeText: true });
  const generation = assistantGeneration;
  isAssistantSpeechLoading.value = true;
  let source =
    cachedSpeechText === assistantPrompt.value ? cachedSpeechSource : "";

  if (!source) {
    try {
      source = await getAgentCreateMessengerSpeech(assistantPrompt.value);
    } catch {}
  }

  if (generation !== assistantGeneration || isPageUnloading) {
    return;
  }
  if (!source) {
    isAssistantSpeechLoading.value = false;
    showToast("语音暂时无法播放");
    return;
  }

  cachedSpeechText = assistantPrompt.value;
  cachedSpeechSource = source;
  playAssistantSpeech(source, assistantPrompt.value, generation, false);
}

async function handleVoiceButtonTap() {
  if (isVoiceRecording.value) {
    recognitionManager?.stop();
    return;
  }
  if (isBusy.value) {
    return;
  }

  stopAssistantPresentation({ completeText: true });
  if (await isVoicePrivacyAuthorizationNeeded()) {
    pendingVoiceStartAfterPrivacy = true;
    return;
  }

  await startVoiceRecognition();
}

function handleVoicePrivacyAgreed() {
  if (!pendingVoiceStartAfterPrivacy) {
    return;
  }

  pendingVoiceStartAfterPrivacy = false;
  void startVoiceRecognition();
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

async function startVoiceRecognition() {
  isVoicePreparing.value = true;

  try {
    if (!(await ensureRecordPermission())) {
      return;
    }

    const manager = getRecognitionManager();
    if (!manager) {
      showToast("实时语音暂不可用，请使用文字输入");
      return;
    }

    voiceBaseText = inputValue.value.trim();
    voicePartialText = "";
    manager.start({ duration: 60000, lang: "zh_CN" });
    isVoiceRecording.value = true;
  } catch {
    showToast("语音输入暂不可用，请稍后再试");
  } finally {
    isVoicePreparing.value = false;
  }
}

function getRecognitionManager() {
  if (recognitionManager) {
    return recognitionManager;
  }

  try {
    const plugin = requirePlugin("WechatSI");
    const manager = plugin.getRecordRecognitionManager?.();
    if (!manager) {
      return null;
    }

    manager.onStart = () => {
      isVoicePreparing.value = false;
      isVoiceRecording.value = true;
    };
    manager.onRecognize = (result) => {
      const transcript = readRecognitionText(result);
      if (transcript) {
        voicePartialText = transcript;
        inputValue.value = joinVoiceInput(voiceBaseText, transcript);
      }
    };
    manager.onStop = (result) => {
      isVoiceRecording.value = false;
      const transcript = readRecognitionText(result) || voicePartialText;
      if (transcript) {
        inputValue.value = joinVoiceInput(voiceBaseText, transcript);
      }
      voiceBaseText = "";
      voicePartialText = "";
    };
    manager.onError = (result) => {
      isVoiceRecording.value = false;
      isVoicePreparing.value = false;
      inputValue.value = joinVoiceInput(voiceBaseText, voicePartialText);
      voiceBaseText = "";
      voicePartialText = "";
      showToast(result.msg || "语音识别暂不可用");
    };
    recognitionManager = manager;
    return manager;
  } catch {
    return null;
  }
}

function readRecognitionText(result: RealtimeRecognitionResult) {
  return (result.result || result.Result || "").trim();
}

function joinVoiceInput(base: string, transcript: string) {
  if (!base.trim()) {
    return transcript.trim();
  }
  if (!transcript.trim()) {
    return base.trim();
  }

  return `${base.trim()}，${transcript.trim()}`;
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
    const modal = await Taro.showModal({
      title: "开启麦克风",
      content: "需要开启麦克风权限，才能把你的讲述实时转成文字",
      confirmText: "去开启",
      cancelText: "取消",
      confirmColor: "#297b69",
    });
    if (!modal.confirm) {
      return false;
    }
    const opened = await Taro.openSetting();
    return Boolean(opened.authSetting["scope.record"]);
  }

  try {
    await Taro.authorize({ scope: "scope.record" });
    return true;
  } catch {
    showToast("请允许使用麦克风后再试");
    return false;
  }
}

onMounted(() => {
  void initializePage();
});

watch(isVoiceRecording, (recording) => {
  if (recording) {
    startVoiceListeningCycle();
    return;
  }

  stopVoiceListeningCycle();
});

onUnmounted(() => {
  isPageUnloading = true;
  stopAssistantPresentation({ completeText: false });
  stopVoiceListeningCycle();
  if (isVoiceRecording.value) {
    try {
      recognitionManager?.stop();
    } catch {}
  }
  if (recognitionManager) {
    recognitionManager.onStart = undefined;
    recognitionManager.onRecognize = undefined;
    recognitionManager.onStop = undefined;
    recognitionManager.onError = undefined;
  }
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

</script>

<style lang="scss">
.agent-create-guide {
  min-height: 100vh;
  color: #24222b;
  background: #f6f6f8;
}

.agent-create-guide__arrival {
  display: flex;
  min-height: 62vh;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 18px;
}

.agent-create-guide__arrival-orb,
.agent-create-guide__messenger-visual {
  position: relative;
  width: 82px;
  height: 82px;
}

.agent-create-guide__arrival-image,
.agent-create-guide__messenger-image {
  position: relative;
  z-index: 1;
  width: 100%;
  height: 100%;
  border-radius: 50%;
  box-shadow: 0 0 18px rgba(100, 127, 220, 0.2);
}

.agent-create-guide__arrival-text {
  color: #77747f;
  font-size: 15px;
}

.agent-create-guide__workspace {
  padding: 16px 16px 24px;
}

.agent-create-guide__messenger {
  display: flex;
  align-items: center;
  flex-direction: column;
}

.agent-create-guide__messenger-halo {
  position: absolute;
  inset: -20px;
  border-radius: 50%;
  background: radial-gradient(
    circle,
    rgba(132, 168, 255, 0.22) 0%,
    rgba(150, 115, 231, 0.1) 45%,
    rgba(255, 255, 255, 0) 72%
  );
  animation: agent-create-guide-glow 2.8s ease-in-out infinite;
}

.agent-create-guide__listening-ring {
  position: absolute;
  z-index: 0;
  inset: 4px;
  border: 1px solid rgba(63, 125, 114, 0.4);
  border-radius: 50%;
  pointer-events: none;
  animation: agent-create-guide-listening-wave 2.8s ease-out infinite;
}

.agent-create-guide__listening-ring--second {
  animation-delay: 1.4s;
}

.agent-create-guide__messenger-visual--listening
  .agent-create-guide__messenger-halo {
  background: radial-gradient(
    circle,
    rgba(83, 149, 134, 0.28) 0%,
    rgba(121, 166, 151, 0.12) 48%,
    rgba(255, 255, 255, 0) 72%
  );
}

.agent-create-guide__messenger-visual--listening
  .agent-create-guide__messenger-image {
  box-shadow: 0 0 22px rgba(63, 125, 114, 0.28);
  animation: agent-create-guide-attentive 1.9s ease-in-out infinite;
}

.agent-create-guide__messenger-name {
  margin-top: 8px;
  font-size: 17px;
  font-weight: 600;
  line-height: 24px;
}

.agent-create-guide__messenger-desc {
  margin-top: 2px;
  color: #8a8791;
  font-size: 13px;
  line-height: 20px;
}

.agent-create-guide__messenger-desc--listening {
  color: #3f7d72;
  font-weight: 500;
}

.agent-create-guide__progress {
  margin-top: 16px;
}

.agent-create-guide__progress-label {
  color: #77747f;
  font-size: 12px;
}

.agent-create-guide__progress-track {
  display: grid;
  margin-top: 8px;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 6px;
}

.agent-create-guide__progress-segment {
  height: 3px;
  border-radius: 2px;
  background: #e2e1e6;
}

.agent-create-guide__progress-segment--active {
  background: #297b69;
}

.agent-create-guide__prompt {
  display: flex;
  min-height: 84px;
  margin-top: 14px;
  padding: 14px 4px;
  align-items: center;
  border-top: 1px solid #e9e8ed;
  border-bottom: 1px solid #e9e8ed;
}

.agent-create-guide__prompt-content {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 14px;
}

.agent-create-guide__prompt-copy {
  flex: 1;
  min-width: 0;
}

.agent-create-guide__prompt-text,
.agent-create-guide__prompt-waiting {
  font-size: 18px;
  font-weight: 600;
  line-height: 1.7;
}

.agent-create-guide__prompt-waiting {
  color: #55515d;
}

.agent-create-guide__prompt-cursor {
  margin-left: 2px;
  color: #6d6592;
  animation: agent-create-guide-cursor 760ms step-end infinite;
}

.agent-create-guide__speech {
  display: flex;
  width: 42px;
  height: 42px;
  flex: 0 0 42px;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: #f0eef5;
}

.agent-create-guide__speech--active {
  background: #302d3c;
}

.agent-create-guide__prompt-dots {
  display: flex;
  margin-left: 10px;
  gap: 5px;
}

.agent-create-guide__prompt-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #77728f;
  animation: agent-create-guide-dot 1.1s ease-in-out infinite;
}

.agent-create-guide__prompt-dot:nth-child(2) {
  animation-delay: 160ms;
}

.agent-create-guide__prompt-dot:nth-child(3) {
  animation-delay: 320ms;
}

.agent-create-guide__summary {
  margin-top: 18px;
}

.agent-create-guide__summary-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: #55515d;
  font-size: 13px;
  font-weight: 600;
}

.agent-create-guide__summary-hint {
  color: #9a97a0;
  font-size: 11px;
  font-weight: 400;
}

.agent-create-guide__summary-items {
  display: flex;
  margin-top: 8px;
  flex-wrap: wrap;
  gap: 8px;
}

.agent-create-guide__summary-row {
  display: flex;
  max-width: 100%;
  min-height: 32px;
  padding: 0 10px;
  align-items: center;
  border: 1px solid #dedce3;
  border-radius: 6px;
  background: #ffffff;
  gap: 5px;
}

.agent-create-guide__summary-value {
  overflow: hidden;
  color: #55515d;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.agent-create-guide__choices,
.agent-create-guide__gender,
.agent-create-guide__avatar-step,
.agent-create-guide__input-area {
  margin-top: 16px;
}

.agent-create-guide__choices-title {
  color: #77747f;
  font-size: 13px;
}

.agent-create-guide__choice-grid {
  display: grid;
  margin-top: 9px;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}

.agent-create-guide__choice-grid--name {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.agent-create-guide__choice-grid--name .agent-create-guide__choice {
  height: 42px;
  font-size: 13px;
}

.agent-create-guide__choice {
  display: flex;
  min-width: 0;
  height: 36px;
  padding: 0 6px;
  align-items: center;
  justify-content: center;
  border: 1px solid #dedce3;
  border-radius: 6px;
  color: #55515d;
  background: #ffffff;
  font-size: 14px;
}

.agent-create-guide__choice--selected {
  border-color: #297b69;
  color: #1f6557;
  background: #edf7f3;
  font-weight: 600;
}

.agent-create-guide__gender {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.agent-create-guide__gender-option {
  display: flex;
  height: 88px;
  align-items: center;
  justify-content: center;
  border: 1px solid #dedce3;
  border-radius: 8px;
  background: #ffffff;
  gap: 10px;
}

.agent-create-guide__gender-option--selected {
  border-color: #297b69;
  color: #1f6557;
  background: #edf7f3;
  box-shadow: inset 0 0 0 1px #297b69;
}

.agent-create-guide__gender-symbol {
  display: flex;
  width: 36px;
  height: 36px;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  color: #ffffff;
  background: #77728f;
  font-size: 15px;
}

.agent-create-guide__gender-option--selected
  .agent-create-guide__gender-symbol {
  background: #297b69;
}

.agent-create-guide__gender-label {
  font-size: 16px;
  font-weight: 600;
}

.agent-create-guide__input-section {
  width: 100%;
}

.agent-create-guide__input-area {
  padding: 14px;
  border: 1px solid #dedce3;
  border-radius: 8px;
  background: #ffffff;
}

.agent-create-guide__input {
  width: 100%;
  min-height: 54px;
  max-height: 92px;
  font-size: 16px;
  line-height: 1.55;
}

.agent-create-guide__input-placeholder {
  color: #aaa7af;
}

.agent-create-guide__input-footer {
  display: flex;
  min-height: 22px;
  margin-top: 6px;
  align-items: center;
  justify-content: flex-end;
}

.agent-create-guide__voice-button {
  display: flex;
  width: 64px;
  height: 64px;
  margin: 12px auto 0;
  padding: 0;
  box-sizing: border-box;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 50%;
  background: #302d3c;
  line-height: 1;
  box-shadow: 0 5px 14px rgba(48, 45, 60, 0.16);
}

.agent-create-guide__voice-button::after {
  display: none;
}

.agent-create-guide__voice-button--recording {
  background: #3f7d72;
  animation: agent-create-guide-recording 1.2s ease-in-out infinite;
}

.agent-create-guide__voice-button--busy {
  background: #77728f;
}

.agent-create-guide__voice-icon {
  width: 64px;
  height: 64px;
  flex: 0 0 64px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.agent-create-guide__input-tip {
  color: #aaa7af;
  font-size: 11px;
  text-align: right;
}

.agent-create-guide__avatar-step {
  display: flex;
  align-items: center;
  flex-direction: column;
}

.agent-create-guide__avatar {
  position: relative;
  display: flex;
  width: 142px;
  height: 142px;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border: 1px dashed #c9c6d0;
  border-radius: 8px;
  background: #ffffff;
}

.agent-create-guide__avatar--filled {
  border-style: solid;
}

.agent-create-guide__avatar-image {
  width: 100%;
  height: 100%;
}

.agent-create-guide__avatar-placeholder {
  display: flex;
  align-items: center;
  flex-direction: column;
  color: #77747f;
  font-size: 12px;
  gap: 10px;
}

.agent-create-guide__avatar-loading {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(36, 34, 43, 0.55);
}

.agent-create-guide__avatar-button {
  margin-top: 16px;
}

.agent-create-guide__avatar-tip {
  margin-top: 10px;
  color: #9a97a0;
  font-size: 12px;
}

.agent-create-guide__actions {
  display: flex;
  padding: 12px 16px;
  align-items: center;
  border-top: 1px solid #eeeef2;
  background: #ffffff;
  gap: 10px;
}

.agent-create-guide__back-button {
  flex: 0 0 92px;
}

.agent-create-guide__primary-button {
  flex: 1;
  min-width: 0;
  --nut-button-primary-background-color: #297b69;
  --nut-button-primary-border-color: #297b69;
}

.agent-create-guide__primary-button :deep(.nut-button__wrap) {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}

.agent-create-guide__creating {
  position: absolute;
  z-index: 130;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  background: rgba(246, 246, 248, 0.96);
}

.agent-create-guide__creating-visual {
  position: relative;
  width: 94px;
  height: 94px;
}

.agent-create-guide__creating-ring {
  position: absolute;
  inset: -14px;
  border: 2px solid rgba(41, 123, 105, 0.18);
  border-top-color: #297b69;
  border-radius: 50%;
  animation: agent-create-guide-spin 1.2s linear infinite;
}

.agent-create-guide__creating-image {
  width: 100%;
  height: 100%;
  border-radius: 50%;
}

.agent-create-guide__creating-title {
  margin-top: 26px;
  font-size: 18px;
  font-weight: 600;
}

.agent-create-guide__creating-desc {
  margin-top: 8px;
  color: #77747f;
  font-size: 13px;
}

@keyframes agent-create-guide-glow {
  0%,
  100% {
    opacity: 0.55;
    transform: scale(0.94);
  }

  50% {
    opacity: 1;
    transform: scale(1.08);
  }
}

@keyframes agent-create-guide-cursor {
  0%,
  48% {
    opacity: 1;
  }

  49%,
  100% {
    opacity: 0;
  }
}

@keyframes agent-create-guide-dot {
  0%,
  100% {
    opacity: 0.35;
    transform: translateY(0);
  }

  50% {
    opacity: 1;
    transform: translateY(-3px);
  }
}

@keyframes agent-create-guide-recording {
  0%,
  100% {
    box-shadow: 0 0 0 3px #e6f1ee, 0 3px 10px rgba(63, 125, 114, 0.18);
  }

  50% {
    box-shadow: 0 0 0 8px rgba(230, 241, 238, 0.18),
      0 3px 12px rgba(63, 125, 114, 0.22);
  }
}

@keyframes agent-create-guide-listening-wave {
  0% {
    opacity: 0.5;
    transform: scale(0.9);
  }

  75%,
  100% {
    opacity: 0;
    transform: scale(1.55);
  }
}

@keyframes agent-create-guide-attentive {
  0%,
  100% {
    transform: scale(0.98);
  }

  50% {
    transform: scale(1.04);
  }
}

@keyframes agent-create-guide-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
