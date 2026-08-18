import type { RouteLocationNormalizedLoaded, Router } from 'vue-router';
import type { ComposerTranslation } from 'vue-i18n';

declare module '@vue/runtime-core' {
  interface ComponentCustomProperties {
    $route: RouteLocationNormalizedLoaded;
    $router: Router;
    $t: ComposerTranslation;
  }
}

export {};
