import { del, get, post } from '../api/api-client'

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
  isRead: boolean
  createdAt: string | null
}

export interface PostNotificationSummary {
  unreadCount: number
  latest: PostNotificationItem | null
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
}

export interface GetPostsOptions {
  page?: number
  pageSize?: number
  mine?: boolean
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

  const url = queryParts.length ? `/api/post?${queryParts.join('&')}` : '/api/post'
  const data = await get<PostListResponse>(url)

  return {
    items: Array.isArray(data.items) ? data.items : [],
    page: data.page ?? options.page ?? 1,
    pageSize: data.pageSize ?? options.pageSize ?? 10,
    hasMore: data.hasMore === true,
  }
}

export async function getPostDetail(postId: string) {
  return get<PostItem>(`/api/post/${postId}`)
}

export async function getCommentNotificationSummary() {
  return get<PostCommentNotificationSummary>('/api/post/comment-notifications/summary')
}

export async function getPostNotificationSummary() {
  return get<PostNotificationSummary>('/api/post/notifications/summary')
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

  const url = queryParts.length
    ? `/api/post/notifications?${queryParts.join('&')}`
    : '/api/post/notifications'
  const data = await get<PostNotificationListResponse>(url)

  return {
    items: Array.isArray(data.items) ? data.items : [],
    page: data.page ?? options.page ?? 1,
    pageSize: data.pageSize ?? options.pageSize ?? 20,
    hasMore: data.hasMore === true,
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

export async function createPost(payload: {
  content: string
  images: string[]
  remindAgentIds?: string[]
}) {
  return post<PostItem>('/api/post', {
    content: payload.content,
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
    content: payload.content,
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
