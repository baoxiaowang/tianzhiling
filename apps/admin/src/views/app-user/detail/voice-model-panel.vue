<template>
  <div
    class="voice-model-panel"
    :class="{ 'voice-model-panel--embedded': embedded }"
  >
    <!-- ① 音色列表 -->
    <a-card
      class="voice-model-panel__card"
      :class="{ 'voice-model-panel__card--embedded': embedded }"
      :bordered="false"
    >
      <template #title>
        <div class="voice-model-panel__card-head">
          <span class="voice-model-panel__card-title">用户音色</span>
          <a-typography-text type="secondary">
            训练完成后自动生效，可直接试听
          </a-typography-text>
        </div>
      </template>

      <a-table
        row-key="id"
        :data="renderList"
        :loading="loading"
        :pagination="pagination"
        @page-change="onPageChange"
      >
        <template #empty>
          <a-empty description="该用户暂无音色" />
        </template>
        <template #columns>
          <a-table-column title="音色名称" data-index="name" :width="200">
            <template #cell="{ record }">
              <div class="voice-model-panel__name-cell">
                <span>{{ record.name }}</span>
                <a-tooltip
                  v-if="record.errorMessage"
                  :content="record.errorMessage"
                >
                  <icon-exclamation-circle
                    class="voice-model-panel__error-icon"
                  />
                </a-tooltip>
              </div>
            </template>
          </a-table-column>
          <a-table-column title="服务商" data-index="provider" :width="120">
            <template #cell="{ record }">
              <a-tag :color="providerColor(record.provider)">
                {{ providerLabel(record.provider) }}
              </a-tag>
            </template>
          </a-table-column>
          <a-table-column title="状态" data-index="status" :width="110">
            <template #cell="{ record }">
              <a-tag :color="statusColor(record.status)">
                {{ statusLabel(record.status) }}
              </a-tag>
            </template>
          </a-table-column>
          <a-table-column title="试听" :width="200">
            <template #cell="{ record }">
              <audio
                v-if="previewUrlOf(record)"
                :src="previewUrlOf(record)"
                controls
                preload="none"
                class="voice-model-panel__audio"
              />
              <span v-else class="voice-model-panel__muted">暂无试听</span>
            </template>
          </a-table-column>
          <a-table-column
            title="绑定智能体"
            data-index="boundAgentCount"
            :width="110"
          >
            <template #cell="{ record }">
              {{ record.boundAgentCount ?? 0 }}
            </template>
          </a-table-column>
          <a-table-column title="创建时间" :width="160">
            <template #cell="{ record }">
              {{ formatDate(record.createdAt) }}
            </template>
          </a-table-column>
          <a-table-column title="操作" :width="150">
            <template #cell="{ record }">
              <a-space>
                <a-button
                  v-if="
                    record.status === 'failed' || record.status === 'creating'
                  "
                  type="text"
                  size="small"
                  :loading="retryingId === record.id"
                  @click="handleRetry(record)"
                >
                  重试
                </a-button>
                <a-popconfirm
                  content="删除后该用户将无法使用此音色，且对象存储中的音频会被清理，确认删除？"
                  @ok="handleDelete(record)"
                >
                  <a-button
                    v-if="record.canDelete"
                    type="text"
                    size="small"
                    status="danger"
                  >
                    删除
                  </a-button>
                </a-popconfirm>
              </a-space>
            </template>
          </a-table-column>
        </template>
      </a-table>
    </a-card>

    <!-- ② 训练操作台（分步向导） -->
    <a-card class="voice-model-panel__wizard" :bordered="false">
      <template #title>
        <div class="voice-model-panel__wizard-head">
          <span class="voice-model-panel__card-title">音色训练操作台</span>
          <a-typography-text type="secondary">
            按步骤完成音色训练；每步内容自动保留，可随时回退修改
          </a-typography-text>
        </div>
      </template>

      <a-steps :current="step" type="arrow" class="voice-model-panel__steps">
        <a-step
          v-for="(item, idx) in stepItems"
          :key="item.title"
          :description="item.desc"
        >
          <span
            class="voice-model-panel__step-link"
            :class="{ 'is-active': idx === step }"
            @click="onStepChange(idx)"
          >
            {{ item.title }}
          </span>
        </a-step>
      </a-steps>

      <!-- Step 1 上传声音素材 -->
      <div v-show="step === 0" class="voice-model-panel__step">
        <div class="voice-model-panel__upload">
          <input
            ref="fileInputRef"
            type="file"
            :accept="audioAccept"
            multiple
            @change="onFilesChange"
          />
          <a-typography-text type="secondary">
            支持 mp3 / m4a / wav / mp4，单段不超过
            200MB；可连续上传多段，本步保存的上传记录会保留
          </a-typography-text>
        </div>

        <div v-if="uploadedClips.length" class="voice-model-panel__clips">
          <div
            v-for="clip in uploadedClips"
            :key="clip.objectKey"
            class="voice-model-panel__clip"
          >
            <a-checkbox :model-value="clip.selected" disabled>
              {{ clip.name }}
            </a-checkbox>
            <audio
              :src="clip.publicUrl"
              controls
              preload="none"
              class="voice-model-panel__clip-audio"
            />
            <a-button
              type="text"
              size="small"
              status="danger"
              @click="removeClip(clip)"
            >
              移除
            </a-button>
          </div>
        </div>
        <a-typography-text v-if="uploading" type="secondary">
          上传中…
        </a-typography-text>
        <a-empty
          v-if="!uploading && !uploadedClips.length"
          description="尚未上传声音素材"
        >
          <a-typography-text type="secondary">
            请选择本段或多段音频上传，用于复刻音色
          </a-typography-text>
        </a-empty>
      </div>

      <!-- Step 2 选择训练片段 -->
      <div v-show="step === 1" class="voice-model-panel__step">
        <div class="voice-model-panel__step-head">
          <a-typography-text>
            已剪出 {{ voiceClips.length }} 段片段，勾选用于训练的片段
          </a-typography-text>
          <a-checkbox
            :model-value="allVoiceClipsSelected"
            :indeterminate="someVoiceClipsSelected"
            @change="onToggleAllVoiceClips"
          >
            全选
          </a-checkbox>
        </div>

        <div v-if="clipping" class="voice-model-panel__clipping">
          <a-spin />
          <a-typography-text type="secondary">
            正在分析并剪辑音频片段…
          </a-typography-text>
        </div>
        <a-alert
          v-else-if="clipError"
          type="error"
          :title="clipError"
          class="voice-model-panel__clip-alert"
        />

        <div v-if="voiceClips.length" class="voice-model-panel__clips">
          <div
            v-for="clip in voiceClips"
            :key="clip.objectKey"
            class="voice-model-panel__clip"
            :class="{ 'voice-model-panel__clip--checked': clip.selected }"
          >
            <a-checkbox
              :model-value="clip.selected"
              @change="onToggleClip(clip, $event)"
            >
              {{ clip.sourceName || '片段' }} ·
              {{ formatClipDuration(clip.durationSeconds) }}
            </a-checkbox>
            <audio
              :src="clip.publicUrl"
              controls
              preload="none"
              class="voice-model-panel__clip-audio"
            />
            <a-tag v-if="clip.qualityLabel" size="small" color="arcoblue">
              {{ clip.qualityLabel }}
            </a-tag>
            <div
              v-if="clip.qualityIssues?.length"
              class="voice-model-panel__clip-issues"
            >
              <a-typography-text
                v-for="issue in clip.qualityIssues"
                :key="issue.code"
                type="warning"
                class="voice-model-panel__clip-issue"
              >
                {{ getVoiceClipIssueDisplayText(issue) }}
              </a-typography-text>
            </div>
          </div>
          <a-button size="small" :loading="clipping" @click="startClipping">
            重新剪辑
          </a-button>
        </div>
        <a-empty
          v-else-if="!clipping && !clipError"
          description="暂无剪辑片段，请先在上一步上传素材"
        />

        <div
          v-if="voiceClips.length"
          class="voice-model-panel__selection-guide"
        >
          <div class="voice-model-panel__selection-guide-row">
            <a-typography-text>
              已选 {{ selectedVoiceClips.length }} 段 ·
              {{ acceptedClipDurationText }}，建议不超过 1 分钟
            </a-typography-text>
            <a-progress
              :percent="acceptedClipProgressPercent"
              :show-text="false"
              size="small"
              class="voice-model-panel__selection-guide-bar"
            />
          </div>
        </div>
      </div>

      <!-- Step 3 填写训练信息 -->
      <div v-show="step === 2" class="voice-model-panel__step">
        <a-form ref="trainFormRef" :model="form" layout="vertical">
          <a-grid :cols="2" :col-gap="16" :row-gap="4">
            <a-grid-item :span="{ xs: 24, md: 12 }">
              <a-form-item
                field="name"
                label="音色名称"
                :rules="[
                  { required: true, message: '请输入音色名称' },
                  { maxLength: 60, message: '音色名称不能超过 60 个字符' },
                ]"
              >
                <a-input
                  v-model="form.name"
                  allow-clear
                  :max-length="60"
                  show-word-limit
                  placeholder="例如：妈妈的温柔声音"
                />
              </a-form-item>
            </a-grid-item>
            <a-grid-item :span="{ xs: 24, md: 12 }">
              <a-form-item
                field="provider"
                label="服务商"
                :rules="[{ required: true, message: '请选择服务商' }]"
              >
                <a-select
                  v-model="form.provider"
                  placeholder="请选择服务商"
                  @change="onProviderChange"
                >
                  <a-option value="minimax">MiniMax</a-option>
                  <a-option value="cosyvoice">CosyVoice v3.5 Plus</a-option>
                  <a-option value="qwen">千问（Qwen）</a-option>
                  <a-option value="doubao">豆包（Seed ICL 2.0）</a-option>
                </a-select>
              </a-form-item>
            </a-grid-item>
            <a-grid-item v-if="isDoubaoProvider" :span="24">
              <a-form-item
                field="providerVoiceId"
                label="豆包 Speaker ID"
                :rules="[{ required: true, message: '请填写豆包 Speaker ID' }]"
              >
                <a-input
                  v-model="form.providerVoiceId"
                  allow-clear
                  placeholder="如 S_xxxxxxxx，需为已购槽位"
                />
              </a-form-item>
            </a-grid-item>
            <a-grid-item :span="{ xs: 24, md: 12 }">
              <a-form-item field="speechDialect" label="方言类型">
                <a-select v-model="form.speechDialect" placeholder="请选择方言">
                  <a-option
                    v-for="option in dialectOptions"
                    :key="option.value"
                    :value="option.value"
                  >
                    {{ option.label }}
                  </a-option>
                </a-select>
              </a-form-item>
            </a-grid-item>
            <a-grid-item :span="{ xs: 24, md: 12 }">
              <a-form-item
                field="speechInstruction"
                label="补充要求"
                :rules="[
                  { maxLength: 50, message: '补充要求不能超过 50 个字符' },
                ]"
              >
                <a-textarea
                  v-model="form.speechInstruction"
                  allow-clear
                  :max-length="50"
                  show-word-limit
                  :auto-size="{ minRows: 1, maxRows: 3 }"
                  placeholder="例如：语气亲切自然，保留长辈说话的停顿习惯"
                />
              </a-form-item>
            </a-grid-item>
            <a-grid-item :span="24">
              <a-form-item
                field="previewText"
                label="试听文本"
                :rules="[
                  { required: true, message: '请输入试听文本' },
                  { maxLength: 1000, message: '试听文本不能超过 1000 个字符' },
                ]"
              >
                <a-textarea
                  v-model="form.previewText"
                  allow-clear
                  :max-length="1000"
                  show-word-limit
                  :auto-size="{ minRows: 3, maxRows: 5 }"
                  placeholder="请输入用于生成试听音频的文本，提交后作为试听预览"
                />
              </a-form-item>
            </a-grid-item>
          </a-grid>

          <div class="voice-model-panel__section-title">输出层调节</div>
          <a-grid :cols="3" :col-gap="16" :row-gap="4">
            <a-grid-item :span="{ xs: 24, md: 8 }">
              <a-form-item field="speechSpeed" label="语速">
                <div class="voice-model-panel__slider-row">
                  <a-slider
                    v-model="form.speechSpeed"
                    :min="0.5"
                    :max="2"
                    :step="0.01"
                  />
                  <a-input-number
                    v-model="form.speechSpeed"
                    :min="0.5"
                    :max="2"
                    :step="0.01"
                    :precision="2"
                  />
                </div>
              </a-form-item>
            </a-grid-item>
            <a-grid-item :span="{ xs: 24, md: 8 }">
              <a-form-item field="speechVolume" label="音量">
                <div class="voice-model-panel__slider-row">
                  <a-slider
                    v-model="form.speechVolume"
                    :min="0"
                    :max="2"
                    :step="0.01"
                  />
                  <a-input-number
                    v-model="form.speechVolume"
                    :min="0"
                    :max="2"
                    :step="0.01"
                    :precision="2"
                  />
                </div>
              </a-form-item>
            </a-grid-item>
            <a-grid-item :span="{ xs: 24, md: 8 }">
              <a-form-item field="speechPitch" label="音调">
                <div class="voice-model-panel__slider-row">
                  <a-slider
                    v-model="form.speechPitch"
                    :min="-12"
                    :max="12"
                    :step="1"
                  />
                  <a-input-number
                    v-model="form.speechPitch"
                    :min="-12"
                    :max="12"
                    :step="1"
                    :precision="0"
                  />
                </div>
              </a-form-item>
            </a-grid-item>
          </a-grid>
        </a-form>
      </div>

      <!-- Step 4 提交与进度 -->
      <div v-show="step === 3" class="voice-model-panel__step">
        <a-alert type="info" show-icon class="voice-model-panel__confirm-alert">
          <template #title>
            即将为该用户创建音色并提交训练，请确认以下信息
          </template>
        </a-alert>

        <a-descriptions
          class="voice-model-panel__confirm"
          :column="{ xs: 1, md: 2 }"
          bordered
          size="medium"
        >
          <a-descriptions-item label="音色名称">
            {{ form.name || '-' }}
          </a-descriptions-item>
          <a-descriptions-item label="服务商">
            {{ providerLabel(form.provider) }}
          </a-descriptions-item>
          <a-descriptions-item label="训练片段">
            {{ selectedVoiceClips.length }} 段
          </a-descriptions-item>
          <a-descriptions-item label="方言">
            {{ dialectLabel }}
          </a-descriptions-item>
          <a-descriptions-item v-if="isDoubaoProvider" label="豆包 Speaker ID">
            {{ form.providerVoiceId || '-' }}
          </a-descriptions-item>
          <a-descriptions-item label="补充要求">
            {{ form.speechInstruction || '-' }}
          </a-descriptions-item>
          <a-descriptions-item label="语速 / 音量 / 音调">
            {{ form.speechSpeed }} / {{ form.speechVolume }} /
            {{ form.speechPitch }}
          </a-descriptions-item>
          <a-descriptions-item label="试听文本">
            <span class="voice-model-panel__preview-text">
              {{ form.previewText || '-' }}
            </span>
          </a-descriptions-item>
        </a-descriptions>

        <div v-if="submittedId" class="voice-model-panel__submitted">
          <a-result status="success" title="训练任务已提交">
            <template #subtitle>
              训练进行中，完成后音色将自动生效；可在上方「用户音色」列表查看进度
            </template>
            <template #extra>
              <a-space>
                <a-button type="primary" @click="resetWizard">
                  再训练一个
                </a-button>
                <a-button @click="refreshAfterSubmit">查看音色列表</a-button>
              </a-space>
            </template>
          </a-result>
        </div>
      </div>

      <!-- 步骤导航 -->
      <div v-if="!submittedId" class="voice-model-panel__nav">
        <a-button v-if="step > 0" @click="step -= 1">上一步</a-button>
        <div class="voice-model-panel__nav-spacer" />
        <a-button
          v-if="step < 3"
          type="primary"
          :disabled="!canGoNext"
          @click="goNext"
        >
          下一步
        </a-button>
        <a-button
          v-if="step === 3"
          type="primary"
          :loading="saving"
          @click="submitTrain"
        >
          提交训练
        </a-button>
      </div>
    </a-card>
  </div>
</template>

<script lang="ts" setup>
  import { computed, reactive, ref } from 'vue';
  import dayjs from 'dayjs';
  import { Message } from '@arco-design/web-vue';
  import uploadAdminFile from '@/api/storage';
  import {
    mergeCreateVoiceTimbre,
    queryVoiceTimbreList,
    retryVoiceTimbre,
    deleteVoiceTimbre,
    createVoiceMaterial,
    queryVoiceMaterials,
    deleteVoiceMaterial,
    clipVoiceMaterials,
    VoiceTimbreRecord,
  } from '@/api/voice-model';
  import { VoiceTimbreProviderDTO, VoiceTimbreStatusDTO } from '@tzl/shared';

  // 方言选项（与 voice-model/timbre 页面保持一致，避免依赖 shared 构建产物导出）
  const QWEN_AUDIO_DIALECT_OPTIONS = [
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
  ] as const;

  const COSYVOICE_V35_DIALECT_OPTIONS = [
    { value: 'auto', label: '自动（跟随文本）' },
    { value: 'mandarin', label: '普通话' },
    { value: 'cantonese', label: '广东话' },
    { value: 'northeastern', label: '东北话' },
    { value: 'gansu', label: '甘肃话' },
    { value: 'guizhou', label: '贵州话' },
    { value: 'henan', label: '河南话' },
    { value: 'hubei', label: '湖北话' },
    { value: 'jiangxi', label: '江西话' },
    { value: 'minnan', label: '闽南话' },
    { value: 'ningxia', label: '宁夏话' },
    { value: 'shanxi', label: '山西话' },
    { value: 'shaanxi', label: '陕西话' },
    { value: 'shandong', label: '山东话' },
    { value: 'shanghai', label: '上海话' },
    { value: 'sichuan', label: '四川话' },
    { value: 'tianjin', label: '天津话' },
    { value: 'yunnan', label: '云南话' },
  ] as const;

  const VOICE_TIMBRE_DIALECT_OPTIONS = [
    ...QWEN_AUDIO_DIALECT_OPTIONS,
    { value: 'minnan', label: '闽南话' },
    { value: 'tianjin', label: '天津话' },
  ] as const;

  interface UploadedClip {
    /** 已保存到后端的素材记录 id，未持久化时为空 */
    id?: string;
    name: string;
    objectKey: string;
    publicUrl: string;
    selected: boolean;
  }

  interface VoiceClip {
    sourceMaterialId: string;
    sourceName: string;
    objectKey: string;
    publicUrl: string;
    durationSeconds: number;
    transcript?: string;
    qualityScore?: number;
    qualityLabel?: string;
    qualityIssues?: {
      code: string;
      severity: 'warning' | 'rejected';
      message?: string;
    }[];
    selected: boolean;
  }

  const props = withDefaults(
    defineProps<{
      title?: string;
      userId?: string;
      embedded?: boolean;
    }>(),
    {
      title: '声音模型',
      userId: '',
      embedded: false,
    }
  );

  const renderList = ref<VoiceTimbreRecord[]>([]);
  const loading = ref(false);
  // 顶部导航步骤项：工作流与导航进度一一对应
  const stepItems = [
    { title: '上传声音素材', desc: '上传多段音频' },
    { title: '选择训练片段', desc: '勾选用于训练的片段' },
    { title: '填写训练信息', desc: '模型与服务参数' },
    { title: '提交与进度', desc: '确认后提交训练' },
  ];
  const pagination = reactive({
    current: 1,
    pageSize: 10,
    total: 0,
    showTotal: true,
  });

  // 操作台步骤状态
  const step = ref(0);
  const saving = ref(false);
  const uploading = ref(false);
  const submittedId = ref('');
  const trainFormRef = ref();
  const fileInputRef = ref<HTMLInputElement>();
  const uploadedClips = ref<UploadedClip[]>([]);
  /** 剪辑出的训练片段（底层声音剪辑工作流产出） */
  const voiceClips = ref<VoiceClip[]>([]);
  const clipping = ref(false);
  const clipError = ref('');
  /** 已剪辑的素材指纹（objectKey 组合），素材变化后需重新剪辑 */
  const clippedMaterialFingerprint = ref('');

  const materialFingerprint = () =>
    uploadedClips.value.map((clip) => clip.objectKey).join('|');

  const selectedVoiceClips = computed(() =>
    voiceClips.value.filter((clip) => clip.selected)
  );
  const retryingId = ref('');

  /** 复用 C 端小程序「选择训练片段」的时长汇总与上限校验逻辑 */
  const VOICE_SERVICE_MAX_TRAINING_SECONDS = 60;
  const CLIP_SEPARATOR_SECONDS = 0.2;

  const getClipDurationSeconds = (clip: VoiceClip) => {
    const seconds = Number(clip.durationSeconds);
    return Number.isFinite(seconds) && seconds > 0 ? seconds : 12;
  };

  const acceptedClipDurationSeconds = computed(() => {
    const contentSeconds = selectedVoiceClips.value.reduce(
      (total, clip) => total + getClipDurationSeconds(clip),
      0
    );
    return (
      contentSeconds +
      Math.max(0, selectedVoiceClips.value.length - 1) * CLIP_SEPARATOR_SECONDS
    );
  });

  const acceptedClipDurationText = computed(() => {
    const seconds = acceptedClipDurationSeconds.value;
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  });

  const acceptedClipProgressPercent = computed(() =>
    Math.min(
      100,
      Math.round(
        (acceptedClipDurationSeconds.value /
          VOICE_SERVICE_MAX_TRAINING_SECONDS) *
          100
      )
    )
  );

  const wouldExceedSelectionLimit = (target: VoiceClip) => {
    if (target.selected) {
      return false;
    }
    const projectedSeconds =
      acceptedClipDurationSeconds.value +
      (selectedVoiceClips.value.length ? CLIP_SEPARATOR_SECONDS : 0) +
      getClipDurationSeconds(target);
    return projectedSeconds > VOICE_SERVICE_MAX_TRAINING_SECONDS;
  };

  /** 片段质量提示文案（与 C 端小程序保持一致） */
  const getVoiceClipIssueDisplayText = (issue: {
    code: string;
    message?: string;
  }) => {
    const messages: Record<string, string> = {
      too_short: '片段太短，有效声音不足',
      mostly_silent: '停顿太多，有效声音不足',
      severe_clipping: '爆音失真较严重',
      volume_unrecoverable: '音量过低，调高后仍可能听不清',
      background_noise_severe: '背景噪声盖过人声',
      silence_high: '停顿较多，请重点试听',
      clipping_detected: '有少量爆音，请重点试听',
      volume_adjusted: '原音量偏低，已自动调高',
      background_noise_high: '背景噪声偏多，请重点试听',
    };
    return messages[issue.code] ?? issue.message;
  };

  const form = reactive<{
    name: string;
    provider: VoiceTimbreProviderDTO;
    providerVoiceId: string;
    previewText: string;
    speechDialect: string;
    speechInstruction: string;
    speechSpeed: number;
    speechVolume: number;
    speechPitch: number;
  }>({
    name: '',
    provider: 'qwen',
    providerVoiceId: '',
    previewText: '',
    speechDialect: 'auto',
    speechInstruction: '',
    speechSpeed: 1,
    speechVolume: 1,
    speechPitch: 0,
  });

  const isDoubaoProvider = computed(() => form.provider === 'doubao');
  const audioAccept = computed(() =>
    isDoubaoProvider.value
      ? 'audio/mp3,audio/mp4,audio/wav,video/mp4'
      : 'audio/mp3,audio/mp4,audio/wav,video/mp4'
  );

  const dialectOptions = computed(() => {
    if (form.provider === 'cosyvoice') {
      return COSYVOICE_V35_DIALECT_OPTIONS;
    }
    if (form.provider === 'qwen') {
      return QWEN_AUDIO_DIALECT_OPTIONS;
    }
    return VOICE_TIMBRE_DIALECT_OPTIONS;
  });

  const dialectLabel = computed(() => {
    const found = dialectOptions.value.find(
      (option) => option.value === form.speechDialect
    );
    return found?.label || form.speechDialect || '自动';
  });

  // 各步骤「下一步」是否可用
  const canGoNext = computed(() => {
    if (step.value === 0) {
      return uploadedClips.value.length > 0;
    }
    if (step.value === 1) {
      return selectedVoiceClips.value.length > 0;
    }
    if (step.value === 2) {
      return (
        Boolean(form.name.trim()) &&
        Boolean(form.previewText.trim()) &&
        (!isDoubaoProvider.value || Boolean(form.providerVoiceId.trim()))
      );
    }
    return true;
  });

  const allVoiceClipsSelected = computed(
    () =>
      voiceClips.value.length > 0 &&
      voiceClips.value.every((clip) => clip.selected)
  );

  const someVoiceClipsSelected = computed(
    () => selectedVoiceClips.value.length > 0 && !allVoiceClipsSelected.value
  );

  const onToggleAllVoiceClips = (
    checked: boolean | (string | number | boolean)[]
  ) => {
    const next = Boolean(checked);
    // 全选时若超过训练片段上限，提示但不强阻（运营可自行决定）
    if (
      next &&
      selectedVoiceClips.value.length < voiceClips.value.length &&
      voiceClips.value.reduce((t, c) => t + getClipDurationSeconds(c), 0) +
        Math.max(0, voiceClips.value.length - 1) * CLIP_SEPARATOR_SECONDS >
        VOICE_SERVICE_MAX_TRAINING_SECONDS
    ) {
      Message.warning(
        `全部片段合计超过 ${VOICE_SERVICE_MAX_TRAINING_SECONDS}s 建议上限，请留意`
      );
    }
    voiceClips.value.forEach((clip) => {
      clip.selected = next;
    });
  };

  const onToggleClip = (
    clip: VoiceClip,
    checked: boolean | (string | number | boolean)[]
  ) => {
    const next = Boolean(checked);
    if (next && wouldExceedSelectionLimit(clip)) {
      Message.warning(
        `该片段会让训练总时长超过 ${VOICE_SERVICE_MAX_TRAINING_SECONDS}s 建议上限，请先取消部分片段`
      );
      return;
    }
    clip.selected = next;
  };

  const formatClipDuration = (seconds?: number) => {
    if (!seconds || seconds < 0) {
      return '0:00';
    }
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  const fetchList = async () => {
    if (!props.userId) {
      renderList.value = [];
      pagination.total = 0;
      return;
    }

    try {
      loading.value = true;
      const { data } = await queryVoiceTimbreList({
        userId: props.userId,
        page: pagination.current,
        pageSize: pagination.pageSize,
      });
      renderList.value = data.items;
      pagination.total = data.total;
      pagination.current = data.page;
    } catch (error) {
      Message.error('音色列表加载失败');
    } finally {
      loading.value = false;
    }
  };

  const onPageChange = (page: number) => {
    pagination.current = page;
    fetchList();
  };

  const goNext = async () => {
    // Step 0 → 1 时若素材有增删，触发重新剪辑
    if (step.value === 0 && uploadedClips.value.length) {
      if (clippedMaterialFingerprint.value !== materialFingerprint()) {
        startClipping();
      }
    }
    // Step 2 → 3 时先校验表单字段
    if (step.value === 2) {
      const errors = await trainFormRef.value?.validate();
      if (errors) {
        return;
      }
    }
    step.value = Math.min(step.value + 1, 3);
  };

  /** 顶部导航步骤可点击：工作流与导航进度对齐 */
  const onStepChange = (nextStep: number) => {
    // 进入「选择训练片段」时若素材有增删，触发重新剪辑
    if (nextStep === 1 && step.value === 0 && uploadedClips.value.length) {
      if (clippedMaterialFingerprint.value !== materialFingerprint()) {
        startClipping();
      }
    }
    step.value = Math.min(Math.max(nextStep, 0), 3);
  };

  const onProviderChange = () => {
    form.speechDialect = 'auto';
    form.providerVoiceId = '';
  };

  /** 触发底层声音剪辑工作流，把已上传素材剪成训练片段 */
  const startClipping = async () => {
    if (!props.userId || !uploadedClips.value.length) {
      return;
    }
    const fingerprint = materialFingerprint();
    if (clippedMaterialFingerprint.value === fingerprint) {
      return;
    }
    try {
      clipping.value = true;
      clipError.value = '';
      const { data } = await clipVoiceMaterials({
        userId: props.userId,
        materials: uploadedClips.value.map((clip) => ({
          id: clip.id,
          name: clip.name,
          objectKey: clip.objectKey,
          publicUrl: clip.publicUrl,
        })),
      });
      const clips = (data?.clips ?? []).map((clip) => ({
        ...clip,
        selected: true,
      }));
      voiceClips.value = clips;
      clippedMaterialFingerprint.value = fingerprint;
      if (!clips.length) {
        clipError.value = '未剪出可用片段，请检查素材后重试';
      }
    } catch (error: any) {
      const message = error?.response?.data?.message;
      clipError.value = message || '片段剪辑失败，请稍后重试';
      voiceClips.value = [];
    } finally {
      clipping.value = false;
    }
  };

  const onFilesChange = async (event: Event) => {
    const target = event.target as HTMLInputElement;
    const files = Array.from(target.files ?? []);
    if (!files.length) {
      return;
    }

    try {
      uploading.value = true;
      const results = await Promise.all(
        files.map(async (file) => {
          const uploaded = await uploadAdminFile(file, {
            folder: 'voice-timbres',
          });
          // 上传成功后持久化到服务端，刷新/离开后仍可恢复
          let savedId = '';
          if (props.userId) {
            try {
              const record = await createVoiceMaterial({
                userId: props.userId,
                name: file.name,
                objectKey: uploaded.objectKey,
                publicUrl: uploaded.publicUrl,
              });
              savedId = record.data.id;
            } catch (error) {
              // 记录保存失败不阻断上传，本次会话内仍可用
            }
          }
          return {
            id: savedId,
            name: file.name,
            objectKey: uploaded.objectKey,
            publicUrl: uploaded.publicUrl,
            selected: true,
          } as UploadedClip;
        })
      );
      uploadedClips.value.push(...results);
      // 上传素材（第一步）与选择训练片段（第二步）是两个独立步骤页；
      // 上传完成后自动进入第二步并触发底层 AI 剪辑，剪出的片段在此展示勾选
      step.value = 1;
      await startClipping();
      Message.success(`已上传 ${results.length} 段音频`);
    } catch (error) {
      Message.error('音频上传失败');
    } finally {
      uploading.value = false;
      if (fileInputRef.value) {
        fileInputRef.value.value = '';
      }
    }
  };

  /** 加载该用户已保存的声音素材，恢复到勾选列表 */
  const fetchSavedMaterials = async () => {
    if (!props.userId) {
      return;
    }
    try {
      const { data } = await queryVoiceMaterials(props.userId);
      const existingKeys = new Set(
        uploadedClips.value.map((clip) => clip.objectKey)
      );
      const saved = data
        .filter((material) => !existingKeys.has(material.objectKey))
        .map((material) => ({
          id: material.id,
          name: material.name,
          objectKey: material.objectKey,
          publicUrl: material.publicUrl,
          selected: true,
        }));
      if (saved.length) {
        uploadedClips.value.push(...saved);
      }
    } catch (error) {
      // 素材加载失败不阻塞面板
    }
  };

  const removeClip = async (clip: UploadedClip) => {
    if (clip.id) {
      try {
        await deleteVoiceMaterial(clip.id);
      } catch (error: any) {
        const message = error?.response?.data?.message;
        Message.error(message || '删除素材记录失败');
        return;
      }
    }
    uploadedClips.value = uploadedClips.value.filter(
      (item) => item.objectKey !== clip.objectKey
    );
    // 素材变化后，已剪辑片段失效，等待重新剪辑
    if (clippedMaterialFingerprint.value !== materialFingerprint()) {
      voiceClips.value = [];
      clippedMaterialFingerprint.value = '';
    }
  };

  const submitTrain = async () => {
    if (!props.userId) {
      Message.error('缺少用户信息');
      return;
    }

    if (!selectedVoiceClips.value.length) {
      Message.error('请至少选择一段用于训练的片段');
      step.value = 1;
      return;
    }

    try {
      saving.value = true;
      const { data } = await mergeCreateVoiceTimbre({
        userId: props.userId,
        audioObjectKeys: selectedVoiceClips.value.map((clip) => clip.objectKey),
        name: form.name,
        provider: form.provider,
        cloneLanguage: 'zh',
        providerVoiceId: form.providerVoiceId || undefined,
        previewText: form.previewText,
        speechDialect: form.speechDialect,
        speechInstruction: form.speechInstruction || undefined,
        speechSpeed: form.speechSpeed,
        speechVolume: form.speechVolume,
        speechPitch: form.speechPitch,
      });
      submittedId.value = data?.id || '';
      Message.success('训练任务已提交，训练完成后会自动生效');
      pagination.current = 1;
      await fetchList();
    } catch (error: any) {
      const message = error?.response?.data?.message;
      Message.error(message || '训练任务提交失败');
    } finally {
      saving.value = false;
    }
  };

  const refreshAfterSubmit = () => {
    pagination.current = 1;
    fetchList();
  };

  const resetWizard = () => {
    step.value = 0;
    submittedId.value = '';
    voiceClips.value = [];
    clipping.value = false;
    clipError.value = '';
    clippedMaterialFingerprint.value = '';
    form.name = '';
    form.provider = 'qwen';
    form.providerVoiceId = '';
    form.previewText = '';
    form.speechDialect = 'auto';
    form.speechInstruction = '';
    form.speechSpeed = 1;
    form.speechVolume = 1;
    form.speechPitch = 0;
    uploadedClips.value = [];
    if (fileInputRef.value) {
      fileInputRef.value.value = '';
    }
  };

  const handleRetry = async (record: VoiceTimbreRecord) => {
    try {
      retryingId.value = record.id;
      await retryVoiceTimbre(record.id);
      Message.success('已重新发起训练');
      await fetchList();
    } catch (error: any) {
      const message = error?.response?.data?.message;
      Message.error(message || '重试失败');
    } finally {
      retryingId.value = '';
    }
  };

  const handleDelete = async (record: VoiceTimbreRecord) => {
    try {
      await deleteVoiceTimbre(record.id);
      Message.success('音色已删除');
      await fetchList();
    } catch (error: any) {
      const message = error?.response?.data?.message;
      Message.error(message || '删除失败');
    }
  };

  const previewUrlOf = (record: VoiceTimbreRecord) =>
    record.previewAudioUrl || record.audioUrl || '';

  const formatDate = (value?: string) =>
    value ? dayjs(value).format('YYYY-MM-DD HH:mm') : '-';

  const providerLabel = (provider: VoiceTimbreProviderDTO) => {
    const map: Record<VoiceTimbreProviderDTO, string> = {
      minimax: 'MiniMax',
      cosyvoice: 'CosyVoice',
      qwen: '千问',
      doubao: '豆包',
    };
    return map[provider] || provider;
  };

  const providerColor = (provider: VoiceTimbreProviderDTO) => {
    const map: Record<VoiceTimbreProviderDTO, string> = {
      minimax: 'arcoblue',
      cosyvoice: 'purple',
      qwen: 'gold',
      doubao: 'red',
    };
    return map[provider] || 'gray';
  };

  const statusLabel = (status: VoiceTimbreStatusDTO) => {
    const map: Record<VoiceTimbreStatusDTO, string> = {
      creating: '训练中',
      active: '可用',
      failed: '失败',
      disabled: '已禁用',
    };
    return map[status] || status;
  };

  const statusColor = (status: VoiceTimbreStatusDTO) => {
    const map: Record<VoiceTimbreStatusDTO, string> = {
      creating: 'orange',
      active: 'green',
      failed: 'red',
      disabled: 'gray',
    };
    return map[status] || 'gray';
  };

  if (props.userId) {
    fetchList();
    fetchSavedMaterials();
  }
</script>

<style scoped lang="scss">
  .voice-model-panel {
    display: flex;
    flex-direction: column;
    gap: 16px;

    &__card-head,
    &__wizard-head {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
    }

    &__card-title {
      font-size: 15px;
      font-weight: 600;
    }

    &__wizard {
      :deep(.arco-card-body) {
        padding-top: 8px;
      }
    }

    &__steps {
      margin-bottom: 20px;
    }

    &__step-link {
      cursor: pointer;
      transition: opacity 0.2s;

      &:hover {
        opacity: 0.75;
      }

      &.is-active {
        cursor: default;
        opacity: 1;
      }
    }

    &__step {
      padding: 4px 2px 16px;
    }

    &__step-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 12px;
      gap: 12px;
      flex-wrap: wrap;
    }

    &__upload {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin-bottom: 12px;
    }

    &__clips {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin-bottom: 8px;
    }

    &__clip {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 8px 12px;
      border: 1px solid var(--color-border-2);
      border-radius: 8px;
      flex-wrap: wrap;

      &--checked {
        border-color: rgb(var(--primary-5));
        background: rgb(var(--primary-1));
      }
    }

    &__clip-audio {
      height: 30px;
      flex: 1;
      min-width: 160px;
    }

    &__name-cell {
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }

    &__error-icon {
      color: rgb(var(--red-6));
      cursor: help;
    }

    &__audio {
      width: 180px;
      height: 32px;
    }

    &__muted {
      color: var(--color-text-3);
      font-size: 12px;
    }

    &__section-title {
      font-size: 14px;
      font-weight: 600;
      margin: 12px 0 4px;
      color: var(--color-text-1);
    }

    &__slider-row {
      display: flex;
      align-items: center;
      gap: 12px;

      :deep(.arco-slider) {
        flex: 1;
      }

      :deep(.arco-input-number) {
        width: 84px;
      }
    }

    &__confirm-alert {
      margin-bottom: 16px;
    }

    &__confirm {
      margin-bottom: 16px;

      :deep(.arco-descriptions-item-label) {
        width: 130px;
      }
    }

    &__preview-text {
      word-break: break-all;
    }

    &__submitted {
      margin-top: 8px;
    }

    &__nav {
      display: flex;
      align-items: center;
      gap: 12px;
      border-top: 1px solid var(--color-border-2);
      padding-top: 16px;
    }

    &__nav-spacer {
      flex: 1;
    }
  }
</style>
