export interface ApiResponse<T = unknown> {
  success: boolean;
  code: string;
  message: string;
  data: T;
  timestamp: number;
}

export function successResponse<T>(
  data: T,
  message = 'OK',
  code = 'OK'
): ApiResponse<T> {
  return {
    success: true,
    code,
    message,
    data,
    timestamp: Date.now(),
  };
}

export function errorResponse<T = null>(
  code: string,
  message: string,
  data: T = null as T
): ApiResponse<T> {
  return {
    success: false,
    code,
    message,
    data,
    timestamp: Date.now(),
  };
}

export function isApiResponse(value: unknown): value is ApiResponse<unknown> {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  return (
    typeof candidate.success === 'boolean' &&
    typeof candidate.code === 'string' &&
    typeof candidate.message === 'string' &&
    'data' in candidate &&
    typeof candidate.timestamp === 'number'
  );
}
