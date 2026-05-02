<template>
  <page-scaffold
    class="user-settings-page"
    background="#f7f7f7"
    body-padding="0"
    :safe-area-top="false"
  >
    <template #header>
      <app-bar title="个人资料" background="#ffffff" border-color="#f0f0f0" />
    </template>

    <view v-if="isCheckingAuth || isRedirecting" class="user-settings-state">
      <view class="user-settings-state__dot" />
      <text class="user-settings-state__text">
        {{ isRedirecting ? '正在前往登录页...' : '正在恢复个人资料...' }}
      </text>
    </view>

    <scroll-view v-else scroll-y class="user-settings-scroll">
      <view class="user-settings-list">
        <view class="user-settings-tile user-settings-tile--avatar" @tap="handleAvatarTap">
          <text class="user-settings-tile__title">头像</text>
          <view class="user-settings-tile__right">
            <view class="user-settings-avatar">
              <image
                v-if="avatarUrl"
                class="user-settings-avatar__image"
                :src="avatarUrl"
                mode="aspectFill"
              />
              <view v-else class="user-settings-avatar__image user-settings-avatar__image--fallback">
                {{ avatarFallback }}
              </view>
              <view v-if="isUpdatingAvatar" class="user-settings-avatar__loading">
                <view class="user-settings-avatar__spinner" />
              </view>
            </view>
            <view class="user-settings-tile__arrow" />
          </view>
        </view>

        <view class="user-settings-tile" @tap="handleNameTap">
          <text class="user-settings-tile__title">名字</text>
          <view class="user-settings-tile__right">
            <text class="user-settings-tile__value">{{ displayName }}</text>
            <view class="user-settings-tile__arrow" />
          </view>
        </view>

        <view class="user-settings-tile">
          <text class="user-settings-tile__title">性别</text>
          <view class="user-settings-tile__right">
            <text class="user-settings-tile__value">男</text>
            <view class="user-settings-tile__arrow" />
          </view>
        </view>

        <view class="user-settings-tile">
          <text class="user-settings-tile__title">地区</text>
          <view class="user-settings-tile__right">
            <text class="user-settings-tile__value">中国大陆</text>
            <view class="user-settings-tile__arrow" />
          </view>
        </view>

        <view class="user-settings-tile">
          <text class="user-settings-tile__title">手机号</text>
          <view class="user-settings-tile__right">
            <text class="user-settings-tile__value">{{ maskedPhone }}</text>
            <view class="user-settings-tile__arrow" />
          </view>
        </view>

        <view class="user-settings-logout" @tap="handleLogout">
          {{ isLoggingOut ? '退出中...' : '退出登录' }}
        </view>
      </view>
    </scroll-view>
  </page-scaffold>
</template>

<script lang="ts">
export default {
  name: 'UserSettingsPage',
}
</script>

<script setup lang="ts">
import Taro, { useDidShow } from '@tarojs/taro'
import { computed, ref } from 'vue'
import { ApiException } from '../../api/api-exception'
import { uploadLocalImage } from '../../apis/storage'
import { getCurrentUser, logout, updateAvatar } from '../../auth/api'
import { authSession, clearAuthSession } from '../../auth/session'
import AppBar from '../../components/app-bar/app-bar.vue'
import PageScaffold from '../../components/page-scaffold/page-scaffold.vue'
import {
  ensureAuthenticatedSession,
  redirectToAuthPage,
  redirectToIndexPage,
} from '../../utils/auth-guard'

const isCheckingAuth = ref(true)
const isRedirecting = ref(false)
const isLoggingOut = ref(false)
const isUpdatingAvatar = ref(false)

const session = computed(() => authSession.value)
const user = computed(() => session.value?.user ?? null)
const displayName = computed(() => {
  const name = user.value?.name.trim()
  return name ? name : '放学别走'
})
const avatarUrl = computed(() => user.value?.avatar.trim() ?? '')
const avatarFallback = computed(() => displayName.value.slice(0, 1))
const maskedPhone = computed(() => maskPhone(user.value?.phone ?? ''))

function showToast(title: string) {
  void Taro.showToast({
    title,
    icon: 'none',
    duration: 1800,
  })
}

function isUserCanceled(error: unknown) {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'errMsg' in error &&
      String(error.errMsg).toLowerCase().includes('cancel'),
  )
}

function maskPhone(phone: string) {
  if (phone.length < 7) {
    return phone
  }

  return `${phone.slice(0, 3)}******${phone.slice(-2)}`
}

async function editAvatarImage(filePath: string) {
  const result = await Taro.editImage({
    src: filePath,
  })

  return result.tempFilePath
}

async function redirectToAuth(message?: string) {
  await clearAuthSession()

  if (message) {
    showToast(message)
    await new Promise((resolve) => setTimeout(resolve, 500))
  }

  isRedirecting.value = true
  await redirectToAuthPage()
}

async function handleAvatarTap() {
  if (isUpdatingAvatar.value) {
    return
  }

  try {
    const result = await Taro.chooseImage({
      count: 1,
      sizeType: ['compressed'],
      sourceType: ['album'],
    })

    const filePath = result.tempFilePaths[0]
    if (!filePath) {
      return
    }

    const editedFilePath = await editAvatarImage(filePath)
    if (!editedFilePath) {
      return
    }

    isUpdatingAvatar.value = true

    const upload = await uploadLocalImage(editedFilePath, {
      folder: 'avatars',
      fileName: `avatar_${Date.now()}.jpg`,
    })

    await updateAvatar(upload.objectKey)
    showToast('头像已更新')
  } catch (error) {
    if (isUserCanceled(error)) {
      return
    }

    if (error instanceof ApiException && error.requiresReLogin) {
      await redirectToAuth(error.message)
      return
    }

    showToast(
      error instanceof ApiException
        ? error.message
        : '头像上传失败，请稍后重试',
    )
  } finally {
    isUpdatingAvatar.value = false
  }
}

async function handleNameTap() {
  await Taro.navigateTo({
    url: '/pages/user-name-edit/index',
  })
}

async function handleLogout() {
  if (isLoggingOut.value) {
    return
  }

  isLoggingOut.value = true

  try {
    await logout()
    await clearAuthSession()
    showToast('已退出登录')
    await redirectToIndexPage()
  } catch (error) {
    if (error instanceof ApiException && error.requiresReLogin) {
      await clearAuthSession()
      showToast('已退出登录')
      await redirectToIndexPage()
      return
    }

    showToast(
      error instanceof ApiException
        ? error.message
        : '退出登录失败，请稍后重试',
    )
  } finally {
    isLoggingOut.value = false
  }
}

async function preparePage() {
  isCheckingAuth.value = true

  const authenticated = await ensureAuthenticatedSession()
  if (!authenticated || !authSession.value) {
    await redirectToAuth()
    return
  }

  isRedirecting.value = false

  try {
    await getCurrentUser()
  } catch (error) {
    if (error instanceof ApiException && error.requiresReLogin) {
      await redirectToAuth(error.message)
      return
    }
  } finally {
    isCheckingAuth.value = false
  }
}

useDidShow(() => {
  void preparePage()
})
</script>

<style lang="scss">
.user-settings-page {
  min-height: 100vh;
}

.user-settings-state {
  min-height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
}

.user-settings-state__dot {
  width: 14px;
  height: 14px;
  border-radius: 999px;
  background: $tzl-gradient-primary;
  box-shadow: $tzl-shadow-primary-sm;
}

.user-settings-state__text {
  font-size: 14px;
  color: $tzl-color-text-muted;
}

.user-settings-scroll {
  height: 100%;
}

.user-settings-list {
  padding-top: 10px;
  padding-bottom: 40px;
}

.user-settings-tile {
  box-sizing: border-box;
  min-height: 56px;
  padding: 0 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  border-bottom: 0.5px solid #f0f0f0;
  background: #ffffff;
}

.user-settings-tile--avatar {
  min-height: 58px;
}

.user-settings-tile__title {
  flex-shrink: 0;
  font-size: 16px;
  line-height: 24px;
  font-weight: 500;
  color: #333333;
}

.user-settings-tile__right {
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
}

.user-settings-tile__value {
  min-width: 0;
  max-width: 210px;
  font-size: 16px;
  line-height: 24px;
  color: #999999;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.user-settings-tile__arrow {
  flex-shrink: 0;
  width: 8px;
  height: 8px;
  margin-right: 3px;
  border-top: 1.5px solid #cfcfcf;
  border-right: 1.5px solid #cfcfcf;
  transform: rotate(45deg);
}

.user-settings-avatar {
  position: relative;
  width: 36px;
  height: 36px;
}

.user-settings-avatar__image {
  width: 36px;
  height: 36px;
  border-radius: 6px;
  background: $tzl-color-surface-subtle;
}

.user-settings-avatar__image--fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  background: $tzl-gradient-warm;
  color: #ffffff;
  font-size: 16px;
  font-weight: 700;
}

.user-settings-avatar__loading {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.6);
}

.user-settings-avatar__spinner {
  width: 16px;
  height: 16px;
  border: 2px solid rgba(255, 255, 255, 0.42);
  border-top-color: #ffffff;
  border-radius: 999px;
  animation: user-settings-spin 0.75s linear infinite;
}

.user-settings-logout {
  height: 56px;
  margin-top: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #ffffff;
  color: #e54848;
  font-size: 16px;
  line-height: 24px;
  font-weight: 600;
}

@keyframes user-settings-spin {
  from {
    transform: rotate(0deg);
  }

  to {
    transform: rotate(360deg);
  }
}
</style>
