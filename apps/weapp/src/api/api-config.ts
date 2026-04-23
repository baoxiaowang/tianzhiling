const baseUrl = ''

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, '')
}

export const ApiConfig = {
  get baseUrl() {
    const configured = baseUrl

    if (configured) {
      return trimTrailingSlash(configured)
    }
    return ''
  },

  get assetBaseUrl() {
    const configured = this.baseUrl

    if (configured) {
      return trimTrailingSlash(configured)
    }
    return ''
  },
}
