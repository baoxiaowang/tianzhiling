import Taro from '@tarojs/taro'
import { post } from '../api/api-client'
import { ApiException } from '../api/api-exception'

interface SignedUploadTicket {
  uploadUrl: string
  publicUrl: string
  objectKey: string
  method: string
  headers: Record<string, string>
}

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

function parseHeaders(value: unknown) {
  const raw = asRecord(value)
  const headers: Record<string, string> = {}

  Object.keys(raw).forEach((key) => {
    const value = raw[key]
    if (typeof value === 'string' && key.trim()) {
      headers[key.trim()] = value.trim()
    }
  })

  return headers
}

function parseSignedUploadTicket(value: unknown): SignedUploadTicket {
  const raw = asRecord(value)

  return {
    uploadUrl: asString(raw.uploadUrl),
    publicUrl: asString(raw.publicUrl),
    objectKey: asString(raw.objectKey),
    method: asString(raw.method, 'PUT'),
    headers: parseHeaders(raw.headers),
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

  return 'image/jpeg'
}

function extractFileName(filePath: string) {
  const [pathWithoutQuery] = filePath.split('?')
  const parts = pathWithoutQuery.split(/[\\/]/)
  const name = parts[parts.length - 1]?.trim()

  return name || `agent_avatar_${Date.now()}.jpg`
}

function hasContentType(headers: Record<string, string>) {
  return Object.keys(headers).some((key) => key.toLowerCase() === 'content-type')
}

async function createCosSignedUpload(
  fileName: string,
  folder: string,
  contentType: string,
) {
  const data = await post<Record<string, unknown>>('/api/storage/cos/sign-upload', {
    fileName,
    folder,
    contentType,
  })

  return parseSignedUploadTicket(data)
}

async function readFileAsArrayBuffer(filePath: string) {
  return new Promise<ArrayBuffer>((resolve, reject) => {
    Taro.getFileSystemManager().readFile({
      filePath,
      success(result) {
        resolve(result.data as ArrayBuffer)
      },
      fail(error) {
        reject(error)
      },
    })
  })
}

async function putFileToSignedUrl(
  ticket: SignedUploadTicket,
  filePath: string,
  contentType: string,
) {
  const data = await readFileAsArrayBuffer(filePath)
  const headers = {
    ...ticket.headers,
    ...(hasContentType(ticket.headers) ? {} : { 'Content-Type': contentType }),
  }

  const response = await Taro.request({
    url: ticket.uploadUrl,
    method: 'PUT',
    data,
    header: headers,
    timeout: 120000,
  })

  if (![200, 201, 204].includes(response.statusCode)) {
    throw new ApiException('图片上传失败，请稍后重试', {
      details: `statusCode=${response.statusCode} objectKey=${ticket.objectKey}`,
    })
  }
}

export async function uploadLocalImage(
  filePath: string,
  options: { folder?: string; fileName?: string } = {},
): Promise<UploadedStorageAsset> {
  const fileName = options.fileName?.trim() || extractFileName(filePath)
  const contentType = detectContentType(fileName)
  const ticket = await createCosSignedUpload(
    fileName,
    options.folder?.trim() || 'avatars',
    contentType,
  )

  if (!ticket.uploadUrl || !ticket.publicUrl || !ticket.objectKey) {
    throw new ApiException('上传地址生成失败，请稍后重试')
  }

  if (ticket.method.toUpperCase() !== 'PUT') {
    throw new ApiException('暂不支持当前上传方式，请稍后重试')
  }

  await putFileToSignedUrl(ticket, filePath, contentType)

  return {
    objectKey: ticket.objectKey,
    publicUrl: ticket.publicUrl,
  }
}
