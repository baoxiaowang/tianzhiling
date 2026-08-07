import { createApp } from 'vue'
import { silentWeappLogin } from './auth/login-hooks'
import { authSession, restoreAuthSession } from './auth/session'
import { ensureInnerAudioPlaybackOptions } from './utils/audio'
import { initSafeAreaInsets } from './utils/safe-area'
import { reportPerformanceEvent } from './utils/product-analytics'

import './app.scss'

declare const VOICE_TRAINING_TEST_MODE: boolean

const App = createApp({
  onLaunch() {
    const launchStartedAt = Date.now()
    initSafeAreaInsets()
    void ensureInnerAudioPlaybackOptions()
    reportPerformanceEvent('app_launch', 'app', Date.now() - launchStartedAt)

    // The isolated voice test page owns its login so stale production sessions
    // cannot block or redirect the test bootstrap.
    if (VOICE_TRAINING_TEST_MODE) {
      return
    }

    void restoreAuthSession().then(async () => {
      if (!authSession.value?.accessToken) {
        await silentWeappLogin()
      }

      reportPerformanceEvent(
        'route_visible',
        'app_session_ready',
        Date.now() - launchStartedAt,
        authSession.value?.accessToken ? 'authenticated' : 'guest',
      )
    })
  },
  // 入口组件不需要实现 render 方法，即使实现了也会被 taro 所覆盖
})

export default App
