import Taro from '@tarojs/taro'

export type ChatImageSourceType = 'album' | 'camera'

export interface PickedChatImage {
  filePath: string
  fileName: string
  mimeType: string
}

type ImageSendAction = 'edit' | 'send'

export function isChatImageOperationCanceled(error: unknown) {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'errMsg' in error &&
      String(error.errMsg).toLowerCase().includes('cancel')
  )
}

export function guessImageMimeType(fileNameOrPath: string) {
  const lower = fileNameOrPath.toLowerCase()
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

export async function pickChatImageForSend(
  sourceType: ChatImageSourceType
): Promise<PickedChatImage | null> {
  const result = await Taro.chooseImage({
    count: 1,
    sizeType: ['compressed'],
    sourceType: [sourceType],
  })
  const filePath = result.tempFilePaths[0]
  if (!filePath) {
    return null
  }

  const nextAction = await showImageSendOptions()
  const targetFilePath =
    nextAction === 'edit' ? await editChatImage(filePath) : filePath

  if (!targetFilePath) {
    return null
  }

  const fileName =
    nextAction === 'edit'
      ? `chat_image_${Date.now()}.jpg`
      : extractFileName(targetFilePath)

  return {
    filePath: targetFilePath,
    fileName,
    mimeType: guessImageMimeType(fileName || targetFilePath),
  }
}

function extractFileName(filePath: string) {
  const [pathWithoutQuery] = filePath.split('?')
  const parts = pathWithoutQuery.split(/[\\/]/)
  return parts[parts.length - 1]?.trim() || `chat_image_${Date.now()}.jpg`
}

async function editChatImage(filePath: string) {
  const result = await Taro.editImage({
    src: filePath,
  })

  return result.tempFilePath
}

async function showImageSendOptions(): Promise<ImageSendAction> {
  const result = await Taro.showActionSheet({
    itemList: ['编辑后发送', '直接发送'],
  })

  return result.tapIndex === 0 ? 'edit' : 'send'
}
