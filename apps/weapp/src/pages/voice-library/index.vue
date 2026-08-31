<template>
  <page-scaffold
    class="voice-library-page"
    background="#f5f6f8"
    bottom-background="#ffffff"
    body-padding="0"
    :scroll="true"
    :safe-area-top="false"
    require-auth
    auth-loading-text="正在打开音色仓库..."
  >
    <template #header>
      <app-bar
        title="我的音色"
        background="#ffffff"
        border-color="#eeeeee"
        @back="handleBack"
      />
    </template>

    <view v-if="isLoading" class="voice-library-state">
      <Loading color="#77728f" size="22" />
      <text>正在整理你的音色...</text>
    </view>

    <view v-else-if="loadError" class="voice-library-state">
      <text class="voice-library-state__title">音色仓库暂时没有连接上</text>
      <text>{{ loadError }}</text>
      <nut-button size="small" type="primary" @click="loadLibrary">
        重新加载
      </nut-button>
    </view>

    <view v-else class="voice-library-content">
      <view class="voice-library-summary">
        <view class="voice-library-summary__main">
          <text class="voice-library-summary__title">
            已保存 {{ timbres.length }} 个音色
          </text>
          <text class="voice-library-summary__copy">
            选择音色查看训练片段、调整效果或生成语音
          </text>
        </view>
        <view class="voice-library-summary__rule" @tap="openPolicyDialog">
          <text>保留规则</text>
          <Right color="#77728f" size="14" />
        </view>
      </view>

      <view class="voice-library-list">
        <view
          v-for="item in timbres"
          :key="item.id"
          class="voice-library-item"
          @tap="openTimbreDetail(item)"
        >
          <view class="voice-library-item__top">
            <view class="voice-library-item__icon">
              <Voice color="#ffffff" size="19" />
            </view>
            <view class="voice-library-item__identity">
              <text class="voice-library-item__name">{{ item.name }}</text>
              <text class="voice-library-item__date">
                {{ formatCreatedAt(item.createdAt) }}创建
              </text>
            </view>
            <view class="voice-library-item__controls">
              <view
                class="voice-library-item__control"
                :class="{
                  'voice-library-item__control--disabled':
                    !item.previewAudioUrl,
                }"
                aria-label="试听音色"
                @tap.stop="handlePreview(item)"
              >
                <Loading
                  v-if="previewLoadingId === item.id"
                  color="#5f5b68"
                  size="17"
                />
                <PlayStop
                  v-else-if="playingId === item.id"
                  color="#5f5b68"
                  size="17"
                />
                <PlayStart v-else color="#5f5b68" size="17" />
              </view>
              <view
                class="voice-library-item__control"
                aria-label="管理音色"
                @tap.stop="openManageMenu(item)"
              >
                <MoreX color="#5f5b68" size="18" />
              </view>
            </view>
          </view>

          <view class="voice-library-item__meta">
            <text v-if="item.bindings.length">
              正在用于：{{ bindingNames(item) }}
            </text>
            <text v-else>尚未接入{{ brand.name }}</text>
            <view class="voice-library-item__retention-line">
              <view
                class="voice-library-item__retention-dot"
                :class="
                  `voice-library-item__retention-dot--${item.retentionStatus}`
                "
              />
              <text>{{ item.retentionMessage }}</text>
            </view>
          </view>
        </view>
      </view>
    </view>

    <template #bottom>
      <view
        v-if="!isLoading && !loadError && timbres.length"
        class="voice-library-bottom"
      >
        <nut-button block type="primary" @click="openVoiceTraining">
          <Plus size="17" />
          训练新音色
        </nut-button>
      </view>
    </template>

    <template #overlay>
      <nut-dialog
        v-model:visible="isPolicyDialogVisible"
        title="音色保留规则"
        text-align="left"
        :lock-scroll="true"
        :z-index="130"
      >
        <view class="voice-library-dialog-copy">
          <text>{{ retentionPolicy?.summary }}</text>
          <text>
            服务商为阿里云百炼（千问）。平台账号最多保留 1000 个千问音色，达到上限时不会自动覆盖已有音色。
          </text>
          <text>{{ retentionPolicy?.deletionNotice }}</text>
        </view>
      </nut-dialog>

      <nut-dialog
        v-model:visible="isRenameDialogVisible"
        title="修改音色名称"
        text-align="left"
        :close-on-click-overlay="false"
        :lock-scroll="true"
        :z-index="131"
      >
        <input
          class="voice-library-name-input"
          :value="renameValue"
          maxlength="20"
          placeholder="例如：妈妈的声音"
          @input="handleRenameInput"
        />
        <template #footer>
          <view class="voice-library-dialog-actions">
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

      <nut-dialog
        v-model:visible="isDeleteDialogVisible"
        title="永久删除这个音色吗？"
        text-align="left"
        :close-on-click-overlay="false"
        :lock-scroll="true"
        :z-index="132"
      >
        <view class="voice-library-dialog-copy">
          <text>
            将删除“{{ activeTimbre?.name }}”的声音模型、训练音频、试听音频和生成语音，并解除已绑定的{{ brand.name }}。
          </text>
          <text>原始素材和切片仍会保留。删除后无法恢复。</text>
        </view>
        <template #footer>
          <view class="voice-library-dialog-actions">
            <nut-button plain :disabled="isDeleting" @click="closeDeleteDialog">
              取消
            </nut-button>
            <nut-button
              type="danger"
              :loading="isDeleting"
              @click="submitDelete"
            >
              永久删除
            </nut-button>
          </view>
        </template>
      </nut-dialog>
    </template>
  </page-scaffold>
</template>

<script lang="ts">
export default {
  name: "VoiceLibraryPage",
};
</script>

<script setup lang="ts">
import {
  Loading,
  MoreX,
  PlayStart,
  PlayStop,
  Plus,
  Right,
  Voice,
} from "@nutui/icons-vue-taro";
import Taro, { useDidShow, useUnload } from "@tarojs/taro";
import { ref } from "vue";
import { ApiException } from "../../api/api-exception";
import { brand } from "../../config/brand";
import {
  deleteUserVoiceTimbre,
  getUserVoiceTimbreLibrary,
  updateUserVoiceTimbreName,
  type UserVoiceTimbreRecordDTO,
  type VoiceTimbreRetentionPolicyDTO,
} from "../../apis/voice-service";
import AppBar from "../../components/app-bar/app-bar.vue";
import PageScaffold from "../../components/page-scaffold/page-scaffold.vue";
import { ensureInnerAudioPlaybackOptions } from "../../utils/audio";

const timbres = ref<UserVoiceTimbreRecordDTO[]>([]);
const retentionPolicy = ref<VoiceTimbreRetentionPolicyDTO | null>(null);
const isLoading = ref(true);
const loadError = ref("");
const playingId = ref("");
const previewLoadingId = ref("");
const isPolicyDialogVisible = ref(false);
const isRenameDialogVisible = ref(false);
const isDeleteDialogVisible = ref(false);
const isRenaming = ref(false);
const isDeleting = ref(false);
const renameValue = ref("");
const activeTimbre = ref<UserVoiceTimbreRecordDTO | null>(null);
const isRedirectingToTraining = ref(false);

let audioContext: Taro.InnerAudioContext | null = null;

async function loadLibrary() {
  isLoading.value = true;
  loadError.value = "";
  try {
    const result = await getUserVoiceTimbreLibrary();
    timbres.value = result.items;
    retentionPolicy.value = result.retentionPolicy;
    if (!result.items.length && !isRedirectingToTraining.value) {
      isRedirectingToTraining.value = true;
      try {
        await Taro.redirectTo({ url: "/pages/voice-package/index" });
        return;
      } catch {
        isRedirectingToTraining.value = false;
        loadError.value = "正在带你进入声音训练，请重新试一次";
      }
    }
  } catch (error) {
    loadError.value =
      error instanceof ApiException
        ? error.message
        : "请稍后再试，小使者会继续为你保留音色";
  } finally {
    isLoading.value = false;
  }
}

function handleBack() {
  void Taro.navigateBack();
}

function openVoiceTraining() {
  void Taro.navigateTo({ url: "/pages/voice-package/index" });
}

function openTimbreDetail(item: UserVoiceTimbreRecordDTO) {
  destroyAudioContext();
  void Taro.navigateTo({
    url: `/pages/voice-timbre-detail/index?id=${encodeURIComponent(item.id)}`,
  });
}

function openPolicyDialog() {
  isPolicyDialogVisible.value = true;
}

async function openManageMenu(item: UserVoiceTimbreRecordDTO) {
  try {
    const result = await Taro.showActionSheet({
      itemList: ["修改名称", "永久删除"],
    });
    if (result.tapIndex === 0) {
      openRenameDialog(item);
    } else if (result.tapIndex === 1) {
      openDeleteDialog(item);
    }
  } catch {}
}

function openRenameDialog(item: UserVoiceTimbreRecordDTO) {
  activeTimbre.value = item;
  renameValue.value = item.name;
  isRenameDialogVisible.value = true;
}

function closeRenameDialog() {
  if (isRenaming.value) return;
  isRenameDialogVisible.value = false;
}

function handleRenameInput(event: { detail?: { value?: string } }) {
  renameValue.value = String(event.detail?.value || "");
}

async function submitRename() {
  const item = activeTimbre.value;
  const name = renameValue.value.trim();
  if (!item || !name || isRenaming.value) return;
  isRenaming.value = true;
  try {
    const updated = await updateUserVoiceTimbreName(item.id, name);
    timbres.value = timbres.value.map(current =>
      current.id === updated.id ? updated : current
    );
    isRenameDialogVisible.value = false;
    await Taro.showToast({ title: "名称已保存", icon: "success" });
  } catch (error) {
    await Taro.showToast({
      title: error instanceof ApiException ? error.message : "保存失败，请重试",
      icon: "none",
    });
  } finally {
    isRenaming.value = false;
  }
}

function openDeleteDialog(item: UserVoiceTimbreRecordDTO) {
  activeTimbre.value = item;
  isDeleteDialogVisible.value = true;
}

function closeDeleteDialog() {
  if (isDeleting.value) return;
  isDeleteDialogVisible.value = false;
}

async function submitDelete() {
  const item = activeTimbre.value;
  if (!item || isDeleting.value) return;
  isDeleting.value = true;
  try {
    const result = await deleteUserVoiceTimbre(item.id);
    isDeleteDialogVisible.value = false;
    await Taro.showToast({
      title: result.message,
      icon: result.deletionStatus === "completed" ? "success" : "none",
      duration: 2600,
    });
    await loadLibrary();
  } catch (error) {
    await Taro.showToast({
      title: error instanceof ApiException ? error.message : "删除失败，请重试",
      icon: "none",
    });
  } finally {
    isDeleting.value = false;
  }
}

function handlePreview(item: UserVoiceTimbreRecordDTO) {
  if (!item.previewAudioUrl) return;
  if (playingId.value === item.id) {
    destroyAudioContext();
    return;
  }

  destroyAudioContext();
  previewLoadingId.value = item.id;
  const context = Taro.createInnerAudioContext();
  audioContext = context;
  ensureInnerAudioPlaybackOptions(context);
  context.src = item.previewAudioUrl;
  context.onCanplay(() => {
    previewLoadingId.value = "";
    playingId.value = item.id;
  });
  context.onPlay(() => {
    previewLoadingId.value = "";
    playingId.value = item.id;
  });
  context.onEnded(destroyAudioContext);
  context.onError(() => {
    destroyAudioContext();
    void Taro.showToast({ title: "试听暂时无法播放", icon: "none" });
  });
  context.play();
}

function destroyAudioContext() {
  audioContext?.stop();
  audioContext?.destroy();
  audioContext = null;
  playingId.value = "";
  previewLoadingId.value = "";
}

function bindingNames(item: UserVoiceTimbreRecordDTO) {
  return item.bindings.map(binding => binding.agentName).join("、");
}

function formatCreatedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

useDidShow(() => {
  void loadLibrary();
});

useUnload(destroyAudioContext);
</script>

<style lang="scss">
.voice-library-content {
  box-sizing: border-box;
  min-height: 100%;
  padding: 18px 16px 28px;
}

.voice-library-state {
  min-height: 360px;
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

.voice-library-state__title {
  color: #282631;
  font-size: 17px;
  font-weight: 600;
}

.voice-library-summary {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 18px;
}

.voice-library-summary__main {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.voice-library-summary__title {
  color: #25232b;
  font-size: 18px;
  font-weight: 650;
}

.voice-library-summary__copy {
  color: #85818c;
  font-size: 12px;
  line-height: 1.5;
}

.voice-library-summary__rule {
  min-height: 36px;
  display: flex;
  align-items: center;
  gap: 3px;
  color: #5f5b68;
  font-size: 12px;
}

.voice-library-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.voice-library-item {
  overflow: hidden;
  border: 1px solid #e9e8ec;
  border-radius: 8px;
  background: #ffffff;
}

.voice-library-item__top {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 15px 14px 10px;
}

.voice-library-item__icon {
  width: 38px;
  height: 38px;
  flex: 0 0 38px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  background: #77728f;
}

.voice-library-item__identity {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.voice-library-item__name {
  overflow: hidden;
  color: #26242d;
  font-size: 16px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.voice-library-item__date {
  color: #94909b;
  font-size: 12px;
}

.voice-library-item__controls {
  display: flex;
  align-items: center;
  gap: 6px;
}

.voice-library-item__control {
  width: 34px;
  height: 34px;
  flex: 0 0 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: #f0eff2;
}

.voice-library-item__control--disabled {
  opacity: 0.4;
}

.voice-library-item__meta {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 0 14px 14px 63px;
  color: #77727d;
  font-size: 12px;
  line-height: 1.5;
}

.voice-library-item__retention-line {
  display: flex;
  align-items: center;
  gap: 6px;
}

.voice-library-item__retention-dot {
  width: 6px;
  height: 6px;
  flex: 0 0 6px;
  border-radius: 50%;
  background: #28755b;
}

.voice-library-item__retention-dot--due_soon {
  background: #a7771c;
}

.voice-library-item__retention-dot--attention_required {
  background: #b54747;
}

.voice-library-bottom {
  padding: 10px 16px;
}

.voice-library-bottom :deep(.nut-button__wrap) {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
}

.voice-library-dialog-copy {
  display: flex;
  flex-direction: column;
  gap: 10px;
  color: #5d5965;
  font-size: 14px;
  line-height: 1.65;
}

.voice-library-name-input {
  box-sizing: border-box;
  width: 100%;
  min-height: 44px;
  padding: 0 12px;
  border: 1px solid #dedbe2;
  border-radius: 6px;
  background: #fafafa;
  color: #2c2932;
  font-size: 15px;
}

.voice-library-dialog-actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  width: 100%;
}

.voice-library-dialog-actions .nut-button {
  width: 100%;
}
</style>
