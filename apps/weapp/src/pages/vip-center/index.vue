<template>
  <page-scaffold
    class="vip-center-page"
    :background="pageBackground"
    :bottom-background="pageBackground"
    body-padding="0"
    :scroll="true"
    :safe-area-top="false"
  >
    <template #header>
      <app-bar :title="pageTitle" :background="pageBackground" />
    </template>

    <template #bottom>
      <view v-if="canShowUpgradeAction" class="vip-center-page__upgrade-bar">
        <view
          class="vip-center-page__upgrade-button"
          :class="{ 'vip-center-page__upgrade-button--disabled': isPaying }"
          @tap="handlePurchaseTap"
        >
          {{ isPaying ? '支付处理中...' : upgradeActionText }}
        </view>
      </view>
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
      v-else-if="center?.isVip && activeMembership"
      :membership="activeMembership"
      :plan="activePlan"
      :upgrade-plans="upgradePlans"
      :selected-plan-id="selectedPlanId"
      :server-time="center.serverTime"
      :activity-stats="center.activityStats"
      @select-plan="handlePlanSelect"
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
  getVipPurchaseCenter,
  invalidateVipPurchaseCenterCache,
  type MembershipCenter,
  type VipPlan,
} from '../../apis/membership'
import {
  createVipPlanOrder,
  createVipPlanVirtualPaymentOrder,
} from '../../apis/order'
import { clearAuthSession } from '../../auth/session'
import type { AgreementDocumentType } from '../../legal/agreement-documents'
import { openAgreementDocument } from '../../utils/agreement-nav'
import {
  ensureAuthenticatedSession,
  redirectToAuthPage,
} from '../../utils/auth-guard'
import {
  isWechatPaymentCancel,
  requestWechatVirtualPaymentWithFallback,
  showWechatVirtualPaymentError,
} from '../../utils/virtual-payment'
import VipMemberView from './components/vip-member-view.vue'
import VipPurchaseView from './components/vip-purchase-modern-view.vue'

const center = ref<MembershipCenter | null>(null)
const selectedPlanId = ref('')
const isCheckingAuth = ref(true)
const isLoading = ref(false)
const isPaying = ref(false)
const isAwaitingPaymentResult = ref(false)
const loadError = ref('')
const preferredPlanGroup = ref<'basic' | 'voice'>('basic')
const vipBenefitsImageUrl = 'https://oss.tianzhiling.chat/weapp/vip-diff.png'

const selectedPlan = computed(() => {
  return center.value?.plans.find((plan) => plan.id === selectedPlanId.value)
})
const pageTitle = computed(() =>
  center.value?.isVip ? '会员详情' : '选择会员服务'
)
const pageBackground = computed(() =>
  center.value?.isVip ? '#ffffff' : '#f6f6f6'
)
const activeMembership = computed(() => center.value?.membership)
const activePlan = computed(() => {
  const membership = activeMembership.value

  if (!membership) {
    return undefined
  }

  return (
    membership.plan ??
    center.value?.plans.find((plan) => plan.id === membership.vipPlanId)
  )
})
const upgradePlans = computed(() => {
  const membership = activeMembership.value

  if (!membership) {
    return []
  }

  return getUpgradeablePlans(
    center.value?.plans ?? [],
    membership,
    activePlan.value
  )
})
const canShowUpgradeAction = computed(() => {
  return Boolean(
    center.value?.isVip &&
      activeMembership.value &&
      upgradePlans.value.length &&
      !isCheckingAuth.value &&
      !isLoading.value &&
      !loadError.value &&
      !isAwaitingPaymentResult.value
  )
})
const upgradeActionText = computed(() =>
  selectedPlan.value?.lifetime ? '升级为无限期陪伴' : '立即升级'
)

useLoad((options) => {
  preferredPlanGroup.value = options?.planGroup === 'voice' ? 'voice' : 'basic'
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
    const data = await getVipPurchaseCenter()
    center.value = data
    selectedPlanId.value = data.isVip
      ? getDefaultUpgradePlan(data)?.id ?? ''
      : getDefaultSelectedPlan(data.plans, preferredPlanGroup.value)?.id ?? ''
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

function getDefaultSelectedPlan(
  plans: VipPlan[],
  preferredGroup: 'basic' | 'voice' = 'basic'
) {
  const preferredPlans = plans.filter(
    (plan) => plan.planGroup === preferredGroup
  )

  return (
    preferredPlans.find(isOneYearVipPlan) ??
    preferredPlans[0] ??
    plans.find(isOneYearVipPlan) ??
    plans[0]
  )
}

function getDefaultUpgradePlan(data: MembershipCenter) {
  const membership = data.membership

  if (!membership) {
    return undefined
  }

  const membershipPlan =
    membership.plan ??
    data.plans.find((plan) => plan.id === membership.vipPlanId)
  const plans = getUpgradeablePlans(data.plans, membership, membershipPlan)

  return plans.find((plan) => plan.planGroup === 'voice') ?? plans[0]
}

function getUpgradeablePlans(
  plans: VipPlan[],
  membership: NonNullable<MembershipCenter['membership']>,
  membershipPlan?: VipPlan
) {
  const currentGroup = getCurrentPlanGroup(
    membership.vipPlanCode,
    membershipPlan
  )
  const currentIsLifetime =
    membership.lifetime || Boolean(membershipPlan?.lifetime)

  if (currentGroup === 'voice' && currentIsLifetime) {
    return []
  }

  return plans
    .filter((plan) => {
      if (!plan.lifetime) {
        return false
      }

      if (
        plan.id === membership.vipPlanId ||
        plan.code === membership.vipPlanCode
      ) {
        return false
      }

      if (currentGroup === 'voice') {
        return plan.planGroup === 'voice'
      }

      if (plan.planGroup === 'basic') {
        return !currentIsLifetime
      }

      return plan.planGroup === 'voice'
    })
    .sort((left, right) => {
      if (left.planGroup !== right.planGroup) {
        return left.planGroup === 'basic' ? -1 : 1
      }

      return left.priceAmount - right.priceAmount
    })
}

function getCurrentPlanGroup(code: string, plan?: VipPlan) {
  if (plan?.planGroup) {
    return plan.planGroup
  }

  return code.toLowerCase().includes('voice') ? 'voice' : 'basic'
}

function handleAgreementTap(type: AgreementDocumentType) {
  void openAgreementDocument(type)
}

async function handlePurchaseTap() {
  if (
    isCheckingAuth.value ||
    isLoading.value ||
    loadError.value ||
    isAwaitingPaymentResult.value
  ) {
    return
  }

  const plan = selectedPlan.value

  if (!plan) {
    showToast('暂无可购买的会员套餐')
    return
  }

  if (isPaying.value) {
    return
  }

  const vipPlanId = plan.id
  const virtualPaymentProductId = plan.virtualPaymentProductId

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

    let paidOrderId = ''

    if (virtualPaymentProductId) {
      const result = await createVipPlanVirtualPaymentOrder({
        vipPlanId,
        jsCode,
      })
      paidOrderId = result.order.id

      if (result.order.payableAmount > 0) {
        if (!result.virtualPayment) {
          throw new Error('支付参数获取失败，请稍后重试')
        }

        const paidOrder = await requestWechatVirtualPaymentWithFallback(
          {
            order: result.order,
            virtualPayment: result.virtualPayment,
          },
          async () => {
            const fallbackLoginResult = await Taro.login()
            const fallbackJsCode = fallbackLoginResult.code?.trim()

            if (!fallbackJsCode) {
              throw new Error('微信登录凭证获取失败，请稍后重试')
            }

            return createVipPlanOrder({
              vipPlanId,
              jsCode: fallbackJsCode,
            })
          }
        )
        paidOrderId = paidOrder.id
      }
    } else {
      const result = await createVipPlanOrder({
        vipPlanId,
        jsCode,
      })

      if (result.order.payableAmount > 0) {
        if (!result.payment) {
          throw new Error('支付参数获取失败，请稍后重试')
        }

        await Taro.requestPayment(result.payment)
      }
      paidOrderId = result.order.id
    }
    invalidateVipPurchaseCenterCache()
    isAwaitingPaymentResult.value = true
    void Taro.hideLoading()

    try {
      await Taro.redirectTo({
        url: `/pages/payment-result/index?orderId=${encodeURIComponent(
          paidOrderId
        )}`,
      })
    } catch {
      showToast('支付已完成，结果页打开失败，请稍后查看会员状态')
      void loadMembershipCenter()
    }
  } catch (error) {
    if (isWechatPaymentCancel(error)) {
      showToast('支付已取消')
      return
    }

    if (await showWechatVirtualPaymentError(error)) {
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

function showToast(title: string) {
  void Taro.showToast({
    title,
    icon: 'none',
    duration: 1800,
  })
}

function isOneYearVipPlan(plan: VipPlan) {
  return (
    !plan.lifetime && Boolean(plan.durationDays && plan.durationDays <= 370)
  )
}

</script>

<style lang="scss">
.vip-center-page {
  min-height: 100vh;
}

.vip-center-page__upgrade-bar {
  padding: 10px 14px 12px;
  background: rgba(255, 255, 255, 0.98);
  box-shadow: 0 -8px 24px rgba(65, 47, 63, 0.04);
}

.vip-center-page__upgrade-button {
  height: 50px;
  border-radius: 25px;
  background: linear-gradient(105deg, #ff3f73 0%, #ff665c 50%, #ffb23d 100%);
  box-shadow: 0 8px 18px rgba(255, 83, 96, 0.2);
  color: #ffffff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  line-height: 26px;
  font-weight: 600;
}

.vip-center-page__upgrade-button--disabled {
  opacity: 0.62;
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
