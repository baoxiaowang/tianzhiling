import Taro from '@tarojs/taro'

const AGENT_CREATE_ROUTE = '/pages/agent-create/index'
const NAVIGATION_RETRY_DELAY_MS = 350

let navigationPromise: Promise<void> | null = null

export function openAgentCreatePage() {
  if (navigationPromise) {
    return navigationPromise
  }

  navigationPromise = navigateToAgentCreatePage().finally(() => {
    navigationPromise = null
  })

  return navigationPromise
}

async function navigateToAgentCreatePage() {
  if (isAgentCreatePageActive()) {
    return
  }

  try {
    await Taro.navigateTo({
      url: AGENT_CREATE_ROUTE,
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
    url: AGENT_CREATE_ROUTE,
  })
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
