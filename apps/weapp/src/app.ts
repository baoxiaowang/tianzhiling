import { createApp } from 'vue'
import { restoreAuthSession } from './auth/session'
import { initSafeAreaInsets } from './utils/safe-area'

import './app.scss'

const App = createApp({
  onLaunch() {
    initSafeAreaInsets()
    void restoreAuthSession()
  },
  onShow() {
  },
  // 入口组件不需要实现 render 方法，即使实现了也会被 taro 所覆盖
})

export default App
