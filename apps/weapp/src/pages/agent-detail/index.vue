<template>
  <page-scaffold
    class="agent-detail-page"
    background="#ededed"
    header-background="#ededed"
    body-padding="0"
    :scroll="true"
    :safe-area-top="false"
    :safe-area-bottom="false"
  >
    <template #header>
      <app-bar title="" background="#ededed" />
    </template>

    <view v-if="isCheckingAuth || isLoading" class="agent-detail-state">
      <view class="agent-detail-state__dot" />
      <text class="agent-detail-state__text">
        {{ isCheckingAuth ? "正在恢复会话..." : "正在加载资料..." }}
      </text>
    </view>

    <view v-else-if="showBlockingError" class="agent-detail-state">
      <text class="agent-detail-state__title">资料暂时加载失败</text>
      <text class="agent-detail-state__text">{{ loadError }}</text>
      <view class="agent-detail-state__button" @tap="handleRetry">重试</view>
    </view>

    <view v-else class="agent-detail">
      <view
        class="agent-detail-header"
        @tap="handleOpenAgentForm"
      >
        <view class="agent-detail-header__avatar-wrap">
          <image
            v-if="displayAvatar"
            class="agent-detail-header__avatar"
            :src="displayAvatar"
            mode="aspectFill"
          />
          <view
            v-else
            class="agent-detail-header__avatar agent-detail-header__avatar--fallback"
            :class="avatarFallbackClass"
          >
            {{ avatarFallback }}
          </view>
        </view>

        <view class="agent-detail-header__meta">
          <view class="agent-detail-header__name-row">
            <text class="agent-detail-header__name">{{ displayName }}</text>
          </view>
          <text class="agent-detail-header__sub">{{ headerSubtitle }}</text>
        </view>

        <view
          v-if="agent?.accessRole === 'owner'"
          class="agent-detail-header__tools"
        >
          <view
            class="agent-detail-header__tool agent-detail-header__tool--edit"
          />
        </view>
      </view>

      <view class="agent-detail-spacer" />

      <view class="agent-detail-list">
        <view
          class="agent-detail-list__item agent-detail-list__item--profile"
          @tap="handleProfileTap"
        >
          <view class="agent-detail-list__content">
            <view class="agent-detail-list__title-row">
              <text class="agent-detail-list__title">亲友资料</text>
              <view
                v-if="isAgentProfileGuideVisible"
                class="agent-detail-list__guide-dot"
              />
            </view>
            <text class="agent-detail-list__desc"
              >补充亲友资料，让对话更自然</text
            >
          </view>
          <view class="agent-detail-list__arrow" />
        </view>

        <view
          v-if="agent?.accessRole === 'owner'"
          class="agent-detail-list__item agent-detail-list__item--voice"
          @tap="handleVoiceModelTap"
        >
          <view class="agent-detail-list__content">
            <text class="agent-detail-list__title">声音模型</text>
            <text class="agent-detail-list__desc">
              {{ voiceModelDescription }}
            </text>
          </view>
          <Loading
            v-if="isLoadingVoiceModel"
            color="#999999"
            size="16"
          />
          <view v-else class="agent-detail-list__arrow" />
        </view>

        <view
          class="agent-detail-list__item agent-detail-list__item--album"
          @tap="handleChatAlbumTap"
        >
          <view class="agent-detail-album__main">
            <view class="agent-detail-list__content">
              <text class="agent-detail-list__title">聊天相册</text>
              <text class="agent-detail-list__desc"
                >聊天里的图片会自动收录</text
              >
            </view>
            <view class="agent-detail-album__right">
              <text class="agent-detail-list__value">{{ chatAlbumValue }}</text>
              <view
                v-if="chatAlbumPreviewImages.length"
                class="agent-detail-album__thumbs"
              >
                <view
                  v-for="imageUrl in chatAlbumPreviewImages"
                  :key="imageUrl"
                  class="agent-detail-album__thumb"
                >
                  <image
                    class="agent-detail-album__thumb-image"
                    :src="imageUrl"
                    mode="aspectFill"
                  />
                </view>
              </view>
            </view>
          </view>
          <view class="agent-detail-list__arrow" />
        </view>
      </view>

      <view class="agent-detail-spacer" />

      <view class="agent-detail-actions">
        <view class="agent-detail-action-button" @tap="handleSendMessage">
          <Message size="20" color="#07c160" />
          <text class="agent-detail-action-button__text">发消息</text>
        </view>
      </view>
    </view>

    <nut-popup
      v-model:visible="voiceModelPopupVisible"
      class="agent-detail-voice-model-popup"
      position="bottom"
      round
      :close-on-click-overlay="!isSelectingVoiceTimbre"
      :overlay-style="voiceModelPopupOverlayStyle"
    >
      <view class="agent-detail-voice-model-popup__content">
        <view class="agent-detail-voice-model-popup__header">
          <view>
            <text class="agent-detail-voice-model-popup__title">声音模型</text>
            <text class="agent-detail-voice-model-popup__subtitle">
              为“{{ displayName }}”选择已经训练好的音色
            </text>
          </view>
          <view
            class="agent-detail-voice-model-popup__close"
            aria-label="关闭"
            @tap="voiceModelPopupVisible = false"
          >
            <Close color="#67636d" size="19" />
          </view>
        </view>

        <view class="agent-detail-voice-model-popup__notice">
          <text>必须购买声音版会员，所选音色才会在聊天对话中生效。</text>
        </view>

        <view class="agent-detail-voice-model-list">
          <view
            v-for="item in voiceModelCenter?.items ?? []"
            :key="item.id"
            class="agent-detail-voice-model-item"
            :class="{
              'agent-detail-voice-model-item--selected':
                item.id === voiceModelCenter?.selectedTimbreId,
            }"
            @tap="handleVoiceTimbreSelect(item)"
          >
            <view class="agent-detail-voice-model-item__icon">
              <Voice color="#ffffff" size="17" />
            </view>
            <view class="agent-detail-voice-model-item__main">
              <text class="agent-detail-voice-model-item__name">
                {{ item.name }}
              </text>
              <text class="agent-detail-voice-model-item__meta">
                {{ voiceTimbreSelectionLabel(item.id) }}
              </text>
            </view>
            <Loading
              v-if="selectingVoiceTimbreId === item.id"
              color="#28755b"
              size="17"
            />
            <Checked
              v-else-if="item.id === voiceModelCenter?.selectedTimbreId"
              color="#28755b"
              size="19"
            />
            <view v-else class="agent-detail-list__arrow" />
          </view>
        </view>

        <view
          v-if="voiceModelCenter && !voiceModelCenter.voiceAccessEligible"
          class="agent-detail-voice-model-popup__action"
        >
          <nut-button
            block
            type="primary"
            class="agent-detail-voice-model-popup__button"
            @click="openVoiceMembership"
          >
            查看声音版会员
          </nut-button>
        </view>
      </view>
    </nut-popup>
  </page-scaffold>
</template>

<script lang="ts">
export default {
  name: "AgentDetailPage",
};
</script>

<script setup lang="ts">
import Taro, { useDidShow, useLoad } from "@tarojs/taro";
import {
  Checked,
  Close,
  Loading,
  Message,
  Voice,
} from "@nutui/icons-vue-taro";
import { computed, ref } from "vue";
import { ApiConfig } from "../../api/api-config";
import { ApiException } from "../../api/api-exception";
import {
  getAgentDetail,
  markAgentGuideSeen,
  type AgentSummary,
} from "../../apis/agent";
import {
  getConversationMessages,
  getConversations,
  type ConversationImagePayload,
} from "../../apis/conversation";
import {
  getAgentVoiceModelCenter,
  selectAgentVoiceTimbre,
  type AgentVoiceModelCenterDTO,
  type UserVoiceTimbreRecordDTO,
} from "../../apis/voice-service";
import { clearAuthSession } from "../../auth/session";
import AppBar from "../../components/app-bar/app-bar.vue";
import PageScaffold from "../../components/page-scaffold/page-scaffold.vue";
import {
  isAgentProfileEmpty,
  shouldShowAgentHomeGuide,
  shouldShowAgentProfileGuide,
} from "../../utils/agent-profile-guide";
import { prewarmAgentProfileInitialGreeting } from "../../utils/agent-profile-messenger-prewarm";
import {
  ensureAuthenticatedSession,
  redirectToAuthPage,
} from "../../utils/auth-guard";

const agent = ref<AgentSummary | null>(null);
const agentId = ref("");
const fallbackName = ref("");
const fallbackAvatar = ref("");
const fallbackSex = ref(0);
const fallbackAgentCallMe = ref("");
const fallbackICallAgent = ref("");
const fallbackPreview = ref("");
const fallbackCreatedAt = ref<Date | null>(null);
const isCheckingAuth = ref(true);
const isLoading = ref(false);
const isLoadingChatAlbum = ref(false);
const isLoadingVoiceModel = ref(false);
const isSelectingVoiceTimbre = ref(false);
const voiceModelPopupVisible = ref(false);
const loadError = ref("");
const didInitialShow = ref(false);
const conversationId = ref("");
const shareToken = ref("");
const chatAlbumImages = ref<string[]>([]);
const voiceModelCenter = ref<AgentVoiceModelCenterDTO | null>(null);
const selectingVoiceTimbreId = ref("");
const voiceModelPopupOverlayStyle = {
  backgroundColor: "rgba(0, 0, 0, 0.45)",
};

const displayName = computed(() => {
  const name = agent.value?.name.trim() || fallbackName.value.trim();
  return name || "未命名智能体";
});
const displayAvatar = computed(() => {
  return agent.value?.avatar.trim() || fallbackAvatar.value.trim();
});
const displaySex = computed(() => {
  return agent.value?.sex ?? fallbackSex.value;
});
const sexLabel = computed(() =>
  displaySex.value === 0 ? "她" : "他"
);
const headerSubtitle = computed(() => {
  const description =
    agent.value?.description.trim() || fallbackPreview.value.trim();
  const cleanedDescription = description ? cleanPreview(description) : "";

  return cleanedDescription || `${sexLabel.value}是你正在纪念的重要存在`;
});
const voiceModelDescription = computed(() => {
  const center = voiceModelCenter.value;
  if (!center) {
    return isLoadingVoiceModel.value
      ? "正在读取声音模型"
      : "选择已经训练好的音色";
  }
  if (!center.items.length) {
    return "还没有训练好的音色";
  }
  const selected = center.items.find(
    item => item.id === center.selectedTimbreId
  );
  if (!selected) {
    return "选择已经训练好的音色";
  }
  return center.selectionStatus === "active"
    ? `当前音色：${selected.name}`
    : `已选择：${selected.name}，待会员生效`;
});
const avatarFallback = computed(() => displayName.value.slice(0, 1));
const avatarFallbackClass = computed(() => {
  return displaySex.value === 1
    ? "agent-detail-header__avatar--male"
    : "agent-detail-header__avatar--female";
});
const hasFallbackSnapshot = computed(() => {
  return Boolean(
    fallbackName.value.trim() ||
      fallbackAvatar.value.trim() ||
      fallbackPreview.value.trim() ||
      fallbackAgentCallMe.value.trim() ||
      fallbackICallAgent.value.trim()
  );
});
const showBlockingError = computed(() => {
  return Boolean(loadError.value && !agent.value && !hasFallbackSnapshot.value);
});
const chatAlbumPreviewImages = computed(() =>
  chatAlbumImages.value.slice(0, 3)
);
const chatAlbumValue = computed(() => {
  if (isLoadingChatAlbum.value) {
    return "加载中";
  }

  return chatAlbumImages.value.length
    ? `${chatAlbumImages.value.length}张`
    : "暂无图片";
});
const profileDescription = computed(() => {
  const description =
    agent.value?.description.trim() || fallbackPreview.value.trim();

  if (description) {
    return cleanPreview(description);
  }

  const createdAt = agent.value?.createdAt ?? fallbackCreatedAt.value;
  const year = createdAt?.getFullYear();
  const relation =
    agent.value?.iCallAgent.trim() || fallbackICallAgent.value.trim();
  const callMe =
    agent.value?.agentCallMe.trim() || fallbackAgentCallMe.value.trim();
  const parts: string[] = [];

  if (year) {
    parts.push(`${year}年`);
  }

  if (relation) {
    parts.push(`你称呼${sexLabel.value}为“${relation}”`);
  } else {
    parts.push(`${sexLabel.value}是你正在纪念的重要存在`);
  }

  if (callMe) {
    parts.push(`${sexLabel.value}会叫你“${callMe}”`);
  }

  return `${parts.join("，")}。`;
});
const isAgentProfileGuideVisible = computed(() => {
  return shouldShowAgentProfileGuide(agent.value);
});

useLoad((options) => {
  conversationId.value = decodeRouteParam(options?.conversationId);
  agentId.value = decodeRouteParam(options?.agentId);
  shareToken.value = decodeRouteParam(options?.shareToken);
  fallbackName.value = decodeRouteParam(options?.agentName);
  fallbackAvatar.value = decodeRouteParam(options?.agentAvatar);
  fallbackSex.value =
    Number.parseInt(decodeRouteParam(options?.agentSex), 10) || 0;
  fallbackAgentCallMe.value = decodeRouteParam(options?.agentCallMe);
  fallbackICallAgent.value = decodeRouteParam(options?.iCallAgent);
  fallbackPreview.value = decodeRouteParam(options?.preview);
  fallbackCreatedAt.value = parseDate(decodeRouteParam(options?.createdAt));

  if (shareToken.value.trim()) {
    void Taro.redirectTo({
      url: `/pages/agent-share/index?token=${encodeURIComponent(
        shareToken.value.trim()
      )}`,
    });
    return;
  }

  void preparePage();
});

useDidShow(() => {
  if (!didInitialShow.value) {
    didInitialShow.value = true;
    return;
  }

  if (agentId.value && !isCheckingAuth.value) {
    void loadAgentDetail();
    void loadChatAlbum();
    void loadAgentVoiceModel();
  }
});

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

function parseDate(value: string) {
  if (!value.trim()) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function cleanPreview(value: string) {
  const segments = value
    .split("</fenge>")
    .map((item) => item.trim())
    .filter(Boolean);
  const raw = segments.length ? segments[segments.length - 1] : value.trim();
  return raw.replace(/<[^>]+>/g, "").trim();
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
  await Promise.all([
    loadAgentDetail(),
    loadChatAlbum(),
    loadAgentVoiceModel(),
  ]);
}

async function loadAgentDetail() {
  if (!agentId.value) {
    loadError.value = "缺少联系人资料，请返回通讯录重新进入";
    return;
  }

  isLoading.value = true;
  loadError.value = "";

  try {
    const detail = await getAgentDetail(agentId.value);
    agent.value = detail;
    void prewarmAgentProfileInitialGreeting(detail);
    if (shouldShowAgentHomeGuide(detail)) {
      void markAgentGuideSeen(agentId.value, "agent-home")
        .then((updatedAgent) => {
          if (agent.value?.id === updatedAgent.id) {
            agent.value = updatedAgent;
          }
        })
        .catch(() => undefined);
    }
  } catch (error) {
    if (error instanceof ApiException && error.requiresReLogin) {
      await clearAuthSession();
      await redirectToAuthPage();
      return;
    }

    loadError.value =
      error instanceof ApiException
        ? error.message
        : "资料加载失败，请稍后重试";
  } finally {
    isLoading.value = false;
  }
}

function handleRetry() {
  void loadAgentDetail();
  void loadChatAlbum();
  void loadAgentVoiceModel();
}

async function loadChatAlbum() {
  if (!conversationId.value) {
    chatAlbumImages.value = [];
    return;
  }

  isLoadingChatAlbum.value = true;

  try {
    const items = await getConversationMessages(conversationId.value);
    chatAlbumImages.value = items
      .filter(
        (message) => message.type === "image" && message.role !== "system"
      )
      .map((message) => resolveImageMessageUrl(message.image))
      .filter(
        (url, index, urls) => Boolean(url) && urls.indexOf(url) === index
      );
  } catch (error) {
    if (error instanceof ApiException && error.requiresReLogin) {
      await clearAuthSession();
      await redirectToAuthPage();
      return;
    }

    chatAlbumImages.value = [];
    showToast(
      error instanceof ApiException
        ? error.message
        : "聊天相册加载失败，请稍后重试"
    );
  } finally {
    isLoadingChatAlbum.value = false;
  }
}

async function loadAgentVoiceModel() {
  if (!agentId.value) {
    voiceModelCenter.value = null;
    return;
  }

  isLoadingVoiceModel.value = true;

  try {
    voiceModelCenter.value = await getAgentVoiceModelCenter(agentId.value);
  } catch (error) {
    if (error instanceof ApiException && error.requiresReLogin) {
      await clearAuthSession();
      await redirectToAuthPage();
      return;
    }

    voiceModelCenter.value = null;
  } finally {
    isLoadingVoiceModel.value = false;
  }
}

function resolveImageMessageUrl(image?: ConversationImagePayload) {
  const directUrl = image?.url?.trim();
  if (directUrl) {
    return directUrl;
  }

  const objectKey = image?.objectKey?.trim();
  if (!objectKey || !ApiConfig.mediaBaseUrl) {
    return "";
  }

  const encodedKey = objectKey
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");

  return `${ApiConfig.mediaBaseUrl}/${encodedKey}`;
}

function handleProfileTap() {
  void openAgentProfile();
}

async function openAgentProfile() {
  if (!agentId.value) {
    showToast("缺少联系人资料，请返回通讯录重新进入");
    return;
  }

  const targetPage =
    agent.value?.accessRole === "shared"
      ? "/pages/agent-profile-detail/index"
      : isAgentProfileEmpty(agent.value)
    ? "/pages/agent-profile/index"
    : "/pages/agent-profile-detail/index";

  await Taro.navigateTo({
    url: `${targetPage}?agentId=${encodeURIComponent(
      agentId.value
    )}&agentName=${encodeURIComponent(agent.value?.name?.trim() || "")}`,
  });
}

async function handleOpenAgentForm() {
  if (agent.value?.accessRole === "shared") {
    return;
  }

  if (!agentId.value) {
    showToast("缺少联系人资料，请返回通讯录重新进入");
    return;
  }

  await Taro.navigateTo({
    url: buildAgentFormUrl(),
  });
}

function buildAgentFormUrl() {
  const createdAt = agent.value?.createdAt ?? fallbackCreatedAt.value;
  const query = [
    ["agentId", agentId.value],
    ["agentName", displayName.value],
    ["agentAvatar", displayAvatar.value],
    ["agentSex", String(displaySex.value)],
    [
      "agentCallMe",
      agent.value?.agentCallMe.trim() || fallbackAgentCallMe.value.trim(),
    ],
    [
      "iCallAgent",
      agent.value?.iCallAgent.trim() || fallbackICallAgent.value.trim(),
    ],
    ["preview", profileDescription.value],
    ["createdAt", createdAt?.toISOString() ?? ""],
  ]
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join("&");

  return `/pages/agent-form/index?${query}`;
}

async function handleSendMessage() {
  if (!agentId.value) {
    showToast("缺少联系人资料，请返回通讯录重新进入");
    return;
  }

  const resolvedConversationId = await resolveConversationId();
  if (!resolvedConversationId) {
    showToast("缺少会话信息，请返回通讯录重新进入");
    return;
  }

  const createdAt = agent.value?.createdAt ?? fallbackCreatedAt.value;
  const query = [
    ["conversationId", resolvedConversationId],
    ["agentId", agentId.value],
    ["agentName", displayName.value],
    ["agentAvatar", displayAvatar.value],
    ["agentSex", String(displaySex.value)],
    [
      "agentCallMe",
      agent.value?.agentCallMe.trim() || fallbackAgentCallMe.value.trim(),
    ],
    [
      "iCallAgent",
      agent.value?.iCallAgent.trim() || fallbackICallAgent.value.trim(),
    ],
    ["preview", profileDescription.value],
    ["createdAt", createdAt?.toISOString() ?? ""],
  ]
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join("&");

  void Taro.navigateTo({
    url: `/pages/chat/index?${query}`,
  });
}

async function resolveConversationId() {
  if (conversationId.value) {
    return conversationId.value;
  }

  if (!agentId.value) {
    return "";
  }

  try {
    const conversations = await getConversations();
    const matchedConversation = conversations.find((conversation) => {
      return conversation.agentId === agentId.value;
    });
    conversationId.value = matchedConversation?.id ?? "";
  } catch (error) {
    if (error instanceof ApiException && error.requiresReLogin) {
      await clearAuthSession();
      await redirectToAuthPage();
    }
  }

  return conversationId.value;
}
async function handleVoiceModelTap() {
  if (!agentId.value) {
    showToast("缺少联系人资料，请返回通讯录重新进入");
    return;
  }

  if (isLoadingVoiceModel.value) {
    showToast("声音模型加载中");
    return;
  }

  if (!voiceModelCenter.value) {
    await loadAgentVoiceModel();
  }

  const center = voiceModelCenter.value;

  if (!center) {
    showToast("声音模型暂时没有加载成功");
    return;
  }

  if (!center.items.length) {
    const result = await Taro.showModal({
      title: "还没有训练好的音色",
      content: "先完成一次声音训练，再回来为这个天之灵选择音色。",
      confirmText: "去训练",
      cancelText: "取消",
      confirmColor: "#28755b",
    });
    if (result.confirm) {
      void Taro.navigateTo({
        url: `/pages/voice-package/index?agentId=${encodeURIComponent(
          agentId.value
        )}`,
      });
    }
    return;
  }

  voiceModelPopupVisible.value = true;
}

function voiceTimbreSelectionLabel(timbreId: string) {
  const center = voiceModelCenter.value;
  if (!center || center.selectedTimbreId !== timbreId) {
    return "选择这个音色";
  }
  return center.selectionStatus === "active"
    ? "聊天中使用"
    : "待声音版会员生效";
}

async function handleVoiceTimbreSelect(item: UserVoiceTimbreRecordDTO) {
  const center = voiceModelCenter.value;
  if (!center || isSelectingVoiceTimbre.value) return;
  if (center.selectedTimbreId === item.id) {
    showToast(voiceTimbreSelectionLabel(item.id));
    return;
  }

  let replaceExisting = false;
  if (center.selectedTimbreId && center.selectedTimbreId !== item.id) {
    const result = await Taro.showModal({
      title: "更换声音模型？",
      content: `确认让“${displayName.value}”改用“${item.name}”吗？`,
      confirmText: "确认更换",
      cancelText: "取消",
      confirmColor: "#28755b",
    });
    if (!result.confirm) return;
    replaceExisting = true;
  }

  isSelectingVoiceTimbre.value = true;
  selectingVoiceTimbreId.value = item.id;
  try {
    const updated = await selectAgentVoiceTimbre(agentId.value, {
      timbreId: item.id,
      replaceExisting,
    });
    voiceModelCenter.value = updated;
    if (agent.value) {
      agent.value = {
        ...agent.value,
        voiceTimbreId: updated.activeTimbreId ?? "",
      };
    }
    voiceModelPopupVisible.value = false;
    showToast(
      updated.selectionStatus === "active"
        ? "声音模型已用于聊天"
        : "已选择，开通声音版会员后生效"
    );
  } catch (error) {
    showToast(
      error instanceof ApiException ? error.message : "选择失败，请稍后重试"
    );
  } finally {
    isSelectingVoiceTimbre.value = false;
    selectingVoiceTimbreId.value = "";
  }
}

function openVoiceMembership() {
  voiceModelPopupVisible.value = false;
  void Taro.navigateTo({
    url: "/pages/vip-center/index?planGroup=voice",
  });
}

function handleChatAlbumTap() {
  if (isLoadingChatAlbum.value) {
    showToast("聊天相册加载中");
    return;
  }

  if (!conversationId.value && !agentId.value) {
    showToast("缺少会话信息，请返回通讯录重新进入");
    return;
  }

  const query = [
    ["conversationId", conversationId.value],
    ["agentId", agentId.value],
  ]
    .filter(([, value]) => value)
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join("&");

  void Taro.navigateTo({
    url: `/pages/chat-album/index?${query}`,
  });
}
</script>

<style lang="scss">
.agent-detail-page {
  min-height: 100vh;
}

.agent-detail-state {
  min-height: calc(100vh - 96px);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 32px;
  text-align: center;
}

.agent-detail-state__dot {
  width: 14px;
  height: 14px;
  border-radius: 999px;
  background: $tzl-gradient-primary;
  box-shadow: $tzl-shadow-primary-sm;
}

.agent-detail-state__title {
  color: #111111;
  font-size: 16px;
  line-height: 24px;
  font-weight: 600;
}

.agent-detail-state__text {
  color: #8a8f98;
  font-size: 14px;
  line-height: 20px;
}

.agent-detail-state__button {
  margin-top: 8px;
  padding: 8px 18px;
  border-radius: 12px;
  color: #ffffff;
  font-size: 14px;
  line-height: 20px;
  background: #111111;
}

.agent-detail {
  min-height: 100%;
  padding-bottom: 28px;
  background: #ededed;
}

.agent-detail-header {
  display: flex;
  align-items: center;
  gap: 16px;
  height: 128px;
  box-sizing: border-box;
  padding: 20px 16px 22px;
  background: #ffffff;
}

.agent-detail-header__avatar-wrap {
  flex-shrink: 0;
  width: 64px;
  height: 64px;
}

.agent-detail-header__avatar {
  width: 64px;
  height: 64px;
  border-radius: 6px;
  background: #eef2f7;
}

.agent-detail-header__avatar--fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  color: #ffffff;
  font-size: 26px;
  line-height: 34px;
  font-weight: 700;
}

.agent-detail-header__avatar--male {
  background: linear-gradient(135deg, #b6dbff 0%, #5d8fff 100%);
}

.agent-detail-header__avatar--female {
  background: linear-gradient(135deg, #ffd9e5 0%, #ff8daa 100%);
}

.agent-detail-header__meta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 8px;
}

.agent-detail-header__name-row {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}

.agent-detail-header__name {
  max-width: 190px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #000000;
  font-size: 22px;
  line-height: 30px;
  font-weight: 600;
}

.agent-detail-header__sub {
  display: -webkit-box;
  max-height: 42px;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  color: #999999;
  font-size: 14px;
  line-height: 21px;
  font-weight: 400;
}

.agent-detail-header__tools {
  flex-shrink: 0;
  width: 19px;
  display: flex;
  align-items: center;
  justify-content: flex-end;
}

.agent-detail-header__tool {
  position: relative;
  width: 18px;
  height: 18px;
  color: #9a9ca3;
}

.agent-detail-header__tool--edit::before {
  content: "";
  position: absolute;
  right: 2px;
  top: 4px;
  width: 8px;
  height: 8px;
  border-top: 1.8px solid currentColor;
  border-right: 1.8px solid currentColor;
  transform: rotate(45deg);
}

.agent-detail-spacer {
  height: 8px;
}

.agent-detail-list,
.agent-detail-actions {
  background: #ffffff;
}

.agent-detail-list__item {
  position: relative;
  min-height: 60px;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 0 16px;
  background: #ffffff;
}

.agent-detail-list__item:active,
.agent-detail-action-button:active {
  background: #f5f5f5;
}

.agent-detail-list__item::after {
  content: "";
  position: absolute;
  left: 16px;
  right: 0;
  bottom: 0;
  height: 1px;
  transform: scaleY(0.5);
  transform-origin: bottom;
  background: #e5e5e5;
}

.agent-detail-list__item--profile {
  min-height: 66px;
}

.agent-detail-list__item--voice {
  min-height: 66px;
}

.agent-detail-list__item--album {
  min-height: 74px;
}

.agent-detail-list__content {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.agent-detail-list__title {
  color: #0a0a0a;
  font-size: 16px;
  line-height: 22px;
  font-weight: 400;
}

.agent-detail-list__title-row {
  display: flex;
  align-items: center;
  gap: 7px;
}

.agent-detail-list__guide-dot {
  width: 9px;
  height: 9px;
  flex: 0 0 9px;
  box-sizing: border-box;
  border: 1px solid #ffffff;
  border-radius: 50%;
  background: #fa5151;
}

.agent-detail-list__desc {
  max-width: 300px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #999999;
  font-size: 13px;
  line-height: 18px;
}

.agent-detail-list__right {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 4px;
}

.agent-detail-list__value {
  color: #999999;
  font-size: 14px;
  line-height: 20px;
}

.agent-detail-list__arrow {
  flex-shrink: 0;
  width: 10px;
  height: 10px;
  border-top: 1.6px solid #b6b6b6;
  border-right: 1.6px solid #b6b6b6;
  transform: rotate(45deg);
}

.agent-detail-album__main {
  min-width: 0;
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.agent-detail-album__right {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 10px;
}

.agent-detail-album__thumbs {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 4px;
}

.agent-detail-album__thumb {
  width: 44px;
  height: 44px;
  border-radius: 4px;
  overflow: hidden;
  background: #f2f3f5;
}

.agent-detail-album__thumb-image {
  width: 100%;
  height: 100%;
}

.agent-detail-actions {
  display: flex;
  flex-direction: column;
}

.agent-detail-action-button {
  position: relative;
  height: 54px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background: #ffffff;
}

.agent-detail-action-button__text {
  color: #07c160;
  font-size: 16px;
  line-height: 24px;
  font-weight: 500;
}

.agent-detail-voice-model-popup {
  overflow: hidden;
  background: transparent;
}

.agent-detail-voice-model-popup__content {
  overflow: hidden;
  border-radius: 12px 12px 0 0;
  background: #ffffff;
}

.agent-detail-voice-model-popup__header {
  min-height: 76px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 18px 10px;
}

.agent-detail-voice-model-popup__header > view:first-child {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.agent-detail-voice-model-popup__title {
  color: #24222a;
  font-size: 18px;
  line-height: 25px;
  font-weight: 600;
}

.agent-detail-voice-model-popup__subtitle {
  color: #8b8790;
  font-size: 12px;
  line-height: 18px;
}

.agent-detail-voice-model-popup__close {
  width: 34px;
  height: 34px;
  flex: 0 0 34px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.agent-detail-voice-model-popup__notice {
  margin: 0 18px 8px;
  padding: 10px 12px;
  border-left: 3px solid #28755b;
  background: #f1f7f4;
  color: #4f625b;
  font-size: 12px;
  line-height: 18px;
}

.agent-detail-voice-model-list {
  max-height: 320px;
  overflow-y: auto;
  padding: 0 18px;
}

.agent-detail-voice-model-item {
  min-height: 66px;
  display: flex;
  align-items: center;
  gap: 11px;
  border-bottom: 1px solid #eceaec;
}

.agent-detail-voice-model-item--selected {
  background: #fbfdfc;
}

.agent-detail-voice-model-item__icon {
  width: 38px;
  height: 38px;
  flex: 0 0 38px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 7px;
  background: #77728f;
}

.agent-detail-voice-model-item__main {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.agent-detail-voice-model-item__name {
  overflow: hidden;
  color: #2f2c34;
  font-size: 14px;
  line-height: 20px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.agent-detail-voice-model-item__meta {
  color: #8b8790;
  font-size: 12px;
  line-height: 18px;
}

.agent-detail-voice-model-popup__action {
  padding: 14px 18px calc(12px + env(safe-area-inset-bottom));
}

.agent-detail-voice-model-popup__button {
  height: 46px;
}

.agent-detail-voice-model-popup__button .nut-button__text {
  color: #ffffff;
  font-size: 16px;
  font-weight: 600;
}
</style>
