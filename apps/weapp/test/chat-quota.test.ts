import type { ConversationChatQuotaSnapshot } from '../src/apis/conversation'
import {
  buildChatQuotaDialogContent,
  copyChatQuotaSnapshot,
  isChatQuotaExhausted,
  shouldShowChatQuotaRemainingDialog,
} from '../src/pages/chat/chat-quota'

describe('chat quota presentation', () => {
  it('keeps the complete server snapshot', () => {
    const source: ConversationChatQuotaSnapshot = {
      isVip: false,
      policy: 'trial',
      limit: 30,
      usedCount: 29,
      remainingCount: 1,
      trialDays: 3,
    }

    const snapshot = copyChatQuotaSnapshot(source)

    expect(snapshot).toEqual(source)
    expect(snapshot).not.toBe(source)
  })

  it('shows the trial period and final remaining message', () => {
    const content = buildChatQuotaDialogContent('remaining', {
      isVip: false,
      policy: 'trial',
      limit: 30,
      usedCount: 29,
      remainingCount: 1,
      trialDays: 3,
    })

    expect(content).toContain('3天免费试用期内')
    expect(content).toContain('最后1句')
  })

  it('uses 00:00 for exhausted trial quota without saying tomorrow', () => {
    const content = buildChatQuotaDialogContent('exhausted', {
      isVip: false,
      policy: 'trial',
      limit: 30,
      usedCount: 30,
      remainingCount: 0,
      trialDays: 3,
    })

    expect(content).toContain('今天的30句额度已用完')
    expect(content).toContain('00:00恢复')
    expect(content).not.toContain('明天')
  })

  it('explains the post-trial daily policy', () => {
    const content = buildChatQuotaDialogContent('exhausted', {
      isVip: false,
      policy: 'daily',
      limit: 3,
      usedCount: 3,
      remainingCount: 0,
      trialDays: 3,
    })

    expect(content).toContain('3天免费试用已结束')
    expect(content).toContain('每天可与每位亲友聊3句')
    expect(content).toContain('00:00恢复')
  })

  it('adapts to server policy values instead of fixed copy', () => {
    const content = buildChatQuotaDialogContent('exhausted', {
      isVip: false,
      policy: 'daily',
      limit: 5,
      usedCount: 5,
      remainingCount: 0,
      trialDays: 7,
    })

    expect(content).toContain('7天免费试用已结束')
    expect(content).toContain('每天可与每位亲友聊5句')
  })

  it('does not promise a midnight reset for agents outside the free slots', () => {
    const content = buildChatQuotaDialogContent('exhausted', {
      isVip: false,
      policy: 'agent_limit',
      limit: 0,
      usedCount: 0,
      remainingCount: 0,
      trialDays: 3,
    })

    expect(content).toContain('最早创建的3位亲友')
    expect(content).toContain('需开通会员')
    expect(content).not.toContain('00:00')
  })

  it('does not show quota warnings for members', () => {
    const memberQuota: ConversationChatQuotaSnapshot = { isVip: true }

    expect(isChatQuotaExhausted(memberQuota)).toBe(false)
    expect(shouldShowChatQuotaRemainingDialog(memberQuota)).toBe(false)
  })

  it('treats an expired member as the current non-member daily policy', () => {
    const expiredMemberQuota: ConversationChatQuotaSnapshot = {
      isVip: false,
      policy: 'daily',
      limit: 3,
      usedCount: 2,
      remainingCount: 1,
      trialDays: 3,
    }

    expect(shouldShowChatQuotaRemainingDialog(expiredMemberQuota)).toBe(true)
    expect(
      buildChatQuotaDialogContent('remaining', expiredMemberQuota)
    ).toContain('免费试用已结束')
  })
})
