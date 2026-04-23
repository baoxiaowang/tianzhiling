import { get } from '../api/api-client'

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

export async function getCommentNotificationSummary() {
  return get<PostCommentNotificationSummary>('/api/post/comment-notifications/summary')
}
