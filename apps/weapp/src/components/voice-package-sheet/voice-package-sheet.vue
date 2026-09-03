<template>
  <view class="voice-package-sheet">
    <view class="voice-package-sheet__hero">
      <image
        class="voice-package-sheet__hero-image"
        :src="voicePackageHeroImage"
        mode="aspectFill"
      />
    </view>

    <text class="voice-package-sheet__note">
      【注】每次训练会生成一个独立声音，完成后可接入指定{{ brand.name }}
    </text>

    <view v-if="packages.length" class="voice-package-sheet__plans">
      <view class="voice-package-sheet__options">
        <view
          v-for="item in packages"
          :key="item.id"
          class="voice-package-sheet__option"
          :class="{
            'voice-package-sheet__option--selected': selectedPackageId === item.id,
            'voice-package-sheet__option--disabled': isPackageLocked(item),
          }"
          @tap="handleSelect(item.id)"
        >
          <text class="voice-package-sheet__option-name">
            {{ displayPackageName(item) }}
          </text>
          <text
            class="voice-package-sheet__option-price"
            :class="{
              'voice-package-sheet__option-price--status':
                Boolean(getPackageStateText(item)),
            }"
          >
            {{ getPackageStateText(item) || formatPrice(item.priceAmount) }}
          </text>
        </view>
      </view>
    </view>

    <view v-else class="voice-package-sheet__empty">暂无可购买的声音模型</view>
  </view>
</template>

<script lang="ts">
export default {
  name: 'VoicePackageSheet',
}
</script>

<script setup lang="ts">
import { computed } from 'vue'
import { brand } from '../../config/brand'
import { buildOssMediaUrl } from '@tzl/shared'
import type {
  VoicePackageRecord,
  VoiceTrainingTaskRecord,
} from '../../apis/voice-package'

const voicePackageHeroImage = buildOssMediaUrl('/weapp/voice_banner.png')

const props = withDefaults(
  defineProps<{
    packages: VoicePackageRecord[]
    selectedPackageId?: string
    task?: VoiceTrainingTaskRecord
    disabled?: boolean
  }>(),
  {
    selectedPackageId: '',
    disabled: false,
  },
)

const emit = defineEmits<{
  select: [packageId: string]
}>()

function handleSelect(packageId: string) {
  const voicePackage = props.packages.find((item) => item.id === packageId)

  if (!voicePackage || isPackageLocked(voicePackage)) {
    return
  }

  emit('select', packageId)
}

function getPackageTask(voicePackage: VoicePackageRecord) {
  if (!props.task) {
    return undefined
  }

  if (props.task.voicePackageId === voicePackage.id) {
    return props.task
  }

  return props.task.voicePackageCode === voicePackage.code ? props.task : undefined
}

function isPackagePaid(voicePackage: VoicePackageRecord) {
  const task = getPackageTask(voicePackage)

  return Boolean(task && isPaidVoiceTaskStatus(task.status))
}

function isPackageLocked(voicePackage: VoicePackageRecord) {
  return props.disabled || isPackagePaid(voicePackage)
}

function getPackageStateText(voicePackage: VoicePackageRecord) {
  return isPackagePaid(voicePackage) ? '已购买' : ''
}

function isPaidVoiceTaskStatus(status: string) {
  return (
    status === 'paid' ||
    status === 'awaiting_material' ||
    status === 'processing' ||
    status === 'training' ||
    status === 'completed'
  )
}

function displayPackageName(voicePackage: VoicePackageRecord) {
  return voicePackage.name.trim() || '声音模型'
}

function formatPrice(amount: number) {
  const yuan = amount / 100

  return Number.isInteger(yuan) ? `￥${yuan}` : `￥${yuan.toFixed(2)}`
}
</script>

<style lang="scss">
.voice-package-sheet {
  box-sizing: border-box;
  width: 100%;
  overflow: hidden;
  padding: 0 0 28px;
  border-radius: 16px 16px 0 0;
  background: #ffffff;
}

.voice-package-sheet__hero {
  width: 100%;
  height: 107px;
  overflow: hidden;
}

.voice-package-sheet__hero-image {
  display: block;
  width: 100%;
  height: 100%;
}

.voice-package-sheet__note {
  display: block;
  box-sizing: border-box;
  width: 327px;
  max-width: calc(100% - 64px);
  margin-top: 16px;
  margin-right: auto;
  margin-left: auto;
  color: #999999;
  font-size: 14px;
  line-height: 24px;
  text-align: center;
}

.voice-package-sheet__plans {
  box-sizing: border-box;
  width: 327px;
  max-width: calc(100% - 64px);
  margin: 16px auto 0;
}

.voice-package-sheet__option--disabled {
  opacity: 0.56;
}

.voice-package-sheet__options {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.voice-package-sheet__option {
  box-sizing: border-box;
  height: 68px;
  overflow: hidden;
  padding: 15px 8px 7px;
  border: 1px solid #e4e4e4;
  border-radius: 12px;
  background: #f9f9f9;
  text-align: center;
}

.voice-package-sheet__option--selected {
  border-color: #bb7952;
  background: #fff9ef;
}

.voice-package-sheet__option-name,
.voice-package-sheet__option-price {
  display: block;
  overflow: hidden;
  color: #333333;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.voice-package-sheet__option-name {
  font-size: 18px;
  line-height: 20px;
  font-weight: 500;
}

.voice-package-sheet__option-price {
  margin-top: 2px;
  font-size: 20px;
  line-height: 22px;
  font-weight: 600;
  letter-spacing: 0.32px;
}

.voice-package-sheet__option-price--status {
  color: #ff1a00;
}

.voice-package-sheet__empty {
  width: 327px;
  max-width: calc(100% - 64px);
  margin: 16px auto 0;
  padding: 24px 0;
  color: #999999;
  font-size: 14px;
  line-height: 22px;
  text-align: center;
}
</style>
