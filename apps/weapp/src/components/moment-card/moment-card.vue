<template>
  <view class="moment-card">
    <view class="moment-card__avatar-column">
      <image
        v-if="post.authorAvatar"
        class="moment-card__avatar"
        :src="post.authorAvatar"
        mode="aspectFill"
      />
      <view v-else class="moment-card__avatar moment-card__avatar--fallback">
        <text>{{ authorName.slice(0, 1) }}</text>
      </view>
    </view>

    <view class="moment-card__content-column">
      <view class="moment-card__meta">
        <text class="moment-card__author">{{ authorName }}</text>
        <text v-if="post.content" class="moment-card__body-text">{{ post.content }}</text>
      </view>

      <view
        v-if="postImages.length"
        class="moment-card__image-grid"
        :class="`moment-card__image-grid--${postImages.length}`"
      >
        <view
          v-for="(image, index) in postImages"
          :key="`${post.id}-${image}-${index}`"
          class="moment-card__image-wrap"
          @tap="emitPreview(index)"
        >
          <image class="moment-card__image" :src="image" mode="aspectFill" />
        </view>
      </view>

      <view class="moment-card__stats">
        <text class="moment-card__time">
          {{ relativeTime }}
        </text>
        <view class="moment-card__actions">
          <view
            class="moment-card__action"
            :class="{ 'moment-card__action--active': post.likedByMe }"
            @tap="emitLike"
          >
            <image class="moment-card__action-icon" :src="likeIconUrl" mode="aspectFit" />
            <text class="moment-card__action-count">{{ likeCount }}</text>
          </view>
          <view class="moment-card__action" @tap="emitComment">
            <image class="moment-card__action-icon" :src="commentIconUrl" mode="aspectFit" />
            <text class="moment-card__action-count">{{ post.commentCount }}</text>
          </view>
        </view>
      </view>

      <view v-if="post.comments.length" class="moment-card__comments">
        <view
          v-for="comment in post.comments"
          :key="comment.id"
          class="moment-card__comment"
          @tap="emitComment"
        >
          <text class="moment-card__comment-author">
            {{ formatCommentAuthor(comment.authorName, comment.replyToUserName) }}
          </text>
          <text class="moment-card__comment-text">{{ comment.content }}</text>
        </view>
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
import { computed } from 'vue'
import type { PostItem } from '../../apis/post'
import likeIconUrl from '../../assets/icon/like.svg'
import commentIconUrl from '../../assets/icon/comment.svg'

const props = defineProps<{
  post: PostItem
}>()

const emit = defineEmits<{
  like: [post: PostItem]
  comment: [post: PostItem]
  preview: [post: PostItem, index: number]
}>()

const authorName = computed(() => {
  const name = props.post.authorName.trim()
  return name ? name : '天之灵用户'
})
const postImages = computed(() => {
  return props.post.images
    .map((image) => image.trim())
    .filter(Boolean)
    .slice(0, 9)
})
const relativeTime = computed(() => {
  return formatMomentRelativeTime(props.post.updatedAt ?? props.post.createdAt)
})
const likeCount = computed(() => {
  return Number.isFinite(props.post.likeCount) ? props.post.likeCount : 0
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

function formatCommentAuthor(authorName: string, replyToUserName: string) {
  const author = authorName.trim() || '天之灵用户'
  const replyTo = replyToUserName.trim()

  return replyTo ? `${author} 回复 ${replyTo}：` : `${author}：`
}

function emitComment() {
  emit('comment', props.post)
}

function emitLike() {
  emit('like', props.post)
}

function emitPreview(index: number) {
  emit('preview', props.post, index)
}
</script>

<style lang="scss">
.moment-card {
  display: flex;
  gap: 12px;
  padding: 16px;
  border-bottom: 1px solid #eef2f7;
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
  border-radius: 10px;
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

.moment-card__meta {
  flex: 1;
}

.moment-card__author {
  display: block;
  font-size: 18px;
  line-height: 27px;
  font-weight: 500;
  color: #0a0a0a;
}

.moment-card__body-text {
  display: block;
  margin-top: 4px;
  font-size: 14px;
  line-height: 22.75px;
  color: $tzl-color-slate-700;
}

.moment-card__image-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 12px;
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
  width: calc((100% - 12px) / 3);
  height: 92px;
  overflow: hidden;
  border-radius: 8px;
  background: #f1f5f9;
}

.moment-card__image-grid--2 .moment-card__image-wrap,
.moment-card__image-grid--4 .moment-card__image-wrap {
  width: calc((100% - 6px) / 2);
  height: 121px;
}

.moment-card__image-grid--1 .moment-card__image-wrap {
  width: 100%;
  height: 188px;
  border-radius: 12px;
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
  margin-top: 12px;
}

.moment-card__time {
  font-size: 14px;
  line-height: 20px;
  color: $tzl-color-slate-500;
}

.moment-card__actions {
  display: flex;
  align-items: center;
  gap: 16px;
}

.moment-card__action {
  display: flex;
  align-items: center;
  gap: 4px;
  color: $tzl-color-slate-500;
}

.moment-card__action-icon {
  width: 18px;
  height: 18px;
  display: block;
}

.moment-card__action-count {
  font-size: 14px;
  line-height: 20px;
}

.moment-card__action--active {
  color: #00a63e;
}

.moment-card__action--active .moment-card__action-icon {
  filter: brightness(0) saturate(100%) invert(46%) sepia(95%) saturate(1245%) hue-rotate(116deg)
    brightness(92%) contrast(101%);
}

.moment-card__comments {
  margin-top: 12px;
  padding: 8px 12px;
  border-radius: 8px;
  background: $tzl-color-surface-muted;
}

.moment-card__comment {
  display: block;
}

.moment-card__comment + .moment-card__comment {
  margin-top: 8px;
}

.moment-card__comment-author {
  font-size: 14px;
  line-height: 20px;
  font-weight: 500;
  color: #101828;
}

.moment-card__comment-text {
  font-size: 14px;
  line-height: 20px;
  color: $tzl-color-slate-700;
}
</style>
