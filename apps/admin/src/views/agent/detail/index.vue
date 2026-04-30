<template>
  <div class="agent-detail-page">
    <a-card class="agent-detail-page__header-card" :bordered="false">
      <a-breadcrumb class="agent-detail-page__breadcrumb">
        <a-breadcrumb-item>
          <a-link @click="goBack">Agent 管理</a-link>
        </a-breadcrumb-item>
        <a-breadcrumb-item>Agent 详情</a-breadcrumb-item>
      </a-breadcrumb>
    </a-card>

    <div class="agent-detail-page__content">
      <a-card class="agent-detail-page__info-card" :bordered="false">
        <template #title>基本信息</template>
        <a-spin :loading="loading">
          <div v-if="agent" class="agent-detail-page__profile">
            <a-avatar :size="72">
              <img
                v-if="isRenderableAvatar(agent.avatar)"
                :src="agent.avatar"
                alt="agent avatar"
              />
              <template v-else>
                {{ getAvatarFallback(agent.name, 'A') }}
              </template>
            </a-avatar>

            <div class="agent-detail-page__name">{{ agent.name || '-' }}</div>
            <a-typography-text class="agent-detail-page__id" copyable>
              {{ agent.id }}
            </a-typography-text>
            <a-space class="agent-detail-page__tags">
              <a-tag :color="agent.sex === 1 ? 'blue' : 'magenta'">
                {{ formatSex(agent.sex) }}
              </a-tag>
              <a-tag :color="agent.status === 1 ? 'green' : 'gray'">
                {{ formatStatus(agent.status) }}
              </a-tag>
            </a-space>
          </div>

          <a-descriptions
            v-if="agent"
            class="agent-detail-page__descriptions"
            :column="1"
            size="small"
            bordered
          >
            <a-descriptions-item label="归属用户">
              <template v-if="agent.createdUser">
                <a-link @click="goUserDetail(agent.createdUser.id)">
                  {{ agent.createdUser.name || '-' }}
                </a-link>
                <span v-if="agent.createdUser.account">
                  / {{ agent.createdUser.account }}
                </span>
              </template>
              <template v-else>-</template>
            </a-descriptions-item>
            <a-descriptions-item label="用户称呼TA">
              {{ agent.iCallAgent || '-' }}
            </a-descriptions-item>
            <a-descriptions-item label="TA称呼用户">
              {{ agent.agentCallMe || '-' }}
            </a-descriptions-item>
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
            <a-descriptions-item label="描述">
              <a-typography-paragraph
                class="agent-detail-page__description"
                :ellipsis="{ rows: 5, expandable: true }"
              >
                {{ agent.description || '-' }}
              </a-typography-paragraph>
            </a-descriptions-item>
          </a-descriptions>

          <a-empty v-else description="暂无 Agent 信息" />
        </a-spin>
      </a-card>

      <a-card class="agent-detail-page__conversation-card" :bordered="false">
        <template #title>对话记录</template>
        <a-spin :loading="conversationsLoading">
          <div
            v-if="conversationList.length > 0"
            class="agent-detail-page__chat-layout"
          >
            <aside class="agent-detail-page__conversation-list">
              <button
                v-for="conversation in conversationList"
                :key="conversation.id"
                class="agent-detail-page__conversation-item"
                :class="{
                  'agent-detail-page__conversation-item--active':
                    conversation.id === selectedConversationId,
                }"
                type="button"
                @click="selectConversation(conversation)"
              >
                <a-avatar :size="36">
                  <img
                    v-if="isRenderableAvatar(conversation.user?.avatar || '')"
                    :src="conversation.user?.avatar"
                    alt="user avatar"
                  />
                  <template v-else>
                    {{ getAvatarFallback(conversation.user?.name || '', 'U') }}
                  </template>
                </a-avatar>
                <span class="agent-detail-page__conversation-main">
                  <span class="agent-detail-page__conversation-title">
                    {{ formatConversationTitle(conversation) }}
                  </span>
                  <span class="agent-detail-page__conversation-preview">
                    {{ formatLatestPreview(conversation) }}
                  </span>
                </span>
                <span class="agent-detail-page__conversation-extra">
                  <span>{{ conversation.messageCount }} 条</span>
                  <span>{{
                    formatDate(conversation.updatedAt, 'MM-DD HH:mm')
                  }}</span>
                </span>
              </button>

              <div class="agent-detail-page__conversation-pagination">
                <span class="agent-detail-page__total">
                  共 {{ conversationPagination.total }} 条对话
                </span>
                <a-pagination
                  simple
                  :current="conversationPagination.current"
                  :page-size="conversationPagination.pageSize"
                  :total="conversationPagination.total"
                  @change="onConversationPageChange"
                />
              </div>
            </aside>

            <section class="agent-detail-page__chat-panel">
              <header class="agent-detail-page__chat-header">
                <div>
                  <div class="agent-detail-page__chat-title">
                    {{ selectedConversationTitle }}
                  </div>
                  <div class="agent-detail-page__chat-subtitle">
                    {{
                      selectedConversation?.user?.account ||
                      selectedConversation?.userId
                    }}
                  </div>
                </div>
                <a-button
                  v-if="selectedConversation?.user"
                  type="text"
                  size="small"
                  @click="goUserDetail(selectedConversation.user.id)"
                >
                  查看用户
                </a-button>
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
                      </div>
                      <div class="agent-detail-page__message-bubble">
                        {{ formatMessageContent(message) }}
                      </div>
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
    AgentRecord,
    queryAgentConversationMessages,
    queryAgentConversations,
    queryAgentDetail,
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

  const onMessagePageChange = (page: number) => {
    messagePagination.current = page;
    fetchConversationMessages(agentId.value, selectedConversationId.value);
  };

  const formatConversationTitle = (conversation: AgentConversationRecord) => {
    return (
      conversation.user?.name ||
      conversation.user?.account ||
      conversation.userId ||
      '-'
    );
  };

  const formatLatestPreview = (conversation: AgentConversationRecord) => {
    if (!conversation.latestMessage) {
      return '暂无消息';
    }

    return formatMessageContent(conversation.latestMessage);
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
    height: calc(100vh - 60px);
    padding: 16px 20px;
    overflow: hidden;
    background: var(--color-fill-2);
    display: flex;
    flex-direction: column;

    &__header-card,
    &__info-card,
    &__conversation-card {
      min-height: 0;
      border-radius: 4px;
    }

    &__info-card,
    &__conversation-card {
      :deep(.arco-card-body) {
        min-height: 0;
      }
    }

    &__info-card {
      display: flex;
      flex-direction: column;

      :deep(.arco-card-body) {
        flex: 1;
        overflow: auto;
        scrollbar-width: none;

        &::-webkit-scrollbar {
          display: none;
        }
      }
    }

    &__conversation-card {
      display: flex;
      min-width: 0;
      flex-direction: column;

      :deep(.arco-card-body) {
        flex: 1;
        display: flex;
        flex-direction: column;
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
      flex: 1;
      display: grid;
      grid-template-columns: minmax(280px, 360px) minmax(0, 1fr);
      gap: 16px;
      min-height: 0;
      margin-top: 16px;
    }

    &__profile {
      display: flex;
      flex-direction: column;
      align-items: center;
      margin-bottom: 20px;
      text-align: center;
    }

    &__name {
      max-width: 100%;
      margin-top: 12px;
      overflow: hidden;
      color: var(--color-text-1);
      font-weight: 500;
      font-size: 20px;
      line-height: 28px;
      white-space: nowrap;
      text-overflow: ellipsis;
    }

    &__id,
    &__user-id {
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
      margin-top: 12px;
    }

    &__descriptions {
      :deep(.arco-descriptions-item-label) {
        width: 92px;
        color: var(--color-text-3);
      }
    }

    &__description {
      margin-bottom: 0;
    }

    &__user-identity {
      min-width: 0;
    }

    &__user-name {
      display: block;
      max-width: 142px;
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
    }

    &__chat-layout {
      flex: 1;
      display: grid;
      grid-template-columns: 260px minmax(0, 1fr);
      min-height: 0;
      overflow: hidden;
      border: 1px solid var(--color-border-2);
      border-radius: 4px;
      background: var(--color-bg-1);
    }

    &__conversation-list {
      display: flex;
      flex-direction: column;
      min-width: 0;
      min-height: 0;
      overflow: auto;
      border-right: 1px solid var(--color-border-2);
      background: var(--color-fill-1);
      scrollbar-width: none;

      &::-webkit-scrollbar {
        display: none;
      }
    }

    &__conversation-item {
      display: grid;
      grid-template-columns: 36px minmax(0, 1fr) auto;
      gap: 10px;
      align-items: center;
      width: 100%;
      padding: 12px;
      border: 0;
      border-bottom: 1px solid var(--color-border-1);
      background: transparent;
      color: inherit;
      text-align: left;
      cursor: pointer;

      &:hover,
      &--active {
        background: var(--color-fill-2);
      }

      &--active {
        box-shadow: inset 3px 0 0 rgb(var(--primary-6));
      }
    }

    &__conversation-main,
    &__conversation-extra {
      display: flex;
      min-width: 0;
      flex-direction: column;
      gap: 4px;
    }

    &__conversation-title,
    &__conversation-preview {
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
    }

    &__conversation-title {
      color: var(--color-text-1);
      font-weight: 500;
      line-height: 20px;
    }

    &__conversation-preview,
    &__conversation-extra {
      color: var(--color-text-3);
      font-size: 12px;
      line-height: 18px;
    }

    &__conversation-extra {
      align-items: flex-end;
      white-space: nowrap;
    }

    &__conversation-pagination {
      display: flex;
      gap: 10px;
      align-items: center;
      justify-content: space-between;
      margin-top: auto;
      padding: 12px;
      border-top: 1px solid var(--color-border-1);
      background: var(--color-fill-1);
    }

    &__total {
      color: var(--color-text-2);
      font-size: 14px;
    }

    &__chat-panel {
      display: flex;
      min-width: 0;
      min-height: 0;
      flex-direction: column;
      background: var(--color-fill-1);
    }

    &__chat-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      min-height: 64px;
      padding: 12px 16px;
      border-bottom: 1px solid var(--color-border-2);
      background: var(--color-bg-1);
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
      &__content {
        grid-template-columns: 1fr;
      }

      &__chat-layout {
        grid-template-columns: 1fr;
      }

      &__conversation-list {
        border-right: 0;
        border-bottom: 1px solid var(--color-border-2);
      }
    }
  }

  @media (max-width: 575px) {
    .agent-detail-page {
      padding: 12px;

      &__message-body {
        max-width: calc(100% - 42px);
      }
    }
  }
</style>
