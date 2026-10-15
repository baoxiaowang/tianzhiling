import { createApp } from 'vue';
import ArcoVue from '@arco-design/web-vue';
import ArcoVueIcon from '@arco-design/web-vue/es/icon';
import globalComponents from '@/components';
import router from './router';
import store from './store';
import i18n from './locale';
import directive from './directive';
// import './mock';
import App from './App.vue';
// Styles are imported via arco-plugin. See config/plugin/arcoStyleImport.ts in the directory for details
// 样式通过 arco-plugin 插件导入。详见目录文件 config/plugin/arcoStyleImport.ts
// https://arco.design/docs/designlab/use-theme-package
import '@/assets/style/global.less';
// 响应式适配层（手机 / 平板 / 小笔记本 / 大屏）：必须排在全局样式之后
import '@/assets/style/responsive.less';
import '@/api/interceptor';
import { brand } from './config/brand';
import { applyDeviceClass, resolveDevice } from './hooks/device-mode';

// 浏览器标签页标题跟随品牌（index.html 中为静态默认值）
document.title = brand.adminTitle;

// 手机 / 电脑识别（UA + 触摸 + 宽度，支持 ?view=mobile|desktop 与头像菜单手动切换）
// 结果打到 body 上，手机版样式集中在 responsive.less 的 body.tzl-mobile 下
applyDeviceClass(resolveDevice());

const app = createApp(App);

app.use(ArcoVue, {});
app.use(ArcoVueIcon);

app.use(router);
app.use(store);
app.use(i18n);
app.use(globalComponents);
app.use(directive);

app.mount('#app');
