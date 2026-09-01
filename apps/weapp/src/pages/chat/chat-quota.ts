import type { ConversationChatQuotaSnapshot } from '../../apis/conversation'

export type ChatQuotaDialogType = 'remaining' | 'exhausted'

const DEFAULT_TRIAL_DAYS = 3
const DEFAULT_TRIAL_DAILY_LIMIT = 30
const DEFAULT_DAILY_LIMIT = 3

function positiveInteger(value: number | undefined, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback
}

export function copyChatQuotaSnapshot(
  chatQuota: ConversationChatQuotaSnapshot
): ConversationChatQuotaSnapshot {
  return { ...chatQuota }
}

export function isChatQuotaExhausted(
  chatQuota: ConversationChatQuotaSnapshot | null
) {
  return Boolean(
    chatQuota
    && !chatQuota.isVip
    && typeof chatQuota.remainingCount === 'number'
    && chatQuota.remainingCount <= 0
  )
}

export function shouldShowChatQuotaRemainingDialog(
  chatQuota: ConversationChatQuotaSnapshot | null | undefined
) {
  return Boolean(
    chatQuota
    && !chatQuota.isVip
    && chatQuota.remainingCount === 1
  )
}

export function buildChatQuotaDialogContent(
  type: ChatQuotaDialogType,
  chatQuota: ConversationChatQuotaSnapshot | null
) {
  const policy = chatQuota?.policy?.trim().toLowerCase()
  const trialDays = positiveInteger(chatQuota?.trialDays, DEFAULT_TRIAL_DAYS)

  if (policy === 'agent_limit') {
    return '免费聊天额度仅适用于最早创建的3位亲友。当前亲友需开通会员后继续畅聊。'
  }

  if (type === 'remaining') {
    if (policy === 'trial') {
      return `你正在${trialDays}天免费试用期内，今天还可以和TA聊最后1句。开通会员可继续畅聊。`
    }

    if (policy === 'daily') {
      const limit = positiveInteger(chatQuota?.limit, DEFAULT_DAILY_LIMIT)
      return `${trialDays}天免费试用已结束，非会员每天可与每位亲友聊${limit}句。今天还可以和TA聊最后1句，开通会员可继续畅聊。`
    }

    return '今天还可以和TA聊最后1句，开通会员可继续畅聊。'
  }

  if (policy === 'trial') {
    const limit = positiveInteger(chatQuota?.limit, DEFAULT_TRIAL_DAILY_LIMIT)
    return `你正在${trialDays}天免费试用期内，今天的${limit}句额度已用完，00:00恢复。开通会员可继续畅聊。`
  }

  if (policy === 'daily') {
    const limit = positiveInteger(chatQuota?.limit, DEFAULT_DAILY_LIMIT)
    return `${trialDays}天免费试用已结束，非会员每天可与每位亲友聊${limit}句。今天额度已用完，00:00恢复。开通会员可继续畅聊。`
  }

  return '今天的对话额度已用完，00:00恢复。开通会员可继续畅聊。'
}
