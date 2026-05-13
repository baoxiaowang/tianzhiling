<template>
  <view
    class="voice-package-payment-panel"
    :class="{
      'voice-package-payment-panel--compact': compact,
      'voice-package-payment-panel--payment-only': paymentOnly,
    }"
  >
    <view v-if="!paymentOnly && packages.length" class="voice-package-payment-panel__plans">
      <view
        v-if="featuredPackage"
        class="voice-package-payment-panel__trial"
        :class="{
          'voice-package-payment-panel__trial--selected':
            selectedPackageId === featuredPackage.id,
          'voice-package-payment-panel__trial--disabled': isPackageLocked(featuredPackage),
        }"
        @tap="handleSelect(featuredPackage.id)"
      >
        <text class="voice-package-payment-panel__trial-title">
          {{ displayPackageName(featuredPackage) }}
        </text>
        <text
          v-if="getPackageStateText(featuredPackage)"
          class="voice-package-payment-panel__trial-status"
        >
          {{ getPackageStateText(featuredPackage) }}
        </text>
        <view v-else class="voice-package-payment-panel__trial-corner">
          <view class="voice-package-payment-panel__trial-corner-text-wrap">
            <text>新人特惠</text>
          </view>
        </view>
      </view>

      <view v-if="optionPackages.length" class="voice-package-payment-panel__options">
        <view
          v-for="item in optionPackages"
          :key="item.id"
          class="voice-package-payment-panel__option"
          :class="{
            'voice-package-payment-panel__option--selected': selectedPackageId === item.id,
            'voice-package-payment-panel__option--disabled': isPackageLocked(item),
          }"
          @tap="handleSelect(item.id)"
        >
          <text class="voice-package-payment-panel__option-name">
            {{ displayPackageName(item) }}
          </text>
          <text
            class="voice-package-payment-panel__option-price"
            :class="{
              'voice-package-payment-panel__option-price--status':
                Boolean(getPackageStateText(item)),
            }"
          >
            {{ getPackageStateText(item) || formatPrice(item.priceAmount) }}
          </text>
        </view>
      </view>
    </view>

    <view v-else-if="!paymentOnly" class="voice-package-payment-panel__empty">
      暂无可购买的声音模型
    </view>

    <text v-if="!paymentOnly" class="voice-package-payment-panel__note">
      {{ noteText }}
    </text>

    <view v-if="!paymentOnly" class="voice-package-payment-panel__benefits">
      <view class="voice-package-payment-panel__divider">
        <view class="voice-package-payment-panel__divider-line" />
        <text class="voice-package-payment-panel__divider-text">声音权益</text>
        <view class="voice-package-payment-panel__divider-line" />
      </view>

      <view
        v-for="(item, index) in benefitItems"
        :key="`${item.title}-${index}`"
        class="voice-package-payment-panel__benefit"
      >
        <text class="voice-package-payment-panel__benefit-badge">权益{{ index + 1 }}</text>
        <text class="voice-package-payment-panel__benefit-title">{{ item.title }}</text>
      </view>
    </view>

    <text v-if="!paymentOnly && panelHint" class="voice-package-payment-panel__hint">
      {{ panelHint }}
    </text>

    <view v-if="showPayment" class="voice-package-payment-panel__payment">
      <nut-button
        block
        shape="round"
        type="primary"
        class="voice-package-payment-panel__button"
        :disabled="paymentDisabled"
        :loading="paying"
        @click="handlePay"
      >
        {{ paymentText }}
      </nut-button>

      <text class="voice-package-payment-panel__agreement">
        开通即表示同意
        <text
          class="voice-package-payment-panel__agreement-link"
          @tap.stop="handleAgreementTap('service')"
        >
          《天之灵会员协议》
        </text>
        及
        <text
          class="voice-package-payment-panel__agreement-link"
          @tap.stop="handleAgreementTap('privacy')"
        >
          《隐私政策》
        </text>
      </text>
    </view>
  </view>
</template>

<script lang="ts">
export default {
  name: 'VoicePackagePaymentPanel',
}
</script>

<script setup lang="ts">
import { computed } from 'vue'
import type { AgreementDocumentType } from '../../legal/agreement-documents'
import type {
  VoicePackageRecord,
  VoiceTrainingTaskRecord,
} from '../../apis/voice-package'

interface BenefitItem {
  title: string
  description?: string
}

const fallbackBenefits: BenefitItem[] = [
  { title: '在聊天中听到 TA 的声音' },
  { title: '语音通话功能即将上线' },
  { title: '声音自定义使用功能即将上线' },
]

const props = withDefaults(
  defineProps<{
    packages: VoicePackageRecord[]
    selectedPackageId?: string
    task?: VoiceTrainingTaskRecord
    disabled?: boolean
    paying?: boolean
    hasVoiceModel?: boolean
    compact?: boolean
    showPayment?: boolean
    paymentOnly?: boolean
  }>(),
  {
    selectedPackageId: '',
    disabled: false,
    paying: false,
    hasVoiceModel: false,
    compact: false,
    showPayment: true,
    paymentOnly: false,
  },
)

const emit = defineEmits<{
  select: [packageId: string]
  pay: []
  openAgreement: [type: AgreementDocumentType]
}>()

const featuredPackage = computed(() => props.packages[0])
const optionPackages = computed(() => props.packages.slice(1))
const selectedPackage = computed(() => {
  return props.packages.find((item) => item.id === props.selectedPackageId)
})
const currentPackageTask = computed(() => {
  if (!selectedPackage.value) {
    return undefined
  }

  return getPackageTask(selectedPackage.value)
})
const selectedPackagePurchased = computed(() => {
  if (!selectedPackage.value) {
    return false
  }

  return isPackagePurchased(selectedPackage.value)
})
const paymentDisabled = computed(() => {
  return (
    props.disabled ||
    props.paying ||
    !selectedPackage.value ||
    selectedPackagePurchased.value
  )
})
const paymentText = computed(() => {
  if (!selectedPackage.value) {
    return '请选择套餐'
  }

  if (selectedPackagePurchased.value) {
    return '已支付，等待人工处理'
  }

  return `支付 ${formatPrice(selectedPackage.value.priceAmount)} 为TA重塑声音`
})
const noteText = computed(() => {
  const requirement = selectedPackage.value?.materialRequirement.trim()

  if (requirement) {
    return `【注】声音模型与智能体一对一关联，${requirement}`
  }

  return '【注】声音模型与智能体一对一关联'
})
const benefitItems = computed(() => {
  const deliverables = selectedPackage.value?.deliverables
    .filter((item) => item.title.trim())
    .map((item) => ({
      title: item.title.trim(),
      description: item.description?.trim() || undefined,
    }))

  return deliverables?.length ? deliverables : fallbackBenefits
})
const panelHint = computed(() => {
  return currentPackageTask.value?.status === 'paid'
    ? '已支付成功，工作人员会继续处理声音训练'
    : ''
})

function getPackageTask(voicePackage: VoicePackageRecord) {
  if (!props.task) {
    return undefined
  }

  if (props.task.voicePackageId === voicePackage.id) {
    return props.task
  }

  return props.task.voicePackageCode === voicePackage.code ? props.task : undefined
}

function isPackagePurchased(voicePackage: VoicePackageRecord) {
  const task = getPackageTask(voicePackage)

  return task?.status === 'paid'
}

function isPackageLocked(voicePackage: VoicePackageRecord) {
  return props.disabled || props.paying || isPackagePurchased(voicePackage)
}

function getPackageStateText(voicePackage: VoicePackageRecord) {
  if (isPackagePurchased(voicePackage)) {
    return '已购买'
  }

  return ''
}

function displayPackageName(voicePackage: VoicePackageRecord) {
  return voicePackage.name.trim() || '声音模型'
}

function formatPrice(amount: number) {
  const yuan = amount / 100

  return Number.isInteger(yuan) ? `￥${yuan}` : `￥${yuan.toFixed(2)}`
}

function handleSelect(packageId: string) {
  const voicePackage = props.packages.find((item) => item.id === packageId)

  if (!voicePackage || isPackageLocked(voicePackage)) {
    return
  }

  emit('select', packageId)
}

function handlePay() {
  if (paymentDisabled.value) {
    return
  }

  emit('pay')
}

function handleAgreementTap(type: AgreementDocumentType) {
  emit('openAgreement', type)
}
</script>

<style lang="scss">
.voice-package-payment-panel {
  box-sizing: border-box;
  width: 100%;
  padding: 28px 0 calc(18px + env(safe-area-inset-bottom));
  overflow: hidden;
  background: #ffffff;
}

.voice-package-payment-panel--payment-only {
  padding: 12px 0 10px;
  box-shadow: 0 -8px 22px rgba(0, 0, 0, 0.05);
}

.voice-package-payment-panel__plans {
  box-sizing: border-box;
  width: 327px;
  max-width: calc(100% - 64px);
  margin: 0 auto;
}

.voice-package-payment-panel__trial {
  position: relative;
  box-sizing: border-box;
  min-height: 72px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border: 1px solid #e4e4e4;
  border-radius: 12px;
  background: #f9f9f9;
}

.voice-package-payment-panel__trial--selected {
  border-color: #d48658;
  background: linear-gradient(90deg, #fff5df 0%, #ffdca8 100%);
  box-shadow: 0 8px 20px rgba(187, 121, 82, 0.16);
}

.voice-package-payment-panel__trial--disabled,
.voice-package-payment-panel__option--disabled {
  opacity: 0.62;
}

.voice-package-payment-panel__trial-title {
  max-width: 220px;
  overflow: hidden;
  color: #ff1a00;
  font-size: 24px;
  line-height: 32px;
  font-weight: 600;
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.voice-package-payment-panel__trial-status {
  margin-top: 2px;
  color: #ff1a00;
  font-size: 18px;
  line-height: 22px;
  font-weight: 600;
}

.voice-package-payment-panel__trial-corner {
  position: absolute;
  top: 0;
  right: 1px;
  width: 50px;
  height: 50px;
  overflow: hidden;
}

.voice-package-payment-panel__trial-corner::before {
  position: absolute;
  top: 0;
  right: 0;
  content: '';
  display: block;
  width: 0;
  height: 0;
  border-top: 50px solid #ffd94f;
  border-left: 50px solid transparent;
}

.voice-package-payment-panel__trial-corner::after {
  position: absolute;
  top: -1px;
  right: -1px;
  content: '';
  display: block;
  width: 12px;
  height: 12px;
  border-radius: 0 12px 0 0;
  background: #ffc928;
}

.voice-package-payment-panel__trial-corner-text-wrap {
  position: absolute;
  top: 2px;
  right: -6px;
  z-index: 1;
  width: 48px;
  height: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  transform: rotate(45deg);
  transform-origin: center;
}

.voice-package-payment-panel__trial-corner-text-wrap text {
  color: #ffffff;
  font-size: 8px;
  line-height: 16px;
  font-weight: 600;
  text-align: center;
  white-space: nowrap;
}

.voice-package-payment-panel__options {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin-top: 16px;
}

.voice-package-payment-panel__option {
  box-sizing: border-box;
  min-height: 68px;
  overflow: hidden;
  padding: 14px 8px 8px;
  border: 1px solid #e4e4e4;
  border-radius: 12px;
  background: #f9f9f9;
  text-align: center;
}

.voice-package-payment-panel__option--selected {
  border-color: #d48658;
  background: #fff9ef;
}

.voice-package-payment-panel__option-name,
.voice-package-payment-panel__option-price {
  display: block;
  overflow: hidden;
  color: #333333;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.voice-package-payment-panel__option-name {
  font-size: 18px;
  line-height: 22px;
  font-weight: 500;
}

.voice-package-payment-panel__option-price {
  margin-top: 2px;
  font-size: 20px;
  line-height: 24px;
  font-weight: 600;
}

.voice-package-payment-panel__option-price--status {
  color: #ff1a00;
}

.voice-package-payment-panel__empty {
  width: 327px;
  max-width: calc(100% - 64px);
  margin: 0 auto;
  padding: 24px 0;
  color: #999999;
  font-size: 14px;
  line-height: 22px;
  text-align: center;
}

.voice-package-payment-panel__note {
  display: block;
  width: 327px;
  max-width: calc(100% - 64px);
  margin: 16px auto 0;
  color: #999999;
  font-size: 14px;
  line-height: 24px;
  text-align: center;
}

.voice-package-payment-panel__benefits {
  width: 327px;
  max-width: calc(100% - 64px);
  margin: 22px auto 0;
}

.voice-package-payment-panel__divider {
  display: flex;
  align-items: center;
  gap: 20px;
}

.voice-package-payment-panel__divider-line {
  flex: 1;
  height: 3px;
  background: linear-gradient(90deg, rgba(236, 184, 114, 0) 0%, #ecb872 100%);
}

.voice-package-payment-panel__divider-line:last-child {
  background: linear-gradient(90deg, #ecb872 0%, rgba(236, 184, 114, 0) 100%);
}

.voice-package-payment-panel__divider-text {
  color: #b66639;
  font-size: 24px;
  line-height: 32px;
  font-weight: 500;
}

.voice-package-payment-panel__benefit {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 14px;
}

.voice-package-payment-panel__benefit-badge {
  flex: 0 0 auto;
  min-width: 62px;
  box-sizing: border-box;
  padding: 3px 10px;
  border-radius: 8px;
  background: linear-gradient(90deg, #ffe5c0 0%, #f5c17a 100%);
  color: #8a4c24;
  font-size: 13px;
  line-height: 18px;
  font-weight: 600;
  text-align: center;
}

.voice-package-payment-panel__benefit-title {
  flex: 1;
  min-width: 0;
  color: #3f3f48;
  font-size: 16px;
  line-height: 22px;
  font-weight: 600;
}

.voice-package-payment-panel__hint {
  display: block;
  width: 327px;
  max-width: calc(100% - 64px);
  margin: 16px auto 0;
  color: #b66639;
  font-size: 13px;
  line-height: 20px;
  text-align: center;
}

.voice-package-payment-panel__payment {
  box-sizing: border-box;
  width: 100%;
  padding: 96px 33px 0;
  background: #ffffff;
}

.voice-package-payment-panel--compact .voice-package-payment-panel__payment {
  padding-top: 42px;
}

.voice-package-payment-panel--payment-only .voice-package-payment-panel__payment {
  padding: 0 33px;
}

.voice-package-payment-panel--payment-only .voice-package-payment-panel__agreement {
  margin-top: 8px;
}

.voice-package-payment-panel__button {
  height: 56px;
  border: 0;
  background: linear-gradient(90deg, #fce8cc 0%, #ecb872 94.52%);
}

.voice-package-payment-panel__button .nut-button__text {
  color: #602a0c;
  font-size: 16px;
  font-weight: 600;
}

.voice-package-payment-panel__button.nut-button--disabled {
  background: #dfdfdf;
  opacity: 1;
}

.voice-package-payment-panel__agreement {
  display: block;
  margin-top: 18px;
  color: #666666;
  font-size: 12px;
  line-height: 18px;
  text-align: center;
}

.voice-package-payment-panel__agreement-link {
  color: #333333;
}
</style>
