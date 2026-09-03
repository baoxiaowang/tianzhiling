import Taro from '@tarojs/taro'
import { ApiConfig } from './api-config'
import { ApiException } from './api-exception'
import { ApiResponse } from './api-response'
import { authSession, clearAuthSession } from '../auth/session'

type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE'

interface RequestOptions {
  method?: HttpMethod
  data?: Record<string, unknown>
  timeout?: number
  headers?: Record<string, string>
}

const DEFAULT_READ_TIMEOUT = 8000
const DEFAULT_WRITE_TIMEOUT = 120000

type TaroPerformanceApi = typeof Taro & {
  reportEvent?: (eventId: string, data: TaroGeneral.IAnyObject) => void
  reportAnalytics?: (eventName: string, data: TaroGeneral.IAnyObject) => void
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
  const url = normalizePath(path)
  const method = options.method ?? 'GET'
  const startedAt = Date.now()
  let statusCode = 0
  try {
    const response = await Taro.request({
      url,
      method,
      data: options.data,
      timeout:
        options.timeout ??
        (method === 'GET' ? DEFAULT_READ_TIMEOUT : DEFAULT_WRITE_TIMEOUT),
      header: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...options.headers,
        ...(session
          ? {
              Authorization: `${session.tokenType} ${session.accessToken}`,
            }
          : {}),
      },
    })
    statusCode = response.statusCode

    const parsed = ApiResponse.fromRaw<T>(response.data, response.statusCode)
    const data = parsed.requireMapData<T>()
    reportApiPerformance(path, method, startedAt, statusCode, true, {
      requestId: readResponseHeader(response.header, 'x-request-id'),
      serverDurationMs: parseServerDuration(
        readResponseHeader(response.header, 'server-timing'),
      ),
    })
    return data
  } catch (error) {
    reportApiPerformance(path, method, startedAt, statusCode, false)
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
      '网络连接不稳定，请稍后重试',
      { details: `${method} ${url}: ${details}` }
    )
  }
}

function reportApiPerformance(
  path: string,
  method: HttpMethod,
  startedAt: number,
  statusCode: number,
  succeeded: boolean,
  timing: { requestId?: string; serverDurationMs?: number } = {},
) {
  if (succeeded && Math.random() > 0.2) {
    return
  }

  const analyticsApi = Taro as TaroPerformanceApi
  const report = analyticsApi.reportEvent ?? analyticsApi.reportAnalytics

  if (typeof report !== 'function') {
    return
  }

  const metricPath = path
    .split('?')[0]
    .replace(/[0-9a-f]{24}/gi, ':id')
    .replace(/\/[0-9]+(?=\/|$)/g, '/:id')

  try {
    report.call(analyticsApi, 'api_performance', {
      api_path: metricPath.slice(0, 120),
      method,
      duration_ms: Math.max(0, Date.now() - startedAt),
      status_code: statusCode,
      succeeded: succeeded ? 1 : 0,
      request_id: timing.requestId?.slice(0, 64) ?? '',
      server_duration_ms: timing.serverDurationMs ?? -1,
    })
  } catch {
    // Analytics must never affect a product request.
  }
}

function readResponseHeader(
  headers: Record<string, unknown> | undefined,
  targetName: string,
) {
  if (!headers) {
    return undefined
  }

  const normalizedTarget = targetName.toLowerCase()
  const match = Object.entries(headers).find(
    ([name]) => name.toLowerCase() === normalizedTarget,
  )
  return match && typeof match[1] === 'string' ? match[1] : undefined
}

function parseServerDuration(value?: string) {
  const match = value?.match(/(?:^|,)\s*app;dur=([\d.]+)/i)
  const parsed = match ? Number(match[1]) : Number.NaN
  return Number.isFinite(parsed) ? parsed : undefined
}

export function get<T>(path: string) {
  return requestMap<T>(path)
}

export function getWithOptions<T>(path: string, options: RequestOptions = {}) {
  return requestMap<T>(path, { ...options, method: 'GET' })
}

export function post<T>(
  path: string,
  data?: Record<string, unknown>,
  options: Pick<RequestOptions, 'headers' | 'timeout'> = {},
) {
  return requestMap<T>(path, { ...options, method: 'POST', data })
}

export function patch<T>(
  path: string,
  data?: Record<string, unknown>
) {
  return requestMap<T>(path, { method: 'PATCH', data })
}

export function del<T>(path: string) {
  return requestMap<T>(path, { method: 'DELETE' })
}
