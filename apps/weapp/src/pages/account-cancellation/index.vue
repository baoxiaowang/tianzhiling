<template>
  <page-scaffold
    class="account-cancellation-page"
    background="#f7f7f7"
    body-padding="0"
    :scroll="true"
    :safe-area-top="false"
  >
    <template #header>
      <app-bar title="注销账号" background="#ffffff" border-color="#eeeeee" />
    </template>

    <view v-if="isLoading" class="cancellation-state">
      <view class="cancellation-state__spinner" />
      <text class="cancellation-state__text">正在检查账号状态...</text>
    </view>

    <view v-else-if="loadError" class="cancellation-state">
      <text class="cancellation-state__title">暂时无法检查账号</text>
      <text class="cancellation-state__text">{{ loadError }}</text>
      <nut-button type="primary" shape="round" @click="loadCancellationCheck">
        重新检查
      </nut-button>
    </view>

    <view v-else-if="cancellationCheck" class="cancellation-content">
      <view class="cancellation-warning">
        <view class="cancellation-warning__icon">!</view>
        <view class="cancellation-warning__copy">
          <text class="cancellation-warning__title">注销后无法恢复</text>
          <text class="cancellation-warning__desc">
            请先确认下面这些内容，再决定是否继续。
          </text>
        </view>
      </view>

      <view class="cancellation-section">
        <text class="cancellation-section__title">注销会发生什么</text>
        <view
          v-for="(item, index) in cancellationCheck.consequences"
          :key="item"
          class="cancellation-consequence"
        >
          <view class="cancellation-consequence__index">{{ index + 1 }}</view>
          <text class="cancellation-consequence__text">{{ item }}</text>
        </view>
      </view>

      <view v-if="cancellationCheck.blockers.length" class="cancellation-section">
        <view class="cancellation-section__heading">
          <text class="cancellation-section__title">暂时不能注销</text>
          <text class="cancellation-section__status">需要先处理</text>
        </view>
        <view
          v-for="blocker in cancellationCheck.blockers"
          :key="blocker.code"
          class="cancellation-blocker"
        >
          <view class="cancellation-blocker__copy">
            <text class="cancellation-blocker__title">
              {{ blocker.title }}（{{ blocker.count }}）
            </text>
            <text class="cancellation-blocker__desc">{{ blocker.description }}</text>
          </view>
          <view
            v-if="blocker.actionText && blocker.actionPath"
            class="cancellation-blocker__action"
            @tap="handleBlockerAction(blocker)"
          >
            {{ blocker.actionText }}
          </view>
        </view>
        <view class="cancellation-recheck" @tap="loadCancellationCheck">
          我已处理，重新检查
        </view>
      </view>

      <view v-else class="cancellation-section cancellation-section--confirm">
        <text class="cancellation-section__title">最后确认</text>
        <nut-checkbox
          v-model="hasAcknowledged"
          class="cancellation-checkbox"
          shape="round"
          text-position="right"
        >
          我已了解注销后数据和权益无法恢复
        </nut-checkbox>

        <text class="cancellation-confirm-label">
          输入“{{ cancellationCheck.confirmationText }}”
        </text>
        <nut-input
          v-model="confirmation"
          class="cancellation-confirm-input"
          :placeholder="`请输入${cancellationCheck.confirmationText}`"
          :maxlength="10"
          clearable
        />
      </view>

      <view class="cancellation-retention">
        <text class="cancellation-retention__title">关于必要记录</text>
        <text class="cancellation-retention__text">
          为履行支付、退款、审计及争议处理义务，必要的订单凭证会在法定期限内限制保存，不再用于推荐、营销或{{ brand.name }}服务。
        </text>
      </view>

      <view v-if="cancellationCheck.eligible" class="cancellation-actions">
        <nut-button
          block
          type="danger"
          shape="round"
          :disabled="!canSubmit"
          :loading="isSubmitting"
          @click="handleSubmit"
        >
          {{ isSubmitting ? '正在注销...' : '确认注销账号' }}
        </nut-button>
        <text class="cancellation-actions__hint">
          注销后当前设备及其他设备都会退出登录
        </text>
      </view>
    </view>
  </page-scaffold>
</template>

<script lang="ts">
export default {
  name: 'AccountCancellationPage',
}
</script>

<script setup lang="ts">
import Taro, { useDidShow } from '@tarojs/taro'
import { computed, ref } from 'vue'
import { ApiException } from '../../api/api-exception'
import { brand } from '../../config/brand'
import {
  cancelCurrentUser,
  checkAccountCancellation,
  type AccountCancellationBlocker,
  type AccountCancellationCheck,
} from '../../auth/api'
import { clearAuthSession } from '../../auth/session'
import AppBar from '../../components/app-bar/app-bar.vue'
import PageScaffold from '../../components/page-scaffold/page-scaffold.vue'
import {
  ensureAuthenticatedSession,
  redirectToAuthPage,
} from '../../utils/auth-guard'

const isLoading = ref(true)
const isSubmitting = ref(false)
const loadError = ref('')
const cancellationCheck = ref<AccountCancellationCheck | null>(null)
const hasAcknowledged = ref(false)
const confirmation = ref('')

const canSubmit = computed(() => {
  return Boolean(
    cancellationCheck.value?.eligible &&
      hasAcknowledged.value &&
      confirmation.value.trim() === cancellationCheck.value.confirmationText &&
      !isSubmitting.value,
  )
})

function showToast(title: string, duration = 1800) {
  void Taro.showToast({ title, icon: 'none', duration })
}

async function loadCancellationCheck() {
  if (isSubmitting.value) {
    return
  }

  isLoading.value = true
  loadError.value = ''

  try {
    const authenticated = await ensureAuthenticatedSession()
    if (!authenticated) {
      await redirectToAuthPage()
      return
    }

    cancellationCheck.value = await checkAccountCancellation()
  } catch (error) {
    if (error instanceof ApiException && error.requiresReLogin) {
      await redirectToAuthPage()
      return
    }

    loadError.value =
      error instanceof ApiException
        ? error.message
        : '网络连接不稳定，请稍后重试'
  } finally {
    isLoading.value = false
  }
}

async function handleBlockerAction(blocker: AccountCancellationBlocker) {
  if (!blocker.actionPath) {
    return
  }

  await Taro.navigateTo({ url: blocker.actionPath })
}

async function handleSubmit() {
  if (!canSubmit.value || !cancellationCheck.value) {
    return
  }

  const result = await Taro.showModal({
    title: '确认注销账号？',
    content:
      `注销会永久删除${brand.name}、聊天、记忆和声音数据，并终止会员权益。这个操作无法撤销。`,
    confirmText: '确认注销',
    cancelText: '再想想',
    confirmColor: '#c84b4b',
  })

  if (!result.confirm) {
    return
  }

  isSubmitting.value = true

  try {
    const loginResult = await Taro.login()
    if (!loginResult.code) {
      throw new ApiException('微信身份验证失败，请稍后重试')
    }

    const cancellation = await cancelCurrentUser(
      loginResult.code,
      confirmation.value.trim(),
    )
    await clearAuthSession()
    showToast(
      cancellation.cleanupStatus === 'completed'
        ? '账号已注销'
        : '账号已注销，剩余数据将继续清理',
      2200,
    )
    await new Promise((resolve) => setTimeout(resolve, 900))
    await Taro.reLaunch({ url: '/pages/index/index' })
  } catch (error) {
    if (
      error instanceof ApiException &&
      error.code === 'ACCOUNT_CANCELLATION_BLOCKED'
    ) {
      showToast(error.message)
      await loadCancellationCheck()
      return
    }

    if (error instanceof ApiException && error.requiresReLogin) {
      await clearAuthSession()
      await redirectToAuthPage()
      return
    }

    showToast(
      error instanceof ApiException
        ? error.message
        : '注销失败，请稍后重试',
    )
  } finally {
    isSubmitting.value = false
  }
}

useDidShow(() => {
  void loadCancellationCheck()
})
</script>

<style lang="scss">
.account-cancellation-page {
  min-height: 100vh;
}

.cancellation-state {
  min-height: 560px;
  padding: 0 34px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  text-align: center;
}

.cancellation-state__spinner {
  width: 24px;
  height: 24px;
  border: 2px solid #e5e5e5;
  border-top-color: #6f8f83;
  border-radius: 999px;
  animation: cancellation-spin 0.8s linear infinite;
}

.cancellation-state__title {
  font-size: 18px;
  line-height: 26px;
  font-weight: 600;
  color: #2d2d2d;
}

.cancellation-state__text {
  font-size: 14px;
  line-height: 22px;
  color: #8a8a8a;
}

.cancellation-content {
  padding-bottom: calc(32px + env(safe-area-inset-bottom));
}

.cancellation-warning {
  padding: 22px 20px;
  display: flex;
  align-items: center;
  gap: 14px;
  background: #fff7f5;
  border-bottom: 1px solid #f0e4e1;
}

.cancellation-warning__icon {
  flex-shrink: 0;
  width: 38px;
  height: 38px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: #c95a4e;
  color: #ffffff;
  font-size: 22px;
  line-height: 38px;
  font-weight: 700;
}

.cancellation-warning__copy {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.cancellation-warning__title {
  font-size: 18px;
  line-height: 26px;
  font-weight: 700;
  color: #2f2b2a;
}

.cancellation-warning__desc {
  font-size: 14px;
  line-height: 21px;
  color: #806f6a;
}

.cancellation-section {
  margin-top: 10px;
  padding: 20px 18px;
  background: #ffffff;
}

.cancellation-section__heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.cancellation-section__title {
  font-size: 17px;
  line-height: 25px;
  font-weight: 650;
  color: #2f2f2f;
}

.cancellation-section__status {
  flex-shrink: 0;
  font-size: 13px;
  line-height: 20px;
  color: #b14f45;
}

.cancellation-consequence {
  margin-top: 16px;
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.cancellation-consequence__index {
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: #f1f4f2;
  color: #557269;
  font-size: 12px;
  line-height: 22px;
  font-weight: 600;
}

.cancellation-consequence__text {
  flex: 1;
  min-width: 0;
  font-size: 15px;
  line-height: 23px;
  color: #555555;
}

.cancellation-blocker {
  margin-top: 14px;
  padding: 16px;
  border: 1px solid #eadedb;
  border-radius: 8px;
  background: #fffafa;
}

.cancellation-blocker__copy {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.cancellation-blocker__title {
  font-size: 15px;
  line-height: 23px;
  font-weight: 600;
  color: #3b3635;
}

.cancellation-blocker__desc {
  font-size: 13px;
  line-height: 21px;
  color: #7b716f;
}

.cancellation-blocker__action {
  margin-top: 13px;
  font-size: 14px;
  line-height: 22px;
  font-weight: 600;
  color: #477f70;
}

.cancellation-recheck {
  margin-top: 18px;
  text-align: center;
  font-size: 14px;
  line-height: 22px;
  color: #477f70;
}

.cancellation-section--confirm {
  display: flex;
  flex-direction: column;
}

.cancellation-checkbox {
  margin-top: 18px;
  font-size: 14px;
  line-height: 22px;
  color: #4c4c4c;
}

.cancellation-confirm-label {
  margin-top: 22px;
  margin-bottom: 8px;
  font-size: 14px;
  line-height: 22px;
  color: #555555;
}

.cancellation-confirm-input {
  --nut-input-background-color: #f7f7f7;
  --nut-input-border-bottom: 0;
  border: 1px solid #e3e3e3;
  border-radius: 6px;
  background: #f7f7f7;
}

.cancellation-retention {
  padding: 18px 20px 4px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.cancellation-retention__title {
  font-size: 13px;
  line-height: 20px;
  font-weight: 600;
  color: #777777;
}

.cancellation-retention__text {
  font-size: 12px;
  line-height: 20px;
  color: #999999;
}

.cancellation-actions {
  padding: 24px 18px 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.cancellation-actions__hint {
  text-align: center;
  font-size: 12px;
  line-height: 20px;
  color: #999999;
}

@keyframes cancellation-spin {
  from {
    transform: rotate(0deg);
  }

  to {
    transform: rotate(360deg);
  }
}
</style>
