<template>
  <page-scaffold
    class="agent-profile-detail-page"
    background="#ededed"
    header-background="#ededed"
    bottom-background="#ffffff"
    body-padding="0"
    :scroll="true"
    :show-scrollbar="false"
    :safe-area-top="false"
    :safe-area-bottom="true"
  >
    <template #header>
      <app-bar title="亲友资料" background="#ededed" border-color="#ededed" />
    </template>

    <view v-if="isCheckingAuth || isLoading" class="profile-detail-state">
      <view class="profile-detail-state__dot" />
      <text class="profile-detail-state__text">
        {{ isCheckingAuth ? "正在恢复会话..." : "正在打开资料..." }}
      </text>
    </view>

    <view v-else-if="loadError" class="profile-detail-state">
      <text class="profile-detail-state__title">资料暂时没有打开</text>
      <text class="profile-detail-state__text">{{ loadError }}</text>
      <view class="profile-detail-state__button" @tap="handleRetry">重试</view>
    </view>

    <view v-else-if="agent" class="profile-detail">
      <view class="profile-detail-person">
        <image
          v-if="agent.avatar"
          class="profile-detail-person__avatar"
          :src="agent.avatar"
          mode="aspectFill"
        />
        <view
          v-else
          class="profile-detail-person__avatar profile-detail-person__fallback"
        >
          {{ avatarFallback }}
        </view>

        <view class="profile-detail-person__info">
          <text class="profile-detail-person__name">{{
            profileDisplayName
          }}</text>
          <text v-if="lifespanText" class="profile-detail-person__dates">
            {{ lifespanText }}
          </text>
        </view>

        <view
          v-if="agent.accessRole === 'owner'"
          class="profile-detail-person__share"
          @tap="handleOpenShareSheet"
        >
          <Scan2 size="22" color="#646464" />
        </view>
      </view>

      <view class="profile-detail-spacer" />

      <view class="profile-detail-album" @tap="handleChatAlbumTap">
        <view class="profile-detail-album__head">
          <text class="profile-detail-album__title">珍贵回忆</text>
          <view class="profile-detail-album__meta">
            <text class="profile-detail-album__count">{{
              chatAlbumValue
            }}</text>
            <ArrowRight size="16" color="#b6b6b6" />
          </view>
        </view>

        <view
          v-if="chatAlbumPreviewImages.length"
          class="profile-detail-album__grid"
        >
          <view
            v-for="(imageUrl, index) in chatAlbumPreviewImages"
            :key="imageUrl"
            class="profile-detail-album__photo"
          >
            <image
              class="profile-detail-album__image"
              :src="imageUrl"
              mode="aspectFill"
            />
            <text
              v-if="index === 2 && chatAlbumExtraCount > 0"
              class="profile-detail-album__extra"
            >
              +{{ chatAlbumExtraCount }}
            </text>
          </view>
        </view>

        <view v-else class="profile-detail-album__empty">
          <view class="profile-detail-album__empty-icon">
            <Photograph size="22" color="#aaaaaa" />
          </view>
          <text class="profile-detail-album__empty-text">
            聊天里的图片会自动收录到这里
          </text>
        </view>
      </view>

      <view class="profile-detail-spacer" />

      <view v-if="hasMemories" class="profile-detail-memory">
        <view
          v-for="section in visibleSections"
          :key="section.field"
          class="profile-detail-memory__section"
        >
          <view class="profile-detail-memory__section-head">
            <text class="profile-detail-memory__label">{{
              section.label
            }}</text>
            <view
              class="profile-detail-memory__edit"
              @tap.stop="handleEditSection"
            >
              <text class="profile-detail-memory__edit-text">修改</text>
              <ArrowRight size="16" color="#b6b6b6" />
            </view>
          </view>
          <text
            class="profile-detail-memory__text"
            :class="{
              'profile-detail-memory__text--collapsed':
                isMemorySectionCollapsible(section) &&
                !isMemoryExpanded(section.field),
            }"
          >
            {{ section.text }}
          </text>
          <text
            v-if="isMemorySectionCollapsible(section)"
            class="profile-detail-memory__more"
            @tap="toggleMemorySection(section.field)"
          >
            {{ isMemoryExpanded(section.field) ? "收起" : "展开全部" }}
          </text>
        </view>
      </view>

      <view v-else class="profile-detail-empty">
        <image
          class="profile-detail-empty__image"
          :src="messengerImageUrl"
          mode="aspectFit"
        />
        <text class="profile-detail-empty__title">还没有整理好的资料</text>
        <text class="profile-detail-empty__desc">
          讲一段关于{{ personPronoun }}的故事，就可以从这里开始。
        </text>
      </view>
    </view>

    <template #bottom>
      <view
        v-if="agent && agent.accessRole === 'owner'"
        class="profile-detail-actions"
      >
        <view class="profile-detail-actions__primary" @tap="handleContinue">
          {{ hasMemories ? "继续讲述" : "开始讲述" }}
        </view>
      </view>
    </template>

    <nut-popup
      v-model:visible="shareSheetVisible"
      class="profile-detail-share-popup"
      position="bottom"
      round
      :overlay-style="shareSheetOverlayStyle"
    >
      <view class="profile-detail-share-sheet">
        <view class="profile-detail-share-sheet__handle" />
        <text class="profile-detail-share-sheet__title">{{
          shareSheetTitle
        }}</text>
        <text class="profile-detail-share-sheet__desc">{{ shareDesc }}</text>

        <view class="profile-detail-share-card">
          <image
            v-if="agent?.avatar"
            class="profile-detail-share-card__avatar"
            :src="agent.avatar"
            mode="aspectFill"
          />
          <view
            v-else
            class="profile-detail-share-card__avatar profile-detail-share-card__fallback"
          >
            {{ avatarFallback }}
          </view>
          <view class="profile-detail-share-card__info">
            <text class="profile-detail-share-card__name">{{
              shareCardName
            }}</text>
            <text v-if="lifespanText" class="profile-detail-share-card__dates">
              {{ lifespanText }}
            </text>
          </view>
          <ShareN size="22" color="#07c160" />
        </view>

        <button
          class="profile-detail-share-sheet__button profile-detail-share-sheet__button--primary"
          open-type="share"
          :disabled="isCreatingShareInvite || !shareInviteToken"
        >
          {{ isCreatingShareInvite ? "正在准备分享..." : "立即分享" }}
        </button>
        <button
          class="profile-detail-share-sheet__button profile-detail-share-sheet__button--qrcode"
          :disabled="isCreatingShareInvite || isCreatingShareQRCode"
          @tap="handleSaveShareQRCode"
        >
          {{ isCreatingShareQRCode ? "正在生成二维码..." : "保存邀请二维码" }}
        </button>
        <view
          class="profile-detail-share-sheet__button profile-detail-share-sheet__button--secondary"
          @tap="closeShareSheet"
        >
          取消
        </view>
      </view>
    </nut-popup>
  </page-scaffold>
</template>

<script lang="ts">
export default {
  name: "AgentProfileDetailPage",
};
</script>

<script setup lang="ts">
import Taro, {
  useDidShow,
  useLoad,
  useShareAppMessage,
} from "@tarojs/taro";
import { ArrowRight, Photograph, Scan2, ShareN } from "@nutui/icons-vue-taro";
import { computed, ref } from "vue";
import { ApiConfig } from "../../api/api-config";
import { brand } from "../../config/brand";
import { ApiException } from "../../api/api-exception";
import {
  createAgentShareQRCode,
  createAgentShareInvite,
  getAgentDetail,
  markAgentGuideSeen,
  type AgentSummary,
} from "../../apis/agent";
import {
  getConversationMessages,
  getConversations,
  type ConversationImagePayload,
} from "../../apis/conversation";
import messengerImageUrl from "../../assets/images/agent-create/header-mark.png";
import { clearAuthSession } from "../../auth/session";
import AppBar from "../../components/app-bar/app-bar.vue";
import PageScaffold from "../../components/page-scaffold/page-scaffold.vue";
import {
  ensureAuthenticatedSession,
  redirectToAuthPage,
} from "../../utils/auth-guard";
import { prewarmAgentProfileInitialGreeting } from "../../utils/agent-profile-messenger-prewarm";

type ProfileField =
  | "personalityTraits"
  | "lifeExperience"
  | "hobbies"
  | "languageHabits"
  | "sharedMemories";

type ProfileSection = {
  field: ProfileField;
  label: string;
  text: string;
};

const sectionConfigs: Array<{
  field: ProfileField;
  label: (pronoun: string) => string;
}> = [
  { field: "personalityTraits", label: (pronoun) => `${pronoun}是怎样的人` },
  { field: "lifeExperience", label: () => "重要经历" },
  { field: "hobbies", label: () => "喜欢和习惯" },
  { field: "languageHabits", label: () => "熟悉的话" },
  { field: "sharedMemories", label: () => "你们的回忆" },
];

const agentId = ref("");
const source = ref("");
const conversationId = ref("");
const agent = ref<AgentSummary | null>(null);
const isCheckingAuth = ref(true);
const isLoading = ref(false);
const isLoadingChatAlbum = ref(false);
const loadError = ref("");
const hasLoaded = ref(false);
const chatAlbumImages = ref<string[]>([]);
const expandedMemoryFields = ref<ProfileField[]>([]);
const shareSheetVisible = ref(false);
const shareInviteToken = ref("");
const isCreatingShareInvite = ref(false);
const isCreatingShareQRCode = ref(false);
const shareSheetOverlayStyle = {
  backgroundColor: "rgba(0, 0, 0, 0.38)",
};

const personPronoun = computed(() => (agent.value?.sex === 1 ? "他" : "她"));
const profileDisplayName = computed(() => {
  const realName = agent.value?.realName?.trim();
  if (realName) {
    return realName;
  }

  return agent.value?.name?.trim() || "未命名亲友";
});
const avatarFallback = computed(
  () => profileDisplayName.value.trim().slice(0, 1) || "亲"
);
const lifespanText = computed(() => {
  const birthday = formatYearMonth(agent.value?.birthday ?? null);
  const deathDate = formatYearMonth(agent.value?.deathDate ?? null);

  if (birthday && deathDate) {
    return `${birthday}-${deathDate}`;
  }

  if (birthday) {
    return `生于${birthday}`;
  }

  if (deathDate) {
    return `离开于${deathDate}`;
  }

  return "";
});
const visibleSections = computed<ProfileSection[]>(() => {
  const detail = agent.value;
  if (!detail) {
    return [];
  }

  return sectionConfigs
    .map((section) => ({
      field: section.field,
      label: section.label(personPronoun.value),
      text: detail[section.field].trim(),
    }))
    .filter((section) => Boolean(section.text));
});
const hasMemories = computed(() => visibleSections.value.length > 0);
const chatAlbumPreviewImages = computed(() => chatAlbumImages.value.slice(0, 3));
const chatAlbumExtraCount = computed(() =>
  Math.max(0, chatAlbumImages.value.length - chatAlbumPreviewImages.value.length)
);
const chatAlbumValue = computed(() => {
  if (isLoadingChatAlbum.value) {
    return "加载中";
  }

  return chatAlbumImages.value.length ? `${chatAlbumImages.value.length}张` : "暂无";
});
const shareSheetTitle = computed(() => "邀请亲友一起纪念他");
const shareDesc = computed(
  () => "你们会遇见同一个他，也会保留各自只属于你们的对话。"
);
const shareSubjectName = computed(() => {
  return (
    agent.value?.iCallAgent?.trim() ||
    agent.value?.name?.trim() ||
    agent.value?.realName?.trim() ||
    "他"
  );
});
const shareMessageTitle = computed(
  () =>
    `我在${brand.name}留住了关于${shareSubjectName.value}的回忆，想邀请你一起看看。`
);
const shareCardName = computed(() => `${shareSubjectName.value}的${brand.name}`);
const sharePath = computed(() => {
  const token = shareInviteToken.value.trim();
  const query = [["token", token]]
    .filter(([, value]) => value)
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join("&");

  return query ? `/pages/agent-share/index?${query}` : "/pages/index/index";
});

useLoad((options) => {
  agentId.value = decodeRouteParam(options?.agentId);
  source.value = decodeRouteParam(options?.source);
  conversationId.value = decodeRouteParam(options?.conversationId);
  hideShareMenu();
  void preparePage();
});

useDidShow(() => {
  syncShareMenuVisibility();

  if (hasLoaded.value && agentId.value) {
    void loadAgentDetail();
    void loadChatAlbum();
  }
});

useShareAppMessage(() => {
  const imageUrl = agent.value?.avatar?.trim();

  return {
    title: shareMessageTitle.value,
    path: sharePath.value,
    ...(imageUrl ? { imageUrl } : {}),
  };
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

function showShareMenu() {
  void Taro.showShareMenu({
    showShareItems: ["shareAppMessage"],
  }).catch(() => undefined);
}

function hideShareMenu() {
  void Taro.hideShareMenu().catch(() => undefined);
}

function syncShareMenuVisibility() {
  if (agent.value?.accessRole === "owner" && shareInviteToken.value) {
    showShareMenu();
    return;
  }

  hideShareMenu();
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
  await Promise.all([loadAgentDetail(), loadChatAlbum()]);
  hasLoaded.value = true;
}

async function loadAgentDetail() {
  if (!agentId.value) {
    loadError.value = "缺少联系人资料，请返回后重新进入";
    return;
  }

  isLoading.value = true;
  loadError.value = "";

  try {
    const detail = await getAgentDetail(agentId.value);
    agent.value = detail;
    void prewarmAgentProfileInitialGreeting(detail);
    if (detail.accessRole === "owner") {
      void prepareShareInvite({ silent: true });
    } else {
      hideShareMenu();
    }
    void markAgentGuideSeen(agentId.value, "agent-profile").catch(
      () => undefined
    );
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

async function loadChatAlbum() {
  if (!conversationId.value) {
    await resolveConversationId();
  }

  if (!conversationId.value) {
    chatAlbumImages.value = [];
    return;
  }

  isLoadingChatAlbum.value = true;

  try {
    const messages = await getConversationMessages(conversationId.value);
    chatAlbumImages.value = messages
      .filter((message) => message.type === "image" && message.role !== "system")
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
  } finally {
    isLoadingChatAlbum.value = false;
  }
}

async function resolveConversationId() {
  if (conversationId.value || !agentId.value) {
    return conversationId.value;
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

function handleRetry() {
  void loadAgentDetail();
  void loadChatAlbum();
}

async function handleContinue() {
  if (source.value === "interview") {
    await Taro.navigateBack({ delta: 1 });
    return;
  }

  await Taro.navigateTo({
    url: `/pages/agent-profile/index?agentId=${encodeURIComponent(
      agentId.value
    )}&agentName=${encodeURIComponent(profileDisplayName.value)}`,
  });
}

function handleEditSection() {
  void handleContinue();
}

function handleOpenShareSheet() {
  if (agent.value?.accessRole !== "owner") {
    showToast("只有创建者可以邀请亲友");
    return;
  }

  shareSheetVisible.value = true;
  void prepareShareInvite();
}

async function handleSaveShareQRCode() {
  if (isCreatingShareQRCode.value) {
    return;
  }

  if (!shareInviteToken.value) {
    await prepareShareInvite();
  }

  const token = shareInviteToken.value.trim();

  if (!token) {
    return;
  }

  isCreatingShareQRCode.value = true;

  try {
    const result = await createAgentShareQRCode(token);
    const filePath = `${Taro.env.USER_DATA_PATH}/agent-share-${Date.now()}.png`;
    await writeBase64File(filePath, result.imageBase64);
    await Taro.saveImageToPhotosAlbum({ filePath });
    await Taro.showToast({
      title: "二维码已保存",
      icon: "success",
      duration: 1600,
    });
  } catch (error) {
    if (error instanceof ApiException && error.requiresReLogin) {
      await clearAuthSession();
      await redirectToAuthPage();
      return;
    }

    showToast(
      error instanceof ApiException
        ? error.message
        : "二维码保存失败，请稍后重试"
    );
  } finally {
    isCreatingShareQRCode.value = false;
  }
}

function writeBase64File(filePath: string, data: string) {
  return new Promise<void>((resolve, reject) => {
    Taro.getFileSystemManager().writeFile({
      filePath,
      data,
      encoding: "base64",
      success: () => resolve(),
      fail: (error) => reject(error),
    });
  });
}

function closeShareSheet() {
  shareSheetVisible.value = false;
}

async function prepareShareInvite(
  options: {
    silent?: boolean;
  } = {}
) {
  if (shareInviteToken.value || isCreatingShareInvite.value) {
    return;
  }

  if (!agentId.value) {
    if (!options.silent) {
      showToast("缺少联系人资料，请返回后重新进入");
    }
    return;
  }

  isCreatingShareInvite.value = true;

  try {
    const invite = await createAgentShareInvite(agentId.value);
    shareInviteToken.value = invite.token;
    showShareMenu();
  } catch (error) {
    if (error instanceof ApiException && error.requiresReLogin) {
      await clearAuthSession();
      await redirectToAuthPage();
      return;
    }

    if (!options.silent) {
      showToast(
        error instanceof ApiException
          ? error.message
          : "分享信息生成失败，请稍后重试"
      );
    }
  } finally {
    isCreatingShareInvite.value = false;
  }
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

function isMemorySectionCollapsible(section: ProfileSection) {
  return section.text.length > 72 || section.text.includes("\n");
}

function isMemoryExpanded(field: ProfileField) {
  return expandedMemoryFields.value.includes(field);
}

function toggleMemorySection(field: ProfileField) {
  expandedMemoryFields.value = isMemoryExpanded(field)
    ? expandedMemoryFields.value.filter((item) => item !== field)
    : [...expandedMemoryFields.value, field];
}

function formatYearMonth(value: Date | null) {
  if (!value) {
    return "";
  }

  const year = value.getFullYear();
  const month = value.getMonth() + 1;

  if (!year || Number.isNaN(year) || Number.isNaN(month)) {
    return "";
  }

  return `${year}年${month}月`;
}
</script>

<style lang="scss">
.agent-profile-detail-page {
  min-height: 100vh;
}

.profile-detail-state {
  min-height: 100%;
  padding: 48px 32px 96px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  text-align: center;
  background: #ededed;
}

.profile-detail-state__dot {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #07c160;
  box-shadow: 0 0 14px rgba(7, 193, 96, 0.24);
}

.profile-detail-state__title {
  color: #111111;
  font-size: 18px;
  line-height: 26px;
  font-weight: 600;
}

.profile-detail-state__text {
  color: #8c8c8c;
  font-size: 14px;
  line-height: 22px;
}

.profile-detail-state__button {
  height: 42px;
  min-width: 108px;
  margin-top: 6px;
  padding: 0 20px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #ffffff;
  background: #07c160;
  font-size: 14px;
}

.profile-detail {
  min-height: 100%;
  padding-bottom: 12px;
  background: #ededed;
}

.profile-detail-person {
  min-height: 112px;
  padding: 18px 16px;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 14px;
  background: #ffffff;
}

.profile-detail-person__avatar {
  flex: 0 0 60px;
  width: 60px;
  height: 60px;
  border-radius: 6px;
  background: #eeeeee;
}

.profile-detail-person__fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  color: #ffffff;
  background: linear-gradient(135deg, #f5c4ce 0%, #b36a77 100%);
  font-size: 25px;
  line-height: 32px;
  font-weight: 600;
}

.profile-detail-person__info {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
}

.profile-detail-person__name {
  color: #0a0a0a;
  font-size: 22px;
  line-height: 30px;
  font-weight: 600;
}

.profile-detail-person__dates {
  margin-top: 5px;
  color: #8b8b8b;
  font-size: 14px;
  line-height: 20px;
}

.profile-detail-person__share {
  flex: 0 0 38px;
  width: 38px;
  height: 38px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f6f6f6;
}

.profile-detail-spacer {
  height: 8px;
}

.profile-detail-album {
  padding: 17px 16px 16px;
  background: #ffffff;
}

.profile-detail-album__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.profile-detail-album__title {
  color: #0a0a0a;
  font-size: 17px;
  line-height: 25px;
  font-weight: 500;
}

.profile-detail-album__meta {
  display: flex;
  align-items: center;
  gap: 6px;
}

.profile-detail-album__count {
  color: #8c8c8c;
  font-size: 13px;
  line-height: 22px;
}

.profile-detail-album__grid {
  margin-top: 12px;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
}

.profile-detail-album__photo {
  position: relative;
  width: 100%;
  aspect-ratio: 1.42 / 1;
  overflow: hidden;
  border-radius: 4px;
  background: #eeeeee;
}

.profile-detail-album__image {
  width: 100%;
  height: 100%;
}

.profile-detail-album__extra {
  position: absolute;
  right: 6px;
  bottom: 5px;
  height: 20px;
  padding: 0 7px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  color: #ffffff;
  background: rgba(0, 0, 0, 0.36);
  font-size: 12px;
  line-height: 18px;
}

.profile-detail-album__empty {
  margin-top: 12px;
  height: 74px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background: #f7f7f7;
}

.profile-detail-album__empty-icon {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #eeeeee;
}

.profile-detail-album__empty-text {
  color: #999999;
  font-size: 13px;
  line-height: 20px;
}

.profile-detail-memory {
  background: #ffffff;
}

.profile-detail-memory__section {
  position: relative;
  padding: 16px 16px 17px;
}

.profile-detail-memory__section::after {
  content: "";
  position: absolute;
  left: 16px;
  right: 0;
  bottom: 0;
  height: 1px;
  transform: scaleY(0.5);
  transform-origin: bottom;
  background: #e6e6e6;
}

.profile-detail-memory__section:last-child::after {
  display: none;
}

.profile-detail-memory__section-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.profile-detail-memory__label {
  min-width: 0;
  flex: 1;
  color: #111111;
  font-size: 16px;
  line-height: 23px;
  font-weight: 500;
}

.profile-detail-memory__edit {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 6px;
}

.profile-detail-memory__edit-text {
  color: #8c8c8c;
  font-size: 13px;
  line-height: 22px;
}

.profile-detail-memory__text {
  display: block;
  margin-top: 7px;
  color: #666666;
  font-size: 14px;
  line-height: 22px;
  white-space: pre-wrap;
  word-break: break-word;
}

.profile-detail-memory__text--collapsed {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.profile-detail-memory__more {
  display: block;
  margin-top: 9px;
  color: #576b95;
  font-size: 14px;
  line-height: 22px;
}

.profile-detail-empty {
  min-height: 280px;
  padding: 42px 28px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  background: #ffffff;
}

.profile-detail-empty__image {
  width: 80px;
  height: 80px;
}

.profile-detail-empty__title {
  margin-top: 14px;
  color: #111111;
  font-size: 18px;
  line-height: 26px;
  font-weight: 600;
}

.profile-detail-empty__desc {
  max-width: 280px;
  margin-top: 7px;
  color: #8c8c8c;
  font-size: 14px;
  line-height: 22px;
}

.profile-detail-actions {
  padding: 10px 16px 8px;
  border-top: 1px solid #e6e6e6;
  background: #ffffff;
}

.profile-detail-actions__primary {
  height: 46px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #ffffff;
  background: #07c160;
  font-size: 16px;
  line-height: 24px;
  font-weight: 500;
}

.profile-detail-share-popup {
  overflow: hidden;
}

.profile-detail-share-sheet {
  padding: 18px 20px calc(18px + env(safe-area-inset-bottom));
  background: #ffffff;
}

.profile-detail-share-sheet__handle {
  width: 36px;
  height: 4px;
  margin: 0 auto 16px;
  border-radius: 2px;
  background: #d8d8d8;
}

.profile-detail-share-sheet__title {
  color: #0a0a0a;
  font-size: 18px;
  line-height: 26px;
  text-align: center;
  font-weight: 600;
}

.profile-detail-share-sheet__desc {
  max-width: 296px;
  margin: 5px auto 0;
  color: #8c8c8c;
  font-size: 13px;
  line-height: 20px;
  text-align: center;
}

.profile-detail-share-card {
  margin: 18px 0 16px;
  padding: 14px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  gap: 12px;
  background: #f7f7f7;
}

.profile-detail-share-card__avatar {
  flex: 0 0 44px;
  width: 44px;
  height: 44px;
  border-radius: 6px;
  background: #eeeeee;
}

.profile-detail-share-card__fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  color: #ffffff;
  background: linear-gradient(135deg, #f5c4ce 0%, #b36a77 100%);
  font-size: 20px;
  line-height: 28px;
  font-weight: 600;
}

.profile-detail-share-card__info {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
}

.profile-detail-share-card__name {
  color: #111111;
  font-size: 16px;
  line-height: 23px;
  font-weight: 500;
}

.profile-detail-share-card__dates {
  margin-top: 2px;
  color: #8c8c8c;
  font-size: 12px;
  line-height: 18px;
}

.profile-detail-share-sheet__button {
  width: 100%;
  height: 44px;
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 15px;
  line-height: 22px;
}

.profile-detail-share-sheet__button::after {
  border: 0;
}

.profile-detail-share-sheet__button--primary {
  color: #ffffff;
  background: #07c160;
}

.profile-detail-share-sheet__button--primary[disabled] {
  color: rgba(255, 255, 255, 0.82);
  background: #8fdcb2;
}

.profile-detail-share-sheet__button--qrcode {
  margin-top: 10px;
  color: #13795b;
  background: #e8f5f0;
}

.profile-detail-share-sheet__button--qrcode[disabled] {
  color: #8ca79e;
  background: #eef3f1;
}

.profile-detail-share-sheet__button--secondary {
  margin-top: 10px;
  color: #111111;
  background: #f1f1f1;
}
</style>
