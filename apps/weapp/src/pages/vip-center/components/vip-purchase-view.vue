<template>
  <view class="vip-purchase-view">
    <view class="vip-purchase-view__plans">
      <template v-for="plan in displayPlans"  :key="plan.id">
          <view
            class="vip-purchase-view__plan"
            :class="[
              plan.code,
              {
                'vip-purchase-view__plan--selected': selectedPlanId === plan.id,
              }
            ]"
            @tap="$emit('selectPlan', plan.id)"
          >
          <template v-if="plan.code === 'vip_year'">
              <view class="plan__header">
                {{ plan.name }}
              </view>
              <view class="plan__subtitle">
                <view class="plan__subtitle-price">
                  {{ formatPrice(plan.priceAmount) }}
                </view>
                /
               <view class="plan__subtitle-daily">
                每天
                <text class="primary-color">
                  {{ formatDailyPrice(plan) }}
                </text>
                元
               </view>
              </view>
          </template>
          <template v-else-if="plan.code === 'vip_infinity'">
            <view class="plan__header">
                {{ plan.name }}
              </view>
              <view class="plan__subtitle">
                <view class="plan__subtitle-price">
                  {{ formatPrice(plan.priceAmount) }}
                </view>
                /
                <view class="plan__subtitle-original">
                  {{ formatPrice(plan.originalPriceAmount || 0) }}
                </view>
              </view>
          </template>
          <template v-else-if="plan.code === 'vip_master'">
            <view class="plan__header">
                {{ plan.name }}
              </view>
              <view class="plan__subtitle">
                <view class="plan__subtitle-price primary-color">
                  {{ formatPrice(plan.priceAmount) }}
                </view>
                /
                <view class="plan__subtitle-original">
                  {{ formatPrice(plan.originalPriceAmount || 0) }}
                </view>
              </view>
          </template>
            <!-- <view v-if="isFeaturedVipPlan(plan)" class="vip-purchase-view__plan-badge">
              更多购买
            </view>
            <view class="vip-purchase-view__plan-header">
              <text class="vip-purchase-view__plan-name">{{ plan.name }}</text>
            </view>
            <view class="vip-purchase-view__plan-price-row">
              <text class="vip-purchase-view__plan-price">
                ¥ {{ formatPriceAmount(plan.priceAmount) }}
              </text>
              <text v-if="shouldShowDailyPrice(plan)" class="vip-purchase-view__plan-daily">
                每天<text class="vip-purchase-view__plan-daily-amount">{{ formatDailyPrice(plan) }}</text>元
              </text>
              <text v-else-if="plan.originalPriceAmount" class="vip-purchase-view__plan-original">
                ¥ {{ formatPriceAmount(plan.originalPriceAmount) }}
              </text>
            </view> -->
          </view>
        </template>

    </view>
    <view class="vip-purchase-view__divider">
      <view class="vip-purchase-view__divider-line" />
      <text class="vip-purchase-view__divider-text">会员权益</text>
      <view class="vip-purchase-view__divider-line vip-purchase-view__divider-line--right" />
    </view>

    <view v-if="!plans.length" class="vip-purchase-view__empty vip-purchase-view__empty--plans">
      暂无可购买的会员套餐
    </view>

    <view class="vip-purchase-view__section vip-purchase-view__section--benefits-image">
      <image class="vip-purchase-view__benefits-image" :src="benefitsImageUrl" mode="widthFix" />
    </view>

    <view class="vip-purchase-view__section vip-purchase-view__section--thanks">
      <view class="vip-purchase-view__divider">
        <view class="vip-purchase-view__divider-line" />
        <text class="vip-purchase-view__divider-text">特别鸣谢</text>
        <view class="vip-purchase-view__divider-line vip-purchase-view__divider-line--right" />
      </view>
      <text class="vip-purchase-view__thanks">
        只有得到您的认可与支持，我们才能走得更远。未来的服务升级，会员都可以持续使用。
      </text>
    </view>

    <view class="vip-purchase-view__payment">
      <nut-button
        block
        shape="round"
        type="primary"
        class="vip-purchase-view__payment-button"
        :disabled="!selectedPlan || isPaying"
        @click="$emit('purchase')"
      >
        <view class="vip-purchase-view__payment-button-content">
          <text class="vip-purchase-view__payment-label">支付</text>
          <text class="vip-purchase-view__payment-price">
            {{ selectedPlan ? formatPrice(selectedPlan.priceAmount) : '--' }}
          </text>
          <text class="vip-purchase-view__payment-action">
            {{ isPaying ? '处理中' : '立即购买' }}
          </text>
        </view>
      </nut-button>
      <text class="vip-purchase-view__agreement">
        开通即表示同意
        <text class="vip-purchase-view__agreement-link" @tap.stop="$emit('openAgreement', 'service')">
          《天之灵用户服务协议》
        </text>
        及
        <text class="vip-purchase-view__agreement-link" @tap.stop="$emit('openAgreement', 'privacy')">
          《隐私政策》
        </text>
      </text>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { VipPlan } from '../../../apis/membership'
import type { AgreementDocumentType } from '../../../legal/agreement-documents'

const props = defineProps<{
  plans: VipPlan[]
  selectedPlan?: VipPlan
  selectedPlanId: string
  isPaying: boolean
  benefitsImageUrl: string
}>()

defineEmits<{
  selectPlan: [planId: string]
  purchase: []
  openAgreement: [type: AgreementDocumentType]
}>()

const displayPlans = computed(() => {
  return [...props.plans]
})

function formatPrice(amount: number) {
  const yuan = amount / 100

  return Number.isInteger(yuan) ? `¥${yuan}` : `¥${yuan.toFixed(2)}`
}

function formatPriceAmount(amount: number) {
  const yuan = amount / 100

  return Number.isInteger(yuan) ? `${yuan}` : yuan.toFixed(2)
}

function shouldShowDailyPrice(plan: VipPlan) {
  return Boolean(!plan.lifetime && plan.durationDays && plan.durationDays >= 365)
}

function formatDailyPrice(plan: VipPlan) {
  if (!plan.durationDays) {
    return ''
  }

  const dailyPrice = plan.priceAmount / 100 / plan.durationDays

  return dailyPrice < 1
    ? dailyPrice.toFixed(2)
    : formatPriceAmount(Math.round(dailyPrice * 100))
}


</script>

<style lang="scss">
.vip-purchase-view {
  padding: 16px 16px 136px;
}

.vip-purchase-view__plans {
  margin-top: 2px;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px 16px;
  margin-bottom: 20px;
}

.vip-purchase-view__plan {
  position: relative;
  height: 80px;
  padding: 19px 10px 15px;
  border-radius: 16px;
  border: 1px solid #e0e0e0;
  background: #fafafa;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.04);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  &.vip_master {
    // 占两列
    grid-column: span 2;
    display: flex;
    flex-direction: row;
    gap: 20px;
  }
  .primary-color {
    color: $tzl-color-primary;
  }

}
// 过期价格
.original-price {
  color: $tzl-color-text-secondary;
  text-decoration: line-through;
}

.plan__header {
  color: #333;
  text-align: center;
  font-family: "PingFang SC";
  font-size: 18px;
  font-style: normal;
  font-weight: 500;
  line-height: 16px; /* 88.889% */
}
.plan__subtitle-price {
  color: #333;
  text-align: center;
  font-family: "PingFang SC";
  font-size: 20px;
  font-style: normal;
  font-weight: 600;
  line-height: 16px; /* 80% */
}
.plan__subtitle-daily {
  color: #666;
  font-family: "PingFang SC";
  font-size: 12px;
  font-style: normal;
  font-weight: 600;
  line-height: 16px;
}
.plan__subtitle-original {
  @extend .original-price;
}
.plan__subtitle {
  font-size: 20px;
  font-style: normal;
  font-weight: 600;
  color: #333;
  display: flex;
  align-items: baseline;
}

.vip-purchase-view__plan--selected {
  border-color: #d97836;
  box-shadow: 0 0 0 1px rgba(217, 120, 54, 0.2);
  border: 1px solid #E59666;
  background: linear-gradient(135deg, #FFF5E8 -1.06%, #FFD9A3 92%);
}

.vip-purchase-view__plan--featured {
  grid-column: 1 / -1;
  min-height: 118px;
  padding: 36px 22px 20px;
  border-color: #e5752f;
  background: linear-gradient(90deg, #fff4df 0%, #ffdba8 100%);
  align-items: stretch;
  flex-direction: row;
  justify-content: space-between;
  overflow: hidden;
}

.vip-purchase-view__plan-badge {
  position: absolute;
  top: 0;
  left: 0;
  height: 34px;
  padding: 0 20px 0 18px;
  border-radius: 15px 0 16px 0;
  background: #ff5a17;
  color: #ffffff;
  font-size: 15px;
  line-height: 34px;
  font-weight: 600;
}

.vip-purchase-view__plan-header {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 0;
}

.vip-purchase-view__plan-name {
  min-width: 0;
  color: #333333;
  font-size: 21px;
  line-height: 28px;
  font-weight: 700;
  text-align: center;
}

.vip-purchase-view__plan-price-row {
  margin-top: 12px;
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: 3px;
  white-space: nowrap;
}

.vip-purchase-view__plan-price {
  color: #333333;
  font-size: 25px;
  line-height: 30px;
  font-weight: 700;
}

.vip-purchase-view__plan-daily {
  color: #333333;
  font-size: 12px;
  line-height: 18px;
}

.vip-purchase-view__plan-daily-amount {
  color: #ff5a17;
}

.vip-purchase-view__plan-original {
  color: #5d3826;
  font-size: 20px;
  line-height: 24px;
  text-decoration: line-through;
}

.vip-purchase-view__plan--featured .vip-purchase-view__plan-header {
  justify-content: flex-start;
}

.vip-purchase-view__plan--featured .vip-purchase-view__plan-name {
  color: #6c341a;
  font-size: 22px;
  line-height: 30px;
  text-align: left;
}

.vip-purchase-view__plan--featured .vip-purchase-view__plan-price-row {
  margin-top: 0;
  justify-content: flex-end;
  flex-shrink: 0;
}

.vip-purchase-view__plan--featured .vip-purchase-view__plan-price {
  color: #ff5a17;
  font-size: 26px;
  line-height: 30px;
}

.vip-purchase-view__plan--featured .vip-purchase-view__plan-original {
  color: #6c341a;
  font-size: 20px;
  line-height: 24px;
}

.vip-purchase-view__empty {
  margin-top: 16px;
  padding: 18px 12px;
  border-radius: 12px;
  background: #f7f7f7;
  color: #8a8f98;
  font-size: 14px;
  line-height: 20px;
  text-align: center;
}

.vip-purchase-view__empty--plans {
  margin-top: 22px;
}

.vip-purchase-view__section {
  padding-top: 18px;
}

.vip-purchase-view__section--benefits-image {
  display: flex;
  justify-content: center;
}

.vip-purchase-view__benefits-image {
  display: block;
  width: 100%;
}

.vip-purchase-view__section--thanks {
  padding-top: 24px;
}

.vip-purchase-view__divider {
  display: flex;
  align-items: center;
  gap: 10px;
}

.vip-purchase-view__divider-line {
  flex: 1;
  height: 3px;
  background: linear-gradient(90deg, rgba(255, 111, 3, 0) 0%, #ff6f03 100%);
}

.vip-purchase-view__divider-line--right {
  transform: rotate(180deg);
}

.vip-purchase-view__divider-text {
  color: #3d3d3d;
  font-size: 14px;
  line-height: 18px;
  font-weight: 600;
}

.vip-purchase-view__thanks {
  margin-top: 14px;
  display: block;
  color: #666666;
  font-size: 12px;
  line-height: 20px;
  text-align: center;
}

.vip-purchase-view__payment {
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

.vip-purchase-view__payment-button {
  --nut-button-border-radius: 80px;
  --nut-button-primary-background-color: linear-gradient(90deg, #fce8cc 0%, #ecb872 95%);
  --nut-button-primary-border-color: transparent;
  --nut-button-default-padding: 0 14px;
  height: 56px;
  border: 0;
}

.vip-purchase-view__payment-button .nut-button__text {
  width: 100%;
  margin-left: 0;
}

.vip-purchase-view__payment-button.nut-button--disabled {
  opacity: 0.56;
}

.vip-purchase-view__payment-button-content {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.vip-purchase-view__payment-label,
.vip-purchase-view__payment-action {
  width: 84px;
  color: #602a0c;
  font-size: 16px;
  line-height: 20px;
  font-weight: 600;
}

.vip-purchase-view__payment-action {
  text-align: right;
}

.vip-purchase-view__payment-price {
  flex: 1;
  color: #602a0c;
  font-size: 24px;
  line-height: 28px;
  font-weight: 600;
  text-align: center;
}

.vip-purchase-view__agreement {
  margin-top: 6px;
  display: block;
  color: #3d3d3d;
  font-size: 11px;
  line-height: 16px;
  text-align: center;
}

.vip-purchase-view__agreement-link {
  color: #f4511e;
}
</style>
