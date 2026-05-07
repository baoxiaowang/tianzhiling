<template>
  <view class="onboarding-page">
    <view v-if="isCheckingEntry" class="onboarding-entry-check" />

    <block v-else>
      <swiper
        class="onboarding-swiper"
        :current="currentIndex"
        :duration="480"
        :circular="false"
        @change="handleSwiperChange"
      >
        <swiper-item
          v-for="image in onboardingImages"
          :key="image"
          class="onboarding-slide"
        >
          <image
            class="onboarding-slide__image"
            :src="image"
            mode="heightFix"
          />
        </swiper-item>
      </swiper>

      <view v-if="isLastSlide" class="onboarding-action" :style="actionSafeStyle">
        <view class="onboarding-action__halo" />
        <view class="onboarding-action__button" @tap="handleStart">
          <text class="onboarding-action__text">开始体验</text>
        </view>
      </view>

      <view class="onboarding-dots" :style="dotsSafeStyle">
        <view
          v-for="(_, index) in onboardingImages"
          :key="index"
          class="onboarding-dots__item"
          :class="{ 'onboarding-dots__item--active': currentIndex === index }"
        />
      </view>
    </block>
  </view>
</template>

<script lang="ts">
export default {
  name: 'OnboardingPage',
}
</script>

<script setup lang="ts">
import { computed, ref } from 'vue'
import Taro, { useLoad } from '@tarojs/taro'
import { buildOssMediaUrl } from '@tzl/shared'
import { authSession, restoreAuthSession } from '../../auth/session'
import { silentWeappLogin } from '../../auth/login-hooks'
import { createSafeAreaCssVars, initSafeAreaInsets } from '../../utils/safe-area'

const ONBOARDING_STORAGE_KEY = 'tzl_onboarding_seen'

const onboardingImages = [
  buildOssMediaUrl('/weapp/onboarding_1.png'),
  buildOssMediaUrl('/weapp/page4%201.png'),
]

type EntryTarget = 'onboarding' | 'index' | 'chat'

const currentIndex = ref(0)
const isCheckingEntry = ref(true)
const isNavigating = ref(false)
const isLastSlide = computed(() => currentIndex.value === onboardingImages.length - 1)
const actionSafeStyle = computed(() => createSafeAreaCssVars('onboarding-safe'))
const dotsSafeStyle = computed(() => createSafeAreaCssVars('onboarding-safe'))

async function goToIndex() {
  if (isNavigating.value) {
    return
  }

  isNavigating.value = true
  await Taro.switchTab({
    url: '/pages/index/index',
  })
}

async function goToChatTab() {
  if (isNavigating.value) {
    return
  }

  isNavigating.value = true
  await Taro.switchTab({
    url: '/pages/contacts/index',
  })
}

async function resolveEntryTarget(): Promise<EntryTarget> {
  await restoreAuthSession()
  console.log(authSession.value,'authSession.value')
  if (authSession.value?.accessToken) {
    return 'chat'
  }
  const session = await silentWeappLogin()
  if (session?.accessToken) {
    return 'chat'
  }

  const hasSeenOnboarding = Boolean(Taro.getStorageSync(ONBOARDING_STORAGE_KEY))

  if (!hasSeenOnboarding) {
    return 'onboarding'
  }

  return 'index'
}

function handleSwiperChange(event: { detail?: { current?: number } }) {
  currentIndex.value = event.detail?.current ?? 0
}

async function handleStart() {
  Taro.setStorageSync(ONBOARDING_STORAGE_KEY, '1')
  await goToIndex()
}

useLoad(() => {
  initSafeAreaInsets()
  void resolveEntryTarget().then((target) => {
    if (target === 'index') {
      void goToIndex()
      return
    }

    if (target === 'chat') {
      void goToChatTab()
      return
    }

    isCheckingEntry.value = false
  })
})
</script>

<style lang="scss">
.onboarding-page {
  position: relative;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  background: #f5f5f3;
}

.onboarding-entry-check {
  width: 100%;
  height: 100%;
  background: #f5f5f3;
}

.onboarding-swiper,
.onboarding-slide {
  width: 100%;
  height: 100%;
}

.onboarding-slide {
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f5f5f3;
}

.onboarding-slide__image {
  width: auto;
  height: 100%;
  display: block;
}

.onboarding-action {
  position: fixed;
  right: 0;
  bottom: calc(var(--onboarding-safe-bottom, env(safe-area-inset-bottom)) + 58px);
  left: 0;
  z-index: 8;
  display: flex;
  justify-content: center;
  pointer-events: none;
}

.onboarding-action__halo {
  position: absolute;
  top: -22px;
  width: 198px;
  height: 78px;
  border-radius: 999px;
  background: radial-gradient(circle, rgba(255, 255, 255, 0.9) 0%, rgba(255, 251, 165, 0.42) 42%, rgba(255, 255, 255, 0) 72%);
  filter: blur(10px);
}

.onboarding-action__button {
  position: relative;
  min-width: 168px;
  height: 56px;
  padding: 0 32px;
  border: 1px solid rgba(255, 255, 255, 0.72);
  border-radius: 999px;
  background: linear-gradient(135deg, rgba(255, 249, 126, 0.96) 0%, rgba(208, 255, 238, 0.96) 52%, rgba(178, 210, 255, 0.96) 100%);
  box-shadow: 0 18px 38px rgba(79, 99, 130, 0.22), inset 0 1px 0 rgba(255, 255, 255, 0.86);
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: auto;
}

.onboarding-action__button:active {
  transform: scale(0.97);
}

.onboarding-action__text {
  color: #141414;
  font-size: 18px;
  font-weight: 700;
  letter-spacing: 1px;
}

.onboarding-dots {
  position: fixed;
  right: 0;
  bottom: calc(var(--onboarding-safe-bottom, env(safe-area-inset-bottom)) + 28px);
  left: 0;
  z-index: 7;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.onboarding-dots__item {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: rgba(20, 20, 20, 0.24);
  transition: all 180ms ease;
}

.onboarding-dots__item--active {
  width: 20px;
  background: rgba(20, 20, 20, 0.72);
}
</style>
