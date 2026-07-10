<template>
  <div class="post-page">
    <post-list-panel title="动态管理" />
  </div>
</template>

<script lang="ts" setup>
  import PostListPanel from '@/views/post/components/post-list-panel.vue';
</script>

<script lang="ts">
  export default {
    name: 'PostList',
  };
</script>

<style lang="less" scoped>
  .post-page {
    min-height: 100%;
    padding: 16px 20px;
    background: var(--color-fill-2);
  }
</style>
