<template>
  <div class="app-user-detail-page">
    <a-card class="app-user-detail-page__profile-card" :bordered="false">
      <template #title>
        <a-breadcrumb class="app-user-detail-page__breadcrumb">
          <a-breadcrumb-item>
            <a-link @click="goBack">用户与关系</a-link>
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
              <a-space class="app-user-detail-page__profile-tags">
                <a-tag :color="user.phoneVerified ? 'green' : 'gray'">
                  {{ user.phoneVerified ? '手机已验证' : '手机未验证' }}
                </a-tag>
                <a-tag :color="user.isVip ? 'gold' : 'gray'">
                  {{ user.isVip ? 'VIP会员' : '普通用户' }}
                </a-tag>
                <a-tag :color="getRiskControlColor(user)">
                  {{ getRiskControlStatusText(user) }}
                </a-tag>
              </a-space>
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
              <a-descriptions-item label="人员风控">
                {{ formatRiskControlText(user) }}
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
      <a-tabs v-model:active-key="activeTab" @change="handleTabChange">
        <a-tab-pane key="agents" title="关系智能体">
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
                  placeholder="搜索智能体名字"
                  @press-enter="handleAgentSearch"
                />
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
                <a-empty description="暂无关系智能体" />
              </template>
              <template #columns>
                <a-table-column title="智能体" data-index="name" :width="260">
                  <template #cell="{ record }">
                    <a-space>
                      <a-avatar
                        :size="40"
                        class="app-user-detail-page__agent-avatar"
                        @click="goAgentDetail(record.id)"
                      >
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
                          <a-link @click="goAgentDetail(record.id)">
                            {{ record.name || '-' }}
                          </a-link>
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
                <a-table-column
                  title="聊天次数"
                  data-index="conversationCount"
                  :width="110"
                >
                  <template #cell="{ record }">
                    <a-link @click="goAgentDetail(record.id)">
                      {{ record.conversationCount ?? 0 }}
                    </a-link>
                  </template>
                </a-table-column>
                <a-table-column title="状态" data-index="status" :width="100">
                  <template #cell="{ record }">
                    <a-tag :color="record.status === 1 ? 'green' : 'gray'">
                      {{ formatStatus(record.status) }}
                    </a-tag>
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
                共 {{ agentPagination.total }} 个智能体
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
        <a-tab-pane key="memory" title="账号级记忆">
          <a-spin :loading="accountMemoryLoading">
            <div class="app-user-detail-page__memory-layout">
              <a-card title="用户身份记忆" :bordered="false">
                <a-descriptions
                  v-if="accountMemory?.identity"
                  :column="{ xs: 1, md: 2 }"
                  bordered
                  size="small"
                >
                  <a-descriptions-item label="真实姓名">
                    {{ accountMemory.identity.realName || '-' }}
                  </a-descriptions-item>
                  <a-descriptions-item label="别名">
                    {{ accountMemory.identity.aliases.join('、') || '-' }}
                  </a-descriptions-item>
                  <a-descriptions-item label="曾用名">
                    {{ accountMemory.identity.formerNames.join('、') || '-' }}
                  </a-descriptions-item>
                  <a-descriptions-item label="更新时间">
                    {{ formatDate(accountMemory.identity.updatedAt) }}
                  </a-descriptions-item>
                  <a-descriptions-item label="记忆来源" :span="2">
                    {{ accountMemory.identity.sourceText || '-' }}
                  </a-descriptions-item>
                </a-descriptions>
                <a-empty v-else description="暂无用户身份记忆" />
              </a-card>

              <a-card
                :title="`已识别人物（${accountMemory?.people.length ?? 0}）`"
                :bordered="false"
              >
                <a-collapse v-if="accountMemory?.people.length">
                  <a-collapse-item
                    v-for="person in accountMemory.people"
                    :key="person.id"
                    :header="formatMemoryPersonTitle(person)"
                  >
                    <a-space wrap class="app-user-detail-page__memory-tags">
                      <a-tag v-if="person.relationToUser" color="arcoblue">
                        {{ person.relationToUser }}
                      </a-tag>
                      <a-tag v-for="alias in person.aliases" :key="alias">
                        {{ alias }}
                      </a-tag>
                    </a-space>
                    <a-descriptions
                      :column="{ xs: 1, md: 3 }"
                      size="small"
                      class="app-user-detail-page__memory-person"
                    >
                      <a-descriptions-item label="人物ID">
                        <a-typography-text copyable>
                          {{ person.id }}
                        </a-typography-text>
                      </a-descriptions-item>
                      <a-descriptions-item label="生命阶段">
                        {{ formatLifeStage(person.profile?.lifeStage) }}
                      </a-descriptions-item>
                      <a-descriptions-item label="更新时间">
                        {{ formatDate(person.updatedAt) }}
                      </a-descriptions-item>
                      <a-descriptions-item label="识别来源" :span="3">
                        {{ person.sourceText || '-' }}
                      </a-descriptions-item>
                    </a-descriptions>
                    <a-table
                      :data="person.facts"
                      :pagination="false"
                      size="small"
                      :bordered="false"
                    >
                      <template #empty>
                        <a-empty description="暂无人物事实" />
                      </template>
                      <template #columns>
                        <a-table-column title="领域" :width="110">
                          <template #cell="{ record }">
                            {{ formatMemoryDomain(record.domain) }}
                          </template>
                        </a-table-column>
                        <a-table-column title="记忆内容" data-index="value" />
                        <a-table-column title="状态" :width="100">
                          <template #cell="{ record }">
                            {{ formatMemoryStatus(record.status) }}
                          </template>
                        </a-table-column>
                        <a-table-column title="更新时间" :width="170">
                          <template #cell="{ record }">
                            {{ formatDate(record.updatedAt) }}
                          </template>
                        </a-table-column>
                      </template>
                    </a-table>
                  </a-collapse-item>
                </a-collapse>
                <a-empty v-else description="暂无账号级人物记忆" />
              </a-card>
            </div>
          </a-spin>
        </a-tab-pane>
        <a-tab-pane key="posts" title="用户动态">
          <post-list-panel
            v-if="activeTab === 'posts'"
            title="用户动态"
            :user-id="userId || ''"
            embedded
          />
        </a-tab-pane>
        <a-tab-pane key="orders" title="用户订单">
          <order-list-panel
            v-if="activeTab === 'orders'"
            title="用户订单"
            :user-id="userId || ''"
            embedded
          />
        </a-tab-pane>
        <a-tab-pane key="voice" title="声音模型">
          <voice-model-panel
            v-if="activeTab === 'voice'"
            :user-id="userId || ''"
            :user-name="user?.name || ''"
            :appellation="agentList[0]?.iCallAgent || '妈妈'"
            embedded
          />
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
    AppUserAccountMemory,
    AppUserAgentRecord,
    AppUserRecord,
    queryAppUserAccountMemory,
    queryAppUserAgents,
    queryAppUserDetail,
  } from '@/api/app-user';
  import OrderListPanel from '@/views/order/list/components/order-list-panel.vue';
  import PostListPanel from '@/views/post/components/post-list-panel.vue';
  import VoiceModelPanel from './voice-model-panel.vue';

  const route = useRoute();
  const router = useRouter();
  const { loading, setLoading } = useLoading();
  const user = ref<AppUserRecord | null>(null);
  const agentList = ref<AppUserAgentRecord[]>([]);
  const agentsLoading = ref(false);
  const accountMemory = ref<AppUserAccountMemory | null>(null);
  const accountMemoryLoading = ref(false);
  const accountMemoryLoadedUserId = ref('');
  const activeTab = ref('agents');
  const agentSearchForm = reactive<{
    keyword: string;
  }>({
    keyword: '',
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
      Message.error('用户智能体加载失败');
    } finally {
      agentsLoading.value = false;
    }
  };

  const fetchAccountMemory = async (id?: string) => {
    if (!id || accountMemoryLoadedUserId.value === id) {
      return;
    }

    try {
      accountMemoryLoading.value = true;
      const { data } = await queryAppUserAccountMemory(id);
      accountMemory.value = data;
      accountMemoryLoadedUserId.value = id;
    } catch (error) {
      accountMemory.value = null;
      Message.error('账号级记忆加载失败');
    } finally {
      accountMemoryLoading.value = false;
    }
  };

  const handleTabChange = (key: string | number) => {
    if (key === 'memory') {
      fetchAccountMemory(userId.value);
    }
  };

  const goBack = () => {
    router.push({ name: 'AppUserList' });
  };

  const goAgentDetail = (agentId: string) => {
    if (!agentId) {
      return;
    }

    router.push({ name: 'AgentDetail', params: { id: agentId } });
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

  const formatMemoryPersonTitle = (
    person: AppUserAccountMemory['people'][number]
  ) => {
    const name = person.preferredName || person.realName || '未命名人物';
    return person.relationToUser ? `${name} · ${person.relationToUser}` : name;
  };

  const formatLifeStage = (value?: string) => {
    const labels: Record<string, string> = {
      newborn: '新生儿',
      infant: '婴儿',
      toddler: '幼儿',
      preschool: '学龄前',
      school_age: '学龄期',
      adolescent: '青少年',
      adult: '成年人',
      older_adult: '老年人',
      unknown: '未知',
    };
    return labels[value || 'unknown'] || value || '未知';
  };

  const formatMemoryDomain = (value: string) => {
    const labels: Record<string, string> = {
      health: '健康',
      growth: '成长',
      education: '教育',
      work: '工作',
      care: '照护',
      relationship: '关系',
      life_event: '人生事件',
      preference: '偏好',
      routine: '日常',
      other: '其他',
    };
    return labels[value] || value || '-';
  };

  const formatMemoryStatus = (value: string) => {
    const labels: Record<string, string> = {
      current: '当前',
      resolved: '已解决',
      historical: '历史',
      uncertain: '待确认',
    };
    return labels[value] || value || '-';
  };

  const getRiskControlStatusText = (record: AppUserRecord) => {
    if (record.isRiskControlled) {
      return '风控中';
    }

    return record.riskControlUntilAt ? '风控已过期' : '未风控';
  };

  const getRiskControlColor = (record: AppUserRecord) => {
    if (record.isRiskControlled) {
      return 'red';
    }

    return record.riskControlUntilAt ? 'orange' : 'green';
  };

  const formatRiskControlText = (record: AppUserRecord) => {
    if (!record.riskControlUntilAt) {
      return '未风控';
    }

    return `${getRiskControlStatusText(record)}，截止时间：${formatDate(
      record.riskControlUntilAt
    )}`;
  };

  const isRenderableAvatar = (avatar: string) => {
    const value = avatar?.trim();

    return Boolean(value && /^(https?:)?\/\//i.test(value));
  };

  watch(
    userId,
    (id) => {
      agentPagination.current = 1;
      accountMemory.value = null;
      accountMemoryLoadedUserId.value = '';
      fetchUserDetail(id);
      fetchUserAgents(id);
      if (activeTab.value === 'memory') {
        fetchAccountMemory(id);
      }
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

    &__profile-tags {
      flex-shrink: 0;
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

    &__memory-layout {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    &__memory-tags {
      margin-bottom: 12px;
    }

    &__memory-person {
      margin-bottom: 12px;
    }

    &__agent-avatar {
      cursor: pointer;
      transition: opacity 0.2s ease;

      &:hover {
        opacity: 0.82;
      }
    }

    &__agent-name {
      margin-bottom: 4px;
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
