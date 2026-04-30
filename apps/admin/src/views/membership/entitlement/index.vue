<template>
  <div class="membership-page">
    <a-card class="membership-page__card" :bordered="false">
      <template #title>权益管理</template>

      <a-form
        :model="searchForm"
        layout="inline"
        class="membership-page__search"
      >
        <a-form-item field="keyword" label="关键词">
          <a-input
            v-model="searchForm.keyword"
            allow-clear
            placeholder="搜索用户、智能体或订单号"
          />
        </a-form-item>
        <a-form-item field="type" label="权益类型">
          <a-select
            v-model="searchForm.type"
            allow-clear
            placeholder="全部"
            class="membership-page__filter"
          >
            <a-option value="voice_model">声音模型</a-option>
            <a-option value="chat_import">聊天记录导入</a-option>
            <a-option value="interview">人工访谈</a-option>
            <a-option value="family_seat">家人共享</a-option>
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
        :data="entitlements"
        :pagination="false"
        :bordered="false"
      >
        <template #empty>
          <a-empty description="暂无权益记录" />
        </template>
        <template #columns>
          <a-table-column title="用户" data-index="userName" />
          <a-table-column title="权益类型" data-index="type" />
          <a-table-column title="绑定智能体" data-index="agentName" />
          <a-table-column title="总额度" data-index="totalQuota" />
          <a-table-column title="已使用" data-index="usedQuota" />
          <a-table-column title="状态" data-index="status" />
          <a-table-column title="来源订单" data-index="sourceOrderNo" />
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
    type: '',
  });

  const entitlements: Array<Record<string, string | number>> = [];

  const resetSearch = () => {
    searchForm.keyword = '';
    searchForm.type = '';
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
    width: 160px;
  }
</style>
