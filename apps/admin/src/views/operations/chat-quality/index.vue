<template>
  <div class="operations-page">
    <header class="operations-page__header">
      <div>
        <h1>聊天质量</h1>
        <p>从用户反馈和真实失败链路进入具体会话，不在这里修改模型回复。</p>
      </div>
      <a-button :loading="loading" @click="fetchData">刷新</a-button>
    </header>

    <a-grid :cols="24" :col-gap="16" :row-gap="16">
      <a-grid-item :span="{ xs: 24, md: 12 }">
        <a-card :bordered="false">
          <a-statistic
            title="近 7 天用户反馈"
            :value="quality?.feedbackLast7Days || 0"
          />
        </a-card>
      </a-grid-item>
      <a-grid-item :span="{ xs: 24, md: 12 }">
        <a-card :bordered="false">
          <a-statistic
            title="近 24 小时失败聊天"
            :value="quality?.failedChatsLast24Hours || 0"
          />
        </a-card>
      </a-grid-item>
      <a-grid-item :span="24">
        <a-card :bordered="false">
          <a-tabs default-active-key="feedback">
            <a-tab-pane key="feedback" title="用户反馈">
              <a-table
                row-key="id"
                :data="quality?.feedback || []"
                :loading="loading"
                :pagination="{ pageSize: 15 }"
                :scroll="{ x: 1510 }"
              >
                <template #columns>
                  <a-table-column title="反馈" :width="120">
                    <template #cell="{ record }">
                      <a-tag :color="feedbackColor(record.type)">
                        {{ feedbackLabel(record.type) }}
                      </a-tag>
                    </template>
                  </a-table-column>
                  <a-table-column title="处理状态" :width="120">
                    <template #cell="{ record }">
                      <a-tag
                        :color="handlingStatusColor(record.handlingStatus)"
                      >
                        {{ handlingStatusLabel(record.handlingStatus) }}
                      </a-tag>
                    </template>
                  </a-table-column>
                  <a-table-column title="用户 / 智能体" :width="220">
                    <template #cell="{ record }">
                      <div class="operations-page__identity">
                        <a-link @click="goUser(record.userId)">
                          {{ record.userName || record.userId || '-' }}
                        </a-link>
                        <a-link @click="goAgent(record.agentId)">
                          {{ record.agentName || record.agentId || '-' }}
                        </a-link>
                      </div>
                    </template>
                  </a-table-column>
                  <a-table-column title="当时的回复" :width="360">
                    <template #cell="{ record }">
                      <a-typography-paragraph
                        :ellipsis="{ rows: 3, expandable: true }"
                      >
                        {{ record.assistantContent || '未保存回复正文' }}
                      </a-typography-paragraph>
                    </template>
                  </a-table-column>
                  <a-table-column title="用户补充" :width="280">
                    <template #cell="{ record }">
                      {{ record.content || '-' }}
                    </template>
                  </a-table-column>
                  <a-table-column title="处理记录" :width="250">
                    <template #cell="{ record }">
                      <div>{{ record.handlingNote || '-' }}</div>
                      <a-typography-text
                        v-if="record.handledBy"
                        type="secondary"
                      >
                        {{ record.handledBy }} ·
                        {{ formatDate(record.handledAt) }}
                      </a-typography-text>
                    </template>
                  </a-table-column>
                  <a-table-column title="时间" :width="170">
                    <template #cell="{ record }">
                      {{ formatDate(record.createdAt) }}
                    </template>
                  </a-table-column>
                  <a-table-column title="操作" :width="160" fixed="right">
                    <template #cell="{ record }">
                      <a-space>
                        <a-link @click="goAgent(record.agentId)"
                          >查看对话</a-link
                        >
                        <a-link @click="openFeedbackHandling(record)"
                          >处理</a-link
                        >
                      </a-space>
                    </template>
                  </a-table-column>
                </template>
              </a-table>
            </a-tab-pane>
            <a-tab-pane key="failed" title="失败链路">
              <a-table
                row-key="id"
                :data="quality?.failedTraces || []"
                :loading="loading"
                :pagination="{ pageSize: 15 }"
                :scroll="{ x: 1240 }"
              >
                <template #columns>
                  <a-table-column title="失败阶段" :width="180">
                    <template #cell="{ record }">
                      <a-tag color="red">
                        {{ record.failureStage || '未知阶段' }}
                      </a-tag>
                    </template>
                  </a-table-column>
                  <a-table-column
                    title="错误码"
                    data-index="errorCode"
                    :width="210"
                  />
                  <a-table-column title="Trace ID" :width="260">
                    <template #cell="{ record }">
                      <a-typography-text copyable>
                        {{ record.traceId }}
                      </a-typography-text>
                    </template>
                  </a-table-column>
                  <a-table-column title="可见耗时" :width="130">
                    <template #cell="{ record }">
                      {{ formatDuration(record.visibleLatencyMs) }}
                    </template>
                  </a-table-column>
                  <a-table-column title="总耗时" :width="130">
                    <template #cell="{ record }">
                      {{ formatDuration(record.totalLatencyMs) }}
                    </template>
                  </a-table-column>
                  <a-table-column
                    title="Tokens"
                    data-index="totalTokens"
                    :width="110"
                  />
                  <a-table-column
                    title="版本"
                    data-index="releaseVersion"
                    :width="180"
                  />
                  <a-table-column title="时间" :width="170">
                    <template #cell="{ record }">
                      {{ formatDate(record.updatedAt) }}
                    </template>
                  </a-table-column>
                  <a-table-column title="操作" :width="100" fixed="right">
                    <template #cell="{ record }">
                      <a-link
                        v-if="record.agentId"
                        @click="goAgent(record.agentId)"
                      >
                        查看智能体
                      </a-link>
                    </template>
                  </a-table-column>
                </template>
              </a-table>
            </a-tab-pane>
          </a-tabs>
        </a-card>
      </a-grid-item>
    </a-grid>

    <a-modal
      v-model:visible="handlingVisible"
      title="处理用户反馈"
      :confirm-loading="handlingSaving"
      :mask-closable="false"
      @before-ok="saveFeedbackHandling"
    >
      <a-form :model="handlingForm" layout="vertical">
        <a-form-item label="处理状态" required>
          <a-select v-model="handlingForm.status">
            <a-option value="pending">待处理</a-option>
            <a-option value="processing">处理中</a-option>
            <a-option value="resolved">已解决</a-option>
            <a-option value="ignored">无需处理</a-option>
          </a-select>
        </a-form-item>
        <a-form-item label="处理说明">
          <a-textarea
            v-model="handlingForm.note"
            :max-length="1000"
            show-word-limit
            :auto-size="{ minRows: 4, maxRows: 8 }"
            placeholder="记录问题判断、处理动作或无需处理的原因"
          />
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<script lang="ts" setup>
  import { onMounted, reactive, ref } from 'vue';
  import { useRouter } from 'vue-router';
  import dayjs from 'dayjs';
  import { Message } from '@arco-design/web-vue';
  import type {
    AdminChatFeedbackHandlingStatus,
    AdminChatFeedbackItemDTO,
    AdminChatQualityDTO,
  } from '@tzl/shared';
  import { queryChatQuality, updateChatFeedback } from '@/api/operations';

  const router = useRouter();
  const loading = ref(false);
  const quality = ref<AdminChatQualityDTO>();
  const handlingVisible = ref(false);
  const handlingSaving = ref(false);
  const selectedFeedback = ref<AdminChatFeedbackItemDTO>();
  const handlingForm = reactive<{
    status: AdminChatFeedbackHandlingStatus;
    note: string;
  }>({ status: 'pending', note: '' });

  const fetchData = async () => {
    try {
      loading.value = true;
      const { data } = await queryChatQuality();
      quality.value = data;
    } catch (error) {
      Message.error('聊天质量数据加载失败');
    } finally {
      loading.value = false;
    }
  };

  const feedbackLabel = (value: string) =>
    ({
      accurate: '准确',
      unlike: '不像本人',
      wrong_fact: '事实错误',
      fabricated: '内容编造',
      uncomfortable: '令人不适',
      other: '其他',
    }[value] ||
    value ||
    '未分类');

  const feedbackColor = (value: string) => {
    if (value === 'accurate') return 'green';
    if (value === 'other') return 'gray';
    return 'orangered';
  };

  const handlingStatusLabel = (value: AdminChatFeedbackHandlingStatus) =>
    ({
      pending: '待处理',
      processing: '处理中',
      resolved: '已解决',
      ignored: '无需处理',
    }[value] || '待处理');
  const handlingStatusColor = (value: AdminChatFeedbackHandlingStatus) =>
    ({
      pending: 'orangered',
      processing: 'blue',
      resolved: 'green',
      ignored: 'gray',
    }[value] || 'orangered');

  const openFeedbackHandling = (record: AdminChatFeedbackItemDTO) => {
    selectedFeedback.value = record;
    handlingForm.status = record.handlingStatus || 'pending';
    handlingForm.note = record.handlingNote || '';
    handlingVisible.value = true;
  };

  const saveFeedbackHandling = async () => {
    if (!selectedFeedback.value) return false;
    try {
      handlingSaving.value = true;
      await updateChatFeedback(selectedFeedback.value.id, {
        status: handlingForm.status,
        note: handlingForm.note,
      });
      Message.success('反馈处理状态已保存');
      await fetchData();
      return true;
    } catch (error) {
      Message.error('反馈处理状态保存失败');
      return false;
    } finally {
      handlingSaving.value = false;
    }
  };

  const goAgent = (id: string) =>
    id && router.push({ name: 'AgentDetail', params: { id } });
  const goUser = (id: string) =>
    id && router.push({ name: 'AppUserDetail', params: { id } });
  const formatDate = (value?: string) =>
    value ? dayjs(value).format('YYYY-MM-DD HH:mm') : '-';
  const formatDuration = (value?: number) =>
    Number.isFinite(value) ? `${((value || 0) / 1000).toFixed(1)} 秒` : '-';

  onMounted(fetchData);
</script>

<style lang="less" scoped>
  @import url('../operations-page.less');
</style>
