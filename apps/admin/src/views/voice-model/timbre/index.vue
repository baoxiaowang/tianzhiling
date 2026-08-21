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
            <a-option value="cosyvoice">CosyVoice</a-option>
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
          <a-table-column title="发音方言 / 合成指令" :width="300">
            <template #cell="{ record }">
              <a-typography-text
                v-if="isQwenAudioPreviewModel(record.previewModel)"
                ellipsis
                :ellipsis-show-tooltip="true"
              >
                {{ formatSpeechInstruction(record) }}
              </a-typography-text>
              <span v-else>-</span>
            </template>
          </a-table-column>
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
          <a-table-column title="操作" :width="140" fixed="right">
            <template #cell="{ record }">
              <a-space direction="vertical" :size="4" align="start">
                <a-button type="text" size="small" @click="openEdit(record)">
                  编辑
                </a-button>
                <a-button
                  v-if="canValidate(record)"
                  type="text"
                  size="small"
                  :loading="isValidating(record.id)"
                  @click="handleValidate(record)"
                >
                  校验
                </a-button>
                <a-button
                  v-if="canRetry(record)"
                  type="text"
                  size="small"
                  :status="record.status === 'failed' ? 'warning' : 'normal'"
                  :loading="isRetrying(record.id)"
                  @click="handleRetry(record)"
                >
                  {{ getRetryButtonText(record) }}
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

        <a-grid v-if="!editingRecord" :cols="1">
          <a-grid-item>
            <a-form-item
              field="provider"
              label="服务商"
              :rules="[{ required: true, message: '请选择服务商' }]"
            >
              <a-select
                v-model="editForm.provider"
                placeholder="请选择服务商"
                @change="onProviderChange"
              >
                <a-option value="minimax">MiniMax</a-option>
                <a-option value="cosyvoice">CosyVoice</a-option>
                <a-option value="qwen">千问（Qwen3 / Audio Plus）</a-option>
                <a-option value="doubao" disabled>豆包（未接入）</a-option>
              </a-select>
            </a-form-item>
          </a-grid-item>
        </a-grid>

        <a-form-item
          v-if="isQwenProvider"
          field="previewModel"
          label="千问音色模型"
          :rules="[{ required: true, message: '请选择千问音色模型' }]"
        >
          <a-radio-group
            v-model="editForm.previewModel"
            type="button"
            :disabled="Boolean(editingRecord)"
            @change="onQwenModelChange"
          >
            <a-radio
              v-for="option in qwenModelOptions"
              :key="option.value"
              :value="option.value"
            >
              {{ option.label }}
            </a-radio>
          </a-radio-group>
          <a-typography-text v-if="!editingRecord" type="secondary">
            原有 Qwen3 与新接入的 Plus 同时保留；Plus 支持手写发音方言、
            原生语速调节，以及输出层音量和音调调节。
          </a-typography-text>
          <a-typography-text v-if="editingRecord" type="secondary">
            已创建音色的模型不可切换；需要其他模型时请新建音色。
          </a-typography-text>
        </a-form-item>

        <a-form-item
          v-if="!editingRecord"
          field="providerVoiceId"
          :label="providerVoiceIdLabel"
        >
          <a-input
            v-model="editForm.providerVoiceId"
            allow-clear
            :max-length="providerVoiceIdMaxLength"
            :placeholder="providerVoiceIdPlaceholder"
          />
        </a-form-item>

        <a-form-item v-if="!editingRecord" label="复刻音频" required>
          <div class="voice-timbre-page__upload">
            <input
              ref="fileInputRef"
              type="file"
              :accept="audioAccept"
              @change="onAudioFileChange"
            />
            <a-typography-text type="secondary">
              {{ uploadHint }}
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
            { required: true, message: '请输入预览文本' },
            { maxLength: 1000, message: '预览文本不能超过 1000 个字符' },
          ]"
        >
          <a-textarea
            v-model="editForm.previewText"
            allow-clear
            :max-length="1000"
            show-word-limit
            :auto-size="{ minRows: 3, maxRows: 5 }"
            placeholder="请输入用于生成试听音频的预览文本"
          />
        </a-form-item>

        <div
          v-if="supportsSpeechInstruction"
          class="voice-timbre-page__instruction-card"
        >
          <div class="voice-timbre-page__instruction-title">
            发音方言与合成要求
          </div>
          <a-form-item
            field="speechDialect"
            label="方言类型"
            :rules="[{ required: true, message: '请选择方言类型' }]"
          >
            <a-select v-model="editForm.speechDialect" placeholder="请选择方言">
              <a-option
                v-for="option in voiceTimbreDialectOptions"
                :key="option.value"
                :value="option.value"
              >
                {{ option.label }}
              </a-option>
            </a-select>
            <template #extra>
              要求东北话、山东话等明确方言时，请直接选择；只有不限定方言时才选“自动”。
            </template>
          </a-form-item>
          <a-form-item
            field="speechInstruction"
            label="补充要求"
            :rules="[
              {
                maxLength: 50,
                message: '补充要求不能超过 50 个字符',
              },
            ]"
          >
            <a-textarea
              v-model="editForm.speechInstruction"
              allow-clear
              :max-length="50"
              show-word-limit
              :auto-size="{ minRows: 3, maxRows: 5 }"
              placeholder="如：不要转成普通话，保留原音色和说话习惯"
            />
            <template #extra>
              <div class="voice-timbre-page__instruction-help">
                <span>
                  系统会把上面选择的方言强指令与这里的补充要求合并，不会相互覆盖。
                </span>
                <span>
                  该内容会作为 Plus 的 instruction
                  用于试听和聊天合成，不参与音色复刻训练；修改后只刷新试听。
                </span>
              </div>
            </template>
          </a-form-item>
        </div>

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
                    :disabled="!supportsSpeechSpeed"
                  />
                  <a-input-number
                    v-model="editForm.speechSpeed"
                    :min="0.5"
                    :max="2"
                    :step="0.01"
                    :precision="2"
                    hide-button
                    :disabled="!supportsSpeechSpeed"
                    class="voice-timbre-page__number"
                  />
                </div>
                <a-typography-text
                  v-if="supportsQwenAudioSpeechSpeed"
                  type="secondary"
                >
                  Plus 使用模型原生指令控制语速；1.00 为正常语速。
                </a-typography-text>
              </a-form-item>
            </a-grid-item>
            <a-grid-item>
              <a-form-item field="speechVolume" label="音量">
                <div class="voice-timbre-page__slider-row">
                  <a-slider
                    v-model="editForm.speechVolume"
                    :min="speechVolumeMin"
                    :max="speechVolumeMax"
                    :step="0.01"
                    :disabled="!supportsSpeechVolumeAndPitch"
                  />
                  <a-input-number
                    v-model="editForm.speechVolume"
                    :min="speechVolumeMin"
                    :max="speechVolumeMax"
                    :step="0.01"
                    :precision="2"
                    hide-button
                    :disabled="!supportsSpeechVolumeAndPitch"
                    class="voice-timbre-page__number"
                  />
                </div>
                <a-typography-text
                  v-if="supportsQwenAudioOutputControls"
                  type="secondary"
                >
                  Plus 在合成后调整音量；1.00 为原始音量，可调范围 0.25–2.00。
                </a-typography-text>
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
                    :disabled="!supportsSpeechVolumeAndPitch"
                  />
                  <a-input-number
                    v-model="editForm.speechPitch"
                    :min="-12"
                    :max="12"
                    :step="0.01"
                    :precision="2"
                    hide-button
                    :disabled="!supportsSpeechVolumeAndPitch"
                    class="voice-timbre-page__number"
                  />
                </div>
                <a-typography-text
                  v-if="supportsQwenAudioOutputControls"
                  type="secondary"
                >
                  Plus 在合成后调整音调；0 为原始音调，正数升高、负数降低。
                </a-typography-text>
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

    <a-modal
      v-model:visible="validationVisible"
      title="音色校验结果"
      :footer="false"
      width="min(680px, calc(100vw - 32px))"
    >
      <a-descriptions
        v-if="validationResult"
        :column="1"
        bordered
        size="medium"
        class="voice-timbre-page__validation"
      >
        <a-descriptions-item label="音色名称">
          {{ validationResult.record.name }}
        </a-descriptions-item>
        <a-descriptions-item label="服务商">
          {{ formatProvider(validationResult.provider) }}
        </a-descriptions-item>
        <a-descriptions-item label="服务商音色ID">
          <a-typography-text copyable>
            {{ validationResult.providerVoiceId }}
          </a-typography-text>
        </a-descriptions-item>
        <a-descriptions-item label="服务商状态">
          <a-tag
            :color="getProviderStatusColor(validationResult.providerStatus)"
          >
            {{ validationResult.providerStatus }}
          </a-tag>
        </a-descriptions-item>
        <a-descriptions-item label="本地同步状态">
          <a-tag :color="getStatusColor(validationResult.record.status)">
            {{ formatStatus(validationResult.record.status) }}
          </a-tag>
        </a-descriptions-item>
        <a-descriptions-item
          v-if="validationResult.record.errorMessage"
          label="失败原因"
        >
          {{ validationResult.record.errorMessage }}
        </a-descriptions-item>
        <a-descriptions-item v-if="validationResult.targetModel" label="模型">
          {{ validationResult.targetModel }}
        </a-descriptions-item>
        <a-descriptions-item v-if="validationResult.requestId" label="请求ID">
          <a-typography-text copyable>
            {{ validationResult.requestId }}
          </a-typography-text>
        </a-descriptions-item>
        <a-descriptions-item
          v-if="validationResult.resourceLink"
          label="资源链接"
        >
          <a-link :href="validationResult.resourceLink" target="_blank">
            打开资源
          </a-link>
        </a-descriptions-item>
      </a-descriptions>
    </a-modal>
  </div>
</template>

<script lang="ts" setup>
  import { computed, reactive, ref } from 'vue';
  import dayjs from 'dayjs';
  import { Message } from '@arco-design/web-vue';
  import type { FormInstance } from '@arco-design/web-vue/es/form';
  import type {
    VoiceTimbreDialectDTO,
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
    validateVoiceTimbre,
    VoiceTimbreRecord,
  } from '@/api/voice-model';
  import type { ValidateVoiceTimbreRes } from '@/api/voice-model';

  const { loading, setLoading } = useLoading();
  const renderList = ref<VoiceTimbreRecord[]>([]);
  const editVisible = ref(false);
  const validationVisible = ref(false);
  const saving = ref(false);
  const retryingIds = ref<Set<string>>(new Set());
  const validatingIds = ref<Set<string>>(new Set());
  const validationResult = ref<ValidateVoiceTimbreRes>();
  const editingRecord = ref<VoiceTimbreRecord>();
  const editFormRef = ref<FormInstance>();
  const fileInputRef = ref<HTMLInputElement>();
  const selectedAudioFile = ref<File>();
  const DEFAULT_VOICE_TIMBRE_PROVIDER: VoiceTimbreProviderDTO = 'qwen';
  const QWEN3_TTS_VC_MODEL = 'qwen3-tts-vc-2026-01-22';
  const QWEN_AUDIO_PLUS_MODEL = 'qwen-audio-3.0-tts-plus';
  const DEFAULT_QWEN_TIMBRE_MODEL = QWEN_AUDIO_PLUS_MODEL;
  const voiceTimbreDialectOptions: ReadonlyArray<{
    value: VoiceTimbreDialectDTO;
    label: string;
  }> = [
    { value: 'auto', label: '自动（跟随文本）' },
    { value: 'mandarin', label: '普通话' },
    { value: 'cantonese', label: '广东话' },
    { value: 'chongqing', label: '重庆话' },
    { value: 'northeastern', label: '东北话' },
    { value: 'gansu', label: '甘肃话' },
    { value: 'guizhou', label: '贵州话' },
    { value: 'zhejiang', label: '浙江话' },
    { value: 'hebei', label: '河北话' },
    { value: 'henan', label: '河南话' },
    { value: 'hubei', label: '湖北话' },
    { value: 'hunan', label: '湖南话' },
    { value: 'jiangxi', label: '江西话' },
    { value: 'ningbo', label: '宁波话' },
    { value: 'ningxia', label: '宁夏话' },
    { value: 'qingdao', label: '青岛话' },
    { value: 'shaanxi', label: '陕西话' },
    { value: 'shanxi', label: '山西话' },
    { value: 'shandong', label: '山东话' },
    { value: 'shanghai', label: '上海话' },
    { value: 'sichuan', label: '四川话' },
    { value: 'yunnan', label: '云南话' },
  ];
  const qwenModelOptions = [
    {
      label: 'Qwen Audio 3.0 TTS Plus（默认，支持自定义合成指令）',
      value: QWEN_AUDIO_PLUS_MODEL,
    },
    { label: 'Qwen3-TTS-VC（原有）', value: QWEN3_TTS_VC_MODEL },
  ];
  type VoiceTimbreEditForm = {
    name: string;
    provider: VoiceTimbreProviderDTO;
    audioObjectKey: string;
    audioUrl: string;
    cloneLanguage: string;
    previewModel: string;
    speechDialect: VoiceTimbreDialectDTO;
    speechInstruction: string;
    providerVoiceId: string;
    previewText: string;
    speechSpeed: number;
    speechVolume: number;
    speechPitch: number;
    status: Extract<VoiceTimbreStatusDTO, 'active' | 'disabled'>;
    remark: string;
  };
  const searchForm = reactive<{
    keyword: string;
    provider?: VoiceTimbreProviderDTO;
    status?: VoiceTimbreStatusDTO;
  }>({
    keyword: '',
    provider: undefined,
    status: undefined,
  });
  const editForm = reactive<VoiceTimbreEditForm>({
    name: '',
    provider: DEFAULT_VOICE_TIMBRE_PROVIDER,
    audioObjectKey: '',
    audioUrl: '',
    cloneLanguage: 'zh',
    previewModel: DEFAULT_QWEN_TIMBRE_MODEL,
    speechDialect: 'auto',
    speechInstruction: '',
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
  const isCosyVoiceProvider = computed(() => editForm.provider === 'cosyvoice');
  const isQwenProvider = computed(() => editForm.provider === 'qwen');
  const isQwenAudioPreviewModel = (model?: string) =>
    /^qwen-audio-/i.test(model?.trim() || '');
  const supportsSpeechInstruction = computed(
    () => isQwenProvider.value && isQwenAudioPreviewModel(editForm.previewModel)
  );
  const supportsQwenAudioSpeechSpeed = computed(
    () => isQwenProvider.value && isQwenAudioPreviewModel(editForm.previewModel)
  );
  const supportsQwenAudioOutputControls = computed(
    () => isQwenProvider.value && isQwenAudioPreviewModel(editForm.previewModel)
  );
  const supportsSpeechSpeed = computed(
    () => !isQwenProvider.value || supportsQwenAudioSpeechSpeed.value
  );
  const supportsSpeechVolumeAndPitch = computed(
    () => !isQwenProvider.value || supportsQwenAudioOutputControls.value
  );
  const speechVolumeMin = computed(() =>
    supportsQwenAudioOutputControls.value ? 0.25 : 0
  );
  const speechVolumeMax = computed(() =>
    supportsQwenAudioOutputControls.value ? 2 : 10
  );
  const providerVoiceIdLabel = computed(() =>
    isCosyVoiceProvider.value || isQwenProvider.value
      ? '音色前缀'
      : '服务商音色ID'
  );
  const providerVoiceIdPlaceholder = computed(() => {
    if (isCosyVoiceProvider.value) {
      return '不填则后端自动生成，仅支持 10 位内小写字母或数字';
    }

    if (isQwenProvider.value) {
      return isQwenAudioPreviewModel(editForm.previewModel)
        ? '不填则后端自动生成，仅支持 10 位内字母或数字'
        : '不填则后端自动生成，仅支持 16 位内字母、数字或下划线';
    }

    return '不填则后端自动生成，需以英文字母开头';
  });
  const providerVoiceIdMaxLength = computed(() => {
    if (isCosyVoiceProvider.value) {
      return 10;
    }

    if (isQwenProvider.value) {
      return isQwenAudioPreviewModel(editForm.previewModel) ? 10 : 16;
    }

    return 256;
  });
  const audioAccept = computed(() =>
    isCosyVoiceProvider.value || isQwenProvider.value
      ? '.mp3,.m4a,.wav,audio/mpeg,audio/mp4,audio/wav'
      : '.mp3,.m4a,.wav,.mp4,audio/mpeg,audio/mp4,audio/wav,video/mp4'
  );
  const uploadHint = computed(() => {
    if (isCosyVoiceProvider.value) {
      return '支持 mp3、m4a、wav；音频最大 20MB，建议时长 10 到 20 秒';
    }

    if (isQwenProvider.value) {
      return '支持 mp3、m4a、wav；音频最大 10MB，建议时长 10 到 20 秒';
    }

    return '支持 mp3、m4a、wav、mp4；音频最大 20MB，mp4 最大 200MB，建议时长 10 秒到 5 分钟';
  });

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
    editForm.cloneLanguage = record.cloneLanguage || 'auto';
    editForm.previewModel = record.previewModel || QWEN3_TTS_VC_MODEL;
    editForm.speechDialect = resolveSpeechDialect(record);
    editForm.speechInstruction = record.speechInstruction?.trim() || '';
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
    editForm.provider = DEFAULT_VOICE_TIMBRE_PROVIDER;
    editForm.audioObjectKey = '';
    editForm.audioUrl = '';
    editForm.cloneLanguage = 'zh';
    editForm.previewModel = DEFAULT_QWEN_TIMBRE_MODEL;
    editForm.speechDialect = 'auto';
    editForm.speechInstruction = '';
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

  const onProviderChange = () => {
    editForm.providerVoiceId = '';
    editForm.previewModel = DEFAULT_QWEN_TIMBRE_MODEL;
    editForm.speechDialect = 'auto';
    editForm.speechInstruction = '';
    editForm.cloneLanguage =
      isCosyVoiceProvider.value || isQwenProvider.value ? 'zh' : 'Chinese';

    if (selectedAudioFile.value && !isValidAudioFile(selectedAudioFile.value)) {
      selectedAudioFile.value = undefined;

      if (fileInputRef.value) {
        fileInputRef.value.value = '';
      }
    }
  };

  const onQwenModelChange = () => {
    editForm.providerVoiceId = '';

    if (!supportsSpeechInstruction.value) {
      editForm.speechDialect = 'auto';
      editForm.speechInstruction = '';
    }

    if (!supportsQwenAudioSpeechSpeed.value) {
      editForm.speechSpeed = 1;
    }

    if (!supportsQwenAudioOutputControls.value) {
      editForm.speechVolume = 1;
      editForm.speechPitch = 0;
    }
  };

  const onAudioFileChange = (event: Event) => {
    const file = (event.target as HTMLInputElement).files?.[0];

    if (!file) {
      selectedAudioFile.value = undefined;
      return;
    }

    if (!isValidAudioFile(file)) {
      Message.error(
        isCosyVoiceProvider.value || isQwenProvider.value
          ? '请上传 mp3、m4a 或 wav 文件'
          : '请上传 mp3、m4a、wav 或 mp4 文件'
      );
      selectedAudioFile.value = undefined;
      return;
    }

    if (file.size > getMediaMaxSize(file)) {
      Message.error(getMediaSizeError(file));
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
          ...(supportsSpeechInstruction.value
            ? {
                speechDialect: editForm.speechDialect,
                speechInstruction: editForm.speechInstruction,
              }
            : {}),
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
          previewModel: isQwenProvider.value
            ? editForm.previewModel
            : undefined,
          ...(supportsSpeechInstruction.value
            ? {
                speechDialect: editForm.speechDialect,
                speechInstruction: editForm.speechInstruction,
              }
            : {}),
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

  const isValidating = (id: string) => validatingIds.value.has(id);

  const canRetry = (record: VoiceTimbreRecord) =>
    record.status === 'failed' || record.status === 'active';

  const canValidate = (record: VoiceTimbreRecord) =>
    record.provider === 'cosyvoice' && Boolean(record.providerVoiceId);

  const getRetryButtonText = (record: VoiceTimbreRecord) =>
    record.status === 'active' ? '重新训练' : '重试';

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

  const handleValidate = async (record: VoiceTimbreRecord) => {
    const nextValidatingIds = new Set(validatingIds.value);
    nextValidatingIds.add(record.id);
    validatingIds.value = nextValidatingIds;

    try {
      const { data } = await validateVoiceTimbre(record.id);
      validationResult.value = data;
      validationVisible.value = true;
      Message.success('音色校验完成，已同步本地状态');
      await fetchData();
    } catch (error) {
      Message.error('音色校验失败');
    } finally {
      const latestValidatingIds = new Set(validatingIds.value);
      latestValidatingIds.delete(record.id);
      validatingIds.value = latestValidatingIds;
    }
  };

  const isValidAudioFile = (file: File) => {
    const ext = getFileExt(file);

    if (isCosyVoiceProvider.value || isQwenProvider.value) {
      return ['mp3', 'm4a', 'wav'].includes(ext);
    }

    return ['mp3', 'm4a', 'wav', 'mp4'].includes(ext);
  };

  const getMediaMaxSize = (file: File) => {
    if (isQwenProvider.value) {
      return 10 * 1024 * 1024;
    }

    return isMp4File(file) ? 200 * 1024 * 1024 : 20 * 1024 * 1024;
  };

  const getMediaSizeError = (file: File) => {
    if (isQwenProvider.value) {
      return '千问复刻音频不能超过 10MB';
    }

    if (isMp4File(file)) {
      return 'mp4 文件不能超过 200MB';
    }

    return '音频文件不能超过 20MB';
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
      cosyvoice: 'CosyVoice',
      qwen: '千问',
      doubao: '豆包',
    };

    return map[provider] || provider;
  };

  const formatSpeechInstruction = (
    record: Pick<VoiceTimbreRecord, 'speechInstruction' | 'speechDialect'>,
    fallback = '未设置（跟随文本）'
  ) => {
    const dialect = resolveSpeechDialect(record);
    const dialectLabel = voiceTimbreDialectOptions.find(
      (option) => option.value === dialect && option.value !== 'auto'
    )?.label;
    const parts = [
      dialectLabel ? `方言：${dialectLabel}` : '',
      record.speechInstruction?.trim()
        ? `补充：${record.speechInstruction.trim()}`
        : '',
    ].filter(Boolean);

    return parts.join('；') || fallback;
  };

  const resolveSpeechDialect = (
    record: Pick<VoiceTimbreRecord, 'speechInstruction' | 'speechDialect'>
  ): VoiceTimbreDialectDTO => {
    if (record.speechDialect && record.speechDialect !== 'auto') {
      return record.speechDialect;
    }

    const instruction = record.speechInstruction?.trim() || '';
    const dialect = [...voiceTimbreDialectOptions]
      .filter(
        (option) => option.value !== 'auto' && option.value !== 'mandarin'
      )
      .sort(
        (left, right) =>
          right.label.replace(/话$/, '').length -
          left.label.replace(/话$/, '').length
      )
      .find((option) => instruction.includes(option.label.replace(/话$/, '')));

    if (dialect) {
      return dialect.value;
    }

    const requestsMandarin =
      instruction.includes('普通话') &&
      !/(不要|别|禁止|避免).{0,6}普通话/.test(instruction);

    return requestsMandarin ? 'mandarin' : 'auto';
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

  const getProviderStatusColor = (status: string) => {
    const normalizedStatus = status.trim().toUpperCase();

    if (['OK', 'DEPLOYED', 'SUCCEEDED', 'SUCCESS'].includes(normalizedStatus)) {
      return 'green';
    }

    if (
      ['CREATING', 'PENDING', 'DEPLOYING', 'RUNNING'].includes(normalizedStatus)
    ) {
      return 'blue';
    }

    return 'red';
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

    &__instruction-card {
      margin-bottom: 16px;
      padding: 14px 16px 4px;
      border: 1px solid rgb(var(--primary-6));
      border-radius: 6px;
      background: var(--color-primary-light-1);
    }

    &__instruction-title {
      margin-bottom: 12px;
      color: var(--color-text-1);
      font-weight: 600;
    }

    &__instruction-help {
      display: flex;
      flex-direction: column;
      gap: 3px;
      color: var(--color-text-3);
      line-height: 20px;
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

    &__validation {
      :deep(.arco-descriptions-item-label) {
        width: 128px;
      }
    }
  }
</style>
