<template>
  <div
    class="post-list-panel"
    :class="{ 'post-list-panel--embedded': embedded }"
  >
    <a-card
      class="post-list-panel__card"
      :class="{ 'post-list-panel__card--embedded': embedded }"
      :bordered="false"
      :title="embedded ? undefined : title"
    >
      <a-form
        :model="searchForm"
        layout="inline"
        class="post-list-panel__search"
      >
        <a-form-item field="keyword" label="关键词">
          <a-input
            v-model="searchForm.keyword"
            allow-clear
            placeholder="搜索内容、用户昵称、账号或ID"
            @press-enter="handleSearch"
          />
        </a-form-item>
        <a-form-item v-if="!effectiveUserId" field="userId" label="用户ID">
          <a-input
            v-model="searchForm.userId"
            allow-clear
            placeholder="按用户ID筛选"
            @press-enter="handleSearch"
          />
        </a-form-item>
        <a-form-item field="moderationStatus" label="状态">
          <a-select
            v-model="searchForm.moderationStatus"
            allow-clear
            placeholder="全部"
            class="post-list-panel__filter"
          >
            <a-option value="normal">正常</a-option>
            <a-option value="risk_controlled">风控中</a-option>
          </a-select>
        </a-form-item>
        <a-form-item>
          <a-space>
            <a-button type="primary" :loading="loading" @click="handleSearch">
              <template #icon>
                <icon-search />
              </template>
              查询
            </a-button>
            <a-button @click="resetSearch">重置</a-button>
          </a-space>
        </a-form-item>
      </a-form>

      <a-table
        row-key="id"
        :data="renderList"
        :loading="loading"
        :pagination="false"
        :bordered="false"
        :scroll="{ x: effectiveUserId ? 1200 : 1460 }"
      >
        <template #empty>
          <a-empty :description="emptyDescription">
            <a-button v-if="hasSearch" type="text" @click="resetSearch">
              清空筛选
            </a-button>
          </a-empty>
        </template>
        <template #columns>
          <a-table-column
            v-if="!effectiveUserId"
            title="发布用户"
            data-index="user"
            :width="260"
          >
            <template #cell="{ record }">
              <a-space v-if="record.user">
                <a-avatar :size="40">
                  <img
                    v-if="isRenderableAvatar(record.user.avatar)"
                    :src="record.user.avatar"
                    alt="avatar"
                  />
                  <template v-else>
                    {{ getAvatarFallback(record.user.name) }}
                  </template>
                </a-avatar>
                <div class="post-list-panel__identity">
                  <a-link @click="goUserDetail(record.user.id)">
                    {{ record.user.name || '-' }}
                  </a-link>
                  <a-tooltip :content="record.user.account || record.user.id">
                    <a-typography-text class="post-list-panel__id" copyable>
                      {{ record.user.account || record.user.id }}
                    </a-typography-text>
                  </a-tooltip>
                </div>
              </a-space>
              <a-tooltip v-else :content="record.userId">
                <a-typography-text class="post-list-panel__id" copyable>
                  {{ record.userId }}
                </a-typography-text>
              </a-tooltip>
            </template>
          </a-table-column>

          <a-table-column title="动态内容" data-index="content" :width="360">
            <template #cell="{ record }">
              <div class="post-list-panel__post">
                <a-tooltip :content="record.content || '（仅图片）'">
                  <div class="post-list-panel__content">
                    {{ record.content || '（仅图片）' }}
                  </div>
                </a-tooltip>
                <div
                  v-if="record.images.length"
                  class="post-list-panel__images"
                >
                  <img
                    v-for="image in getPreviewImages(record)"
                    :key="image"
                    class="post-list-panel__image"
                    :src="image"
                    alt="post image"
                  />
                  <span
                    v-if="record.images.length > previewImageCount"
                    class="post-list-panel__image-more"
                  >
                    +{{ record.images.length - previewImageCount }}
                  </span>
                </div>
              </div>
            </template>
          </a-table-column>

          <a-table-column
            title="状态"
            data-index="moderationStatus"
            :width="130"
          >
            <template #cell="{ record }">
              <a-space direction="vertical" size="mini">
                <a-tag v-if="record.isPinned" color="orange">已置顶</a-tag>
                <a-tooltip
                  :content="record.moderationReason || formatStatus(record)"
                >
                  <a-tag :color="getStatusColor(record)">
                    {{ formatStatus(record) }}
                  </a-tag>
                </a-tooltip>
              </a-space>
            </template>
          </a-table-column>

          <a-table-column title="互动" :width="120">
            <template #cell="{ record }">
              <div class="post-list-panel__metrics">
                <span>赞 {{ record.likeCount }}</span>
                <span>评 {{ record.commentCount }}</span>
              </div>
            </template>
          </a-table-column>

          <a-table-column title="发布时间" data-index="createdAt" :width="180">
            <template #cell="{ record }">
              {{ formatDate(record.createdAt) }}
            </template>
          </a-table-column>
          <a-table-column title="更新时间" data-index="updatedAt" :width="180">
            <template #cell="{ record }">
              {{ formatDate(record.updatedAt) }}
            </template>
          </a-table-column>
          <a-table-column title="操作" :width="220" fixed="right">
            <template #cell="{ record }">
              <a-space>
                <a-button
                  type="text"
                  size="small"
                  :loading="pinningPostId === record.id"
                  :disabled="saving"
                  @click="togglePinning(record)"
                >
                  {{ record.isPinned ? '取消置顶' : '置顶' }}
                </a-button>
                <a-button
                  v-if="record.isRiskControlled"
                  type="text"
                  size="small"
                  @click="openModeration(record, 'normal')"
                >
                  解除风控
                </a-button>
                <a-button
                  v-else
                  type="text"
                  status="danger"
                  size="small"
                  @click="openModeration(record, 'risk_controlled')"
                >
                  风控
                </a-button>
              </a-space>
            </template>
          </a-table-column>
        </template>
      </a-table>

      <div class="post-list-panel__pagination">
        <span class="post-list-panel__total">
          共 {{ pagination.total }} 条动态
        </span>
        <a-pagination
          :current="pagination.current"
          :page-size="pagination.pageSize"
          :total="pagination.total"
          show-page-size
          @change="onPageChange"
          @page-size-change="onPageSizeChange"
        />
      </div>

      <a-modal
        v-model:visible="moderationVisible"
        :title="moderationModalTitle"
        :confirm-loading="saving"
        :ok-text="moderationOkText"
        :mask-closable="false"
        @before-ok="submitModeration"
        @cancel="closeModeration"
      >
        <div v-if="moderatingPost" class="post-list-panel__moderation-context">
          <a-typography-text type="secondary">
            动态ID：{{ moderatingPost.id }}
          </a-typography-text>
          <div class="post-list-panel__moderation-preview">
            {{ moderatingPost.content || '（仅图片动态）' }}
          </div>
        </div>
        <a-form :model="moderationForm" layout="vertical">
          <a-form-item
            v-if="nextModerationStatus === 'risk_controlled'"
            field="reason"
            label="风控原因"
          >
            <a-textarea
              v-model="moderationForm.reason"
              :max-length="200"
              show-word-limit
              allow-clear
              placeholder="可填写风控原因，用户端仅展示风控状态"
            />
          </a-form-item>
          <a-alert v-else type="info">
            解除后，这条动态会重新出现在小程序动态列表中。
          </a-alert>
        </a-form>
      </a-modal>
    </a-card>
  </div>
</template>

<script lang="ts" setup>
  import { computed, reactive, ref, watch } from 'vue';
  import { useRouter } from 'vue-router';
  import dayjs from 'dayjs';
  import { Message } from '@arco-design/web-vue';
  import type { PostModerationStatusDTO } from '@tzl/shared';
  import { queryAppUserPosts } from '@/api/app-user';
  import {
    PostListParams,
    PostRecord,
    queryPostList,
    updatePostModeration,
    updatePostPinning,
  } from '@/api/post';

  const props = withDefaults(
    defineProps<{
      userId?: string;
      title?: string;
      embedded?: boolean;
    }>(),
    {
      userId: '',
      title: '动态管理',
      embedded: false,
    }
  );

  const router = useRouter();
  const renderList = ref<PostRecord[]>([]);
  const loading = ref(false);
  const saving = ref(false);
  const pinningPostId = ref('');
  const moderationVisible = ref(false);
  const moderatingPost = ref<PostRecord | null>(null);
  const nextModerationStatus = ref<PostModerationStatusDTO>('risk_controlled');
  const previewImageCount = 3;
  const searchForm = reactive<{
    keyword: string;
    userId: string;
    moderationStatus?: PostModerationStatusDTO;
  }>({
    keyword: '',
    userId: '',
    moderationStatus: undefined,
  });
  const moderationForm = reactive({
    reason: '',
  });
  const pagination = reactive({
    current: 1,
    pageSize: 20,
    total: 0,
  });

  const effectiveUserId = computed(() => props.userId.trim());
  const hasSearch = computed(() =>
    Boolean(
      searchForm.keyword.trim() ||
        searchForm.userId.trim() ||
        searchForm.moderationStatus
    )
  );
  const emptyDescription = computed(() =>
    hasSearch.value ? '未找到匹配动态' : '暂无动态'
  );
  const requestParams = computed<PostListParams>(() => ({
    keyword: searchForm.keyword.trim() || undefined,
    userId: effectiveUserId.value || searchForm.userId.trim() || undefined,
    moderationStatus: searchForm.moderationStatus,
    page: pagination.current,
    pageSize: pagination.pageSize,
  }));
  const moderationModalTitle = computed(() =>
    nextModerationStatus.value === 'risk_controlled' ? '风控动态' : '解除风控'
  );
  const moderationOkText = computed(() =>
    nextModerationStatus.value === 'risk_controlled' ? '确认风控' : '解除风控'
  );

  const fetchData = async () => {
    try {
      loading.value = true;
      const { data } = effectiveUserId.value
        ? await queryAppUserPosts(effectiveUserId.value, {
            keyword: requestParams.value.keyword,
            moderationStatus: requestParams.value.moderationStatus,
            page: requestParams.value.page,
            pageSize: requestParams.value.pageSize,
          })
        : await queryPostList(requestParams.value);

      renderList.value = data.items;
      pagination.total = data.total;
      pagination.current = data.page;
      pagination.pageSize = data.pageSize;
    } catch (error) {
      Message.error('动态列表加载失败');
      renderList.value = [];
      pagination.total = 0;
    } finally {
      loading.value = false;
    }
  };

  const handleSearch = () => {
    pagination.current = 1;
    fetchData();
  };

  const resetSearch = () => {
    searchForm.keyword = '';
    searchForm.userId = '';
    searchForm.moderationStatus = undefined;
    pagination.current = 1;
    fetchData();
  };

  const onPageChange = (page: number) => {
    pagination.current = page;
    fetchData();
  };

  const onPageSizeChange = (pageSize: number) => {
    pagination.pageSize = pageSize;
    pagination.current = 1;
    fetchData();
  };

  const openModeration = (
    record: PostRecord,
    status: PostModerationStatusDTO
  ) => {
    moderatingPost.value = record;
    nextModerationStatus.value = status;
    moderationForm.reason =
      status === 'risk_controlled' ? record.moderationReason : '';
    moderationVisible.value = true;
  };

  const closeModeration = () => {
    moderationVisible.value = false;
    moderatingPost.value = null;
    moderationForm.reason = '';
  };

  const submitModeration = async () => {
    if (!moderatingPost.value) {
      return false;
    }

    try {
      saving.value = true;
      await updatePostModeration(moderatingPost.value.id, {
        moderationStatus: nextModerationStatus.value,
        moderationReason: moderationForm.reason,
      });
      Message.success(
        nextModerationStatus.value === 'risk_controlled'
          ? '动态已风控'
          : '动态已解除风控'
      );
      closeModeration();
      await fetchData();
      return true;
    } catch (error) {
      Message.error('动态状态更新失败');
      return false;
    } finally {
      saving.value = false;
    }
  };

  const togglePinning = async (record: PostRecord) => {
    try {
      pinningPostId.value = record.id;
      const isPinned = !record.isPinned;
      await updatePostPinning(record.id, { isPinned });
      Message.success(isPinned ? '动态已置顶' : '动态已取消置顶');
      await fetchData();
    } catch (error) {
      Message.error('动态置顶状态更新失败');
    } finally {
      pinningPostId.value = '';
    }
  };

  const goUserDetail = (userId: string) => {
    if (!userId) {
      return;
    }

    router.push({ name: 'AppUserDetail', params: { id: userId } });
  };

  const getPreviewImages = (record: PostRecord) => {
    return record.images.slice(0, previewImageCount);
  };

  const formatDate = (value: string) => {
    return value ? dayjs(value).format('YYYY-MM-DD HH:mm') : '-';
  };

  const formatStatus = (record: PostRecord) => {
    return record.isRiskControlled ? '风控中' : '正常';
  };

  const getStatusColor = (record: PostRecord) => {
    return record.isRiskControlled ? 'red' : 'green';
  };

  const getAvatarFallback = (name: string) => {
    return name?.trim()?.slice(0, 1)?.toUpperCase() || 'U';
  };

  const isRenderableAvatar = (avatar: string) => {
    const value = avatar?.trim();

    return Boolean(value && /^(https?:)?\/\//i.test(value));
  };

  watch(
    effectiveUserId,
    () => {
      pagination.current = 1;
      fetchData();
    },
    { immediate: true }
  );
</script>

<style lang="less" scoped>
  .post-list-panel {
    min-height: 100%;

    &--embedded {
      min-height: 0;
    }

    &__card {
      border-radius: 4px;

      &--embedded {
        min-height: 0;
      }
    }

    border-radius: 4px;

    &__search {
      margin-bottom: 16px;
    }

    &__filter {
      width: 140px;
    }

    &__identity {
      min-width: 0;
    }

    &__id {
      display: block;
      max-width: 176px;
      margin-top: 4px;
      overflow: hidden;
      color: var(--color-text-3);
      font-size: 12px;
      white-space: nowrap;
      text-overflow: ellipsis;
      vertical-align: bottom;

      :deep(.arco-typography-operation-copy) {
        margin-left: 4px;
      }
    }

    &__post {
      min-width: 0;
    }

    &__content {
      display: -webkit-box;
      max-width: 320px;
      overflow: hidden;
      color: var(--color-text-1);
      line-height: 20px;
      text-overflow: ellipsis;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
    }

    &__images {
      display: flex;
      gap: 6px;
      align-items: center;
      margin-top: 8px;
    }

    &__image {
      width: 44px;
      height: 44px;
      object-fit: cover;
      border-radius: 4px;
      background: var(--color-fill-2);
    }

    &__image-more {
      color: var(--color-text-3);
      font-size: 12px;
    }

    &__metrics {
      display: flex;
      flex-direction: column;
      gap: 4px;
      color: var(--color-text-2);
      font-size: 13px;
    }

    &__pagination {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-top: 16px;
    }

    &__total {
      color: var(--color-text-2);
      font-size: 14px;
    }

    &__moderation-context {
      margin-bottom: 16px;
    }

    &__moderation-preview {
      display: -webkit-box;
      margin-top: 8px;
      overflow: hidden;
      color: var(--color-text-1);
      line-height: 20px;
      text-overflow: ellipsis;
      -webkit-line-clamp: 3;
      -webkit-box-orient: vertical;
    }
  }

  @media (max-width: 575px) {
    .post-list-panel {
      &__pagination {
        flex-direction: column;
        gap: 12px;
        align-items: flex-start;
      }
    }
  }
</style>
