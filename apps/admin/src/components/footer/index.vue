<template>
  <a-layout-footer class="footer">{{ brand.adminTitle }}</a-layout-footer>
</template>

<script lang="ts" setup>
  import { brand } from '@/config/brand';
</script>

<style lang="less" scoped>
  .footer {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 40px;
    color: var(--color-text-2);
    text-align: center;
  }
</style>
