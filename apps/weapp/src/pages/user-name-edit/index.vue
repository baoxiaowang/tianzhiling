<template>
  <page-scaffold
    class="user-name-edit-page"
    background="#f5f5f5"
    body-padding="0"
    :safe-area-top="false"
  >
    <template #header>
      <app-bar
        title="设置名字"
        background="#ffffff"
        border-color="#f0f0f0"
        :show-capsule="false"
      >
        <template #left>
          <view class="user-name-edit-nav__cancel" @tap="handleCancel">取消</view>
        </template>
      </app-bar>
    </template>

    <view class="user-name-edit-form">
      <view class="user-name-edit-input-wrap">
        <input
          class="user-name-edit-input"
          :value="name"
          :focus="inputFocused"
          maxlength="20"
          type="nickname"
          confirm-type="done"
          @input="handleNameInput"
          @confirm="handleSubmit"
        />
        <view
          v-if="name"
          class="user-name-edit-clear"
          @tap="handleClear"
        >
          ×
        </view>
      </view>
    </view>

    <template #bottom>
      <view class="user-name-edit-bottom">
        <view
          class="user-name-edit-bottom__submit"
          :class="{ 'user-name-edit-bottom__submit--enabled': canSubmit }"
          @tap="handleSubmit"
        >
          {{ isSubmitting ? '提交中' : '完成' }}
        </view>
      </view>
    </template>
  </page-scaffold>
</template>

<script lang="ts">
export default {
  name: 'UserNameEditPage',
}
</script>

<script setup lang="ts">
import Taro, { useDidShow } from '@tarojs/taro'
import { computed, ref } from 'vue'
import { ApiException } from '../../api/api-exception'
import { updateDisplayName } from '../../auth/api'
import { authSession, clearAuthSession } from '../../auth/session'
import AppBar from '../../components/app-bar/app-bar.vue'
import PageScaffold from '../../components/page-scaffold/page-scaffold.vue'
import { ensureAuthenticatedSession, redirectToAuthPage } from '../../utils/auth-guard'

const name = ref('')
const initialName = ref('')
const inputFocused = ref(false)
const isSubmitting = ref(false)

const trimmedName = computed(() => name.value.trim())
const canSubmit = computed(() => {
  return (
    !isSubmitting.value &&
    trimmedName.value.length > 0 &&
    trimmedName.value.length <= 20 &&
    trimmedName.value !== initialName.value
  )
})

function showToast(title: string) {
  void Taro.showToast({
    title,
    icon: 'none',
    duration: 1800,
  })
}

async function redirectToAuth(message?: string) {
  await clearAuthSession()

  if (message) {
    showToast(message)
    await new Promise((resolve) => setTimeout(resolve, 500))
  }

  await redirectToAuthPage()
}

function syncInitialName() {
  const currentName = authSession.value?.user.name ?? ''
  name.value = currentName
  initialName.value = currentName.trim()
}

function requestInputFocus() {
  inputFocused.value = false
  setTimeout(() => {
    inputFocused.value = true
  }, 120)
}

function handleNameInput(event: { detail?: { value?: string } }) {
  name.value = event.detail?.value ?? ''
}

async function handleCancel() {
  await Taro.navigateBack()
}

function handleClear() {
  name.value = ''
  requestInputFocus()
}

async function handleSubmit() {
  if (!canSubmit.value) {
    if (!trimmedName.value) {
      showToast('请输入昵称')
    } else if (trimmedName.value.length > 20) {
      showToast('昵称最多 20 个字符')
    }
    return
  }

  isSubmitting.value = true

  try {
    await updateDisplayName(trimmedName.value)
    await Taro.navigateBack()
  } catch (error) {
    if (error instanceof ApiException && error.requiresReLogin) {
      await redirectToAuth(error.message)
      return
    }

    showToast(
      error instanceof ApiException
        ? error.message
        : '昵称修改失败，请稍后重试',
    )
  } finally {
    isSubmitting.value = false
  }
}

useDidShow(() => {
  void ensureAuthenticatedSession().then((authenticated) => {
    if (!authenticated || !authSession.value) {
      void redirectToAuth()
      return
    }

    syncInitialName()
    requestInputFocus()
  })
})
</script>

<style lang="scss">
.user-name-edit-page {
  min-height: 100vh;
}

.user-name-edit-nav__cancel {
  padding: 10px 0;
  font-size: 16px;
  line-height: 24px;
  color: #333333;
}

.user-name-edit-form {
  padding-top: 10px;
}

.user-name-edit-input-wrap {
  box-sizing: border-box;
  min-height: 54px;
  padding: 0 16px;
  display: flex;
  align-items: center;
  gap: 10px;
  background: #ffffff;
}

.user-name-edit-input {
  min-width: 0;
  flex: 1;
  height: 54px;
  color: #333333;
  font-size: 16px;
  line-height: 24px;
  font-weight: 500;
}

.user-name-edit-clear {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  background: #c6c6c6;
  color: #ffffff;
  font-size: 16px;
  line-height: 18px;
}

.user-name-edit-bottom {
  box-sizing: border-box;
  padding: 10px 16px;
  background: #ffffff;
  border-top: 0.5px solid #f0f0f0;
}

.user-name-edit-bottom__submit {
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  background: #e8e8e8;
  color: #b8b8b8;
  font-size: 16px;
  line-height: 24px;
  font-weight: 600;
}

.user-name-edit-bottom__submit--enabled {
  background: #07c160;
  color: #ffffff;
}
</style>
