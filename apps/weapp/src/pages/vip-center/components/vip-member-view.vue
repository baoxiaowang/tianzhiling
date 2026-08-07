<template>
  <view class="vip-member-view">
    <view class="vip-member-view__current-card">
      <image
        class="vip-member-view__current-art"
        :src="currentMemberArt"
        mode="widthFix"
      />

      <view class="vip-member-view__current-summary">
        <view class="vip-member-view__member-mark">
          <Star size="32" color="#ffffff" />
        </view>
        <view class="vip-member-view__current-copy">
          <text class="vip-member-view__eyebrow">当前会员</text>
          <text class="vip-member-view__current-title">{{
            currentPlanTitle
          }}</text>
        </view>
      </view>

      <view class="vip-member-view__validity-row">
        <view class="vip-member-view__validity-item">
          <view
            class="vip-member-view__small-icon vip-member-view__small-icon--purple"
          >
            <DateIcon size="18" color="#8669f6" />
          </view>
          <view class="vip-member-view__validity-copy">
            <text class="vip-member-view__meta-label">有效至</text>
            <text class="vip-member-view__meta-value">{{ validityText }}</text>
          </view>
        </view>

        <view class="vip-member-view__validity-divider" />

        <view
          class="vip-member-view__validity-item vip-member-view__validity-item--remaining"
        >
          <view
            class="vip-member-view__small-icon vip-member-view__small-icon--pink"
          >
            <Clock size="18" color="#ff4c76" />
          </view>
          <view class="vip-member-view__validity-copy">
            <text class="vip-member-view__meta-label">剩余</text>
            <view class="vip-member-view__remaining-value">
              <text class="vip-member-view__remaining-number">{{
                remainingText
              }}</text>
              <text
                v-if="!membership.lifetime"
                class="vip-member-view__remaining-unit"
                >天</text
              >
            </view>
          </view>
        </view>
      </view>
    </view>

    <view class="vip-member-view__stats-card">
      <view class="vip-member-view__stat-item">
        <view
          class="vip-member-view__stat-icon vip-member-view__stat-icon--purple"
        >
          <Message size="24" color="#8163f5" />
        </view>
        <view class="vip-member-view__stat-copy">
          <text class="vip-member-view__stat-label">累计陪伴天数</text>
          <view class="vip-member-view__stat-value-row">
            <text
              class="vip-member-view__stat-value vip-member-view__stat-value--purple"
            >
              {{ formatCount(activityStats.companionshipDays) }}
            </text>
            <text class="vip-member-view__stat-unit">天</text>
          </view>
        </view>
      </view>

      <view class="vip-member-view__stats-divider" />

      <view class="vip-member-view__stat-item">
        <view
          class="vip-member-view__stat-icon vip-member-view__stat-icon--pink"
        >
          <Comment size="24" color="#f74d77" />
        </view>
        <view class="vip-member-view__stat-copy">
          <text class="vip-member-view__stat-label">总对话次数</text>
          <view class="vip-member-view__stat-value-row">
            <text
              class="vip-member-view__stat-value vip-member-view__stat-value--pink"
            >
              {{ formatCount(activityStats.conversationCount) }}
            </text>
            <text class="vip-member-view__stat-unit">次</text>
          </view>
        </view>
      </view>
    </view>

    <view
      v-if="upgradePlans.length"
      class="vip-member-view__lifetime-story"
    >
      <text class="vip-member-view__story-eyebrow"
        >陪伴，是最长情的告白</text
      >
      <text class="vip-member-view__story-title"
        >让这份陪伴，在往后的日子里一直都在</text
      >
      <text class="vip-member-view__story-description">
        你已经为这份思念留下一处可以常常回来的地方。升级无限期后，无需再记住到期日，往后的每一年，都可以在这里继续说话、补充记忆。
      </text>
    </view>

    <view v-if="upgradePlans.length" class="vip-member-view__upgrade-section">
      <view class="vip-member-view__section-title">
        <StarFill size="17" color="#ff87a0" />
        <text>选择无限期陪伴</text>
      </view>
      <text class="vip-member-view__section-description"
        >你之前购买会员的实付金额，会在升级时自动抵扣。</text
      >

      <view class="vip-member-view__upgrade-list">
        <view
          v-for="upgradePlan in upgradePlans"
          :key="upgradePlan.id"
          class="vip-member-view__upgrade-card"
          :class="{
            'vip-member-view__upgrade-card--selected':
              upgradePlan.id === selectedPlanId,
            'vip-member-view__upgrade-card--voice':
              upgradePlan.planGroup === 'voice',
          }"
          @tap="emit('selectPlan', upgradePlan.id)"
        >
          <view
            v-if="upgradePlan.lifetime"
            class="vip-member-view__recommend-badge"
          >
            <StarFill size="12" color="#ffffff" />
            <text>长久相伴</text>
          </view>

          <image
            class="vip-member-view__plan-art"
            :class="{
              'vip-member-view__plan-art--voice':
                upgradePlan.planGroup === 'voice',
            }"
            :src="getPlanArt(upgradePlan)"
            mode="aspectFit"
          />

          <view class="vip-member-view__plan-copy">
            <text class="vip-member-view__plan-name">{{
              upgradePlan.name
            }}</text>
            <view
              v-if="upgradePlan.planGroup === 'voice'"
              class="vip-member-view__plan-tags"
            >
              <text class="vip-member-view__plan-tag">声音陪伴</text>
              <text class="vip-member-view__plan-tag">长期纪念</text>
            </view>
            <text class="vip-member-view__plan-description">
              {{ getPlanDescription(upgradePlan) }}
            </text>
            <text
              v-if="getDeductionAmount(upgradePlan) > 0"
              class="vip-member-view__deduction-note"
            >
              已购会员抵扣 ¥{{
                formatPrice(getDeductionAmount(upgradePlan))
              }}
            </text>
          </view>

          <view class="vip-member-view__price-column">
            <text class="vip-member-view__price-label">无限期价格</text>
            <view
              class="vip-member-view__price-row vip-member-view__price-row--product"
            >
              <text class="vip-member-view__currency">¥</text>
              <text class="vip-member-view__price-value">
                {{ formatPrice(upgradePlan.priceAmount) }}
              </text>
            </view>
            <view class="vip-member-view__price-divider" />
            <text
              class="vip-member-view__price-label vip-member-view__price-label--gap"
            >
              本次升级
            </text>
            <view
              class="vip-member-view__price-row vip-member-view__price-row--payable"
            >
              <text class="vip-member-view__currency">¥</text>
              <text class="vip-member-view__price-value">
                {{
                  formatPrice(
                    upgradePlan.upgradePayableAmount ?? upgradePlan.priceAmount
                  )
                }}
              </text>
            </view>
          </view>

          <ArrowRight
            class="vip-member-view__plan-arrow"
            size="14"
            color="#8d9199"
          />
        </view>
      </view>
    </view>

    <view v-else class="vip-member-view__highest-state">
      <view class="vip-member-view__highest-icon">
        <StarFill size="26" color="#ffffff" />
      </view>
      <view class="vip-member-view__highest-copy">
        <text class="vip-member-view__highest-title">已是无限期会员</text>
        <text class="vip-member-view__highest-description"
          >往后的日子里，这处属于你们的空间会一直为你保留</text
        >
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import {
  ArrowRight,
  Clock,
  Comment,
  Date as DateIcon,
  Message,
  Star,
  StarFill,
} from '@nutui/icons-vue-taro'
import { buildOssMediaUrl } from '@tzl/shared'
import { computed } from 'vue'
import currentMemberArt from '../assets/current-member-star.jpg'
import type { UserMembership, VipPlan } from '../../../apis/membership'

const lifetimeDiamondArt = buildOssMediaUrl('/weapp/lifetime-diamond.png')
const voiceStarArt = buildOssMediaUrl('/weapp/voice-star.png')

const props = defineProps<{
  membership: UserMembership
  plan?: VipPlan
  upgradePlans: VipPlan[]
  selectedPlanId: string
  serverTime: Date | null
  activityStats: {
    companionshipDays: number
    conversationCount: number
  }
}>()

const emit = defineEmits<{
  selectPlan: [planId: string]
}>()

const currentPlanTitle = computed(() => {
  const planName = props.plan?.name || props.membership.vipPlanCode || '会员'
  const duration = getCurrentPlanDuration()

  if (!duration || planName.includes(duration)) {
    return planName
  }

  return `${planName} · ${duration}`
})

const validityText = computed(() => {
  if (props.membership.lifetime) {
    return '永久有效'
  }

  if (props.membership.expiredAt) {
    return formatDateTime(props.membership.expiredAt)
  }

  return '会员权益已生效'
})

const remainingText = computed(() => {
  if (props.membership.lifetime) {
    return '不限'
  }

  if (!props.membership.expiredAt) {
    return '--'
  }

  const currentTime = props.serverTime ?? new Date()
  const millisecondsPerDay = 24 * 60 * 60 * 1000

  return `${Math.max(
    Math.ceil(
      (props.membership.expiredAt.getTime() - currentTime.getTime()) /
        millisecondsPerDay
    ),
    0
  )}`
})

function getCurrentPlanDuration() {
  if (props.membership.lifetime || props.plan?.lifetime) {
    return '无限期'
  }

  if (props.plan?.durationDays) {
    return `${props.plan.durationDays}天`
  }

  if (props.membership.startedAt && props.membership.expiredAt) {
    const millisecondsPerDay = 24 * 60 * 60 * 1000
    const durationDays = Math.max(
      Math.round(
        (props.membership.expiredAt.getTime() -
          props.membership.startedAt.getTime()) /
          millisecondsPerDay
      ),
      1
    )

    return `${durationDays}天`
  }

  return ''
}

function formatDateTime(value: Date) {
  const year = value.getFullYear()
  const month = `${value.getMonth() + 1}`.padStart(2, '0')
  const day = `${value.getDate()}`.padStart(2, '0')
  const hour = `${value.getHours()}`.padStart(2, '0')
  const minute = `${value.getMinutes()}`.padStart(2, '0')

  return `${year}-${month}-${day} ${hour}:${minute}`
}

function formatCount(value: number) {
  return String(Math.max(Math.trunc(value), 0)).replace(
    /\B(?=(\d{3})+(?!\d))/g,
    ','
  )
}

function formatPrice(amount: number) {
  const yuan = amount / 100

  return Number.isInteger(yuan) ? `${yuan}` : yuan.toFixed(2)
}

function getPlanArt(plan: VipPlan) {
  return plan.planGroup === 'voice' ? voiceStarArt : lifetimeDiamondArt
}

function getPlanDescription(plan: VipPlan) {
  return plan.planGroup === 'voice'
    ? '长期陪伴与声音权益，让熟悉的交流更完整'
    : '让这处属于你们的空间长期保留，随时回来继续说话'
}

function getDeductionAmount(plan: VipPlan) {
  return Math.max(
    plan.priceAmount - (plan.upgradePayableAmount ?? plan.priceAmount),
    0
  )
}
</script>

<style lang="scss">
.vip-member-view {
  padding: 12px 14px 24px;
  box-sizing: border-box;
}

.vip-member-view__current-card,
.vip-member-view__stats-card,
.vip-member-view__upgrade-card,
.vip-member-view__highest-state {
  border: 1px solid #f1e8ec;
  border-radius: 12px;
  background: #ffffff;
  box-shadow: 0 7px 20px rgba(69, 46, 77, 0.06);
  box-sizing: border-box;
}

.vip-member-view__current-card {
  position: relative;
  min-height: 168px;
  padding: 20px 14px 16px;
  overflow: hidden;
  background: linear-gradient(115deg, #ffffff 0%, #fffdfd 56%, #fff6fa 100%);
  border-color: #f6dfe7;
}

.vip-member-view__current-art {
  position: absolute;
  z-index: 0;
  top: 2px;
  right: -22px;
  width: 230px;
  pointer-events: none;
}

.vip-member-view__current-summary,
.vip-member-view__validity-row {
  position: relative;
  z-index: 1;
}

.vip-member-view__current-summary {
  display: flex;
  align-items: center;
  gap: 13px;
}

.vip-member-view__member-mark {
  width: 50px;
  height: 58px;
  flex-shrink: 0;
  border-radius: 7px;
  background: linear-gradient(145deg, #ffc6d8 0%, #ff91b6 100%);
  display: flex;
  align-items: center;
  justify-content: center;
}

.vip-member-view__current-copy,
.vip-member-view__validity-copy,
.vip-member-view__stat-copy,
.vip-member-view__plan-copy,
.vip-member-view__highest-copy {
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.vip-member-view__eyebrow,
.vip-member-view__meta-label,
.vip-member-view__stat-label,
.vip-member-view__price-label {
  color: #666873;
  font-size: 12px;
  line-height: 18px;
}

.vip-member-view__current-title {
  max-width: 205px;
  margin-top: 3px;
  color: #111111;
  font-size: 21px;
  line-height: 29px;
  font-weight: 700;
}

.vip-member-view__validity-row {
  min-height: 48px;
  margin-top: 22px;
  display: grid;
  grid-template-columns: minmax(0, 1.28fr) 1px minmax(0, 0.92fr);
  align-items: center;
  column-gap: 12px;
}

.vip-member-view__validity-item {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 9px;
}

.vip-member-view__small-icon {
  width: 31px;
  height: 31px;
  flex-shrink: 0;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.vip-member-view__small-icon--purple {
  background: #f5f1ff;
}

.vip-member-view__small-icon--pink {
  background: #fff0f4;
}

.vip-member-view__meta-value {
  margin-top: 3px;
  color: #171717;
  font-size: 13px;
  line-height: 18px;
  white-space: nowrap;
}

.vip-member-view__validity-divider,
.vip-member-view__stats-divider,
.vip-member-view__price-divider {
  background: #eeeeef;
}

.vip-member-view__validity-divider {
  width: 1px;
  height: 43px;
}

.vip-member-view__remaining-value,
.vip-member-view__stat-value-row,
.vip-member-view__price-row {
  display: flex;
  align-items: baseline;
}

.vip-member-view__remaining-value {
  margin-top: 1px;
  gap: 4px;
}

.vip-member-view__remaining-number {
  color: #f8446d;
  font-size: 22px;
  line-height: 28px;
  font-weight: 600;
}

.vip-member-view__remaining-unit {
  color: #555761;
  font-size: 13px;
  line-height: 18px;
}

.vip-member-view__stats-card {
  min-height: 84px;
  margin-top: 16px;
  padding: 16px 14px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 1px minmax(0, 1fr);
  align-items: center;
  column-gap: 13px;
  border-color: #ecebf2;
}

.vip-member-view__stat-item {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 10px;
}

.vip-member-view__stat-icon {
  width: 42px;
  height: 42px;
  flex-shrink: 0;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.vip-member-view__stat-icon--purple {
  background: #f4f1ff;
}

.vip-member-view__stat-icon--pink {
  background: #fff0f4;
}

.vip-member-view__stats-divider {
  width: 1px;
  height: 44px;
}

.vip-member-view__stat-value-row {
  margin-top: 2px;
  gap: 5px;
}

.vip-member-view__stat-value {
  font-size: 22px;
  line-height: 28px;
  font-weight: 500;
}

.vip-member-view__stat-value--purple {
  color: #6e58ee;
}

.vip-member-view__stat-value--pink {
  color: #f34972;
}

.vip-member-view__stat-unit {
  color: #555761;
  font-size: 13px;
  line-height: 18px;
}

.vip-member-view__upgrade-section {
  margin-top: 22px;
}

.vip-member-view__lifetime-story {
  margin-top: 26px;
  padding: 0 5px;
  display: flex;
  flex-direction: column;
}

.vip-member-view__story-eyebrow {
  color: #b56a7c;
  font-size: 13px;
  line-height: 20px;
  font-weight: 500;
}

.vip-member-view__story-title {
  margin-top: 7px;
  color: #211b1e;
  font-size: 21px;
  line-height: 30px;
  font-weight: 600;
}

.vip-member-view__story-description {
  margin-top: 10px;
  color: #6f686c;
  font-size: 14px;
  line-height: 24px;
}

.vip-member-view__section-title {
  height: 30px;
  display: flex;
  align-items: center;
  gap: 10px;
  color: #111111;
  font-size: 18px;
  line-height: 26px;
  font-weight: 600;
}

.vip-member-view__section-description {
  display: block;
  margin-top: 5px;
  color: #8a8287;
  font-size: 12px;
  line-height: 19px;
}

.vip-member-view__upgrade-list {
  margin-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.vip-member-view__upgrade-card {
  position: relative;
  min-height: 158px;
  padding: 14px 24px 14px 10px;
  display: grid;
  grid-template-columns: 76px minmax(0, 1fr) 70px;
  align-items: center;
  column-gap: 6px;
  overflow: hidden;
  border-color: #e8eaf2;
}

.vip-member-view__upgrade-card--voice {
  min-height: 168px;
}

.vip-member-view__upgrade-card--selected {
  border-color: #ff4d72;
  box-shadow: 0 8px 22px rgba(255, 76, 114, 0.09);
}

.vip-member-view__recommend-badge {
  position: absolute;
  z-index: 2;
  top: 0;
  right: 0;
  height: 24px;
  padding: 0 10px;
  border-radius: 0 11px 0 9px;
  background: #fb3f69;
  color: #ffffff;
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  line-height: 16px;
  font-weight: 600;
}

.vip-member-view__plan-art {
  width: 76px;
  height: 76px;
}

.vip-member-view__plan-art--voice {
  width: 84px;
  height: 90px;
  margin-left: -4px;
}

.vip-member-view__plan-name {
  color: #111111;
  font-size: 17px;
  line-height: 25px;
  font-weight: 600;
  white-space: normal;
}

.vip-member-view__plan-tags {
  margin-top: 7px;
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.vip-member-view__plan-tag {
  height: 23px;
  padding: 0 6px;
  border: 1px solid #ffd9e1;
  border-radius: 10px;
  color: #f5476d;
  background: #fff8fa;
  display: flex;
  align-items: center;
  font-size: 10px;
  line-height: 16px;
  box-sizing: border-box;
}

.vip-member-view__plan-description {
  margin-top: 8px;
  color: #777985;
  font-size: 10px;
  line-height: 17px;
  white-space: normal;
}

.vip-member-view__deduction-note {
  display: block;
  margin-top: 6px;
  color: #d75170;
  font-size: 11px;
  line-height: 17px;
  font-weight: 500;
}

.vip-member-view__price-column {
  min-width: 0;
  align-self: stretch;
  padding-top: 1px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
}

.vip-member-view__price-label {
  align-self: stretch;
  text-align: center;
}

.vip-member-view__price-label--gap {
  margin-top: 6px;
}

.vip-member-view__price-row {
  margin-top: 1px;
  justify-content: center;
  color: #6755e9;
}

.vip-member-view__price-row--payable {
  color: #f1436b;
}

.vip-member-view__currency {
  margin-right: 2px;
  font-size: 13px;
  line-height: 19px;
}

.vip-member-view__price-value {
  font-size: 23px;
  line-height: 28px;
  font-weight: 500;
}

.vip-member-view__price-divider {
  width: 100%;
  height: 1px;
  margin-top: 5px;
}

.vip-member-view__plan-arrow {
  position: absolute;
  right: 7px;
  top: 50%;
  transform: translateY(-50%);
}

.vip-member-view__highest-state {
  min-height: 82px;
  margin-top: 22px;
  padding: 16px 18px;
  display: flex;
  align-items: center;
  gap: 13px;
  border-color: #f0e8ee;
}

.vip-member-view__highest-icon {
  width: 46px;
  height: 46px;
  flex-shrink: 0;
  border-radius: 50%;
  background: linear-gradient(145deg, #ff8fa8 0%, #ffbf8e 100%);
  display: flex;
  align-items: center;
  justify-content: center;
}

.vip-member-view__highest-title {
  color: #171717;
  font-size: 16px;
  line-height: 23px;
  font-weight: 600;
}

.vip-member-view__highest-description {
  margin-top: 3px;
  color: #8b8d96;
  font-size: 12px;
  line-height: 18px;
}
</style>
