import Taro from '@tarojs/taro'

const AGENT_CREATE_ROUTE = '/pages/agent-create/index'
const NAVIGATION_RETRY_DELAY_MS = 350

let navigationPromise: Promise<void> | null = null

interface OpenAgentCreatePageOptions {
  source?: 'voiceTraining'
}

export function openAgentCreatePage(options: OpenAgentCreatePageOptions = {}) {
  if (navigationPromise) {
    return navigationPromise
  }

  navigationPromise = navigateToAgentCreatePage(options).finally(() => {
    navigationPromise = null
  })

  return navigationPromise
}

async function navigateToAgentCreatePage(options: OpenAgentCreatePageOptions) {
  if (isAgentCreatePageActive()) {
    return
  }

  const route = buildAgentCreateRoute(options)

  try {
    await Taro.navigateTo({
      url: route,
    })
    return
  } catch (error) {
    if (!isNavigationTimeout(error)) {
      throw error
    }
  }

  await delay(NAVIGATION_RETRY_DELAY_MS)

  if (isAgentCreatePageActive()) {
    return
  }

  await Taro.navigateTo({
    url: route,
  })
}

function buildAgentCreateRoute(options: OpenAgentCreatePageOptions) {
  return options.source
    ? `${AGENT_CREATE_ROUTE}?source=${encodeURIComponent(options.source)}`
    : AGENT_CREATE_ROUTE
}

function isNavigationTimeout(error: unknown) {
  if (!error || typeof error !== 'object' || !('errMsg' in error)) {
    return false
  }

  return String(error.errMsg).toLowerCase().includes('navigateto:fail timeout')
}

function isAgentCreatePageActive() {
  const pages = Taro.getCurrentPages()
  const currentRoute = pages[pages.length - 1]?.route ?? ''

  return `/${currentRoute}` === AGENT_CREATE_ROUTE
}

function delay(durationMs: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, durationMs)
  })
}
