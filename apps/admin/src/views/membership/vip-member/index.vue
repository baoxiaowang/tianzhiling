<template>
  <div class="membership-page">
    <a-card class="membership-page__card" :bordered="false">
      <template #title>VIP会员</template>

      <a-form
        :model="searchForm"
        layout="inline"
        class="membership-page__search"
      >
        <a-form-item field="keyword" label="关键词">
          <a-input
            v-model="searchForm.keyword"
            allow-clear
            placeholder="搜索用户昵称、手机号或用户ID"
          />
        </a-form-item>
        <a-form-item field="status" label="状态">
          <a-select
            v-model="searchForm.status"
            allow-clear
            placeholder="全部"
            class="membership-page__filter"
          >
            <a-option value="active">有效</a-option>
            <a-option value="expired">已过期</a-option>
            <a-option value="refunded">已退款</a-option>
          </a-select>
        </a-form-item>
        <a-form-item>
          <a-space>
            <a-button type="primary">
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
        :data="members"
        :pagination="false"
        :bordered="false"
      >
        <template #empty>
          <a-empty description="暂无会员记录" />
        </template>
        <template #columns>
          <a-table-column title="用户" data-index="userName" />
          <a-table-column title="手机号" data-index="phone" />
          <a-table-column title="会员计划" data-index="planName" />
          <a-table-column title="开始时间" data-index="startedAt" />
          <a-table-column title="到期时间" data-index="expiredAt" />
          <a-table-column title="状态" data-index="status">
            <template #cell="{ record }">
              <a-tag :color="record.status === '有效' ? 'green' : 'gray'">
                {{ record.status }}
              </a-tag>
            </template>
          </a-table-column>
          <a-table-column title="操作" :width="120">
            <template #cell>
              <a-button type="text" size="small">详情</a-button>
            </template>
          </a-table-column>
        </template>
      </a-table>
    </a-card>
  </div>
</template>

<script lang="ts" setup>
  import { reactive } from 'vue';

  const searchForm = reactive({
    keyword: '',
    status: '',
  });

  const members: Array<Record<string, string>> = [];

  const resetSearch = () => {
    searchForm.keyword = '';
    searchForm.status = '';
  };
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
</style>
