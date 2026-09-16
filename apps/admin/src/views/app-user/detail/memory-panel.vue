<template>
  <div class="memory-panel">
    <div class="memory-panel__header">
      <div class="memory-panel__title">已留存记忆</div>
      <div class="memory-panel__subtitle">
        用户与「{{ agentName || '当前聊天对象' }}」之间确实保存的结构化记忆
      </div>
    </div>

    <a-alert type="info" :show-icon="false" class="memory-panel__notice">
      这里只展示三类信息：已保存的结构化记忆、已进入检索索引且来源有效的原话、账号级共享信息。可检索原话不代表模型在某一轮对话里实际使用过。
    </a-alert>

    <div class="memory-panel__body">
      <a-spin :loading="loading" class="memory-panel__spin">
        <a-result
          v-if="error"
          status="error"
          title="记忆加载失败"
          :subtitle="error"
          class="memory-panel__state"
        >
          <template #extra>
            <a-button size="small" @click="reload">重试</a-button>
          </template>
        </a-result>

        <template v-else>
          <a-empty
            v-if="!items.length"
            class="memory-panel__state"
            description="该聊天对象暂无已留存记忆"
          />

          <div v-else class="memory-panel__list">
            <a-card
              v-for="item in items"
              :key="item.id"
              class="memory-panel__card"
              :bordered="false"
              size="small"
            >
              <div class="memory-panel__card-head">
                <a-space size="mini" wrap>
                  <a-tag color="arcoblue" size="small">
                    {{ formatMemoryType(item.type) }}
                  </a-tag>
                  <a-tag :color="statusColor(item.status)" size="small">
                    {{ formatStatus(item.status) }}
                  </a-tag>
                  <a-tag v-if="item.retention" size="small" color="purple">
                    {{ formatRetention(item.retention) }}
                  </a-tag>
                </a-space>
                <span class="memory-panel__scope">角色记忆</span>
              </div>

              <div class="memory-panel__value">{{ item.value || '-' }}</div>
              <div v-if="item.sourceText" class="memory-panel__source-text">
                原话：{{ item.sourceText }}
              </div>

              <div class="memory-panel__meta">
                <span v-if="item.key">键：{{ item.key }}</span>
                <span>记录时间：{{ formatDate(item.recordedAt) }}</span>
                <span>更新时间：{{ formatDate(item.updatedAt) }}</span>
                <span v-if="item.sourceOccurredAt">
                  事件时间：{{ formatDate(item.sourceOccurredAt) }}
                </span>
                <span v-if="item.validUntil">
                  有效期至：{{ formatDate(item.validUntil) }}
                </span>
              </div>

              <div class="memory-panel__source">
                <template v-if="item.sourceMessageId">
                  <a-link @click="emitLocate(item)">
                    {{
                      item.sourceConversationId
                        ? '定位左侧原话'
                        : '定位左侧原话'
                    }}
                  </a-link>
                </template>
                <span v-else class="memory-panel__source-missing">
                  无来源消息，无法定位原话
                </span>
              </div>
            </a-card>
          </div>

          <div v-if="total > pageSize" class="memory-panel__pagination">
            <a-pagination
              size="small"
              :current="page"
              :page-size="pageSize"
              :total="total"
              show-page-size
              @change="onPageChange"
              @page-size-change="onPageSizeChange"
            />
          </div>
        </template>
      </a-spin>

      <div class="memory-panel__indexed">
        <a-divider orientation="left" class="memory-panel__divider">
          可检索原话（已进检索索引，来源有效）
        </a-divider>
        <div class="memory-panel__indexed-note">
          仅表示这些原话已进入检索索引，来源消息仍然有效；不代表某一轮对话里模型实际使用过。不展示向量数值。
        </div>
        <a-spin :loading="indexedLoading" class="memory-panel__spin">
          <a-result
            v-if="indexedError"
            status="error"
            title="可检索原话加载失败"
            :subtitle="indexedError"
            class="memory-panel__state"
          >
            <template #extra>
              <a-button size="small" @click="reloadIndexed">重试</a-button>
            </template>
          </a-result>
          <template v-else>
            <a-alert
              v-if="!indexedAvailable"
              type="warning"
              :show-icon="false"
              class="memory-panel__state--small"
            >
              检索索引暂不可用（{{
                indexedUnavailableText
              }}），这不是“没有可检索原话”。
              <a-link @click="reloadIndexed">重试</a-link>
            </a-alert>
            <template v-else>
              <div class="memory-panel__indexed-count">
                索引内共 {{ indexedTotal }} 条（全量口径，含来源失效）；本页有效
                {{ indexedPageValidCount }} 条、来源失效
                {{ indexedPageInvalidCount }} 条。
              </div>
              <a-empty
                v-if="!indexedItems.length"
                description="该聊天对象本页暂无可检索原话"
                class="memory-panel__state memory-panel__state--small"
              />
              <div v-else class="memory-panel__list">
                <a-card
                  v-for="evidence in indexedItems"
                  :key="evidence.id"
                  class="memory-panel__card"
                  :bordered="false"
                  size="small"
                >
                  <div class="memory-panel__card-head">
                    <a-space size="mini" wrap>
                      <a-tag color="cyan" size="small">可检索原话</a-tag>
                      <a-tag size="small">
                        {{ evidence.role === 'user' ? '用户' : '角色' }}
                      </a-tag>
                    </a-space>
                    <span class="memory-panel__scope">
                      {{
                        formatDate(
                          evidence.createdAt || evidence.sourceCreatedAt
                        )
                      }}
                    </span>
                  </div>
                  <div class="memory-panel__value">
                    {{ evidence.text || evidence.sourceContent || '-' }}
                  </div>
                  <div
                    v-if="
                      evidence.sourceContent &&
                      evidence.sourceContent !== evidence.text
                    "
                    class="memory-panel__source-text"
                  >
                    原文：{{ evidence.sourceContent }}
                  </div>
                  <div class="memory-panel__meta">
                    <span>来源消息：{{ evidence.sourceMessageId }}</span>
                    <span>来源有效</span>
                  </div>
                  <div class="memory-panel__source">
                    <a-link @click="emitLocateById(evidence.sourceMessageId)">
                      定位左侧原话
                    </a-link>
                  </div>
                </a-card>
              </div>
              <div
                v-if="indexedTotal > indexedPageSize"
                class="memory-panel__pagination"
              >
                <a-pagination
                  size="small"
                  :current="indexedPage"
                  :page-size="indexedPageSize"
                  :total="indexedTotal"
                  show-page-size
                  @change="onIndexedPageChange"
                  @page-size-change="onIndexedPageSizeChange"
                />
              </div>
            </template>
          </template>
        </a-spin>
      </div>

      <div class="memory-panel__shared">
        <a-divider orientation="left" class="memory-panel__divider">
          账号级共享记忆（跨聊天对象）
        </a-divider>
        <a-empty
          v-if="!accountSharedItems.length"
          description="该账号暂无共享记忆"
          class="memory-panel__state memory-panel__state--small"
        />
        <div v-else class="memory-panel__shared-list">
          <div
            v-for="shared in accountSharedItems"
            :key="shared.id"
            class="memory-panel__shared-item"
          >
            <a-space size="mini" wrap>
              <a-tag color="green" size="small">账号级</a-tag>
              <a-tag size="small">{{ formatMemoryType(shared.type) }}</a-tag>
            </a-space>
            <div class="memory-panel__shared-value">{{ shared.value }}</div>
            <div class="memory-panel__meta">
              <span>更新时间：{{ formatDate(shared.updatedAt) }}</span>
            </div>
          </div>
          <div
            v-if="accountSharedTotal > accountSharedItems.length"
            class="memory-panel__meta"
          >
            仅展示前 {{ accountSharedItems.length }} 条，共
            {{ accountSharedTotal }} 条
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
  import { computed, onBeforeUnmount, ref, watch } from 'vue';
  import {
    AppUserAccountSharedMemoryItem,
    AppUserAgentMemoryItem,
    AppUserIndexedEvidenceItem,
    queryAppUserAgentMemories,
    queryAppUserIndexedEvidence,
  } from '@/api/app-user';

  const props = defineProps<{
    userId: string;
    agentId: string;
    agentName?: string;
  }>();

  const emit = defineEmits<{
    (event: 'locateSource', payload: { messageId: string }): void;
  }>();

  const loading = ref(false);
  const error = ref('');
  const items = ref<AppUserAgentMemoryItem[]>([]);
  const total = ref(0);
  const page = ref(1);
  const pageSize = ref(20);
  const accountSharedItems = ref<AppUserAccountSharedMemoryItem[]>([]);
  const accountSharedTotal = ref(0);

  const indexedLoading = ref(false);
  const indexedError = ref('');
  const indexedAvailable = ref(true);
  const indexedUnavailableReason = ref('');
  const indexedItems = ref<AppUserIndexedEvidenceItem[]>([]);
  const indexedTotal = ref(0);
  const indexedPageValidCount = ref(0);
  const indexedPageInvalidCount = ref(0);
  const indexedPage = ref(1);
  const indexedPageSize = ref(20);

  const indexedUnavailableText = computed(() => {
    if (indexedUnavailableReason.value === 'disabled') {
      return '检索索引未启用';
    }
    if (indexedUnavailableReason.value === 'collection_missing') {
      return '检索索引集合不存在';
    }
    if (indexedUnavailableReason.value === 'query_failed') {
      return '检索索引查询失败';
    }
    return '检索索引暂不可用';
  });

  // 请求序号：切换对象或关闭面板后，旧请求（含分页）的响应一律丢弃，避免覆盖新结果。
  let requestSeq = 0;
  let indexedSeq = 0;

  onBeforeUnmount(() => {
    requestSeq += 1;
    indexedSeq += 1;
  });

  const reset = () => {
    items.value = [];
    total.value = 0;
    page.value = 1;
    accountSharedItems.value = [];
    accountSharedTotal.value = 0;
    error.value = '';
  };

  const resetIndexed = () => {
    indexedItems.value = [];
    indexedTotal.value = 0;
    indexedPageValidCount.value = 0;
    indexedPageInvalidCount.value = 0;
    indexedPage.value = 1;
    indexedError.value = '';
    indexedAvailable.value = true;
    indexedUnavailableReason.value = '';
  };

  const load = async () => {
    if (!props.userId || !props.agentId) {
      reset();
      return;
    }

    requestSeq += 1;
    const seq = requestSeq;
    const targetUserId = props.userId;
    const targetAgentId = props.agentId;
    loading.value = true;
    error.value = '';

    try {
      const { data } = await queryAppUserAgentMemories(
        targetUserId,
        targetAgentId,
        { page: page.value, pageSize: pageSize.value }
      );

      if (seq !== requestSeq) {
        return;
      }

      items.value = data.items;
      total.value = data.total;
      page.value = data.page;
      pageSize.value = data.pageSize;
      accountSharedItems.value = data.accountSharedItems;
      accountSharedTotal.value = data.accountSharedTotal;
    } catch (err) {
      if (seq !== requestSeq) {
        return;
      }
      items.value = [];
      total.value = 0;
      accountSharedItems.value = [];
      accountSharedTotal.value = 0;
      error.value = (err as Error)?.message || '请稍后重试';
    } finally {
      if (seq === requestSeq) {
        loading.value = false;
      }
    }
  };

  const reload = () => {
    page.value = 1;
    load();
  };

  const onPageChange = (current: number) => {
    page.value = current;
    load();
  };

  const onPageSizeChange = (size: number) => {
    pageSize.value = size;
    page.value = 1;
    load();
  };

  const emitLocate = (item: AppUserAgentMemoryItem) => {
    if (!item.sourceMessageId) {
      return;
    }
    emit('locateSource', { messageId: item.sourceMessageId });
  };

  const emitLocateById = (sourceMessageId: string) => {
    if (!sourceMessageId) {
      return;
    }
    emit('locateSource', { messageId: sourceMessageId });
  };

  const loadIndexed = async () => {
    if (!props.userId || !props.agentId) {
      resetIndexed();
      return;
    }

    indexedSeq += 1;
    const seq = indexedSeq;
    const targetUserId = props.userId;
    const targetAgentId = props.agentId;
    indexedLoading.value = true;
    indexedError.value = '';

    try {
      const { data } = await queryAppUserIndexedEvidence(
        targetUserId,
        targetAgentId,
        { page: indexedPage.value, pageSize: indexedPageSize.value }
      );

      if (seq !== indexedSeq) {
        return;
      }

      indexedAvailable.value = data.available;
      indexedUnavailableReason.value = data.unavailableReason;
      indexedItems.value = data.available ? data.items : [];
      indexedTotal.value = data.available ? data.total : 0;
      indexedPageValidCount.value = data.available ? data.pageValidCount : 0;
      indexedPageInvalidCount.value = data.available
        ? data.pageInvalidCount
        : 0;
      indexedPage.value = data.page;
      indexedPageSize.value = data.pageSize;
    } catch (err) {
      if (seq !== indexedSeq) {
        return;
      }
      indexedAvailable.value = false;
      indexedUnavailableReason.value = 'query_failed';
      indexedItems.value = [];
      indexedTotal.value = 0;
      indexedPageValidCount.value = 0;
      indexedPageInvalidCount.value = 0;
      indexedError.value = (err as Error)?.message || '请稍后重试';
    } finally {
      if (seq === indexedSeq) {
        indexedLoading.value = false;
      }
    }
  };

  const reloadIndexed = () => {
    indexedPage.value = 1;
    loadIndexed();
  };

  const onIndexedPageChange = (current: number) => {
    indexedPage.value = current;
    loadIndexed();
  };

  const onIndexedPageSizeChange = (size: number) => {
    indexedPageSize.value = size;
    indexedPage.value = 1;
    loadIndexed();
  };

  watch(
    () => [props.userId, props.agentId],
    () => {
      reset();
      resetIndexed();
      load();
      loadIndexed();
    },
    { immediate: true }
  );

  const TYPE_LABELS: Record<string, string> = {
    identity: '身份',
    relationship: '关系/称呼',
    age: '年龄',
    occupation: '职业',
    family: '家人',
    preference: '偏好',
    correction: '纠正',
    promise: '承诺',
    keepsake: '纪念物',
    grief_trigger: '思念触发',
    safety_signal: '安全信号',
    style: '表达风格',
    memory: '记忆',
    taboo: '忌讳',
  };

  const STATUS_LABELS: Record<string, string> = {
    active: '有效',
    candidate: '候选',
    conflicted: '冲突',
    pending: '待确认',
    rejected: '已拒绝',
    archived: '已归档',
  };

  const RETENTION_LABELS: Record<string, string> = {
    session: '本轮会话',
    durable: '长期留存',
    core: '核心记忆',
  };

  const formatMemoryType = (type: string) =>
    TYPE_LABELS[type] || type || '未知';
  const formatStatus = (status: string) =>
    STATUS_LABELS[status] || status || '-';
  const formatRetention = (retention: string) =>
    RETENTION_LABELS[retention] || retention;

  const statusColor = (status: string) => {
    if (status === 'active') return 'green';
    if (status === 'candidate' || status === 'pending') return 'orange';
    if (status === 'conflicted') return 'red';
    return 'gray';
  };

  const formatDate = (value?: string) => {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '-';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
      date.getDate()
    )} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  };
</script>

<style lang="less" scoped>
  .memory-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;

    &__header {
      flex: 0 0 auto;
      margin-bottom: 8px;
    }

    &__title {
      font-size: 16px;
      font-weight: 600;
      color: var(--color-text-1);
    }

    &__subtitle {
      margin-top: 4px;
      font-size: 12px;
      color: var(--color-text-3);
    }

    &__notice {
      flex: 0 0 auto;
      margin-bottom: 8px;
    }

    &__body {
      flex: 1 1 auto;
      min-height: 0;
      overflow-y: auto;
      padding-right: 4px;
    }

    &__spin {
      display: block;
      width: 100%;
    }

    &__state {
      padding: 24px 0;
    }

    &__state--small {
      padding: 12px 0;
    }

    &__card {
      margin-bottom: 8px;
      border-radius: 6px;
      background: var(--color-fill-1);

      :deep(.arco-card-body) {
        padding: 10px 12px;
      }
    }

    &__card-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 6px;
    }

    &__scope {
      font-size: 12px;
      color: var(--color-text-3);
    }

    &__value {
      font-size: 13px;
      line-height: 1.6;
      color: var(--color-text-1);
      word-break: break-all;
    }

    &__source-text {
      margin-top: 4px;
      font-size: 12px;
      line-height: 1.6;
      color: var(--color-text-2);
      word-break: break-all;
    }

    &__meta {
      display: flex;
      flex-wrap: wrap;
      gap: 4px 12px;
      margin-top: 6px;
      font-size: 12px;
      color: var(--color-text-3);
    }

    &__source {
      margin-top: 6px;
      font-size: 12px;
    }

    &__source-missing {
      color: var(--color-text-3);
    }

    &__pagination {
      display: flex;
      justify-content: flex-end;
      padding: 4px 0 12px;
    }

    &__indexed {
      margin-top: 8px;
      border-top: 1px dashed var(--color-border-2);
      padding-top: 8px;
    }

    &__indexed-note {
      margin: 0 0 8px;
      font-size: 12px;
      line-height: 1.6;
      color: var(--color-text-3);
    }

    &__indexed-count {
      margin: 0 0 8px;
      font-size: 12px;
      color: var(--color-text-3);
    }

    &__shared {
      margin-top: 8px;
      border-top: 1px dashed var(--color-border-2);
      padding-top: 8px;
    }

    &__divider {
      margin: 4px 0 12px;
    }

    &__shared-item {
      margin-bottom: 8px;
      padding: 8px 12px;
      border-radius: 6px;
      background: var(--color-fill-1);
    }

    &__shared-value {
      margin-top: 4px;
      font-size: 13px;
      color: var(--color-text-1);
      word-break: break-all;
    }
  }
</style>
