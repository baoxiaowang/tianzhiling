<template>
  <div class="membership-page">
    <a-card class="membership-page__card" :bordered="false">
      <template #title>VIP计划</template>
      <template #extra>
        <a-button type="primary" @click="openCreate">
          <template #icon>
            <icon-plus />
          </template>
          新建计划
        </a-button>
      </template>

      <a-form
        :model="searchForm"
        layout="inline"
        class="membership-page__search"
      >
        <a-form-item field="keyword" label="关键词">
          <a-input
            v-model="searchForm.keyword"
            allow-clear
            placeholder="搜索计划名称、编码或描述"
            @press-enter="handleSearch"
          />
        </a-form-item>
        <a-form-item field="status" label="状态">
          <a-select
            v-model="searchForm.status"
            allow-clear
            placeholder="全部"
            class="membership-page__filter"
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
        :scroll="{ x: 1280 }"
      >
        <template #empty>
          <a-empty :description="emptyDescription">
            <a-button v-if="hasSearch" type="text" @click="resetSearch">
              清空筛选
            </a-button>
          </a-empty>
        </template>
        <template #columns>
          <a-table-column title="计划名称" data-index="name" :width="180" />
          <a-table-column title="计划编码" data-index="code" :width="180">
            <template #cell="{ record }">
              <a-typography-text copyable>{{ record.code }}</a-typography-text>
            </template>
          </a-table-column>
          <a-table-column title="价格" data-index="priceAmount" :width="120">
            <template #cell="{ record }">
              {{ formatMoney(record.priceAmount) }}
            </template>
          </a-table-column>
          <a-table-column
            title="划线价"
            data-index="originalPriceAmount"
            :width="120"
          >
            <template #cell="{ record }">
              {{ formatMoney(record.originalPriceAmount) }}
            </template>
          </a-table-column>
          <a-table-column title="有效期" :width="120">
            <template #cell="{ record }">
              {{ formatDuration(record) }}
            </template>
          </a-table-column>
          <a-table-column
            title="赠券"
            data-index="couponGrantAmount"
            :width="120"
          >
            <template #cell="{ record }">
              {{ formatMoney(record.couponGrantAmount) }}
            </template>
          </a-table-column>
          <a-table-column title="权益" :width="260">
            <template #cell="{ record }">
              <a-space wrap>
                <a-tag v-for="benefit in record.benefits" :key="benefit.title">
                  {{ benefit.title }}
                </a-tag>
                <span v-if="record.benefits.length === 0">-</span>
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
          <a-table-column title="更新时间" data-index="updatedAt" :width="180">
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

      <div class="membership-page__pagination">
        <span class="membership-page__total">
          共 {{ pagination.total }} 个 VIP 计划
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
      width="min(760px, calc(100vw - 32px))"
      @before-ok="submitEdit"
      @cancel="closeEdit"
    >
      <a-form ref="editFormRef" :model="editForm" layout="vertical">
        <a-grid :cols="2" :col-gap="16" :row-gap="0">
          <a-grid-item>
            <a-form-item
              field="name"
              label="计划名称"
              :rules="[{ required: true, message: '请输入计划名称' }]"
            >
              <a-input
                v-model="editForm.name"
                allow-clear
                placeholder="例如：一年会员"
              />
            </a-form-item>
          </a-grid-item>
          <a-grid-item>
            <a-form-item
              field="code"
              label="计划编码"
              :rules="[{ required: true, message: '请输入计划编码' }]"
            >
              <a-input
                v-model="editForm.code"
                allow-clear
                placeholder="例如：vip_year"
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
                placeholder="0.00"
                class="membership-page__full"
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
                class="membership-page__full"
              />
            </a-form-item>
          </a-grid-item>
          <a-grid-item>
            <a-form-item field="lifetime" label="是否永久">
              <a-switch v-model="editForm.lifetime" />
            </a-form-item>
          </a-grid-item>
          <a-grid-item>
            <a-form-item
              field="durationDays"
              label="有效期（天）"
              :rules="durationRules"
            >
              <a-input-number
                v-model="editForm.durationDays"
                :disabled="editForm.lifetime"
                :min="1"
                :precision="0"
                placeholder="例如：365"
                class="membership-page__full"
              />
            </a-form-item>
          </a-grid-item>
          <a-grid-item>
            <a-form-item field="couponGrantYuan" label="赠送现金券（元）">
              <a-input-number
                v-model="editForm.couponGrantYuan"
                :min="0"
                :precision="2"
                placeholder="可选"
                class="membership-page__full"
              />
            </a-form-item>
          </a-grid-item>
          <a-grid-item>
            <a-form-item field="sort" label="排序">
              <a-input-number
                v-model="editForm.sort"
                :min="0"
                :precision="0"
                class="membership-page__full"
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

        <a-form-item field="description" label="描述">
          <a-textarea
            v-model="editForm.description"
            allow-clear
            placeholder="用于后台备注或前端展示"
          />
        </a-form-item>
        <a-form-item label="会员权益">
          <div class="membership-page__benefits">
            <div
              v-for="(benefit, index) in editForm.benefits"
              :key="benefit.id"
              class="membership-page__benefit-row"
            >
              <a-input
                v-model="benefit.title"
                allow-clear
                :placeholder="`权益 ${
                  index + 1
                }，例如：聊天、动态等服务不限量使用`"
              />
              <a-button
                status="danger"
                type="text"
                :disabled="editForm.benefits.length <= 1"
                @click="removeBenefit(index)"
              >
                删除
              </a-button>
            </div>
            <a-button type="outline" size="small" @click="addBenefit">
              <template #icon>
                <icon-plus />
              </template>
              添加权益
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
  import type { FieldRule, FormInstance } from '@arco-design/web-vue';
  import {
    createVipPlan,
    queryVipPlanList,
    updateVipPlan,
    VipPlanRecord,
  } from '@/api/membership';

  type VipPlanStatus = 'active' | 'disabled';

  interface VipPlanEditForm {
    code: string;
    name: string;
    description: string;
    priceYuan: number;
    originalPriceYuan?: number;
    lifetime: boolean;
    durationDays?: number;
    couponGrantYuan?: number;
    status: VipPlanStatus;
    sort: number;
    benefits: VipPlanBenefitForm[];
  }

  interface VipPlanBenefitForm {
    id: number;
    title: string;
  }

  const loading = ref(false);
  const saving = ref(false);
  const editVisible = ref(false);
  const editingPlan = ref<VipPlanRecord>();
  const editFormRef = ref<FormInstance>();
  const renderList = ref<VipPlanRecord[]>([]);
  let benefitIdSeed = 0;
  const searchForm = reactive<{
    keyword: string;
    status?: VipPlanStatus;
  }>({
    keyword: '',
    status: undefined,
  });
  const editForm = reactive<VipPlanEditForm>({
    code: '',
    name: '',
    description: '',
    priceYuan: 0,
    originalPriceYuan: undefined,
    lifetime: false,
    durationDays: 365,
    couponGrantYuan: undefined,
    status: 'active',
    sort: 0,
    benefits: [],
  });
  const pagination = reactive({
    current: 1,
    pageSize: 20,
    total: 0,
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
    hasSearch.value ? '未找到匹配 VIP 计划' : '暂无 VIP 计划'
  );
  const editModalTitle = computed(() =>
    editingPlan.value
      ? `编辑 VIP 计划：${editingPlan.value.name}`
      : '新建 VIP 计划'
  );
  const durationRules = computed<FieldRule[]>(() =>
    editForm.lifetime
      ? []
      : [{ required: true, message: '请输入非永久会员的有效期' }]
  );

  const fetchData = async () => {
    try {
      loading.value = true;
      const { data } = await queryVipPlanList(requestParams.value);
      renderList.value = data.items;
      pagination.total = data.total;
      pagination.current = data.page;
      pagination.pageSize = data.pageSize;
    } catch (error) {
      Message.error('VIP计划加载失败');
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
    editingPlan.value = undefined;
    resetEditForm();
    editVisible.value = true;
  };

  const openEdit = (record: VipPlanRecord) => {
    editingPlan.value = record;
    editForm.code = record.code;
    editForm.name = record.name;
    editForm.description = record.description;
    editForm.priceYuan = amountToYuan(record.priceAmount);
    editForm.originalPriceYuan = optionalAmountToYuan(
      record.originalPriceAmount
    );
    editForm.lifetime = record.lifetime;
    editForm.durationDays = record.durationDays;
    editForm.couponGrantYuan = optionalAmountToYuan(record.couponGrantAmount);
    editForm.status = record.status;
    editForm.sort = record.sort;
    editForm.benefits =
      record.benefits.length > 0
        ? record.benefits.map((benefit) => createBenefitRow(benefit.title))
        : [createBenefitRow()];
    editVisible.value = true;
  };

  const closeEdit = () => {
    editVisible.value = false;
    editingPlan.value = undefined;
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

      if (editingPlan.value) {
        await updateVipPlan(editingPlan.value.id, payload);
        Message.success('VIP计划已更新');
      } else {
        await createVipPlan(payload);
        Message.success('VIP计划已创建');
      }

      closeEdit();
      await fetchData();
      return true;
    } catch (error) {
      Message.error('VIP计划保存失败');
      return false;
    } finally {
      saving.value = false;
    }
  };

  const buildSavePayload = () => ({
    code: editForm.code.trim(),
    name: editForm.name.trim(),
    description: editForm.description.trim(),
    priceAmount: yuanToAmount(editForm.priceYuan),
    originalPriceAmount: yuanToOptionalAmount(editForm.originalPriceYuan),
    currency: 'CNY',
    lifetime: editForm.lifetime,
    durationDays: editForm.lifetime ? undefined : editForm.durationDays,
    couponGrantAmount: yuanToOptionalAmount(editForm.couponGrantYuan),
    status: editForm.status,
    sort: editForm.sort,
    benefits: buildBenefitsPayload(),
  });

  const resetEditForm = () => {
    editForm.code = '';
    editForm.name = '';
    editForm.description = '';
    editForm.priceYuan = 0;
    editForm.originalPriceYuan = undefined;
    editForm.lifetime = false;
    editForm.durationDays = 365;
    editForm.couponGrantYuan = undefined;
    editForm.status = 'active';
    editForm.sort = 0;
    editForm.benefits = [createBenefitRow()];
  };

  const createBenefitRow = (title = ''): VipPlanBenefitForm => {
    const id = benefitIdSeed;
    benefitIdSeed += 1;

    return {
      id,
      title,
    };
  };

  const addBenefit = () => {
    editForm.benefits.push(createBenefitRow());
  };

  const removeBenefit = (index: number) => {
    if (editForm.benefits.length <= 1) {
      return;
    }

    editForm.benefits.splice(index, 1);
  };

  const buildBenefitsPayload = () =>
    editForm.benefits
      .map((benefit) => benefit.title.trim())
      .filter(Boolean)
      .map((title) => ({ title }));

  const yuanToAmount = (value?: number) => Math.round(Number(value || 0) * 100);

  const yuanToOptionalAmount = (value?: number) => {
    if (value === undefined || value === null) {
      return undefined;
    }

    return yuanToAmount(value);
  };

  const amountToYuan = (value?: number) => Number(value || 0) / 100;

  const optionalAmountToYuan = (value?: number) =>
    value === undefined || value === null ? undefined : amountToYuan(value);

  const formatMoney = (value?: number) => {
    if (value === undefined || value === null) {
      return '-';
    }

    return `￥${amountToYuan(value).toFixed(2)}`;
  };

  const formatDuration = (record: VipPlanRecord) => {
    if (record.lifetime) {
      return '永久';
    }

    return record.durationDays ? `${record.durationDays} 天` : '-';
  };

  const formatStatus = (status: VipPlanStatus) =>
    status === 'active' ? '启用' : '停用';

  const formatDate = (value: string) =>
    value ? dayjs(value).format('YYYY-MM-DD HH:mm') : '-';

  onMounted(() => {
    fetchData();
  });
</script>

<style scoped lang="less">
  .membership-page {
    padding: 20px;
  }

  .membership-page__card {
    min-height: calc(100vh - 156px);
  }

  .membership-page__search {
    margin-bottom: 20px;
  }

  .membership-page__filter {
    width: 140px;
  }

  .membership-page__pagination {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 16px;
  }

  .membership-page__total {
    color: var(--color-text-3);
    font-size: 14px;
  }

  .membership-page__full {
    width: 100%;
  }

  .membership-page__benefits {
    width: 100%;
  }

  .membership-page__benefit-row {
    display: flex;
    gap: 8px;
    align-items: center;
    margin-bottom: 8px;
  }
</style>
