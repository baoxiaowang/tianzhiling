<template>
  <div class="voice-package-page">
    <a-card class="voice-package-page__card" :bordered="false">
      <template #title>声音套餐</template>
      <template #extra>
        <a-button type="primary" @click="openCreate">
          <template #icon>
            <icon-plus />
          </template>
          新建套餐
        </a-button>
      </template>

      <a-form
        :model="searchForm"
        layout="inline"
        class="voice-package-page__search"
      >
        <a-form-item field="keyword" label="关键词">
          <a-input
            v-model="searchForm.keyword"
            allow-clear
            placeholder="搜索套餐名称、编码或说明"
            @press-enter="handleSearch"
          />
        </a-form-item>
        <a-form-item field="status" label="状态">
          <a-select
            v-model="searchForm.status"
            allow-clear
            placeholder="全部"
            class="voice-package-page__filter"
          >
            <a-option value="active">启用</a-option>
            <a-option value="disabled">停用</a-option>
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
        :scroll="{ x: 1320 }"
      >
        <template #empty>
          <a-empty :description="emptyDescription">
            <a-button v-if="hasSearch" type="text" @click="resetSearch">
              清空筛选
            </a-button>
          </a-empty>
        </template>
        <template #columns>
          <a-table-column title="套餐名称" data-index="name" :width="180" />
          <a-table-column title="套餐编码" data-index="code" :width="180">
            <template #cell="{ record }">
              <a-typography-text copyable>{{ record.code }}</a-typography-text>
            </template>
          </a-table-column>
          <a-table-column title="价格" data-index="priceAmount" :width="120">
            <template #cell="{ record }">
              {{ formatMoney(record.priceAmount) }}
            </template>
          </a-table-column>
          <a-table-column title="划线价" :width="120">
            <template #cell="{ record }">
              {{ formatMoney(record.originalPriceAmount) }}
            </template>
          </a-table-column>
          <a-table-column title="预计交付" :width="120">
            <template #cell="{ record }">
              {{
                record.estimatedServiceDays
                  ? `${record.estimatedServiceDays} 天`
                  : '-'
              }}
            </template>
          </a-table-column>
          <a-table-column title="交付内容" :width="260">
            <template #cell="{ record }">
              <a-space wrap>
                <a-tag v-for="item in record.deliverables" :key="item.title">
                  {{ item.title }}
                </a-tag>
                <span v-if="record.deliverables.length === 0">-</span>
              </a-space>
            </template>
          </a-table-column>
          <a-table-column title="状态" data-index="status" :width="100">
            <template #cell="{ record }">
              <a-tag :color="record.status === 'active' ? 'green' : 'gray'">
                {{ formatStatus(record.status) }}
              </a-tag>
            </template>
          </a-table-column>
          <a-table-column title="排序" data-index="sort" :width="90" />
          <a-table-column title="更新时间" data-index="updatedAt" :width="170">
            <template #cell="{ record }">
              {{ formatDate(record.updatedAt) }}
            </template>
          </a-table-column>
          <a-table-column title="操作" :width="110" fixed="right">
            <template #cell="{ record }">
              <a-button type="text" size="small" @click="openEdit(record)">
                编辑
              </a-button>
            </template>
          </a-table-column>
        </template>
      </a-table>

      <div class="voice-package-page__pagination">
        <span>共 {{ pagination.total }} 个声音套餐</span>
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
      width="min(780px, calc(100vw - 32px))"
      @before-ok="submitEdit"
      @cancel="closeEdit"
    >
      <a-form ref="editFormRef" :model="editForm" layout="vertical">
        <a-grid :cols="2" :col-gap="16" :row-gap="0">
          <a-grid-item>
            <a-form-item
              field="name"
              label="套餐名称"
              :rules="[{ required: true, message: '请输入套餐名称' }]"
            >
              <a-input
                v-model="editForm.name"
                allow-clear
                placeholder="例如：基础声音训练"
              />
            </a-form-item>
          </a-grid-item>
          <a-grid-item>
            <a-form-item
              field="code"
              label="套餐编码"
              :rules="[{ required: true, message: '请输入套餐编码' }]"
            >
              <a-input
                v-model="editForm.code"
                allow-clear
                placeholder="例如：voice_basic"
              />
            </a-form-item>
          </a-grid-item>
          <a-grid-item>
            <a-form-item
              field="priceYuan"
              label="价格（元）"
              :rules="[{ required: true, message: '请输入价格' }]"
            >
              <a-input-number
                v-model="editForm.priceYuan"
                :min="0"
                :precision="2"
                class="voice-package-page__full"
              />
            </a-form-item>
          </a-grid-item>
          <a-grid-item>
            <a-form-item field="originalPriceYuan" label="划线价（元）">
              <a-input-number
                v-model="editForm.originalPriceYuan"
                :min="0"
                :precision="2"
                placeholder="可选"
                class="voice-package-page__full"
              />
            </a-form-item>
          </a-grid-item>
          <a-grid-item>
            <a-form-item field="estimatedServiceDays" label="预计交付（天）">
              <a-input-number
                v-model="editForm.estimatedServiceDays"
                :min="1"
                :precision="0"
                placeholder="可选"
                class="voice-package-page__full"
              />
            </a-form-item>
          </a-grid-item>
          <a-grid-item>
            <a-form-item field="sort" label="排序">
              <a-input-number
                v-model="editForm.sort"
                :min="0"
                :precision="0"
                class="voice-package-page__full"
              />
            </a-form-item>
          </a-grid-item>
          <a-grid-item>
            <a-form-item field="status" label="状态">
              <a-radio-group v-model="editForm.status" type="button">
                <a-radio value="active">启用</a-radio>
                <a-radio value="disabled">停用</a-radio>
              </a-radio-group>
            </a-form-item>
          </a-grid-item>
        </a-grid>

        <a-form-item field="description" label="套餐描述">
          <a-textarea
            v-model="editForm.description"
            allow-clear
            placeholder="用于 C 端展示"
          />
        </a-form-item>
        <a-form-item field="materialRequirement" label="素材要求">
          <a-textarea
            v-model="editForm.materialRequirement"
            allow-clear
            placeholder="例如：建议提供 3 分钟以上清晰语音素材"
          />
        </a-form-item>
        <a-form-item label="交付内容">
          <div class="voice-package-page__deliverables">
            <div
              v-for="(item, index) in editForm.deliverables"
              :key="item.id"
              class="voice-package-page__deliverable-row"
            >
              <a-input
                v-model="item.title"
                allow-clear
                :placeholder="`交付内容 ${index + 1}`"
              />
              <a-button
                status="danger"
                type="text"
                :disabled="editForm.deliverables.length <= 1"
                @click="removeDeliverable(index)"
              >
                删除
              </a-button>
            </div>
            <a-button type="outline" size="small" @click="addDeliverable">
              <template #icon>
                <icon-plus />
              </template>
              添加交付内容
            </a-button>
          </div>
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<script lang="ts" setup>
  import { computed, onMounted, reactive, ref } from 'vue';
  import dayjs from 'dayjs';
  import { Message } from '@arco-design/web-vue';
  import type { FormInstance } from '@arco-design/web-vue';
  import {
    createVoicePackage,
    queryVoicePackageList,
    updateVoicePackage,
    VoicePackageRecord,
  } from '@/api/voice-package';

  type VoicePackageStatus = 'active' | 'disabled';

  interface DeliverableForm {
    id: number;
    title: string;
  }

  interface VoicePackageEditForm {
    code: string;
    name: string;
    description: string;
    priceYuan: number;
    originalPriceYuan?: number;
    estimatedServiceDays?: number;
    materialRequirement: string;
    status: VoicePackageStatus;
    sort: number;
    deliverables: DeliverableForm[];
  }

  const loading = ref(false);
  const saving = ref(false);
  const editVisible = ref(false);
  const editingRecord = ref<VoicePackageRecord>();
  const editFormRef = ref<FormInstance>();
  const renderList = ref<VoicePackageRecord[]>([]);
  let deliverableSeed = 0;
  const searchForm = reactive<{
    keyword: string;
    status?: VoicePackageStatus;
  }>({
    keyword: '',
    status: undefined,
  });
  const pagination = reactive({
    current: 1,
    pageSize: 20,
    total: 0,
  });
  const editForm = reactive<VoicePackageEditForm>({
    code: '',
    name: '',
    description: '',
    priceYuan: 0,
    originalPriceYuan: undefined,
    estimatedServiceDays: undefined,
    materialRequirement: '',
    status: 'active',
    sort: 0,
    deliverables: [],
  });

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
    hasSearch.value ? '未找到匹配声音套餐' : '暂无声音套餐'
  );
  const editModalTitle = computed(() =>
    editingRecord.value
      ? `编辑声音套餐：${editingRecord.value.name}`
      : '新建声音套餐'
  );

  const fetchData = async () => {
    try {
      loading.value = true;
      const { data } = await queryVoicePackageList(requestParams.value);
      renderList.value = data.items;
      pagination.total = data.total;
      pagination.current = data.page;
      pagination.pageSize = data.pageSize;
    } catch (error) {
      Message.error('声音套餐加载失败');
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

  const openCreate = () => {
    editingRecord.value = undefined;
    resetEditForm();
    editVisible.value = true;
  };

  const openEdit = (record: VoicePackageRecord) => {
    editingRecord.value = record;
    editForm.code = record.code;
    editForm.name = record.name;
    editForm.description = record.description;
    editForm.priceYuan = amountToYuan(record.priceAmount);
    editForm.originalPriceYuan = optionalAmountToYuan(
      record.originalPriceAmount
    );
    editForm.estimatedServiceDays = record.estimatedServiceDays;
    editForm.materialRequirement = record.materialRequirement;
    editForm.status = record.status;
    editForm.sort = record.sort;
    editForm.deliverables =
      record.deliverables.length > 0
        ? record.deliverables.map((item) => createDeliverable(item.title))
        : [createDeliverable()];
    editVisible.value = true;
  };

  const closeEdit = () => {
    editVisible.value = false;
    editingRecord.value = undefined;
    resetEditForm();
    editFormRef.value?.clearValidate();
  };

  const submitEdit = async () => {
    const errors = await editFormRef.value?.validate();

    if (errors) {
      return false;
    }

    try {
      saving.value = true;
      const payload = buildSavePayload();

      if (editingRecord.value) {
        await updateVoicePackage(editingRecord.value.id, payload);
        Message.success('声音套餐已更新');
      } else {
        await createVoicePackage(payload);
        Message.success('声音套餐已创建');
      }

      closeEdit();
      await fetchData();
      return true;
    } catch (error) {
      Message.error('声音套餐保存失败');
      return false;
    } finally {
      saving.value = false;
    }
  };

  const resetEditForm = () => {
    editForm.code = '';
    editForm.name = '';
    editForm.description = '';
    editForm.priceYuan = 0;
    editForm.originalPriceYuan = undefined;
    editForm.estimatedServiceDays = undefined;
    editForm.materialRequirement = '';
    editForm.status = 'active';
    editForm.sort = 0;
    editForm.deliverables = [createDeliverable()];
  };

  const createDeliverable = (title = ''): DeliverableForm => {
    const id = deliverableSeed;
    deliverableSeed += 1;
    return { id, title };
  };

  const addDeliverable = () => {
    editForm.deliverables.push(createDeliverable());
  };

  const removeDeliverable = (index: number) => {
    if (editForm.deliverables.length <= 1) {
      return;
    }
    editForm.deliverables.splice(index, 1);
  };

  const buildSavePayload = () => ({
    code: editForm.code.trim(),
    name: editForm.name.trim(),
    description: editForm.description.trim(),
    priceAmount: yuanToAmount(editForm.priceYuan),
    originalPriceAmount: yuanToOptionalAmount(editForm.originalPriceYuan),
    currency: 'CNY',
    estimatedServiceDays: editForm.estimatedServiceDays,
    materialRequirement: editForm.materialRequirement.trim(),
    status: editForm.status,
    sort: editForm.sort,
    deliverables: editForm.deliverables
      .map((item) => item.title.trim())
      .filter(Boolean)
      .map((title) => ({ title })),
  });

  const yuanToAmount = (value?: number) => Math.round(Number(value || 0) * 100);
  const amountToYuan = (value?: number) => Number(value || 0) / 100;
  const yuanToOptionalAmount = (value?: number) =>
    value === undefined || value === null ? undefined : yuanToAmount(value);
  const optionalAmountToYuan = (value?: number) =>
    value === undefined || value === null ? undefined : amountToYuan(value);
  const formatMoney = (value?: number) =>
    value === undefined || value === null
      ? '-'
      : `￥${amountToYuan(value).toFixed(2)}`;
  const formatStatus = (status: VoicePackageStatus) =>
    status === 'active' ? '启用' : '停用';
  const formatDate = (value: string) =>
    value ? dayjs(value).format('YYYY-MM-DD HH:mm') : '-';

  onMounted(() => {
    fetchData();
  });
</script>

<style scoped lang="less">
  .voice-package-page {
    padding: 20px;
  }

  .voice-package-page__card {
    min-height: calc(100vh - 156px);
  }

  .voice-package-page__search {
    margin-bottom: 20px;
  }

  .voice-package-page__filter {
    width: 140px;
  }

  .voice-package-page__pagination {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 16px;
  }

  .voice-package-page__full {
    width: 100%;
  }

  .voice-package-page__deliverables {
    display: flex;
    flex-direction: column;
    gap: 10px;
    width: 100%;
  }

  .voice-package-page__deliverable-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 8px;
  }
</style>
