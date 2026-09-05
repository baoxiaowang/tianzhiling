<template>
  <div
    class="voice-model-panel"
    :class="{ 'voice-model-panel--embedded': embedded }"
  >
    <!-- ① 音色列表 -->
    <a-card
      v-show="step === 3"
      class="voice-model-panel__card"
      :class="{ 'voice-model-panel__card--embedded': embedded }"
      :bordered="false"
    >
      <div class="voice-model-panel__list-actions">
        <a-button :loading="loading" @click="fetchList">刷新</a-button>
      </div>
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
                preload="metadata"
                class="voice-model-panel__audio"
                @play="pauseOtherAudio"
              />
              <span v-else class="voice-model-panel__muted">暂无试听</span>
            </template>
          </a-table-column>
          <a-table-column
            title="绑定智能体"
            data-index="boundAgentCount"
            :width="220"
          >
            <template #cell="{ record }">
              <div class="voice-model-panel__binding-cell">
                <div
                  v-if="boundAgentsOf(record.id).length"
                  class="voice-model-panel__bound-agents"
                >
                  <div
                    v-for="agent in boundAgentsOf(record.id)"
                    :key="agent.id"
                    class="voice-model-panel__bound-agent"
                  >
                    <a-tooltip :content="agent.name || '未命名 AI 亲人'">
                      <a-avatar :size="36">
                        <img
                          v-if="agent.avatar"
                          :src="agent.avatar"
                          :alt="agent.name || 'AI 亲人头像'"
                        />
                        <template v-else>
                          {{ getAgentAvatarFallback(agent.name) }}
                        </template>
                      </a-avatar>
                    </a-tooltip>
                    <a-popconfirm
                      :content="`确认解除“${
                        agent.name || '该智能体'
                      }”与此音色的绑定？`"
                      @ok="handleUnbindAgent(agent)"
                    >
                      <button
                        type="button"
                        class="voice-model-panel__unbind-button"
                        :disabled="bindingSavingAgentId === agent.id"
                        aria-label="解绑智能体"
                        @click.stop
                      >
                        ×
                      </button>
                    </a-popconfirm>
                  </div>
                </div>
                <a-button
                  v-else
                  type="text"
                  size="mini"
                  @click="openBinding(record)"
                >
                  绑定
                </a-button>
              </div>
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
                    record.status === 'failed' || record.status === 'active'
                  "
                  type="text"
                  size="small"
                  :loading="retryingId === record.id"
                  @click="handleRetry(record)"
                >
                  {{ record.status === 'active' ? '重新训练' : '重试' }}
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

      <a-steps
        :current="step + 1"
        type="arrow"
        changeable
        class="voice-model-panel__steps"
        @change="onNavigationStepChange"
      >
        <a-step
          v-for="(item, idx) in stepItems"
          :key="item.title"
          :description="item.desc"
        >
          <span
            class="voice-model-panel__step-link"
            :class="{ 'is-active': idx === step }"
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
            :class="{
              'voice-model-panel__clip--processed': clip.processed,
              'voice-model-panel__clip--checked':
                !clip.processed && clip.selected,
            }"
          >
            <a-checkbox v-model="clip.selected" :disabled="clip.processed">
              {{ clip.name }}
            </a-checkbox>
            <audio
              :src="clip.publicUrl"
              controls
              preload="metadata"
              class="voice-model-panel__clip-audio"
              @play="pauseOtherAudio"
            />
            <a-popconfirm
              :content="`确认删除声音素材“${clip.name}”？该素材生成的声音片段也会一并删除。`"
              @ok="removeClip(clip)"
            >
              <a-button type="text" size="small" status="danger">
                删除
              </a-button>
            </a-popconfirm>
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
            已剪出 {{ voiceClips.length }} 段片段，请逐段确认是否用于训练
          </a-typography-text>
          <div>
            <input
              ref="manualClipInputRef"
              type="file"
              :accept="audioAccept"
              multiple
              class="voice-model-panel__hidden-input"
              @change="onManualClipFilesChange"
            />
            <a-button
              type="primary"
              size="small"
              :loading="addingManualClips"
              @click="manualClipInputRef?.click()"
            >
              手动添加声音片段
            </a-button>
          </div>
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
            v-for="(clip, index) in voiceClips"
            :key="clip.objectKey"
            class="voice-model-panel__clip"
            :class="{
              'voice-model-panel__clip--checked':
                clip.reviewStatus === 'accepted',
            }"
          >
            <div class="voice-model-panel__clip-title">
              片段 {{ index + 1 }} ·
              {{ formatClipDuration(clip.durationSeconds) }}
            </div>
            <audio
              :src="clip.publicUrl"
              controls
              preload="metadata"
              class="voice-model-panel__clip-audio"
              @play="pauseOtherAudio"
            />
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
            <a-radio-group
              :model-value="clip.reviewStatus"
              type="button"
              size="small"
              @change="setClipReviewStatus(clip, $event)"
            >
              <a-radio value="accepted">可以使用</a-radio>
              <a-radio value="recut">再剪一下</a-radio>
              <a-radio value="unused">不使用</a-radio>
            </a-radio-group>
          </div>
          <a-button
            size="small"
            :loading="clipping"
            @click="startClipping(true)"
          >
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

      <!-- Step 3 提交训练 -->
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
                field="previewModel"
                label="声音模型"
                :rules="[{ required: true, message: '请选择声音模型' }]"
              >
                <a-select
                  v-model="form.previewModel"
                  placeholder="请选择声音模型"
                  @change="onVoiceModelChange"
                >
                  <a-option
                    v-for="option in voiceModelOptions"
                    :key="option.model"
                    :value="option.model"
                  >
                    {{ option.label }}
                  </a-option>
                </a-select>
              </a-form-item>
            </a-grid-item>
            <a-grid-item :span="24">
              <a-alert :type="voiceModelNotice.type" show-icon>
                {{ voiceModelNotice.text }}
              </a-alert>
            </a-grid-item>
            <a-grid-item v-if="isDoubaoProvider" :span="24">
              <a-form-item label="豆包 Speaker ID">
                <a-input
                  model-value="提交时优先分配剩余训练次数最多的槽位"
                  disabled
                />
              </a-form-item>
            </a-grid-item>
            <a-grid-item
              v-if="
                supportsSpeechInstruction && form.useVoiceDescriptionInstruction
              "
              :span="{ xs: 24, md: 12 }"
            >
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
            <a-grid-item
              v-if="supportsSpeechInstruction"
              :span="{ xs: 24, md: 12 }"
            >
              <a-form-item
                field="speechInstruction"
                label="声音效果指令"
                :rules="[
                  { maxLength: 50, message: '声音效果指令不能超过 50 个字符' },
                ]"
              >
                <a-textarea
                  v-model="form.speechInstruction"
                  allow-clear
                  :max-length="50"
                  show-word-limit
                  :auto-size="{ minRows: 1, maxRows: 3 }"
                  placeholder="AI 识别后自动写入，也可以手动修改"
                />
                <template #extra>
                  该指令会在试听和后续聊天语音合成时持续生效
                </template>
              </a-form-item>
            </a-grid-item>
            <a-grid-item :span="24">
              <a-form-item
                field="voiceDescription"
                label="AI 识别的音色描述"
                :rules="[
                  { maxLength: 500, message: '音色描述不能超过 500 个字符' },
                ]"
              >
                <div class="voice-model-panel__description-editor">
                  <a-textarea
                    v-model="form.voiceDescription"
                    allow-clear
                    :max-length="500"
                    show-word-limit
                    :auto-size="{ minRows: 2, maxRows: 5 }"
                    placeholder="进入本步骤后由 AI 自动分析，也可以手动修改"
                  />
                  <a-button
                    :loading="analyzingVoiceDescription"
                    :disabled="!selectedVoiceClips.length"
                    @click="analyzeSelectedVoiceDescription(true)"
                  >
                    重新识别
                  </a-button>
                </div>
                <template #extra>
                  AI 根据已选片段汇总稳定的声音听感，并提炼声音效果指令
                </template>
              </a-form-item>
            </a-grid-item>
            <a-grid-item :span="24">
              <a-form-item label="使用 AI 音色描述">
                <a-switch
                  v-model="form.useVoiceDescriptionInstruction"
                  :disabled="!supportsSpeechInstruction"
                  checked-text="使用"
                  unchecked-text="不使用"
                />
                <template #extra>
                  {{
                    supportsSpeechInstruction
                      ? '开启后，AI 提炼的声音效果指令会用于试听和后续聊天语音；关闭后仅保存音色描述，不影响声音生成'
                      : '当前声音模型不支持文字效果指令，音色描述仅用于查看和存档'
                  }}
                </template>
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
          <a-grid :cols="24" :col-gap="16" :row-gap="4">
            <a-grid-item :span="8">
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
            <a-grid-item :span="8">
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
            <a-grid-item :span="8">
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

      <!-- 第三步确认信息 -->
      <div v-show="step === 2" class="voice-model-panel__step">
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
          <a-descriptions-item label="声音模型">
            {{ selectedVoiceModelLabel }}
          </a-descriptions-item>
          <a-descriptions-item label="训练片段">
            {{ selectedVoiceClips.length }} 段
          </a-descriptions-item>
          <a-descriptions-item label="方言">
            {{ dialectLabel }}
          </a-descriptions-item>
          <a-descriptions-item v-if="isDoubaoProvider" label="豆包 Speaker ID">
            提交时按剩余训练次数自动分配
          </a-descriptions-item>
          <a-descriptions-item label="声音效果指令">
            {{
              supportsSpeechInstruction && form.useVoiceDescriptionInstruction
                ? form.speechInstruction || '已启用，暂无指令'
                : '未启用'
            }}
          </a-descriptions-item>
          <a-descriptions-item label="音色描述" :span="2">
            {{ form.voiceDescription || '尚未识别' }}
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
      </div>

      <!-- 步骤导航 -->
      <div v-if="step < 3" class="voice-model-panel__nav">
        <a-button v-if="step > 0" @click="step -= 1">上一步</a-button>
        <div class="voice-model-panel__nav-spacer" />
        <a-button
          v-if="step < 2"
          type="primary"
          :disabled="!canGoNext"
          @click="goNext"
        >
          下一步
        </a-button>
        <a-button
          v-if="step === 2"
          type="primary"
          :loading="saving"
          @click="submitTrain"
        >
          提交训练
        </a-button>
      </div>
    </a-card>

    <a-modal
      v-model:visible="recutVisible"
      title="再剪一下"
      :confirm-loading="recutting"
      @before-ok="submitRecut"
    >
      <a-typography-paragraph>
        请写明时间范围，例如“去掉开头 2 秒”或“只保留 3 秒到 8 秒”。
      </a-typography-paragraph>
      <a-textarea
        v-model="recutInstruction"
        :max-length="100"
        show-word-limit
        placeholder="请输入具体剪辑要求"
      />
    </a-modal>

    <a-modal
      v-model:visible="bindingVisible"
      :title="`选择绑定智能体${
        bindingTimbre?.name ? ` · ${bindingTimbre.name}` : ''
      }`"
      ok-text="确认绑定"
      cancel-text="取消"
      :ok-loading="bindingConfirming"
      :ok-button-props="{ disabled: !selectedBindingAgentId }"
      width="min(680px, calc(100vw - 32px))"
      @before-ok="confirmBinding"
    >
      <a-radio-group
        v-model="selectedBindingAgentId"
        class="voice-model-panel__agents"
      >
        <a-radio
          v-for="agent in userAgents"
          :key="agent.id"
          :value="agent.id"
          class="voice-model-panel__agent-option"
        >
          <div class="voice-model-panel__agent-card">
            <a-avatar :size="48" class="voice-model-panel__agent-avatar">
              <img
                v-if="agent.avatar"
                :src="agent.avatar"
                :alt="agent.name || 'AI 亲人头像'"
              />
              <template v-else>
                {{ getAgentAvatarFallback(agent.name) }}
              </template>
            </a-avatar>
            <div class="voice-model-panel__agent-main">
              <div class="voice-model-panel__agent-heading">
                <strong>{{ agent.name || '未命名 AI 亲人' }}</strong>
                <a-tag
                  v-if="agent.voiceTimbreId === bindingTimbre?.id"
                  color="green"
                >
                  当前已绑定
                </a-tag>
                <a-tag v-else-if="agent.voiceTimbreId" color="orange">
                  已绑定其他音色
                </a-tag>
                <a-tag v-else color="gray">未绑定音色</a-tag>
              </div>
              <div class="voice-model-panel__agent-meta">
                <span>用户称呼 TA：{{ agent.iCallAgent || '-' }}</span>
                <span>TA 称呼用户：{{ agent.agentCallMe || '-' }}</span>
              </div>
              <div class="voice-model-panel__agent-meta">
                创建时间：{{ formatDate(agent.createdAt) }}
              </div>
            </div>
          </div>
        </a-radio>
      </a-radio-group>
      <a-empty v-if="!userAgents.length" description="该用户暂无智能体" />
    </a-modal>
  </div>
</template>

<script lang="ts" setup>
  import { computed, reactive, ref, watch } from 'vue';
  import dayjs from 'dayjs';
  import { Message } from '@arco-design/web-vue';
  import uploadAdminFile from '@/api/storage';
  import {
    mergeCreateVoiceTimbre,
    queryVoiceTimbreList,
    retryVoiceTimbre,
    deleteVoiceTimbre,
    createVoiceMaterial,
    rollbackVoiceMaterialUpload,
    queryVoiceMaterials,
    deleteVoiceMaterial,
    clipVoiceMaterials,
    recutVoiceClip,
    saveVoiceMaterialReviewClips,
    analyzeVoiceTimbreDescription,
    VoiceClipReviewStatus,
    VoiceTimbreRecord,
  } from '@/api/voice-model';
  import { AppUserAgentRecord, queryAppUserAgents } from '@/api/app-user';
  import { updateAgent } from '@/api/agent';
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

  const voiceModelOptions: Array<{
    model: string;
    provider: VoiceTimbreProviderDTO;
    label: string;
  }> = [
    {
      model: 'qwen3-tts-vc-2026-01-22',
      provider: 'qwen',
      label: '千问 Qwen3 TTS VC（普通话）',
    },
    {
      model: 'qwen-audio-3.0-tts-plus',
      provider: 'qwen',
      label: '千问 Qwen Audio 3.0 Plus（支持方言指令）',
    },
    {
      model: 'qwen-audio-3.0-tts-flash',
      provider: 'qwen',
      label: '千问 Qwen Audio 3.0 Flash（支持方言指令）',
    },
    {
      model: 'cosyvoice-v3.5-plus',
      provider: 'cosyvoice',
      label: 'CosyVoice v3.5 Plus（支持方言指令）',
    },
    {
      model: 'seed-tts-2.0-expressive',
      provider: 'doubao',
      label: '豆包 Seed ICL 2.0（方言软控制）',
    },
    {
      model: 'speech-2.8-turbo',
      provider: 'minimax',
      label: 'MiniMax Speech 2.8 Turbo（跟随原音）',
    },
  ];

  interface UploadedClip {
    /** 已保存到后端的素材记录 id，未持久化时为空 */
    id?: string;
    name: string;
    objectKey: string;
    publicUrl: string;
    selected: boolean;
    /** 已经通过剪辑工作流生成过片段；处理后锁定，避免重复提交。 */
    processed: boolean;
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
    reviewStatus: VoiceClipReviewStatus;
  }

  const props = withDefaults(
    defineProps<{
      title?: string;
      userId?: string;
      userName?: string;
      appellation?: string;
      embedded?: boolean;
    }>(),
    {
      title: '声音模型',
      userId: '',
      userName: '',
      appellation: '妈妈',
      embedded: false,
    }
  );

  const renderList = ref<VoiceTimbreRecord[]>([]);
  const loading = ref(false);
  // 顶部导航步骤项：工作流与导航进度一一对应
  const stepItems = [
    { title: '上传声音素材', desc: '保存并管理原始素材' },
    { title: '选择声音片段', desc: '试听、返工并确认片段' },
    { title: '提交训练', desc: '填写模型与训练参数' },
    { title: '音色管理', desc: '试听、删除与绑定智能体' },
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
  const addingManualClips = ref(false);
  const analyzingVoiceDescription = ref(false);
  const lastAiSpeechInstruction = ref('');
  const trainFormRef = ref();
  const fileInputRef = ref<HTMLInputElement>();
  const manualClipInputRef = ref<HTMLInputElement>();
  const uploadedClips = ref<UploadedClip[]>([]);
  /** 剪辑出的训练片段（底层声音剪辑工作流产出） */
  const voiceClips = ref<VoiceClip[]>([]);
  const clipping = ref(false);
  const clipError = ref('');
  const pendingSelectedMaterials = computed(() =>
    uploadedClips.value.filter((clip) => !clip.processed && clip.selected)
  );

  const selectedVoiceClips = computed(() =>
    voiceClips.value.filter((clip) => clip.reviewStatus === 'accepted')
  );
  const retryingId = ref('');
  const recutVisible = ref(false);
  const recutting = ref(false);
  const recutInstruction = ref('');
  const recutTarget = ref<VoiceClip>();
  const bindingVisible = ref(false);
  const bindingConfirming = ref(false);
  const bindingSavingAgentId = ref('');
  const bindingTimbre = ref<VoiceTimbreRecord>();
  const userAgents = ref<AppUserAgentRecord[]>([]);
  const selectedBindingAgentId = ref('');

  /** 复用 C 端小程序「选择训练片段」的时长汇总与上限校验逻辑 */
  const VOICE_SERVICE_MAX_TRAINING_SECONDS = 60;
  const CLIP_SEPARATOR_SECONDS = 0.2;

  const getClipDurationSeconds = (clip: VoiceClip) => {
    const seconds = Number(clip.durationSeconds);
    return Number.isFinite(seconds) && seconds > 0 ? seconds : 12;
  };

  // 历史片段可能没有持久化时长，再剪前从媒体元数据补齐真实值。
  const readAudioDurationSeconds = (publicUrl: string) =>
    new Promise<number>((resolve, reject) => {
      if (!publicUrl) {
        reject(new Error('暂时无法读取这个片段的时长'));
        return;
      }
      const audio = new Audio();
      const timer = window.setTimeout(() => {
        cleanup();
        reject(new Error('读取片段时长超时，请稍后重试'));
      }, 10000);
      const cleanup = () => {
        window.clearTimeout(timer);
        audio.onloadedmetadata = null;
        audio.onerror = null;
        audio.removeAttribute('src');
        audio.load();
      };
      audio.preload = 'metadata';
      audio.onloadedmetadata = () => {
        const seconds = Number(audio.duration);
        cleanup();
        if (Number.isFinite(seconds) && seconds > 0) {
          resolve(seconds);
        } else {
          reject(new Error('暂时无法读取这个片段的时长'));
        }
      };
      audio.onerror = () => {
        cleanup();
        reject(new Error('暂时无法读取这个片段的时长'));
      };
      audio.src = publicUrl;
    });

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

  const DEFAULT_PREVIEW_TEXT =
    '宝贝，我好想你，最近过得好吗？有没有好好吃饭，好好睡觉。';

  const form = reactive<{
    name: string;
    provider: VoiceTimbreProviderDTO;
    previewModel: string;
    providerVoiceId: string;
    previewText: string;
    speechDialect: string;
    speechInstruction: string;
    voiceDescription: string;
    useVoiceDescriptionInstruction: boolean;
    speechSpeed: number;
    speechVolume: number;
    speechPitch: number;
  }>({
    name: '',
    provider: 'qwen',
    previewModel: 'qwen3-tts-vc-2026-01-22',
    providerVoiceId: '',
    previewText: DEFAULT_PREVIEW_TEXT,
    speechDialect: 'auto',
    speechInstruction: '',
    voiceDescription: '',
    useVoiceDescriptionInstruction: true,
    speechSpeed: 1,
    speechVolume: 1,
    speechPitch: 0,
  });

  const buildDefaultTimbreName = () => {
    const userName = props.userName.trim() || '当前用户';
    const appellation = props.appellation.trim() || '妈妈';
    const prefix = `${userName} 的${appellation}`;
    const maxVisibleSequence = renderList.value.reduce((max, item) => {
      const itemName = item.name?.trim() || '';
      if (!itemName.startsWith(`${prefix} `)) {
        return max;
      }
      const sequence = Number(itemName.slice(prefix.length + 1));
      return Number.isInteger(sequence) && sequence > max ? sequence : max;
    }, 0);
    const nextSequence = Math.max(maxVisibleSequence + 1, pagination.total + 1);
    return `${prefix} ${nextSequence}`;
  };

  const isDoubaoProvider = computed(() => form.provider === 'doubao');
  const selectedVoiceModelLabel = computed(
    () =>
      voiceModelOptions.find((option) => option.model === form.previewModel)
        ?.label || form.previewModel
  );
  const isQwenAudioProvider = computed(
    () => form.provider === 'qwen' && /^qwen-audio-/i.test(form.previewModel)
  );
  const supportsSpeechInstruction = computed(
    () =>
      isQwenAudioProvider.value ||
      form.provider === 'cosyvoice' ||
      form.provider === 'doubao'
  );
  const voiceModelNotice = computed<{
    type: 'info' | 'warning';
    text: string;
  }>(() => {
    const duration = acceptedClipDurationSeconds.value;
    if (isQwenAudioProvider.value) {
      return {
        type: duration > 20 ? 'warning' : 'info',
        text: `支持复刻音色及方言指令；建议使用口音一致的 10–20 秒素材，当前约 ${Math.round(
          duration
        )} 秒。`,
      };
    }
    if (form.provider === 'qwen') {
      return {
        type: 'warning',
        text: 'Qwen3 TTS VC 支持声音复刻，但不支持方言或声音效果指令；中文按普通话合成。',
      };
    }
    if (form.provider === 'doubao') {
      return {
        type: duration < 14 || duration > 30 ? 'warning' : 'info',
        text: `方言通过自然语言指令软控制，训练素材本身应保持同一口音；官方建议 14–30 秒，当前约 ${Math.round(
          duration
        )} 秒。`,
      };
    }
    if (form.provider === 'cosyvoice') {
      return {
        type: 'info',
        text: '支持复刻音色、方言和补充指令；方言会在试听与聊天合成时持续应用。',
      };
    }
    return {
      type: 'info',
      text: '支持声音复刻及输出层调节；不支持方言或补充指令，口音主要跟随训练素材。',
    };
  });
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
      return Boolean(form.name.trim()) && Boolean(form.previewText.trim());
    }
    return true;
  });

  const analyzeSelectedVoiceDescription = async (force = false) => {
    if (
      !selectedVoiceClips.value.length ||
      (form.voiceDescription.trim() && !force)
    ) {
      return;
    }
    try {
      analyzingVoiceDescription.value = true;
      const { data } = await analyzeVoiceTimbreDescription({
        objectKeys: selectedVoiceClips.value.map((clip) => clip.objectKey),
        transcripts: selectedVoiceClips.value
          .map((clip) => clip.transcript?.trim() || '')
          .filter(Boolean),
      });
      const previousAiSpeechInstruction = lastAiSpeechInstruction.value;
      form.voiceDescription = data.description;
      if (
        supportsSpeechInstruction.value &&
        (force ||
          !form.speechInstruction.trim() ||
          form.speechInstruction === previousAiSpeechInstruction)
      ) {
        form.speechInstruction = data.instruction;
      }
      lastAiSpeechInstruction.value = data.instruction;
      if (force) {
        Message.success(
          supportsSpeechInstruction.value
            ? '音色描述与声音效果指令已重新识别'
            : '音色描述已重新识别；当前模型不支持声音效果指令'
        );
      }
    } catch (error: any) {
      Message.warning(
        error?.response?.data?.message ||
          'AI 音色分析失败，可手动填写描述与声音效果指令'
      );
    } finally {
      analyzingVoiceDescription.value = false;
    }
  };

  watch(supportsSpeechInstruction, (supported) => {
    if (
      supported &&
      !form.speechInstruction.trim() &&
      lastAiSpeechInstruction.value
    ) {
      form.speechInstruction = lastAiSpeechInstruction.value;
    }
  });

  const persistMaterialClips = async (materialId: string) => {
    if (!materialId) return;
    await saveVoiceMaterialReviewClips(
      materialId,
      voiceClips.value.filter((clip) => clip.sourceMaterialId === materialId)
    );
  };

  const setClipReviewStatus = async (
    clip: VoiceClip,
    value: string | number | boolean
  ) => {
    const status = String(value) as VoiceClipReviewStatus | 'recut';
    if (status === 'recut') {
      recutTarget.value = clip;
      recutInstruction.value = '';
      recutVisible.value = true;
      return;
    }
    const previous = clip.reviewStatus;
    clip.reviewStatus = status;
    try {
      await persistMaterialClips(clip.sourceMaterialId);
    } catch (error) {
      clip.reviewStatus = previous;
      Message.error('片段选择保存失败');
    }
  };

  const formatClipDuration = (seconds?: number) => {
    if (!seconds || seconds < 0) {
      return '0:00';
    }
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  const pauseOtherAudio = (event: Event) => {
    const playingAudio = event.currentTarget as HTMLAudioElement;
    document
      .querySelectorAll<HTMLAudioElement>('.voice-model-panel audio')
      .forEach((audio) => {
        if (audio !== playingAudio && !audio.paused) {
          audio.pause();
        }
      });
  };

  const readAudioDuration = (file: File) =>
    new Promise<number>((resolve, reject) => {
      const objectUrl = URL.createObjectURL(file);
      const audio = new Audio();
      let timeoutId = 0;
      const cleanup = () => {
        window.clearTimeout(timeoutId);
        audio.onloadedmetadata = null;
        audio.onerror = null;
        audio.removeAttribute('src');
        audio.load();
        URL.revokeObjectURL(objectUrl);
      };
      audio.onloadedmetadata = () => {
        const duration = Number(audio.duration);
        cleanup();
        if (Number.isFinite(duration) && duration > 0) {
          resolve(duration);
          return;
        }
        reject(new Error('invalid audio duration'));
      };
      audio.onerror = () => {
        cleanup();
        reject(new Error('audio metadata load failed'));
      };
      audio.preload = 'metadata';
      audio.src = objectUrl;
      timeoutId = window.setTimeout(() => {
        cleanup();
        reject(new Error('audio metadata load timeout'));
      }, 10000);
    });

  const addManualClipFile = async (file: File) => {
    let uploadedObjectKey = '';
    let materialId = '';
    try {
      const durationSeconds = await readAudioDuration(file);
      const uploaded = await uploadAdminFile(file, {
        folder: 'voice-timbres',
      });
      uploadedObjectKey = uploaded.objectKey;
      const { data: material } = await createVoiceMaterial({
        userId: props.userId,
        name: file.name,
        objectKey: uploaded.objectKey,
        publicUrl: uploaded.publicUrl,
      });
      materialId = material.id;
      const voiceClip: VoiceClip = {
        sourceMaterialId: material.id,
        sourceName: file.name,
        objectKey: uploaded.objectKey,
        publicUrl: uploaded.publicUrl,
        durationSeconds,
        reviewStatus: 'accepted',
      };
      await saveVoiceMaterialReviewClips(material.id, [voiceClip]);
      return {
        uploadedClip: {
          id: material.id,
          name: file.name,
          objectKey: uploaded.objectKey,
          publicUrl: uploaded.publicUrl,
          selected: true,
          processed: true,
        } as UploadedClip,
        voiceClip,
      };
    } catch (error) {
      if (materialId) {
        await deleteVoiceMaterial(materialId).catch(() => undefined);
      } else if (uploadedObjectKey) {
        await rollbackVoiceMaterialUpload(uploadedObjectKey).catch(
          () => undefined
        );
      }
      return undefined;
    }
  };

  const onManualClipFilesChange = async (event: Event) => {
    const target = event.target as HTMLInputElement;
    const files = Array.from(target.files ?? []);
    if (!files.length) return;
    if (!props.userId) {
      Message.error('缺少用户信息');
      target.value = '';
      return;
    }

    try {
      addingManualClips.value = true;
      const results = (await Promise.all(files.map(addManualClipFile))).filter(
        (
          result
        ): result is {
          uploadedClip: UploadedClip;
          voiceClip: VoiceClip;
        } => Boolean(result)
      );
      uploadedClips.value.push(...results.map((item) => item.uploadedClip));
      voiceClips.value.push(...results.map((item) => item.voiceClip));
      const addedCount = results.length;
      if (addedCount) {
        Message.success(`已手动添加 ${addedCount} 段声音片段`);
      }
      if (addedCount < files.length) {
        Message.error(`${files.length - addedCount} 段声音片段添加失败`);
      }
    } finally {
      addingManualClips.value = false;
      target.value = '';
    }
  };

  const fetchList = async () => {
    if (!props.userId) {
      renderList.value = [];
      pagination.total = 0;
      return;
    }

    try {
      loading.value = true;
      const [{ data }, { data: agentData }] = await Promise.all([
        queryVoiceTimbreList({
          userId: props.userId,
          page: pagination.current,
          pageSize: pagination.pageSize,
        }),
        queryAppUserAgents(props.userId, { page: 1, pageSize: 100 }),
      ]);
      renderList.value = data.items;
      userAgents.value = agentData.items.filter(
        (agent) => !agent.messengerOfAgentId
      );
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
    // 先切换内容和顶部导航，再在第二步内展示剪辑进度。
    if (step.value === 0) {
      step.value = 1;
      if (pendingSelectedMaterials.value.length) {
        startClipping();
      }
      return;
    }
    // Step 2 → 3 时先校验表单字段
    if (step.value === 2) {
      const errors = await trainFormRef.value?.validate();
      if (errors) {
        return;
      }
    }
    if (step.value === 1 && !form.name.trim()) {
      form.name = buildDefaultTimbreName();
    }
    step.value = Math.min(step.value + 1, 3);
    if (step.value === 2) {
      analyzeSelectedVoiceDescription();
    }
  };

  /** 顶部导航步骤可点击：工作流与导航进度对齐 */
  const onNavigationStepChange = (stepNumber: number) => {
    onStepChange(stepNumber - 1);
  };

  const onStepChange = (nextStep: number) => {
    const previousStep = step.value;
    if (previousStep === 3 && nextStep === 0) {
      resetWizard();
      return;
    }
    step.value = Math.min(Math.max(nextStep, 0), 3);
    if (step.value === 2 && !form.name.trim()) {
      form.name = buildDefaultTimbreName();
    }
    if (step.value === 2) {
      analyzeSelectedVoiceDescription();
    }
    // 进入「选择训练片段」时，仅处理新上传且已勾选的素材。
    if (nextStep === 1 && previousStep === 0 && uploadedClips.value.length) {
      if (pendingSelectedMaterials.value.length) {
        startClipping();
      }
    }
  };

  const onVoiceModelChange = (value: unknown) => {
    const selected = voiceModelOptions.find(
      (option) => option.model === String(value)
    );
    if (selected) {
      form.provider = selected.provider;
    }
    form.speechDialect = 'auto';
    form.speechInstruction = '';
    form.providerVoiceId = '';
  };

  /** 触发底层声音剪辑工作流，把已上传素材剪成训练片段 */
  const startClipping = async (force = false) => {
    const materialsToClip = force
      ? uploadedClips.value
      : pendingSelectedMaterials.value;
    if (!props.userId || !materialsToClip.length) {
      return;
    }
    try {
      clipping.value = true;
      clipError.value = '';
      const { data } = await clipVoiceMaterials({
        userId: props.userId,
        materials: materialsToClip.map((clip) => ({
          id: clip.id,
          name: clip.name,
          objectKey: clip.objectKey,
          publicUrl: clip.publicUrl,
        })),
      });
      const clips = (data?.clips ?? []).map((clip) => ({
        ...clip,
        reviewStatus: 'pending' as VoiceClipReviewStatus,
      }));

      const processedMaterialIds = new Set(
        clips.map((clip) => clip.sourceMaterialId).filter(Boolean)
      );
      const retainedClips = voiceClips.value.filter(
        (clip) => !processedMaterialIds.has(clip.sourceMaterialId)
      );
      // 正常追加剪辑时保留旧片段顺序，新片段统一追加在末尾。
      voiceClips.value = [...retainedClips, ...clips];
      const processedMaterials = materialsToClip.filter(
        (material) => material.id && processedMaterialIds.has(material.id)
      );
      processedMaterials.forEach((material) => {
        material.processed = true;
        material.selected = true;
      });
      await Promise.all(
        processedMaterials.map((material) =>
          persistMaterialClips(material.id || '')
        )
      );
      if (!clips.length) {
        clipError.value = '未剪出可用片段，请检查素材后重试';
      }
    } catch (error: any) {
      const message = error?.response?.data?.message;
      clipError.value = message || '片段剪辑失败，请稍后重试';
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
          try {
            if (!props.userId) {
              throw new Error('missing user id');
            }
            const record = await createVoiceMaterial({
              userId: props.userId,
              name: file.name,
              objectKey: uploaded.objectKey,
              publicUrl: uploaded.publicUrl,
            });
            return {
              id: record.data.id,
              name: file.name,
              objectKey: uploaded.objectKey,
              publicUrl: uploaded.publicUrl,
              selected: true,
              processed: false,
            } as UploadedClip;
          } catch (error) {
            await rollbackVoiceMaterialUpload(uploaded.objectKey).catch(
              () => undefined
            );
            throw error;
          }
        })
      );
      uploadedClips.value.push(...results);
      Message.success(`已上传并保存 ${results.length} 份声音素材`);
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
      const orderedMaterials = [...data].sort(
        (left, right) =>
          new Date(left.createdAt).getTime() -
          new Date(right.createdAt).getTime()
      );
      const existingKeys = new Set(
        uploadedClips.value.map((clip) => clip.objectKey)
      );
      const saved = orderedMaterials
        .filter((material) => !existingKeys.has(material.objectKey))
        .map((material) => ({
          id: material.id,
          name: material.name,
          objectKey: material.objectKey,
          publicUrl: material.publicUrl,
          selected: true,
          processed: Boolean(material.reviewClips?.length),
        }));
      if (saved.length) {
        uploadedClips.value.push(...saved);
      }
      const restoredClips = orderedMaterials.flatMap((material) =>
        (material.reviewClips ?? []).map((clip) => ({
          ...clip,
          sourceMaterialId: material.id,
          reviewStatus: clip.reviewStatus || 'pending',
        }))
      );
      if (restoredClips.length) {
        voiceClips.value = restoredClips;
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
    // 删除某份素材时只删除它产出的片段，其他素材与片段保持不变。
    voiceClips.value = voiceClips.value.filter(
      (item) => item.sourceMaterialId !== clip.id
    );
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
      await mergeCreateVoiceTimbre({
        userId: props.userId,
        audioObjectKeys: selectedVoiceClips.value.map((clip) => clip.objectKey),
        name: form.name,
        provider: form.provider,
        previewModel: form.previewModel,
        cloneLanguage: 'zh',
        providerVoiceId: isDoubaoProvider.value
          ? undefined
          : form.providerVoiceId || undefined,
        previewText: form.previewText,
        speechDialect: supportsSpeechInstruction.value
          ? form.speechDialect
          : 'auto',
        speechInstruction:
          supportsSpeechInstruction.value && form.useVoiceDescriptionInstruction
            ? form.speechInstruction || undefined
            : undefined,
        speechSpeed: form.speechSpeed,
        speechVolume: form.speechVolume,
        speechPitch: form.speechPitch,
        voiceDescription: form.voiceDescription || undefined,
      });
      Message.success('训练任务已提交，训练完成后会自动生效');
      pagination.current = 1;
      await fetchList();
      step.value = 3;
    } catch (error: any) {
      const message = error?.response?.data?.message;
      Message.error(message || '训练任务提交失败');
    } finally {
      saving.value = false;
    }
  };

  const resetWizard = () => {
    step.value = 0;
    clipping.value = false;
    clipError.value = '';
    form.name = '';
    form.provider = 'qwen';
    form.previewModel = 'qwen3-tts-vc-2026-01-22';
    form.providerVoiceId = '';
    form.previewText = DEFAULT_PREVIEW_TEXT;
    form.speechDialect = 'auto';
    form.speechInstruction = '';
    form.voiceDescription = '';
    form.useVoiceDescriptionInstruction = true;
    lastAiSpeechInstruction.value = '';
    form.speechSpeed = 1;
    form.speechVolume = 1;
    form.speechPitch = 0;
    if (fileInputRef.value) {
      fileInputRef.value.value = '';
    }
  };

  const submitRecut = async () => {
    const target = recutTarget.value;
    const instruction = recutInstruction.value.trim();
    if (!target || !instruction) {
      Message.error('请输入具体剪辑要求');
      return false;
    }
    try {
      recutting.value = true;
      const savedDuration = Number(target.durationSeconds);
      const durationSeconds =
        Number.isFinite(savedDuration) && savedDuration > 0
          ? savedDuration
          : await readAudioDurationSeconds(target.publicUrl);
      const { data } = await recutVoiceClip({
        objectKey: target.objectKey,
        fileName: target.sourceName || '片段.wav',
        durationSeconds,
        instruction,
        sourceMaterialId: target.sourceMaterialId,
        sourceName: target.sourceName,
      });
      const index = voiceClips.value.findIndex(
        (clip) => clip.objectKey === target.objectKey
      );
      if (index >= 0) {
        voiceClips.value[index] = {
          ...data.clip,
          sourceMaterialId: target.sourceMaterialId,
          sourceName: target.sourceName,
          reviewStatus: 'pending',
        };
      }
      await persistMaterialClips(target.sourceMaterialId);
      Message.success('片段已重新剪好，请试听后确认');
      recutVisible.value = false;
      return true;
    } catch (error: any) {
      Message.error(
        error?.response?.data?.message || error?.message || '片段返工失败'
      );
      return false;
    } finally {
      recutting.value = false;
    }
  };

  const boundAgentsOf = (timbreId: string) =>
    userAgents.value.filter((agent) => agent.voiceTimbreId === timbreId);

  const openBinding = async (record: VoiceTimbreRecord) => {
    bindingTimbre.value = record;
    selectedBindingAgentId.value = '';
    const { data } = await queryAppUserAgents(props.userId, {
      page: 1,
      pageSize: 100,
    });
    const bindableAgents = data.items.filter(
      (agent) => !agent.messengerOfAgentId
    );
    userAgents.value = bindableAgents;
    bindingVisible.value = true;
  };

  const confirmBinding = async () => {
    const timbre = bindingTimbre.value;
    const agent = userAgents.value.find(
      (item) => item.id === selectedBindingAgentId.value
    );
    if (!timbre || !agent) return false;
    try {
      bindingConfirming.value = true;
      await updateAgent(agent.id, { voiceTimbreId: timbre.id });
      await fetchList();
      Message.success(`已绑定“${agent.name || '该智能体'}”`);
      return true;
    } catch (error: any) {
      Message.error(error?.response?.data?.message || '智能体绑定失败');
      return false;
    } finally {
      bindingConfirming.value = false;
    }
  };

  const handleUnbindAgent = async (agent: AppUserAgentRecord) => {
    try {
      bindingSavingAgentId.value = agent.id;
      await updateAgent(agent.id, { voiceTimbreId: '' });
      await fetchList();
      Message.success(`已解绑“${agent.name || '该智能体'}”`);
    } catch (error: any) {
      Message.error(error?.response?.data?.message || '智能体解绑失败');
    } finally {
      bindingSavingAgentId.value = '';
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

  const getAgentAvatarFallback = (name?: string) =>
    name?.trim().slice(0, 1) || '亲';

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

    &__card {
      order: 2;
    }

    &__list-actions {
      display: flex;
      justify-content: flex-end;
      margin-bottom: 12px;
    }

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
      order: 1;

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

    &__hidden-input {
      display: none;
    }

    &__description-editor {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      width: 100%;

      :deep(.arco-textarea-wrapper) {
        flex: 1;
      }
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

      &--processed {
        border-color: var(--color-border-1);
        background: var(--color-fill-2);

        audio,
        :deep(.arco-checkbox) {
          opacity: 0.65;
        }
      }
    }

    &__clip-audio {
      height: 30px;
      flex: 1;
      min-width: 160px;
    }

    &__clip-title {
      min-width: 180px;
      font-weight: 500;
    }

    &__agents {
      display: flex;
      flex-direction: column;
      gap: 12px;
      margin-top: 16px;
    }

    &__agent-option {
      width: 100%;
      padding: 12px;
      border: 1px solid var(--color-border-2);
      border-radius: 8px;
      transition: border-color 0.2s, background-color 0.2s;

      &:hover {
        border-color: rgb(var(--primary-5));
        background: var(--color-fill-1);
      }

      :deep(.arco-radio-label) {
        flex: 1;
        min-width: 0;
      }
    }

    &__binding-cell,
    &__bound-agents {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }

    &__bound-agent {
      position: relative;
      line-height: 1;
    }

    &__unbind-button {
      position: absolute;
      top: -6px;
      right: -6px;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 18px;
      height: 18px;
      padding: 0;
      border: 2px solid var(--color-bg-2);
      border-radius: 50%;
      color: #fff;
      background: rgb(var(--red-6));
      font-size: 15px;
      line-height: 14px;
      cursor: pointer;

      &:hover {
        background: rgb(var(--red-5));
      }

      &:disabled {
        cursor: wait;
        opacity: 0.6;
      }
    }

    &__agent-card {
      display: flex;
      align-items: center;
      gap: 12px;
      min-width: 0;
    }

    &__agent-avatar {
      flex: 0 0 auto;
    }

    &__agent-main {
      flex: 1;
      min-width: 0;
    }

    &__agent-heading,
    &__agent-meta {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }

    &__agent-heading {
      margin-bottom: 6px;
      color: var(--color-text-1);
    }

    &__agent-meta {
      color: var(--color-text-3);
      font-size: 12px;
      line-height: 20px;
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
