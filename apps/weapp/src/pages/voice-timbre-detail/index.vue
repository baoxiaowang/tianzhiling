<template>
  <page-scaffold
    class="voice-timbre-detail-page"
    background="#f5f6f8"
    body-padding="0"
    :scroll="true"
    :safe-area-top="false"
    require-auth
    auth-loading-text="正在打开音色信息..."
  >
    <template #header>
      <app-bar
        title="音色信息"
        background="#ffffff"
        border-color="#eeeeee"
        @back="handleBack"
      />
    </template>

    <view v-if="isLoading" class="timbre-state">
      <Loading color="#77728f" size="22" />
      <text>正在整理音色信息...</text>
    </view>

    <view v-else-if="loadError || !detail" class="timbre-state">
      <text class="timbre-state__title">音色信息暂时没有打开</text>
      <text>{{ loadError }}</text>
      <nut-button size="small" type="primary" @click="loadDetail">
        重新加载
      </nut-button>
    </view>

    <view v-else class="timbre-content">
      <view class="timbre-identity">
        <view class="timbre-identity__icon">
          <Voice color="#ffffff" size="25" />
        </view>
        <view class="timbre-identity__main">
          <view class="timbre-identity__name-row" @tap="openRenameDialog">
            <text class="timbre-identity__name">{{ detail.name }}</text>
            <Edit color="#85818c" size="14" />
          </view>
          <text class="timbre-identity__date">
            {{ formatDate(detail.createdAt) }}创建
          </text>
        </view>
        <view class="timbre-identity__status">
          <Checked color="#28755b" size="14" />
          <text>可使用</text>
        </view>
      </view>

      <view class="timbre-usage">
        <text>{{ detail.retentionMessage }}</text>
      </view>

      <view class="timbre-section timbre-section--agents">
        <view class="timbre-section__heading">
          <view>
            <text class="timbre-section__title">关联天之灵</text>
            <text class="timbre-section__caption">
              选择使用这个音色的天之灵
            </text>
          </view>
        </view>

        <view class="timbre-membership-notice">
          <text>音色只有在声音版会员有效时，才会用于聊天对话。</text>
        </view>

        <view v-if="ownedAgents.length" class="timbre-agent-list">
          <view
            v-for="agent in ownedAgents"
            :key="agent.id"
            class="timbre-agent-option"
            :class="{
              'timbre-agent-option--selected': isAgentSelected(agent.id),
            }"
            @tap="handleAgentAssociation(agent)"
          >
            <image
              v-if="agent.avatar"
              class="timbre-agent-option__avatar"
              :src="agent.avatar"
              mode="aspectFill"
            />
            <view v-else class="timbre-agent-option__avatar timbre-agent-option__avatar--fallback">
              {{ agent.name.slice(0, 1) || "天" }}
            </view>
            <view class="timbre-agent-option__main">
              <text class="timbre-agent-option__name">{{ agent.name }}</text>
              <text class="timbre-agent-option__status">
                {{ agentAssociationLabel(agent.id) }}
              </text>
            </view>
            <Loading
              v-if="isAssociatingAgentId === agent.id"
              color="#28755b"
              size="17"
            />
            <Checked
              v-else-if="isAgentSelected(agent.id)"
              color="#28755b"
              size="18"
            />
            <Right v-else color="#a5a1aa" size="16" />
          </view>
        </view>
        <view v-else class="timbre-empty-row">
          <text>创建天之灵后，可以在这里为他选择音色</text>
        </view>
      </view>

      <view class="timbre-section">
        <view class="timbre-section__heading">
          <view>
            <text class="timbre-section__title">训练声音片段</text>
            <text class="timbre-section__caption">
              这个音色实际使用了 {{ detail.trainingClips.length }} 个片段
            </text>
          </view>
        </view>

        <view v-if="detail.trainingClips.length" class="audio-list">
          <view
            v-for="(clip, index) in detail.trainingClips"
            :key="clip.id"
            class="audio-item"
          >
            <view
              class="audio-item__play"
              @tap="toggleAudio(`clip-${clip.id}`, clip.audioUrl)"
            >
              <Loading
                v-if="audioLoadingId === `clip-${clip.id}`"
                color="#5f5b68"
                size="17"
              />
              <PlayStop
                v-else-if="playingAudioId === `clip-${clip.id}`"
                color="#5f5b68"
                size="18"
              />
              <PlayStart v-else color="#5f5b68" size="18" />
            </view>
            <view class="audio-item__body">
              <view class="audio-item__line">
                <text class="audio-item__name">{{ clip.name }}</text>
                <text v-if="clip.durationSeconds" class="audio-item__duration">
                  {{ formatDuration(clip.durationSeconds) }}
                </text>
              </view>
              <text v-if="clip.sourceName" class="audio-item__source">
                来自 {{ clip.sourceName }}
              </text>
              <text v-if="clip.transcript" class="audio-item__transcript">
                {{ clip.transcript }}
              </text>
            </view>
            <view
              class="audio-item__download"
              @tap="downloadAudio(
                clip.audioUrl,
                `${detail.name}-片段${index + 1}.mp3`,
                `clip-${clip.id}`
              )"
            >
              <Loading
                v-if="downloadingId === `clip-${clip.id}`"
                color="#5f5b68"
                size="17"
              />
              <Download v-else color="#5f5b68" size="18" />
            </view>
          </view>
        </view>

        <view v-else class="timbre-empty-row">
          <text>这个早期音色暂时没有保留单独的训练片段记录</text>
        </view>

        <view
          v-if="detail.trainingAudioUrl"
          class="combined-audio"
        >
          <view>
            <text class="combined-audio__name">合并后的训练音频</text>
            <text class="combined-audio__caption">训练时提交给服务商的完整版本</text>
          </view>
          <view class="combined-audio__actions">
            <view
              class="icon-action"
              @tap="toggleAudio('training-audio', detail.trainingAudioUrl)"
            >
              <PlayStop
                v-if="playingAudioId === 'training-audio'"
                color="#ffffff"
                size="17"
              />
              <PlayStart v-else color="#ffffff" size="17" />
            </view>
            <view
              class="icon-action icon-action--secondary"
              @tap="downloadAudio(
                detail.trainingAudioUrl,
                `${detail.name}-完整训练音频.mp3`,
                'training-audio'
              )"
            >
              <Loading
                v-if="downloadingId === 'training-audio'"
                color="#5f5b68"
                size="17"
              />
              <Download v-else color="#5f5b68" size="17" />
            </view>
          </view>
        </view>
      </view>

      <view class="timbre-section timbre-section--settings">
        <view class="timbre-section__heading">
          <view>
            <text class="timbre-section__title">输出效果</text>
            <text class="timbre-section__caption">
              保存后用于之后生成和聊天中的语音
            </text>
          </view>
        </view>

        <view class="setting-row">
          <view class="setting-row__heading">
            <text class="setting-row__label">说话速度</text>
            <text class="setting-row__value">{{ speedLabel }}</text>
          </view>
          <nut-range
            v-model="speechSpeedPercent"
            :min="50"
            :max="200"
            :step="5"
            :hidden-tag="true"
            active-color="#77728f"
            inactive-color="#e4e1e7"
            button-color="#77728f"
          />
          <view class="setting-row__scale">
            <text>较慢</text>
            <text>正常</text>
            <text>较快</text>
          </view>
        </view>

        <view class="setting-row">
          <view class="setting-row__heading">
            <text class="setting-row__label">声音大小</text>
            <text class="setting-row__value">{{ volumeLabel }}</text>
          </view>
          <nut-range
            v-model="speechVolumePercent"
            :min="25"
            :max="200"
            :step="5"
            :hidden-tag="true"
            active-color="#28755b"
            inactive-color="#e4e1e7"
            button-color="#28755b"
          />
          <view class="setting-row__scale">
            <text>较小</text>
            <text>正常</text>
            <text>较大</text>
          </view>
        </view>

        <nut-button
          class="centered-button"
          block
          type="primary"
          :loading="isSaving"
          :disabled="!hasSettingChanges"
          @click="saveSettings"
        >
          <Check size="17" />
          保存效果
        </nut-button>
      </view>

      <view class="timbre-section timbre-section--generate">
        <view class="timbre-section__heading">
          <view>
            <text class="timbre-section__title">文字生成语音</text>
            <text class="timbre-section__caption">
              每次最多 {{ detail.customSpeechTextMaxLength }} 字，今天还可生成
              {{ detail.customSpeechRemainingToday }} 次
            </text>
          </view>
        </view>

        <nut-textarea
          v-model="customText"
          class="speech-textarea"
          :max-length="detail.customSpeechTextMaxLength"
          :rows="4"
          :limit-show="true"
          :placeholder="
            detail.customSpeechRemainingToday > 0
              ? '输入要生成语音的文字'
              : '今天的生成次数已用完'
          "
        />
        <nut-button
          class="centered-button"
          block
          type="primary"
          :loading="isGenerating"
          :disabled="
            !customText.trim() || detail.customSpeechRemainingToday <= 0
          "
          @click="generateSpeech"
        >
          <Voice size="18" />
          生成语音
        </nut-button>

        <view v-if="detail.generatedAudios.length" class="generated-list">
          <text class="generated-list__title">已生成</text>
          <view
            v-for="(audio, index) in detail.generatedAudios"
            :key="audio.id"
            class="generated-item"
          >
            <view
              class="audio-item__play generated-item__play"
              @tap="toggleAudio(`generated-${audio.id}`, audio.audioUrl)"
            >
              <Loading
                v-if="audioLoadingId === `generated-${audio.id}`"
                color="#28755b"
                size="17"
              />
              <PlayStop
                v-else-if="playingAudioId === `generated-${audio.id}`"
                color="#28755b"
                size="18"
              />
              <PlayStart v-else color="#28755b" size="18" />
            </view>
            <view class="generated-item__body">
              <text class="generated-item__text">{{ audio.text }}</text>
              <text class="generated-item__meta">
                {{ formatDateTime(audio.createdAt) }} · {{ formatSpeed(audio.speechSpeed) }} · {{ formatVolume(audio.speechVolume) }}
              </text>
            </view>
            <view
              class="audio-item__download"
              @tap="downloadAudio(
                audio.audioUrl,
                `${detail.name}-生成语音${detail.generatedAudios.length - index}.mp3`,
                `generated-${audio.id}`
              )"
            >
              <Loading
                v-if="downloadingId === `generated-${audio.id}`"
                color="#5f5b68"
                size="17"
              />
              <Download v-else color="#5f5b68" size="18" />
            </view>
          </view>
        </view>
      </view>
    </view>

    <template #overlay>
      <nut-dialog
        v-model:visible="isRenameDialogVisible"
        title="修改音色名称"
        text-align="left"
        :close-on-click-overlay="false"
        :lock-scroll="true"
        :z-index="130"
      >
        <input
          class="timbre-name-input"
          :value="renameValue"
          maxlength="20"
          placeholder="例如：妈妈的声音"
          @input="handleRenameInput"
        />
        <template #footer>
          <view class="timbre-dialog-actions">
            <nut-button plain :disabled="isRenaming" @click="closeRenameDialog">
              取消
            </nut-button>
            <nut-button
              type="primary"
              :loading="isRenaming"
              :disabled="!renameValue.trim()"
              @click="submitRename"
            >
              保存
            </nut-button>
          </view>
        </template>
      </nut-dialog>
    </template>
  </page-scaffold>
</template>

<script lang="ts">
export default {
  name: "VoiceTimbreDetailPage",
};
</script>

<script setup lang="ts">
import {
  Check,
  Checked,
  Download,
  Edit,
  Loading,
  PlayStart,
  PlayStop,
  Right,
  Voice,
} from "@nutui/icons-vue-taro";
import Taro, { useLoad, useUnload } from "@tarojs/taro";
import { computed, ref } from "vue";
import { ApiException } from "../../api/api-exception";
import { getAgents, type AgentSummary } from "../../apis/agent";
import {
  generateUserVoiceTimbreSpeech,
  getAgentVoiceModelCenter,
  getUserVoiceTimbreDetail,
  selectAgentVoiceTimbre,
  updateUserVoiceTimbre,
  type UserVoiceTimbreDetailDTO,
} from "../../apis/voice-service";
import AppBar from "../../components/app-bar/app-bar.vue";
import PageScaffold from "../../components/page-scaffold/page-scaffold.vue";
import { ensureInnerAudioPlaybackOptions } from "../../utils/audio";

const timbreId = ref("");
const detail = ref<UserVoiceTimbreDetailDTO | null>(null);
const isLoading = ref(true);
const loadError = ref("");
const speechSpeedPercent = ref(100);
const speechVolumePercent = ref(100);
const isSaving = ref(false);
const isGenerating = ref(false);
const customText = ref("");
const playingAudioId = ref("");
const audioLoadingId = ref("");
const downloadingId = ref("");
const ownedAgents = ref<AgentSummary[]>([]);
const isAssociatingAgentId = ref("");
const isRenameDialogVisible = ref(false);
const isRenaming = ref(false);
const renameValue = ref("");

let audioContext: Taro.InnerAudioContext | null = null;

const speedLabel = computed(() =>
  formatSpeed(speechSpeedPercent.value / 100)
);
const volumeLabel = computed(() =>
  formatVolume(speechVolumePercent.value / 100)
);
const hasSettingChanges = computed(() => {
  if (!detail.value) return false;
  return (
    Math.round(detail.value.speechSpeed * 100) !== speechSpeedPercent.value ||
    Math.round(detail.value.speechVolume * 100) !== speechVolumePercent.value
  );
});

async function loadDetail() {
  if (!timbreId.value) {
    loadError.value = "缺少音色信息";
    isLoading.value = false;
    return;
  }
  isLoading.value = true;
  loadError.value = "";
  try {
    const [result, agents] = await Promise.all([
      getUserVoiceTimbreDetail(timbreId.value),
      getAgents(),
    ]);
    detail.value = result;
    ownedAgents.value = agents.filter(item => item.accessRole === "owner");
    speechSpeedPercent.value = Math.round(result.speechSpeed * 100);
    speechVolumePercent.value = Math.round(result.speechVolume * 100);
  } catch (error) {
    loadError.value = errorMessage(error, "请稍后再试");
  } finally {
    isLoading.value = false;
  }
}

function activeBindingAgentIds() {
  return new Set((detail.value?.bindings ?? []).map(item => item.agentId));
}

function pendingBindingAgentIds() {
  return new Set(
    (detail.value?.pendingBindings ?? []).map(item => item.agentId)
  );
}

function isAgentSelected(agentId: string) {
  return (
    activeBindingAgentIds().has(agentId) ||
    pendingBindingAgentIds().has(agentId)
  );
}

function agentAssociationLabel(agentId: string) {
  if (activeBindingAgentIds().has(agentId)) {
    return "聊天中使用";
  }
  if (pendingBindingAgentIds().has(agentId)) {
    return "待声音版会员生效";
  }
  return "选择这个天之灵";
}

async function handleAgentAssociation(agent: AgentSummary) {
  const current = detail.value;
  if (!current || isAssociatingAgentId.value) return;
  if (isAgentSelected(agent.id)) {
    await Taro.showToast({
      title: agentAssociationLabel(agent.id),
      icon: "none",
    });
    return;
  }

  isAssociatingAgentId.value = agent.id;
  try {
    const agentCenter = await getAgentVoiceModelCenter(agent.id);
    let replaceExisting = false;
    if (
      agentCenter.selectedTimbreId &&
      agentCenter.selectedTimbreId !== current.id
    ) {
      const result = await Taro.showModal({
        title: "更换声音模型？",
        content: `“${agent.name}”已经选择了其他音色，确认后将改用“${current.name}”。`,
        confirmText: "确认更换",
        cancelText: "取消",
        confirmColor: "#28755b",
      });
      if (!result.confirm) return;
      replaceExisting = true;
    }
    const center = await selectAgentVoiceTimbre(agent.id, {
      timbreId: current.id,
      replaceExisting,
    });
    await loadDetail();
    await Taro.showToast({
      title:
        center.selectionStatus === "active"
          ? "已用于聊天对话"
          : "已选择，开通声音版会员后生效",
      icon: "none",
      duration: 2400,
    });
  } catch (error) {
    await Taro.showToast({
      title: errorMessage(error, "选择失败，请重试"),
      icon: "none",
    });
  } finally {
    isAssociatingAgentId.value = "";
  }
}

function openRenameDialog() {
  if (!detail.value) return;
  renameValue.value = detail.value.name;
  isRenameDialogVisible.value = true;
}

function closeRenameDialog() {
  if (!isRenaming.value) {
    isRenameDialogVisible.value = false;
  }
}

function handleRenameInput(event: { detail?: { value?: string } }) {
  renameValue.value = String(event.detail?.value || "");
}

async function submitRename() {
  const current = detail.value;
  const name = renameValue.value.trim();
  if (!current || !name || isRenaming.value) return;

  isRenaming.value = true;
  try {
    const updated = await updateUserVoiceTimbre(current.id, { name });
    detail.value = { ...current, name: updated.name };
    isRenameDialogVisible.value = false;
    await Taro.showToast({ title: "名称已保存", icon: "success" });
  } catch (error) {
    await Taro.showToast({
      title: errorMessage(error, "保存失败，请重试"),
      icon: "none",
    });
  } finally {
    isRenaming.value = false;
  }
}

function handleBack() {
  void Taro.navigateBack();
}

async function saveSettings(showSuccess = true) {
  if (!detail.value || isSaving.value) return false;
  if (!hasSettingChanges.value) return true;
  isSaving.value = true;
  try {
    const updated = await updateUserVoiceTimbre(detail.value.id, {
      speechSpeed: speechSpeedPercent.value / 100,
      speechVolume: speechVolumePercent.value / 100,
    });
    detail.value = {
      ...detail.value,
      speechSpeed: updated.speechSpeed,
      speechVolume: updated.speechVolume,
    };
    if (showSuccess) {
      await Taro.showToast({ title: "效果已保存", icon: "success" });
    }
    return true;
  } catch (error) {
    await Taro.showToast({
      title: errorMessage(error, "保存失败，请重试"),
      icon: "none",
    });
    return false;
  } finally {
    isSaving.value = false;
  }
}

async function generateSpeech() {
  const current = detail.value;
  const text = customText.value.replace(/\s+/g, " ").trim();
  if (!current || !text || isGenerating.value) return;
  if (current.customSpeechRemainingToday <= 0) {
    await Taro.showToast({
      title: `今天已经生成 ${current.customSpeechDailyLimit} 次了`,
      icon: "none",
    });
    return;
  }
  isGenerating.value = true;
  try {
    if (!(await saveSettings(false))) return;
    const generated = await generateUserVoiceTimbreSpeech(current.id, { text });
    detail.value = {
      ...current,
      speechSpeed: speechSpeedPercent.value / 100,
      speechVolume: speechVolumePercent.value / 100,
      generatedAudios: [generated, ...current.generatedAudios],
      customSpeechGeneratedToday:
        current.customSpeechGeneratedToday + 1,
      customSpeechRemainingToday:
        generated.remainingToday ??
        Math.max(current.customSpeechRemainingToday - 1, 0),
    };
    customText.value = "";
    await Taro.showToast({ title: "语音已生成", icon: "success" });
    toggleAudio(`generated-${generated.id}`, generated.audioUrl);
  } catch (error) {
    await Taro.showToast({
      title: errorMessage(error, "生成失败，请重试"),
      icon: "none",
      duration: 2600,
    });
  } finally {
    isGenerating.value = false;
  }
}

function toggleAudio(id: string, url: string) {
  if (!url) return;
  if (playingAudioId.value === id) {
    destroyAudioContext();
    return;
  }

  destroyAudioContext();
  audioLoadingId.value = id;
  const context = Taro.createInnerAudioContext();
  audioContext = context;
  ensureInnerAudioPlaybackOptions(context);
  context.src = url;
  context.onCanplay(() => {
    audioLoadingId.value = "";
  });
  context.onPlay(() => {
    audioLoadingId.value = "";
    playingAudioId.value = id;
  });
  context.onEnded(destroyAudioContext);
  context.onError(() => {
    destroyAudioContext();
    void Taro.showToast({ title: "这段语音暂时无法播放", icon: "none" });
  });
  context.play();
}

function destroyAudioContext() {
  audioContext?.stop();
  audioContext?.destroy();
  audioContext = null;
  playingAudioId.value = "";
  audioLoadingId.value = "";
}

async function downloadAudio(url: string, fileName: string, id: string) {
  if (!url || downloadingId.value) return;
  downloadingId.value = id;
  try {
    const result = await Taro.downloadFile({ url });
    if (result.statusCode < 200 || result.statusCode >= 300) {
      throw new Error(`download failed: ${result.statusCode}`);
    }

    if (isPcEnvironment() && typeof Taro.saveFileToDisk === "function") {
      await Taro.saveFileToDisk({ filePath: result.tempFilePath });
      await Taro.showToast({ title: "音频已下载", icon: "success" });
      return;
    }

    const saved = await Taro.saveFile({ tempFilePath: result.tempFilePath });
    const modal = await Taro.showModal({
      title: "音频已下载",
      content: "已保存到微信小程序文件，可以发送到聊天中长期保存。",
      confirmText: "发送到聊天",
      cancelText: "完成",
    });
    if (modal.confirm && typeof Taro.shareFileMessage === "function") {
      await Taro.shareFileMessage({
        filePath: saved.savedFilePath,
        fileName: sanitizeFileName(fileName),
      });
    }
  } catch (error) {
    const message = String((error as { errMsg?: string })?.errMsg || "");
    if (!message.includes("cancel")) {
      await Taro.showToast({ title: "下载失败，请重试", icon: "none" });
    }
  } finally {
    downloadingId.value = "";
  }
}

function isPcEnvironment() {
  const platform = String(Taro.getSystemInfoSync().platform || "").toLowerCase();
  return ["mac", "windows", "devtools"].includes(platform);
}

function sanitizeFileName(value: string) {
  return value.replace(/[\\/:*?"<>|]/g, "-").slice(0, 80);
}

function formatDuration(value: number) {
  const seconds = Math.max(0, Math.round(value));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

function formatSpeed(value: number) {
  return value === 1 ? "正常" : `${Number(value.toFixed(2))} 倍`;
}

function formatVolume(value: number) {
  return value === 1 ? "正常" : `${Math.round(value * 100)}%`;
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getMonth() + 1}月${date.getDate()}日 ${String(
    date.getHours()
  ).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof ApiException ? error.message : fallback;
}

useLoad(options => {
  timbreId.value = String(options?.id || "").trim();
  void loadDetail();
});

useUnload(destroyAudioContext);
</script>

<style lang="scss">
.timbre-content {
  min-height: 100%;
  padding-bottom: 28px;
}

.timbre-state {
  min-height: 380px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 24px;
  color: #77728f;
  font-size: 14px;
  text-align: center;
}

.timbre-state__title {
  color: #282631;
  font-size: 17px;
  font-weight: 600;
}

.timbre-identity {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 20px 16px 14px;
  background: #ffffff;
}

.timbre-identity__icon {
  width: 48px;
  height: 48px;
  flex: 0 0 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  background: #77728f;
}

.timbre-identity__main {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.timbre-identity__name-row {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 7px;
}

.timbre-identity__name {
  min-width: 0;
  overflow: hidden;
  color: #24222a;
  font-size: 20px;
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.timbre-identity__date {
  color: #85818c;
  font-size: 12px;
}

.timbre-identity__status {
  display: flex;
  align-items: center;
  gap: 3px;
  padding: 5px 7px;
  border-radius: 4px;
  background: #eaf5f0;
  color: #28755b;
  font-size: 11px;
}

.timbre-usage {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 0 16px 18px 76px;
  background: #ffffff;
  color: #77727d;
  font-size: 12px;
  line-height: 1.5;
}

.timbre-section {
  margin-top: 10px;
  padding: 18px 16px 20px;
  background: #ffffff;
}

.timbre-section__heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
}

.timbre-section__heading > view {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.timbre-section__title {
  color: #282631;
  font-size: 17px;
  font-weight: 650;
}

.timbre-section__caption {
  color: #8a8690;
  font-size: 12px;
  line-height: 1.5;
}

.timbre-membership-notice {
  margin-bottom: 10px;
  padding: 10px 12px;
  border-left: 3px solid #28755b;
  background: #f1f7f4;
  color: #4f625b;
  font-size: 12px;
  line-height: 18px;
}

.timbre-agent-list {
  border-top: 1px solid #eceaec;
}

.timbre-agent-option {
  min-height: 62px;
  display: flex;
  align-items: center;
  gap: 10px;
  border-bottom: 1px solid #eceaec;
}

.timbre-agent-option--selected {
  background: #fbfdfc;
}

.timbre-agent-option__avatar {
  width: 38px;
  height: 38px;
  flex: 0 0 38px;
  border-radius: 6px;
  background: #ecebef;
}

.timbre-agent-option__avatar--fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  background: #77728f;
  color: #ffffff;
  font-size: 15px;
  font-weight: 600;
}

.timbre-agent-option__main {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.timbre-agent-option__name {
  overflow: hidden;
  color: #302d35;
  font-size: 14px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.timbre-agent-option__status {
  color: #8a8690;
  font-size: 12px;
}

.audio-list,
.generated-list {
  display: flex;
  flex-direction: column;
  gap: 9px;
}

.audio-item,
.generated-item {
  min-height: 66px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px;
  border: 1px solid #e8e6ea;
  border-radius: 8px;
  background: #fafafa;
}

.audio-item__play,
.audio-item__download {
  width: 36px;
  height: 36px;
  flex: 0 0 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: #ecebef;
}

.audio-item__body,
.generated-item__body {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.audio-item__line {
  display: flex;
  align-items: center;
  gap: 8px;
}

.audio-item__name {
  min-width: 0;
  flex: 1;
  color: #36333c;
  font-size: 14px;
  font-weight: 600;
}

.audio-item__duration,
.audio-item__source,
.generated-item__meta {
  color: #99959e;
  font-size: 11px;
}

.audio-item__transcript,
.generated-item__text {
  overflow: hidden;
  color: #77727d;
  font-size: 12px;
  line-height: 1.45;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.timbre-empty-row {
  padding: 18px 14px;
  border: 1px dashed #dcd9df;
  border-radius: 8px;
  color: #8a8690;
  font-size: 13px;
  line-height: 1.5;
  text-align: center;
}

.combined-audio {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 12px;
  padding: 13px 14px;
  border-radius: 8px;
  background: #f0eff3;
}

.combined-audio > view:first-child {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.combined-audio__name {
  color: #3d3944;
  font-size: 13px;
  font-weight: 600;
}

.combined-audio__caption {
  color: #85818c;
  font-size: 11px;
}

.combined-audio__actions {
  display: flex;
  gap: 8px;
}

.icon-action {
  width: 34px;
  height: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: #77728f;
}

.timbre-name-input {
  box-sizing: border-box;
  width: 100%;
  height: 44px;
  padding: 0 12px;
  border: 1px solid #dedbe2;
  border-radius: 6px;
  background: #ffffff;
  color: #2d2a32;
  font-size: 15px;
}

.timbre-dialog-actions {
  width: 100%;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.timbre-dialog-actions .nut-button {
  width: 100%;
}

.icon-action--secondary {
  border: 1px solid #ddd9e1;
  background: #ffffff;
}

.setting-row {
  margin-bottom: 22px;
  padding: 0 3px;
}

.setting-row__heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 17px;
}

.setting-row__label {
  color: #3b3841;
  font-size: 14px;
  font-weight: 600;
}

.setting-row__value {
  min-width: 58px;
  color: #5e5966;
  font-size: 13px;
  text-align: right;
}

.setting-row__scale {
  display: flex;
  justify-content: space-between;
  margin-top: 9px;
  color: #a09ca5;
  font-size: 10px;
}

.centered-button {
  min-height: 44px;
}

.centered-button :deep(.nut-button__wrap) {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
}

.speech-textarea {
  box-sizing: border-box;
  width: 100%;
  margin-bottom: 14px;
  border: 1px solid #dedbe2;
  border-radius: 8px;
  background: #fafafa;
}

.generated-list {
  margin-top: 20px;
  padding-top: 18px;
  border-top: 1px solid #efedf1;
}

.generated-list__title {
  margin-bottom: 1px;
  color: #46424c;
  font-size: 14px;
  font-weight: 600;
}

.generated-item__play {
  background: #eaf5f0;
}

.generated-item__text {
  color: #4e4a54;
  font-size: 13px;
}
</style>
