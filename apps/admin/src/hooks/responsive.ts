import { onMounted, onBeforeMount, onBeforeUnmount } from 'vue';
import { useDebounceFn } from '@vueuse/core';
import { useAppStore } from '@/store';
import { addEventListen, removeEventListen } from '@/utils/event';
import { applyDeviceClass, resolveDevice } from './device-mode';

const WIDTH = 992; // https://arco.design/vue/component/grid#responsivevalue

function queryDevice() {
  // 手机识别见 hooks/device-mode.ts：UA + 触摸 + 宽度，且支持人工覆盖
  return resolveDevice() === 'mobile';
}

export default function useResponsive(immediate?: boolean) {
  const appStore = useAppStore();
  function resizeHandler() {
    if (!document.hidden) {
      const isMobile = queryDevice();
      appStore.toggleDevice(isMobile ? 'mobile' : 'desktop');
      appStore.toggleMenu(isMobile);
      applyDeviceClass(isMobile ? 'mobile' : 'desktop');
    }
  }
  const debounceFn = useDebounceFn(resizeHandler, 100);
  onMounted(() => {
    if (immediate) debounceFn();
  });
  onBeforeMount(() => {
    addEventListen(window, 'resize', debounceFn);
  });
  onBeforeUnmount(() => {
    removeEventListen(window, 'resize', debounceFn);
  });
}

export { WIDTH };
