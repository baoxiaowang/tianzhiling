<template>
  <div v-if="visible" class="app-update-notice">
    <span class="app-update-notice__text">
      后台已发布新版本，当前页面仍是旧版本（可能看不到最新改动）。
    </span>
    <a-button type="primary" size="small" @click="reload"> 立即刷新 </a-button>
  </div>
</template>

<script lang="ts" setup>
  /**
   * 新版本检测：后台发版后，仍停在旧页面的浏览器会提示刷新。
   *
   * 背景：管理端是 SPA，发版后只有「重新加载页面」才会拿到新的入口脚本；
   * 长期开着的标签页会一直跑旧代码，运营看到的现象就是「改了半天还是不行」。
   * 这里定期（默认 5 分钟，切回前台时也查一次）对比当前入口脚本与线上 index.html
   * 引用的入口脚本，不一致就提示刷新（不自动刷新，避免打断正在填的表单）。
   */
  import { onBeforeUnmount, onMounted, ref } from 'vue';

  const ENTRY_RE = /assets\/index\.[A-Za-z0-9_-]+\.js/;
  const CHECK_INTERVAL_MS = 5 * 60 * 1000;

  const visible = ref(false);
  let timer: ReturnType<typeof setInterval> | null = null;

  const currentEntry = (): string | null => {
    const matched = Array.from(document.querySelectorAll('script[src]'))
      .map((script) =>
        ((script as HTMLScriptElement).src || '').match(ENTRY_RE)
      )
      .find((hit) => !!hit);
    return matched ? matched[0] : null;
  };

  const latestEntry = async (): Promise<string | null> => {
    try {
      const res = await fetch(`${window.location.origin}/`, {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache' },
      });
      if (!res.ok) return null;
      const html = await res.text();
      return html.match(ENTRY_RE)?.[0] || null;
    } catch (error) {
      return null;
    }
  };

  const check = async () => {
    if (visible.value) return;
    const current = currentEntry();
    if (!current) return;
    const latest = await latestEntry();
    if (latest && latest !== current) visible.value = true;
  };

  const reload = () => {
    window.location.reload();
  };

  const onVisibilityChange = () => {
    if (!document.hidden) check();
  };

  onMounted(() => {
    // 供验收脚本/排查手动触发
    (window as unknown as Record<string, unknown>).tzlCheckAppUpdate = check;
    timer = setInterval(check, CHECK_INTERVAL_MS);
    document.addEventListener('visibilitychange', onVisibilityChange);
    check();
  });

  onBeforeUnmount(() => {
    if (timer) clearInterval(timer);
    document.removeEventListener('visibilitychange', onVisibilityChange);
  });
</script>

<style lang="less" scoped>
  .app-update-notice {
    position: fixed;
    bottom: 24px;
    left: 50%;
    z-index: 1200;
    display: flex;
    gap: 12px;
    align-items: center;
    max-width: calc(100vw - 32px);
    padding: 10px 14px;
    background: var(--color-bg-popup);
    border: 1px solid var(--color-border-2);
    border-radius: 10px;
    box-shadow: 0 6px 20px rgb(0 0 0 / 12%);
    transform: translateX(-50%);
  }

  .app-update-notice__text {
    color: var(--color-text-1);
    font-size: 13px;
    line-height: 20px;
  }

  // 手机端：底部标签栏高 56px，提示条往上让一点
  :global(body.tzl-mobile) .app-update-notice {
    bottom: 68px;
  }
</style>
