<template>
  <page-scaffold
    class="chat-import-page"
    background="#f5f5f7"
    header-background="#ffffff"
    bottom-background="#ffffff"
    body-padding="0"
    :scroll="true"
    :show-scrollbar="false"
    :safe-area-top="false"
    :safe-area-bottom="true"
  >
    <template #header>
      <app-bar :title="pageTitle" background="#ffffff" border-color="#eeeeF2" />
    </template>

    <view v-if="isLoading" class="chat-import-state">
      <view class="chat-import-spinner" />
      <text class="chat-import-state__title">正在恢复导入记录...</text>
    </view>

    <view v-else-if="!batch" class="chat-import-state chat-import-state--error">
      <image
        class="chat-import-state__image"
        :src="messengerImageUrl"
        mode="aspectFit"
      />
      <text class="chat-import-state__error-title">导入服务暂时没有连接上</text>
      <text class="chat-import-state__error-desc">
        {{ loadError || "请重新连接后再添加聊天截图" }}
      </text>
      <view class="chat-import-state__retry" @tap="handleRetry">重新连接</view>
    </view>

    <view v-else-if="isProcessing" class="chat-import-processing">
      <view class="chat-import-processing__visual">
        <view class="chat-import-processing__ring" />
        <image
          class="chat-import-processing__image"
          :src="messengerImageUrl"
          mode="aspectFit"
        />
      </view>
      <text class="chat-import-processing__title">{{ processingText }}</text>
      <text class="chat-import-processing__desc">
        可以先离开，识别结果会保留在这里
      </text>
      <view class="chat-import-processing__progress">
        <view
          class="chat-import-processing__progress-value"
          :style="{ width: `${processingProgress}%` }"
        />
      </view>
      <text class="chat-import-processing__count">
        正在整理 {{ batch?.screenshotCount || 0 }} 张截图
      </text>
    </view>

    <view v-else-if="isReviewStep" class="chat-import-review">
      <view class="chat-import-review__summary">
        <view>
          <text class="chat-import-review__count">
            识别到 {{ reviewItems.length }} 条
          </text>
          <text class="chat-import-review__range">{{
            recognizedRangeText
          }}</text>
        </view>
        <text v-if="batch?.duplicateCount" class="chat-import-review__dedupe">
          已去重 {{ batch.duplicateCount }} 条
        </text>
      </view>

      <view v-if="batch?.failedCount" class="chat-import-review__warning">
        有
        {{ batch.failedCount }} 张截图没有识别成功，本次只会导入当前显示的记录。
      </view>

      <view class="chat-import-identity chat-import-identity--review">
        <view class="chat-import-identity__person">
          <text class="chat-import-identity__caption">左侧</text>
          <text class="chat-import-identity__name">
            {{ speakerLabel(batch?.leftSpeaker) }}
          </text>
        </view>
        <view class="chat-import-identity__swap" @tap="handleSwapIdentity"
          >⇄</view
        >
        <view class="chat-import-identity__person">
          <text class="chat-import-identity__caption">右侧</text>
          <text class="chat-import-identity__name">
            {{ speakerLabel(batch?.rightSpeaker) }}
          </text>
        </view>
      </view>

      <text class="chat-import-review__hint">
        点一条消息可以修改文字、时间或说话人
      </text>

      <view class="chat-import-message-list">
        <template v-for="item in reviewItems" :key="item.id">
          <view
            v-if="shouldShowItemTime(item)"
            class="chat-import-message-list__time"
          >
            {{ formatItemTime(item) }}
          </view>
          <view
            class="chat-import-message-row"
            :class="{
              'chat-import-message-row--user': item.speaker === 'user',
              'chat-import-message-row--agent': item.speaker === 'agent',
            }"
            @tap="handleEditItem(item)"
          >
            <view
              v-if="item.speaker === 'agent'"
              class="chat-import-message-avatar"
            >
              <image
                v-if="agentAvatar"
                class="chat-import-message-avatar__image"
                :src="agentAvatar"
                mode="aspectFill"
              />
              <text v-else>{{ agentDisplayName.slice(0, 1) }}</text>
            </view>
            <view
              class="chat-import-message-bubble"
              :class="{
                'chat-import-message-bubble--uncertain': isItemUncertain(item),
              }"
            >
              <text class="chat-import-message-bubble__text">{{
                item.content
              }}</text>
              <text
                v-if="isItemUncertain(item)"
                class="chat-import-message-bubble__warning"
              >
                请确认
              </text>
            </view>
            <view
              v-if="item.speaker === 'user'"
              class="chat-import-message-avatar chat-import-message-avatar--user"
            >
              我
            </view>
          </view>
        </template>
      </view>
    </view>

    <view v-else-if="isMemoryReviewStep" class="chat-import-memory-review">
      <view class="chat-import-memory-review__intro">
        <image
          class="chat-import-memory-review__image"
          :src="messengerImageUrl"
          mode="aspectFit"
        />
        <view class="chat-import-memory-review__intro-copy">
          <text class="chat-import-memory-review__eyebrow">
            {{ styleLearningEyebrow }}
          </text>
          <text class="chat-import-memory-review__intro-title">
            {{ styleLearningTitle }}
          </text>
          <text class="chat-import-memory-review__intro-desc">
            {{ styleLearningDescription }}
          </text>
        </view>
      </view>

      <view class="chat-import-memory-review__section">
        <view class="chat-import-memory-review__heading-row">
          <view>
            <text class="chat-import-memory-review__title">
              从聊天中整理出的记忆
            </text>
            <text class="chat-import-memory-review__desc">
              确认后才会写入他的记忆，也可以先修改或移除。
            </text>
          </view>
          <text class="chat-import-memory-review__count">
            {{ activeMemoryCandidates.length }} 条
          </text>
        </view>

        <view
          v-if="activeMemoryCandidates.length"
          class="chat-import-memory-list"
        >
          <view
            v-for="(memory, index) in activeMemoryCandidates"
            :key="memory.id"
            class="chat-import-memory-row"
          >
            <text class="chat-import-memory-row__index">{{ index + 1 }}</text>
            <view class="chat-import-memory-row__content">
              <text class="chat-import-memory-row__value">{{
                memory.value
              }}</text>
              <text class="chat-import-memory-row__source">
                来自 {{ memory.sourceItemIds.length || 1 }} 条聊天
              </text>
            </view>
            <view class="chat-import-memory-row__actions">
              <text @tap="handleEditMemory(memory)">修改</text>
              <text
                class="chat-import-memory-row__remove"
                @tap="handleRemoveMemory(memory)"
              >
                移除
              </text>
            </view>
          </view>
        </view>
        <view v-else class="chat-import-memory-review__empty">
          {{
            styleLearningSucceeded
              ? "没有需要确认的事实记忆，语言习惯已经保存。"
              : "没有需要确认的事实记忆，聊天记录已经保存。"
          }}
        </view>

        <text
          v-if="removedMemoryCount"
          class="chat-import-memory-review__removed"
        >
          已移除 {{ removedMemoryCount }} 条，不会写入记忆
        </text>
      </view>
    </view>

    <view v-else-if="isCompleted" class="chat-import-complete">
      <view class="chat-import-complete__check">
        <Check color="#ffffff" size="28" />
      </view>
      <text class="chat-import-complete__title">过去的聊天已经放好了</text>
      <text class="chat-import-complete__desc">
        {{ completionText }}
      </text>
      <view class="chat-import-complete__memory">
        <image
          class="chat-import-complete__memory-image"
          :src="messengerImageUrl"
          mode="aspectFit"
        />
        <view>
          <text class="chat-import-complete__memory-title">
            {{ styleLearningTitle }}
          </text>
          <text class="chat-import-complete__memory-desc">
            {{ styleLearningDescription }}
          </text>
        </view>
      </view>
    </view>

    <view v-else class="chat-import-setup">
      <view class="chat-import-intro">
        <text class="chat-import-intro__title">添加你和他的聊天截图</text>
        <text class="chat-import-intro__desc">
          我会辨认双方说过的话，并按截图里的时间整理。确认前不会写入聊天或记忆。
        </text>
        <text class="chat-import-intro__quota">✓ 导入记录不消耗聊天次数</text>
      </view>

      <view class="chat-import-assets">
        <view v-if="batch?.assets.length" class="chat-import-assets__grid">
          <view
            v-for="asset in batch.assets"
            :key="asset.id"
            class="chat-import-asset"
          >
            <image
              class="chat-import-asset__image"
              :src="asset.publicUrl"
              mode="aspectFill"
            />
            <view class="chat-import-asset__index">
              {{ asset.screenshotSequence + 1 }}
            </view>
            <view
              v-if="asset.status === 'failed'"
              class="chat-import-asset__failed"
            >
              识别失败
            </view>
            <view v-else class="chat-import-asset__ready">
              <Check color="#ffffff" size="11" />
            </view>
          </view>
        </view>

        <view
          class="chat-import-add"
          :class="{ 'chat-import-add--compact': batch?.assets.length }"
          @tap="handleChooseScreenshots"
        >
          <view class="chat-import-add__icon">
            <Photograph color="#297b69" size="26" />
          </view>
          <text class="chat-import-add__title">
            {{ batch?.assets.length ? "继续添加截图" : "从相册添加聊天截图" }}
          </text>
          <text v-if="!batch?.assets.length" class="chat-import-add__desc">
            可多次添加，最多 30 张
          </text>
        </view>

        <view v-if="isUploading" class="chat-import-uploading">
          <Loading color="#297b69" size="16" />
          <text
            >正在上传第 {{ uploadProgress.current }} /
            {{ uploadProgress.total }} 张</text
          >
        </view>
      </view>

      <view class="chat-import-identity">
        <text class="chat-import-identity__title">确认截图中的双方</text>
        <text class="chat-import-identity__desc">
          默认按常见的微信聊天位置设置，请确认后再开始识别
        </text>
        <view class="chat-import-identity__row">
          <view class="chat-import-identity__person">
            <text class="chat-import-identity__caption">左侧气泡</text>
            <text class="chat-import-identity__name">
              {{ speakerLabel(batch?.leftSpeaker) }}
            </text>
          </view>
          <view class="chat-import-identity__swap" @tap="handleSwapIdentity"
            >⇄</view
          >
          <view class="chat-import-identity__person">
            <text class="chat-import-identity__caption">右侧气泡</text>
            <text class="chat-import-identity__name">
              {{ speakerLabel(batch?.rightSpeaker) }}
            </text>
          </view>
        </view>
      </view>

      <view class="chat-import-tips">
        <text class="chat-import-tips__title">截图小提示</text>
        <text>尽量保留时间和左右两侧气泡，连续截图可以有少量重叠。</text>
      </view>

      <view v-if="batch?.errorDetail" class="chat-import-error">
        {{ friendlyErrorText }}
      </view>
    </view>

    <template #bottom>
      <view
        v-if="!isLoading && !isProcessing && batch"
        class="chat-import-bottom"
      >
        <view
          v-if="isReviewStep"
          class="chat-import-primary"
          :class="{
            'chat-import-primary--disabled': isSubmitting || !canConfirmImport,
          }"
          @tap="handleConfirmImport"
        >
          <Loading v-if="isSubmitting" color="#ffffff" size="18" />
          <text v-else-if="unresolvedSpeakerCount">
            还有 {{ unresolvedSpeakerCount }} 条需要确认说话人
          </text>
          <text v-else>确认导入 {{ importableItems.length }} 条记录</text>
        </view>
        <view
          v-else-if="isMemoryReviewStep"
          class="chat-import-primary"
          :class="{ 'chat-import-primary--disabled': isSubmitting }"
          @tap="handleConfirmMemories"
        >
          <Loading v-if="isSubmitting" color="#ffffff" size="18" />
          <text v-else>
            {{
              activeMemoryCandidates.length
                ? `确认 ${activeMemoryCandidates.length} 条记忆`
                : "完成整理"
            }}
          </text>
        </view>
        <view
          v-else-if="isCompleted"
          class="chat-import-primary"
          @tap="handleReturnToChat"
        >
          回到聊天
        </view>
        <view
          v-else
          class="chat-import-primary"
          :class="{
            'chat-import-primary--disabled':
              !batch?.assets.length || isUploading || isSubmitting,
          }"
          @tap="handleStartRecognition"
        >
          <Loading v-if="isSubmitting" color="#ffffff" size="18" />
          <text v-else>
            {{
              batch?.status === "failed"
                ? "重新识别"
                : `开始识别 ${batch?.assets.length || 0} 张截图`
            }}
          </text>
        </view>
      </view>
    </template>

    <template #overlay>
      <nut-dialog
        v-model:visible="isEditorVisible"
        title="校对这条记录"
        custom-class="chat-import-editor-dialog"
        text-align="left"
        :close-on-click-overlay="false"
        :lock-scroll="true"
        :z-index="130"
      >
        <scroll-view
          class="chat-import-editor__scroll"
          scroll-y
          :show-scrollbar="false"
        >
          <view class="chat-import-editor chat-import-editor__scroll-content">
            <text class="chat-import-editor__label">聊天时间</text>
            <view class="chat-import-editor__time-row">
              <picker
                mode="date"
                :value="editorDate"
                @change="handleEditorDateChange"
              >
                <view class="chat-import-editor__time-control">
                  {{ editorDate || "选择日期" }}
                </view>
              </picker>
              <picker
                mode="time"
                :value="editorTime"
                @change="handleEditorTimeChange"
              >
                <view class="chat-import-editor__time-control">
                  {{ editorTime || "选择时间" }}
                </view>
              </picker>
            </view>

            <text class="chat-import-editor__label">这句话是谁说的</text>
            <view class="chat-import-editor__speaker-row">
              <view
                class="chat-import-editor__speaker"
                :class="{
                  'chat-import-editor__speaker--active':
                    editorSpeaker === 'agent',
                }"
                @tap="editorSpeaker = 'agent'"
              >
                {{ agentDisplayName }}
              </view>
              <view
                class="chat-import-editor__speaker"
                :class="{
                  'chat-import-editor__speaker--active':
                    editorSpeaker === 'user',
                }"
                @tap="editorSpeaker = 'user'"
              >
                我
              </view>
            </view>

            <text class="chat-import-editor__label">聊天内容</text>
            <textarea
              class="chat-import-editor__textarea"
              :value="editorContent"
              maxlength="2000"
              :show-confirm-bar="false"
              :adjust-position="true"
              :cursor-spacing="96"
              @input="handleEditorContentInput"
            />
          </view>
        </scroll-view>

        <template #footer>
          <view class="chat-import-editor__footer">
            <view class="chat-import-editor__delete" @tap="handleDeleteItem">
              <Del color="#976464" size="17" />
              <text>删除</text>
            </view>
            <view class="chat-import-editor__actions">
              <view class="chat-import-editor__cancel" @tap="closeEditor"
                >取消</view
              >
              <view class="chat-import-editor__save" @tap="handleSaveItem"
                >保存</view
              >
            </view>
          </view>
        </template>
      </nut-dialog>

      <nut-dialog
        v-model:visible="isMemoryEditorVisible"
        title="修改这条记忆"
        custom-class="chat-import-editor-dialog"
        text-align="left"
        :close-on-click-overlay="false"
        :lock-scroll="true"
        :z-index="131"
      >
        <view class="chat-import-editor">
          <text class="chat-import-editor__label">记忆内容</text>
          <textarea
            class="chat-import-editor__textarea"
            :value="memoryEditorValue"
            maxlength="500"
            :show-confirm-bar="false"
            @input="handleMemoryEditorInput"
          />
        </view>

        <template #footer>
          <view class="chat-import-memory-editor__footer">
            <view class="chat-import-editor__cancel" @tap="closeMemoryEditor">
              取消
            </view>
            <view class="chat-import-editor__save" @tap="handleSaveMemory">
              保存
            </view>
          </view>
        </template>
      </nut-dialog>
    </template>
  </page-scaffold>
</template>

<script lang="ts">
export default {
  name: "ChatImportPage",
};
</script>

<script setup lang="ts">
import { Check, Del, Loading, Photograph } from "@nutui/icons-vue-taro";
import Taro, { useLoad, useUnload } from "@tarojs/taro";
import { computed, ref } from "vue";
import { isLocalApiEnvironment } from "../../api/api-config";
import { ApiException } from "../../api/api-exception";
import { getEntryConversation } from "../../apis/conversation";
import {
  addChatImportAsset,
  confirmChatImport,
  confirmChatImportMemories,
  createChatImport,
  getActiveChatImport,
  getChatImport,
  recognizeChatImport,
  updateChatImportIdentity,
  updateChatImportItem,
  updateChatImportMemory,
  type ChatImportBatch,
  type ChatImportItem,
  type ChatImportMemoryCandidate,
  type ChatImportResult,
  type ChatImportSpeaker,
} from "../../apis/chat-import";
import { uploadLocalFile } from "../../apis/storage";
import messengerImageUrl from "../../assets/images/agent-create/header-mark.png";
import AppBar from "../../components/app-bar/app-bar.vue";
import PageScaffold from "../../components/page-scaffold/page-scaffold.vue";
import { reportChatImportEvent } from "../../utils/product-analytics";
import {
  buildConversationChatUrl,
  rememberSelectedConversation,
} from "../../utils/selected-agent-chat";

const conversationId = ref("");
const agentId = ref("");
const agentName = ref("");
const agentAvatar = ref("");
const iCallAgent = ref("");
const batch = ref<ChatImportBatch | null>(null);
const items = ref<ChatImportItem[]>([]);
const isLoading = ref(true);
const loadError = ref("");
const recoveredChatUrl = ref("");
const isUploading = ref(false);
const isSubmitting = ref(false);
const processingMessageIndex = ref(0);
const processingProgress = ref(22);
const uploadProgress = ref({ current: 0, total: 0 });
const isEditorVisible = ref(false);
const editingItemId = ref("");
const editorContent = ref("");
const editorSpeaker = ref<ChatImportSpeaker>("agent");
const editorDate = ref("");
const editorTime = ref("");
const isMemoryEditorVisible = ref(false);
const editingMemoryId = ref("");
const memoryEditorValue = ref("");
let pollingTimer: ReturnType<typeof setTimeout> | null = null;
let processingTextTimer: ReturnType<typeof setInterval> | null = null;

const processingMessages = [
  "正在辨认谁说了什么",
  "正在整理聊天时间",
  "正在去除重复内容",
  "正在了解他的说话方式",
];

const agentDisplayName = computed(
  () => iCallAgent.value.trim() || agentName.value.trim() || "他"
);
const isProcessing = computed(() =>
  ["queued", "recognizing", "importing", "extracting_memory"].includes(
    batch.value?.status || ""
  )
);
const isReviewStep = computed(() => batch.value?.status === "needs_review");
const isMemoryReviewStep = computed(
  () => batch.value?.status === "needs_memory_review"
);
const isCompleted = computed(() => batch.value?.status === "completed");
const pageTitle = computed(() => {
  if (isReviewStep.value) return "校对聊天记录";
  if (isMemoryReviewStep.value) return "确认整理出的记忆";
  if (isCompleted.value) return "导入完成";
  return "导入微信聊天记录";
});
const processingText = computed(() =>
  batch.value?.status === "extracting_memory"
    ? processingMessages[
        (processingMessageIndex.value + 2) % processingMessages.length
      ]
    : processingMessages[
        processingMessageIndex.value % processingMessages.length
      ]
);
const reviewItems = computed(() =>
  items.value.filter((item) => !item.isDeleted && !item.isDuplicate)
);
const importableItems = computed(() =>
  reviewItems.value.filter(
    (item) =>
      Boolean(item.content.trim()) &&
      (item.speaker === "user" || item.speaker === "agent")
  )
);
const unresolvedSpeakerCount = computed(
  () => reviewItems.value.filter((item) => item.speaker === "unknown").length
);
const canConfirmImport = computed(
  () => importableItems.value.length > 0 && unresolvedSpeakerCount.value === 0
);
const activeMemoryCandidates = computed(() =>
  (batch.value?.memoryCandidates || []).filter(
    (memory) => memory.status !== "rejected"
  )
);
const removedMemoryCount = computed(
  () =>
    (batch.value?.memoryCandidates || []).filter(
      (memory) => memory.status === "rejected"
    ).length
);
const styleLearningSucceeded = computed(
  () => batch.value?.styleStatus === "completed"
);
const styleLearningEyebrow = computed(() =>
  styleLearningSucceeded.value ? "说话方式已学习" : "聊天记录已保留"
);
const styleLearningTitle = computed(() =>
  styleLearningSucceeded.value
    ? "我记下了他的表达习惯"
    : "说话方式还需要继续整理"
);
const styleLearningDescription = computed(() =>
  styleLearningSucceeded.value
    ? "包括常用语气词、句子长短，以及一次习惯连续回复几个气泡。"
    : "聊天记录不会丢失，语气词、句子长度和回复节奏可以稍后继续分析。"
);
const recognizedRangeText = computed(() => {
  const first = batch.value?.earliestOccurredAt;
  const last = batch.value?.latestOccurredAt;
  if (!first && !last) {
    return "部分记录的时间还需要确认";
  }
  if (first && last) {
    return `${formatDate(first)} 至 ${formatDate(last)}`;
  }
  return formatDate(first || last);
});
const completionText = computed(() => {
  const count = batch.value?.confirmedCount || reviewItems.value.length;
  return `已导入 ${count} 条过去的聊天，不会消耗聊天次数，也不会触发即时回复。`;
});
const friendlyErrorText = computed(() => {
  if (batch.value?.errorCode === "CHAT_IMPORT_GROUP_UNSUPPORTED") {
    return "暂时只支持两个人的微信聊天截图，请换一组截图再试。";
  }
  return batch.value?.errorDetail || "识别没有完成，请检查截图后重新试一次。";
});

useLoad((options) => {
  conversationId.value = decodeParam(options?.conversationId);
  agentId.value = decodeParam(options?.agentId);
  agentName.value = decodeParam(options?.agentName);
  agentAvatar.value = decodeParam(options?.agentAvatar);
  iCallAgent.value = decodeParam(options?.iCallAgent);
  void preparePage();
});

useUnload(() => {
  stopPolling();
  stopProcessingTextRotation();
});

async function preparePage() {
  if (!conversationId.value) {
    Taro.showToast({ title: "缺少会话信息", icon: "none" });
    isLoading.value = false;
    return;
  }

  isLoading.value = true;
  loadError.value = "";
  try {
    await loadChatImportBatchWithRecovery();
    resumePollingIfNeeded();
  } catch (error) {
    loadError.value = getErrorMessage(error, "请检查网络后重新连接");
    showError(error, "暂时无法打开导入页面");
  } finally {
    isLoading.value = false;
  }
}

async function loadChatImportBatchWithRecovery() {
  try {
    await loadChatImportBatch();
  } catch (error) {
    if (!(await recoverLocalChatImportConversation(error))) {
      throw error;
    }
    await loadChatImportBatch();
  }
}

async function loadChatImportBatch() {
  const active = await getActiveChatImport(conversationId.value);
  if (active.batch) {
    applyResult(active);
    reportChatImportEvent("reopened", {
      screenshotCount: active.batch.screenshotCount,
      messageCount: active.batch.recognizedCount,
      batchStatus: active.batch.status,
    });
    return;
  }

  applyResult(
    await createChatImport(conversationId.value, {
      clientRequestId: `chat-import-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`,
      timezoneOffsetMinutes: new Date().getTimezoneOffset(),
    })
  );
}

async function recoverLocalChatImportConversation(error: unknown) {
  if (
    !isLocalApiEnvironment() ||
    !(error instanceof ApiException) ||
    error.code !== "CONVERSATION_NOT_FOUND"
  ) {
    return false;
  }

  const replacement = await getEntryConversation({ timeout: 5000 });
  if (!replacement || replacement.id === conversationId.value) {
    return false;
  }

  conversationId.value = replacement.id;
  agentId.value = replacement.agentId;
  agentName.value = replacement.agentName;
  agentAvatar.value = replacement.agentAvatar;
  iCallAgent.value = replacement.iCallAgent;
  recoveredChatUrl.value = buildConversationChatUrl(replacement);
  rememberSelectedConversation(replacement);
  return true;
}

function handleRetry() {
  void preparePage();
}

function applyResult(result: ChatImportResult) {
  batch.value = result.batch;
  items.value = result.items;
}

async function handleChooseScreenshots() {
  if (isUploading.value) {
    return;
  }
  if (!batch.value) {
    await preparePage();
    if (!batch.value) return;
  }
  const remaining = Math.max(0, 30 - batch.value.assets.length);
  if (!remaining) {
    Taro.showToast({ title: "最多添加 30 张截图", icon: "none" });
    return;
  }

  try {
    const result = await Taro.chooseImage({
      count: Math.min(9, remaining),
      sizeType: ["compressed"],
      sourceType: ["album"],
    });
    const files = result.tempFilePaths.slice(0, remaining);
    reportChatImportEvent("images_selected", {
      screenshotCount: files.length,
    });
    const oversize = (result.tempFiles || []).some(
      (file) => Number(file.size || 0) > 10 * 1024 * 1024
    );
    if (oversize) {
      Taro.showToast({ title: "单张截图不能超过 10MB", icon: "none" });
      return;
    }

    isUploading.value = true;
    uploadProgress.value = { current: 0, total: files.length };
    for (const [index, filePath] of files.entries()) {
      uploadProgress.value.current = index + 1;
      const fileName = extractFileName(filePath, index);
      const uploaded = await uploadLocalFile(filePath, {
        folder: "chat-imports",
        fileName,
      });
      applyResult(
        await addChatImportAsset(conversationId.value, batch.value.id, {
          objectKey: uploaded.objectKey,
          publicUrl: uploaded.publicUrl,
          fileName,
          mimeType: guessImageMimeType(fileName),
          screenshotSequence: batch.value.assets.length,
        })
      );
    }
  } catch (error) {
    if (!isCanceled(error)) {
      showError(error, "截图上传失败，请稍后重试");
    }
  } finally {
    isUploading.value = false;
  }
}

async function handleSwapIdentity() {
  if (!batch.value || isSubmitting.value) {
    return;
  }
  const nextLeft = batch.value.rightSpeaker;
  const nextRight = batch.value.leftSpeaker;
  try {
    applyResult(
      await updateChatImportIdentity(conversationId.value, batch.value.id, {
        leftSpeaker: nextLeft,
        rightSpeaker: nextRight,
      })
    );
  } catch (error) {
    showError(error, "暂时无法调整双方");
  }
}

async function handleStartRecognition() {
  if (!batch.value?.assets.length || isUploading.value || isSubmitting.value) {
    return;
  }
  isSubmitting.value = true;
  try {
    applyResult(
      await recognizeChatImport(conversationId.value, batch.value.id, {
        leftSpeaker: batch.value.leftSpeaker,
        rightSpeaker: batch.value.rightSpeaker,
      })
    );
    reportChatImportEvent("recognition_started", {
      screenshotCount: batch.value?.screenshotCount,
      batchStatus: batch.value?.status,
    });
    startPolling();
    startProcessingTextRotation();
  } catch (error) {
    showError(error, "暂时无法开始识别");
  } finally {
    isSubmitting.value = false;
  }
}

function startPolling() {
  stopPolling();
  const poll = async () => {
    if (!batch.value) {
      return;
    }
    try {
      const result = await getChatImport(conversationId.value, batch.value.id);
      const previousStatus = batch.value.status;
      applyResult(result);
      if (
        ["queued", "recognizing", "importing", "extracting_memory"].includes(
          result.batch?.status || ""
        )
      ) {
        processingProgress.value = Math.min(88, processingProgress.value + 7);
        pollingTimer = setTimeout(poll, 1600);
      } else {
        if (
          previousStatus !== "needs_review" &&
          result.batch?.status === "needs_review"
        ) {
          reportChatImportEvent("recognition_completed", {
            screenshotCount: result.batch.screenshotCount,
            messageCount: result.batch.recognizedCount,
            batchStatus: result.batch.status,
          });
        }
        processingProgress.value = 100;
        stopProcessingTextRotation();
      }
    } catch {
      pollingTimer = setTimeout(poll, 3000);
    }
  };
  pollingTimer = setTimeout(poll, 900);
}

function stopPolling() {
  if (pollingTimer) {
    clearTimeout(pollingTimer);
    pollingTimer = null;
  }
}

function startProcessingTextRotation() {
  stopProcessingTextRotation();
  processingTextTimer = setInterval(() => {
    processingMessageIndex.value += 1;
  }, 2400);
}

function stopProcessingTextRotation() {
  if (processingTextTimer) {
    clearInterval(processingTextTimer);
    processingTextTimer = null;
  }
}

function resumePollingIfNeeded() {
  if (isProcessing.value) {
    startPolling();
    startProcessingTextRotation();
  }
}

function handleEditItem(item: ChatImportItem) {
  editingItemId.value = item.id;
  editorContent.value = item.content;
  editorSpeaker.value = item.speaker === "user" ? "user" : "agent";
  const sourceDate = item.occurredAt;
  editorDate.value = sourceDate ? formatDateInput(sourceDate) : "";
  editorTime.value = sourceDate ? formatTimeInput(sourceDate) : "";
  isEditorVisible.value = true;
}

function closeEditor() {
  isEditorVisible.value = false;
  editingItemId.value = "";
}

function handleEditorContentInput(event: { detail?: { value?: string } }) {
  editorContent.value = event.detail?.value || "";
}

function handleEditorDateChange(event: { detail?: { value?: string } }) {
  editorDate.value = event.detail?.value || "";
}

function handleEditorTimeChange(event: { detail?: { value?: string } }) {
  editorTime.value = event.detail?.value || "";
}

async function handleSaveItem() {
  if (!batch.value || !editingItemId.value || isSubmitting.value) {
    return;
  }
  const content = editorContent.value.trim();
  if (!content) {
    Taro.showToast({ title: "聊天内容不能为空", icon: "none" });
    return;
  }
  isSubmitting.value = true;
  try {
    const occurredAt = buildEditorDate();
    applyResult(
      await updateChatImportItem(
        conversationId.value,
        batch.value.id,
        editingItemId.value,
        {
          content,
          speaker: editorSpeaker.value,
          ...(occurredAt
            ? {
                occurredAt: occurredAt.toISOString(),
                rawTimeText: `${editorDate.value} ${
                  editorTime.value || "00:00"
                }`,
                timePrecision: editorTime.value ? "minute" : "day",
                timeConfidence: "high",
              }
            : {}),
        }
      )
    );
    reportChatImportEvent("review_modified", {
      messageCount: reviewItems.value.length,
      batchStatus: batch.value?.status,
    });
    closeEditor();
  } catch (error) {
    showError(error, "保存失败，请稍后重试");
  } finally {
    isSubmitting.value = false;
  }
}

async function handleDeleteItem() {
  if (!batch.value || !editingItemId.value || isSubmitting.value) {
    return;
  }
  isSubmitting.value = true;
  try {
    applyResult(
      await updateChatImportItem(
        conversationId.value,
        batch.value.id,
        editingItemId.value,
        { isDeleted: true }
      )
    );
    reportChatImportEvent("review_modified", {
      messageCount: reviewItems.value.length,
      batchStatus: batch.value?.status,
    });
    closeEditor();
  } catch (error) {
    showError(error, "删除失败，请稍后重试");
  } finally {
    isSubmitting.value = false;
  }
}

async function handleConfirmImport() {
  if (!batch.value || !canConfirmImport.value || isSubmitting.value) {
    if (unresolvedSpeakerCount.value) {
      Taro.showToast({ title: "请先确认每条消息是谁说的", icon: "none" });
    }
    return;
  }
  isSubmitting.value = true;
  try {
    applyResult(await confirmChatImport(conversationId.value, batch.value.id));
    reportChatImportEvent("confirmed", {
      screenshotCount: batch.value?.screenshotCount,
      messageCount: batch.value?.confirmedCount,
      batchStatus: batch.value?.status,
    });
    startPolling();
    startProcessingTextRotation();
  } catch (error) {
    showError(error, "导入没有完成，请稍后重试");
  } finally {
    isSubmitting.value = false;
  }
}

function handleEditMemory(memory: ChatImportMemoryCandidate) {
  editingMemoryId.value = memory.id;
  memoryEditorValue.value = memory.value;
  isMemoryEditorVisible.value = true;
}

function closeMemoryEditor() {
  isMemoryEditorVisible.value = false;
  editingMemoryId.value = "";
  memoryEditorValue.value = "";
}

function handleMemoryEditorInput(event: { detail?: { value?: string } }) {
  memoryEditorValue.value = event.detail?.value || "";
}

async function handleSaveMemory() {
  if (!batch.value || !editingMemoryId.value || isSubmitting.value) {
    return;
  }
  const value = memoryEditorValue.value.trim();
  if (!value) {
    Taro.showToast({ title: "记忆内容不能为空", icon: "none" });
    return;
  }
  isSubmitting.value = true;
  try {
    applyResult(
      await updateChatImportMemory(
        conversationId.value,
        batch.value.id,
        editingMemoryId.value,
        { value }
      )
    );
    closeMemoryEditor();
  } catch (error) {
    showError(error, "记忆修改失败，请稍后重试");
  } finally {
    isSubmitting.value = false;
  }
}

async function handleRemoveMemory(memory: ChatImportMemoryCandidate) {
  if (!batch.value || isSubmitting.value) {
    return;
  }
  const result = await Taro.showModal({
    title: "移除这条记忆？",
    content: "移除后，这条内容不会写入他的记忆。",
    confirmText: "移除",
    confirmColor: "#976464",
  });
  if (!result.confirm || !batch.value) {
    return;
  }
  isSubmitting.value = true;
  try {
    applyResult(
      await updateChatImportMemory(
        conversationId.value,
        batch.value.id,
        memory.id,
        { isDeleted: true }
      )
    );
  } catch (error) {
    showError(error, "暂时无法移除这条记忆");
  } finally {
    isSubmitting.value = false;
  }
}

async function handleConfirmMemories() {
  if (!batch.value || isSubmitting.value) {
    return;
  }
  isSubmitting.value = true;
  try {
    applyResult(
      await confirmChatImportMemories(conversationId.value, batch.value.id)
    );
  } catch (error) {
    showError(error, "记忆确认失败，请稍后重试");
  } finally {
    isSubmitting.value = false;
  }
}

function handleReturnToChat() {
  if (recoveredChatUrl.value) {
    void Taro.redirectTo({ url: recoveredChatUrl.value });
    return;
  }
  void Taro.navigateBack({ delta: 1 });
}

function speakerLabel(speaker?: ChatImportSpeaker) {
  if (speaker === "user") {
    return "我";
  }
  if (speaker === "agent") {
    return agentDisplayName.value;
  }
  return "待确认";
}

function isItemUncertain(item: ChatImportItem) {
  return (
    item.recognitionConfidence < 0.72 ||
    item.speaker === "unknown" ||
    item.timeConfidence === "low"
  );
}

function shouldShowItemTime(item: ChatImportItem) {
  const index = reviewItems.value.findIndex(
    (candidate) => candidate.id === item.id
  );
  if (index <= 0) {
    return true;
  }
  return formatItemTime(reviewItems.value[index - 1]) !== formatItemTime(item);
}

function formatItemTime(item: ChatImportItem) {
  if (item.occurredAt) {
    return `${formatDate(item.occurredAt)} ${formatTimeInput(item.occurredAt)}`;
  }
  return item.rawTimeText || "时间未确定";
}

function formatDate(value: Date | null | undefined) {
  if (!value) {
    return "";
  }
  return `${value.getFullYear()}年${
    value.getMonth() + 1
  }月${value.getDate()}日`;
}

function formatDateInput(value: Date) {
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(
    value.getDate()
  )}`;
}

function formatTimeInput(value: Date) {
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${pad(value.getHours())}:${pad(value.getMinutes())}`;
}

function buildEditorDate() {
  if (!editorDate.value) {
    return null;
  }
  const parsed = new Date(
    `${editorDate.value}T${editorTime.value || "00:00"}:00`
  );
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function decodeParam(value?: string) {
  if (!value) {
    return "";
  }
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function extractFileName(filePath: string, index: number) {
  const path = filePath.split("?")[0];
  const name = path.split(/[\\/]/).pop()?.trim();
  return name || `wechat_chat_${Date.now()}_${index + 1}.jpg`;
}

function guessImageMimeType(fileName: string) {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".heic")) return "image/heic";
  if (lower.endsWith(".heif")) return "image/heif";
  return "image/jpeg";
}

function isCanceled(error: unknown) {
  return Boolean(
    error &&
      typeof error === "object" &&
      "errMsg" in error &&
      String(error.errMsg).toLowerCase().includes("cancel")
  );
}

function showError(error: unknown, fallback: string) {
  const title = getErrorMessage(error, fallback);
  reportChatImportEvent("failed", {
    batchStatus: batch.value?.status,
    reason: title,
  });
  Taro.showToast({ title, icon: "none", duration: 2600 });
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof ApiException ? error.message || fallback : fallback;
}
</script>

<style lang="scss">
.chat-import-page {
  color: #24222b;
}

.chat-import-state,
.chat-import-processing,
.chat-import-complete {
  min-height: 620px;
  padding: 116px 32px 48px;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  box-sizing: border-box;
}

.chat-import-spinner {
  width: 24px;
  height: 24px;
  margin-bottom: 20px;
  border: 3px solid #d9dfdd;
  border-top-color: #297b69;
  border-radius: 50%;
  animation: chat-import-spin 0.9s linear infinite;
}

.chat-import-state__title {
  color: #77747f;
  font-size: 15px;
}
.chat-import-state--error {
  padding-top: 88px;
}
.chat-import-state__image {
  width: 88px;
  height: 88px;
}
.chat-import-state__error-title {
  margin-top: 20px;
  color: #2f2c35;
  font-size: 19px;
  line-height: 28px;
  font-weight: 650;
}
.chat-import-state__error-desc {
  max-width: 280px;
  margin-top: 8px;
  color: #77747f;
  font-size: 14px;
  line-height: 22px;
}
.chat-import-state__retry {
  min-width: 132px;
  height: 44px;
  margin-top: 25px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  background: #297b69;
  color: #fff;
  font-size: 15px;
  font-weight: 600;
}

.chat-import-setup,
.chat-import-review,
.chat-import-memory-review {
  padding: 0 0 32px;
}

.chat-import-intro,
.chat-import-assets,
.chat-import-identity,
.chat-import-tips,
.chat-import-review__summary {
  padding: 22px 20px;
  background: #ffffff;
  border-bottom: 1px solid #ececf0;
}

.chat-import-intro__title,
.chat-import-identity__title {
  display: block;
  font-size: 19px;
  line-height: 28px;
  font-weight: 650;
}

.chat-import-intro__desc,
.chat-import-identity__desc,
.chat-import-tips,
.chat-import-add__desc {
  display: block;
  margin-top: 7px;
  color: #77747f;
  font-size: 14px;
  line-height: 22px;
}

.chat-import-intro__quota {
  display: block;
  margin-top: 13px;
  color: #297b69;
  font-size: 13px;
  line-height: 20px;
  font-weight: 600;
}

.chat-import-assets {
  margin-top: 10px;
}
.chat-import-assets__grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
  margin-bottom: 14px;
}

.chat-import-asset {
  position: relative;
  width: 100%;
  aspect-ratio: 0.78;
  overflow: hidden;
  border-radius: 6px;
  background: #eeeef2;
}

.chat-import-asset__image {
  width: 100%;
  height: 100%;
}
.chat-import-asset__index {
  position: absolute;
  top: 6px;
  left: 6px;
  min-width: 22px;
  height: 22px;
  padding: 0 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 11px;
  background: rgba(36, 34, 43, 0.76);
  color: #fff;
  font-size: 11px;
  box-sizing: border-box;
}
.chat-import-asset__ready {
  position: absolute;
  right: 6px;
  bottom: 6px;
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: #297b69;
}
.chat-import-asset__failed {
  position: absolute;
  right: 5px;
  bottom: 5px;
  padding: 3px 6px;
  background: #fff1ee;
  color: #a75c52;
  font-size: 10px;
  border-radius: 4px;
}

.chat-import-add {
  min-height: 126px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  border: 1px dashed #cfd5d3;
  border-radius: 7px;
  background: #fafbfb;
}

.chat-import-add--compact {
  min-height: 56px;
  flex-direction: row;
  gap: 9px;
}
.chat-import-add__icon {
  width: 42px;
  height: 42px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.chat-import-add--compact .chat-import-add__icon {
  width: 28px;
  height: 28px;
}
.chat-import-add__title {
  color: #297b69;
  font-size: 15px;
  line-height: 22px;
  font-weight: 600;
}
.chat-import-uploading {
  margin-top: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: #4f6862;
  font-size: 13px;
}

.chat-import-identity {
  margin-top: 10px;
}
.chat-import-identity--review {
  margin: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 18px;
  padding-top: 13px;
  padding-bottom: 13px;
}
.chat-import-identity__row {
  margin-top: 17px;
  display: flex;
  align-items: center;
  gap: 13px;
}
.chat-import-identity__person {
  flex: 1;
  min-width: 0;
  height: 66px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  background: #f5f5f7;
}
.chat-import-identity--review .chat-import-identity__person {
  max-width: 128px;
  height: 52px;
}
.chat-import-identity__caption {
  color: #96939d;
  font-size: 12px;
  line-height: 18px;
}
.chat-import-identity__name {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #28262e;
  font-size: 16px;
  line-height: 24px;
  font-weight: 600;
}
.chat-import-identity__swap {
  flex: 0 0 38px;
  width: 38px;
  height: 38px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: #eaf3f0;
  color: #297b69;
  font-size: 21px;
}

.chat-import-tips {
  margin-top: 10px;
}
.chat-import-tips__title {
  display: block;
  color: #4f4d56;
  font-weight: 600;
}
.chat-import-error {
  margin: 12px 20px 0;
  padding: 12px 14px;
  color: #956057;
  font-size: 13px;
  line-height: 20px;
  background: #fff4f1;
  border-left: 3px solid #bb7b70;
}

.chat-import-processing__visual {
  position: relative;
  width: 118px;
  height: 118px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.chat-import-processing__ring {
  position: absolute;
  inset: 4px;
  border: 2px solid rgba(41, 123, 105, 0.2);
  border-top-color: #297b69;
  border-radius: 50%;
  animation: chat-import-spin 2.4s linear infinite;
}
.chat-import-processing__image {
  width: 84px;
  height: 84px;
}
.chat-import-processing__title {
  margin-top: 26px;
  font-size: 20px;
  line-height: 30px;
  font-weight: 650;
}
.chat-import-processing__desc {
  margin-top: 8px;
  color: #77747f;
  font-size: 14px;
  line-height: 22px;
}
.chat-import-processing__progress {
  width: 236px;
  height: 5px;
  margin-top: 32px;
  overflow: hidden;
  border-radius: 3px;
  background: #e2e5e4;
}
.chat-import-processing__progress-value {
  height: 100%;
  border-radius: 3px;
  background: #297b69;
  transition: width 0.45s ease;
}
.chat-import-processing__count {
  margin-top: 10px;
  color: #9a97a0;
  font-size: 12px;
}

.chat-import-review__summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.chat-import-review__count {
  display: block;
  font-size: 18px;
  line-height: 26px;
  font-weight: 650;
}
.chat-import-review__range {
  display: block;
  margin-top: 3px;
  color: #8e8b95;
  font-size: 12px;
}
.chat-import-review__dedupe {
  color: #297b69;
  font-size: 13px;
}
.chat-import-review__warning {
  margin: 10px 14px 0;
  padding: 10px 12px;
  color: #8c6725;
  font-size: 12px;
  line-height: 19px;
  background: #fff6dc;
  border-left: 3px solid #d1a84b;
}
.chat-import-review__hint {
  display: block;
  padding: 10px 20px;
  text-align: center;
  color: #8e8b95;
  font-size: 12px;
}
.chat-import-message-list {
  padding: 4px 14px 32px;
}
.chat-import-message-list__time {
  margin: 18px 0 10px;
  text-align: center;
  color: #9a97a0;
  font-size: 11px;
}
.chat-import-message-row {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  margin-bottom: 13px;
}
.chat-import-message-row--user {
  justify-content: flex-end;
}
.chat-import-message-avatar {
  flex: 0 0 34px;
  width: 34px;
  height: 34px;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 5px;
  background: #ded6ec;
  color: #625875;
  font-size: 13px;
}
.chat-import-message-avatar--user {
  background: #7a9f96;
  color: #fff;
}
.chat-import-message-avatar__image {
  width: 100%;
  height: 100%;
}
.chat-import-message-bubble {
  position: relative;
  max-width: 72%;
  min-height: 34px;
  padding: 9px 12px;
  border-radius: 5px;
  background: #fff;
  box-sizing: border-box;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03);
}
.chat-import-message-row--user .chat-import-message-bubble {
  background: #a8e794;
}
.chat-import-message-bubble--uncertain {
  padding-bottom: 25px;
  background: #fff6dc !important;
  border: 1px solid #e8ca78;
}
.chat-import-message-bubble__text {
  font-size: 15px;
  line-height: 22px;
  word-break: break-all;
}
.chat-import-message-bubble__warning {
  position: absolute;
  right: 9px;
  bottom: 5px;
  color: #a87819;
  font-size: 10px;
}

.chat-import-memory-review__intro {
  padding: 26px 20px 24px;
  display: flex;
  align-items: center;
  gap: 16px;
  background: #fff;
  border-bottom: 1px solid #ececf0;
}
.chat-import-memory-review__image {
  flex: 0 0 72px;
  width: 72px;
  height: 72px;
}
.chat-import-memory-review__intro-copy {
  flex: 1;
  min-width: 0;
}
.chat-import-memory-review__eyebrow {
  display: block;
  color: #297b69;
  font-size: 12px;
  line-height: 18px;
  font-weight: 600;
}
.chat-import-memory-review__intro-title {
  display: block;
  margin-top: 2px;
  font-size: 19px;
  line-height: 28px;
  font-weight: 650;
}
.chat-import-memory-review__intro-desc {
  display: block;
  margin-top: 5px;
  color: #77747f;
  font-size: 13px;
  line-height: 20px;
}
.chat-import-memory-review__section {
  margin-top: 10px;
  padding: 22px 20px 28px;
  background: #fff;
}
.chat-import-memory-review__heading-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}
.chat-import-memory-review__heading-row > view {
  flex: 1;
  min-width: 0;
}
.chat-import-memory-review__title {
  display: block;
  font-size: 18px;
  line-height: 26px;
  font-weight: 650;
}
.chat-import-memory-review__desc {
  display: block;
  margin-top: 5px;
  color: #77747f;
  font-size: 13px;
  line-height: 20px;
}
.chat-import-memory-review__count {
  flex: 0 0 auto;
  color: #297b69;
  font-size: 13px;
  line-height: 24px;
  font-weight: 600;
}
.chat-import-memory-list {
  margin-top: 18px;
  border-top: 1px solid #ececf0;
}
.chat-import-memory-row {
  display: flex;
  align-items: flex-start;
  gap: 11px;
  padding: 17px 0;
  border-bottom: 1px solid #ececf0;
}
.chat-import-memory-row__index {
  flex: 0 0 24px;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: #edf6f3;
  color: #297b69;
  font-size: 12px;
  font-weight: 600;
}
.chat-import-memory-row__content {
  flex: 1;
  min-width: 0;
}
.chat-import-memory-row__value {
  display: block;
  color: #302e36;
  font-size: 15px;
  line-height: 23px;
  word-break: break-all;
}
.chat-import-memory-row__source {
  display: block;
  margin-top: 5px;
  color: #99969f;
  font-size: 11px;
  line-height: 17px;
}
.chat-import-memory-row__actions {
  flex: 0 0 34px;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 13px;
  color: #297b69;
  font-size: 12px;
  line-height: 20px;
}
.chat-import-memory-row__remove {
  color: #976464;
}
.chat-import-memory-review__empty {
  margin-top: 18px;
  padding: 18px 16px;
  text-align: center;
  color: #77747f;
  font-size: 13px;
  line-height: 21px;
  background: #f7f7f9;
  border-left: 3px solid #b9c9c5;
}
.chat-import-memory-review__removed {
  display: block;
  margin-top: 13px;
  color: #99969f;
  font-size: 12px;
  line-height: 18px;
}

.chat-import-complete__check {
  width: 62px;
  height: 62px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: #297b69;
  box-shadow: 0 10px 24px rgba(41, 123, 105, 0.2);
}
.chat-import-complete__title {
  margin-top: 24px;
  font-size: 22px;
  line-height: 32px;
  font-weight: 650;
}
.chat-import-complete__desc {
  max-width: 300px;
  margin-top: 10px;
  color: #77747f;
  font-size: 14px;
  line-height: 23px;
}
.chat-import-complete__memory {
  width: 100%;
  margin-top: 34px;
  padding: 17px 18px;
  display: flex;
  align-items: center;
  gap: 14px;
  text-align: left;
  background: #fff;
  border-left: 3px solid #297b69;
  box-sizing: border-box;
}
.chat-import-complete__memory-image {
  width: 48px;
  height: 48px;
}
.chat-import-complete__memory-title {
  display: block;
  font-size: 15px;
  line-height: 22px;
  font-weight: 600;
}
.chat-import-complete__memory-desc {
  display: block;
  margin-top: 2px;
  color: #88858e;
  font-size: 12px;
  line-height: 19px;
}

.chat-import-bottom {
  padding: 10px 16px;
  background: #fff;
  border-top: 1px solid #ececf0;
}
.chat-import-primary {
  min-height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border-radius: 6px;
  background: #297b69;
  color: #fff;
  font-size: 16px;
  font-weight: 650;
}
.chat-import-primary--disabled {
  opacity: 0.42;
}

.chat-import-editor__scroll {
  width: 100%;
  height: 300px;
}
.chat-import-editor__scroll-content {
  padding: 0 2px 14px;
  box-sizing: border-box;
}
.chat-import-editor__label {
  display: block;
  margin: 14px 0 7px;
  color: #55525c;
  font-size: 13px;
  font-weight: 600;
}
.chat-import-editor__scroll-content .chat-import-editor__label:first-child {
  margin-top: 2px;
}
.chat-import-editor__textarea {
  width: 100%;
  height: 112px;
  padding: 11px 12px;
  border: 1px solid #dedee3;
  border-radius: 6px;
  background: #f8f8fa;
  font-size: 15px;
  line-height: 22px;
  box-sizing: border-box;
}
.chat-import-editor__speaker-row,
.chat-import-editor__time-row {
  display: flex;
  gap: 10px;
}
.chat-import-editor__speaker {
  flex: 1;
  height: 42px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid #dedee3;
  border-radius: 6px;
  color: #66636d;
}
.chat-import-editor__speaker--active {
  border-color: #297b69;
  background: #edf6f3;
  color: #297b69;
  font-weight: 600;
}
.chat-import-editor__time-row picker {
  flex: 1;
}
.chat-import-editor__time-control {
  height: 42px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid #dedee3;
  border-radius: 6px;
  color: #55525c;
  font-size: 14px;
}
.chat-import-editor__footer {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
}
.chat-import-editor__delete {
  height: 42px;
  display: flex;
  align-items: center;
  gap: 5px;
  color: #976464;
}
.chat-import-editor__actions {
  display: flex;
  gap: 10px;
}
.chat-import-editor__cancel,
.chat-import-editor__save {
  min-width: 86px;
  height: 42px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  box-sizing: border-box;
}
.chat-import-editor__cancel {
  background: #f1f1f3;
  color: #4f4d56;
}
.chat-import-editor__save {
  background: #297b69;
  color: #fff;
}
.chat-import-memory-editor__footer {
  width: 100%;
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

@keyframes chat-import-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
