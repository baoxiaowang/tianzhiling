import Taro from '@tarojs/taro'

import type { ConversationChatQuotaSnapshot } from '../apis/conversation'
import type { ChatQuotaDialogType } from '../pages/chat/chat-quota'

export type ChatQuotaDialogAction =
  | 'exposure'
  | 'continue'
  | 'upgrade'
  | 'dismiss'

export type AgentCreateStartAction =
  | 'exposure'
  | 'intro_complete'
  | 'start_click'
  | 'login_prompt'
  | 'flow_enter_success'
  | 'flow_enter_failure'
  | 'back_exit'

export type AgentCreateIntroMode = 'animated' | 'skipped'

export type PerformanceEventId =
  | 'app_launch'
  | 'route_visible'
  | 'first_cached_content'
  | 'first_data'

type TaroAnalyticsApi = typeof Taro & {
  reportEvent?: (eventId: string, data: TaroGeneral.IAnyObject) => void
  reportAnalytics?: (eventName: string, data: TaroGeneral.IAnyObject) => void
}

function reportProductEvent(eventId: string, data: TaroGeneral.IAnyObject) {
  const analyticsApi = Taro as TaroAnalyticsApi

  if (typeof analyticsApi.reportEvent === 'function') {
    try {
      analyticsApi.reportEvent(eventId, data)
      return
    } catch {}
  }

  if (typeof analyticsApi.reportAnalytics === 'function') {
    try {
      analyticsApi.reportAnalytics(eventId, data)
    } catch {
      // Analytics must never block a product flow.
    }
  }
}

export function reportPerformanceEvent(
  eventId: PerformanceEventId,
  page: string,
  durationMs: number,
  source = '',
) {
  reportProductEvent(eventId, {
    page: page.slice(0, 40),
    duration_ms: Math.max(0, Math.round(durationMs)),
    source: source.slice(0, 24),
  })
}

export function reportChatQuotaDialogEvent(
  action: ChatQuotaDialogAction,
  dialogType: ChatQuotaDialogType,
  chatQuota: ConversationChatQuotaSnapshot | null
) {
  const data = {
    action,
    dialog_type: dialogType,
    quota_policy: chatQuota?.policy ?? 'unknown',
    quota_limit: chatQuota?.limit ?? -1,
    remaining_count: chatQuota?.remainingCount ?? -1,
    trial_days: chatQuota?.trialDays ?? -1,
    is_vip: chatQuota?.isVip ? 1 : 0,
  }

  reportProductEvent('chat_quota_dialog', data)
}

export function reportAgentCreateStartEvent(
  action: AgentCreateStartAction,
  introMode: AgentCreateIntroMode,
  isAuthenticated: boolean
) {
  reportProductEvent('agent_create_start', {
    action,
    intro_mode: introMode,
    is_authenticated: isAuthenticated ? 1 : 0,
  })
}
