<template>
  <div class="voice-timbre-page">
    <a-card class="voice-timbre-page__card" :bordered="false">
      <template #title>音色管理</template>
      <a-empty description="音色管理功能开发中" />
    </a-card>
  </div>
</template>

<script lang="ts" setup></script>

<style scoped lang="less">
  .voice-timbre-page {
    padding: 20px;
  }

  .voice-timbre-page__card {
    min-height: calc(100vh - 156px);
  }
</style>
