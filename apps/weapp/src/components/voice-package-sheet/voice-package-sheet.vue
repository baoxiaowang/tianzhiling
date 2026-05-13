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
      【注】声音模型与智能体一对一关联
    </text>

    <view v-if="packages.length" class="voice-package-sheet__plans">
      <view
        v-if="featuredPackage"
        class="voice-package-sheet__trial"
        :class="{
          'voice-package-sheet__trial--selected': selectedPackageId === featuredPackage.id,
          'voice-package-sheet__trial--disabled': isPackageLocked(featuredPackage),
        }"
        @tap="handleSelect(featuredPackage.id)"
      >
        <text class="voice-package-sheet__trial-title">
          {{ displayPackageName(featuredPackage) }}
        </text>
        <text
          v-if="getPackageStateText(featuredPackage)"
          class="voice-package-sheet__trial-status"
        >
          {{ getPackageStateText(featuredPackage) }}
        </text>
        <view v-else class="voice-package-sheet__trial-corner">
          <view class="voice-package-sheet__trial-corner-text-wrap">
            <text>新人特惠</text>
          </view>
        </view>
      </view>

      <view v-if="optionPackages.length" class="voice-package-sheet__options">
        <view
          v-for="item in optionPackages"
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

const featuredPackage = computed(() => props.packages[0])
const optionPackages = computed(() => props.packages.slice(1))

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
  return getPackageTask(voicePackage)?.status === 'paid'
}

function isPackageLocked(voicePackage: VoicePackageRecord) {
  return props.disabled || isPackagePaid(voicePackage)
}

function getPackageStateText(voicePackage: VoicePackageRecord) {
  return isPackagePaid(voicePackage) ? '已购买' : ''
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
  margin-top: 16px;
  color: #999999;
  font-size: 14px;
  line-height: 24px;
  letter-spacing: -0.31px;
  text-align: center;
  white-space: nowrap;
}

.voice-package-sheet__plans {
  box-sizing: border-box;
  width: 327px;
  max-width: calc(100% - 64px);
  margin: 16px auto 0;
}

.voice-package-sheet__trial {
  position: relative;
  box-sizing: border-box;
  height: 72px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border: 1px solid #e4e4e4;
  border-radius: 12px;
  background: #f9f9f9;
}

.voice-package-sheet__trial--selected {
  border-color: #bb7952;
  background: linear-gradient(90deg, #fff3e2 0%, #ffd9a3 100%);
  box-shadow: 0 8px 20px rgba(187, 121, 82, 0.16);
}

.voice-package-sheet__trial--disabled,
.voice-package-sheet__option--disabled {
  opacity: 0.56;
}

.voice-package-sheet__trial-title {
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

.voice-package-sheet__trial-status {
  margin-top: 2px;
  color: #ff1a00;
  font-size: 18px;
  line-height: 22px;
  font-weight: 600;
}

.voice-package-sheet__trial-corner {
  position: absolute;
  top: 0;
  right: 1px;
  width: 50px;
  height: 50px;
  overflow: hidden;
}

.voice-package-sheet__trial-corner::before {
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

.voice-package-sheet__trial-corner::after {
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

.voice-package-sheet__trial-corner-text-wrap {
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

.voice-package-sheet__trial-corner-text-wrap text {
  color: #ffffff;
  font-size: 8px;
  line-height: 16px;
  font-weight: 600;
  text-align: center;
  white-space: nowrap;
}

.voice-package-sheet__options {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin-top: 16px;
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
