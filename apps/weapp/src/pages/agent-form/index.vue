<template>
  <page-scaffold
    class="agent-form-page"
    background="#efeff4"
    body-padding="0"
    :scroll="true"
    :safe-area-top="false"
  >
    <template #header>
      <app-bar
        title="基本信息"
        background="#f6f6f6"
        border-color="#ededf2"
      />
    </template>

    <view v-if="isCheckingAuth || isLoading" class="agent-form-state">
      <view class="agent-form-state__dot" />
      <text class="agent-form-state__text">
        {{ isCheckingAuth ? '正在恢复会话...' : '正在加载资料...' }}
      </text>
    </view>

    <view v-else-if="showBlockingError" class="agent-form-state">
      <text class="agent-form-state__title">资料暂时加载失败</text>
      <text class="agent-form-state__text">{{ loadError }}</text>
      <view class="agent-form-state__button" @tap="handleRetry">重试</view>
    </view>

    <view v-else class="agent-form">
      <view class="agent-form-spacer" />

      <view class="agent-form-section">
        <nut-cell
          title="头像"
          is-link
          center
          class="agent-form-cell agent-form-cell--avatar"
          @click="handleAvatarTap"
        >
          <template #desc>
            <view class="agent-form-avatar">
              <image
                v-if="displayAvatar"
                class="agent-form-avatar__image"
                :src="displayAvatar"
                mode="aspectFill"
              />
              <view
                v-else
                class="agent-form-avatar__fallback"
                :class="avatarFallbackClass"
              >
                {{ avatarFallback }}
              </view>
              <text v-if="isUploadingAvatar" class="agent-form-avatar__loading">上传中</text>
            </view>
          </template>
        </nut-cell>

        <nut-cell
          v-for="(item, index) in infoRows"
          :key="item.field"
          :title="item.label"
          is-link
          center
          class="agent-form-cell"
          :class="{
            'agent-form-cell--last': index === infoRows.length - 1,
            'agent-form-cell--description': item.field === 'description',
          }"
          @click="handleInfoRowTap(item.field)"
        >
          <template #desc>
            <text
              class="agent-form-cell__value"
              :class="{ 'agent-form-cell__value--placeholder': item.isPlaceholder }"
            >
              {{ item.value }}
            </text>
          </template>
        </nut-cell>
      </view>

      <view class="agent-form-spacer" />

      <view
        class="agent-form-delete"
        :class="{ 'agent-form-delete--disabled': isDeletingAgent }"
        @tap="handleDeleteTap"
      >
        <text class="agent-form-delete__text">{{ isDeletingAgent ? '删除中' : '删除' }}</text>
        <Del size="17" color="#d81e06" />
      </view>
    </view>

    <view
      v-if="editorVisible"
      class="agent-form-editor-layer"
      @tap="closeEditor"
    >
      <view
        class="agent-form-editor"
        :style="editorPanelStyle"
        @tap.stop
      >
        <view class="agent-form-editor__header">
          <view class="agent-form-editor__action" @tap="closeEditor">取消</view>
          <text class="agent-form-editor__title">{{ editorTitle }}</text>
          <view
            class="agent-form-editor__action agent-form-editor__action--primary"
            :class="{ 'agent-form-editor__action--disabled': isSavingProfile }"
            @tap="submitEditor"
          >
            {{ isSavingProfile ? '保存中' : '保存' }}
          </view>
        </view>

        <textarea
          v-if="editorMultiline"
          class="agent-form-editor__textarea"
          :value="editorValue"
          :maxlength="editorMaxLength"
          :placeholder="editorPlaceholder"
          :disabled="isSavingProfile"
          :auto-height="false"
          :adjust-position="false"
          cursor-spacing="16"
          @input="handleEditorInput"
          @keyboardheightchange="handleKeyboardHeightChange"
        />
        <input
          v-else
          class="agent-form-editor__input"
          :value="editorValue"
          :maxlength="editorMaxLength"
          :placeholder="editorPlaceholder"
          :disabled="isSavingProfile"
          :adjust-position="false"
          cursor-spacing="16"
          @input="handleEditorInput"
          @keyboardheightchange="handleKeyboardHeightChange"
          @confirm="submitEditor"
        />
        <text class="agent-form-editor__hint">
          {{ editorHint }}
        </text>
      </view>
    </view>

    <nut-popup
      v-model:visible="datePickerVisible"
      class="agent-form-date-popup"
      position="bottom"
      round
      :z-index="10000"
      :close-on-click-overlay="!isSavingProfile"
      :safe-area-inset-bottom="true"
    >
      <nut-date-picker
        v-model="datePickerValue"
        type="date"
        :title="datePickerTitle"
        ok-text="确定"
        cancel-text="取消"
        :min-date="datePickerMinDate"
        :max-date="datePickerMaxDate"
        :is-show-chinese="true"
        @confirm="confirmDatePicker"
        @cancel="closeDatePicker"
      />
    </nut-popup>
  </page-scaffold>
</template>

<script lang="ts">
export default {
  name: 'AgentFormPage',
}
</script>

<script setup lang="ts">
import Taro, { useLoad } from '@tarojs/taro'
import { Del } from '@nutui/icons-vue-taro'
import { computed, ref } from 'vue'
import type { UpdateAgentProfileDTO } from '@tzl/shared'
import { ApiException } from '../../api/api-exception'
import {
  deleteAgent,
  getAgentDetail,
  updateAgentAvatar,
  updateAgentProfile,
  type AgentSummary,
} from '../../apis/agent'
import { uploadLocalImage } from '../../apis/storage'
import { clearAuthSession } from '../../auth/session'
import AppBar from '../../components/app-bar/app-bar.vue'
import PageScaffold from '../../components/page-scaffold/page-scaffold.vue'
import { ensureAuthenticatedSession, redirectToAuthPage } from '../../utils/auth-guard'

type EditableAgentField =
  | 'name'
  | 'sex'
  | 'iCallAgent'
  | 'agentCallMe'
  | 'description'
  | 'birthday'
  | 'deathDate'

interface InfoRow {
  label: string
  value: string
  field: EditableAgentField
  isPlaceholder?: boolean
}

interface TextEditorConfig {
  field: TextEditableAgentField
  title: string
  initialValue: string
  placeholder: string
  maxLength: number
  successMessage: string
  multiline?: boolean
  allowEmpty?: boolean
}

type TextEditableAgentField = Exclude<
  EditableAgentField,
  'sex' | 'birthday' | 'deathDate'
>
type DateEditableAgentField = Extract<EditableAgentField, 'birthday' | 'deathDate'>

const agent = ref<AgentSummary | null>(null)
const agentId = ref('')
const fallbackName = ref('')
const fallbackAvatar = ref('')
const fallbackSex = ref(0)
const fallbackAgentCallMe = ref('')
const fallbackICallAgent = ref('')
const fallbackPreview = ref('')
const fallbackCreatedAt = ref<Date | null>(null)
const isCheckingAuth = ref(true)
const isLoading = ref(false)
const isUploadingAvatar = ref(false)
const isSavingProfile = ref(false)
const isDeletingAgent = ref(false)
const keyboardHeight = ref(0)
const loadError = ref('')

const editorVisible = ref(false)
const editorField = ref<TextEditableAgentField | ''>('')
const editorTitle = ref('')
const editorValue = ref('')
const editorPlaceholder = ref('')
const editorMaxLength = ref(30)
const editorMultiline = ref(false)
const editorAllowEmpty = ref(false)
const editorSuccessMessage = ref('')
const datePickerVisible = ref(false)
const datePickerField = ref<DateEditableAgentField | ''>('')
const datePickerTitle = ref('')
const datePickerValue = ref(new Date())
const datePickerMinDate = new Date(1900, 0, 1)
const datePickerMaxDate = new Date()

const displayName = computed(() => {
  const name = agent.value?.name.trim() || fallbackName.value.trim()
  return name || '未命名智能体'
})
const displayAvatar = computed(() => {
  return agent.value?.avatar.trim() || fallbackAvatar.value.trim()
})
const displaySex = computed(() => {
  return agent.value?.sex ?? fallbackSex.value
})
const avatarFallback = computed(() => displayName.value.slice(0, 1))
const avatarFallbackClass = computed(() => {
  return displaySex.value === 1
    ? 'agent-form-avatar__fallback--male'
    : 'agent-form-avatar__fallback--female'
})
const hasFallbackSnapshot = computed(() => {
  return Boolean(
    fallbackName.value.trim() ||
      fallbackAvatar.value.trim() ||
      fallbackPreview.value.trim() ||
      fallbackAgentCallMe.value.trim() ||
      fallbackICallAgent.value.trim(),
  )
})
const showBlockingError = computed(() => {
  return Boolean(loadError.value && !agent.value && !hasFallbackSnapshot.value)
})
const descriptionValue = computed(() => {
  const description = agent.value?.description.trim() || fallbackPreview.value.trim()
  return cleanPreview(description)
})
const infoRows = computed<InfoRow[]>(() => {
  const iCallAgent = agent.value?.iCallAgent.trim() || fallbackICallAgent.value.trim()
  const agentCallMe = agent.value?.agentCallMe.trim() || fallbackAgentCallMe.value.trim()
  const birthday = agent.value?.birthday ?? null
  const deathDate = agent.value?.deathDate ?? null

  return [
    {
      label: '备注',
      value: displayName.value,
      field: 'name',
    },
    {
      label: '性别',
      value: displaySex.value === 1 ? '男' : '女',
      field: 'sex',
    },
    {
      label: '你对 TA 的称呼',
      value: iCallAgent || '去设置',
      field: 'iCallAgent',
      isPlaceholder: !iCallAgent,
    },
    {
      label: 'TA 对你的称呼',
      value: agentCallMe || '去设置',
      field: 'agentCallMe',
      isPlaceholder: !agentCallMe,
    },
    {
      label: '生日',
      value: formatDate(birthday) || '去设置',
      field: 'birthday',
      isPlaceholder: !birthday,
    },
    {
      label: '离开日期',
      value: formatDate(deathDate) || '去设置',
      field: 'deathDate',
      isPlaceholder: !deathDate,
    },
  ]
})
const editorHint = computed(() => {
  return `${editorValue.value.trim().length}/${editorMaxLength.value}`
})
const editorPanelStyle = computed(() => {
  if (keyboardHeight.value <= 0) {
    return {
      paddingBottom: '20px',
    }
  }

  return {
    paddingBottom: `${keyboardHeight.value + 20}px`,
  }
})

useLoad((options) => {
  agentId.value = decodeRouteParam(options?.agentId)
  fallbackName.value = decodeRouteParam(options?.agentName)
  fallbackAvatar.value = decodeRouteParam(options?.agentAvatar)
  fallbackSex.value = Number.parseInt(decodeRouteParam(options?.agentSex), 10) || 0
  fallbackAgentCallMe.value = decodeRouteParam(options?.agentCallMe)
  fallbackICallAgent.value = decodeRouteParam(options?.iCallAgent)
  fallbackPreview.value = decodeRouteParam(options?.preview)
  fallbackCreatedAt.value = parseDate(decodeRouteParam(options?.createdAt))

  void preparePage()
})

function decodeRouteParam(value?: string) {
  if (typeof value !== 'string') {
    return ''
  }

  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function parseDate(value: string) {
  if (!value.trim()) {
    return null
  }

  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function cleanPreview(value: string) {
  const segments = value
    .split('</fenge>')
    .map((item) => item.trim())
    .filter(Boolean)
  const raw = segments.length ? segments[segments.length - 1] : value.trim()

  return raw.replace(/<[^>]+>/g, '').trim()
}

function padDatePart(value: number) {
  return String(value).padStart(2, '0')
}

function formatDate(value: Date | null) {
  if (!value) {
    return ''
  }

  return `${value.getFullYear()} 年 ${value.getMonth() + 1} 月 ${value.getDate()} 日`
}

function toApiDateValue(value: Date) {
  return `${value.getFullYear()}-${padDatePart(value.getMonth() + 1)}-${padDatePart(value.getDate())}`
}

function showToast(title: string) {
  void Taro.showToast({
    title,
    icon: 'none',
    duration: 1800,
  })
}

function isUserCanceled(error: unknown) {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'errMsg' in error &&
      String(error.errMsg).toLowerCase().includes('cancel'),
  )
}

async function redirectToAuth(message?: string) {
  await clearAuthSession()

  if (message) {
    showToast(message)
    await new Promise((resolve) => setTimeout(resolve, 500))
  }

  await redirectToAuthPage()
}

async function preparePage() {
  isCheckingAuth.value = true
  const authenticated = await ensureAuthenticatedSession()

  if (!authenticated) {
    await redirectToAuthPage()
    return
  }

  isCheckingAuth.value = false
  await loadAgentDetail()
}

async function loadAgentDetail() {
  if (!agentId.value) {
    loadError.value = '缺少联系人资料，请返回通讯录重新进入'
    return
  }

  isLoading.value = true
  loadError.value = ''

  try {
    agent.value = await getAgentDetail(agentId.value)
  } catch (error) {
    if (error instanceof ApiException && error.requiresReLogin) {
      await redirectToAuth(error.message)
      return
    }

    loadError.value =
      error instanceof ApiException
        ? error.message
        : '资料加载失败，请稍后重试'
  } finally {
    isLoading.value = false
  }
}

function handleRetry() {
  void loadAgentDetail()
}

async function editAvatarImage(filePath: string) {
  const result = await Taro.editImage({
    src: filePath,
  })

  return result.tempFilePath
}

async function handleAvatarTap() {
  if (isUploadingAvatar.value || isSavingProfile.value || !agentId.value) {
    return
  }

  try {
    const result = await Taro.chooseImage({
      count: 1,
      sizeType: ['compressed'],
      sourceType: ['album'],
    })

    const filePath = result.tempFilePaths[0]
    if (!filePath) {
      return
    }

    const editedFilePath = await editAvatarImage(filePath)
    if (!editedFilePath) {
      return
    }

    isUploadingAvatar.value = true

    const upload = await uploadLocalImage(editedFilePath, {
      folder: 'avatars',
      fileName: `agent_avatar_${Date.now()}.jpg`,
    })
    agent.value = await updateAgentAvatar(agentId.value, upload.objectKey)
    showToast('头像已更新')
  } catch (error) {
    if (isUserCanceled(error)) {
      return
    }

    if (error instanceof ApiException && error.requiresReLogin) {
      await redirectToAuth(error.message)
      return
    }

    showToast(
      error instanceof ApiException
        ? error.message
        : '头像上传失败，请稍后重试',
    )
  } finally {
    isUploadingAvatar.value = false
  }
}

function handleInfoRowTap(field: EditableAgentField) {
  if (isSavingProfile.value || isUploadingAvatar.value || isDeletingAgent.value) {
    return
  }

  if (field === 'sex') {
    void editSexField()
    return
  }

  if (field === 'birthday' || field === 'deathDate') {
    openDatePicker(field)
    return
  }

  const config = buildTextEditorConfig(field)
  if (!config) {
    return
  }

  openTextEditor(config)
}

function buildTextEditorConfig(
  field: TextEditableAgentField,
): TextEditorConfig | null {
  switch (field) {
    case 'name':
      return {
        field,
        title: '修改备注',
        initialValue: displayName.value === '未命名智能体' ? '' : displayName.value,
        placeholder: '请输入备注',
        maxLength: 30,
        successMessage: '备注已更新',
      }
    case 'iCallAgent':
      return {
        field,
        title: '修改你对 TA 的称呼',
        initialValue: agent.value?.iCallAgent ?? fallbackICallAgent.value,
        placeholder: '如：妈妈、爷爷',
        maxLength: 20,
        successMessage: '称呼已更新',
      }
    case 'agentCallMe':
      return {
        field,
        title: '修改 TA 对你的称呼',
        initialValue: agent.value?.agentCallMe ?? fallbackAgentCallMe.value,
        placeholder: '如：小熊宝贝',
        maxLength: 20,
        successMessage: '称呼已更新',
      }
    case 'description':
      return {
        field,
        title: '修改 TA 的一句话',
        initialValue: descriptionValue.value,
        placeholder: '写下一句 TA 想对你说的话',
        maxLength: 1000,
        successMessage: '一句话已更新',
        multiline: true,
        allowEmpty: true,
      }
    default:
      return null
  }
}

function openTextEditor(config: TextEditorConfig) {
  editorField.value = config.field
  editorTitle.value = config.title
  editorValue.value = config.initialValue
  editorPlaceholder.value = config.placeholder
  editorMaxLength.value = config.maxLength
  editorMultiline.value = Boolean(config.multiline)
  editorAllowEmpty.value = Boolean(config.allowEmpty)
  editorSuccessMessage.value = config.successMessage
  editorVisible.value = true
}

function closeEditor() {
  if (isSavingProfile.value) {
    return
  }

  editorVisible.value = false
  resetKeyboardState()
}

function handleEditorInput(event: unknown) {
  if (!event || typeof event !== 'object') {
    editorValue.value = ''
    return
  }

  const detail = 'detail' in event ? event.detail : undefined

  if (detail && typeof detail === 'object' && 'value' in detail) {
    editorValue.value = typeof detail.value === 'string' ? detail.value : ''
    return
  }

  editorValue.value = ''
}

function handleKeyboardHeightChange(event: { detail?: { height?: number } }) {
  keyboardHeight.value = event.detail?.height ?? 0
}

function resetKeyboardState() {
  keyboardHeight.value = 0
}

function resolveDatePickerInitialValue(field: DateEditableAgentField) {
  const currentValue =
    field === 'birthday'
      ? agent.value?.birthday ?? null
      : agent.value?.deathDate ?? null

  if (currentValue) {
    return currentValue
  }

  return field === 'birthday' ? new Date(1990, 0, 1) : new Date()
}

function openDatePicker(field: DateEditableAgentField) {
  datePickerField.value = field
  datePickerTitle.value = field === 'birthday' ? '修改生日' : '修改离开日期'
  datePickerValue.value = resolveDatePickerInitialValue(field)
  datePickerVisible.value = true
}

function closeDatePicker() {
  if (isSavingProfile.value) {
    return
  }

  datePickerVisible.value = false
}

async function confirmDatePicker() {
  if (isSavingProfile.value || !datePickerField.value) {
    return
  }

  const field = datePickerField.value
  const payload: UpdateAgentProfileDTO = {
    [field]: toApiDateValue(datePickerValue.value),
  }

  await saveProfileField(
    payload,
    field === 'birthday' ? '生日已更新' : '离开日期已更新',
  )
  datePickerVisible.value = false
}

async function editSexField() {
  try {
    const result = await Taro.showActionSheet({
      itemList: ['男', '女'],
    })
    const sex = result.tapIndex === 0 ? 1 : 0
    await saveProfileField({ sex }, '性别已更新')
  } catch (error) {
    if (!isUserCanceled(error)) {
      showToast('性别选择失败，请稍后重试')
    }
  }
}

async function submitEditor() {
  if (isSavingProfile.value || !editorField.value) {
    return
  }

  const rawValue = editorValue.value.trim()

  if (!rawValue && !editorAllowEmpty.value) {
    showToast('请填写内容')
    return
  }

  const payload: UpdateAgentProfileDTO = {
    [editorField.value]: rawValue,
  }

  await saveProfileField(payload, editorSuccessMessage.value)
  editorVisible.value = false
  resetKeyboardState()
}

async function saveProfileField(
  payload: UpdateAgentProfileDTO,
  successMessage: string,
) {
  if (!agentId.value) {
    showToast('缺少联系人资料')
    return
  }

  isSavingProfile.value = true

  try {
    agent.value = await updateAgentProfile(agentId.value, payload)
    showToast(successMessage)
  } catch (error) {
    if (error instanceof ApiException && error.requiresReLogin) {
      await redirectToAuth(error.message)
      return
    }

    showToast(
      error instanceof ApiException
        ? error.message
        : '资料更新失败，请稍后重试',
    )
  } finally {
    isSavingProfile.value = false
  }
}

async function handleDeleteTap() {
  if (isDeletingAgent.value || isSavingProfile.value || isUploadingAvatar.value) {
    return
  }

  if (!agentId.value) {
    showToast('缺少联系人资料')
    return
  }

  const result = await Taro.showModal({
    title: '删除智能体',
    content: `确定要删除「${displayName.value}」吗？删除后将无法在通讯录中看到 TA。`,
    confirmText: '删除',
    confirmColor: '#d81e06',
    cancelText: '取消',
  })

  if (!result.confirm) {
    return
  }

  isDeletingAgent.value = true

  try {
    await deleteAgent(agentId.value)
    await Taro.showToast({
      title: '已删除',
      icon: 'success',
      duration: 1000,
    })
    await new Promise((resolve) => setTimeout(resolve, 300))
    await Taro.switchTab({ url: '/pages/contacts/index' })
  } catch (error) {
    if (error instanceof ApiException && error.requiresReLogin) {
      await redirectToAuth(error.message)
      return
    }

    showToast(
      error instanceof ApiException
        ? error.message
        : '删除失败，请稍后重试',
    )
  } finally {
    isDeletingAgent.value = false
  }
}
</script>

<style lang="scss">
.agent-form-page {
  min-height: 100vh;
}

.agent-form-state {
  min-height: calc(100vh - 96px);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 32px;
  text-align: center;
}

.agent-form-state__dot {
  width: 14px;
  height: 14px;
  border-radius: 999px;
  background: $tzl-gradient-primary;
  box-shadow: $tzl-shadow-primary-sm;
}

.agent-form-state__title {
  color: #111111;
  font-size: 16px;
  line-height: 24px;
  font-weight: 600;
}

.agent-form-state__text {
  color: #8a8f98;
  font-size: 14px;
  line-height: 20px;
}

.agent-form-state__button {
  margin-top: 8px;
  padding: 8px 18px;
  border-radius: 12px;
  color: #ffffff;
  font-size: 14px;
  line-height: 20px;
  background: #111111;
}

.agent-form {
  min-height: 100%;
  background: #efeff4;
}

.agent-form-spacer {
  height: 10px;
}

.agent-form-section {
  --nut-cell-background: #ffffff;
  --nut-cell-border-radius: 0;
  --nut-cell-box-shadow: none;
  --nut-cell-color: #0a0a0a;
  --nut-cell-title-font: 16px;
  --nut-cell-line-height: 24px;
  --nut-cell-padding: 0 16px;
  --nut-cell-default-icon-margin: 0 0 0 10px;
  background: #ffffff;
}

.agent-form-cell {
  position: relative;
  min-height: 58px;
  margin: 0;
  color: #0a0a0a;
  border-bottom: 0.5px solid #e5e5e5;
}

.agent-form-cell--last {
  border-bottom: 0;
}

.agent-form-cell--avatar {
  min-height: 58px;
}

.agent-form-cell .nut-cell__title,
.agent-form-cell .title {
  color: #0a0a0a;
  font-size: 16px;
  line-height: 24px;
  font-weight: 400;
}

.agent-form-cell .nut-cell__value {
  min-width: 0;
  display: flex;
  justify-content: flex-end;
  align-items: center;
}

.agent-form-cell__value {
  display: block;
  max-width: 205px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #1c1c1c;
  font-size: 14px;
  line-height: 24px;
  text-align: right;
}

.agent-form-cell--description .agent-form-cell__value {
  max-width: 190px;
}

.agent-form-cell__value--placeholder {
  color: #999999;
}

.agent-form-avatar {
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}

.agent-form-avatar__image,
.agent-form-avatar__fallback {
  width: 37px;
  height: 36px;
  border-radius: 4px;
}

.agent-form-avatar__image {
  background: #eef2f7;
}

.agent-form-avatar__fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  color: #ffffff;
  font-size: 16px;
  line-height: 22px;
  font-weight: 700;
}

.agent-form-avatar__fallback--male {
  background: linear-gradient(135deg, #b6dbff 0%, #5d8fff 100%);
}

.agent-form-avatar__fallback--female {
  background: linear-gradient(135deg, #ffd9e5 0%, #ff8daa 100%);
}

.agent-form-avatar__loading {
  color: #999999;
  font-size: 12px;
  line-height: 18px;
}

.agent-form-delete {
  height: 58px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background: #ffffff;
  border-bottom: 0.5px solid #e5e5e5;
}

.agent-form-delete--disabled {
  opacity: 0.55;
}

.agent-form-delete__text {
  color: #d81e06;
  font-size: 16px;
  line-height: 24px;
  font-weight: 400;
}

.agent-form-editor-layer {
  position: fixed;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  z-index: 10000;
  display: flex;
  align-items: flex-end;
  background: rgba(0, 0, 0, 0.42);
}

.agent-form-editor {
  width: 100%;
  padding: 0 16px 20px;
  background: #ffffff;
  border-radius: 16px 16px 0 0;
  transition: padding-bottom 0.2s ease;
}

.agent-form-editor__header {
  height: 54px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.agent-form-editor__title {
  color: #111111;
  font-size: 16px;
  line-height: 24px;
  font-weight: 600;
}

.agent-form-editor__action {
  min-width: 54px;
  color: #8a8f98;
  font-size: 15px;
  line-height: 24px;
}

.agent-form-editor__action--primary {
  color: #637897;
  text-align: right;
  font-weight: 600;
}

.agent-form-editor__action--disabled {
  color: #b8bdc5;
}

.agent-form-editor__input,
.agent-form-editor__textarea {
  width: 100%;
  border-radius: 8px;
  background: #f5f5f7;
  color: #111111;
  font-size: 15px;
  line-height: 22px;
}

.agent-form-editor__input {
  height: 46px;
  padding: 0 12px;
}

.agent-form-editor__textarea {
  height: 128px;
  padding: 12px;
}

.agent-form-editor__hint {
  display: block;
  margin-top: 8px;
  color: #9a9ca3;
  font-size: 12px;
  line-height: 18px;
  text-align: right;
}
</style>
