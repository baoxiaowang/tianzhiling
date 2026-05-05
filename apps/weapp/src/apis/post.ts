import { del, get, post } from '../api/api-client'

export type PostCommentType = 'user' | 'agent'

export interface PostCommentNotificationItem {
  id: string
  postId: string
  commentId: string
  type: PostCommentType
  actorName: string
  actorAvatar: string
  commentPreview: string
  isRead: boolean
  createdAt: string | null
}

export interface PostCommentNotificationSummary {
  unreadCount: number
  latest: PostCommentNotificationItem | null
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
  likeCount: number
  likedByMe: boolean
  commentCount: number
  comments: PostCommentItem[]
  createdAt: string | null
  updatedAt: string | null
}

interface PostListResponse {
  items: PostItem[]
}

export async function getPosts() {
  const data = await get<PostListResponse>('/api/post')

  return Array.isArray(data.items) ? data.items : []
}

export async function getPostDetail(postId: string) {
  return get<PostItem>(`/api/post/${postId}`)
}

export async function getCommentNotificationSummary() {
  return get<PostCommentNotificationSummary>('/api/post/comment-notifications/summary')
}

export async function markCommentNotificationsRead(postId: string) {
  await post<Record<string, unknown>>(`/api/post/${postId}/comment-notifications/read`)
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
