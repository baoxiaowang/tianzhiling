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

    <view v-else-if="center?.isVip" class="vip-center vip-center--detail">
      <view class="vip-center-hero vip-center-hero--active">
        <view class="vip-center-hero__badge">
          <StarFill size="14" color="#ffffff" />
          <text>VIP会员</text>
        </view>
        <text class="vip-center-hero__title">{{ activePlanName }}</text>
        <text class="vip-center-hero__subtitle">{{ membershipPeriodText }}</text>
      </view>

      <view class="vip-center-section">
        <view class="vip-center-section__heading">
          <text class="vip-center-section__title">会员权益</text>
          <text class="vip-center-section__sub">当前套餐包含以下权益</text>
        </view>

        <view v-if="activeBenefits.length" class="vip-center-benefits">
          <view
            v-for="(benefit, index) in activeBenefits"
            :key="`${benefit.title}-${index}`"
            class="vip-center-benefit"
          >
            <view class="vip-center-benefit__tag">权益{{ index + 1 }}</view>
            <view class="vip-center-benefit__content">
              <text class="vip-center-benefit__title">{{ benefit.title }}</text>
              <text v-if="benefit.description" class="vip-center-benefit__desc">
                {{ benefit.description }}
              </text>
            </view>
          </view>
        </view>

        <view v-else class="vip-center-empty">当前套餐暂未配置权益</view>
      </view>

      <view class="vip-center-section vip-center-section--thanks">
        <view class="vip-center-divider">
          <view class="vip-center-divider__line" />
          <text class="vip-center-divider__text">特别鸣谢</text>
          <view class="vip-center-divider__line vip-center-divider__line--right" />
        </view>
        <text class="vip-center-thanks">
          生命最珍贵的不是长度，而是那些被记住的瞬间。天之灵会继续守护 TA
          的声音、故事和留在世间的一切痕迹。
        </text>
      </view>
    </view>

    <view v-else class="vip-center vip-center--purchase">
      <view class="vip-center-section">
        <view class="vip-center-section__heading">
          <text class="vip-center-section__title">会员权益</text>
          <text class="vip-center-section__sub">开通后可使用聊天、动态等会员服务</text>
        </view>

        <view v-if="selectedBenefits.length" class="vip-center-benefits">
          <view
            v-for="(benefit, index) in selectedBenefits"
            :key="`${benefit.title}-${index}`"
            class="vip-center-benefit"
          >
            <view class="vip-center-benefit__tag">权益{{ index + 1 }}</view>
            <view class="vip-center-benefit__content">
              <text class="vip-center-benefit__title">{{ benefit.title }}</text>
              <text v-if="benefit.description" class="vip-center-benefit__desc">
                {{ benefit.description }}
              </text>
            </view>
          </view>
        </view>

        <view v-else class="vip-center-empty">请选择一个会员套餐查看权益</view>
      </view>

      <view class="vip-center-plans">
        <view
          v-for="plan in center?.plans ?? []"
          :key="plan.id"
          class="vip-center-plan"
          :class="{ 'vip-center-plan--selected': selectedPlan?.id === plan.id }"
          @tap="handlePlanSelect(plan.id)"
        >
          <view class="vip-center-plan__header">
            <text class="vip-center-plan__name">{{ plan.name }}</text>
            <view v-if="selectedPlan?.id === plan.id" class="vip-center-plan__check">
              <Check size="12" color="#ffffff" />
            </view>
          </view>
          <text class="vip-center-plan__duration">{{ formatPlanDuration(plan) }}</text>
          <view class="vip-center-plan__price-row">
            <text class="vip-center-plan__price">{{ formatPrice(plan.priceAmount) }}</text>
            <text v-if="plan.originalPriceAmount" class="vip-center-plan__original">
              {{ formatPrice(plan.originalPriceAmount) }}
            </text>
          </view>
          <text v-if="plan.description" class="vip-center-plan__desc">
            {{ plan.description }}
          </text>
        </view>
      </view>

      <view v-if="!center?.plans.length" class="vip-center-empty vip-center-empty--plans">
        暂无可购买的会员套餐
      </view>

      <view class="vip-center-section vip-center-section--thanks">
        <view class="vip-center-divider">
          <view class="vip-center-divider__line" />
          <text class="vip-center-divider__text">特别鸣谢</text>
          <view class="vip-center-divider__line vip-center-divider__line--right" />
        </view>
        <text class="vip-center-thanks">
          只有得到您的认可与支持，我们才能走得更远。未来的服务升级，会员都可以持续使用。
        </text>
      </view>
    </view>

    <view v-if="showPaymentBar" class="vip-center-payment">
      <nut-button
        block
        shape="round"
        type="primary"
        class="vip-center-payment__button"
        :disabled="!selectedPlan || isPaying"
        @click="handlePurchaseTap"
      >
        <view class="vip-center-payment__button-content">
          <text class="vip-center-payment__label">支付</text>
          <text class="vip-center-payment__price">
            {{ selectedPlan ? formatPrice(selectedPlan.priceAmount) : '--' }}
          </text>
          <text class="vip-center-payment__action">
            {{ isPaying ? '处理中' : '立即购买' }}
          </text>
        </view>
      </nut-button>
      <text class="vip-center-payment__agreement">
        开通即表示同意
        <text class="vip-center-payment__agreement-link" @tap.stop="handleAgreementTap('service')">
          《天之灵用户服务协议》
        </text>
        及
        <text class="vip-center-payment__agreement-link" @tap.stop="handleAgreementTap('privacy')">
          《隐私政策》
        </text>
      </text>
    </view>
  </page-scaffold>
</template>

<script lang="ts">
export default {
  name: 'VipCenterPage',
}
</script>

<script setup lang="ts">
import Taro, { useLoad } from '@tarojs/taro'
import { Check, StarFill } from '@nutui/icons-vue-taro'
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

const center = ref<MembershipCenter | null>(null)
const selectedPlanId = ref('')
const isCheckingAuth = ref(true)
const isLoading = ref(false)
const isPaying = ref(false)
const loadError = ref('')

const selectedPlan = computed(() => {
  return center.value?.plans.find((plan) => plan.id === selectedPlanId.value)
})
const showPaymentBar = computed(() => {
  return Boolean(
    !isCheckingAuth.value &&
      !isLoading.value &&
      !loadError.value &&
      !center.value?.isVip,
  )
})
const selectedBenefits = computed(() => selectedPlan.value?.benefits ?? [])
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
const activeBenefits = computed(() => activePlan.value?.benefits ?? [])
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
    selectedPlanId.value = data.plans[0]?.id ?? ''
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

function formatPrice(amount: number) {
  const yuan = amount / 100

  return Number.isInteger(yuan) ? `¥${yuan}` : `¥${yuan.toFixed(2)}`
}

function formatPlanDuration(plan: VipPlan) {
  if (plan.lifetime) {
    return '永久有效'
  }

  if (!plan.durationDays) {
    return '有效期以套餐配置为准'
  }

  if (plan.durationDays >= 365 && plan.durationDays % 365 === 0) {
    return `${plan.durationDays / 365}年会员`
  }

  return `${plan.durationDays}天会员`
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

.vip-center {
  padding: 16px 16px 32px;
}

.vip-center--purchase {
  padding-bottom: 136px;
}

.vip-center-hero {
  padding: 22px 18px;
  border-radius: 16px;
  background: linear-gradient(135deg, #3b2113 0%, #8e5935 55%, #efc17e 100%);
  color: #ffffff;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.vip-center-hero__badge {
  align-self: flex-start;
  height: 26px;
  padding: 0 10px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.16);
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  line-height: 18px;
  font-weight: 600;
}

.vip-center-hero__title {
  margin-top: 4px;
  color: #ffffff;
  font-size: 24px;
  line-height: 32px;
  font-weight: 700;
}

.vip-center-hero__subtitle {
  color: rgba(255, 255, 255, 0.78);
  font-size: 13px;
  line-height: 20px;
}

.vip-center-section {
  padding-top: 18px;
}

.vip-center-section__heading {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.vip-center-section__title {
  color: #a96b46;
  font-size: 20px;
  line-height: 24px;
  font-weight: 700;
}

.vip-center-section__sub {
  color: #666666;
  font-size: 13px;
  line-height: 18px;
}

.vip-center-benefits {
  margin-top: 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.vip-center-benefit {
  display: flex;
  align-items: flex-start;
  gap: 11px;
}

.vip-center-benefit__tag {
  flex-shrink: 0;
  min-width: 46px;
  height: 20px;
  padding: 0 6px;
  border-radius: 12px 4px 12px 4px;
  background: linear-gradient(90deg, #fbd099 0%, #fce5c7 100%);
  color: #783d13;
  font-size: 11px;
  line-height: 20px;
  font-weight: 600;
  text-align: center;
}

.vip-center-benefit__content {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.vip-center-benefit__title {
  color: #575764;
  font-size: 14px;
  line-height: 20px;
  font-weight: 500;
}

.vip-center-benefit__desc {
  color: #8a8f98;
  font-size: 12px;
  line-height: 18px;
}

.vip-center-plans {
  margin-top: 22px;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.vip-center-plan {
  min-height: 124px;
  padding: 14px 12px;
  border-radius: 12px;
  border: 1px solid transparent;
  background: #f7f7f7;
  display: flex;
  flex-direction: column;
}

.vip-center-plan--selected {
  border-color: #bb7952;
  background: linear-gradient(90deg, #fff3e2 0%, #ffd9a3 100%);
}

.vip-center-plan__header {
  min-height: 22px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.vip-center-plan__name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #333333;
  font-size: 17px;
  line-height: 22px;
  font-weight: 700;
}

.vip-center-plan__check {
  flex-shrink: 0;
  width: 18px;
  height: 18px;
  border-radius: 999px;
  background: #bb7952;
  display: flex;
  align-items: center;
  justify-content: center;
}

.vip-center-plan__duration {
  margin-top: 8px;
  color: #666666;
  font-size: 12px;
  line-height: 18px;
}

.vip-center-plan__price-row {
  margin-top: 10px;
  display: flex;
  align-items: baseline;
  gap: 6px;
}

.vip-center-plan__price {
  color: #333333;
  font-size: 24px;
  line-height: 28px;
  font-weight: 700;
}

.vip-center-plan__original {
  color: #999999;
  font-size: 12px;
  line-height: 18px;
  text-decoration: line-through;
}

.vip-center-plan__desc {
  margin-top: 8px;
  color: #8a8f98;
  font-size: 12px;
  line-height: 18px;
}

.vip-center-empty {
  margin-top: 16px;
  padding: 18px 12px;
  border-radius: 12px;
  background: #f7f7f7;
  color: #8a8f98;
  font-size: 14px;
  line-height: 20px;
  text-align: center;
}

.vip-center-empty--plans {
  margin-top: 22px;
}

.vip-center-section--thanks {
  padding-top: 24px;
}

.vip-center-divider {
  display: flex;
  align-items: center;
  gap: 10px;
}

.vip-center-divider__line {
  flex: 1;
  height: 3px;
  background: linear-gradient(90deg, rgba(255, 111, 3, 0) 0%, #ff6f03 100%);
}

.vip-center-divider__line--right {
  transform: rotate(180deg);
}

.vip-center-divider__text {
  color: #3d3d3d;
  font-size: 14px;
  line-height: 18px;
  font-weight: 600;
}

.vip-center-thanks {
  margin-top: 14px;
  display: block;
  color: #666666;
  font-size: 12px;
  line-height: 20px;
  text-align: center;
}

.vip-center-payment {
  position: fixed;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 20;
  padding: 18px 20px 6px;
  padding-bottom: calc(6px + constant(safe-area-inset-bottom));
  padding-bottom: calc(6px + env(safe-area-inset-bottom));
  background: #ffffff;
  box-shadow: 0 -2px 12px rgba(0, 0, 0, 0.12);
}

.vip-center-payment__button {
  --nut-button-border-radius: 80px;
  --nut-button-primary-background-color: linear-gradient(90deg, #fce8cc 0%, #ecb872 95%);
  --nut-button-primary-border-color: transparent;
  --nut-button-default-padding: 0 14px;
  height: 56px;
  border: 0;
}

.vip-center-payment__button .nut-button__text {
  width: 100%;
  margin-left: 0;
}

.vip-center-payment__button.nut-button--disabled {
  opacity: 0.56;
}

.vip-center-payment__button-content {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.vip-center-payment__label,
.vip-center-payment__action {
  width: 84px;
  color: #602a0c;
  font-size: 16px;
  line-height: 20px;
  font-weight: 600;
}

.vip-center-payment__action {
  text-align: right;
}

.vip-center-payment__price {
  flex: 1;
  color: #602a0c;
  font-size: 24px;
  line-height: 28px;
  font-weight: 600;
  text-align: center;
}

.vip-center-payment__agreement {
  margin-top: 6px;
  display: block;
  color: #3d3d3d;
  font-size: 11px;
  line-height: 16px;
  text-align: center;
}

.vip-center-payment__agreement-link {
  color: #f4511e;
}
</style>
