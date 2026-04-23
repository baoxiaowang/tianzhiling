function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, '')
}

export const ApiConfig = {
  get baseUrl() {
    const configured = ''

    if (configured) {
      return trimTrailingSlash(configured)
    }
    debugger
    return ''
  },
}
