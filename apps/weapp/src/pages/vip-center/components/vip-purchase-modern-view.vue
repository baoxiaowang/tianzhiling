<template>
  <view class="vip-purchase-modern">
    <view class="vip-purchase-modern__subtitle">
      <text class="vip-purchase-modern__sparkle">✦</text>
      <text>选择最适合你的方案</text>
    </view>

    <view v-if="availablePlanGroups.length" class="vip-purchase-modern__cards">
      <view
        v-for="group in availablePlanGroups"
        :key="group.key"
        class="vip-purchase-modern__level-card"
        :class="[
          `vip-purchase-modern__level-card--${group.key}`,
          {
            'vip-purchase-modern__level-card--active':
              selectedPlanGroup === group.key,
          },
        ]"
        @tap="handlePlanGroupTap(group.key)"
      >
        <view
          class="vip-purchase-modern__level-icon"
          :class="`vip-purchase-modern__level-icon--${group.key}`"
        >
          <view v-if="group.key === 'basic'" class="vip-purchase-modern__basic-face">
            <text class="vip-purchase-modern__basic-star">★</text>
          </view>
          <view v-else class="vip-purchase-modern__voice-bars">
            <view class="vip-purchase-modern__voice-dot" />
            <view class="vip-purchase-modern__voice-bar vip-purchase-modern__voice-bar--short" />
            <view class="vip-purchase-modern__voice-bar vip-purchase-modern__voice-bar--long" />
            <view class="vip-purchase-modern__voice-bar vip-purchase-modern__voice-bar--mid" />
            <view class="vip-purchase-modern__voice-dot vip-purchase-modern__voice-dot--top" />
          </view>
        </view>

        <view class="vip-purchase-modern__level-main">
          <view class="vip-purchase-modern__level-title-row">
            <text class="vip-purchase-modern__level-title">{{ group.title }}</text>
            <text
              class="vip-purchase-modern__level-price"
              :class="`vip-purchase-modern__level-price--${group.key}`"
            >
              <text class="vip-purchase-modern__level-price-currency">¥</text>
              <text>{{ formatGroupPrice(group.key) }}</text>
            </text>
          </view>
          <text class="vip-purchase-modern__level-desc">
            {{ formatGroupDescription(group.key) }}
          </text>

          <view class="vip-purchase-modern__features">
            <view
              v-for="feature in group.features"
              :key="feature.text"
              class="vip-purchase-modern__feature"
            >
              <text
                class="vip-purchase-modern__feature-icon"
                :class="`vip-purchase-modern__feature-icon--${group.key}`"
              >
                {{ feature.icon }}
              </text>
              <text class="vip-purchase-modern__feature-text">{{ feature.text }}</text>
            </view>
          </view>

          <text v-if="group.warning" class="vip-purchase-modern__warning">
            {{ group.warning }}
          </text>
        </view>
      </view>
    </view>

    <view v-else class="vip-purchase-modern__empty">
      暂无可购买的会员套餐
    </view>

    <view v-if="durationOptions.length" class="vip-purchase-modern__duration-section">
      <view class="vip-purchase-modern__duration-title-row">
        <text class="vip-purchase-modern__duration-title">选择陪伴时长</text>
        <text class="vip-purchase-modern__duration-tip">购买时长越长越划算</text>
      </view>
      <view
        class="vip-purchase-modern__duration-options"
        :class="{
          'vip-purchase-modern__duration-options--compact':
            durationOptions.length < 3,
        }"
      >
        <view
          v-for="option in durationOptions"
          :key="option.key"
          class="vip-purchase-modern__duration-card"
          :class="{
            'vip-purchase-modern__duration-card--active':
              selectedDurationKey === option.key,
          }"
          @tap="handleDurationTap(option.key)"
        >
          <text
            v-if="option.badge"
            class="vip-purchase-modern__duration-badge"
            :class="`vip-purchase-modern__duration-badge--${option.badgeType}`"
          >
            {{ option.badge }}
          </text>
          <text class="vip-purchase-modern__duration-name">{{ option.label }}</text>
          <text class="vip-purchase-modern__duration-daily">
            {{ formatDurationDaily(option.key) }}
          </text>
        </view>
      </view>
    </view>

    <view class="vip-purchase-modern__guarantee">
      <view class="vip-purchase-modern__guarantee-main">
        <text class="vip-purchase-modern__shield">◆</text>
        <text>安全支付</text>
        <view class="vip-purchase-modern__guarantee-divider" />
        <text>7天无理由退款</text>
      </view>
      <text class="vip-purchase-modern__guarantee-arrow">›</text>
    </view>

    <text class="vip-purchase-modern__agreement">
      开通即表示同意
      <text
        class="vip-purchase-modern__agreement-link"
        @tap.stop="emit('openAgreement', 'service')"
      >
        《天之灵用户服务协议》
      </text>
      及
      <text
        class="vip-purchase-modern__agreement-link"
        @tap.stop="emit('openAgreement', 'privacy')"
      >
        《隐私政策》
      </text>
    </text>

    <view class="vip-purchase-modern__bottom">
      <text class="vip-purchase-modern__bottom-price">
        {{ selectedPlan ? formatPrice(selectedPlan.priceAmount) : '--' }}
      </text>
      <nut-button
        shape="round"
        type="primary"
        class="vip-purchase-modern__buy-button"
        :disabled="!selectedPlan || isPaying"
        @click="emit('purchase')"
      >
        {{ isPaying ? '处理中' : '立即购买' }}
      </nut-button>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { VipPlan } from '../../../apis/membership'
import type { AgreementDocumentType } from '../../../legal/agreement-documents'

type VipPlanGroup = VipPlan['planGroup']

interface PlanGroupConfig {
  key: VipPlanGroup
  title: string
  features: PlanGroupFeature[]
  warning?: string
}

interface PlanGroupFeature {
  icon: string
  text: string
}

interface DurationOption {
  key: string
  label: string
  days?: number
  lifetime: boolean
  badge?: string
  badgeType: 'recommend' | 'value'
}

const PLAN_GROUPS: PlanGroupConfig[] = [
  {
    key: 'basic',
    title: '基础版',
    features: [
      { icon: '■', text: '无限聊天' },
      { icon: '▣', text: '记忆唤醒' },
      { icon: '●', text: '云端共享' },
    ],
  },
  {
    key: 'voice',
    title: '声音版',
    features: [{ icon: '♬', text: '人工复刻音色，请主动添加客服微信' }],
    warning: '如果没有声音素材或方言口音较重，请勿购买',
  },
]

const props = defineProps<{
  plans: VipPlan[]
  selectedPlan?: VipPlan
  selectedPlanId: string
  isPaying: boolean
  benefitsImageUrl: string
}>()

const emit = defineEmits<{
  selectPlan: [planId: string]
  purchase: []
  openAgreement: [type: AgreementDocumentType]
}>()

const displayPlans = computed(() => [...props.plans])
const availablePlanGroups = computed(() => {
  return PLAN_GROUPS.filter((group) => {
    return displayPlans.value.some((plan) => plan.planGroup === group.key)
  })
})
const selectedPlanGroup = computed<VipPlanGroup>(() => {
  return props.selectedPlan?.planGroup ?? availablePlanGroups.value[0]?.key ?? 'basic'
})
const selectedDurationKey = computed(() => {
  return props.selectedPlan ? getDurationKey(props.selectedPlan) : ''
})
const selectedGroupPlans = computed(() => {
  return sortPlansByDuration(
    displayPlans.value.filter((plan) => plan.planGroup === selectedPlanGroup.value)
  )
})
const durationOptions = computed(() => {
  const optionMap = new Map<string, DurationOption>()

  selectedGroupPlans.value.forEach((plan) => {
    const option = buildDurationOption(plan)

    if (!optionMap.has(option.key)) {
      optionMap.set(option.key, option)
    }
  })

  return [...optionMap.values()].sort((left, right) => {
    return getDurationSort(left) - getDurationSort(right)
  })
})

function handlePlanGroupTap(group: VipPlanGroup) {
  const plan =
    findPlan(group, selectedDurationKey.value) ?? findFirstPlanByGroup(group)

  if (plan) {
    emit('selectPlan', plan.id)
  }
}

function handleDurationTap(durationKey: string) {
  const plan = findPlan(selectedPlanGroup.value, durationKey)

  if (plan) {
    emit('selectPlan', plan.id)
  }
}

function findPlan(group: VipPlanGroup, durationKey: string) {
  return displayPlans.value.find((plan) => {
    return plan.planGroup === group && getDurationKey(plan) === durationKey
  })
}

function findFirstPlanByGroup(group: VipPlanGroup) {
  return sortPlansByDuration(
    displayPlans.value.filter((plan) => plan.planGroup === group)
  )[0]
}

function sortPlansByDuration(plans: VipPlan[]) {
  return [...plans].sort((left, right) => {
    return getPlanDurationSort(left) - getPlanDurationSort(right)
  })
}

function buildDurationOption(plan: VipPlan): DurationOption {
  const lifetime = Boolean(plan.lifetime)
  const days = lifetime ? undefined : plan.durationDays

  return {
    key: getDurationKey(plan),
    label: formatDurationLabel(plan),
    days,
    lifetime,
    badge: lifetime ? '超值' : getPlanDurationSort(plan) >= 365 * 3 ? '推荐' : '',
    badgeType: lifetime ? 'value' : 'recommend',
  }
}

function getDurationKey(plan: VipPlan) {
  return plan.lifetime ? 'lifetime' : `days:${plan.durationDays ?? 0}`
}

function getPlanDurationSort(plan: VipPlan) {
  return plan.lifetime ? Number.MAX_SAFE_INTEGER : plan.durationDays ?? 0
}

function getDurationSort(option: DurationOption) {
  return option.lifetime ? Number.MAX_SAFE_INTEGER : option.days ?? 0
}

function formatDurationLabel(plan: VipPlan) {
  if (plan.lifetime) {
    return '无限期'
  }

  const days = plan.durationDays ?? 0

  if (days >= 365) {
    const years = Math.max(1, Math.round(days / 365))
    return years === 1 ? '一年' : `${years}年`
  }

  return days > 0 ? `${days}天` : '有效期'
}

function formatGroupPrice(group: VipPlanGroup) {
  const plan =
    findPlan(group, selectedDurationKey.value) ?? findFirstPlanByGroup(group)

  return plan ? formatPriceAmount(plan.priceAmount) : '--'
}

function formatGroupDescription(group: VipPlanGroup) {
  const plan =
    findPlan(group, selectedDurationKey.value) ?? findFirstPlanByGroup(group)

  if (!plan) {
    return group === 'voice' ? '声音陪伴服务' : '走心陪伴服务'
  }

  const durationType = getPlanDurationType(plan)

  if (group === 'voice') {
    if (durationType === 'lifetime') {
      return '让熟悉的声音一直在身边'
    }

    return durationType === 'threeYears'
      ? '用熟悉音色延续思念'
      : '开启熟悉音色的温暖回应'
  }

  if (durationType === 'lifetime') {
    return '余生很长，把想说的话慢慢说完'
  }

  return durationType === 'threeYears'
    ? '重要记忆更安心地留存'
    : '从日常聊天再次靠近'
}

function formatDurationDaily(durationKey: string) {
  const plan = findPlan(selectedPlanGroup.value, durationKey)

  return plan ? formatDailyText(plan) : '暂无套餐'
}

function formatPrice(amount: number) {
  const yuan = amount / 100

  return Number.isInteger(yuan) ? `¥${yuan}` : `¥${yuan.toFixed(2)}`
}

function formatPriceAmount(amount: number) {
  const yuan = amount / 100

  return Number.isInteger(yuan) ? `${yuan}` : yuan.toFixed(2)
}

function getPlanDurationType(plan: VipPlan) {
  if (plan.lifetime) {
    return 'lifetime'
  }

  return (plan.durationDays ?? 0) >= 365 * 3 ? 'threeYears' : 'oneYear'
}

function formatDailyText(plan: VipPlan) {
  const durationDays = plan.lifetime ? 365 * 50 : plan.durationDays

  if (!durationDays) {
    return '暂无均价'
  }

  const dailyPrice = plan.priceAmount / 100 / durationDays
  const dailyText =
    dailyPrice < 1
      ? dailyPrice.toFixed(2)
      : formatPriceAmount(Math.round(dailyPrice * 100))

  return `约¥${dailyText}/天`
}
</script>

<style lang="scss">
.vip-purchase-modern {
  min-height: 100%;
  padding: 4px 12px 118px;
  box-sizing: border-box;
}

.vip-purchase-modern__subtitle {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0 18px;
  color: #8c8c8c;
  font-size: 15px;
  line-height: 22px;
  font-weight: 600;
}

.vip-purchase-modern__sparkle {
  color: #a78bfa;
  font-size: 24px;
  line-height: 24px;
}

.vip-purchase-modern__cards {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.vip-purchase-modern__level-card {
  position: relative;
  min-height: 120px;
  padding: 12px;
  box-sizing: border-box;
  border: 2px solid transparent;
  border-radius: 16px;
  background: #ffffff;
  box-shadow: 0 2px 14px rgba(0, 0, 0, 0.045);
  display: flex;
  align-items: center;
  gap: 12px;
}

.vip-purchase-modern__level-card--active {
  border-color: #ff8c42;
  background: linear-gradient(135deg, #fff8f3 0%, #ffffff 70%);
  box-shadow: 0 4px 18px rgba(255, 140, 66, 0.13);
}

.vip-purchase-modern__level-icon {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
}

.vip-purchase-modern__level-icon--basic {
  background: linear-gradient(135deg, #fff3e0 0%, #ffe0c2 100%);
  box-shadow: 0 4px 12px rgba(255, 140, 66, 0.15);
}

.vip-purchase-modern__level-icon--voice {
  background: linear-gradient(135deg, #f3e8ff 0%, #e8d5ff 100%);
  box-shadow: 0 4px 12px rgba(167, 139, 250, 0.15);
}

.vip-purchase-modern__basic-face {
  width: 38px;
  height: 38px;
  border-radius: 50%;
  background: linear-gradient(135deg, #ffd54f 0%, #ffb300 100%);
  display: flex;
  align-items: center;
  justify-content: center;
}

.vip-purchase-modern__basic-star {
  color: #ffffff;
  font-size: 24px;
  line-height: 24px;
}

.vip-purchase-modern__voice-bars {
  height: 38px;
  display: flex;
  align-items: center;
  gap: 4px;
}

.vip-purchase-modern__voice-bar {
  width: 8px;
  border-radius: 999px;
  background: #a78bfa;
}

.vip-purchase-modern__voice-bar--short {
  height: 28px;
}

.vip-purchase-modern__voice-bar--long {
  height: 38px;
}

.vip-purchase-modern__voice-bar--mid {
  height: 32px;
  background: #c4a6ff;
}

.vip-purchase-modern__voice-dot {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: #c4a6ff;
}

.vip-purchase-modern__voice-dot--top {
  align-self: flex-start;
  margin-top: 6px;
}

.vip-purchase-modern__level-main {
  flex: 1;
  min-width: 0;
}

.vip-purchase-modern__level-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.vip-purchase-modern__level-title {
  min-width: 0;
  flex: 1;
  color: #1a1a1a;
  font-size: 22px;
  line-height: 28px;
  font-weight: 800;
}

.vip-purchase-modern__level-desc {
  margin-top: 6px;
  display: block;
  color: #8c8c8c;
  font-size: 15px;
  line-height: 21px;
  font-weight: 600;
}

.vip-purchase-modern__features {
  margin-top: 8px;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.vip-purchase-modern__feature {
  min-width: 0;
  max-width: 100%;
  min-height: 28px;
  padding: 5px 8px;
  box-sizing: border-box;
  border-radius: 9px;
  background: #f7f7f7;
  display: flex;
  align-items: center;
  gap: 5px;
  color: #666666;
  font-size: 12px;
  line-height: 18px;
  flex: 0 1 auto;
}

.vip-purchase-modern__feature-icon {
  flex: 0 0 auto;
  font-size: 12px;
  line-height: 12px;
}

.vip-purchase-modern__feature-icon--basic {
  color: #ff8c42;
}

.vip-purchase-modern__feature-icon--voice {
  color: #a78bfa;
}

.vip-purchase-modern__feature-text {
  min-width: 0;
  white-space: normal;
  word-break: break-all;
}

.vip-purchase-modern__warning {
  margin-top: 5px;
  display: block;
  color: #ef5350;
  font-size: 12px;
  line-height: 18px;
  white-space: normal;
}

.vip-purchase-modern__level-price {
  flex: 0 0 auto;
  display: flex;
  align-items: baseline;
  justify-content: flex-end;
  color: #ff8c42;
  font-size: 24px;
  line-height: 28px;
  font-weight: 800;
}

.vip-purchase-modern__level-price--voice {
  color: #9b7ed8;
}

.vip-purchase-modern__level-price-currency {
  margin-right: 1px;
  font-size: 13px;
  line-height: 18px;
}

.vip-purchase-modern__empty {
  padding: 24px 16px;
  border-radius: 16px;
  background: #ffffff;
  color: #8c8c8c;
  font-size: 14px;
  line-height: 20px;
  text-align: center;
}

.vip-purchase-modern__duration-section {
  margin-top: 16px;
  padding: 14px 0 4px;
  border-radius: 16px;
  background: #ffffff;
  box-shadow: 0 2px 14px rgba(0, 0, 0, 0.045);
  overflow: hidden;
}

.vip-purchase-modern__duration-title-row {
  padding: 0 16px;
  margin-bottom: 10px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.vip-purchase-modern__duration-title {
  color: #1a1a1a;
  font-size: 18px;
  line-height: 24px;
  font-weight: 800;
}

.vip-purchase-modern__duration-tip {
  padding: 2px 8px;
  border-radius: 10px;
  color: #ff8c42;
  background: #fff3e6;
  font-size: 12px;
  line-height: 18px;
  font-weight: 500;
}

.vip-purchase-modern__duration-options {
  padding: 4px 16px 16px;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.vip-purchase-modern__duration-options--compact {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.vip-purchase-modern__duration-card {
  position: relative;
  min-height: 76px;
  padding: 14px 8px 10px;
  box-sizing: border-box;
  border: 1.5px solid #f0f0f0;
  border-radius: 12px;
  background: #ffffff;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
}

.vip-purchase-modern__duration-card--active {
  border-color: #ff8c42;
  background: #fff8f3;
  box-shadow: 0 2px 12px rgba(255, 140, 66, 0.2);
}

.vip-purchase-modern__duration-name {
  color: #1a1a1a;
  font-size: 18px;
  line-height: 24px;
  font-weight: 800;
}

.vip-purchase-modern__duration-daily {
  color: #ff7d3d;
  font-size: 13px;
  line-height: 18px;
  font-weight: 700;
}

.vip-purchase-modern__duration-badge {
  position: absolute;
  top: -1px;
  right: -1px;
  padding: 2px 7px;
  border-radius: 0 10px 0 10px;
  color: #ffffff;
  font-size: 11px;
  line-height: 16px;
  font-weight: 600;
}

.vip-purchase-modern__duration-badge--recommend {
  background: #ff8c42;
}

.vip-purchase-modern__duration-badge--value {
  background: #ff6b9d;
}

.vip-purchase-modern__guarantee {
  margin-top: 16px;
  padding: 12px 16px;
  border-radius: 14px;
  background: #ffffff;
  box-shadow: 0 2px 14px rgba(0, 0, 0, 0.045);
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.vip-purchase-modern__guarantee-main {
  display: flex;
  align-items: center;
  gap: 12px;
  color: #666666;
  font-size: 15px;
  line-height: 22px;
  font-weight: 600;
}

.vip-purchase-modern__shield {
  color: #9b7ed8;
  font-size: 16px;
  line-height: 16px;
}

.vip-purchase-modern__guarantee-divider {
  width: 1px;
  height: 14px;
  background: #e0e0e0;
}

.vip-purchase-modern__guarantee-arrow {
  color: #cccccc;
  font-size: 22px;
  line-height: 22px;
}

.vip-purchase-modern__agreement {
  padding: 14px 0 8px;
  display: block;
  color: #999999;
  font-size: 12px;
  line-height: 18px;
  text-align: center;
}

.vip-purchase-modern__agreement-link {
  color: #666666;
}

.vip-purchase-modern__bottom {
  position: fixed;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 20;
  padding: 14px 20px 24px;
  padding-bottom: calc(24px + constant(safe-area-inset-bottom));
  padding-bottom: calc(24px + env(safe-area-inset-bottom));
  border-radius: 22px 22px 0 0;
  background: #ffffff;
  box-shadow: 0 -2px 22px rgba(0, 0, 0, 0.07);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
}

.vip-purchase-modern__bottom-price {
  flex: 1;
  color: #ff6b35;
  font-size: 34px;
  line-height: 40px;
  font-weight: 800;
}

.vip-purchase-modern__buy-button {
  width: 176px;
  height: 56px;
  border: 0;
  color: #ffffff;
  font-size: 18px;
  font-weight: 800;
  box-shadow: 0 4px 18px rgba(255, 107, 53, 0.3);
  --nut-button-border-radius: 999px;
  --nut-button-primary-background-color: linear-gradient(90deg, #ff8c42 0%, #ff6b35 100%);
  --nut-button-primary-border-color: transparent;
}

.vip-purchase-modern__buy-button.nut-button--disabled {
  opacity: 0.56;
}
</style>
