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
      <voice-customer-service-card subtitle="添加客服微信，咨询声音模型定制服务" />
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
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px 0 48px;
  background: #efeff4;
}
</style>
