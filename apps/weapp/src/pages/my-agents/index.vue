<template>
  <page-scaffold
    class="my-agents-page"
    body-padding="0"
    background="#ffffff"
    :safe-area-top="false"
    :safe-area-bottom="false"
    :scroll="false"
    require-auth
    auth-loading-text="正在恢复我的天之灵..."
  >
    <template #header>
      <app-bar title="我的天之灵" background="#ffffff" />
    </template>

    <view v-if="isCheckingAuth" class="my-agents-feedback">
      <view class="my-agents-feedback__spinner" />
      <text class="my-agents-feedback__title">正在恢复我的天之灵...</text>
    </view>

    <scroll-view
      v-else-if="session"
      class="my-agents-scroll"
      :scroll-y="true"
      :show-scrollbar="false"
    >
      <view class="my-agents-content">
        <contact-cover-banner
          :value="contactsCoverImage"
          :uploading="isSavingCoverImage"
          @change="handleContactCoverChange"
          @upload="handleContactCoverChange"
          @error="showToast"
          @auth-expired="redirectToAuth"
        />

        <view class="my-agents-heading">
          <text class="my-agents-heading__title">选择聊天对象</text>
          <text class="my-agents-heading__desc">
            底部“聊天”将直接进入当前选择的天之灵
          </text>
        </view>

        <view
          v-if="isLoading"
          class="my-agents-feedback my-agents-feedback--inline"
        >
          <view class="my-agents-feedback__spinner" />
          <text class="my-agents-feedback__title">正在加载联系人...</text>
        </view>

        <view
          v-else-if="loadError"
          class="my-agents-feedback my-agents-feedback--inline"
        >
          <text class="my-agents-feedback__title">{{ loadError }}</text>
          <text class="my-agents-feedback__action" @tap="handleRetry"
            >重新加载</text
          >
        </view>

        <view v-else class="my-agents-list">
          <view
            v-for="conversation in conversations"
            :key="conversation.id"
            class="my-agents-item"
            :class="{
              'my-agents-item--selected':
                conversation.agentId === selectedAgentId,
            }"
            @tap="handleConversationSelect(conversation)"
          >
            <view
              class="my-agents-item__avatar-wrap"
              :class="{
                'my-agents-item__avatar-wrap--selected':
                  conversation.agentId === selectedAgentId,
              }"
            >
              <image
                v-if="conversation.agentAvatar"
                class="my-agents-item__avatar"
                :src="conversation.agentAvatar"
                mode="aspectFill"
              />
              <view
                v-else
                class="my-agents-item__avatar my-agents-item__avatar--fallback"
                :class="{
                  'my-agents-item__avatar--male': conversation.agentSex === 1,
                  'my-agents-item__avatar--female': conversation.agentSex !== 1,
                }"
              >
                {{ buildConversationFallback(conversation.agentName) }}
              </view>
            </view>

            <view class="my-agents-item__content">
              <view class="my-agents-item__headline">
                <view class="my-agents-item__name-group">
                  <text class="my-agents-item__name">
                    {{ resolveConversationName(conversation) }}
                  </text>
                  <text
                    v-if="conversation.agentAccessRole === 'shared'"
                    class="my-agents-item__shared-badge"
                  >
                    亲友共享
                  </text>
                </view>
                <text class="my-agents-item__time">
                  {{ formatConversationUpdatedAt(conversation.updatedAt) }}
                </text>
              </view>
              <text class="my-agents-item__preview">
                {{ buildConversationPreview(conversation.preview) }}
              </text>
            </view>

            <view class="my-agents-item__selection">
              <view
                v-if="selectingAgentId === conversation.agentId"
                class="my-agents-item__selection-spinner"
              />
              <template v-else-if="conversation.agentId === selectedAgentId">
                <view class="my-agents-item__selection-check">
                  <Check color="#ffffff" size="12" />
                </view>
                <text class="my-agents-item__selection-label">当前聊天</text>
              </template>
              <template v-else>
                <view class="my-agents-item__selection-circle" />
                <text
                  class="my-agents-item__selection-label my-agents-item__selection-label--muted"
                >
                  选择
                </text>
              </template>
            </view>
          </view>

          <view class="my-agents-create" @tap="handleCreateAgentTap">
            <view class="my-agents-create__avatar">
              <image
                class="my-agents-create__avatar-image"
                :src="createAgentAvatarUrl"
                mode="aspectFill"
              />
            </view>
            <view class="my-agents-create__content">
              <text class="my-agents-create__title">新建天之灵</text>
              <text class="my-agents-create__desc"
                >创建新的联系人并保存到这里</text
              >
            </view>
            <view class="my-agents-create__plus">
              <view class="my-agents-create__plus-horizontal" />
              <view class="my-agents-create__plus-vertical" />
            </view>
          </view>

          <view v-if="!conversations.length" class="my-agents-empty">
            <text class="my-agents-empty__title">还没有天之灵</text>
            <text class="my-agents-empty__desc"
              >完成创建后，联系人会保存在这里。</text
            >
          </view>
        </view>
      </view>
    </scroll-view>
  </page-scaffold>
</template>

<script lang="ts">
export default {
  name: "MyAgentsPage",
};
</script>

<script setup lang="ts">
import { Check } from "@nutui/icons-vue-taro";
import { buildOssMediaUrl } from "@tzl/shared";
import Taro, { useDidShow } from "@tarojs/taro";
import { computed, ref } from "vue";
import { ApiException } from "../../api/api-exception";
import { updateAgentDefault } from "../../apis/agent";
import {
  getCachedConversations,
  getConversations,
  type ConversationSummary,
} from "../../apis/conversation";
import { updateUserPreferences } from "../../auth/api";
import { authSession, clearAuthSession } from "../../auth/session";
import AppBar from "../../components/app-bar/app-bar.vue";
import ContactCoverBanner from "../../components/contact-cover-banner/contact-cover-banner.vue";
import PageScaffold from "../../components/page-scaffold/page-scaffold.vue";
import { openAgentCreatePage } from "../../utils/agent-create-navigation";
import {
  ensureAuthenticatedSession,
  redirectToAuthPage,
} from "../../utils/auth-guard";
import {
  resolveConversationName,
  resolveSelectedConversation,
  getRememberedSelectedConversation,
  rememberSelectedConversation,
  sortConversationsForSelection,
} from "../../utils/selected-agent-chat";

const isCheckingAuth = ref(true);
const isLoading = ref(true);
const loadError = ref("");
const conversations = ref<ConversationSummary[]>([]);
const selectingAgentId = ref("");
const isSavingCoverImage = ref(false);
const hasPreparedPage = ref(false);

let refreshPromise: Promise<void> | null = null;

const session = computed(() => authSession.value);
const contactsCoverImage = computed(() => {
  return session.value?.user.preferences.contactsCoverImage ?? "";
});
const selectedAgentId = computed(() => {
  const remembered = getRememberedSelectedConversation();

  if (
    remembered &&
    conversations.value.some((item) => item.id === remembered.id)
  ) {
    return remembered.agentId;
  }

  return resolveSelectedConversation(conversations.value)?.agentId ?? "";
});
const createAgentAvatarUrl = buildOssMediaUrl("/weapp/tianzhiling.png");

function showToast(title: string) {
  void Taro.showToast({
    title,
    icon: "none",
    duration: 1800,
  });
}

async function redirectToAuth(message?: string) {
  await clearAuthSession();

  if (message) {
    showToast(message);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  await redirectToAuthPage();
}

async function handleContactCoverChange(imageReference: string) {
  if (isSavingCoverImage.value) {
    return;
  }

  isSavingCoverImage.value = true;

  try {
    await updateUserPreferences({ contactsCoverImage: imageReference });
  } catch (error) {
    if (error instanceof ApiException && error.requiresReLogin) {
      await redirectToAuth(error.message);
      return;
    }

    showToast(
      error instanceof ApiException ? error.message : "封面保存失败，请稍后重试"
    );
  } finally {
    isSavingCoverImage.value = false;
  }
}

function handleRetry() {
  void refreshConversations({ force: true, showLoading: true });
}

async function handleConversationSelect(conversation: ConversationSummary) {
  if (selectingAgentId.value) {
    return;
  }

  const name = resolveConversationName(conversation);

  if (conversation.agentId === selectedAgentId.value) {
    showToast(`当前聊天对象是「${name}」`);
    return;
  }

  const result = await Taro.showModal({
    title: "切换聊天对象",
    content: `选择「${name}」后，点击底部“聊天”将直接进入与 TA 的对话。`,
    confirmText: "确认切换",
    cancelText: "取消",
    confirmColor: "#22c55e",
  });

  if (!result.confirm) {
    return;
  }

  selectingAgentId.value = conversation.agentId;

  try {
    rememberSelectedConversation(conversation);

    if (conversation.agentAccessRole === "owner") {
      await updateAgentDefault(conversation.agentId, { isDefault: true });
    }

    conversations.value = conversations.value.map((item) => ({
      ...item,
      agentIsDefault: item.agentId === conversation.agentId,
    }));
    await Taro.showToast({
      title: `已切换到「${name}」`,
      icon: "success",
      duration: 1600,
    });
  } catch (error) {
    if (error instanceof ApiException && error.requiresReLogin) {
      await redirectToAuth(error.message);
      return;
    }

    showToast(
      error instanceof ApiException ? error.message : "切换失败，请稍后重试"
    );
  } finally {
    selectingAgentId.value = "";
  }
}

async function handleCreateAgentTap() {
  try {
    await openAgentCreatePage();
  } catch {
    showToast("页面打开失败，请重试");
  }
}

function buildConversationFallback(name: string) {
  const trimmedName = name.trim();
  return trimmedName ? trimmedName.slice(0, 1) : "A";
}

function buildConversationPreview(preview: string) {
  const segments = preview
    .split("</fenge>")
    .map((item) => item.trim())
    .filter(Boolean);
  const rawPreview = segments.length
    ? segments[segments.length - 1]
    : preview.trim();
  const cleanedPreview = rawPreview.replace(/<[^>]+>/g, "").trim();

  return cleanedPreview || "还没有聊天记录";
}

function formatConversationUpdatedAt(value: Date | null) {
  if (!value) {
    return "";
  }

  const now = new Date();
  const isSameDay =
    now.getFullYear() === value.getFullYear() &&
    now.getMonth() === value.getMonth() &&
    now.getDate() === value.getDate();

  if (isSameDay) {
    return `${String(value.getHours()).padStart(2, "0")}:${String(
      value.getMinutes()
    ).padStart(2, "0")}`;
  }

  return `${String(value.getMonth() + 1).padStart(2, "0")}-${String(
    value.getDate()
  ).padStart(2, "0")}`;
}

async function refreshConversations(
  options: { force?: boolean; showLoading?: boolean } = {}
) {
  if (refreshPromise) {
    return refreshPromise;
  }

  if (options.showLoading ?? conversations.value.length === 0) {
    isLoading.value = true;
  }
  loadError.value = "";

  refreshPromise = getConversations({ force: options.force })
    .then((items) => {
      conversations.value = sortConversationsForSelection(items);
    })
    .catch(async (error: unknown) => {
      if (error instanceof ApiException && error.requiresReLogin) {
        await redirectToAuth(error.message);
        return;
      }

      loadError.value =
        error instanceof ApiException
          ? error.message
          : "加载联系人失败，请稍后重试";
    })
    .finally(() => {
      isLoading.value = false;
      refreshPromise = null;
    });

  return refreshPromise;
}

async function preparePage() {
  if (!hasPreparedPage.value) {
    isCheckingAuth.value = true;
  }

  const authenticated = await ensureAuthenticatedSession();
  if (!authenticated || !authSession.value) {
    isCheckingAuth.value = false;
    isLoading.value = false;
    return;
  }

  hasPreparedPage.value = true;
  isCheckingAuth.value = false;

  if (!conversations.value.length) {
    const cachedConversations = getCachedConversations();
    if (cachedConversations.length) {
      conversations.value = sortConversationsForSelection(cachedConversations);
      isLoading.value = false;
    }
  }

  void refreshConversations({
    force: true,
    showLoading: conversations.value.length === 0,
  });
}

useDidShow(() => {
  void preparePage();
});
</script>

<style lang="scss">
.my-agents-page {
  min-height: 100vh;
}

.my-agents-scroll {
  height: 100%;
}

.my-agents-content {
  min-height: 100%;
  padding-bottom: calc(env(safe-area-inset-bottom) + 28px);
  background: #ffffff;
}

.my-agents-heading {
  padding: 20px 20px 12px;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.my-agents-heading__title {
  color: #1f2937;
  font-size: 18px;
  font-weight: 600;
}

.my-agents-heading__desc {
  color: #8a9099;
  font-size: 13px;
  line-height: 20px;
}

.my-agents-feedback {
  min-height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: #6b7280;
}

.my-agents-feedback--inline {
  min-height: 180px;
}

.my-agents-feedback__spinner,
.my-agents-item__selection-spinner {
  width: 20px;
  height: 20px;
  box-sizing: border-box;
  border: 2px solid rgba(34, 197, 94, 0.2);
  border-top-color: #22c55e;
  border-radius: 50%;
  animation: my-agents-spin 700ms linear infinite;
}

.my-agents-feedback__title {
  font-size: 14px;
}

.my-agents-feedback__action {
  color: #16a34a;
  font-size: 14px;
}

.my-agents-list {
  border-top: 1px solid #f0f1f2;
}

.my-agents-item,
.my-agents-create {
  position: relative;
  display: flex;
  align-items: center;
  min-height: 78px;
  padding: 10px 16px;
  box-sizing: border-box;
  background: #ffffff;
}

.my-agents-item::after,
.my-agents-create::after {
  position: absolute;
  right: 16px;
  bottom: 0;
  left: 78px;
  height: 1px;
  background: #f0f1f2;
  content: "";
}

.my-agents-item--selected {
  background: rgba(34, 197, 94, 0.055);
}

.my-agents-item__avatar-wrap,
.my-agents-create__avatar {
  width: 52px;
  height: 52px;
  flex: 0 0 52px;
  padding: 2px;
  box-sizing: border-box;
  border: 2px solid transparent;
  border-radius: 50%;
}

.my-agents-item__avatar-wrap--selected {
  border-color: #22c55e;
}

.my-agents-item__avatar,
.my-agents-create__avatar-image {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border-radius: 50%;
}

.my-agents-item__avatar--fallback {
  color: #ffffff;
  font-size: 18px;
  font-weight: 600;
}

.my-agents-item__avatar--male {
  background: #6f8fc7;
}

.my-agents-item__avatar--female {
  background: #c887a2;
}

.my-agents-item__content,
.my-agents-create__content {
  min-width: 0;
  flex: 1;
  margin-left: 12px;
}

.my-agents-item__headline {
  display: flex;
  align-items: center;
  gap: 8px;
}

.my-agents-item__name-group {
  min-width: 0;
  flex: 1;
  display: flex;
  align-items: center;
  gap: 6px;
}

.my-agents-item__shared-badge {
  flex-shrink: 0;
  padding: 1px 5px;
  border-radius: 4px;
  color: #26745f;
  background: #e8f4f0;
  font-size: 10px;
  line-height: 16px;
}

.my-agents-item__name,
.my-agents-create__title {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  color: #1f2937;
  font-size: 16px;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.my-agents-item__time {
  flex: 0 0 auto;
  color: #a1a7af;
  font-size: 11px;
}

.my-agents-item__preview,
.my-agents-create__desc {
  max-width: 100%;
  margin-top: 5px;
  display: block;
  overflow: hidden;
  color: #8a9099;
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.my-agents-item__selection {
  width: 66px;
  min-height: 44px;
  margin-left: 10px;
  display: flex;
  flex: 0 0 66px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
}

.my-agents-item__selection-check,
.my-agents-item__selection-circle {
  width: 22px;
  height: 22px;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
}

.my-agents-item__selection-check {
  background: #22c55e;
}

.my-agents-item__selection-circle {
  border: 1.5px solid #c8cdd3;
  background: #ffffff;
}

.my-agents-item__selection-label {
  color: #16a34a;
  font-size: 11px;
  white-space: nowrap;
}

.my-agents-item__selection-label--muted {
  color: #9aa0a8;
}

.my-agents-create {
  min-height: 76px;
}

.my-agents-create__avatar {
  padding: 0;
  border: 0;
  background: #f3f8f5;
}

.my-agents-create__plus {
  position: relative;
  width: 28px;
  height: 28px;
  margin: 0 18px 0 20px;
  flex: 0 0 28px;
  border-radius: 50%;
  background: #22c55e;
}

.my-agents-create__plus-horizontal,
.my-agents-create__plus-vertical {
  position: absolute;
  top: 50%;
  left: 50%;
  border-radius: 1px;
  background: #ffffff;
  transform: translate(-50%, -50%);
}

.my-agents-create__plus-horizontal {
  width: 12px;
  height: 2px;
}

.my-agents-create__plus-vertical {
  width: 2px;
  height: 12px;
}

.my-agents-empty {
  padding: 34px 24px 20px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 7px;
  text-align: center;
}

.my-agents-empty__title {
  color: #4b5563;
  font-size: 15px;
}

.my-agents-empty__desc {
  color: #9aa0a8;
  font-size: 13px;
}

@keyframes my-agents-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
