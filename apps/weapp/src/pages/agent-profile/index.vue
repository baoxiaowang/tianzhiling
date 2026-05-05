<template>
  <page-scaffold
    class="agent-profile-page"
    background="#ffffff"
    header-background="#f6f6f6"
    body-padding="0"
    :scroll="true"
    :safe-area-top="false"
    :safe-area-bottom="true"
  >
    <template #header>
      <app-bar title="亲友资料" background="#f6f6f6" />
    </template>

    <view v-if="isCheckingAuth || isLoading" class="agent-profile-state">
      <view class="agent-profile-state__dot" />
      <text class="agent-profile-state__text">
        {{ isCheckingAuth ? '正在恢复会话...' : '正在加载资料...' }}
      </text>
    </view>

    <view v-else-if="showBlockingError" class="agent-profile-state">
      <text class="agent-profile-state__title">资料暂时加载失败</text>
      <text class="agent-profile-state__text">{{ loadError }}</text>
      <view class="agent-profile-state__button" @tap="handleRetry">重试</view>
    </view>

    <view v-else class="agent-profile">
      <view class="agent-profile-note">
        <text class="agent-profile-note__text">
          【注】完善亲友资料，有助于更自然地与 TA 对话
        </text>
      </view>
      <view class="agent-profile-divider" />

      <view class="agent-profile-list">
        <view
          v-for="item in fixedProfileFields"
          :key="item.field"
          class="agent-profile-item"
        >
          <text class="agent-profile-item__title">{{ item.title }}</text>
          <textarea
            class="agent-profile-item__textarea"
            :value="profileForm[item.field]"
            :placeholder="item.placeholder"
            placeholder-class="agent-profile-item__placeholder"
            maxlength="1000"
            cursor-spacing="80"
            :show-confirm-bar="false"
            @input="handleFixedInput(item.field, $event)"
            @blur="handleFixedBlur(item.field)"
          />
        </view>

      </view>
    </view>
  </page-scaffold>
</template>

<script lang="ts">
export default {
  name: 'AgentProfilePage',
}
</script>

<script setup lang="ts">
import Taro, { useLoad } from '@tarojs/taro'
import type { UpdateAgentProfileDTO } from '@tzl/shared'
import { computed, ref } from 'vue'
import { ApiException } from '../../api/api-exception'
import {
  getAgentDetail,
  updateAgentProfile,
  type AgentSummary,
} from '../../apis/agent'
import { clearAuthSession } from '../../auth/session'
import AppBar from '../../components/app-bar/app-bar.vue'
import PageScaffold from '../../components/page-scaffold/page-scaffold.vue'
import { ensureAuthenticatedSession, redirectToAuthPage } from '../../utils/auth-guard'

type FixedProfileField =
  | 'lifeExperience'
  | 'personalityTraits'
  | 'languageHabits'
  | 'hobbies'
  | 'sharedMemories'

interface FixedProfileFieldConfig {
  field: FixedProfileField
  title: string
  placeholder: string
}

const fixedProfileFields: FixedProfileFieldConfig[] = [
  {
    field: 'lifeExperience',
    title: '生平经历',
    placeholder: '在这里为 TA 写下人生大事（教育，工作经历等等）',
  },
  {
    field: 'personalityTraits',
    title: '性格特点',
    placeholder: '写下 TA 在你或他人心目中的形象',
  },
  {
    field: 'languageHabits',
    title: '语言习惯',
    placeholder: '写下 TA 的方言、口头禅',
  },
  {
    field: 'hobbies',
    title: '兴趣爱好',
    placeholder: '如：唱歌、跳舞、运动等',
  },
  {
    field: 'sharedMemories',
    title: '共同记忆',
    placeholder: '写下你们记忆深处最珍贵的往事',
  },
]

const createEmptyProfileForm = (): Record<FixedProfileField, string> => ({
  lifeExperience: '',
  personalityTraits: '',
  languageHabits: '',
  hobbies: '',
  sharedMemories: '',
})

const agent = ref<AgentSummary | null>(null)
const agentId = ref('')
const profileForm = ref(createEmptyProfileForm())
const isCheckingAuth = ref(true)
const isLoading = ref(false)
const isSavingProfile = ref(false)
const pendingProfilePayload = ref<UpdateAgentProfileDTO | null>(null)
const loadError = ref('')

const showBlockingError = computed(() => Boolean(loadError.value && !agent.value))

useLoad((options) => {
  agentId.value = decodeRouteParam(options?.agentId)
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

function extractInputValue(event: unknown) {
  if (!event || typeof event !== 'object') {
    return ''
  }

  const detail = 'detail' in event ? event.detail : undefined

  if (detail && typeof detail === 'object' && 'value' in detail) {
    return typeof detail.value === 'string' ? detail.value : ''
  }

  return ''
}

function showToast(title: string) {
  void Taro.showToast({
    title,
    icon: 'none',
    duration: 1800,
  })
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
    const detail = await getAgentDetail(agentId.value)
    agent.value = detail
    syncProfileForm(detail)
  } catch (error) {
    if (error instanceof ApiException && error.requiresReLogin) {
      await clearAuthSession()
      await redirectToAuthPage()
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

function syncProfileForm(detail: AgentSummary) {
  profileForm.value = {
    lifeExperience: detail.lifeExperience,
    personalityTraits: detail.personalityTraits,
    languageHabits: detail.languageHabits,
    hobbies: detail.hobbies,
    sharedMemories: detail.sharedMemories,
  }
}

function handleRetry() {
  void loadAgentDetail()
}

function handleFixedInput(field: FixedProfileField, event: unknown) {
  profileForm.value[field] = extractInputValue(event)
}

function handleFixedBlur(field: FixedProfileField) {
  const payload: UpdateAgentProfileDTO = {
    [field]: profileForm.value[field].trim(),
  }
  void saveProfile(payload)
}

async function saveProfile(payload: UpdateAgentProfileDTO) {
  if (isSavingProfile.value) {
    pendingProfilePayload.value = mergeProfilePayload(
      pendingProfilePayload.value,
      payload,
    )
    return
  }

  if (!agentId.value) {
    showToast('缺少联系人资料')
    return
  }

  isSavingProfile.value = true

  try {
    const savedAgent = await updateAgentProfile(agentId.value, payload)
    agent.value = savedAgent
  } catch (error) {
    if (error instanceof ApiException && error.requiresReLogin) {
      await clearAuthSession()
      await redirectToAuthPage()
      return
    }

    showToast(
      error instanceof ApiException
        ? error.message
        : '资料保存失败，请稍后重试',
    )
  } finally {
    isSavingProfile.value = false

    if (pendingProfilePayload.value) {
      const nextPayload = pendingProfilePayload.value
      pendingProfilePayload.value = null
      void saveProfile(nextPayload)
    }
  }
}

function mergeProfilePayload(
  current: UpdateAgentProfileDTO | null,
  incoming: UpdateAgentProfileDTO,
): UpdateAgentProfileDTO {
  return {
    ...(current ?? {}),
    ...incoming,
  }
}
</script>

<style lang="scss">
.agent-profile-page {
  min-height: 100vh;
}

.agent-profile-state {
  min-height: calc(100vh - 96px);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 32px;
  text-align: center;
  box-sizing: border-box;
}

.agent-profile-state__dot {
  width: 14px;
  height: 14px;
  border-radius: 999px;
  background: $tzl-gradient-primary;
  box-shadow: $tzl-shadow-primary-sm;
}

.agent-profile-state__title {
  color: #111111;
  font-size: 16px;
  line-height: 24px;
  font-weight: 600;
}

.agent-profile-state__text {
  color: #8a8f98;
  font-size: 14px;
  line-height: 20px;
}

.agent-profile-state__button {
  margin-top: 8px;
  padding: 8px 18px;
  border-radius: 12px;
  color: #ffffff;
  font-size: 14px;
  line-height: 20px;
  background: #111111;
}

.agent-profile {
  min-height: 100%;
  background: #ffffff;
}

.agent-profile-note {
  height: 54px;
  display: flex;
  align-items: center;
  box-sizing: border-box;
  padding: 0 16px 0 46px;
  background: #ffffff;
}

.agent-profile-note__text {
  color: #999999;
  font-size: 14px;
  line-height: 24px;
}

.agent-profile-divider {
  height: 6px;
  background: #efeff4;
}

.agent-profile-list {
  background: #ffffff;
}

.agent-profile-item {
  min-height: 123px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 10px 16px;
  background: #ffffff;
}

.agent-profile-item__title {
  color: #0a0a0a;
  font-size: 16px;
  line-height: 24px;
  font-weight: 400;
}

.agent-profile-item__textarea {
  width: 100%;
  height: 67px;
  min-height: 67px;
  box-sizing: border-box;
  padding: 10px 14px;
  border-radius: 10px;
  border: 0;
  color: #0a0a0a;
  background: #efeff4;
  font-size: 14px;
  line-height: 24px;
}

.agent-profile-item__placeholder {
  color: #999999;
}

</style>
