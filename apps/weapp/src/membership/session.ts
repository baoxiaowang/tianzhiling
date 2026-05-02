import { computed, ref, shallowRef } from 'vue'
import type { MembershipCenter, MembershipStatus } from '../apis/membership'
import { getMembershipStatus } from '../apis/membership'
import { ApiException } from '../api/api-exception'
import { authSession, registerAuthSessionClearListener } from '../auth/session'

export const membershipStatus = shallowRef<MembershipStatus | null>(null)
export const membershipStatusReady = ref(false)
export const isMembershipStatusRefreshing = ref(false)

export const isVip = computed(() => Boolean(membershipStatus.value?.isVip))
export const membershipEntitlements = computed(() => {
  return membershipStatus.value?.entitlements ?? []
})

let refreshPromise: Promise<MembershipStatus | null> | null = null

export function clearMembershipStatus() {
  membershipStatus.value = null
  membershipStatusReady.value = true
}

export function syncMembershipStatusFromCenter(center: MembershipCenter) {
  membershipStatus.value = {
    isVip: center.isVip,
    membership: center.membership,
    entitlements: membershipStatus.value?.entitlements ?? [],
    serverTime: new Date(),
  }
  membershipStatusReady.value = true
}

export async function refreshMembershipStatus(
  options: { force?: boolean } = {},
) {
  if (!authSession.value?.accessToken) {
    clearMembershipStatus()
    return null
  }

  if (!options.force && membershipStatusReady.value && membershipStatus.value) {
    return membershipStatus.value
  }

  if (refreshPromise) {
    return refreshPromise
  }

  isMembershipStatusRefreshing.value = true
  refreshPromise = getMembershipStatus()
    .then((status) => {
      membershipStatus.value = status
      membershipStatusReady.value = true
      return status
    })
    .catch((error) => {
      if (error instanceof ApiException && error.requiresReLogin) {
        clearMembershipStatus()
        return null
      }

      throw error
    })
    .finally(() => {
      refreshPromise = null
      isMembershipStatusRefreshing.value = false
    })

  return refreshPromise
}

registerAuthSessionClearListener(() => {
  clearMembershipStatus()
})
