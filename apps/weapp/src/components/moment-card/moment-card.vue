<template>
  <view class="moment-card" @tap="emitOpen">
    <view class="moment-card__avatar-column">
      <image
        v-if="post.authorAvatar"
        class="moment-card__avatar"
        :src="post.authorAvatar"
        mode="aspectFill"
        lazy-load
      />
      <view v-else class="moment-card__avatar moment-card__avatar--fallback">
        <text>{{ authorName.slice(0, 1) }}</text>
      </view>
    </view>

    <view class="moment-card__content-column">
      <view class="moment-card__header">
        <view class="moment-card__meta">
          <text class="moment-card__author">{{ authorName }}</text>
          <view v-if="postContent" class="moment-card__body">
            <text
              class="moment-card__body-text"
              :class="{ 'moment-card__body-text--collapsed': shouldCollapseContent }"
            >
              {{ postContent }}
            </text>
            <text
              v-if="shouldShowExpandAction"
              class="moment-card__body-expand"
              @tap.stop="toggleContentExpanded"
            >
              {{ isContentExpanded ? '收起' : '全文' }}
            </text>
          </view>
        </view>
      </view>

      <view
        v-if="postDisplayImages.length"
        class="moment-card__image-grid"
        :class="`moment-card__image-grid--${postDisplayImages.length}`"
      >
        <view
          v-for="(image, index) in postDisplayImages"
          :key="`${post.id}-${image}-${index}`"
          class="moment-card__image-wrap"
          @tap.stop="emitPreview(index)"
        >
          <image
            class="moment-card__image"
            :src="image"
            mode="aspectFill"
            lazy-load
          />
        </view>
      </view>

      <view class="moment-card__stats">
        <view class="moment-card__status-row">
          <text class="moment-card__time">
            {{ relativeTime }}
          </text>
          <view
            v-if="showOwnerActions"
            class="moment-card__delete"
            :class="{ 'moment-card__delete--disabled': isDeleting }"
            @tap.stop="emitDelete"
          >
            <view class="moment-card__delete-icon" />
          </view>
          <text
            v-if="showModerationStatus && isRiskControlled"
            class="moment-card__risk-tag"
          >
            风控中
          </text>
        </view>
        <view
          v-if="showCommentAction"
          class="moment-card__actions"
        >
          <view class="moment-card__action-item" @tap.stop="handleLikeAction">
            <view
              class="moment-card__action-icon moment-card__action-icon--like"
              :class="{ 'moment-card__action-icon--like-active': post.likedByMe }"
            />
            <text class="moment-card__action-text" :class="{ 'moment-card__action-text--active': post.likedByMe }">
              共鸣
            </text>
          </view>
          <view class="moment-card__action-item" @tap.stop="handleCommentAction">
            <view class="moment-card__action-icon moment-card__action-icon--comment" />
            <text class="moment-card__action-text">评论</text>
          </view>
        </view>
      </view>

      <view v-if="shouldShowInteractionBox" class="moment-card__comments">
        <view v-if="shouldShowLikeSummary" class="moment-card__likes">
          <view class="moment-card__likes-icon" />
          <text class="moment-card__likes-name">{{ likeSummaryText }}</text>
        </view>
        <view
          v-if="shouldShowLikeSummary && post.comments.length"
          class="moment-card__interaction-divider"
        />
        <view
          v-for="comment in visibleComments"
          :key="comment.id"
          class="moment-card__comment"
          @tap.stop="emitComment(comment)"
        >
          <text class="moment-card__comment-author">
            {{ formatCommentAuthor(comment.authorName) }}
          </text>
          <text v-if="comment.replyToUserName" class="moment-card__comment-reply"> 回复 </text>
          <text v-if="comment.replyToUserName" class="moment-card__comment-author">
            {{ formatCommentAuthor(comment.replyToUserName) }}
          </text>
          <text class="moment-card__comment-colon">：</text>
          <text class="moment-card__comment-text">{{ formatCommentContent(comment.content) }}</text>
        </view>
        <text
          v-if="hiddenCommentCount"
          class="moment-card__comments-more"
          @tap.stop="expandComments"
        >
          查看{{ hiddenCommentCount }}条评论
        </text>
      </view>
    </view>
  </view>
</template>

<script lang="ts">
export default {
  name: 'MomentCard',
}
</script>

<script setup lang="ts">
import { computed, ref } from 'vue'
import type { PostCommentItem, PostItem } from '../../apis/post'
import { normalizeEmojiText } from '../../utils/emoji-text'
import { brand } from '../../config/brand'

const props = withDefaults(
  defineProps<{
    post: PostItem
    showOwnerActions?: boolean
    showModerationStatus?: boolean
    showCommentAction?: boolean
    isDeleting?: boolean
  }>(),
  {
    showOwnerActions: false,
    showModerationStatus: false,
    showCommentAction: true,
    isDeleting: false,
  },
)

const emit = defineEmits<{
  like: [post: PostItem]
  comment: [post: PostItem, replyToComment?: PostCommentItem]
  preview: [post: PostItem, index: number]
  delete: [post: PostItem]
  open: [post: PostItem]
}>()

const VISIBLE_COMMENT_COUNT = 2

function normalizeText(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

const authorName = computed(() => {
  const name = normalizeText(props.post.authorName)
  return name ? name : `${brand.name}用户`
})
const postImages = computed(() => {
  return props.post.images
    .map(normalizeText)
    .filter(Boolean)
    .slice(0, 9)
})
const postDisplayImages = computed(() => {
  const thumbnails = Array.isArray(props.post.imageThumbnails)
    ? props.post.imageThumbnails
    : []

  return postImages.value.map((image, index) => {
    return normalizeText(thumbnails[index]) || image
  })
})
const relativeTime = computed(() => {
  return formatMomentRelativeTime(props.post.updatedAt ?? props.post.createdAt)
})
const likeCount = computed(() => {
  return Number.isFinite(props.post.likeCount) ? props.post.likeCount : 0
})
const showOwnerActions = computed(() => props.showOwnerActions)
const showModerationStatus = computed(() => props.showModerationStatus)
const showCommentAction = computed(() => props.showCommentAction)
const isDeleting = computed(() => props.isDeleting)
const isRiskControlled = computed(() => {
  return (
    props.post.isRiskControlled === true ||
    props.post.moderationStatus === 'risk_controlled'
  )
})
const isContentExpanded = ref(false)
const areCommentsExpanded = ref(false)
const postContent = computed(() => normalizeEmojiText(normalizeText(props.post.content)))
const shouldShowExpandAction = computed(() => {
  const content = postContent.value
  const lineBreakCount = content.split(/\r?\n/).length

  return content.length > 72 || lineBreakCount > 4
})
const shouldCollapseContent = computed(() => {
  return shouldShowExpandAction.value && !isContentExpanded.value
})
const shouldShowLikeSummary = computed(() => {
  return props.post.likedByMe || likeCount.value > 0
})
const shouldShowInteractionBox = computed(() => {
  return shouldShowLikeSummary.value || props.post.comments.length > 0
})
const visibleComments = computed(() => {
  return areCommentsExpanded.value
    ? props.post.comments
    : props.post.comments.slice(0, VISIBLE_COMMENT_COUNT)
})
const hiddenCommentCount = computed(() => {
  return Math.max(0, props.post.comments.length - visibleComments.value.length)
})
const likeSummaryText = computed(() => {
  if (props.post.likedByMe) {
    if (likeCount.value <= 1) {
      return '我'
    }

    return `我等${likeCount.value}人`
  }

  return `${likeCount.value}人共鸣了`
})

function formatMomentRelativeTime(value: string | null) {
  if (!value || !value.trim()) {
    return '刚刚'
  }

  const parsed = new Date(value)

  if (Number.isNaN(parsed.getTime())) {
    return '刚刚'
  }

  const diffMs = Math.max(0, Date.now() - parsed.getTime())
  const diffSeconds = Math.floor(diffMs / 1000)
  const diffMinutes = Math.floor(diffSeconds / 60)
  const diffHours = Math.floor(diffMinutes / 60)
  const diffDays = Math.floor(diffHours / 24)

  if (diffSeconds < 60) {
    return '刚刚'
  }

  if (diffMinutes < 60) {
    return `${diffMinutes}分钟前`
  }

  if (diffHours < 24) {
    return `${diffHours}小时前`
  }

  if (diffDays < 7) {
    return `${diffDays}天前`
  }

  const parts = [
    parsed.getFullYear(),
    `${parsed.getMonth() + 1}`.padStart(2, '0'),
    `${parsed.getDate()}`.padStart(2, '0'),
  ]

  return parts.join('-')
}

function formatCommentAuthor(authorName: unknown) {
  const author = normalizeText(authorName) || `${brand.name}用户`

  return author
}

function formatCommentContent(content: unknown) {
  return normalizeEmojiText(normalizeText(content))
}

function toggleContentExpanded() {
  isContentExpanded.value = !isContentExpanded.value
}

function expandComments() {
  areCommentsExpanded.value = true
}

function handleLikeAction() {
  emitLike()
}

function handleCommentAction() {
  emitComment()
}

function emitComment(replyToComment?: PostCommentItem) {
  emit('comment', props.post, replyToComment)
}

function emitLike() {
  emit('like', props.post)
}

function emitPreview(index: number) {
  emit('preview', props.post, index)
}

function emitDelete() {
  if (isDeleting.value) {
    return
  }

  emit('delete', props.post)
}

function emitOpen() {
  emit('open', props.post)
}
</script>

<style lang="scss">
.moment-card {
  display: flex;
  gap: 10px;
  padding: 14px 16px 12px;
  border-bottom: 1px solid #f2f2f2;
  background: #ffffff;
}

.moment-card__avatar-column {
  flex-shrink: 0;
}

.moment-card__content-column {
  flex: 1;
  min-width: 0;
}

.moment-card__avatar {
  width: 40px;
  height: 40px;
  border-radius: 4px;
  background: #e5e7eb;
}

.moment-card__avatar--fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  color: #6a7282;
  font-size: 16px;
  font-weight: 600;
}

.moment-card__header {
  display: block;
}

.moment-card__meta {
  flex: 1;
  min-width: 0;
}

.moment-card__author {
  display: block;
  font-size: 16px;
  line-height: 22px;
  font-weight: 500;
  color: #576b95;
}

.moment-card__body {
  margin-top: 3px;
}

.moment-card__body-text {
  display: block;
  font-size: 16px;
  line-height: 24px;
  color: #191919;
  white-space: pre-wrap;
  word-break: break-word;
}

.moment-card__body-text--collapsed {
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 4;
  -webkit-box-orient: vertical;
}

.moment-card__body-expand {
  display: inline-block;
  margin-top: 3px;
  color: #576b95;
  font-size: 16px;
  line-height: 24px;
}

.moment-card__image-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-top: 9px;
}

.moment-card__image-grid--1 {
  width: 68%;
  min-width: 180px;
  max-width: 240px;
}

.moment-card__image-grid--2,
.moment-card__image-grid--4 {
  width: 100%;
  max-width: 100%;
}

.moment-card__image-grid--3,
.moment-card__image-grid--5,
.moment-card__image-grid--6,
.moment-card__image-grid--7,
.moment-card__image-grid--8,
.moment-card__image-grid--9 {
  width: 100%;
}

.moment-card__image-wrap {
  position: relative;
  width: calc((100% - 10px) / 3);
  height: 92px;
  overflow: hidden;
  border-radius: 3px;
  background: #f2f2f2;
}

.moment-card__image-grid--2 .moment-card__image-wrap,
.moment-card__image-grid--4 .moment-card__image-wrap {
  width: calc((100% - 5px) / 2);
  height: 121px;
}

.moment-card__image-grid--1 .moment-card__image-wrap {
  width: 100%;
  height: 188px;
  border-radius: 3px;
}

.moment-card__image {
  width: 100%;
  height: 100%;
  display: block;
}

.moment-card__stats {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 8px;
  min-height: 24px;
}

.moment-card__status-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.moment-card__time {
  font-size: 13px;
  line-height: 18px;
  color: #8a8a8a;
}

.moment-card__risk-tag {
  padding: 2px 7px;
  border-radius: 999px;
  background: #fff1f0;
  color: #cf1322;
  font-size: 12px;
  line-height: 18px;
}

.moment-card__actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  margin-left: 10px;
  gap: 14px;
}

.moment-card__action-item {
  display: flex;
  align-items: center;
  gap: 5px;
}

.moment-card__action-icon {
  width: 18px;
  height: 18px;
  display: block;
  background-position: center;
  background-repeat: no-repeat;
  background-size: 18px 18px;
}

.moment-card__action-icon--like {
  background-image: url('../../assets/icon/resonance.svg');
}

.moment-card__action-icon--like-active {
  background-image: url('../../assets/icon/resonance-active.svg');
}

.moment-card__action-icon--comment {
  background-image: url('../../assets/icon/comment.svg');
}

.moment-card__action-text {
  font-size: 13px;
  line-height: 20px;
  color: #6a7282;
}

.moment-card__action-text--active {
  color: #f4513b;
}

.moment-card__delete {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  color: #576b95;
}

.moment-card__delete--disabled {
  color: #b8b8b8;
}

.moment-card__delete-icon {
  width: 14px;
  height: 14px;
  display: block;
  background: url('../../assets/icon/moments-delete-blue.svg') center / 14px 14px no-repeat;
}

.moment-card__comments {
  position: relative;
  margin-top: 8px;
  padding: 5px 7px;
  border-radius: 0;
  background: #f6f2fc;
}

.moment-card__comments::before {
  content: '';
  position: absolute;
  top: -5px;
  left: 14px;
  width: 0;
  height: 0;
  border-left: 5px solid transparent;
  border-right: 5px solid transparent;
  border-bottom: 5px solid #f6f2fc;
}

.moment-card__likes {
  display: flex;
  align-items: center;
  gap: 5px;
  min-height: 20px;
}

.moment-card__likes-icon {
  width: 16px;
  height: 16px;
  display: block;
  background: url('../../assets/icon/resonance-active.svg') center / 16px 16px no-repeat;
}

.moment-card__likes-name {
  font-size: 14px;
  line-height: 20px;
  color: #576b95;
}

.moment-card__interaction-divider {
  height: 1px;
  margin: 4px 0;
  background: #e9e1f5;
}

.moment-card__comment {
  display: block;
  font-size: 14px;
  line-height: 20px;
}

.moment-card__comment + .moment-card__comment {
  margin-top: 2px;
}

.moment-card__comment-author {
  font-size: 14px;
  line-height: 20px;
  font-weight: 500;
  color: #576b95;
}

.moment-card__comment-reply,
.moment-card__comment-colon {
  color: #191919;
}

.moment-card__comment-text {
  font-size: 14px;
  line-height: 20px;
  color: #191919;
}

.moment-card__comments-more {
  display: block;
  margin-top: 3px;
  font-size: 14px;
  line-height: 20px;
  color: #576b95;
}
</style>
