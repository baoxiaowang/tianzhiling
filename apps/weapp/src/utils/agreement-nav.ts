import Taro from '@tarojs/taro'
import type { AgreementDocumentType } from '../legal/agreement-documents'

export function openAgreementDocument(type: AgreementDocumentType) {
  return Taro.navigateTo({
    url: `/pages/agreement/index?type=${type}`,
  })
}
