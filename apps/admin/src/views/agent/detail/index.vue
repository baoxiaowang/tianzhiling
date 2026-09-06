<template>
  <div class="agent-detail-page">
    <a-card class="agent-detail-page__header-card" :bordered="false">
      <a-breadcrumb class="agent-detail-page__breadcrumb">
        <a-breadcrumb-item>
          <a-link @click="goBack">智能体管理</a-link>
        </a-breadcrumb-item>
        <a-breadcrumb-item>智能体主页</a-breadcrumb-item>
      </a-breadcrumb>
    </a-card>

    <div class="agent-detail-page__content">
      <a-card class="agent-detail-page__info-card" :bordered="false">
        <a-spin :loading="loading">
          <div v-if="agent" class="agent-detail-page__overview">
            <section class="agent-detail-page__hero">
              <a-avatar :size="64">
                <img
                  v-if="isRenderableAvatar(agent.avatar)"
                  :src="agent.avatar"
                  alt="agent avatar"
                />
                <template v-else>
                  {{ getAvatarFallback(agent.name, 'A') }}
                </template>
              </a-avatar>
              <div class="agent-detail-page__identity">
                <div class="agent-detail-page__identity-line">
                  <h2 class="agent-detail-page__name">
                    {{ agent.name || '-' }}
                  </h2>
                  <a-tag :color="agent.status === 1 ? 'green' : 'gray'">
                    {{ formatStatus(agent.status) }}
                  </a-tag>
                </div>
                <a-typography-text class="agent-detail-page__id" copyable>
                  {{ agent.id }}
                </a-typography-text>
                <a-space class="agent-detail-page__tags" size="mini" wrap>
                  <a-tag>{{ formatSex(agent.sex) }}</a-tag>
                  <a-tag :color="agent.voiceTimbreId ? 'arcoblue' : 'orange'">
                    {{ agent.voiceTimbreId ? '已配置音色' : '未配置音色' }}
                  </a-tag>
                  <a-tag>用户称呼：{{ agent.iCallAgent || '-' }}</a-tag>
                  <a-tag>称呼用户：{{ agent.agentCallMe || '-' }}</a-tag>
                </a-space>
              </div>
              <a-button
                class="agent-detail-page__memory-button"
                type="primary"
                :loading="memoriesLoading"
                @click="openMemories"
              >
                查看已梳理记忆
              </a-button>
            </section>

            <section class="agent-detail-page__profile-details">
              <div class="agent-detail-page__section-label">角色信息</div>
              <a-descriptions
                class="agent-detail-page__descriptions"
                :column="{ xs: 1, md: 2, lg: 4 }"
                size="small"
              >
                <a-descriptions-item label="生日">
                  {{ formatDate(agent.birthday, 'YYYY-MM-DD') }}
                </a-descriptions-item>
                <a-descriptions-item label="忌日">
                  {{ formatDate(agent.deathDate, 'YYYY-MM-DD') }}
                </a-descriptions-item>
                <a-descriptions-item label="创建时间">
                  {{ formatDate(agent.createdAt) }}
                </a-descriptions-item>
                <a-descriptions-item label="更新时间">
                  {{ formatDate(agent.updatedAt) }}
                </a-descriptions-item>
              </a-descriptions>
              <div class="agent-detail-page__description-row">
                <span>人物描述</span>
                <a-typography-paragraph
                  class="agent-detail-page__description"
                  :ellipsis="{ rows: 2, expandable: true }"
                >
                  {{ agent.description || '-' }}
                </a-typography-paragraph>
              </div>
            </section>

            <section
              v-if="agent.createdUser"
              class="agent-detail-page__owner-section"
            >
              <span class="agent-detail-page__owner-label">所属用户</span>
              <a-avatar :size="24">
                <img
                  v-if="isRenderableAvatar(agent.createdUser.avatar)"
                  :src="agent.createdUser.avatar"
                  alt="user avatar"
                />
                <template v-else>
                  {{ getAvatarFallback(agent.createdUser.name, 'U') }}
                </template>
              </a-avatar>
              <a-link @click="goUserDetail(agent.createdUser.id)">
                {{ agent.createdUser.name || '-' }}
              </a-link>
              <span>{{ agent.createdUser.account || '-' }}</span>
              <span>{{ agent.createdUser.phone || '-' }}</span>
              <a-tag v-if="agent.createdUser.isVip" color="gold" size="small">
                VIP
              </a-tag>
            </section>
          </div>

          <a-empty v-if="!agent" description="暂无智能体信息" />
        </a-spin>
      </a-card>

      <a-card class="agent-detail-page__conversation-card" :bordered="false">
        <template #title>对话记录</template>
        <a-spin :loading="conversationsLoading">
          <div
            v-if="conversationList.length > 0"
            class="agent-detail-page__chat-layout"
          >
            <section class="agent-detail-page__chat-panel">
              <header class="agent-detail-page__chat-header">
                <div class="agent-detail-page__chat-user">
                  <a-avatar :size="36">
                    <img
                      v-if="
                        isRenderableAvatar(
                          selectedConversation?.user?.avatar || ''
                        )
                      "
                      :src="selectedConversation?.user?.avatar"
                      alt="user avatar"
                    />
                    <template v-else>
                      {{
                        getAvatarFallback(
                          selectedConversation?.user?.name || '',
                          'U'
                        )
                      }}
                    </template>
                  </a-avatar>
                  <div>
                    <div class="agent-detail-page__chat-title">
                      {{ selectedConversationTitle }}
                    </div>
                    <div class="agent-detail-page__chat-subtitle">
                      {{
                        selectedConversation?.user?.account ||
                        selectedConversation?.userId
                      }}
                      · {{ selectedConversation?.messageCount || 0 }} 条消息
                    </div>
                  </div>
                </div>
                <div class="agent-detail-page__chat-actions">
                  <a-select
                    v-if="conversationPagination.total > 1"
                    :model-value="selectedConversationId"
                    class="agent-detail-page__conversation-select"
                    size="small"
                    @change="selectConversationById"
                  >
                    <a-option
                      v-for="conversation in conversationList"
                      :key="conversation.id"
                      :value="conversation.id"
                    >
                      {{ formatConversationTitle(conversation) }} ·
                      {{ conversation.messageCount }} 条
                    </a-option>
                  </a-select>
                  <a-pagination
                    v-if="
                      conversationPagination.total >
                      conversationPagination.pageSize
                    "
                    simple
                    :current="conversationPagination.current"
                    :page-size="conversationPagination.pageSize"
                    :total="conversationPagination.total"
                    @change="onConversationPageChange"
                  />
                  <a-button
                    v-if="selectedConversation?.user"
                    type="outline"
                    size="small"
                    @click="goUserDetail(selectedConversation.user.id)"
                  >
                    查看用户
                  </a-button>
                </div>
              </header>

              <a-spin :loading="messagesLoading">
                <div
                  v-if="messageList.length > 0"
                  class="agent-detail-page__message-stream"
                >
                  <div
                    v-for="message in messageList"
                    :key="message.id"
                    class="agent-detail-page__message-row"
                    :class="{
                      'agent-detail-page__message-row--user':
                        message.role === 'user',
                    }"
                  >
                    <a-avatar
                      class="agent-detail-page__message-avatar"
                      :size="32"
                    >
                      <template v-if="message.role === 'user'">
                        {{
                          getAvatarFallback(
                            selectedConversation?.user?.name || '',
                            'U'
                          )
                        }}
                      </template>
                      <template v-else>
                        {{ getAvatarFallback(agent?.name || '', 'A') }}
                      </template>
                    </a-avatar>
                    <div class="agent-detail-page__message-body">
                      <div class="agent-detail-page__message-meta">
                        <span>{{ formatMessageRole(message.role) }}</span>
                        <span>{{ formatDate(message.createdAt) }}</span>
                        <a-tag size="small">
                          {{ formatMessageType(message.type) }}
                        </a-tag>
                        <a-tag
                          v-if="message.isArchived"
                          size="small"
                          color="orange"
                        >
                          已归档
                        </a-tag>
                        <a-popconfirm
                          v-else-if="canArchiveMessage(message)"
                          content="归档后不会影响聊天展示，但不会再进入后续 AI 召回。确认归档？"
                          @ok="() => archiveMessage(message)"
                        >
                          <a-button
                            type="text"
                            size="mini"
                            :loading="isArchivingMessage(message.id)"
                          >
                            归档
                          </a-button>
                        </a-popconfirm>
                      </div>
                      <div
                        v-if="message.role !== 'system'"
                        class="agent-detail-page__message-bubble"
                      >
                        {{ formatMessageContent(message) }}
                      </div>
                      <a-typography-paragraph
                        v-else
                        class="agent-detail-page__message-bubble agent-detail-page__message-bubble--system"
                        :ellipsis="{ rows: 2, expandable: true }"
                      >
                        {{ formatMessageContent(message) }}
                      </a-typography-paragraph>
                    </div>
                  </div>
                </div>

                <a-empty v-else description="暂无消息记录" />
              </a-spin>

              <div
                v-if="messagePagination.total > messagePagination.pageSize"
                class="agent-detail-page__message-pagination"
              >
                <a-pagination
                  :current="messagePagination.current"
                  :page-size="messagePagination.pageSize"
                  :total="messagePagination.total"
                  @change="onMessagePageChange"
                />
              </div>
            </section>
          </div>

          <a-empty v-else description="暂无对话记录" />
        </a-spin>
      </a-card>
    </div>

    <a-drawer
      :visible="memoriesVisible"
      :width="760"
      title="已梳理记忆"
      unmount-on-close
      @cancel="memoriesVisible = false"
    >
      <a-spin :loading="memoriesLoading">
        <a-alert class="agent-detail-page__memory-tip">
          展示当前有效、候选或待确认的结构化记忆；已归档记忆不在此处显示。
        </a-alert>
        <a-table
          v-if="memoryList.length"
          :data="memoryList"
          :pagination="false"
          :bordered="false"
          :scroll="{ x: 860, y: 'calc(100vh - 190px)' }"
          size="small"
        >
          <template #columns>
            <a-table-column title="类型" :width="100">
              <template #cell="{ record }">
                {{ formatMemoryType(record.type) }}
              </template>
            </a-table-column>
            <a-table-column title="记忆内容" :width="280">
              <template #cell="{ record }">
                <div class="agent-detail-page__memory-value">
                  {{ record.value || '-' }}
                </div>
                <div class="agent-detail-page__memory-key">
                  {{ record.key }}
                </div>
              </template>
            </a-table-column>
            <a-table-column title="状态" :width="100">
              <template #cell="{ record }">
                <a-tag :color="getMemoryStatusColor(record.status)">
                  {{ formatMemoryStatus(record.status) }}
                </a-tag>
              </template>
            </a-table-column>
            <a-table-column title="优先级" data-index="priority" :width="80" />
            <a-table-column title="依据" :width="220">
              <template #cell="{ record }">
                <a-typography-paragraph
                  class="agent-detail-page__memory-source"
                  :ellipsis="{ rows: 2, expandable: true }"
                >
                  {{ record.sourceText || '-' }}
                </a-typography-paragraph>
              </template>
            </a-table-column>
            <a-table-column title="更新时间" :width="160">
              <template #cell="{ record }">
                {{ formatDate(record.updatedAt) }}
              </template>
            </a-table-column>
          </template>
        </a-table>
        <a-empty v-else description="暂无已梳理记忆" />
      </a-spin>
    </a-drawer>
  </div>
</template>

<script lang="ts" setup>
  import { computed, reactive, ref, watch } from 'vue';
  import { useRoute, useRouter } from 'vue-router';
  import dayjs from 'dayjs';
  import { Message } from '@arco-design/web-vue';
  import useLoading from '@/hooks/loading';
  import {
    AgentConversationMessageRecord,
    AgentConversationRecord,
    AgentMemoryRecord,
    AgentRecord,
    archiveAgentConversationMessage,
    queryAgentConversationMessages,
    queryAgentConversations,
    queryAgentDetail,
    queryAgentMemories,
  } from '@/api/agent';

  type MessageLike = {
    type: string;
    content?: string;
    mediaTranscript?: string;
  };

  const route = useRoute();
  const router = useRouter();
  const { loading, setLoading } = useLoading();
  const agent = ref<AgentRecord | null>(null);
  const conversationList = ref<AgentConversationRecord[]>([]);
  const messageList = ref<AgentConversationMessageRecord[]>([]);
  const selectedConversationId = ref('');
  const conversationsLoading = ref(false);
  const messagesLoading = ref(false);
  const memoriesVisible = ref(false);
  const memoriesLoading = ref(false);
  const memoryList = ref<AgentMemoryRecord[]>([]);
  const memoriesLoadedAgentId = ref('');
  const archivingMessageIds = ref<Set<string>>(new Set());
  const conversationPagination = reactive({
    current: 1,
    pageSize: 10,
    total: 0,
  });
  const messagePagination = reactive({
    current: 1,
    pageSize: 50,
    total: 0,
  });

  const agentId = computed(() => {
    const { id } = route.params;
    return Array.isArray(id) ? id[0] : id;
  });
  const selectedConversation = computed(() =>
    conversationList.value.find(
      (conversation) => conversation.id === selectedConversationId.value
    )
  );
  const selectedConversationTitle = computed(() =>
    selectedConversation.value
      ? formatConversationTitle(selectedConversation.value)
      : '请选择对话'
  );

  const fetchAgentDetail = async (id?: string) => {
    if (!id) {
      agent.value = null;
      return;
    }

    try {
      setLoading(true);
      const { data } = await queryAgentDetail(id);
      agent.value = data;
    } catch (error) {
      agent.value = null;
      Message.error('Agent 详情加载失败');
    } finally {
      setLoading(false);
    }
  };

  const fetchAgentConversations = async (id?: string) => {
    if (!id) {
      conversationList.value = [];
      conversationPagination.total = 0;
      return;
    }

    try {
      conversationsLoading.value = true;
      const { data } = await queryAgentConversations(id, {
        page: conversationPagination.current,
        pageSize: conversationPagination.pageSize,
      });
      conversationList.value = data.items;
      conversationPagination.total = data.total;
      conversationPagination.current = data.page;
      conversationPagination.pageSize = data.pageSize;

      const currentConversationExists = data.items.some(
        (item) => item.id === selectedConversationId.value
      );

      if (data.items.length === 0) {
        selectedConversationId.value = '';
        messageList.value = [];
        messagePagination.total = 0;
        return;
      }

      if (!currentConversationExists) {
        selectedConversationId.value = data.items[0].id;
        messagePagination.current = 1;
      }

      fetchConversationMessages(id, selectedConversationId.value);
    } catch (error) {
      conversationList.value = [];
      messageList.value = [];
      selectedConversationId.value = '';
      conversationPagination.total = 0;
      messagePagination.total = 0;
      Message.error('对话记录加载失败');
    } finally {
      conversationsLoading.value = false;
    }
  };

  const openMemories = async () => {
    memoriesVisible.value = true;
    if (
      !agentId.value ||
      memoriesLoadedAgentId.value === agentId.value ||
      memoriesLoading.value
    ) {
      return;
    }

    try {
      memoriesLoading.value = true;
      const { data } = await queryAgentMemories(agentId.value);
      memoryList.value = data.items;
      memoriesLoadedAgentId.value = agentId.value;
    } catch (error) {
      memoryList.value = [];
      Message.error('智能体记忆加载失败');
    } finally {
      memoriesLoading.value = false;
    }
  };

  const fetchConversationMessages = async (
    id?: string,
    conversationId?: string
  ) => {
    if (!id || !conversationId) {
      messageList.value = [];
      messagePagination.total = 0;
      return;
    }

    try {
      messagesLoading.value = true;
      const { data } = await queryAgentConversationMessages(
        id,
        conversationId,
        {
          page: messagePagination.current,
          pageSize: messagePagination.pageSize,
        }
      );
      messageList.value = data.items;
      messagePagination.total = data.total;
      messagePagination.current = data.page;
      messagePagination.pageSize = data.pageSize;
    } catch (error) {
      messageList.value = [];
      messagePagination.total = 0;
      Message.error('消息记录加载失败');
    } finally {
      messagesLoading.value = false;
    }
  };

  const goBack = () => {
    router.push({ name: 'AgentList' });
  };

  const goUserDetail = (id: string) => {
    router.push({
      name: 'AppUserDetail',
      params: { id },
    });
  };

  const onConversationPageChange = (page: number) => {
    conversationPagination.current = page;
    fetchAgentConversations(agentId.value);
  };

  const selectConversation = (conversation: AgentConversationRecord) => {
    if (conversation.id === selectedConversationId.value) {
      return;
    }

    selectedConversationId.value = conversation.id;
    messagePagination.current = 1;
    fetchConversationMessages(agentId.value, conversation.id);
  };

  const selectConversationById = (conversationId: unknown) => {
    if (typeof conversationId !== 'string') {
      return;
    }

    const conversation = conversationList.value.find(
      (item) => item.id === conversationId
    );

    if (conversation) {
      selectConversation(conversation);
    }
  };

  const onMessagePageChange = (page: number) => {
    messagePagination.current = page;
    fetchConversationMessages(agentId.value, selectedConversationId.value);
  };

  const canArchiveMessage = (message: AgentConversationMessageRecord) => {
    return message.role === 'assistant' && !message.isArchived;
  };

  const isArchivingMessage = (messageId: string) => {
    return archivingMessageIds.value.has(messageId);
  };

  const setMessageArchiving = (messageId: string, value: boolean) => {
    const nextIds = new Set(archivingMessageIds.value);

    if (value) {
      nextIds.add(messageId);
    } else {
      nextIds.delete(messageId);
    }

    archivingMessageIds.value = nextIds;
  };

  const archiveMessage = async (message: AgentConversationMessageRecord) => {
    if (
      !agentId.value ||
      !selectedConversationId.value ||
      !canArchiveMessage(message) ||
      isArchivingMessage(message.id)
    ) {
      return;
    }

    try {
      setMessageArchiving(message.id, true);
      const { data } = await archiveAgentConversationMessage(
        agentId.value,
        selectedConversationId.value,
        message.id
      );
      messageList.value = messageList.value.map((item) =>
        item.id === data.id ? { ...item, ...data } : item
      );
      Message.success('已归档');
    } catch (error) {
      Message.error('归档失败');
    } finally {
      setMessageArchiving(message.id, false);
    }
  };

  const formatConversationTitle = (conversation: AgentConversationRecord) => {
    return (
      conversation.user?.name ||
      conversation.user?.account ||
      conversation.userId ||
      '-'
    );
  };

  const formatDate = (value: string, pattern = 'YYYY-MM-DD HH:mm') => {
    return value ? dayjs(value).format(pattern) : '-';
  };

  const getAvatarFallback = (name: string, fallback: string) => {
    return name?.trim()?.slice(0, 1)?.toUpperCase() || fallback;
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

  const formatMessageRole = (role: string) => {
    if (role === 'user') {
      return '用户';
    }

    if (role === 'assistant') {
      return 'Agent';
    }

    return '系统';
  };

  const formatMessageType = (type: string) => {
    if (type === 'voice') {
      return '语音';
    }

    if (type === 'image') {
      return '图片';
    }

    return '文本';
  };

  const formatMemoryType = (value: string) => {
    const labels: Record<string, string> = {
      identity: '身份',
      relationship: '关系',
      age: '年龄',
      occupation: '职业',
      family: '家庭',
      preference: '偏好',
      correction: '纠正',
      promise: '承诺',
      keepsake: '纪念物',
      grief_trigger: '哀伤触发',
      safety_signal: '安全信号',
      style: '表达风格',
      memory: '共同记忆',
      taboo: '禁忌',
    };
    return labels[value] || value || '-';
  };

  const formatMemoryStatus = (value: string) => {
    const labels: Record<string, string> = {
      active: '有效',
      candidate: '候选',
      conflicted: '有冲突',
      pending: '待确认',
      rejected: '已拒绝',
    };
    return labels[value] || value || '-';
  };

  const getMemoryStatusColor = (value: string) => {
    const colors: Record<string, string> = {
      active: 'green',
      candidate: 'arcoblue',
      conflicted: 'red',
      pending: 'orange',
      rejected: 'gray',
    };
    return colors[value] || 'gray';
  };

  const formatMessageContent = (message: MessageLike) => {
    if (message.type === 'voice') {
      return (
        message.mediaTranscript?.trim() || message.content?.trim() || '[语音]'
      );
    }

    if (message.type === 'image') {
      return message.content?.trim() || '[图片]';
    }

    return message.content?.trim() || '-';
  };

  const isRenderableAvatar = (avatar: string) => {
    const value = avatar?.trim();

    return Boolean(value && /^(https?:)?\/\//i.test(value));
  };

  watch(
    agentId,
    (id) => {
      conversationPagination.current = 1;
      messagePagination.current = 1;
      selectedConversationId.value = '';
      messageList.value = [];
      memoryList.value = [];
      memoriesLoadedAgentId.value = '';
      memoriesVisible.value = false;
      fetchAgentDetail(id);
      fetchAgentConversations(id);
    },
    { immediate: true }
  );
</script>

<script lang="ts">
  export default {
    name: 'AgentDetail',
  };
</script>

<style lang="less" scoped>
  .agent-detail-page {
    box-sizing: border-box;
    min-height: calc(100vh - 60px);
    padding: 16px 20px;
    background: var(--color-fill-2);
    display: flex;
    flex-direction: column;

    &__header-card,
    &__info-card,
    &__conversation-card {
      min-height: 0;
      border-radius: 8px;
    }

    &__info-card {
      display: flex;
      flex-direction: column;

      :deep(.arco-card-body) {
        min-height: 0;
        padding: 18px 20px 14px;
      }
    }

    &__conversation-card {
      display: flex;
      flex: none;
      height: calc(100vh - 140px);
      min-width: 0;
      min-height: 640px;
      flex-direction: column;

      :deep(.arco-card-body) {
        flex: 1;
        display: flex;
        flex-direction: column;
        min-height: 0;
        overflow: hidden;
      }

      :deep(.arco-spin),
      :deep(.arco-spin-children) {
        min-height: 0;
        flex: 1;
        display: flex;
        flex-direction: column;
      }
    }

    &__breadcrumb {
      line-height: 24px;
    }

    &__content {
      display: flex;
      flex-direction: column;
      gap: 16px;
      margin-top: 16px;
    }

    &__overview {
      display: flex;
      flex-direction: column;
      min-width: 0;
    }

    &__hero {
      display: flex;
      min-width: 0;
      gap: 16px;
      align-items: center;
    }

    &__identity {
      min-width: 0;
      flex: 1;
    }

    &__identity-line {
      display: flex;
      gap: 10px;
      align-items: center;
    }

    &__name {
      max-width: 100%;
      margin: 0;
      overflow: hidden;
      color: var(--color-text-1);
      font-weight: 600;
      font-size: 22px;
      line-height: 30px;
      white-space: nowrap;
      text-overflow: ellipsis;
    }

    &__id,
    &__user-id,
    &__timbre-id {
      display: inline-block;
      max-width: 100%;
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

    &__tags {
      margin-top: 8px;
    }

    &__memory-button {
      flex: 0 0 auto;
    }

    &__profile-details {
      margin-top: 16px;
      padding: 10px 14px;
      border: 1px solid var(--color-border-1);
      border-radius: 6px;
      background: var(--color-fill-1);
    }

    &__section-label {
      margin-bottom: 9px;
      color: var(--color-text-2);
      font-weight: 500;
      font-size: 13px;
    }

    &__descriptions {
      :deep(.arco-descriptions-item-label) {
        color: var(--color-text-3);
      }

      :deep(.arco-descriptions-item-value) {
        color: var(--color-text-2);
      }
    }

    &__description-row {
      display: grid;
      grid-template-columns: 64px minmax(0, 1fr);
      gap: 12px;
      margin-top: 6px;
      color: var(--color-text-3);
      font-size: 13px;
      line-height: 20px;
    }

    &__description {
      margin-bottom: 0;
      color: var(--color-text-2);
      font-size: 13px;
    }

    &__memory-tip {
      margin-bottom: 12px;
    }

    &__memory-value {
      color: var(--color-text-1);
      line-height: 20px;
      word-break: break-word;
    }

    &__memory-key {
      margin-top: 3px;
      color: var(--color-text-3);
      font-size: 12px;
      word-break: break-all;
    }

    &__memory-source {
      margin-bottom: 0;
      color: var(--color-text-2);
    }

    &__owner-section {
      display: flex;
      min-width: 0;
      gap: 8px;
      align-items: center;
      margin-top: 10px;
      padding: 0 4px;
      color: var(--color-text-3);
      font-size: 12px;
    }

    &__owner-label {
      flex: 0 0 auto;
      font-size: 12px;
    }

    &__chat-layout {
      flex: 1;
      display: flex;
      min-height: 0;
      overflow: hidden;
      border: 1px solid var(--color-border-2);
      border-radius: 6px;
      background: var(--color-bg-1);
    }

    &__chat-panel {
      display: flex;
      flex: 1;
      min-width: 0;
      min-height: 0;
      flex-direction: column;
      background: var(--color-fill-1);
    }

    &__chat-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      min-height: 60px;
      padding: 10px 16px;
      border-bottom: 1px solid var(--color-border-2);
      background: var(--color-bg-1);
    }

    &__chat-user,
    &__chat-actions {
      display: flex;
      min-width: 0;
      gap: 10px;
      align-items: center;
    }

    &__chat-actions {
      flex: 0 0 auto;
    }

    &__conversation-select {
      width: 210px;
    }

    &__chat-title {
      color: var(--color-text-1);
      font-weight: 500;
      font-size: 16px;
      line-height: 24px;
    }

    &__chat-subtitle {
      margin-top: 2px;
      color: var(--color-text-3);
      font-size: 12px;
      line-height: 18px;
    }

    &__message-stream {
      display: flex;
      flex: 1;
      flex-direction: column;
      gap: 18px;
      min-height: 0;
      padding: 18px 20px;
      overflow: auto;
      scrollbar-width: none;

      &::-webkit-scrollbar {
        display: none;
      }
    }

    &__message-row {
      display: flex;
      gap: 10px;
      align-items: flex-start;

      &--user {
        flex-direction: row-reverse;

        .agent-detail-page__message-meta {
          justify-content: flex-end;
        }

        .agent-detail-page__message-bubble {
          border-color: rgb(var(--primary-6));
          background: rgb(var(--primary-6));
          color: #fff;
        }
      }
    }

    &__message-avatar {
      flex: 0 0 auto;
    }

    &__message-body {
      max-width: min(72%, 640px);
      min-width: 0;
    }

    &__message-meta {
      display: flex;
      gap: 6px;
      align-items: center;
      margin-bottom: 6px;
      color: var(--color-text-3);
      font-size: 12px;
      line-height: 18px;
    }

    &__message-bubble {
      padding: 10px 12px;
      border: 1px solid var(--color-border-2);
      border-radius: 8px;
      background: var(--color-bg-1);
      color: var(--color-text-1);
      line-height: 22px;
      white-space: pre-wrap;
      word-break: break-word;

      &--system {
        margin-bottom: 0;
        border-style: dashed;
        background: var(--color-fill-2);
        color: var(--color-text-3);
        font-size: 12px;
      }
    }

    &__message-pagination {
      display: flex;
      justify-content: flex-end;
      padding: 12px 16px;
      border-top: 1px solid var(--color-border-2);
      background: var(--color-bg-1);
    }
  }

  @media (max-width: 991px) {
    .agent-detail-page {
      &__chat-header {
        align-items: flex-start;
      }

      &__chat-actions {
        flex-wrap: wrap;
        justify-content: flex-end;
      }
    }
  }

  @media (max-width: 575px) {
    .agent-detail-page {
      padding: 12px;

      &__hero,
      &__owner-section,
      &__chat-header {
        flex-wrap: wrap;
      }

      &__identity {
        flex-basis: calc(100% - 80px);
      }

      &__memory-button,
      &__chat-actions {
        width: 100%;
      }

      &__chat-actions {
        justify-content: flex-start;
      }

      &__message-body {
        max-width: calc(100% - 42px);
      }
    }
  }
</style>
