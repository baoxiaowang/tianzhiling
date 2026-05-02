import { createApp } from 'vue'
import { silentWeappLogin } from './auth/login-hooks'
import { authSession, restoreAuthSession } from './auth/session'
import { initSafeAreaInsets } from './utils/safe-area'

import './app.scss'

const App = createApp({
  onLaunch() {
    initSafeAreaInsets()
    void restoreAuthSession().then(async () => {
      if (!authSession.value?.accessToken) {
        await silentWeappLogin()
      }
    })
  },
  onShow() {
  },
  // 入口组件不需要实现 render 方法，即使实现了也会被 taro 所覆盖
})

export default App
