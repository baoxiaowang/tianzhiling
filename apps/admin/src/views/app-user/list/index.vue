<template>
  <div class="app-user-page">
    <a-card class="app-user-page__card" :bordered="false">
      <template #title>App 用户管理</template>

      <a-form :model="searchForm" layout="inline" class="app-user-page__search">
        <a-form-item field="keyword" label="关键词">
          <a-input
            v-model="searchForm.keyword"
            allow-clear
            placeholder="搜索昵称、手机号、账号或用户ID"
            @press-enter="handleSearch"
          />
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
        :scroll="{ x: 1120 }"
      >
        <template #empty>
          <a-empty :description="emptyDescription">
            <a-button v-if="hasSearchKeyword" type="text" @click="resetSearch">
              清空筛选
            </a-button>
          </a-empty>
        </template>
        <template #columns>
          <a-table-column title="用户" data-index="name" :width="260">
            <template #cell="{ record }">
              <a-space>
                <a-avatar :size="40">
                  <img
                    v-if="isRenderableAvatar(record.avatar)"
                    :src="record.avatar"
                    alt="avatar"
                  />
                  <template v-else>
                    {{ getAvatarFallback(record.name) }}
                  </template>
                </a-avatar>
                <div class="app-user-page__identity">
                  <div class="app-user-page__name">{{
                    record.name || '-'
                  }}</div>
                  <a-tooltip :content="record.id">
                    <a-typography-text class="app-user-page__id" copyable>
                      {{ record.id }}
                    </a-typography-text>
                  </a-tooltip>
                </div>
              </a-space>
            </template>
          </a-table-column>
          <a-table-column title="手机号" data-index="phone" :width="150">
            <template #cell="{ record }">
              <a-tooltip v-if="record.phone" :content="record.phone">
                <span class="app-user-page__mono">{{ record.phone }}</span>
              </a-tooltip>
              <span v-else>-</span>
            </template>
          </a-table-column>
          <a-table-column title="登录账号" data-index="account" :width="150">
            <template #cell="{ record }">
              <a-tooltip v-if="record.account" :content="record.account">
                <span class="app-user-page__mono">{{ record.account }}</span>
              </a-tooltip>
              <span v-else>-</span>
            </template>
          </a-table-column>
          <a-table-column
            title="手机验证"
            data-index="phoneVerified"
            :width="110"
          >
            <template #cell="{ record }">
              <a-tag :color="record.phoneVerified ? 'green' : 'gray'">
                {{ record.phoneVerified ? '已验证' : '未验证' }}
              </a-tag>
            </template>
          </a-table-column>
          <a-table-column title="注册时间" data-index="createdAt" :width="180">
            <template #cell="{ record }">
              {{ formatDate(record.createdAt) }}
            </template>
          </a-table-column>
          <a-table-column title="更新时间" data-index="updatedAt" :width="180">
            <template #cell="{ record }">
              {{ formatDate(record.updatedAt) }}
            </template>
          </a-table-column>
          <a-table-column title="操作" :width="140" fixed="right">
            <template #cell="{ record }">
              <a-space>
                <a-button type="text" size="small" @click="goDetail(record)">
                  详情
                </a-button>
                <a-button type="text" size="small" @click="openEdit(record)">
                  编辑
                </a-button>
              </a-space>
            </template>
          </a-table-column>
        </template>
      </a-table>

      <div class="app-user-page__pagination">
        <span class="app-user-page__total">
          共 {{ pagination.total }} 位用户
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
    </a-card>

    <a-modal
      v-model:visible="editVisible"
      :title="editModalTitle"
      :confirm-loading="saving"
      @before-ok="submitEdit"
      @cancel="closeEdit"
    >
      <a-descriptions
        v-if="editingUser"
        class="app-user-page__edit-context"
        :column="1"
        size="small"
        bordered
      >
        <a-descriptions-item label="用户ID">
          <a-typography-text copyable>{{ editingUser.id }}</a-typography-text>
        </a-descriptions-item>
        <a-descriptions-item label="登录账号">
          {{ editingUser.account || '-' }}
        </a-descriptions-item>
        <a-descriptions-item label="手机号">
          {{ editingUser.phone || '-' }}
        </a-descriptions-item>
      </a-descriptions>
      <a-form ref="editFormRef" :model="editForm" layout="vertical">
        <a-form-item
          field="name"
          label="昵称"
          :rules="[{ required: true, message: '请输入昵称' }]"
        >
          <a-input
            v-model="editForm.name"
            allow-clear
            placeholder="请输入昵称"
          />
        </a-form-item>
        <a-form-item field="avatar" label="头像地址">
          <a-input
            v-model="editForm.avatar"
            allow-clear
            placeholder="请输入头像 URL 或资源标识"
          />
        </a-form-item>
        <div class="app-user-page__avatar-preview">
          <span>头像预览</span>
          <a-avatar :size="48">
            <img
              v-if="isRenderableAvatar(editForm.avatar)"
              :src="editForm.avatar"
              alt="avatar"
            />
            <template v-else>{{ getAvatarFallback(editForm.name) }}</template>
          </a-avatar>
        </div>
      </a-form>
    </a-modal>
  </div>
</template>

<script lang="ts" setup>
  import { computed, reactive, ref } from 'vue';
  import { useRouter } from 'vue-router';
  import dayjs from 'dayjs';
  import { Message } from '@arco-design/web-vue';
  import type { FormInstance } from '@arco-design/web-vue/es/form';
  import useLoading from '@/hooks/loading';
  import {
    AppUserRecord,
    queryAppUserList,
    updateAppUser,
  } from '@/api/app-user';

  const { loading, setLoading } = useLoading();
  const router = useRouter();
  const renderList = ref<AppUserRecord[]>([]);
  const editVisible = ref(false);
  const saving = ref(false);
  const editingUserId = ref('');
  const editingUser = ref<AppUserRecord>();
  const editFormRef = ref<FormInstance>();
  const searchForm = reactive({
    keyword: '',
  });
  const editForm = reactive({
    name: '',
    avatar: '',
  });
  const pagination = reactive({
    current: 1,
    pageSize: 20,
    total: 0,
  });

  const requestParams = computed(() => ({
    keyword: searchForm.keyword.trim() || undefined,
    page: pagination.current,
    pageSize: pagination.pageSize,
  }));
  const hasSearchKeyword = computed(() => Boolean(searchForm.keyword.trim()));
  const emptyDescription = computed(() =>
    hasSearchKeyword.value ? '未找到匹配用户' : '暂无 App 用户'
  );
  const editModalTitle = computed(() =>
    editingUser.value
      ? `编辑用户资料：${editingUser.value.name || editingUser.value.id}`
      : '编辑用户资料'
  );

  const fetchData = async () => {
    try {
      setLoading(true);
      const { data } = await queryAppUserList(requestParams.value);
      renderList.value = data.items;
      pagination.total = data.total;
      pagination.current = data.page;
      pagination.pageSize = data.pageSize;
    } catch (error) {
      Message.error('用户列表加载失败');
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = () => {
    pagination.current = 1;
    fetchData();
  };

  const resetSearch = () => {
    searchForm.keyword = '';
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

  const goDetail = (record: AppUserRecord) => {
    router.push({
      name: 'AppUserDetail',
      params: {
        id: record.id,
      },
    });
  };

  const openEdit = (record: AppUserRecord) => {
    editingUser.value = record;
    editingUserId.value = record.id;
    editForm.name = record.name;
    editForm.avatar = record.avatar;
    editVisible.value = true;
  };

  const closeEdit = () => {
    editVisible.value = false;
    editingUserId.value = '';
    editingUser.value = undefined;
    editForm.name = '';
    editForm.avatar = '';
    editFormRef.value?.clearValidate();
  };

  const submitEdit = async () => {
    const errors = await editFormRef.value?.validate();

    if (errors) {
      return false;
    }

    try {
      saving.value = true;
      await updateAppUser(editingUserId.value, {
        name: editForm.name,
        avatar: editForm.avatar,
      });
      Message.success('用户资料已更新');
      closeEdit();
      await fetchData();
      return true;
    } catch (error) {
      Message.error('用户资料保存失败');
      return false;
    } finally {
      saving.value = false;
    }
  };

  const formatDate = (value: string) => {
    return value ? dayjs(value).format('YYYY-MM-DD HH:mm') : '-';
  };

  const getAvatarFallback = (name: string) => {
    return name?.trim()?.slice(0, 1)?.toUpperCase() || 'U';
  };

  const isRenderableAvatar = (avatar: string) => {
    const value = avatar?.trim();

    return Boolean(value && /^(https?:)?\/\//i.test(value));
  };

  fetchData();
</script>

<script lang="ts">
  export default {
    name: 'AppUserList',
  };
</script>

<style lang="less" scoped>
  .app-user-page {
    min-height: 100%;
    padding: 16px 20px;
    background: var(--color-fill-2);

    &__card {
      min-height: calc(100vh - 112px);
      border-radius: 4px;
    }

    &__search {
      margin-bottom: 16px;
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

    &__identity {
      min-width: 0;
    }

    &__name {
      margin-bottom: 4px;
      color: var(--color-text-1);
      font-weight: 500;
      line-height: 20px;
    }

    &__id {
      display: inline-block;
      max-width: 176px;
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

    &__mono {
      display: inline-block;
      max-width: 118px;
      overflow: hidden;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas,
        'Liberation Mono', monospace;
      white-space: nowrap;
      text-overflow: ellipsis;
      vertical-align: bottom;
    }

    &__edit-context {
      margin-bottom: 16px;
    }

    &__avatar-preview {
      display: flex;
      align-items: center;
      justify-content: space-between;
      color: var(--color-text-2);
    }
  }
</style>
