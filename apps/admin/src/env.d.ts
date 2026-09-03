/// <reference types="vite/client" />
/// <reference types="vue/jsx" />
/// <reference types="vue-i18n" />
/// <reference types="vue-router" />

declare module '*.vue' {
  import { DefineComponent } from 'vue';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/ban-types
  const component: DefineComponent<{}, {}, any>;
  export default component;
}
interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string;
}

// 品牌编译期注入常量（见 config/vite.config.base.ts define）
declare const BRAND: string;
declare const BRAND_NAME: string;
declare const BRAND_COMPANY: string;
declare const BRAND_ADMIN_TITLE: string;
