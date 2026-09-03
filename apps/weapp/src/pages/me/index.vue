<template>
  <page-scaffold
    class="me-tab-page"
    body-padding="0"
    background="#ededed"
    :scroll="true"
    :safe-area-top="false"
    :safe-area-bottom="false"
    require-auth
  >
    <template #header>
      <app-bar title="我的" background="#ffffff" :show-capsule="false" />
    </template>

    <view v-if="isCheckingAuth" class="loading-state">
      <view class="loading-state__dot" />
      <text class="loading-state__text"> 正在恢复个人中心... </text>
    </view>

    <view v-else-if="session" class="me-page">
      <view class="me-profile" @tap="handleProfileTap">
        <image
          v-if="avatarUrl"
          class="me-profile__avatar"
          :src="avatarUrl"
          mode="aspectFill"
        />
        <view v-else class="me-profile__avatar me-profile__avatar--fallback">
          {{ avatarFallback }}
        </view>

        <view class="me-profile__meta">
          <view class="me-profile__name-row">
            <text class="me-profile__name">{{ displayName }}</text>
            <view v-if="isVipUser" class="me-profile__vip-badge">
              <text>VIP</text>
            </view>
          </view>
          <view class="me-profile__account-row">
            <text class="me-profile__account">ID：{{ displayAccount }}</text>
            <view
              class="me-profile__copy-button"
              hover-class="me-profile__copy-button--hover"
              aria-label="复制ID"
              @tap.stop="handleCopyAccount"
            >
              <view class="me-profile__copy-icon">
                <view class="me-profile__copy-icon-back" />
                <view class="me-profile__copy-icon-front" />
              </view>
            </view>
          </view>
        </view>

        <view class="me-arrow" />
      </view>

      <template v-for="group in menuGroups" :key="group.key">
        <view class="me-page__spacer" />

        <view class="me-menu-section">
          <view
            v-for="(action, index) in group.actions"
            :key="action.key"
            class="me-menu-section__item"
            hover-class="me-menu-section__item--pressed"
            hover-stay-time="80"
            @tap="handleMenuTap(action.key)"
          >
            <view class="me-menu-item">
              <view class="me-menu-item__left">
                <view
                  class="me-menu-item__icon"
                  :class="`me-menu-item__icon--${action.tone}`"
                >
                  <People
                    v-if="action.icon === 'people'"
                    color="#ffffff"
                    size="19"
                  />
                  <StarFill
                    v-else-if="action.icon === 'vip'"
                    color="#ffffff"
                    size="18"
                  />
                  <Voice
                    v-else-if="action.icon === 'voice'"
                    color="#ffffff"
                    size="19"
                  />
                  <Service
                    v-else-if="action.icon === 'service'"
                    color="#ffffff"
                    size="19"
                  />
                  <Photograph
                    v-else-if="action.icon === 'posts'"
                    color="#ffffff"
                    size="18"
                  />
                  <Order
                    v-else-if="action.icon === 'orders'"
                    color="#ffffff"
                    size="19"
                  />
                  <Notice
                    v-else-if="action.icon === 'notice'"
                    color="#ffffff"
                    size="18"
                  />
                  <Checklist v-else color="#ffffff" size="18" />
                </view>
                <text class="me-menu-item__label">{{ action.title }}</text>
              </view>

              <view class="me-menu-item__right">
                <text
                  v-if="action.key === 'vipService'"
                  class="me-menu-item__value"
                >
                  {{ vipServiceText }}
                </text>
                <text
                  v-if="
                    action.key === 'systemMessages' && unreadMessageCountText
                  "
                  class="me-menu-item__badge"
                >
                  {{ unreadMessageCountText }}
                </text>
                <view class="me-arrow" />
              </view>
            </view>
            <view
              v-if="index !== group.actions.length - 1"
              class="me-menu-section__divider"
            />
          </view>
        </view>
      </template>
    </view>
  </page-scaffold>
</template>

<script lang="ts">
export default {
  name: "MeTabPage",
};
</script>

<script setup lang="ts">
import Taro, { useDidShow } from "@tarojs/taro";
import {
  Checklist,
  Notice,
  Order,
  People,
  Photograph,
  Service,
  StarFill,
  Voice,
} from "@nutui/icons-vue-taro";
import { computed, ref } from "vue";
import { preloadConversations } from "../../apis/conversation";
import { getCurrentUser } from "../../auth/api";
import { authSession, restoreAuthSession } from "../../auth/session";
import AppBar from "../../components/app-bar/app-bar.vue";
import PageScaffold from "../../components/page-scaffold/page-scaffold.vue";
import {
  initCommentNotificationPolling,
  unseenPostNotificationCount,
} from "../../post/comment-notification-state";
import { openAgreementDocument } from "../../utils/agreement-nav";
import { syncCustomTabBar } from "../../utils/custom-tab-bar";

type ProfileMenuKey =
  | "contacts"
  | "vipService"
  | "voiceModels"
  | "customerService"
  | "myPosts"
  | "myOrders"
  | "systemMessages"
  | "serviceAgreement";

interface ProfileMenuAction {
  key: ProfileMenuKey;
  title: string;
  icon:
    | "people"
    | "vip"
    | "voice"
    | "service"
    | "posts"
    | "orders"
    | "notice"
    | "agreement";
  tone:
    | "contacts"
    | "vip"
    | "voice"
    | "service"
    | "posts"
    | "orders"
    | "notice"
    | "agreement";
}

interface ProfileMenuGroup {
  key: string;
  actions: readonly ProfileMenuAction[];
}

const menuGroups = [
  {
    key: "contacts",
    actions: [
      {
        key: "contacts",
        title: "我的联系人",
        icon: "people",
        tone: "contacts",
      },
    ],
  },
  {
    key: "membership",
    actions: [
      {
        key: "vipService",
        title: "VIP 服务",
        icon: "vip",
        tone: "vip",
      },
      {
        key: "voiceModels",
        title: "声音模型",
        icon: "voice",
        tone: "voice",
      },
      {
        key: "customerService",
        title: "人工客服",
        icon: "service",
        tone: "service",
      },
    ],
  },
  {
    key: "activity",
    actions: [
      {
        key: "myPosts",
        title: "我的动态",
        icon: "posts",
        tone: "posts",
      },
      {
        key: "myOrders",
        title: "我的订单",
        icon: "orders",
        tone: "orders",
      },
    ],
  },
  {
    key: "system",
    actions: [
      {
        key: "systemMessages",
        title: "系统消息",
        icon: "notice",
        tone: "notice",
      },
      {
        key: "serviceAgreement",
        title: "服务协议",
        icon: "agreement",
        tone: "agreement",
      },
    ],
  },
] as const satisfies readonly ProfileMenuGroup[];

const isCheckingAuth = ref(true);
const hasLoadedProfile = ref(false);

let refreshProfilePromise: Promise<void> | null = null;
let lastProfileRefreshAt = 0;

const PROFILE_REFRESH_INTERVAL = 30 * 1000;

const session = computed(() => authSession.value);
const displayName = computed(() => {
  const name = session.value?.user.name.trim();
  return name ? name : "妮妮";
});
const displayAccount = computed(() => {
  const account = session.value?.user.account.trim();
  return account ? account : "12345678";
});
const avatarUrl = computed(() => session.value?.user.avatar.trim() ?? "");
const avatarFallback = computed(() => displayName.value.slice(0, 1));
const isVipUser = computed(() => Boolean(session.value?.user.isVip));
const vipServiceText = computed(() => {
  return isVipUser.value ? "已开启" : "未开通";
});
const unreadMessageCountText = computed(() => {
  const count = unseenPostNotificationCount.value;

  if (count <= 0) {
    return "";
  }

  return count > 99 ? "99+" : String(count);
});

async function handleMenuTap(key: ProfileMenuKey) {
  if (key === "contacts") {
    await Taro.navigateTo({
      url: "/pages/my-agents/index",
    });
    return;
  }

  if (key === "systemMessages") {
    await Taro.navigateTo({
      url: "/pages/my-messages/index",
    });
    return;
  }

  if (key === "myPosts") {
    await Taro.navigateTo({
      url: "/pages/my-posts/index",
    });
    return;
  }

  if (key === "myOrders") {
    await Taro.navigateTo({
      url: "/pages/my-orders/index",
    });
    return;
  }

  if (key === "vipService") {
    await Taro.navigateTo({
      url: "/pages/vip-center/index",
    });
    return;
  }

  if (key === "voiceModels") {
    await Taro.navigateTo({
      url: "/pages/voice-library/index",
    });
    return;
  }

  if (key === "customerService") {
    await Taro.navigateTo({
      url: "/pages/customer-service/index",
    });
    return;
  }

  if (key === "serviceAgreement") {
    await openAgreementDocument("service");
    return;
  }

}

async function handleProfileTap() {
  await Taro.navigateTo({
    url: "/pages/user-settings/index",
  });
}

async function handleCopyAccount() {
  const account = displayAccount.value.trim();

  if (!account) {
    return;
  }

  try {
    await Taro.setClipboardData({
      data: account,
    });
    await Taro.showToast({
      title: "ID已复制",
      icon: "success",
      duration: 1200,
    });
  } catch {
    await Taro.showToast({
      title: "复制失败，请稍后重试",
      icon: "none",
      duration: 1600,
    });
  }
}

async function refreshProfile() {
  if (refreshProfilePromise) {
    return refreshProfilePromise;
  }

  if (
    lastProfileRefreshAt &&
    Date.now() - lastProfileRefreshAt < PROFILE_REFRESH_INTERVAL
  ) {
    return;
  }

  refreshProfilePromise = getCurrentUser()
    .then(() => {
      lastProfileRefreshAt = Date.now();
    })
    .catch(() => undefined)
    .finally(() => {
      refreshProfilePromise = null;
    });

  return refreshProfilePromise;
}

async function preparePage() {
  if (!hasLoadedProfile.value) {
    isCheckingAuth.value = true;
  }

  await restoreAuthSession();
  hasLoadedProfile.value = true;
  isCheckingAuth.value = false;

  if (authSession.value) {
    preloadConversations();
    initCommentNotificationPolling();
    void refreshProfile();
  }
}

useDidShow(() => {
  syncCustomTabBar("/pages/me/index");
  void preparePage();
});
</script>

<style lang="scss">
.me-tab-page {
  min-height: 100vh;
}

.loading-state {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
}

.loading-state__dot {
  width: 14px;
  height: 14px;
  border-radius: 999px;
  background: $tzl-gradient-primary;
  box-shadow: $tzl-shadow-primary-sm;
}

.loading-state__text {
  font-size: 14px;
  color: $tzl-color-text-muted;
}

.me-page {
  min-height: 100%;
  padding-bottom: 110px;
  background: #ededed;
}

.me-page__spacer {
  height: 8px;
  background: #ededed;
}

.me-profile {
  display: flex;
  align-items: center;
  gap: 16px;
  height: 120px;
  box-sizing: border-box;
  padding: 0 16px 0 18px;
  background: #ffffff;
}

.me-profile__avatar {
  flex-shrink: 0;
  width: 72px;
  height: 72px;
  border-radius: 8px;
  background: $tzl-color-surface-subtle;
}

.me-profile__avatar--fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #ffd9e5 0%, #ff8daa 100%);
  color: #ffffff;
  font-size: 28px;
  font-weight: 700;
}

.me-profile__meta {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 10px;
}

.me-profile__name-row {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}

.me-profile__name {
  min-width: 0;
  flex-shrink: 1;
  font-size: 20px;
  line-height: 29px;
  font-weight: 600;
  color: #000000;
  letter-spacing: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.me-profile__vip-badge {
  flex-shrink: 0;
  height: 17px;
  padding: 0 8px;
  border-radius: 999px;
  background: linear-gradient(135deg, #2c1d12 0%, #8a5728 100%);
  color: #ffe7ba;
  font-size: 10px;
  line-height: 17px;
  font-weight: 800;
}

.me-profile__account-row {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 4px;
}

.me-profile__account {
  min-width: 0;
  flex-shrink: 1;
  font-size: 14px;
  line-height: 22px;
  font-weight: 500;
  color: #999999;
  letter-spacing: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.me-profile__copy-button {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 999px;
}

.me-profile__copy-button--hover {
  background: rgba(0, 0, 0, 0.04);
}

.me-profile__copy-icon {
  position: relative;
  width: 16px;
  height: 16px;
  color: #999999;
}

.me-profile__copy-icon-back,
.me-profile__copy-icon-front {
  position: absolute;
  box-sizing: border-box;
  width: 10px;
  height: 12px;
  border: 1.4px solid currentColor;
  border-radius: 2px;
  background: #ffffff;
}

.me-profile__copy-icon-back {
  top: 1px;
  left: 2px;
  opacity: 0.72;
}

.me-profile__copy-icon-front {
  right: 2px;
  bottom: 1px;
}

.me-menu-section {
  background: #ffffff;
}

.me-menu-section__item {
  background: #ffffff;
}

.me-menu-section__item--pressed {
  background: #f5f5f5;
}

.me-menu-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 56px;
  padding: 0 16px;
  box-sizing: border-box;
}

.me-menu-item__left {
  min-width: 0;
  flex: 1;
  display: flex;
  align-items: center;
  gap: 14px;
}

.me-menu-item__icon {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 5px;
}

.me-menu-item__icon--contacts {
  background: #5b6f95;
}

.me-menu-item__icon--vip {
  background: #e9ad3f;
}

.me-menu-item__icon--voice {
  background: #ed776c;
}

.me-menu-item__icon--service {
  background: #2eaa68;
}

.me-menu-item__icon--posts {
  background: #579ed6;
}

.me-menu-item__icon--orders {
  background: #df963f;
}

.me-menu-item__icon--notice {
  background: #e65b62;
}

.me-menu-item__icon--agreement {
  background: #7b8795;
}

.me-menu-item__label {
  min-width: 0;
  font-size: 16px;
  line-height: 24px;
  font-weight: 400;
  color: #111111;
  letter-spacing: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.me-menu-item__right {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}

.me-menu-item__value {
  font-size: 14px;
  line-height: 22px;
  color: #8c8c8c;
  letter-spacing: 0;
}

.me-menu-item__badge {
  min-width: 18px;
  height: 18px;
  padding: 0 6px;
  box-sizing: border-box;
  border-radius: 999px;
  background: #ff4d4f;
  color: #ffffff;
  font-size: 11px;
  line-height: 18px;
  font-weight: 600;
  text-align: center;
}

.me-menu-section__divider {
  height: 1px;
  margin-left: 58px;
  background: #e5e5e5;
  transform: scaleY(0.5);
  transform-origin: center bottom;
}

.me-arrow {
  flex-shrink: 0;
  width: 9px;
  height: 9px;
  margin-right: 3px;
  border-top: 1.5px solid #cfcfcf;
  border-right: 1.5px solid #cfcfcf;
  transform: rotate(45deg);
}

.me-arrow--muted {
  border-color: #c8c8c8;
}
</style>
