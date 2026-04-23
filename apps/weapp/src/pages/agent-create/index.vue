<template>
  <page-scaffold
    class="agent-create-start"
    body-padding="0"
    :safe-area-bottom="false"
  >
    <image
      class="agent-create-start__bg"
      :src="agentStartImage"
      mode="aspectFill"
    />
    <view class="agent-create-start__shade" />
    <view class="agent-create-start__top">
      <view class="agent-create-start__back" @tap="handleBack">
        <text class="agent-create-start__back-icon">‹</text>
      </view>
    </view>
    <view class="agent-create-start__tap-zone" @tap="handleStart" />
  </page-scaffold>
</template>

<script lang="ts">
export default {
  name: 'AgentCreateIndexPage',
}
</script>

<script setup lang="ts">
import Taro from '@tarojs/taro'
import PageScaffold from '../../components/page-scaffold/page-scaffold.vue'
import { resolvePublicAssetUrl } from '../../utils/public-asset'

const agentStartImage = resolvePublicAssetUrl('/public/weapp/agent-start.jpg')

function handleBack() {
  void Taro.navigateBack()
}

async function handleStart() {
  await Taro.redirectTo({
    url: '/pages/agent-create-flow/index',
  })
}
</script>

<style lang="scss">
.agent-create-start {
  position: relative;
  min-height: 100vh;
  background: #060814;
}

.agent-create-start__bg,
.agent-create-start__shade {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

.agent-create-start__shade {
  pointer-events: none;
  background: linear-gradient(
    180deg,
    rgba(6, 8, 20, 0.1) 0%,
    rgba(6, 8, 20, 0) 46%,
    rgba(6, 8, 20, 0.12) 100%
  );
}

.agent-create-start__top {
  position: relative;
  z-index: 1;
  height: 56px;
  padding-top: env(safe-area-inset-top);
  display: flex;
  align-items: center;
}

.agent-create-start__back {
  width: 48px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.agent-create-start__back-icon {
  margin-top: -4px;
  font-size: 42px;
  line-height: 1;
  color: $tzl-color-surface-base;
}

.agent-create-start__tap-zone {
  position: absolute;
  z-index: 2;
  left: 19%;
  right: 19%;
  bottom: calc(env(safe-area-inset-bottom) + 112px);
  height: 228px;
}
</style>
