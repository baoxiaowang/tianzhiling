<template>
  <div class="agent-page">
    <a-card class="agent-page__card" :bordered="false">
      <template #title>Agent 管理</template>

      <a-form :model="searchForm" layout="inline" class="agent-page__search">
        <a-form-item field="keyword" label="关键词">
          <a-input
            v-model="searchForm.keyword"
            allow-clear
            placeholder="搜索名称、称呼、描述、用户账号或ID"
            @press-enter="handleSearch"
          />
        </a-form-item>
        <a-form-item field="sex" label="性别">
          <a-select
            v-model="searchForm.sex"
            allow-clear
            placeholder="全部"
            class="agent-page__filter"
          >
            <a-option :value="0">女性</a-option>
            <a-option :value="1">男性</a-option>
          </a-select>
        </a-form-item>
        <a-form-item field="status" label="状态">
          <a-select
            v-model="searchForm.status"
            allow-clear
            placeholder="全部"
            class="agent-page__filter"
          >
            <a-option :value="1">启用</a-option>
            <a-option :value="0">禁用</a-option>
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
        :scroll="{ x: 1700 }"
      >
        <template #empty>
          <a-empty :description="emptyDescription">
            <a-button v-if="hasSearch" type="text" @click="resetSearch">
              清空筛选
            </a-button>
          </a-empty>
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
                <div class="agent-page__identity">
                  <div class="agent-page__name">{{ record.name || '-' }}</div>
                  <a-tooltip :content="record.id">
                    <a-typography-text class="agent-page__id" copyable>
                      {{ record.id }}
                    </a-typography-text>
                  </a-tooltip>
                </div>
              </a-space>
            </template>
          </a-table-column>
          <a-table-column
            title="归属用户"
            data-index="createdUser"
            :width="260"
          >
            <template #cell="{ record }">
              <a-space v-if="record.createdUser">
                <a-avatar :size="32">
                  <img
                    v-if="isRenderableAvatar(record.createdUser.avatar)"
                    :src="record.createdUser.avatar"
                    alt="user avatar"
                  />
                  <template v-else>
                    {{ getAvatarFallback(record.createdUser.name, 'U') }}
                  </template>
                </a-avatar>
                <div class="agent-page__identity">
                  <div class="agent-page__name">
                    {{ record.createdUser.name || '-' }}
                  </div>
                  <a-tooltip
                    :content="
                      record.createdUser.account || record.createdUserId
                    "
                  >
                    <a-typography-text class="agent-page__id" copyable>
                      {{ record.createdUser.account || record.createdUserId }}
                    </a-typography-text>
                  </a-tooltip>
                </div>
              </a-space>
              <a-tooltip v-else :content="record.createdUserId">
                <a-typography-text class="agent-page__id" copyable>
                  {{ record.createdUserId }}
                </a-typography-text>
              </a-tooltip>
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
              <div class="agent-page__calls">
                <a-tooltip :content="`用户称呼TA：${record.iCallAgent || '-'}`">
                  <span class="agent-page__call-line">
                    用户称呼TA：{{ record.iCallAgent || '-' }}
                  </span>
                </a-tooltip>
                <a-tooltip
                  :content="`TA称呼用户：${record.agentCallMe || '-'}`"
                >
                  <span class="agent-page__call-line">
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
          <a-table-column title="生日" data-index="birthday" :width="150">
            <template #cell="{ record }">
              {{ formatDate(record.birthday, 'YYYY-MM-DD') }}
            </template>
          </a-table-column>
          <a-table-column title="忌日" data-index="deathDate" :width="150">
            <template #cell="{ record }">
              {{ formatDate(record.deathDate, 'YYYY-MM-DD') }}
            </template>
          </a-table-column>
          <a-table-column title="更新时间" data-index="updatedAt" :width="180">
            <template #cell="{ record }">
              {{ formatDate(record.updatedAt) }}
            </template>
          </a-table-column>
          <a-table-column title="创建时间" data-index="createdAt" :width="180">
            <template #cell="{ record }">
              {{ formatDate(record.createdAt) }}
            </template>
          </a-table-column>
          <a-table-column title="操作" :width="150" fixed="right">
            <template #cell="{ record }">
              <a-space>
                <a-button type="text" size="small" @click="openDetail(record)">
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

      <div class="agent-page__pagination">
        <span class="agent-page__total">
          共 {{ pagination.total }} 个 Agent
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
      :mask-closable="false"
      :esc-to-close="false"
      width="min(720px, calc(100vw - 32px))"
      @before-ok="submitEdit"
      @cancel="closeEdit"
    >
      <a-descriptions
        v-if="editingAgent"
        class="agent-page__edit-context"
        :column="1"
        size="small"
        bordered
      >
        <a-descriptions-item label="Agent ID">
          <a-typography-text copyable>{{ editingAgent.id }}</a-typography-text>
        </a-descriptions-item>
        <a-descriptions-item label="归属用户">
          {{ editingAgent.createdUser?.name || '-' }}
          <span v-if="editingAgent.createdUser?.account">
            / {{ editingAgent.createdUser.account }}
          </span>
          <a-tooltip :content="editingAgent.createdUserId">
            <a-typography-text class="agent-page__owner-id" copyable>
              {{ editingAgent.createdUserId }}
            </a-typography-text>
          </a-tooltip>
        </a-descriptions-item>
      </a-descriptions>

      <a-form ref="editFormRef" :model="editForm" layout="vertical">
        <div class="agent-page__form-grid">
          <div>
            <a-form-item
              field="name"
              label="名称"
              :rules="[
                { required: true, message: '请输入名称' },
                { maxLength: 30, message: '名称不能超过 30 个字符' },
              ]"
            >
              <a-input
                v-model="editForm.name"
                allow-clear
                :max-length="30"
                show-word-limit
                placeholder="请输入名称"
              />
            </a-form-item>
          </div>
          <div>
            <a-form-item
              field="sex"
              label="性别"
              :rules="[{ required: true, message: '请选择性别' }]"
            >
              <a-radio-group v-model="editForm.sex" type="button">
                <a-radio :value="0">女性</a-radio>
                <a-radio :value="1">男性</a-radio>
              </a-radio-group>
            </a-form-item>
          </div>
          <div>
            <a-form-item
              field="iCallAgent"
              label="用户称呼TA"
              :rules="[
                { required: true, message: '请输入用户称呼TA的名称' },
                { maxLength: 20, message: '称呼不能超过 20 个字符' },
              ]"
            >
              <a-input
                v-model="editForm.iCallAgent"
                allow-clear
                :max-length="20"
                show-word-limit
                placeholder="例如：小灵"
              />
            </a-form-item>
          </div>
          <div>
            <a-form-item
              field="agentCallMe"
              label="TA称呼用户"
              :rules="[
                { required: true, message: '请输入TA称呼用户的名称' },
                { maxLength: 20, message: '称呼不能超过 20 个字符' },
              ]"
            >
              <a-input
                v-model="editForm.agentCallMe"
                allow-clear
                :max-length="20"
                show-word-limit
                placeholder="例如：主人"
              />
            </a-form-item>
          </div>
          <div>
            <a-form-item field="birthday" label="生日">
              <a-date-picker
                v-model="editForm.birthday"
                allow-clear
                value-format="YYYY-MM-DD"
                placeholder="请选择生日"
                class="agent-page__date"
              />
            </a-form-item>
          </div>
          <div>
            <a-form-item field="deathDate" label="忌日">
              <a-date-picker
                v-model="editForm.deathDate"
                allow-clear
                value-format="YYYY-MM-DD"
                placeholder="请选择忌日"
                class="agent-page__date"
              />
            </a-form-item>
          </div>
        </div>

        <a-form-item field="avatar" label="头像地址">
          <a-input
            v-model="editForm.avatar"
            allow-clear
            :max-length="1000"
            placeholder="请输入头像 URL 或资源标识"
          />
        </a-form-item>
        <div class="agent-page__avatar-preview">
          <span>头像预览</span>
          <a-avatar :size="48">
            <img
              v-if="isRenderableAvatar(editForm.avatar)"
              :src="editForm.avatar"
              alt="agent avatar"
            />
            <template v-else>
              {{ getAvatarFallback(editForm.name, 'A') }}
            </template>
          </a-avatar>
        </div>
        <a-form-item
          field="description"
          label="描述"
          :rules="[{ maxLength: 1000, message: '描述不能超过 1000 个字符' }]"
        >
          <a-textarea
            v-model="editForm.description"
            allow-clear
            :max-length="1000"
            show-word-limit
            :auto-size="{ minRows: 3, maxRows: 6 }"
            placeholder="请输入描述"
          />
        </a-form-item>
        <a-form-item
          field="status"
          label="状态"
          :rules="[{ required: true, message: '请选择状态' }]"
        >
          <a-radio-group v-model="editForm.status" type="button">
            <a-radio :value="1">启用</a-radio>
            <a-radio :value="0">禁用</a-radio>
          </a-radio-group>
        </a-form-item>
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
  import { AgentRecord, queryAgentList, updateAgent } from '@/api/agent';

  const router = useRouter();
  const { loading, setLoading } = useLoading();
  const renderList = ref<AgentRecord[]>([]);
  const editVisible = ref(false);
  const saving = ref(false);
  const editingAgentId = ref('');
  const editingAgent = ref<AgentRecord>();
  const editFormRef = ref<FormInstance>();
  const searchForm = reactive<{
    keyword: string;
    sex?: number;
    status?: number;
  }>({
    keyword: '',
    sex: undefined,
    status: undefined,
  });
  const editForm = reactive({
    name: '',
    avatar: '',
    sex: 0,
    agentCallMe: '',
    iCallAgent: '',
    birthday: '',
    deathDate: '',
    description: '',
    status: 1,
  });
  const pagination = reactive({
    current: 1,
    pageSize: 20,
    total: 0,
  });

  const requestParams = computed(() => ({
    keyword: searchForm.keyword.trim() || undefined,
    sex: searchForm.sex,
    status: searchForm.status,
    page: pagination.current,
    pageSize: pagination.pageSize,
  }));
  const hasSearch = computed(
    () =>
      Boolean(searchForm.keyword.trim()) ||
      searchForm.sex !== undefined ||
      searchForm.status !== undefined
  );
  const emptyDescription = computed(() =>
    hasSearch.value ? '未找到匹配 Agent' : '暂无 Agent'
  );
  const editModalTitle = computed(() =>
    editingAgent.value
      ? `编辑 Agent：${editingAgent.value.name || editingAgent.value.id}`
      : '编辑 Agent'
  );

  const fetchData = async () => {
    try {
      setLoading(true);
      const { data } = await queryAgentList(requestParams.value);
      renderList.value = data.items;
      pagination.total = data.total;
      pagination.current = data.page;
      pagination.pageSize = data.pageSize;
    } catch (error) {
      Message.error('Agent 列表加载失败');
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
    searchForm.sex = undefined;
    searchForm.status = undefined;
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

  const openDetail = (record: AgentRecord) => {
    router.push({
      name: 'AgentDetail',
      params: {
        id: record.id,
      },
    });
  };

  const openEdit = (record: AgentRecord) => {
    editingAgent.value = record;
    editingAgentId.value = record.id;
    editForm.name = record.name;
    editForm.avatar = record.avatar;
    editForm.sex = record.sex;
    editForm.agentCallMe = record.agentCallMe;
    editForm.iCallAgent = record.iCallAgent;
    editForm.birthday = formatDateValue(record.birthday);
    editForm.deathDate = formatDateValue(record.deathDate);
    editForm.description = record.description;
    editForm.status = record.status;
    editVisible.value = true;
  };

  const closeEdit = () => {
    editVisible.value = false;
    editingAgentId.value = '';
    editingAgent.value = undefined;
    editForm.name = '';
    editForm.avatar = '';
    editForm.sex = 0;
    editForm.agentCallMe = '';
    editForm.iCallAgent = '';
    editForm.birthday = '';
    editForm.deathDate = '';
    editForm.description = '';
    editForm.status = 1;
    editFormRef.value?.clearValidate();
  };

  const submitEdit = async () => {
    const errors = await editFormRef.value?.validate();

    if (errors) {
      return false;
    }

    try {
      saving.value = true;
      await updateAgent(editingAgentId.value, {
        name: editForm.name,
        avatar: editForm.avatar,
        sex: editForm.sex,
        agentCallMe: editForm.agentCallMe,
        iCallAgent: editForm.iCallAgent,
        birthday: editForm.birthday || '',
        deathDate: editForm.deathDate || '',
        description: editForm.description,
        status: editForm.status,
      });
      Message.success('Agent 资料已更新');
      closeEdit();
      await fetchData();
      return true;
    } catch (error) {
      Message.error('Agent 资料保存失败');
      return false;
    } finally {
      saving.value = false;
    }
  };

  const formatDate = (value: string, pattern = 'YYYY-MM-DD HH:mm') => {
    return value ? dayjs(value).format(pattern) : '-';
  };

  const formatDateValue = (value: string) => {
    return value ? dayjs(value).format('YYYY-MM-DD') : '';
  };

  const formatSex = (sex: number) => {
    if (sex === 1) {
      return '男性';
    }

    if (sex === 0) {
      return '女性';
    }

    return '未知';
  };

  const formatStatus = (status: number) => {
    return status === 1 ? '启用' : '禁用';
  };

  const getAvatarFallback = (name: string, fallback: string) => {
    return name?.trim()?.slice(0, 1)?.toUpperCase() || fallback;
  };

  const isRenderableAvatar = (avatar: string) => {
    const value = avatar?.trim();

    return Boolean(value && /^(https?:)?\/\//i.test(value));
  };

  fetchData();
</script>

<script lang="ts">
  export default {
    name: 'AgentList',
  };
</script>

<style lang="less" scoped>
  .agent-page {
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

    &__filter {
      width: 120px;
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
      max-width: 176px;
      margin-bottom: 4px;
      overflow: hidden;
      color: var(--color-text-1);
      font-weight: 500;
      line-height: 20px;
      white-space: nowrap;
      text-overflow: ellipsis;
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

    &__calls {
      display: flex;
      flex-direction: column;
      gap: 4px;
      color: var(--color-text-2);
      font-size: 13px;
      line-height: 18px;
    }

    &__call-line {
      display: block;
      max-width: 190px;
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
    }

    &__edit-context {
      margin-bottom: 16px;
    }

    &__owner-id {
      display: block;
      max-width: 100%;
      margin-top: 4px;
      overflow: hidden;
      color: var(--color-text-3);
      font-size: 12px;
      white-space: nowrap;
      text-overflow: ellipsis;
    }

    &__form-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      column-gap: 16px;
    }

    &__date {
      width: 100%;
    }

    &__avatar-preview {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 16px;
      color: var(--color-text-2);
    }
  }

  @media (max-width: 720px) {
    .agent-page {
      &__pagination {
        flex-direction: column;
        gap: 12px;
        align-items: flex-start;
      }

      &__form-grid {
        grid-template-columns: 1fr;
      }
    }
  }
</style>
