<template>
  <page-scaffold
    class="agreement-page"
    background="#f7f8fa"
    body-padding="0"
    :scroll="true"
    :safe-area-top="false"
  >
    <template #header>
      <app-bar :title="agreementDocument.title" background="#ffffff" border-color="#eeeeee" />
    </template>

    <view class="agreement-document">
      <view class="agreement-document__header">
        <text class="agreement-document__title">{{ agreementDocument.title }}</text>
        <text v-if="agreementDocument.updatedAt" class="agreement-document__meta">
          更新日期：{{ agreementDocument.updatedAt }}
        </text>
        <text v-if="agreementDocument.effectiveAt" class="agreement-document__meta">
          生效日期：{{ agreementDocument.effectiveAt }}
        </text>
      </view>

      <view class="agreement-document__content">
        <text
          v-for="(paragraph, index) in agreementDocument.paragraphs"
          :key="`${documentType}-${index}`"
          class="agreement-document__paragraph"
          :class="{ 'agreement-document__paragraph--heading': isHeading(paragraph) }"
        >
          {{ paragraph }}
        </text>
      </view>
    </view>
  </page-scaffold>
</template>

<script lang="ts">
export default {
  name: 'AgreementPage',
}
</script>

<script setup lang="ts">
import { useLoad } from '@tarojs/taro'
import { computed, ref } from 'vue'
import AppBar from '../../components/app-bar/app-bar.vue'
import PageScaffold from '../../components/page-scaffold/page-scaffold.vue'
import {
  getAgreementDocument,
  type AgreementDocumentType,
} from '../../legal/agreement-documents'

const documentType = ref<AgreementDocumentType>('service')

const agreementDocument = computed(() => getAgreementDocument(documentType.value))

function normalizeDocumentType(type: string | undefined): AgreementDocumentType {
  return type === 'privacy' ? 'privacy' : 'service'
}

function isHeading(value: string) {
  if (value.length > 42) {
    return false
  }

  return /^(导言|\d+(?:\.\d+)*[、\s].+|\d+、.+)$/.test(value)
}

useLoad((options) => {
  documentType.value = normalizeDocumentType(options.type)
})
</script>

<style lang="scss">
.agreement-page {
  min-height: 100vh;
}

.agreement-document {
  box-sizing: border-box;
  min-height: 100%;
  padding: 18px 18px 40px;
}

.agreement-document__header {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 18px 18px 16px;
  border-radius: 8px;
  background: #ffffff;
  box-shadow: 0 8px 22px rgba(15, 23, 42, 0.04);
}

.agreement-document__title {
  color: #1f2937;
  font-size: 20px;
  line-height: 28px;
  font-weight: 700;
}

.agreement-document__meta {
  color: #6b7280;
  font-size: 12px;
  line-height: 18px;
}

.agreement-document__content {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 14px;
  padding: 18px;
  border-radius: 8px;
  background: #ffffff;
}

.agreement-document__paragraph {
  color: #374151;
  font-size: 14px;
  line-height: 23px;
  word-break: break-word;
  white-space: pre-wrap;
}

.agreement-document__paragraph--heading {
  margin-top: 6px;
  color: #111827;
  font-size: 15px;
  line-height: 23px;
  font-weight: 700;
}
</style>
