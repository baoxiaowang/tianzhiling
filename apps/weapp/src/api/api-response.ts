import { ApiException } from './api-exception'

interface RawApiResponse<T = unknown> {
  success?: boolean
  code?: string
  message?: string
  data?: T
}

export class ApiResponse<T = unknown> {
  private constructor(
    public readonly success: boolean,
    public readonly code: string | undefined,
    public readonly message: string,
    public readonly data: T | undefined
  ) {}

  static fromRaw<T>(raw: unknown, statusCode?: number) {
    const decoded = this.decode<T>(raw)

    if (!decoded) {
      throw new ApiException(
        statusCode !== undefined && statusCode >= 400
          ? '请求失败，请稍后重试'
          : '服务返回了无法识别的数据',
        {
          details: `statusCode=${statusCode ?? '-'} rawType=${typeof raw}`,
        }
      )
    }

    const success = decoded.success ?? this.isSuccessStatus(statusCode)
    const code = decoded.code
    const message = decoded.message ?? this.fallbackMessage(statusCode)

    if (!success) {
      throw ApiException.fromCode(
        code,
        message,
        `statusCode=${statusCode ?? '-'} code=${code ?? '-'} message=${message}`
      )
    }

    return new ApiResponse<T>(success, code, message, decoded.data)
  }

  requireMapData<R extends Record<string, unknown>>() {
    if (!this.data || typeof this.data !== 'object' || Array.isArray(this.data)) {
      return {} as R
    }

    return this.data as R
  }

  private static decode<T>(raw: unknown): RawApiResponse<T> | null {
    if (!raw) {
      return {}
    }

    if (typeof raw === 'string') {
      const trimmed = raw.trim()

      if (!trimmed) {
        return {}
      }

      try {
        return JSON.parse(trimmed) as RawApiResponse<T>
      } catch {
        return null
      }
    }

    if (typeof raw === 'object' && !Array.isArray(raw)) {
      return raw as RawApiResponse<T>
    }

    return null
  }

  private static isSuccessStatus(statusCode?: number) {
    return statusCode !== undefined && statusCode >= 200 && statusCode < 300
  }

  private static fallbackMessage(statusCode?: number) {
    if (statusCode === undefined) {
      return '请求失败'
    }

    if (statusCode >= 500) {
      return '服务开小差了，请稍后重试'
    }

    return '请求失败'
  }
}
