import { ApiConfig } from '../api/api-config'

export function resolvePublicAssetUrl(path: string) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`

  return ApiConfig.assetBaseUrl
    ? `${ApiConfig.assetBaseUrl}${normalizedPath}`
    : normalizedPath
}
