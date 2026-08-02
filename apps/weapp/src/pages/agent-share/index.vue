<template>
  <page-scaffold
    class="agent-share-page"
    background="#f7f8fa"
    header-background="#f7f8fa"
    body-padding="0"
    :scroll="true"
    :safe-area-top="false"
    :safe-area-bottom="false"
  >
    <template #header>
      <app-bar
        title="亲友邀请"
        background="#f7f8fa"
        border-color="#eceef1"
      />
    </template>

    <view v-if="isLoadingPreview" class="share-state">
      <view class="share-state__spinner" />
      <text class="share-state__title">正在打开这份邀请...</text>
    </view>

    <view v-else-if="loadError" class="share-state">
      <text class="share-state__title">这份邀请暂时无法打开</text>
      <text class="share-state__desc">{{ loadError }}</text>
      <nut-button type="primary" shape="round" @click="loadPreview">
        重新加载
      </nut-button>
    </view>

    <view v-else-if="preview && joinResult" class="share-joined">
      <view class="share-person">
        <image
          v-if="preview.agent.avatar"
          class="share-person__avatar"
          :src="preview.agent.avatar"
          mode="aspectFill"
        />
        <view v-else class="share-person__avatar share-person__avatar--fallback">
          {{ avatarFallback }}
        </view>
        <text class="share-person__name">{{ displayName }}</text>
        <text class="share-person__status">已经来到你的天之灵</text>
      </view>

      <view class="share-context">
        <text class="share-context__title">他平时会怎么叫你？</text>
        <text class="share-context__desc">
          这个称呼只用于你们的对话，其他亲友不会看到。
        </text>
        <nut-input
          v-model="agentCallsUser"
          class="share-context__input"
          placeholder="例如：小颖、闺女、老哥"
          clearable
          :maxlength="20"
        />
      </view>

      <view class="share-joined__actions">
        <nut-button
          block
          type="primary"
          shape="round"
          :loading="isEnteringChat"
          @click="handleEnterChat(true)"
        >
          保存称呼，开始聊天
        </nut-button>
        <view class="share-joined__skip" @tap="handleEnterChat(false)">
          稍后再说
        </view>
      </view>
    </view>

    <view v-else-if="preview" class="share-preview">
      <view class="share-inviter">
        <image
          v-if="preview.inviter.avatar"
          class="share-inviter__avatar"
          :src="preview.inviter.avatar"
          mode="aspectFill"
        />
        <view v-else class="share-inviter__avatar share-inviter__avatar--fallback">
          {{ inviterFallback }}
        </view>
        <text class="share-inviter__text">
          {{ preview.inviter.name }}邀请你一起思念
        </text>
      </view>

      <view class="share-person">
        <image
          v-if="preview.agent.avatar"
          class="share-person__avatar"
          :src="preview.agent.avatar"
          mode="aspectFill"
        />
        <view v-else class="share-person__avatar share-person__avatar--fallback">
          {{ avatarFallback }}
        </view>
        <text class="share-person__name">{{ displayName }}</text>
        <text class="share-person__status">邀请你来到他的天之灵</text>
      </view>

      <view class="share-boundary">
        <text class="share-boundary__title">你会遇见同一个他</text>
        <view class="share-boundary__item">
          <view class="share-boundary__mark">1</view>
          <view class="share-boundary__copy">
            <text class="share-boundary__item-title">拥有自己的对话</text>
            <text class="share-boundary__item-desc">
              你说过的话和聊天记录，只属于你。
            </text>
          </view>
        </view>
        <view class="share-boundary__item">
          <view class="share-boundary__mark">2</view>
          <view class="share-boundary__copy">
            <text class="share-boundary__item-title">保留自己的记忆</text>
            <text class="share-boundary__item-desc">
              创建者和其他亲友都看不到你的私人记忆。
            </text>
          </view>
        </view>
        <view class="share-boundary__item">
          <view class="share-boundary__mark">3</view>
          <view class="share-boundary__copy">
            <text class="share-boundary__item-title">使用自己的服务权益</text>
            <text class="share-boundary__item-desc">
              聊天额度和会员权益不会与邀请人混在一起。
            </text>
          </view>
        </view>
      </view>

      <view class="share-preview__actions">
        <nut-button
          block
          type="primary"
          shape="round"
          :loading="isJoining"
          @click="handleJoin"
        >
          加入我的天之灵
        </nut-button>
        <text class="share-preview__notice">
          登录后才会正式加入；查看邀请不会建立关系。
        </text>
      </view>
    </view>

    <login-prompt-popup
      v-model:visible="isLoginPromptVisible"
      title="登录并接受邀请"
      subtitle="登录成功后会回到这里，不需要绑定手机号"
      action-text="微信登录并继续"
      @login-success="handleLoginSuccess"
    />
  </page-scaffold>
</template>

<script lang="ts">
export default {
  name: "AgentSharePage",
};
</script>

<script setup lang="ts">
import Taro, { useLoad } from "@tarojs/taro";
import type { AgentShareInvitePreviewDTO } from "@tzl/shared";
import { computed, ref } from "vue";
import { ApiException } from "../../api/api-exception";
import {
  acceptAgentShareInvite,
  getAgentShareInvitePreview,
  type AcceptedAgentShareInvite,
  updateAgentShareContext,
} from "../../apis/agent";
import { getConversations } from "../../apis/conversation";
import { authSession, restoreAuthSession } from "../../auth/session";
import AppBar from "../../components/app-bar/app-bar.vue";
import LoginPromptPopup from "../../components/login-prompt-popup/login-prompt-popup.vue";
import PageScaffold from "../../components/page-scaffold/page-scaffold.vue";
import {
  buildConversationChatUrl,
  rememberSelectedConversation,
} from "../../utils/selected-agent-chat";

const PENDING_INVITE_KEY = "tzl_pending_agent_share_invite_v1";

const token = ref("");
const preview = ref<AgentShareInvitePreviewDTO | null>(null);
const joinResult = ref<AcceptedAgentShareInvite | null>(null);
const agentCallsUser = ref("");
const loadError = ref("");
const isLoadingPreview = ref(true);
const isJoining = ref(false);
const isEnteringChat = ref(false);
const isLoginPromptVisible = ref(false);
const joinRequested = ref(false);

const displayName = computed(() => {
  return (
    preview.value?.agent.realName.trim() ||
    preview.value?.agent.name.trim() ||
    "这位亲友"
  );
});
const avatarFallback = computed(() => displayName.value.slice(0, 1));
const inviterFallback = computed(() => {
  return preview.value?.inviter.name.trim().slice(0, 1) || "亲";
});

useLoad((options) => {
  token.value = decodeRouteParam(
    options?.scene || options?.token || options?.shareToken
  );

  if (!token.value) {
    token.value = readPendingInviteToken();
  }

  void loadPreview();
});

function decodeRouteParam(value?: string) {
  if (typeof value !== "string") {
    return "";
  }

  try {
    return decodeURIComponent(value).trim();
  } catch {
    return value.trim();
  }
}

function readPendingInviteToken() {
  try {
    return String(Taro.getStorageSync(PENDING_INVITE_KEY) || "").trim();
  } catch {
    return "";
  }
}

function rememberPendingInviteToken() {
  try {
    Taro.setStorageSync(PENDING_INVITE_KEY, token.value);
  } catch {
    // Storage failure does not block accepting an invitation on this page.
  }
}

function clearPendingInviteToken() {
  try {
    Taro.removeStorageSync(PENDING_INVITE_KEY);
  } catch {
    // The accepted invitation remains idempotent on the server.
  }
}

async function loadPreview() {
  if (!token.value) {
    isLoadingPreview.value = false;
    loadError.value = "二维码中缺少邀请信息，请让邀请人重新生成。";
    return;
  }

  isLoadingPreview.value = true;
  loadError.value = "";

  try {
    preview.value = await getAgentShareInvitePreview(token.value);
  } catch (error) {
    loadError.value =
      error instanceof ApiException
        ? error.message
        : "邀请加载失败，请稍后重试。";
  } finally {
    isLoadingPreview.value = false;
  }
}

async function handleJoin() {
  if (isJoining.value || !preview.value) {
    return;
  }

  joinRequested.value = true;
  rememberPendingInviteToken();
  await restoreAuthSession();

  if (!authSession.value?.accessToken) {
    isLoginPromptVisible.value = true;
    return;
  }

  await completeJoin();
}

function handleLoginSuccess() {
  if (joinRequested.value) {
    void completeJoin();
  }
}

async function completeJoin() {
  if (isJoining.value) {
    return;
  }

  isJoining.value = true;
  loadError.value = "";

  try {
    joinResult.value = await acceptAgentShareInvite(token.value);
    clearPendingInviteToken();
  } catch (error) {
    if (error instanceof ApiException && error.requiresReLogin) {
      isLoginPromptVisible.value = true;
      return;
    }

    loadError.value =
      error instanceof ApiException
        ? error.message
        : "加入失败，请稍后重试。";
  } finally {
    isJoining.value = false;
  }
}

async function handleEnterChat(saveContext: boolean) {
  const result = joinResult.value;

  if (!result || isEnteringChat.value) {
    return;
  }

  isEnteringChat.value = true;

  try {
    const callName = agentCallsUser.value.trim();

    if (saveContext && callName) {
      await updateAgentShareContext(result.agent.id, {
        agentCallsUser: callName,
      });
    }

    const conversations = await getConversations({ force: true });
    const conversation = conversations.find(
      (item) => item.id === result.conversationId
    );

    if (!conversation) {
      throw new Error("CONVERSATION_NOT_FOUND");
    }

    rememberSelectedConversation(conversation);
    await Taro.reLaunch({ url: buildConversationChatUrl(conversation) });
  } catch (error) {
    void Taro.showToast({
      title:
        error instanceof ApiException
          ? error.message
          : "聊天打开失败，请稍后重试",
      icon: "none",
      duration: 1800,
    });
  } finally {
    isEnteringChat.value = false;
  }
}
</script>

<style lang="scss">
.agent-share-page {
  min-height: 100vh;
}

.share-state {
  min-height: 70vh;
  padding: 48px 28px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  text-align: center;
}

.share-state__spinner {
  width: 26px;
  height: 26px;
  border: 3px solid #dfe4e8;
  border-top-color: #20a17b;
  border-radius: 50%;
  animation: share-spin 760ms linear infinite;
}

.share-state__title {
  color: #20242a;
  font-size: 18px;
  line-height: 26px;
  font-weight: 600;
}

.share-state__desc {
  max-width: 290px;
  color: #7b818a;
  font-size: 14px;
  line-height: 22px;
}

.share-preview,
.share-joined {
  min-height: 100%;
  padding: 24px 20px calc(env(safe-area-inset-bottom) + 28px);
  box-sizing: border-box;
}

.share-inviter {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 9px;
  color: #60666f;
  font-size: 13px;
  line-height: 20px;
}

.share-inviter__avatar {
  width: 26px;
  height: 26px;
  flex-shrink: 0;
  border-radius: 50%;
  background: #e8ecef;
}

.share-inviter__avatar--fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  color: #687078;
  font-size: 12px;
}

.share-person {
  padding: 32px 0 28px;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}

.share-person__avatar {
  width: 104px;
  height: 104px;
  border: 4px solid #ffffff;
  border-radius: 50%;
  background: #e9edf0;
  box-shadow: 0 8px 26px rgba(31, 42, 50, 0.13);
}

.share-person__avatar--fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  color: #ffffff;
  background: #729a91;
  font-size: 36px;
  font-weight: 600;
}

.share-person__name {
  margin-top: 16px;
  color: #20242a;
  font-size: 24px;
  line-height: 34px;
  font-weight: 700;
}

.share-person__status {
  margin-top: 5px;
  color: #7b818a;
  font-size: 14px;
  line-height: 22px;
}

.share-boundary {
  padding: 22px 0 8px;
  border-top: 1px solid #e5e8eb;
  border-bottom: 1px solid #e5e8eb;
}

.share-boundary__title,
.share-context__title {
  display: block;
  margin-bottom: 18px;
  color: #252a30;
  font-size: 17px;
  line-height: 25px;
  font-weight: 600;
}

.share-boundary__item {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 20px;
}

.share-boundary__mark {
  width: 24px;
  height: 24px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  color: #167e61;
  background: #e5f4ef;
  font-size: 12px;
  font-weight: 700;
}

.share-boundary__copy {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.share-boundary__item-title {
  color: #30353b;
  font-size: 15px;
  line-height: 22px;
  font-weight: 600;
}

.share-boundary__item-desc,
.share-context__desc {
  color: #7b818a;
  font-size: 13px;
  line-height: 20px;
}

.share-preview__actions,
.share-joined__actions {
  padding-top: 24px;
}

.share-preview__notice {
  display: block;
  margin-top: 12px;
  color: #92979e;
  font-size: 12px;
  line-height: 19px;
  text-align: center;
}

.share-context {
  padding: 24px 0;
  border-top: 1px solid #e5e8eb;
  border-bottom: 1px solid #e5e8eb;
}

.share-context__title {
  margin-bottom: 6px;
}

.share-context__input {
  margin-top: 18px;
  border: 1px solid #dde2e5;
  border-radius: 6px;
  background: #ffffff;
}

.share-joined__skip {
  height: 44px;
  margin-top: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #747b83;
  font-size: 14px;
}

@keyframes share-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
