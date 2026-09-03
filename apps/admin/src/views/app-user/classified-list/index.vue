<template>
  <div class="classified-user-page">
    <a-card :bordered="false" class="classified-user-page__card">
      <template #title>{{ isMembershipPage ? '会员' : '声音服务' }}</template>

      <a-form
        :model="searchForm"
        layout="inline"
        class="classified-user-page__search"
      >
        <a-form-item label="关键词">
          <a-input
            v-model="searchForm.keyword"
            allow-clear
            placeholder="搜索昵称、手机号、账号或用户ID"
            @press-enter="handleSearch"
          />
        </a-form-item>
        <a-form-item :label="isMembershipPage ? '会员类型' : '服务状态'">
          <a-select
            v-model="searchForm.category"
            allow-clear
            placeholder="全部"
            style="width: 150px"
          >
            <template v-if="isMembershipPage">
              <a-option value="one_year">一年会员</a-option>
              <a-option value="three_year">三年会员</a-option>
              <a-option value="lifetime">无限期会员</a-option>
            </template>
            <template v-else>
              <a-option value="pending">待服务</a-option>
              <a-option value="servicing">服务中</a-option>
              <a-option value="refunded">已退款</a-option>
            </template>
          </a-select>
        </a-form-item>
        <a-form-item>
          <a-space>
            <a-button type="primary" :loading="loading" @click="handleSearch">
              查询
            </a-button>
            <a-button @click="resetSearch">重置</a-button>
          </a-space>
        </a-form-item>
      </a-form>

      <a-alert
        v-if="!isMembershipPage"
        type="info"
        class="classified-user-page__hint"
        title="声音服务用户包括购买过 120 元、169 元或 180 元产品的全部用户"
      />

      <a-table
        row-key="id"
        :data="renderList"
        :loading="loading"
        :pagination="false"
        :bordered="false"
      >
        <template #empty>
          <a-empty
            :description="
              isMembershipPage ? '暂无会员用户' : '暂无声音服务用户'
            "
          />
        </template>
        <template #columns>
          <a-table-column title="用户" :width="270">
            <template #cell="{ record }">
              <a-space>
                <a-avatar :size="40">
                  <img v-if="record.avatar" :src="record.avatar" alt="avatar" />
                  <template v-else>{{ avatarFallback(record.name) }}</template>
                </a-avatar>
                <div>
                  <div>{{ record.name || '-' }}</div>
                  <a-typography-text copyable type="secondary">
                    {{ record.id }}
                  </a-typography-text>
                </div>
              </a-space>
            </template>
          </a-table-column>
          <a-table-column title="手机号" data-index="phone" :width="150">
            <template #cell="{ record }">{{ record.phone || '-' }}</template>
          </a-table-column>
          <a-table-column title="登录账号" data-index="account" :width="160">
            <template #cell="{ record }">{{ record.account || '-' }}</template>
          </a-table-column>

          <template v-if="isMembershipPage">
            <a-table-column title="会员类型" :width="130">
              <template #cell="{ record }">
                <a-tag color="gold">{{
                  membershipTypeLabel(record.membershipType)
                }}</a-tag>
              </template>
            </a-table-column>
            <a-table-column title="开始时间" :width="170">
              <template #cell="{ record }">{{
                formatDate(record.membershipStartedAt)
              }}</template>
            </a-table-column>
            <a-table-column title="到期时间" :width="170">
              <template #cell="{ record }">
                {{
                  record.membershipType === 'lifetime'
                    ? '无限期'
                    : formatDate(record.membershipExpiredAt)
                }}
              </template>
            </a-table-column>
          </template>

          <template v-else>
            <a-table-column title="服务状态" :width="120">
              <template #cell="{ record }">
                <a-tag :color="serviceStatusColor(record.serviceStatus)">
                  {{ serviceStatusLabel(record.serviceStatus) }}
                </a-tag>
              </template>
            </a-table-column>
            <a-table-column title="购买产品" :width="180">
              <template #cell="{ record }">
                {{ formatPurchasedAmounts(record.purchasedAmounts) }}
              </template>
            </a-table-column>
            <a-table-column title="最近购买时间" :width="170">
              <template #cell="{ record }">{{
                formatDate(record.latestPurchasedAt)
              }}</template>
            </a-table-column>
          </template>

          <a-table-column title="注册时间" :width="170">
            <template #cell="{ record }">{{
              formatDate(record.createdAt)
            }}</template>
          </a-table-column>
          <a-table-column title="操作" :width="190" fixed="right">
            <template #cell="{ record }">
              <a-space>
                <a-popconfirm
                  v-if="!isMembershipPage && record.serviceStatus === 'pending'"
                  content="确认已开始为该用户提供声音服务？确认后状态将变为“服务中”。"
                  @ok="confirmStartService(record)"
                >
                  <a-button
                    type="text"
                    size="small"
                    :loading="startingUserId === record.id"
                  >
                    确认开始服务
                  </a-button>
                </a-popconfirm>
                <a-button type="text" size="small" @click="goDetail(record.id)">
                  详情
                </a-button>
              </a-space>
            </template>
          </a-table-column>
        </template>
      </a-table>

      <div class="classified-user-page__pagination">
        <span>共 {{ pagination.total }} 位用户</span>
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
  </div>
</template>

<script lang="ts" setup>
  import { computed, reactive, ref, watch } from 'vue';
  import { useRoute, useRouter } from 'vue-router';
  import dayjs from 'dayjs';
  import { Message } from '@arco-design/web-vue';
  import {
    AppUserMemberRecord,
    AppUserVoiceServiceRecord,
    queryAppUserMembers,
    queryAppUserVoiceServices,
    startAppUserVoiceService,
  } from '@/api/app-user';

  type ClassifiedUser = AppUserMemberRecord | AppUserVoiceServiceRecord;

  const route = useRoute();
  const router = useRouter();
  const isMembershipPage = computed(() => route.name === 'AppUserMembers');
  const loading = ref(false);
  const startingUserId = ref('');
  const renderList = ref<ClassifiedUser[]>([]);
  const searchForm = reactive({ keyword: '', category: '' });
  const pagination = reactive({ current: 1, pageSize: 20, total: 0 });

  const fetchData = async () => {
    try {
      loading.value = true;
      const common = {
        keyword: searchForm.keyword.trim() || undefined,
        page: pagination.current,
        pageSize: pagination.pageSize,
      };
      const response = isMembershipPage.value
        ? await queryAppUserMembers({
            ...common,
            membershipType: (searchForm.category || undefined) as never,
          })
        : await queryAppUserVoiceServices({
            ...common,
            serviceStatus: (searchForm.category || undefined) as never,
          });
      renderList.value = response.data.items;
      pagination.total = response.data.total;
      pagination.current = response.data.page;
      pagination.pageSize = response.data.pageSize;
    } catch (error) {
      Message.error('用户分类列表加载失败');
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
    searchForm.category = '';
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
  const goDetail = (id: string) =>
    router.push({ name: 'AppUserDetail', params: { id } });
  const confirmStartService = async (record: AppUserVoiceServiceRecord) => {
    try {
      startingUserId.value = record.id;
      await startAppUserVoiceService(record.id);
      Message.success('已进入服务中');
      await fetchData();
    } catch (error: any) {
      Message.error(error?.response?.data?.message || '开始声音服务失败');
    } finally {
      startingUserId.value = '';
    }
  };
  const formatDate = (value?: string) =>
    value ? dayjs(value).format('YYYY-MM-DD HH:mm') : '-';
  const avatarFallback = (name?: string) => name?.trim().slice(0, 1) || 'U';
  const membershipTypeLabel = (type: string) =>
    ({ one_year: '一年会员', three_year: '三年会员', lifetime: '无限期会员' }[
      type
    ] || type);
  const serviceStatusLabel = (status: string) =>
    ({ pending: '待服务', servicing: '服务中', refunded: '已退款' }[status] ||
    status);
  const serviceStatusColor = (status: string) =>
    ({ pending: 'orange', servicing: 'blue', refunded: 'gray' }[status] ||
    'gray');
  const formatPurchasedAmounts = (amounts: number[]) =>
    amounts.map((amount) => `${amount} 元`).join('、');

  watch(
    () => route.name,
    () => {
      searchForm.keyword = '';
      searchForm.category = '';
      pagination.current = 1;
      fetchData();
    },
    { immediate: true }
  );
</script>

<style scoped lang="less">
  .classified-user-page {
    min-height: 100%;
    padding: 16px 20px;
    background: var(--color-fill-2);

    &__card {
      min-height: calc(100vh - 112px);
    }

    &__search,
    &__hint {
      margin-bottom: 16px;
    }

    &__pagination {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-top: 16px;
    }
  }
</style>
