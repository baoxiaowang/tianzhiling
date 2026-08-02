import Taro from '@tarojs/taro'
import { del, get, getWithOptions, post } from '../api/api-client'
import { ApiException } from '../api/api-exception'
import { authSession } from '../auth/session'
import { normalizeEmojiText } from '../utils/emoji-text'

const POST_NOTIFICATION_V2_API_ENABLED =
  process.env.TARO_APP_POST_NOTIFICATION_V2_API_ENABLED === 'true'
const POST_FEED_CACHE_KEY = 'tzl_post_feed_cache_v1'
const POST_FEED_CACHE_TTL = 5 * 60 * 1000

export type PostCommentType = 'user' | 'agent'
export type PostNotificationType = 'comment' | 'like'
export type PostModerationStatus = 'normal' | 'risk_controlled'

export interface PostCommentNotificationItem {
  id: string
  postId: string
  commentId: string
  type: PostCommentType
  actorName: string
  actorAvatar: string
  commentPreview: string
  replyToUserName: string
  postThumbnail: string
  isRead: boolean
  createdAt: string | null
}

export interface PostCommentNotificationSummary {
  unreadCount: number
  latest: PostCommentNotificationItem | null
}

export interface PostNotificationItem {
  id: string
  postId: string
  type: PostNotificationType
  commentId: string
  commentType: PostCommentType | ''
  actorName: string
  actorAvatar: string
  contentPreview: string
  replyToUserName: string
  postThumbnail: string
  postContentPreview: string
  isSeen: boolean
  isRead: boolean
  createdAt: string | null
}

export interface PostNotificationSummary {
  unreadCount: number
  latest: PostNotificationItem | null
  unseenCount: number
  latestUnseen: PostNotificationItem | null
}

export interface PostNotificationEntrySummary {
  unseenCount: number
  latestUnseen: PostNotificationItem | null
  isLegacyFallback?: boolean
}

export interface PostCommentItem {
  id: string
  postId: string
  type: PostCommentType
  userId: string
  agentId: string
  authorName: string
  authorAvatar: string
  content: string
  parentCommentId: string
  replyToUserId: string
  replyToAgentId: string
  replyToUserName: string
  createdAt: string | null
  updatedAt: string | null
}

export interface PostItem {
  id: string
  userId: string
  authorName: string
  authorAvatar: string
  content: string
  images: string[]
  imageThumbnails?: string[]
  remindAgentIds: string[]
  moderationStatus?: PostModerationStatus
  moderationReason?: string
  isRiskControlled?: boolean
  likeCount: number
  likedByMe: boolean
  commentCount: number
  comments: PostCommentItem[]
  createdAt: string | null
  updatedAt: string | null
}

interface PostListResponse {
  items: PostItem[]
  page?: number
  pageSize?: number
  hasMore?: boolean
}

export interface PostListResult {
  items: PostItem[]
  page: number
  pageSize: number
  hasMore: boolean
}

interface StoredPostFeedCache {
  ownerId: string
  expiresAt: number
  result: PostListResult
}

interface ReadUnreadCommentNotificationsResponse {
  items: PostCommentNotificationItem[]
  readCount: number
  unreadCount: number
}

interface ReadUnreadPostNotificationsResponse {
  items: PostNotificationItem[]
  readCount: number
  unreadCount: number
}

interface ReadPostNotificationResponse {
  notificationId: string
  readCount: number
  unreadCount: number
}

interface SeePostNotificationsResponse {
  seenCount: number
  unseenCount: number
  unreadCount: number
}

interface CommentNotificationListResponse {
  items: PostCommentNotificationItem[]
  page?: number
  pageSize?: number
  hasMore?: boolean
}

interface PostNotificationListResponse {
  items: PostNotificationItem[]
  page?: number
  pageSize?: number
  hasMore?: boolean
  readFilterApplied?: boolean
}

type RawPostNotificationItem = PostNotificationItem & {
  post_id?: unknown
  postID?: unknown
  targetPostId?: unknown
  target_post_id?: unknown
  post?: {
    id?: unknown
    _id?: unknown
  }
}

export interface GetPostsOptions {
  page?: number
  pageSize?: number
  mine?: boolean
  read?: boolean
  lightweight?: boolean
}

function normalizeObjectIdString(value: unknown): string {
  if (typeof value === 'string') {
    return value.trim()
  }

  if (!value || typeof value !== 'object') {
    return ''
  }

  const record = value as Record<string, unknown>

  return (
    normalizeObjectIdString(record.$oid) ||
    normalizeObjectIdString(record.oid) ||
    normalizeObjectIdString(record.id) ||
    normalizeObjectIdString(record._id)
  )
}

export async function getPosts(options: GetPostsOptions = {}) {
  const queryParts: string[] = []

  if (options.page) {
    queryParts.push(`page=${encodeURIComponent(String(options.page))}`)
  }

  if (options.pageSize) {
    queryParts.push(`pageSize=${encodeURIComponent(String(options.pageSize))}`)
  }

  if (options.mine) {
    queryParts.push('mine=1')
  }

  if (options.lightweight !== false) {
    queryParts.push('lightweight=1')
  }

  const url = queryParts.length ? `/api/post?${queryParts.join('&')}` : '/api/post'
  const data = await get<PostListResponse>(url)

  const result: PostListResult = {
    items: Array.isArray(data.items) ? data.items : [],
    page: data.page ?? options.page ?? 1,
    pageSize: data.pageSize ?? options.pageSize ?? 10,
    hasMore: data.hasMore === true,
  }

  if (!options.mine && result.page === 1) {
    savePostFeedCache(result)
  }

  return result
}

export function getCachedPostFeed(pageSize = 10): PostListResult | undefined {
  try {
    const raw = Taro.getStorageSync<string>(POST_FEED_CACHE_KEY)
    const stored = raw ? (JSON.parse(raw) as Partial<StoredPostFeedCache>) : undefined

    if (
      !stored?.result ||
      stored.ownerId !== getPostFeedCacheOwnerId() ||
      !stored.expiresAt ||
      stored.expiresAt <= Date.now() ||
      !Array.isArray(stored.result.items)
    ) {
      return undefined
    }

    const normalizedPageSize = Math.max(1, Math.trunc(pageSize))
    const items = stored.result.items.slice(0, normalizedPageSize)

    return {
      ...stored.result,
      items,
      page: 1,
      pageSize: normalizedPageSize,
      hasMore: stored.result.hasMore || stored.result.items.length > items.length,
    }
  } catch {
    return undefined
  }
}

function savePostFeedCache(result: PostListResult) {
  const stored: StoredPostFeedCache = {
    ownerId: getPostFeedCacheOwnerId(),
    expiresAt: Date.now() + POST_FEED_CACHE_TTL,
    result,
  }

  try {
    Taro.setStorageSync(POST_FEED_CACHE_KEY, JSON.stringify(stored))
  } catch {
    // Feed caching is an optional startup optimization.
  }
}

function getPostFeedCacheOwnerId() {
  return authSession.value?.user.id.trim() || 'guest'
}

export async function getPostDetail(postId: string) {
  return get<PostItem>(`/api/post/${postId}`)
}

export async function getCommentNotificationSummary() {
  return get<PostCommentNotificationSummary>('/api/post/comment-notifications/summary')
}

export async function getPostNotificationSummary() {
  const data = await getWithOptions<Partial<PostNotificationSummary>>(
    '/api/post/notifications/summary',
    {
      timeout: 5000,
    },
  )
  const unreadCount = Number.isFinite(data.unreadCount) ? Number(data.unreadCount) : 0
  const unseenCount = Number.isFinite(data.unseenCount)
    ? Number(data.unseenCount)
    : unreadCount
  const latest = data.latest ? normalizePostNotificationItem(data.latest) : null
  const latestUnseen = data.latestUnseen
    ? normalizePostNotificationItem(data.latestUnseen)
    : latest

  return {
    unreadCount,
    latest,
    unseenCount,
    latestUnseen,
  }
}

export async function getPostNotificationEntrySummary() {
  if (!POST_NOTIFICATION_V2_API_ENABLED) {
    const compatibleSummary = await getPostNotificationSummary()
    return {
      unseenCount: compatibleSummary.unseenCount,
      latestUnseen: compatibleSummary.latestUnseen,
      isLegacyFallback: true,
    }
  }

  try {
    const data = await getWithOptions<Partial<PostNotificationEntrySummary>>(
      '/api/post/notifications/entry-summary',
      {
        timeout: 5000,
      },
    )

    return {
      unseenCount: Number.isFinite(data.unseenCount) ? Number(data.unseenCount) : 0,
      latestUnseen: data.latestUnseen
        ? normalizePostNotificationItem(data.latestUnseen)
        : null,
      isLegacyFallback: false,
    }
  } catch (error) {
    if (error instanceof ApiException && error.requiresReLogin) {
      throw error
    }

    const compatibleSummary = await getPostNotificationSummary()
    return {
      unseenCount: compatibleSummary.unseenCount,
      latestUnseen: compatibleSummary.latestUnseen,
      isLegacyFallback: true,
    }
  }
}

export async function getCommentNotifications(options: GetPostsOptions = {}) {
  const queryParts: string[] = []

  if (options.page) {
    queryParts.push(`page=${encodeURIComponent(String(options.page))}`)
  }

  if (options.pageSize) {
    queryParts.push(`pageSize=${encodeURIComponent(String(options.pageSize))}`)
  }

  const url = queryParts.length
    ? `/api/post/comment-notifications?${queryParts.join('&')}`
    : '/api/post/comment-notifications'
  const data = await get<CommentNotificationListResponse>(url)

  return {
    items: Array.isArray(data.items) ? data.items : [],
    page: data.page ?? options.page ?? 1,
    pageSize: data.pageSize ?? options.pageSize ?? 20,
    hasMore: data.hasMore === true,
  }
}

export async function getPostNotifications(options: GetPostsOptions = {}) {
  const queryParts: string[] = []

  if (options.page) {
    queryParts.push(`page=${encodeURIComponent(String(options.page))}`)
  }

  if (options.pageSize) {
    queryParts.push(`pageSize=${encodeURIComponent(String(options.pageSize))}`)
  }

  if (typeof options.read === 'boolean') {
    queryParts.push(`read=${options.read ? 'true' : 'false'}`)
  }

  const url = queryParts.length
    ? `/api/post/notifications?${queryParts.join('&')}`
    : '/api/post/notifications'
  const data = await get<PostNotificationListResponse>(url)

  return {
    items: Array.isArray(data.items)
      ? data.items.map(normalizePostNotificationItem)
      : [],
    page: data.page ?? options.page ?? 1,
    pageSize: data.pageSize ?? options.pageSize ?? 20,
    hasMore: data.hasMore === true,
    readFilterApplied: data.readFilterApplied === true,
  }
}

function normalizePostNotificationItem(item: PostNotificationItem): PostNotificationItem {
  const rawItem = item as RawPostNotificationItem
  const postId =
    normalizeObjectIdString(rawItem.postId) ||
    normalizeObjectIdString(rawItem.post_id) ||
    normalizeObjectIdString(rawItem.postID) ||
    normalizeObjectIdString(rawItem.targetPostId) ||
    normalizeObjectIdString(rawItem.target_post_id) ||
    normalizeObjectIdString(rawItem.post?.id) ||
    normalizeObjectIdString(rawItem.post?._id)

  return {
    ...item,
    postId,
    postContentPreview:
      typeof rawItem.postContentPreview === 'string'
        ? rawItem.postContentPreview.trim()
        : '',
    isSeen: rawItem.isSeen === true || rawItem.isRead === true,
  }
}

export async function markCommentNotificationsRead(postId: string) {
  await post<Record<string, unknown>>(`/api/post/${postId}/comment-notifications/read`)
}

export async function readUnreadCommentNotifications() {
  const data = await post<ReadUnreadCommentNotificationsResponse>(
    '/api/post/comment-notifications/read'
  )

  return {
    items: Array.isArray(data.items) ? data.items : [],
    readCount: data.readCount ?? 0,
    unreadCount: data.unreadCount ?? 0,
  }
}

export async function readUnreadPostNotifications() {
  const data = await post<ReadUnreadPostNotificationsResponse>(
    '/api/post/notifications/read'
  )

  return {
    items: Array.isArray(data.items) ? data.items : [],
    readCount: data.readCount ?? 0,
    unreadCount: data.unreadCount ?? 0,
  }
}

export async function markPostNotificationRead(notificationId: string) {
  if (!POST_NOTIFICATION_V2_API_ENABLED) {
    const result = await readUnreadPostNotifications()

    return {
      notificationId,
      readCount: result.readCount,
      unreadCount: result.unreadCount,
    }
  }

  try {
    return await post<ReadPostNotificationResponse>(
      `/api/post/notifications/${encodeURIComponent(notificationId)}/read`,
    )
  } catch (error) {
    if (error instanceof ApiException && error.requiresReLogin) {
      throw error
    }

    const result = await readUnreadPostNotifications()
    return {
      notificationId,
      readCount: result.readCount,
      unreadCount: result.unreadCount,
    }
  }
}

export async function markPostNotificationsSeen() {
  return post<SeePostNotificationsResponse>('/api/post/notifications/seen')
}

export async function markPostNotificationEntrySeen() {
  if (!POST_NOTIFICATION_V2_API_ENABLED) {
    return markPostNotificationsSeen()
  }

  try {
    return await post<SeePostNotificationsResponse>('/api/post/notifications/entry-seen')
  } catch (error) {
    if (error instanceof ApiException && error.requiresReLogin) {
      throw error
    }

    return markPostNotificationsSeen()
  }
}

export async function createPost(payload: {
  content: string
  images: string[]
  remindAgentIds?: string[]
}) {
  return post<PostItem>('/api/post', {
    content: normalizeEmojiText(payload.content),
    images: payload.images,
    remindAgentIds: payload.remindAgentIds ?? [],
  })
}

export async function getComments(postId: string) {
  const data = await get<{ items: PostCommentItem[] }>(`/api/post/${postId}/comments`)

  return Array.isArray(data.items) ? data.items : []
}

export async function createComment(
  postId: string,
  payload: {
    content: string
    replyToCommentId?: string
  },
) {
  return post<PostCommentItem>(`/api/post/${postId}/comments`, {
    content: normalizeEmojiText(payload.content),
    ...(payload.replyToCommentId?.trim()
      ? { replyToCommentId: payload.replyToCommentId.trim() }
      : {}),
  })
}

export async function likePost(postId: string) {
  return post<PostItem>(`/api/post/${postId}/likes`)
}

export async function unlikePost(postId: string) {
  return del<PostItem>(`/api/post/${postId}/likes`)
}

export async function deletePost(postId: string) {
  return del<{ id: string; deleted: true }>(`/api/post/${postId}`)
}
