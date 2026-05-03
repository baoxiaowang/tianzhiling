import Taro from '@tarojs/taro'
import { ApiConfig } from '../api/api-config'
import { ApiException } from '../api/api-exception'
import { ApiResponse } from '../api/api-response'
import { authSession, clearAuthSession } from '../auth/session'

export interface UploadedStorageAsset {
  objectKey: string
  publicUrl: string
}

function asRecord(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function asString(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback
}

function parseUploadedStorageAsset(value: unknown): UploadedStorageAsset {
  const raw = asRecord(value)

  return {
    publicUrl: asString(raw.publicUrl),
    objectKey: asString(raw.objectKey),
  }
}

function detectContentType(fileName: string) {
  const lower = fileName.toLowerCase()

  if (lower.endsWith('.png')) {
    return 'image/png'
  }
  if (lower.endsWith('.webp')) {
    return 'image/webp'
  }
  if (lower.endsWith('.gif')) {
    return 'image/gif'
  }
  if (lower.endsWith('.heic')) {
    return 'image/heic'
  }
  if (lower.endsWith('.heif')) {
    return 'image/heif'
  }
  if (lower.endsWith('.bmp')) {
    return 'image/bmp'
  }
  if (lower.endsWith('.m4a')) {
    return 'audio/mp4'
  }
  if (lower.endsWith('.aac')) {
    return 'audio/aac'
  }
  if (lower.endsWith('.mp3')) {
    return 'audio/mpeg'
  }
  if (lower.endsWith('.wav')) {
    return 'audio/wav'
  }
  if (lower.endsWith('.ogg')) {
    return 'audio/ogg'
  }
  if (lower.endsWith('.webm')) {
    return 'audio/webm'
  }

  return 'image/jpeg'
}

function extractFileName(filePath: string, fallbackPrefix = 'upload') {
  const [pathWithoutQuery] = filePath.split('?')
  const parts = pathWithoutQuery.split(/[\\/]/)
  const name = parts[parts.length - 1]?.trim()

  return name || `${fallbackPrefix}_${Date.now()}.bin`
}

function normalizePath(path: string) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`

  return ApiConfig.baseUrl
    ? `${ApiConfig.baseUrl}${normalizedPath}`
    : normalizedPath
}

function buildUploadHeader() {
  const session = authSession.value

  return {
    Accept: 'application/json',
    ...(session
      ? {
          Authorization: `${session.tokenType} ${session.accessToken}`,
        }
      : {}),
  }
}

function formatUploadError(error: unknown) {
  return error && typeof error === 'object' && 'errMsg' in error
    ? String(error.errMsg)
    : String(error ?? 'unknown')
}

async function uploadFileToNode(
  filePath: string,
  payload: { folder: string; fileName: string; contentType: string },
) {
  const response = await Taro.uploadFile({
    url: normalizePath('/api/storage/upload'),
    filePath,
    name: 'file',
    formData: payload,
    header: buildUploadHeader(),
    timeout: 120000,
  })

  const parsed = ApiResponse.fromRaw<Record<string, unknown>>(
    response.data,
    response.statusCode,
  )

  return parseUploadedStorageAsset(
    parsed.requireMapData<Record<string, unknown>>(),
  )
}

async function uploadFileWithAuthHandling(
  filePath: string,
  payload: { folder: string; fileName: string; contentType: string },
) {
  try {
    return await uploadFileToNode(filePath, payload)
  } catch (error) {
    if (error instanceof ApiException) {
      if (error.requiresReLogin) {
        await clearAuthSession()
      }

      throw error
    }

    throw new ApiException('图片上传失败，请稍后重试', {
      details: formatUploadError(error),
    })
  }
}

export async function uploadLocalImage(
  filePath: string,
  options: { folder?: string; fileName?: string } = {},
): Promise<UploadedStorageAsset> {
  return uploadLocalFile(filePath, {
    folder: options.folder?.trim() || 'avatars',
    fileName: options.fileName,
  })
}

export async function uploadLocalFile(
  filePath: string,
  options: { folder: string; fileName?: string; contentType?: string },
): Promise<UploadedStorageAsset> {
  const fileName = options.fileName?.trim() || extractFileName(filePath)
  const contentType = options.contentType?.trim() || detectContentType(fileName)
  const uploaded = await uploadFileWithAuthHandling(filePath, {
    folder: options.folder.trim(),
    fileName,
    contentType,
  })

  if (!uploaded.publicUrl || !uploaded.objectKey) {
    throw new ApiException('上传结果无效，请稍后重试')
  }

  return uploaded
}
