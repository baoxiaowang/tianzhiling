<template>
  <page-scaffold
    class="voice-package-page"
    background="#efeff4"
    body-padding="0"
    :scroll="true"
    :safe-area-top="false"
    require-auth
  >
    <template #header>
      <app-bar title="声音模型" background="#ffffff" border-color="#eeeeee" />
    </template>

    <view class="voice-package-content">
      <view class="voice-package-intro">
        <text class="voice-package-intro__title">声音模型需要人工确认后再开始</text>
        <text class="voice-package-intro__lead">
          亲人离世后的声音素材不可再生，我们会先与你确认素材情况，再判断是否适合训练。
        </text>

        <view class="voice-package-intro__section">
          <text class="voice-package-intro__section-title">素材质量会直接影响效果</text>
          <text class="voice-package-intro__section-text">
            很多旧录音存在环境噪声、音量忽大忽小、多人说话、片段过短等问题，通常需要人工整理、降噪和筛选后，才能作为训练素材使用。
          </text>
        </view>

        <view class="voice-package-intro__section">
          <text class="voice-package-intro__section-title">现阶段技术仍有局限</text>
          <text class="voice-package-intro__section-text">
            目前声音大模型还无法完全复原真实音色。方言、口音较重，或素材较少、较杂时，训练结果可能不稳定，和记忆中的声音会有差异。
          </text>
        </view>

        <view class="voice-package-intro__section">
          <text class="voice-package-intro__section-title">亲人的声音更容易被认真分辨</text>
          <text class="voice-package-intro__section-text">
            越熟悉的人，越能听出细微差别。我们理解这份期待，也希望在开始前把可能的效果说清楚，避免你带着过高预期购买。
          </text>
        </view>
      </view>

      <voice-customer-service-card subtitle="请添加客服微信，先确认声音素材是否适合训练" />
    </view>
  </page-scaffold>
</template>

<script lang="ts">
export default {
  name: 'VoicePackagePage',
}
</script>

<script setup lang="ts">
import AppBar from '../../components/app-bar/app-bar.vue'
import PageScaffold from '../../components/page-scaffold/page-scaffold.vue'
import VoiceCustomerServiceCard from '../../components/voice-customer-service-card/voice-customer-service-card.vue'
</script>

<style lang="scss">
.voice-package-page {
  min-height: 100vh;
}

.voice-package-content {
  min-height: calc(100vh - 44px);
  box-sizing: border-box;
  padding: 18px 16px 48px;
  background: #efeff4;
}

.voice-package-intro {
  box-sizing: border-box;
  width: 100%;
  margin-bottom: 14px;
  padding: 18px 16px;
  border-radius: 10px;
  background: #ffffff;
}

.voice-package-intro__title,
.voice-package-intro__lead,
.voice-package-intro__section-title,
.voice-package-intro__section-text {
  display: block;
}

.voice-package-intro__title {
  color: #111111;
  font-size: 19px;
  line-height: 27px;
  font-weight: 700;
}

.voice-package-intro__lead {
  margin-top: 8px;
  color: #4b5563;
  font-size: 14px;
  line-height: 22px;
}

.voice-package-intro__section {
  margin-top: 16px;
}

.voice-package-intro__section-title {
  color: #222222;
  font-size: 15px;
  line-height: 22px;
  font-weight: 700;
}

.voice-package-intro__section-text {
  margin-top: 5px;
  color: #666666;
  font-size: 14px;
  line-height: 22px;
}
</style>
