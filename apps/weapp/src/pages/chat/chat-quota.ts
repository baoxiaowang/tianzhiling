import type { ConversationChatQuotaSnapshot, ReplyQuotaTriggerDecision } from '../../apis/conversation'

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
  chatQuota: ConversationChatQuotaSnapshot | null,
  agentName?: string,
) {
  const decision = chatQuota?.triggerDecision
  const name = agentName || 'TA'

  if (type === 'remaining' && decision && chatQuota?.policy === 'deep_trigger') {
    return buildDeepTriggerRemainingText(decision, name)
  }

  if (type === 'exhausted' && decision && chatQuota?.policy === 'deep_trigger') {
    return buildDeepTriggerExhaustedText(decision, name)
  }

  const policy = chatQuota?.policy?.trim().toLowerCase()
  const trialDays = positiveInteger(chatQuota?.trialDays, DEFAULT_TRIAL_DAYS)

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

function hasPair(d: ReplyQuotaTriggerDecision, a: string, b: string): boolean {
  return d.matchedConditions.includes(a) && d.matchedConditions.includes(b)
}

function buildDeepTriggerRemainingText(
  d: ReplyQuotaTriggerDecision,
  name: string,
): string {
  if (d.path === 'return_visit') {
    return `欢迎回来。今天还可以和${name}聊最后1句，开通会员可继续畅聊。`
  }

  if (hasPair(d, 'sessionLength', 'relationshipStage')) {
    return `你和${name}的关系越来越近了。今天还可以和TA聊最后1句，开通会员后可以更深入地了解TA。`
  }

  if (hasPair(d, 'longInput', 'relationshipStage')) {
    return `你有好多话想对${name}说。今天还可以聊最后1句，开通会员后可以继续说下去。`
  }

  if (hasPair(d, 'sessionLength', 'longInput')) {
    return `你和${name}聊了很多心里话。今天还可以和TA聊最后1句，开通会员后可以继续倾听TA的声音。`
  }

  return `今天还可以和${name}聊最后1句，开通会员可继续畅聊。`
}

function buildDeepTriggerExhaustedText(
  d: ReplyQuotaTriggerDecision,
  name: string,
): string {
  if (d.path === 'return_visit') {
    return `免费额度已用完。开通会员，继续和${name}说你想说的话。`
  }

  if (hasPair(d, 'sessionLength', 'relationshipStage')) {
    return `免费额度已用完。你和${name}已经走得这么近了，开通会员后可继续倾听TA的声音。`
  }

  if (hasPair(d, 'longInput', 'relationshipStage')) {
    return `免费额度已用完。你心里还有很多话想对${name}说，开通会员后可以继续说下去。`
  }

  if (hasPair(d, 'sessionLength', 'longInput')) {
    return `免费额度已用完。你和${name}还有很多话没说完，开通会员后可继续畅聊。`
  }

  return `免费额度已用完。开通会员后可继续倾听TA的声音。`
}

