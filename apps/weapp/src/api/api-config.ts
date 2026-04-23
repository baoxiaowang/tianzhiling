const baseUrl = process.env.TARO_APP_API_BASE_URL ?? ''
const assetBaseUrl = process.env.TARO_APP_ASSET_BASE_URL ?? ''

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, '')
}

function normalizeConfiguredUrl(value: string) {
  const trimmed = value.trim()

  if (!trimmed) {
    return ''
  }

  return trimTrailingSlash(trimmed)
}

export const ApiConfig = {
  get baseUrl() {
    return normalizeConfiguredUrl(baseUrl)
  },

  get assetBaseUrl() {
    const configured = normalizeConfiguredUrl(assetBaseUrl)

    if (configured) {
      return configured
    }

    return this.baseUrl
  },
}
