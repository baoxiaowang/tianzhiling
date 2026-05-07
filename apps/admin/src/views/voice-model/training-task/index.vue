<template>
  <div class="voice-task-page">
    <a-card class="voice-task-page__card" :bordered="false">
      <template #title>声音训练任务</template>

      <a-form
        :model="searchForm"
        layout="inline"
        class="voice-task-page__search"
      >
        <a-form-item field="keyword" label="关键词">
          <a-input
            v-model="searchForm.keyword"
            allow-clear
            placeholder="搜索订单号、用户、Agent、套餐或备注"
            @press-enter="handleSearch"
          />
        </a-form-item>
        <a-form-item field="status" label="状态">
          <a-select
            v-model="searchForm.status"
            allow-clear
            placeholder="全部"
            class="voice-task-page__filter"
          >
            <a-option value="paid">已支付</a-option>
            <a-option value="awaiting_material">待补充素材</a-option>
            <a-option value="processing">处理中</a-option>
            <a-option value="training">训练中</a-option>
            <a-option value="completed">已完成</a-option>
            <a-option value="failed">失败</a-option>
            <a-option value="refunded">已退款</a-option>
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
        :scroll="{ x: 1760 }"
      >
        <template #empty>
          <a-empty :description="emptyDescription">
            <a-button v-if="hasSearch" type="text" @click="resetSearch">
              清空筛选
            </a-button>
          </a-empty>
        </template>
        <template #columns>
          <a-table-column title="订单" data-index="orderNo" :width="220">
            <template #cell="{ record }">
              <a-typography-text v-if="record.orderNo" copyable>
                {{ record.orderNo }}
              </a-typography-text>
              <a-typography-text v-else copyable>
                {{ record.orderId }}
              </a-typography-text>
            </template>
          </a-table-column>
          <a-table-column title="用户" data-index="user" :width="210">
            <template #cell="{ record }">
              <div>
                <a-link @click="goUserDetail(record.userId)">
                  {{ record.user?.name || record.user?.account || '用户ID' }}
                </a-link>
              </div>
              <div class="voice-task-page__muted">
                {{
                  record.user?.phone || record.user?.account || record.userId
                }}
              </div>
            </template>
          </a-table-column>
          <a-table-column title="Agent" data-index="agent" :width="220">
            <template #cell="{ record }">
              <div>
                <a-link @click="goAgentDetail(record.agentId)">
                  {{ record.agent?.name || 'Agent ID' }}
                </a-link>
              </div>
              <a-typography-text class="voice-task-page__mono" copyable>
                {{ record.agentId }}
              </a-typography-text>
            </template>
          </a-table-column>
          <a-table-column
            title="套餐"
            data-index="voicePackageName"
            :width="180"
          >
            <template #cell="{ record }">
              <div>{{ record.voicePackageName || '-' }}</div>
              <div class="voice-task-page__muted">
                {{ record.voicePackageCode }}
              </div>
            </template>
          </a-table-column>
          <a-table-column title="状态" data-index="status" :width="130">
            <template #cell="{ record }">
              <a-tag :color="getStatusColor(record.status)">
                {{ getStatusText(record.status) }}
              </a-tag>
            </template>
          </a-table-column>
          <a-table-column title="处理人" data-index="assigneeName" :width="120">
            <template #cell="{ record }">
              {{ record.assigneeName || '-' }}
            </template>
          </a-table-column>
          <a-table-column
            title="音色ID"
            data-index="voiceTimbreId"
            :width="220"
          >
            <template #cell="{ record }">
              <a-typography-text v-if="record.voiceTimbreId" copyable>
                {{ record.voiceTimbreId }}
              </a-typography-text>
              <span v-else>-</span>
            </template>
          </a-table-column>
          <a-table-column title="备注" data-index="remark" :width="220">
            <template #cell="{ record }">
              <a-tooltip v-if="record.remark" :content="record.remark">
                <span class="voice-task-page__ellipsis">
                  {{ record.remark }}
                </span>
              </a-tooltip>
              <span v-else>-</span>
            </template>
          </a-table-column>
          <a-table-column title="支付时间" data-index="paidAt" :width="170">
            <template #cell="{ record }">
              {{ formatDate(record.paidAt) }}
            </template>
          </a-table-column>
          <a-table-column title="更新时间" data-index="updatedAt" :width="170">
            <template #cell="{ record }">
              {{ formatDate(record.updatedAt) }}
            </template>
          </a-table-column>
          <a-table-column title="操作" :width="170" fixed="right">
            <template #cell="{ record }">
              <a-space>
                <a-button type="text" size="small" @click="openEdit(record)">
                  处理
                </a-button>
                <a-button
                  type="text"
                  size="small"
                  :disabled="record.status === 'completed'"
                  @click="openComplete(record)"
                >
                  完成
                </a-button>
              </a-space>
            </template>
          </a-table-column>
        </template>
      </a-table>

      <div class="voice-task-page__pagination">
        <span>共 {{ pagination.total }} 个训练任务</span>
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
      title="处理训练任务"
      :confirm-loading="saving"
      :mask-closable="false"
      :esc-to-close="false"
      width="min(620px, calc(100vw - 32px))"
      @before-ok="submitEdit"
      @cancel="closeEdit"
    >
      <a-form :model="editForm" layout="vertical">
        <a-form-item field="status" label="状态">
          <a-select v-model="editForm.status">
            <a-option value="paid">已支付</a-option>
            <a-option value="awaiting_material">待补充素材</a-option>
            <a-option value="processing">处理中</a-option>
            <a-option value="training">训练中</a-option>
            <a-option value="failed">失败</a-option>
            <a-option value="refunded">已退款</a-option>
          </a-select>
        </a-form-item>
        <a-form-item field="assigneeName" label="处理人">
          <a-input v-model="editForm.assigneeName" allow-clear />
        </a-form-item>
        <a-form-item field="materialObjectKeysText" label="素材 ObjectKey">
          <a-textarea
            v-model="editForm.materialObjectKeysText"
            allow-clear
            placeholder="一行一个 ObjectKey"
          />
        </a-form-item>
        <a-form-item field="remark" label="备注">
          <a-textarea v-model="editForm.remark" allow-clear />
        </a-form-item>
      </a-form>
    </a-modal>

    <a-modal
      v-model:visible="completeVisible"
      title="完成训练任务"
      :confirm-loading="saving"
      :mask-closable="false"
      :esc-to-close="false"
      width="min(560px, calc(100vw - 32px))"
      @before-ok="submitComplete"
      @cancel="closeComplete"
    >
      <a-alert
        class="voice-task-page__alert"
        type="info"
        content="完成后会把该音色绑定到任务对应的 Agent。"
      />
      <a-form ref="completeFormRef" :model="completeForm" layout="vertical">
        <a-form-item
          field="voiceTimbreId"
          label="音色ID"
          :rules="[{ required: true, message: '请输入已启用音色ID' }]"
        >
          <a-input
            v-model="completeForm.voiceTimbreId"
            allow-clear
            placeholder="请输入 active 状态的音色ID"
          />
        </a-form-item>
        <a-form-item field="remark" label="完成备注">
          <a-textarea v-model="completeForm.remark" allow-clear />
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
  import type { FormInstance } from '@arco-design/web-vue';
  import type { VoiceTrainingTaskStatusDTO } from '@tzl/shared';
  import {
    completeVoiceTrainingTask,
    queryVoiceTrainingTaskList,
    updateVoiceTrainingTask,
    VoiceTrainingTaskRecord,
  } from '@/api/voice-package';

  const router = useRouter();
  const loading = ref(false);
  const saving = ref(false);
  const editVisible = ref(false);
  const completeVisible = ref(false);
  const currentTask = ref<VoiceTrainingTaskRecord>();
  const completeFormRef = ref<FormInstance>();
  const renderList = ref<VoiceTrainingTaskRecord[]>([]);
  const searchForm = reactive<{
    keyword: string;
    status?: VoiceTrainingTaskStatusDTO;
  }>({
    keyword: '',
    status: undefined,
  });
  const pagination = reactive({
    current: 1,
    pageSize: 20,
    total: 0,
  });
  const editForm = reactive({
    status: 'processing' as Exclude<VoiceTrainingTaskStatusDTO, 'completed'>,
    assigneeName: '',
    materialObjectKeysText: '',
    remark: '',
  });
  const completeForm = reactive({
    voiceTimbreId: '',
    remark: '',
  });

  const statusMap: Record<
    VoiceTrainingTaskStatusDTO,
    { text: string; color: string }
  > = {
    paid: { text: '已支付', color: 'arcoblue' },
    awaiting_material: { text: '待补充素材', color: 'orange' },
    processing: { text: '处理中', color: 'blue' },
    training: { text: '训练中', color: 'purple' },
    completed: { text: '已完成', color: 'green' },
    failed: { text: '失败', color: 'red' },
    refunded: { text: '已退款', color: 'gray' },
  };
  const requestParams = computed(() => ({
    keyword: searchForm.keyword.trim() || undefined,
    status: searchForm.status,
    page: pagination.current,
    pageSize: pagination.pageSize,
  }));
  const hasSearch = computed(
    () => Boolean(searchForm.keyword.trim()) || Boolean(searchForm.status)
  );
  const emptyDescription = computed(() =>
    hasSearch.value ? '未找到匹配训练任务' : '暂无训练任务'
  );

  const fetchData = async () => {
    try {
      loading.value = true;
      const { data } = await queryVoiceTrainingTaskList(requestParams.value);
      renderList.value = data.items;
      pagination.total = data.total;
      pagination.current = data.page;
      pagination.pageSize = data.pageSize;
    } catch (error) {
      Message.error('训练任务加载失败');
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

  const openEdit = (record: VoiceTrainingTaskRecord) => {
    currentTask.value = record;
    editForm.status =
      record.status === 'completed' ? 'processing' : record.status;
    editForm.assigneeName = record.assigneeName;
    editForm.materialObjectKeysText = record.materialObjectKeys.join('\n');
    editForm.remark = record.remark;
    editVisible.value = true;
  };

  const closeEdit = () => {
    editVisible.value = false;
    currentTask.value = undefined;
  };

  const submitEdit = async () => {
    if (!currentTask.value) {
      return false;
    }

    try {
      saving.value = true;
      await updateVoiceTrainingTask(currentTask.value.id, {
        status: editForm.status,
        assigneeName: editForm.assigneeName.trim(),
        materialObjectKeys: editForm.materialObjectKeysText
          .split(/\r?\n/)
          .map((item) => item.trim())
          .filter(Boolean),
        remark: editForm.remark.trim(),
      });
      Message.success('训练任务已更新');
      closeEdit();
      await fetchData();
      return true;
    } catch (error) {
      Message.error('训练任务更新失败');
      return false;
    } finally {
      saving.value = false;
    }
  };

  const openComplete = (record: VoiceTrainingTaskRecord) => {
    currentTask.value = record;
    completeForm.voiceTimbreId = record.voiceTimbreId || '';
    completeForm.remark = record.remark;
    completeVisible.value = true;
  };

  const closeComplete = () => {
    completeVisible.value = false;
    currentTask.value = undefined;
    completeForm.voiceTimbreId = '';
    completeForm.remark = '';
    completeFormRef.value?.clearValidate();
  };

  const submitComplete = async () => {
    const errors = await completeFormRef.value?.validate();

    if (errors || !currentTask.value) {
      return false;
    }

    try {
      saving.value = true;
      await completeVoiceTrainingTask(currentTask.value.id, {
        voiceTimbreId: completeForm.voiceTimbreId.trim(),
        remark: completeForm.remark.trim(),
      });
      Message.success('训练任务已完成');
      closeComplete();
      await fetchData();
      return true;
    } catch (error) {
      Message.error('训练任务完成失败，请确认音色已启用');
      return false;
    } finally {
      saving.value = false;
    }
  };

  const goUserDetail = (id: string) => {
    router.push({ name: 'AppUserDetail', params: { id } });
  };

  const goAgentDetail = (id: string) => {
    router.push({ name: 'AgentDetail', params: { id } });
  };

  const getStatusText = (status: VoiceTrainingTaskStatusDTO) =>
    statusMap[status]?.text ?? status;
  const getStatusColor = (status: VoiceTrainingTaskStatusDTO) =>
    statusMap[status]?.color ?? 'gray';
  const formatDate = (value?: string) =>
    value ? dayjs(value).format('YYYY-MM-DD HH:mm') : '-';

  fetchData();
</script>

<style scoped lang="less">
  .voice-task-page {
    padding: 20px;
  }

  .voice-task-page__card {
    min-height: calc(100vh - 156px);
  }

  .voice-task-page__search {
    margin-bottom: 20px;
  }

  .voice-task-page__filter {
    width: 150px;
  }

  .voice-task-page__pagination {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 16px;
  }

  .voice-task-page__muted,
  .voice-task-page__mono {
    color: var(--color-text-3);
    font-size: 12px;
  }

  .voice-task-page__ellipsis {
    display: inline-block;
    max-width: 180px;
    overflow: hidden;
    text-overflow: ellipsis;
    vertical-align: bottom;
    white-space: nowrap;
  }

  .voice-task-page__alert {
    margin-bottom: 16px;
  }
</style>
