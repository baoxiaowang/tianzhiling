<template>
  <div class="voice-timbre-page">
    <a-card class="voice-timbre-page__card" :bordered="false">
      <template #title>音色管理</template>
      <template #extra>
        <a-button type="primary" @click="openCreate">
          <template #icon>
            <icon-plus />
          </template>
          新建音色
        </a-button>
      </template>

      <a-form
        :model="searchForm"
        layout="inline"
        class="voice-timbre-page__search"
      >
        <a-form-item field="keyword" label="关键词">
          <a-input
            v-model="searchForm.keyword"
            allow-clear
            placeholder="搜索名称、音色ID或备注"
            @press-enter="handleSearch"
          />
        </a-form-item>
        <a-form-item field="provider" label="服务商">
          <a-select
            v-model="searchForm.provider"
            allow-clear
            placeholder="全部"
            class="voice-timbre-page__filter"
          >
            <a-option value="minimax">MiniMax</a-option>
            <a-option value="qwen">千问</a-option>
            <a-option value="doubao">豆包</a-option>
          </a-select>
        </a-form-item>
        <a-form-item field="status" label="状态">
          <a-select
            v-model="searchForm.status"
            allow-clear
            placeholder="全部"
            class="voice-timbre-page__filter"
          >
            <a-option value="creating">创建中</a-option>
            <a-option value="active">启用</a-option>
            <a-option value="failed">失败</a-option>
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
        :scroll="{ x: 1870 }"
      >
        <template #empty>
          <a-empty :description="emptyDescription">
            <a-button v-if="hasSearch" type="text" @click="resetSearch">
              清空筛选
            </a-button>
          </a-empty>
        </template>
        <template #columns>
          <a-table-column title="音色名称" data-index="name" :width="220">
            <template #cell="{ record }">
              <div class="voice-timbre-page__identity">
                <div class="voice-timbre-page__name">{{ record.name }}</div>
                <a-tooltip :content="record.id">
                  <a-typography-text class="voice-timbre-page__id" copyable>
                    {{ record.id }}
                  </a-typography-text>
                </a-tooltip>
              </div>
            </template>
          </a-table-column>
          <a-table-column title="服务商" data-index="provider" :width="110">
            <template #cell="{ record }">
              <a-tag>{{ formatProvider(record.provider) }}</a-tag>
            </template>
          </a-table-column>
          <a-table-column
            title="服务商音色ID"
            data-index="providerVoiceId"
            :width="240"
          >
            <template #cell="{ record }">
              <a-typography-text copyable>
                {{ record.providerVoiceId || '-' }}
              </a-typography-text>
            </template>
          </a-table-column>
          <a-table-column
            title="复刻语言"
            data-index="cloneLanguage"
            :width="120"
          />
          <a-table-column title="输出参数" :width="220">
            <template #cell="{ record }">
              <div class="voice-timbre-page__speech-params">
                <span>速度：{{ formatSpeechNumber(record.speechSpeed) }}</span>
                <span>音量：{{ formatSpeechNumber(record.speechVolume) }}</span>
                <span>音调：{{ formatSpeechNumber(record.speechPitch) }}</span>
              </div>
            </template>
          </a-table-column>
          <a-table-column title="状态" data-index="status" :width="110">
            <template #cell="{ record }">
              <a-tooltip
                v-if="record.errorMessage"
                :content="record.errorMessage"
              >
                <a-tag :color="getStatusColor(record.status)">
                  {{ formatStatus(record.status) }}
                </a-tag>
              </a-tooltip>
              <a-tag v-else :color="getStatusColor(record.status)">
                {{ formatStatus(record.status) }}
              </a-tag>
            </template>
          </a-table-column>
          <a-table-column title="原始文件" :width="260">
            <template #cell="{ record }">
              <audio
                v-if="record.audioUrl"
                controls
                :src="record.audioUrl"
                class="voice-timbre-page__audio"
              />
              <span v-else>-</span>
            </template>
          </a-table-column>
          <a-table-column title="试听" :width="260">
            <template #cell="{ record }">
              <audio
                v-if="record.previewAudioUrl"
                controls
                :src="record.previewAudioUrl"
                class="voice-timbre-page__audio"
              />
              <span v-else>-</span>
            </template>
          </a-table-column>
          <a-table-column title="更新时间" data-index="updatedAt" :width="180">
            <template #cell="{ record }">
              {{ formatDate(record.updatedAt) }}
            </template>
          </a-table-column>
          <a-table-column title="操作" :width="150" fixed="right">
            <template #cell="{ record }">
              <a-space :size="4">
                <a-button type="text" size="small" @click="openEdit(record)">
                  编辑
                </a-button>
                <a-button
                  v-if="record.status === 'failed'"
                  type="text"
                  size="small"
                  status="warning"
                  :loading="isRetrying(record.id)"
                  @click="handleRetry(record)"
                >
                  重试
                </a-button>
              </a-space>
            </template>
          </a-table-column>
        </template>
      </a-table>

      <div class="voice-timbre-page__pagination">
        <span class="voice-timbre-page__total">
          共 {{ pagination.total }} 个音色
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
        <a-form-item
          field="name"
          label="音色名称"
          :rules="[
            { required: true, message: '请输入音色名称' },
            { maxLength: 60, message: '音色名称不能超过 60 个字符' },
          ]"
        >
          <a-input
            v-model="editForm.name"
            allow-clear
            :max-length="60"
            show-word-limit
            placeholder="例如：温柔女声"
          />
        </a-form-item>

        <a-grid v-if="!editingRecord" :cols="2" :col-gap="16">
          <a-grid-item>
            <a-form-item
              field="provider"
              label="服务商"
              :rules="[{ required: true, message: '请选择服务商' }]"
            >
              <a-select v-model="editForm.provider" placeholder="请选择服务商">
                <a-option value="minimax">MiniMax</a-option>
                <a-option value="qwen" disabled>千问（未接入）</a-option>
                <a-option value="doubao" disabled>豆包（未接入）</a-option>
              </a-select>
            </a-form-item>
          </a-grid-item>
          <a-grid-item>
            <a-form-item field="cloneLanguage" label="复刻语言">
              <a-select
                v-model="editForm.cloneLanguage"
                placeholder="请选择语言"
              >
                <a-option value="Chinese">普通话</a-option>
                <a-option value="Chinese,Yue">粤语</a-option>
                <a-option value="English">英语</a-option>
                <a-option value="auto">自动识别</a-option>
              </a-select>
            </a-form-item>
          </a-grid-item>
        </a-grid>

        <a-form-item
          v-if="!editingRecord"
          field="providerVoiceId"
          label="服务商音色ID"
        >
          <a-input
            v-model="editForm.providerVoiceId"
            allow-clear
            :max-length="256"
            placeholder="不填则后端自动生成，需以英文字母开头"
          />
        </a-form-item>

        <a-form-item v-if="!editingRecord" label="复刻音频" required>
          <div class="voice-timbre-page__upload">
            <input
              ref="fileInputRef"
              type="file"
              accept=".mp3,.m4a,.wav,.mp4,audio/mpeg,audio/mp4,audio/wav,video/mp4"
              @change="onAudioFileChange"
            />
            <a-typography-text type="secondary">
              支持 mp3、m4a、wav、mp4；音频最大 20MB，mp4 最大 200MB，建议时长
              10 秒到 5 分钟
            </a-typography-text>
            <a-link
              v-if="editForm.audioUrl"
              :href="editForm.audioUrl"
              target="_blank"
            >
              查看已上传音频
            </a-link>
          </div>
        </a-form-item>

        <a-form-item
          field="previewText"
          label="预览文本"
          :rules="[
            { maxLength: 1000, message: '预览文本不能超过 1000 个字符' },
          ]"
        >
          <a-textarea
            v-model="editForm.previewText"
            allow-clear
            :max-length="1000"
            show-word-limit
            :auto-size="{ minRows: 3, maxRows: 5 }"
            placeholder="创建时填写可生成试听音频"
          />
        </a-form-item>

        <div class="voice-timbre-page__speech-settings">
          <div class="voice-timbre-page__section-title">输出层调节</div>
          <a-grid :cols="1" :row-gap="14">
            <a-grid-item>
              <a-form-item field="speechSpeed" label="语速">
                <div class="voice-timbre-page__slider-row">
                  <a-slider
                    v-model="editForm.speechSpeed"
                    :min="0.5"
                    :max="2"
                    :step="0.01"
                  />
                  <a-input-number
                    v-model="editForm.speechSpeed"
                    :min="0.5"
                    :max="2"
                    :step="0.01"
                    :precision="2"
                    hide-button
                    class="voice-timbre-page__number"
                  />
                </div>
              </a-form-item>
            </a-grid-item>
            <a-grid-item>
              <a-form-item field="speechVolume" label="音量">
                <div class="voice-timbre-page__slider-row">
                  <a-slider
                    v-model="editForm.speechVolume"
                    :min="0"
                    :max="10"
                    :step="0.01"
                  />
                  <a-input-number
                    v-model="editForm.speechVolume"
                    :min="0"
                    :max="10"
                    :step="0.01"
                    :precision="2"
                    hide-button
                    class="voice-timbre-page__number"
                  />
                </div>
              </a-form-item>
            </a-grid-item>
            <a-grid-item>
              <a-form-item field="speechPitch" label="音调">
                <div class="voice-timbre-page__slider-row">
                  <a-slider
                    v-model="editForm.speechPitch"
                    :min="-12"
                    :max="12"
                    :step="0.01"
                  />
                  <a-input-number
                    v-model="editForm.speechPitch"
                    :min="-12"
                    :max="12"
                    :step="0.01"
                    :precision="2"
                    hide-button
                    class="voice-timbre-page__number"
                  />
                </div>
              </a-form-item>
            </a-grid-item>
          </a-grid>
        </div>

        <a-form-item
          v-if="editingRecord"
          field="status"
          label="状态"
          :rules="[{ required: true, message: '请选择状态' }]"
        >
          <a-radio-group v-model="editForm.status" type="button">
            <a-radio value="active">启用</a-radio>
            <a-radio value="disabled">停用</a-radio>
          </a-radio-group>
        </a-form-item>

        <a-form-item
          field="remark"
          label="备注"
          :rules="[{ maxLength: 1000, message: '备注不能超过 1000 个字符' }]"
        >
          <a-textarea
            v-model="editForm.remark"
            allow-clear
            :max-length="1000"
            show-word-limit
            :auto-size="{ minRows: 2, maxRows: 4 }"
            placeholder="用于后台记录"
          />
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<script lang="ts" setup>
  import { computed, reactive, ref } from 'vue';
  import dayjs from 'dayjs';
  import { Message } from '@arco-design/web-vue';
  import type { FormInstance } from '@arco-design/web-vue/es/form';
  import type {
    VoiceTimbreProviderDTO,
    VoiceTimbreStatusDTO,
  } from '@tzl/shared';
  import useLoading from '@/hooks/loading';
  import uploadAdminFile from '@/api/storage';
  import {
    createVoiceTimbre,
    queryVoiceTimbreList,
    retryVoiceTimbre,
    updateVoiceTimbre,
    VoiceTimbreRecord,
  } from '@/api/voice-model';

  const { loading, setLoading } = useLoading();
  const renderList = ref<VoiceTimbreRecord[]>([]);
  const editVisible = ref(false);
  const saving = ref(false);
  const retryingIds = ref<Set<string>>(new Set());
  const editingRecord = ref<VoiceTimbreRecord>();
  const editFormRef = ref<FormInstance>();
  const fileInputRef = ref<HTMLInputElement>();
  const selectedAudioFile = ref<File>();
  const searchForm = reactive<{
    keyword: string;
    provider?: VoiceTimbreProviderDTO;
    status?: VoiceTimbreStatusDTO;
  }>({
    keyword: '',
    provider: undefined,
    status: undefined,
  });
  const editForm = reactive({
    name: '',
    provider: 'minimax' as VoiceTimbreProviderDTO,
    audioObjectKey: '',
    audioUrl: '',
    cloneLanguage: 'Chinese',
    providerVoiceId: '',
    previewText: '',
    speechSpeed: 1,
    speechVolume: 1,
    speechPitch: 0,
    status: 'active' as Extract<VoiceTimbreStatusDTO, 'active' | 'disabled'>,
    remark: '',
  });
  const pagination = reactive({
    current: 1,
    pageSize: 20,
    total: 0,
  });

  const requestParams = computed(() => ({
    keyword: searchForm.keyword.trim() || undefined,
    provider: searchForm.provider,
    status: searchForm.status,
    page: pagination.current,
    pageSize: pagination.pageSize,
  }));
  const hasSearch = computed(
    () =>
      Boolean(searchForm.keyword.trim()) ||
      Boolean(searchForm.provider) ||
      Boolean(searchForm.status)
  );
  const emptyDescription = computed(() =>
    hasSearch.value ? '未找到匹配音色' : '暂无音色'
  );
  const editModalTitle = computed(() =>
    editingRecord.value ? `编辑音色：${editingRecord.value.name}` : '新建音色'
  );

  const fetchData = async () => {
    try {
      setLoading(true);
      const { data } = await queryVoiceTimbreList(requestParams.value);
      renderList.value = data.items;
      pagination.total = data.total;
      pagination.current = data.page;
      pagination.pageSize = data.pageSize;
    } catch (error) {
      Message.error('音色列表加载失败');
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = () => {
    pagination.current = 1;
    fetchData();
  };

  const resetSearch = () => {
    searchForm.keyword = '';
    searchForm.provider = undefined;
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
    resetEditForm();
    editVisible.value = true;
  };

  const openEdit = (record: VoiceTimbreRecord) => {
    editingRecord.value = record;
    editForm.name = record.name;
    editForm.provider = record.provider;
    editForm.audioObjectKey = record.audioObjectKey;
    editForm.audioUrl = record.audioUrl;
    editForm.cloneLanguage = record.cloneLanguage || 'Chinese';
    editForm.providerVoiceId = record.providerVoiceId;
    editForm.previewText = record.previewText;
    editForm.speechSpeed = normalizeSpeechFormValue(record.speechSpeed, 1);
    editForm.speechVolume = normalizeSpeechFormValue(record.speechVolume, 1);
    editForm.speechPitch = normalizeSpeechFormValue(record.speechPitch, 0);
    editForm.status = record.status === 'disabled' ? 'disabled' : 'active';
    editForm.remark = record.remark;
    editVisible.value = true;
  };

  const closeEdit = () => {
    editVisible.value = false;
    resetEditForm();
    editFormRef.value?.clearValidate();
  };

  const resetEditForm = () => {
    editingRecord.value = undefined;
    selectedAudioFile.value = undefined;
    editForm.name = '';
    editForm.provider = 'minimax';
    editForm.audioObjectKey = '';
    editForm.audioUrl = '';
    editForm.cloneLanguage = 'Chinese';
    editForm.providerVoiceId = '';
    editForm.previewText = '';
    editForm.speechSpeed = 1;
    editForm.speechVolume = 1;
    editForm.speechPitch = 0;
    editForm.status = 'active';
    editForm.remark = '';

    if (fileInputRef.value) {
      fileInputRef.value.value = '';
    }
  };

  const onAudioFileChange = (event: Event) => {
    const file = (event.target as HTMLInputElement).files?.[0];

    if (!file) {
      selectedAudioFile.value = undefined;
      return;
    }

    if (!isValidAudioFile(file)) {
      Message.error('请上传 mp3、m4a、wav 或 mp4 文件');
      selectedAudioFile.value = undefined;
      return;
    }

    if (file.size > getMediaMaxSize(file)) {
      Message.error(
        isMp4File(file) ? 'mp4 文件不能超过 200MB' : '音频文件不能超过 20MB'
      );
      selectedAudioFile.value = undefined;
      return;
    }

    selectedAudioFile.value = file;
  };

  const submitEdit = async () => {
    const errors = await editFormRef.value?.validate();

    if (errors) {
      return false;
    }

    if (!editingRecord.value && !selectedAudioFile.value) {
      Message.error('请上传复刻音频');
      return false;
    }

    try {
      saving.value = true;

      if (editingRecord.value) {
        await updateVoiceTimbre(editingRecord.value.id, {
          name: editForm.name,
          status: editForm.status,
          previewText: editForm.previewText,
          speechSpeed: editForm.speechSpeed,
          speechVolume: editForm.speechVolume,
          speechPitch: editForm.speechPitch,
          remark: editForm.remark,
        });
        Message.success('音色已更新');
      } else {
        const uploaded = await uploadAdminFile(
          selectedAudioFile.value as File,
          {
            folder: 'voice-timbres',
          }
        );
        await createVoiceTimbre({
          name: editForm.name,
          provider: editForm.provider,
          audioObjectKey: uploaded.objectKey,
          audioUrl: uploaded.publicUrl,
          cloneLanguage: editForm.cloneLanguage,
          providerVoiceId: editForm.providerVoiceId || undefined,
          previewText: editForm.previewText,
          speechSpeed: editForm.speechSpeed,
          speechVolume: editForm.speechVolume,
          speechPitch: editForm.speechPitch,
          remark: editForm.remark,
        });
        Message.success('音色创建任务已提交');
      }

      closeEdit();
      await fetchData();
      return true;
    } catch (error) {
      Message.error(editingRecord.value ? '音色保存失败' : '音色创建失败');
      return false;
    } finally {
      saving.value = false;
    }
  };

  const isRetrying = (id: string) => retryingIds.value.has(id);

  const handleRetry = async (record: VoiceTimbreRecord) => {
    const nextRetryingIds = new Set(retryingIds.value);
    nextRetryingIds.add(record.id);
    retryingIds.value = nextRetryingIds;

    try {
      await retryVoiceTimbre(record.id);
      Message.success('音色创建任务已重新提交');
      await fetchData();
    } catch (error) {
      Message.error('音色重试失败');
    } finally {
      const latestRetryingIds = new Set(retryingIds.value);
      latestRetryingIds.delete(record.id);
      retryingIds.value = latestRetryingIds;
    }
  };

  const isValidAudioFile = (file: File) => {
    const ext = getFileExt(file);
    return ['mp3', 'm4a', 'wav', 'mp4'].includes(ext);
  };

  const getMediaMaxSize = (file: File) => {
    return isMp4File(file) ? 200 * 1024 * 1024 : 20 * 1024 * 1024;
  };

  const isMp4File = (file: File) => {
    return getFileExt(file) === 'mp4' || file.type === 'video/mp4';
  };

  const getFileExt = (file: File) => {
    return file.name.split('.').pop()?.toLowerCase() || '';
  };

  const formatProvider = (provider: VoiceTimbreProviderDTO) => {
    const map: Record<VoiceTimbreProviderDTO, string> = {
      minimax: 'MiniMax',
      qwen: '千问',
      doubao: '豆包',
    };

    return map[provider] || provider;
  };

  const formatStatus = (status: VoiceTimbreStatusDTO) => {
    const map: Record<VoiceTimbreStatusDTO, string> = {
      creating: '创建中',
      active: '启用',
      failed: '失败',
      disabled: '停用',
    };

    return map[status] || status;
  };

  const formatSpeechNumber = (value: number) => {
    return normalizeSpeechFormValue(value, 0).toFixed(2);
  };

  const normalizeSpeechFormValue = (
    value: number | undefined,
    fallback: number
  ) => {
    return Number.isFinite(value) ? Number(value) : fallback;
  };

  const getStatusColor = (status: VoiceTimbreStatusDTO) => {
    const map: Record<VoiceTimbreStatusDTO, string> = {
      creating: 'blue',
      active: 'green',
      failed: 'red',
      disabled: 'gray',
    };

    return map[status] || 'gray';
  };

  const formatDate = (value: string) => {
    return value ? dayjs(value).format('YYYY-MM-DD HH:mm') : '-';
  };

  fetchData();
</script>

<style scoped lang="less">
  .voice-timbre-page {
    min-height: 100%;
    padding: 16px 20px;
    background: var(--color-fill-2);

    &__card {
      min-height: calc(100vh - 112px);
      border-radius: 4px;
    }

    &__search {
      margin-bottom: 16px;
    }

    &__filter {
      width: 150px;
    }

    &__identity {
      min-width: 0;
    }

    &__name {
      font-weight: 500;
      color: var(--color-text-1);
    }

    &__id {
      display: inline-block;
      max-width: 180px;
      margin-top: 4px;
      color: var(--color-text-3);
      font-size: 12px;
    }

    &__audio {
      width: 220px;
      height: 32px;
    }

    &__speech-params {
      display: flex;
      flex-direction: column;
      gap: 4px;
      color: var(--color-text-2);
      font-size: 13px;
      line-height: 18px;
    }

    &__speech-settings {
      margin-bottom: 16px;
      padding: 12px 16px 4px;
      border: 1px solid var(--color-border-2);
      border-radius: 4px;
      background: var(--color-fill-1);
    }

    &__section-title {
      margin-bottom: 12px;
      color: var(--color-text-1);
      font-weight: 500;
    }

    &__slider-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 88px;
      gap: 12px;
      align-items: center;
      width: 100%;
    }

    &__number {
      width: 88px;
    }

    &__pagination {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-top: 16px;
    }

    &__total {
      color: var(--color-text-3);
      font-size: 13px;
    }

    &__upload {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
  }
</style>
