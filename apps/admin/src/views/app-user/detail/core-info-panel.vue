<template>
  <div class="core-info-panel">
    <div class="core-info-panel__header">
      <div class="core-info-panel__title">核心信息</div>
      <div class="core-info-panel__subtitle">
        当前角色「{{
          agentName || '当前聊天对象'
        }}」的核心设定：当前采用值、来源与未采用原因
      </div>
    </div>

    <a-alert type="info" :show-icon="false" class="core-info-panel__notice">
      只读视图。选择规则与主聊天共用 @tzl/shared
      的来源优先级；这里不展示模型密钥、完整提示词或模型内部推理，也不读取其它用户的共享角色。
    </a-alert>

    <div class="core-info-panel__body">
      <a-spin :loading="loading" class="core-info-panel__spin">
        <a-result
          v-if="error"
          status="error"
          title="核心信息加载失败"
          :subtitle="error"
          class="core-info-panel__state"
        >
          <template #extra>
            <a-button size="small" @click="load">重试</a-button>
          </template>
        </a-result>

        <template v-else>
          <!-- 称呼 -->
          <section class="core-info-panel__section">
            <a-divider orientation="left">称呼</a-divider>
            <a-empty
              v-if="!addressEntries.length"
              description="暂无称呼信息"
              class="core-info-panel__state core-info-panel__state--small"
            />
            <div v-else class="core-info-panel__list">
              <a-card
                v-for="row in addressEntries"
                :key="row.label"
                class="core-info-panel__card"
                :bordered="false"
                size="small"
              >
                <div class="core-info-panel__card-head">
                  <span class="core-info-panel__label">{{ row.label }}</span>
                  <a-space size="mini" wrap>
                    <a-tag :color="statusColor(row.entry.status)" size="small">
                      {{ statusLabel(row.entry.status) }}
                    </a-tag>
                    <a-tag v-if="row.entry.source" size="small">
                      {{ row.entry.source.label }}
                    </a-tag>
                  </a-space>
                </div>
                <div class="core-info-panel__value">
                  {{ row.entry.value || '-' }}
                </div>
                <div class="core-info-panel__meta">
                  <span>主体：{{ row.entry.subject || '-' }}</span>
                  <span v-if="row.entry.source?.field">
                    字段：{{ row.entry.source.field }}
                  </span>
                  <span v-if="row.entry.updatedAt">
                    更新时间：{{ formatDate(row.entry.updatedAt) }}
                  </span>
                </div>
                <div class="core-info-panel__reason">
                  采用理由：{{ row.entry.reason || '-' }}
                </div>
                <div
                  v-if="row.entry.source?.messageId"
                  class="core-info-panel__source"
                >
                  <a-link @click="emitLocate(row.entry.source.messageId)">
                    定位左侧原话
                  </a-link>
                </div>
                <div
                  v-else-if="row.entry.source?.kind === 'import_style'"
                  class="core-info-panel__source core-info-panel__source-missing"
                >
                  来源为导入批次，无单条消息可定位
                </div>
              </a-card>
            </div>
            <div v-if="addressAliases.length" class="core-info-panel__aliases">
              <div
                v-for="alias in addressAliases"
                :key="alias.label"
                class="core-info-panel__meta"
              >
                {{ alias.label }}：{{ alias.values.join('、') || '无' }}
              </div>
            </div>
            <div class="core-info-panel__note">{{ data?.addresses.note }}</div>
          </section>

          <!-- 未采用候选 -->
          <section
            v-if="addressCandidates.length"
            class="core-info-panel__section"
          >
            <a-divider orientation="left">未采用的称呼候选项</a-divider>
            <div class="core-info-panel__list">
              <div
                v-for="(candidate, index) in addressCandidates"
                :key="`${candidate.subject}-${index}`"
                class="core-info-panel__candidate"
              >
                <a-space size="mini" wrap>
                  <a-tag :color="statusColor(candidate.status)" size="small">
                    {{ statusLabel(candidate.status) }}
                  </a-tag>
                  <span class="core-info-panel__label">
                    {{ candidate.subject }}：{{ candidate.value || '-' }}
                  </span>
                </a-space>
                <div class="core-info-panel__reason">
                  <a-tag
                    v-if="isSynthesizedReason(candidate.reason)"
                    size="small"
                    color="orange"
                  >
                    合成原因
                  </a-tag>
                  <a-tag
                    v-else-if="candidate.reason"
                    size="small"
                    color="green"
                  >
                    库中真实原因
                  </a-tag>
                  {{ stripSynthesizedPrefix(candidate.reason) || '-' }}
                </div>
              </div>
            </div>
          </section>

          <!-- 日期 -->
          <section class="core-info-panel__section">
            <a-divider orientation="left">日期</a-divider>
            <a-empty
              v-if="!data?.dates.items.length"
              description="暂无时间断言"
              class="core-info-panel__state core-info-panel__state--small"
            />
            <div v-else class="core-info-panel__list">
              <a-card
                v-for="(item, index) in data?.dates.items"
                :key="`${item.subjectType}-${item.subjectId}-${item.eventType}-${index}`"
                class="core-info-panel__card"
                :bordered="false"
                size="small"
              >
                <div class="core-info-panel__card-head">
                  <span class="core-info-panel__label">
                    {{ item.subjectLabel }} · {{ item.eventLabel }}
                  </span>
                  <a-tag :color="statusColor(item.status)" size="small">
                    {{ statusLabel(item.status) }}
                  </a-tag>
                </div>
                <div class="core-info-panel__value">
                  {{
                    item.monthDay
                      ? item.year
                        ? `${item.year}-${item.monthDay}`
                        : item.monthDay
                      : item.exactDate || '未解析出日期'
                  }}
                </div>
                <div class="core-info-panel__meta">
                  <span>历法：{{ item.calendar || '未知' }}</span>
                  <span>精度：{{ item.precision || '未知' }}</span>
                  <span>解析：{{ item.resolutionCertainty || '未知' }}</span>
                  <span>
                    冲突：{{
                      item.conflictStatus === 'conflicted' ? '有冲突' : '无'
                    }}
                  </span>
                </div>
                <div class="core-info-panel__reason">{{ item.reason }}</div>
                <div v-if="item.note" class="core-info-panel__note--inline">
                  {{ item.note }}
                </div>
                <div
                  v-if="item.source?.messageId"
                  class="core-info-panel__source"
                >
                  <a-link @click="emitLocate(item.source.messageId)">
                    定位左侧原话
                  </a-link>
                </div>
                <div
                  v-else
                  class="core-info-panel__source core-info-panel__source-missing"
                >
                  历史提取，证据不完整（无来源消息）
                </div>
              </a-card>
            </div>
            <div
              v-if="data?.dates.projections.length"
              class="core-info-panel__projections"
            >
              <div
                v-for="projection in data?.dates.projections"
                :key="projection.field"
                class="core-info-panel__projection"
              >
                <div class="core-info-panel__label">
                  {{ projection.label }}
                </div>
                <div class="core-info-panel__value">{{ projection.value }}</div>
                <div class="core-info-panel__note--inline">
                  {{ projection.note }}
                </div>
              </div>
            </div>
            <div class="core-info-panel__note">{{ data?.dates.note }}</div>
          </section>

          <!-- 语言 -->
          <section class="core-info-panel__section">
            <a-divider orientation="left">语言与口吻</a-divider>
            <div
              v-if="data?.language.hometown"
              class="core-info-panel__card core-info-panel__card--plain"
            >
              <div class="core-info-panel__label">籍贯事实</div>
              <div class="core-info-panel__value">
                {{ data?.language.hometown?.value }}
              </div>
              <div class="core-info-panel__meta">
                <span>省级：{{ data?.language.hometown?.province }}</span>
                <span v-if="data?.language.hometown?.source">
                  来源：{{ data?.language.hometown?.source?.label }}
                </span>
              </div>
              <div
                v-if="data?.language.hometown?.source?.messageId"
                class="core-info-panel__source"
              >
                <a-link
                  @click="
                    emitLocate(data?.language.hometown?.source?.messageId || '')
                  "
                >
                  定位左侧原话
                </a-link>
              </div>
            </div>

            <div class="core-info-panel__card core-info-panel__card--plain">
              <div class="core-info-panel__label">当前实际采用的语言设定</div>
              <div class="core-info-panel__value">
                {{ data?.language.adopted?.value || '无（不足以生成）' }}
              </div>
              <div class="core-info-panel__meta">
                <span v-if="data?.language.adopted?.source">
                  来源类别：{{ data?.language.adopted?.source?.label }}
                </span>
                <span v-if="derivedFromText"
                  >派生自：{{ derivedFromText }}</span
                >
              </div>
              <div class="core-info-panel__reason">
                采用理由：{{ data?.language.adopted?.reason || '-' }}
              </div>
              <div
                v-if="data?.language.adopted?.source?.messageId"
                class="core-info-panel__source"
              >
                <a-link
                  @click="
                    emitLocate(data?.language.adopted?.source?.messageId || '')
                  "
                >
                  定位左侧原话
                </a-link>
              </div>
            </div>

            <div
              v-for="(setting, index) in data?.language.superseded"
              :key="`superseded-${index}`"
              class="core-info-panel__candidate"
            >
              <a-space size="mini" wrap>
                <a-tag color="gray" size="small">被覆盖</a-tag>
                <span class="core-info-panel__label">{{ setting.value }}</span>
              </a-space>
              <div class="core-info-panel__reason">{{ setting.reason }}</div>
            </div>

            <div
              v-if="data?.language.explicitPreference"
              class="core-info-panel__card core-info-panel__card--plain"
            >
              <div class="core-info-panel__label">用户明确偏好（事实通道）</div>
              <div class="core-info-panel__value">
                {{ data?.language.explicitPreference?.value }}
              </div>
              <div class="core-info-panel__reason">
                {{ data?.language.explicitPreference?.reason }}
              </div>
            </div>

            <div
              v-if="data?.language.profileLanguageHabits"
              class="core-info-panel__note--inline"
            >
              资料字段 languageHabits（当前不进主聊天提示）：
              {{ data?.language.profileLanguageHabits }}
            </div>

            <div
              v-if="data?.language.importDimensions.length"
              class="core-info-panel__imports"
            >
              <div class="core-info-panel__label"
                >导入七维（逐维批次来源与置信）</div
              >
              <div
                v-for="dimension in data?.language.importDimensions"
                :key="dimension.key"
                class="core-info-panel__dimension"
              >
                <span class="core-info-panel__dimension-label">
                  {{ dimension.label }}
                </span>
                <span class="core-info-panel__dimension-value">
                  {{ dimension.value }}
                </span>
                <span class="core-info-panel__dimension-meta">
                  批次 {{ dimension.batchId || '未知' }} · 置信
                  {{
                    dimension.confidence === null
                      ? '未知'
                      : dimension.confidence
                  }}
                </span>
              </div>
            </div>

            <div
              v-for="(note, index) in data?.language.notes"
              :key="`lang-note-${index}`"
              class="core-info-panel__note"
            >
              {{ note }}
            </div>
          </section>

          <!-- 性格 -->
          <section class="core-info-panel__section">
            <a-divider orientation="left">性格</a-divider>
            <a-empty
              v-if="!data?.personality.traits.length"
              description="暂无性格信息"
              class="core-info-panel__state core-info-panel__state--small"
            />
            <div v-else class="core-info-panel__list">
              <div
                v-for="(trait, index) in data?.personality.traits"
                :key="`trait-${index}`"
                class="core-info-panel__candidate"
              >
                <div class="core-info-panel__value">{{ trait.value }}</div>
                <div v-if="trait.source" class="core-info-panel__meta">
                  来源：{{ trait.source.label }}
                  <span v-if="trait.source.field">
                    （{{ trait.source.field }}）
                  </span>
                </div>
              </div>
            </div>
            <div class="core-info-panel__note">
              {{ data?.personality.note }}
            </div>
          </section>

          <!-- 核心家人 -->
          <section class="core-info-panel__section">
            <a-divider orientation="left">核心家人状态</a-divider>
            <a-empty
              v-if="!data?.family.items.length"
              description="暂无家人事实"
              class="core-info-panel__state core-info-panel__state--small"
            />
            <div v-else class="core-info-panel__list">
              <a-card
                v-for="(item, index) in data?.family.items"
                :key="`${item.key}-${index}`"
                class="core-info-panel__card"
                :bordered="false"
                size="small"
              >
                <div class="core-info-panel__card-head">
                  <span class="core-info-panel__label">
                    {{ item.personLabel }}
                  </span>
                  <a-space size="mini" wrap>
                    <a-tag :color="statusColor(item.entryStatus)" size="small">
                      {{ statusLabel(item.entryStatus) }}
                    </a-tag>
                    <a-tag
                      :color="item.stability === 'stable' ? 'green' : 'orange'"
                      size="small"
                    >
                      {{ item.stabilityLabel }}
                    </a-tag>
                  </a-space>
                </div>
                <div class="core-info-panel__value">{{ item.value }}</div>
                <div class="core-info-panel__meta">
                  <span>事实范围：{{ item.key }}</span>
                  <span>获知时间：{{ formatDate(item.learnedAt) }}</span>
                  <span>更新时间：{{ formatDate(item.updatedAt) }}</span>
                </div>
                <div class="core-info-panel__reason">
                  <a-tag
                    v-if="isSynthesizedReason(item.reason)"
                    size="small"
                    color="orange"
                  >
                    合成原因
                  </a-tag>
                  <a-tag v-else-if="item.reason" size="small" color="green">
                    库中真实原因
                  </a-tag>
                  {{ stripSynthesizedPrefix(item.reason) || '-' }}
                </div>
                <div
                  v-if="item.source?.messageId"
                  class="core-info-panel__source"
                >
                  <a-link @click="emitLocate(item.source.messageId)">
                    定位左侧原话
                  </a-link>
                </div>
                <div
                  v-else
                  class="core-info-panel__source core-info-panel__source-missing"
                >
                  历史提取，证据不完整（无来源消息）
                </div>
              </a-card>
            </div>
            <div class="core-info-panel__note">{{ data?.family.note }}</div>
          </section>

          <!-- 数据缺口说明 -->
          <section class="core-info-panel__section">
            <a-divider orientation="left">数据缺口与合成说明</a-divider>
            <ul class="core-info-panel__limitations">
              <li v-for="(item, index) in data?.limitations" :key="index">
                {{ item }}
              </li>
            </ul>
          </section>
        </template>
      </a-spin>
    </div>
  </div>
</template>

<script lang="ts" setup>
  import { computed, onBeforeUnmount, ref, watch } from 'vue';
  import {
    AppUserAgentCoreInfoRes,
    CoreEntryView,
    queryAppUserAgentCoreInfo,
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
  const data = ref<AppUserAgentCoreInfoRes | null>(null);

  let requestSeq = 0;

  onBeforeUnmount(() => {
    requestSeq += 1;
  });

  const load = async () => {
    if (!props.userId || !props.agentId) {
      data.value = null;
      error.value = '';
      return;
    }

    requestSeq += 1;
    const seq = requestSeq;
    const targetUserId = props.userId;
    const targetAgentId = props.agentId;
    loading.value = true;
    error.value = '';

    try {
      const { data: result } = await queryAppUserAgentCoreInfo(
        targetUserId,
        targetAgentId
      );
      if (seq !== requestSeq) {
        return;
      }
      data.value = result;
    } catch (err) {
      if (seq !== requestSeq) {
        return;
      }
      data.value = null;
      error.value = (err as Error)?.message || '请稍后重试';
    } finally {
      if (seq === requestSeq) {
        loading.value = false;
      }
    }
  };

  watch(
    () => [props.userId, props.agentId],
    () => {
      data.value = null;
      load();
    },
    { immediate: true }
  );

  const addressEntries = computed<
    Array<{ label: string; entry: CoreEntryView }>
  >(() => {
    const section = data.value?.addresses;
    if (!section) return [];
    const rows: Array<{ label: string; entry: CoreEntryView }> = [];
    if (section.userCallsAgent) {
      rows.push({ label: '用户称呼角色', entry: section.userCallsAgent });
    }
    if (section.agentCallsUser) {
      rows.push({ label: '角色称呼用户', entry: section.agentCallsUser });
    }
    return rows;
  });

  const addressAliases = computed(() => {
    const section = data.value?.addresses;
    if (!section) return [];
    return [
      { label: '角色别称', values: section.agentAliases },
      { label: '用户别称', values: section.userAliases },
    ].filter((item) => item.values.length);
  });

  const addressCandidates = computed(() =>
    (data.value?.addresses.candidates || []).filter(
      (item) => item.status !== 'adopted'
    )
  );

  const derivedFromText = computed(() => {
    const derived = data.value?.language.adopted?.derivedFrom;
    if (!derived) return '';
    const parts = [derived.label];
    if (derived.messageId) parts.push(`来源消息 ${derived.messageId}`);
    return parts.join('，');
  });

  const emitLocate = (messageId: string) => {
    if (!messageId) return;
    emit('locateSource', { messageId });
  };

  const statusLabel = (status: string) => {
    if (status === 'adopted') return '当前采用';
    if (status === 'pending') return '待定';
    if (status === 'rejected') return '未采用';
    return status || '-';
  };

  const statusColor = (status: string) => {
    if (status === 'adopted') return 'green';
    if (status === 'pending') return 'orange';
    if (status === 'rejected') return 'gray';
    return 'gray';
  };

  // 与后端 admin-app-user-core-info.ts 的 SYNTHESIZED_REASON_PREFIX 保持一致：
  // 只有旧数据没有 governance.reason 时才合成，合成原因带此前缀。
  const SYNTHESIZED_REASON_PREFIX = '【合成】';

  const isSynthesizedReason = (reason?: string) =>
    (reason || '').startsWith(SYNTHESIZED_REASON_PREFIX);

  const stripSynthesizedPrefix = (reason?: string) =>
    isSynthesizedReason(reason)
      ? (reason || '').slice(SYNTHESIZED_REASON_PREFIX.length)
      : reason || '';

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
  .core-info-panel {
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

    &__section {
      margin-bottom: 8px;
    }

    &__list {
      display: flex;
      flex-direction: column;
    }

    &__card {
      margin-bottom: 8px;
      border-radius: 6px;
      background: var(--color-fill-1);

      :deep(.arco-card-body) {
        padding: 10px 12px;
      }
    }

    &__card--plain {
      padding: 10px 12px;
    }

    &__card-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin-bottom: 6px;
    }

    &__label {
      font-size: 12px;
      font-weight: 600;
      color: var(--color-text-2);
    }

    &__value {
      font-size: 13px;
      line-height: 1.6;
      color: var(--color-text-1);
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

    &__reason {
      margin-top: 6px;
      font-size: 12px;
      line-height: 1.6;
      color: var(--color-text-2);
    }

    &__note {
      margin-top: 4px;
      font-size: 12px;
      line-height: 1.6;
      color: var(--color-text-3);
    }

    &__note--inline {
      margin-top: 6px;
      font-size: 12px;
      line-height: 1.6;
      color: var(--color-text-3);
    }

    &__source {
      margin-top: 6px;
      font-size: 12px;
    }

    &__source-missing {
      color: var(--color-text-3);
    }

    &__aliases {
      margin-top: 4px;
    }

    &__candidate {
      margin-bottom: 6px;
      padding: 8px 12px;
      border-radius: 6px;
      background: var(--color-fill-1);
    }

    &__projections {
      margin-top: 4px;
    }

    &__projection {
      margin-bottom: 6px;
      padding: 8px 12px;
      border-radius: 6px;
      border: 1px dashed var(--color-border-2);
    }

    &__imports {
      margin-top: 8px;
    }

    &__dimension {
      display: flex;
      flex-direction: column;
      gap: 2px;
      padding: 6px 0;
      border-bottom: 1px dashed var(--color-border-2);
    }

    &__dimension-label {
      font-size: 12px;
      font-weight: 600;
      color: var(--color-text-2);
    }

    &__dimension-value {
      font-size: 13px;
      color: var(--color-text-1);
      word-break: break-all;
    }

    &__dimension-meta {
      font-size: 12px;
      color: var(--color-text-3);
    }

    &__limitations {
      margin: 0;
      padding-left: 18px;
      font-size: 12px;
      line-height: 1.7;
      color: var(--color-text-3);
    }
  }
</style>
