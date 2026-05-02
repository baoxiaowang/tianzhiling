<template>
  <div class="app-user-detail-page">
    <a-card class="app-user-detail-page__profile-card" :bordered="false">
      <template #title>
        <a-breadcrumb class="app-user-detail-page__breadcrumb">
          <a-breadcrumb-item>
            <a-link @click="goBack">App 用户</a-link>
          </a-breadcrumb-item>
          <a-breadcrumb-item>用户详情</a-breadcrumb-item>
        </a-breadcrumb>
      </template>

      <a-spin :loading="loading">
        <div v-if="user" class="app-user-detail-page__profile">
          <a-avatar :size="72">
            <img
              v-if="isRenderableAvatar(user.avatar)"
              :src="user.avatar"
              alt="avatar"
            />
            <template v-else>
              {{ getAvatarFallback(user.name) }}
            </template>
          </a-avatar>

          <div class="app-user-detail-page__profile-main">
            <div class="app-user-detail-page__profile-heading">
              <div>
                <div class="app-user-detail-page__name">
                  {{ user.name || '-' }}
                </div>
                <a-typography-text
                  class="app-user-detail-page__user-id"
                  copyable
                >
                  {{ user.id }}
                </a-typography-text>
              </div>
              <a-tag :color="user.phoneVerified ? 'green' : 'gray'">
                {{ user.phoneVerified ? '手机已验证' : '手机未验证' }}
              </a-tag>
            </div>

            <a-descriptions
              class="app-user-detail-page__descriptions"
              :column="{ xs: 1, sm: 2, md: 3 }"
              size="small"
            >
              <a-descriptions-item label="登录账号">
                {{ user.account || '-' }}
              </a-descriptions-item>
              <a-descriptions-item label="手机号">
                {{ user.phone || '-' }}
              </a-descriptions-item>
              <a-descriptions-item label="注册时间">
                {{ formatDate(user.createdAt) }}
              </a-descriptions-item>
              <a-descriptions-item label="更新时间">
                {{ formatDate(user.updatedAt) }}
              </a-descriptions-item>
            </a-descriptions>
          </div>
        </div>

        <a-empty v-else description="暂无用户信息" />
      </a-spin>
    </a-card>

    <a-card class="app-user-detail-page__tabs-card" :bordered="false">
      <a-tabs v-model:active-key="activeTab">
        <a-tab-pane key="agents" title="用户agent">
          <a-card :bordered="false">
            <a-form
              :model="agentSearchForm"
              layout="inline"
              class="app-user-detail-page__agent-search"
            >
              <a-form-item field="keyword" label="名字">
                <a-input
                  v-model="agentSearchForm.keyword"
                  allow-clear
                  placeholder="搜索 agent 名字"
                  @press-enter="handleAgentSearch"
                />
              </a-form-item>
              <a-form-item field="agentType" label="Agent类型">
                <a-select
                  v-model="agentSearchForm.agentType"
                  class="app-user-detail-page__agent-type-filter"
                >
                  <a-option value="">全部</a-option>
                  <a-option value="normal">普通</a-option>
                  <a-option value="vip">VIP</a-option>
                </a-select>
              </a-form-item>
              <a-form-item>
                <a-space>
                  <a-button
                    type="primary"
                    :loading="agentsLoading"
                    @click="handleAgentSearch"
                  >
                    查询
                  </a-button>
                  <a-button @click="resetAgentSearch">重置</a-button>
                </a-space>
              </a-form-item>
            </a-form>

            <a-table
              row-key="id"
              :data="agentList"
              :loading="agentsLoading"
              :pagination="false"
              :bordered="false"
              :scroll="{ x: 1080 }"
            >
              <template #empty>
                <a-empty description="暂无用户agent" />
              </template>
              <template #columns>
                <a-table-column title="Agent" data-index="name" :width="260">
                  <template #cell="{ record }">
                    <a-space>
                      <a-avatar :size="40">
                        <img
                          v-if="isRenderableAvatar(record.avatar)"
                          :src="record.avatar"
                          alt="agent avatar"
                        />
                        <template v-else>
                          {{ getAvatarFallback(record.name, 'A') }}
                        </template>
                      </a-avatar>
                      <div class="app-user-detail-page__agent-identity">
                        <div class="app-user-detail-page__agent-name">
                          {{ record.name || '-' }}
                        </div>
                        <a-tooltip :content="record.id">
                          <a-typography-text
                            class="app-user-detail-page__agent-id"
                            copyable
                          >
                            {{ record.id }}
                          </a-typography-text>
                        </a-tooltip>
                      </div>
                    </a-space>
                  </template>
                </a-table-column>
                <a-table-column title="性别" data-index="sex" :width="90">
                  <template #cell="{ record }">
                    <a-tag :color="record.sex === 1 ? 'blue' : 'magenta'">
                      {{ formatSex(record.sex) }}
                    </a-tag>
                  </template>
                </a-table-column>
                <a-table-column title="类型" data-index="isVip" :width="90">
                  <template #cell="{ record }">
                    <a-tag :color="record.isVip ? 'gold' : 'gray'">
                      {{ record.isVip ? 'VIP' : '普通' }}
                    </a-tag>
                  </template>
                </a-table-column>
                <a-table-column title="称呼关系" :width="220">
                  <template #cell="{ record }">
                    <div class="app-user-detail-page__calls">
                      <a-tooltip
                        :content="`用户称呼TA：${record.iCallAgent || '-'}`"
                      >
                        <span class="app-user-detail-page__call-line">
                          用户称呼TA：{{ record.iCallAgent || '-' }}
                        </span>
                      </a-tooltip>
                      <a-tooltip
                        :content="`TA称呼用户：${record.agentCallMe || '-'}`"
                      >
                        <span class="app-user-detail-page__call-line">
                          TA称呼用户：{{ record.agentCallMe || '-' }}
                        </span>
                      </a-tooltip>
                    </div>
                  </template>
                </a-table-column>
                <a-table-column title="状态" data-index="status" :width="100">
                  <template #cell="{ record }">
                    <a-tag :color="record.status === 1 ? 'green' : 'gray'">
                      {{ formatStatus(record.status) }}
                    </a-tag>
                  </template>
                </a-table-column>
                <a-table-column title="生日" data-index="birthday" :width="140">
                  <template #cell="{ record }">
                    {{ formatDate(record.birthday, 'YYYY-MM-DD') }}
                  </template>
                </a-table-column>
                <a-table-column
                  title="更新时间"
                  data-index="updatedAt"
                  :width="180"
                >
                  <template #cell="{ record }">
                    {{ formatDate(record.updatedAt) }}
                  </template>
                </a-table-column>
              </template>
            </a-table>

            <div class="app-user-detail-page__agent-pagination">
              <span class="app-user-detail-page__agent-total">
                共 {{ agentPagination.total }} 个 Agent
              </span>
              <a-pagination
                :current="agentPagination.current"
                :page-size="agentPagination.pageSize"
                :total="agentPagination.total"
                show-page-size
                @change="onAgentPageChange"
                @page-size-change="onAgentPageSizeChange"
              />
            </div>
          </a-card>
        </a-tab-pane>
        <a-tab-pane key="orders" title="用户订单">
          <order-list-panel title="用户订单" :user-id="userId || ''" embedded />
        </a-tab-pane>
      </a-tabs>
    </a-card>
  </div>
</template>

<script lang="ts" setup>
  import { computed, reactive, ref, watch } from 'vue';
  import { useRoute, useRouter } from 'vue-router';
  import dayjs from 'dayjs';
  import { Message } from '@arco-design/web-vue';
  import useLoading from '@/hooks/loading';
  import {
    AppUserAgentRecord,
    AppUserRecord,
    queryAppUserAgents,
    queryAppUserDetail,
  } from '@/api/app-user';
  import OrderListPanel from '@/views/order/list/components/order-list-panel.vue';

  const route = useRoute();
  const router = useRouter();
  const { loading, setLoading } = useLoading();
  const user = ref<AppUserRecord | null>(null);
  const agentList = ref<AppUserAgentRecord[]>([]);
  const agentsLoading = ref(false);
  const activeTab = ref('agents');
  const agentSearchForm = reactive<{
    keyword: string;
    agentType: '' | 'normal' | 'vip';
  }>({
    keyword: '',
    agentType: '',
  });
  const agentPagination = reactive({
    current: 1,
    pageSize: 10,
    total: 0,
  });

  const userId = computed(() => {
    const { id } = route.params;
    return Array.isArray(id) ? id[0] : id;
  });

  const fetchUserDetail = async (id?: string) => {
    if (!id) {
      user.value = null;
      return;
    }

    try {
      setLoading(true);
      const { data } = await queryAppUserDetail(id);
      user.value = data;
    } catch (error) {
      user.value = null;
      Message.error('用户详情加载失败');
    } finally {
      setLoading(false);
    }
  };

  const fetchUserAgents = async (id?: string) => {
    if (!id) {
      agentList.value = [];
      agentPagination.total = 0;
      return;
    }

    try {
      agentsLoading.value = true;
      const { data } = await queryAppUserAgents(id, {
        keyword: agentSearchForm.keyword.trim() || undefined,
        agentType: agentSearchForm.agentType || undefined,
        page: agentPagination.current,
        pageSize: agentPagination.pageSize,
      });
      agentList.value = data.items;
      agentPagination.total = data.total;
      agentPagination.current = data.page;
      agentPagination.pageSize = data.pageSize;
    } catch (error) {
      agentList.value = [];
      agentPagination.total = 0;
      Message.error('用户agent加载失败');
    } finally {
      agentsLoading.value = false;
    }
  };

  const goBack = () => {
    router.push({ name: 'AppUserList' });
  };

  const onAgentPageChange = (page: number) => {
    agentPagination.current = page;
    fetchUserAgents(userId.value);
  };

  const onAgentPageSizeChange = (pageSize: number) => {
    agentPagination.pageSize = pageSize;
    agentPagination.current = 1;
    fetchUserAgents(userId.value);
  };

  const handleAgentSearch = () => {
    agentPagination.current = 1;
    fetchUserAgents(userId.value);
  };

  const resetAgentSearch = () => {
    agentSearchForm.keyword = '';
    agentSearchForm.agentType = '';
    agentPagination.current = 1;
    fetchUserAgents(userId.value);
  };

  const formatDate = (value: string, pattern = 'YYYY-MM-DD HH:mm') => {
    return value ? dayjs(value).format(pattern) : '-';
  };

  const getAvatarFallback = (name: string, fallback = 'U') => {
    return name?.trim()?.slice(0, 1)?.toUpperCase() || fallback;
  };

  const formatSex = (sex: number) => {
    return sex === 1 ? '男性' : '女性';
  };

  const formatStatus = (status: number) => {
    return status === 1 ? '启用' : '禁用';
  };

  const isRenderableAvatar = (avatar: string) => {
    const value = avatar?.trim();

    return Boolean(value && /^(https?:)?\/\//i.test(value));
  };

  watch(
    userId,
    (id) => {
      agentPagination.current = 1;
      fetchUserDetail(id);
      fetchUserAgents(id);
    },
    { immediate: true }
  );
</script>

<script lang="ts">
  export default {
    name: 'AppUserDetail',
  };
</script>

<style lang="less" scoped>
  .app-user-detail-page {
    min-height: 100%;
    padding: 16px 20px;
    background: var(--color-fill-2);

    &__profile-card,
    &__tabs-card {
      border-radius: 4px;
    }

    &__tabs-card {
      margin-top: 16px;
    }

    &__breadcrumb {
      line-height: 24px;
    }

    &__profile {
      display: flex;
      gap: 20px;
      align-items: flex-start;
    }

    &__profile-main {
      flex: 1;
      min-width: 0;
    }

    &__profile-heading {
      display: flex;
      gap: 16px;
      align-items: flex-start;
      justify-content: space-between;
      margin-bottom: 16px;
    }

    &__name {
      margin-bottom: 6px;
      color: var(--color-text-1);
      font-weight: 500;
      font-size: 20px;
      line-height: 28px;
    }

    &__user-id {
      display: inline-block;
      max-width: 360px;
      overflow: hidden;
      color: var(--color-text-3);
      font-size: 12px;
      white-space: nowrap;
      text-overflow: ellipsis;
      vertical-align: bottom;

      :deep(.arco-typography-operation-copy) {
        margin-left: 6px;
      }
    }

    &__descriptions {
      :deep(.arco-descriptions-item-label) {
        color: var(--color-text-3);
      }
    }

    &__agent-identity {
      min-width: 0;
    }

    &__agent-search {
      margin-bottom: 16px;
    }

    &__agent-type-filter {
      width: 132px;
    }

    &__agent-name {
      margin-bottom: 4px;
      color: var(--color-text-1);
      font-weight: 500;
      line-height: 20px;
    }

    &__agent-id {
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

    &__calls {
      display: flex;
      flex-direction: column;
      gap: 4px;
      min-width: 0;
    }

    &__call-line {
      max-width: 180px;
      overflow: hidden;
      color: var(--color-text-2);
      white-space: nowrap;
      text-overflow: ellipsis;
    }

    &__agent-pagination {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-top: 16px;
    }

    &__agent-total {
      color: var(--color-text-2);
      font-size: 14px;
    }
  }

  @media (max-width: 575px) {
    .app-user-detail-page {
      &__profile {
        flex-direction: column;
      }

      &__profile-heading {
        flex-direction: column;
      }

      &__agent-pagination {
        flex-direction: column;
        gap: 12px;
        align-items: flex-start;
      }
    }
  }
</style>
