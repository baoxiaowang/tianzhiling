import Taro from '@tarojs/taro'
import { ApiConfig } from './api-config'
import { ApiException } from './api-exception'
import { ApiResponse } from './api-response'
import { authSession, clearAuthSession } from '../auth/session'

type HttpMethod = 'GET' | 'POST' | 'PATCH'

interface RequestOptions {
  method?: HttpMethod
  data?: Record<string, unknown>
}

function normalizePath(path: string) {
  if (/^https?:\/\//.test(path)) {
    return path
  }

  const normalizedPath = path.startsWith('/') ? path : `/${path}`

  return ApiConfig.baseUrl ? `${ApiConfig.baseUrl}${normalizedPath}` : normalizedPath
}

export async function requestMap<T>(
  path: string,
  options: RequestOptions = {}
) {
  const session = authSession.value
  console.log('11', normalizePath(path))
  try {
    const response = await Taro.request({
      url: normalizePath(path),
      method: options.method ?? 'GET',
      data: options.data,
      timeout: 120000,
      header: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(session
          ? {
              Authorization: `${session.tokenType} ${session.accessToken}`,
            }
          : {}),
      },
    })

    const parsed = ApiResponse.fromRaw<T>(response.data, response.statusCode)

    return parsed.requireMapData<T>()
  } catch (error) {
    if (error instanceof ApiException) {
      if (error.requiresReLogin) {
        await clearAuthSession()
      }

      throw error
    }

    const details =
      error && typeof error === 'object' && 'errMsg' in error
        ? String(error.errMsg)
        : String(error ?? 'unknown')

    throw new ApiException(
      '无法连接到服务端，请确认 node 服务已启动并检查代理或接口地址配置',
      { details }
    )
  }
}

export function get<T>(path: string) {
  return requestMap<T>(path)
}

export function post<T>(
  path: string,
  data?: Record<string, unknown>
) {
  return requestMap<T>(path, { method: 'POST', data })
}

export function patch<T>(
  path: string,
  data?: Record<string, unknown>
) {
  return requestMap<T>(path, { method: 'PATCH', data })
}
