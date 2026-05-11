<template>
  <page-scaffold
    class="vip-center-page"
    background="#ffffff"
    body-padding="0"
    :scroll="true"
    :safe-area-top="false"
  >
    <template #header>
      <app-bar title="会员中心" background="#ffffff" />
    </template>

    <view v-if="isCheckingAuth || isLoading" class="vip-center-state">
      <view class="vip-center-state__dot" />
      <text class="vip-center-state__text">
        {{ isCheckingAuth ? '正在恢复会话...' : '正在加载会员信息...' }}
      </text>
    </view>

    <view v-else-if="loadError" class="vip-center-state">
      <text class="vip-center-state__title">会员信息加载失败</text>
      <text class="vip-center-state__text">{{ loadError }}</text>
      <view class="vip-center-state__button" @tap="handleRetry">重试</view>
    </view>

    <vip-member-view
      v-else-if="center?.isVip"
      :plan-name="activePlanName"
      :period-text="membershipPeriodText"
      :benefits-image-url="vipBenefitsImageUrl"
      :thanks-lines="specialThanksLines"
    />

    <vip-purchase-view
      v-else
      :plans="center?.plans ?? []"
      :selected-plan="selectedPlan"
      :selected-plan-id="selectedPlanId"
      :is-paying="isPaying"
      :benefits-image-url="vipBenefitsImageUrl"
      @select-plan="handlePlanSelect"
      @purchase="handlePurchaseTap"
      @open-agreement="handleAgreementTap"
    />
  </page-scaffold>
</template>

<script lang="ts">
export default {
  name: 'VipCenterPage',
}
</script>

<script setup lang="ts">
import Taro, { useLoad } from '@tarojs/taro'
import { computed, ref } from 'vue'
import { ApiException } from '../../api/api-exception'
import {
  getMembershipCenter,
  type MembershipCenter,
  type VipPlan,
} from '../../apis/membership'
import { createVipPlanOrder } from '../../apis/order'
import { clearAuthSession } from '../../auth/session'
import AppBar from '../../components/app-bar/app-bar.vue'
import PageScaffold from '../../components/page-scaffold/page-scaffold.vue'
import type { AgreementDocumentType } from '../../legal/agreement-documents'
import { openAgreementDocument } from '../../utils/agreement-nav'
import { ensureAuthenticatedSession, redirectToAuthPage } from '../../utils/auth-guard'
import VipMemberView from './components/vip-member-view.vue'
import VipPurchaseView from './components/vip-purchase-view.vue'

const center = ref<MembershipCenter | null>(null)
const selectedPlanId = ref('')
const isCheckingAuth = ref(true)
const isLoading = ref(false)
const isPaying = ref(false)
const loadError = ref('')
const vipBenefitsImageUrl = 'https://oss.soullink.top/weapp/vip-diff.png'
const specialThanksLines = [
  '每一个生命都有独特的故事，',
  '每一份记忆都值得被珍藏。',
  '"天之灵" 定制服务，',
  '用专业与用心，',
  '为您打造最真实的数字亲人。',
  '感谢您的选择，',
  '让我们共同守护这份珍贵的回忆。',
]

const selectedPlan = computed(() => {
  return center.value?.plans.find((plan) => plan.id === selectedPlanId.value)
})
const activeMembership = computed(() => center.value?.membership)
const activePlan = computed(() => {
  const membership = activeMembership.value

  if (!membership) {
    return undefined
  }

  return membership.plan ?? center.value?.plans.find((plan) => plan.id === membership.vipPlanId)
})
const activePlanName = computed(() => {
  return activePlan.value?.name || activeMembership.value?.vipPlanCode || 'VIP会员'
})
const membershipPeriodText = computed(() => {
  const membership = activeMembership.value

  if (!membership) {
    return '会员权益已生效'
  }

  if (membership.lifetime) {
    return `永久有效 · ${formatDate(membership.startedAt)}开通`
  }

  if (membership.expiredAt) {
    return `有效期至 ${formatDate(membership.expiredAt)}`
  }

  return `自 ${formatDate(membership.startedAt)} 起生效`
})

useLoad(() => {
  void preparePage()
})

async function preparePage() {
  isCheckingAuth.value = true
  const authenticated = await ensureAuthenticatedSession()

  if (!authenticated) {
    await redirectToAuthPage()
    return
  }

  isCheckingAuth.value = false
  await loadMembershipCenter()
}

async function loadMembershipCenter() {
  isLoading.value = true
  loadError.value = ''

  try {
    const data = await getMembershipCenter()
    center.value = data
    selectedPlanId.value = getDefaultSelectedPlan(data.plans)?.id ?? ''
  } catch (error) {
    if (error instanceof ApiException && error.requiresReLogin) {
      await clearAuthSession()
      await redirectToAuthPage()
      return
    }

    loadError.value =
      error instanceof ApiException
        ? error.message
        : '会员信息加载失败，请稍后重试'
  } finally {
    isLoading.value = false
  }
}

function handleRetry() {
  void loadMembershipCenter()
}

function handlePlanSelect(planId: string) {
  selectedPlanId.value = planId
}

function getDefaultSelectedPlan(plans: VipPlan[]) {
  return plans.find(isFeaturedVipPlan) ?? plans[0]
}

function handleAgreementTap(type: AgreementDocumentType) {
  void openAgreementDocument(type)
}

async function handlePurchaseTap() {
  if (!selectedPlan.value) {
    showToast('暂无可购买的会员套餐')
    return
  }

  if (isPaying.value) {
    return
  }

  isPaying.value = true

  try {
    const loginResult = await Taro.login()
    const jsCode = loginResult.code?.trim()

    if (!jsCode) {
      showToast('微信登录凭证获取失败，请稍后重试')
      return
    }

    await Taro.showLoading({
      title: '正在拉起支付',
      mask: true,
    })

    const result = await createVipPlanOrder({
      vipPlanId: selectedPlan.value.id,
      jsCode,
    })

    await Taro.requestPayment(result.payment)
    void Taro.hideLoading()

    try {
      await Taro.redirectTo({
        url: `/pages/payment-result/index?orderId=${encodeURIComponent(
          result.order.id,
        )}`,
      })
    } catch {
      showToast('支付已完成，结果页打开失败，请稍后查看会员状态')
      void loadMembershipCenter()
    }
  } catch (error) {
    if (isPaymentCancel(error)) {
      showToast('支付已取消')
      return
    }

    const message =
      error instanceof Error && error.message
        ? error.message
        : '支付失败，请稍后重试'

    showToast(message)
  } finally {
    void Taro.hideLoading()
    isPaying.value = false
  }
}

function isPaymentCancel(error: unknown) {
  const errMsg =
    error && typeof error === 'object' && 'errMsg' in error
      ? String(error.errMsg)
      : ''

  return /cancel|取消/.test(errMsg)
}

function showToast(title: string) {
  void Taro.showToast({
    title,
    icon: 'none',
    duration: 1800,
  })
}

function isFeaturedVipPlan(plan: VipPlan) {
  return /声音|三年|3年|更多/.test(plan.name)
}

function formatDate(value: Date | null) {
  if (!value) {
    return ''
  }

  const year = value.getFullYear()
  const month = `${value.getMonth() + 1}`.padStart(2, '0')
  const day = `${value.getDate()}`.padStart(2, '0')

  return `${year}.${month}.${day}`
}
</script>

<style lang="scss">
.vip-center-page {
  min-height: 100vh;
}

.vip-center-state {
  min-height: calc(100vh - 96px);
  padding: 32px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  text-align: center;
}

.vip-center-state__dot {
  width: 14px;
  height: 14px;
  border-radius: 999px;
  background: linear-gradient(135deg, #fce8cc 0%, #ecb872 100%);
}

.vip-center-state__title {
  color: #111111;
  font-size: 16px;
  line-height: 24px;
  font-weight: 600;
}

.vip-center-state__text {
  color: #8a8f98;
  font-size: 14px;
  line-height: 20px;
}

.vip-center-state__button {
  margin-top: 8px;
  padding: 8px 18px;
  border-radius: 12px;
  color: #ffffff;
  font-size: 14px;
  line-height: 20px;
  background: #111111;
}
</style>
