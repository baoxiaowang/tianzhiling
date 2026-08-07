<template>
  <page-scaffold
    class="voice-service-page"
    background="#f5f6f8"
    bottom-background="#ffffff"
    body-padding="0"
    :scroll="true"
    :scroll-into-view="scrollIntoView"
    :scroll-with-animation="true"
    :safe-area-top="false"
    require-auth
    auth-loading-text="正在恢复声音服务..."
  >
    <template #header>
      <app-bar
        title="声音服务"
        background="#ffffff"
        border-color="#eeeeee"
        @back="handleBack"
      />
    </template>

    <view v-if="isCheckingAuth || isLoading" class="voice-service-state">
      <Loading color="#77728f" size="22" />
      <text class="voice-service-state__text">小使者正在赶来...</text>
    </view>

    <view v-else-if="loadError && !session" class="voice-service-state">
      <text class="voice-service-state__title">声音服务暂时没有连接上</text>
      <text class="voice-service-state__text">{{ loadError }}</text>
      <nut-button
        shape="round"
        type="primary"
        size="small"
        @click="handleRetry"
      >
        重新连接
      </nut-button>
    </view>

    <view v-else class="voice-service-content">
      <view class="voice-service-messenger">
        <view class="voice-service-messenger__visual">
          <view class="voice-service-messenger__halo" />
          <image
            class="voice-service-messenger__image"
            :src="messengerImageUrl"
            mode="aspectFit"
          />
        </view>
        <text class="voice-service-messenger__name">天之灵小使者</text>
        <text class="voice-service-messenger__status">{{
          serviceStatusText
        }}</text>
      </view>

      <view id="voice-service-prompt" class="voice-service-prompt">
        <template v-if="isSendingMessage">
          <text class="voice-service-prompt__waiting"
            >小使者正在理解你的问题</text
          >
          <view class="voice-service-thinking-dots">
            <view />
            <view />
            <view />
          </view>
        </template>
        <view v-else class="voice-service-prompt__content">
          <view class="voice-service-prompt__copy">
            <text class="voice-service-prompt__text">{{
              displayedAssistantPrompt
            }}</text>
          </view>
          <view
            class="voice-service-prompt__speech"
            :class="{
              'voice-service-prompt__speech--active': isAssistantSpeechPlaying,
            }"
            :aria-label="assistantSpeechControlLabel"
            @tap="handleAssistantSpeechTap"
          >
            <Loading
              v-if="isAssistantSpeechLoading"
              color="#77728f"
              size="16"
            />
            <PlayStop
              v-else-if="isAssistantSpeechPlaying"
              color="#ffffff"
              size="15"
            />
            <Voice v-else color="#77728f" size="17" />
          </view>
        </view>
      </view>

      <view v-if="showMaterialGuide" class="voice-service-workspace">
        <view
          v-if="completedTimbreCount > 0"
          class="voice-service-library-entry"
          @tap="openVoiceLibrary"
        >
          <view class="voice-service-library-entry__icon">
            <Voice color="#ffffff" size="18" />
          </view>
          <view class="voice-service-library-entry__copy">
            <text class="voice-service-library-entry__title">我的音色</text>
            <text class="voice-service-library-entry__desc">
              已保存 {{ completedTimbreCount }} 个音色
            </text>
          </view>
          <text class="voice-service-library-entry__action">查看</text>
          <Right color="#8a8690" size="16" />
        </view>

        <view v-if="materialItems.length" class="voice-service-materials">
          <view class="voice-service-section-heading">
            <text class="voice-service-section-heading__title">声音素材</text>
            <text class="voice-service-section-heading__meta">
              {{ getMaterialSectionMeta() }}
            </text>
          </view>
          <view
            v-for="item in materialItems"
            :key="item.id"
            class="voice-service-material"
            :class="{
              'voice-service-material--attention':
                item.status === 'failed' || item.status === 'oversized',
            }"
          >
            <view class="voice-service-material__icon">
              <Voice color="#77728f" size="18" />
            </view>
            <view class="voice-service-material__copy">
              <text class="voice-service-material__name">{{ item.name }}</text>
              <text class="voice-service-material__status">
                {{ getMaterialStatusText(item) }}
              </text>
              <view
                v-if="item.status === 'uploading' || item.status === 'saving'"
                class="voice-service-material__progress"
              >
                <view
                  class="voice-service-material__progress-bar"
                  :style="{ width: `${item.progressPercent ?? 0}%` }"
                />
              </view>
            </view>
            <button
              v-if="!item.persisted && item.status === 'failed'"
              class="voice-service-material__retry"
              :disabled="isDataDeletionIncomplete"
              @tap="handleRetryLocalUpload(item.id)"
            >
              重试
            </button>
            <button
              v-if="canRemoveMaterials && item.persisted"
              class="voice-service-icon-button"
              aria-label="删除素材"
              @tap="handleRemoveMaterial(item.id)"
            >
              <Del color="#a19baa" size="18" />
            </button>
            <button
              v-else-if="
                !item.persisted &&
                item.status !== 'uploading' &&
                item.status !== 'saving' &&
                item.status !== 'queued'
              "
              class="voice-service-icon-button"
              aria-label="移除本地素材"
              @tap="handleRemoveLocalUpload(item.id)"
            >
              <Del color="#a19baa" size="18" />
            </button>
          </view>
        </view>

        <view class="voice-service-material-actions">
          <nut-button
            class="voice-service-material-actions__secondary"
            shape="round"
            plain
            :disabled="isSubmittingMaterials || isDataDeletionIncomplete"
            @click="handleAddMaterials"
          >
            <Plus size="17" />
            {{ materialItems.length ? "继续添加素材" : "添加声音素材" }}
          </nut-button>
          <nut-button
            class="voice-service-material-actions__primary"
            shape="round"
            type="primary"
            :loading="isSubmittingMaterials"
            :disabled="
              (!hasPersistedMaterials && activeLocalUploadCount === 0) ||
              isDataDeletionIncomplete
            "
            @click="handleSubmitMaterials('assisted')"
          >
            智能识别并剪辑
          </nut-button>
          <nut-button
            class="voice-service-material-actions__secondary"
            shape="round"
            plain
            :loading="isSubmittingMaterials"
            :disabled="
              !hasPersistedMaterials ||
              isUploadingMaterials ||
              isDataDeletionIncomplete
            "
            @click="handleSubmitMaterials('ready_to_use')"
          >
            素材已经剪好，直接使用
          </nut-button>
        </view>
      </view>

      <view
        v-else-if="session?.status === 'analyzing'"
        class="voice-service-workspace"
      >
        <view class="voice-service-processing">
          <view class="voice-service-processing__orb">
            <view class="voice-service-processing__ring" />
            <Scan2 color="#77728f" size="24" />
          </view>
          <text class="voice-service-processing__title">
            {{
              session.processingMode === "ready_to_use"
                ? "小使者正在整理格式"
                : "小使者正在识别与剪辑"
            }}
          </text>
          <text class="voice-service-processing__text">
            {{
              session.processingMode === "ready_to_use"
                ? "会保留你剪好的内容，只统一成声音训练需要的格式。"
                : "我会区分不同说话人，按完整语句剪出片段，预计需要 2–3 分钟。"
            }}
          </text>
          <text class="voice-service-processing__hint"
            >整理完成后，我会请你逐段试听确认</text
          >
          <view
            class="voice-service-back-step"
            :class="{
              'voice-service-back-step--disabled': isReturningToMaterials,
            }"
            role="button"
            :aria-disabled="isReturningToMaterials"
            @tap="handleReturnToMaterials"
            @click="handleReturnToMaterials"
          >
            <Loading v-if="isReturningToMaterials" color="#77728f" size="14" />
            <text>{{
              isReturningToMaterials ? "正在返回" : "返回上一步"
            }}</text>
          </view>
        </view>
      </view>

      <view
        v-else-if="session?.status === 'reviewing'"
        class="voice-service-workspace"
      >
        <view class="voice-service-section-heading">
          <view>
            <text class="voice-service-section-heading__title"
              >听听剪辑结果</text
            >
            <text class="voice-service-section-heading__desc">
              精选清楚、自然的片段
            </text>
          </view>
          <text class="voice-service-section-heading__meta">
            {{
              reviewClips.length
                ? `${reviewedClipCount}/${reviewClips.length}`
                : "0 段可用"
            }}
          </text>
        </view>

        <view
          class="voice-service-back-step voice-service-back-step--review"
          :class="{
            'voice-service-back-step--disabled': isReturningToMaterials,
          }"
          role="button"
          :aria-disabled="isReturningToMaterials"
          @tap="handleReturnToMaterials"
          @click="handleReturnToMaterials"
        >
          <Loading v-if="isReturningToMaterials" color="#77728f" size="14" />
          <text>{{ isReturningToMaterials ? "正在返回" : "返回上一步" }}</text>
        </view>

        <view v-if="reviewClips.length" class="voice-service-selection-guide">
          <view class="voice-service-selection-guide__row">
            <text class="voice-service-selection-guide__selected">
              已选 {{ acceptedClipDurationText }}
            </text>
            <text class="voice-service-selection-guide__limit">
              建议不超过 1 分钟
            </text>
          </view>
          <view class="voice-service-selection-guide__track">
            <view
              class="voice-service-selection-guide__bar"
              :style="{ width: `${acceptedClipProgressPercent}%` }"
            />
          </view>
        </view>

        <view v-if="acceptedClipCount" class="voice-service-review-start">
          <nut-button
            block
            shape="round"
            type="primary"
            :loading="isStartingTraining"
            @click="handleStartTraining"
          >
            开始训练
          </nut-button>
        </view>

        <view
          v-for="(clip, index) in reviewClips"
          :key="clip.id"
          :id="`voice-service-clip-${clip.id}`"
          class="voice-service-clip"
          :class="{
            'voice-service-clip--accepted': clip.reviewStatus === 'accepted',
            'voice-service-clip--rejected': clip.reviewStatus === 'rejected',
          }"
        >
          <view class="voice-service-clip__top">
            <button
              class="voice-service-clip__play"
              :class="{
                'voice-service-clip__play--active': playingAudioId === clip.id,
                'voice-service-clip__play--loading':
                  downloadingAudioId === clip.id,
              }"
              :aria-label="
                downloadingAudioId === clip.id
                  ? '取消加载声音片段'
                  : playingAudioId === clip.id
                  ? '停止播放声音片段'
                  : '播放声音片段'
              "
              @tap="
                handlePlayAudio(clip.publicUrl, clip.id, clip.durationSeconds)
              "
            >
              <Loading
                v-if="downloadingAudioId === clip.id"
                color="#ffffff"
                size="15"
              />
              <PlayStop
                v-if="playingAudioId === clip.id"
                color="#ffffff"
                size="16"
              />
              <PlayStart
                v-else-if="downloadingAudioId !== clip.id"
                color="#ffffff"
                size="16"
              />
            </button>
            <view class="voice-service-clip__copy">
              <text class="voice-service-clip__name"
                >声音片段 {{ index + 1 }}</text
              >
              <text class="voice-service-clip__source">
                {{ buildClipMeta(clip) }}
              </text>
            </view>
            <view
              v-if="clip.reviewStatus !== 'pending'"
              class="voice-service-clip__result"
            >
              <Check
                v-if="clip.reviewStatus === 'accepted'"
                color="#1b8f70"
                size="17"
              />
              <Close v-else color="#9ca3af" size="17" />
            </view>
          </view>
          <view
            v-if="downloadingAudioId === clip.id"
            class="voice-service-audio-progress"
          >
            <view class="voice-service-audio-progress__row">
              <text>正在加载试听</text>
              <text>{{ audioDownloadProgress }}%</text>
            </view>
            <view class="voice-service-audio-progress__track">
              <view
                class="voice-service-audio-progress__bar"
                :style="{ width: `${audioDownloadProgress}%` }"
              />
            </view>
          </view>
          <view
            v-else-if="playingAudioId === clip.id"
            class="voice-service-audio-progress voice-service-audio-progress--playing"
          >
            <view class="voice-service-audio-progress__row">
              <text>{{ formatPlaybackTime(audioPlaybackCurrentSeconds) }}</text>
              <text>{{
                formatPlaybackTime(audioPlaybackDurationSeconds)
              }}</text>
            </view>
            <view class="voice-service-audio-progress__track">
              <view
                class="voice-service-audio-progress__bar"
                :style="{ width: `${audioPlaybackProgressPercent}%` }"
              />
            </view>
          </view>
          <view
            v-if="clip.qualityIssues?.length"
            class="voice-service-clip-quality"
          >
            <text
              v-for="issue in clip.qualityIssues ?? []"
              :key="issue.code"
              class="voice-service-clip-quality__notice"
            >
              {{ getVoiceClipIssueDisplayText(issue) }}
            </text>
          </view>
          <view
            v-if="isClipRecutActive(clip)"
            class="voice-service-clip-recut voice-service-clip-recut--active"
          >
            <view class="voice-service-clip-recut__heading">
              <Loading color="#77728f" size="15" />
              <text>正在单独重新剪辑这一段</text>
            </view>
            <text class="voice-service-clip-recut__instruction">
              {{ clip.recutInstruction }}
            </text>
          </view>
          <view
            v-else-if="clip.recutStatus === 'failed'"
            class="voice-service-clip-recut voice-service-clip-recut--failed"
          >
            <text class="voice-service-clip-recut__heading">
              原片段已保留
            </text>
            <text class="voice-service-clip-recut__instruction">
              {{ clip.recutFailureReason || "这次没有剪好，请重新填写剪法" }}
            </text>
          </view>
          <text
            v-else-if="clip.recutStatus === 'completed'"
            class="voice-service-clip-recut__completed"
          >
            已按要求重新剪好，请再次试听后选择
          </text>
          <view
            v-if="!isClipRecutActive(clip)"
            class="voice-service-clip__actions"
          >
            <button
              class="voice-service-clip__action voice-service-clip__action--accept"
              :class="{
                'voice-service-clip__action--selected':
                  clip.reviewStatus === 'accepted',
              }"
              @tap="handleReviewClip(clip.id, 'accepted')"
            >
              可以使用
            </button>
            <button
              class="voice-service-clip__action"
              :class="{
                'voice-service-clip__action--selected':
                  clip.reviewStatus === 'rejected' &&
                  isVoiceClipRecutReason(clip.rejectionReason),
              }"
              @tap="handleOpenRecutDialog(clip)"
            >
              再剪一下
            </button>
            <button
              class="voice-service-clip__action"
              :class="{
                'voice-service-clip__action--selected':
                  clip.reviewStatus === 'rejected' &&
                  isVoiceClipUnusedReason(clip.rejectionReason),
              }"
              @tap="
                handleReviewClip(
                  clip.id,
                  'rejected',
                  VOICE_SERVICE_CLIP_UNUSED_REASON
                )
              "
            >
              不使用
            </button>
          </view>
        </view>

        <view
          v-if="filteredClips.length"
          class="voice-service-filtered-section"
        >
          <text class="voice-service-filtered-section__title">
            已提前排除 {{ filteredClips.length }} 段
          </text>
          <text class="voice-service-filtered-section__desc">
            这些片段明显不适合训练，不需要你再逐段试听。
          </text>
          <view
            v-for="(clip, index) in filteredClips"
            :key="clip.id"
            class="voice-service-filtered-clip"
          >
            <view class="voice-service-filtered-clip__top">
              <text class="voice-service-filtered-clip__name">
                未使用片段 {{ index + 1 }}
              </text>
              <text class="voice-service-filtered-clip__source">
                {{ buildFilteredClipMeta(clip) }}
              </text>
            </view>
            <text
              v-for="issue in clip.qualityIssues"
              :key="issue.code"
              class="voice-service-filtered-clip__reason"
            >
              {{ getVoiceClipIssueDisplayText(issue) }}
            </text>
          </view>
        </view>

        <view
          v-if="showReviewSummary && !acceptedClipCount"
          class="voice-service-review-summary"
        >
          <text class="voice-service-review-summary__title">
            没有找到可用片段
          </text>
          <text class="voice-service-review-summary__text">
            没有可用片段，可以继续添加其他素材。
          </text>
          <nut-button
            block
            shape="round"
            type="primary"
            :loading="isSubmittingMaterials"
            @click="handleSubmitMaterials('assisted')"
          >
            重新智能整理
          </nut-button>
          <nut-button block shape="round" plain @click="handleAddMaterials">
            添加其他素材
          </nut-button>
        </view>
      </view>

      <view
        v-else-if="session?.status === 'training'"
        class="voice-service-workspace"
      >
        <view class="voice-service-processing">
          <view
            class="voice-service-processing__orb voice-service-processing__orb--training"
          >
            <view class="voice-service-processing__ring" />
            <Voice color="#77728f" size="24" />
          </view>
          <text class="voice-service-processing__title"
            >小使者正在生成声音</text
          >
          <text class="voice-service-processing__text">
            正在使用你确认的声音片段免费训练。完成后先试听，觉得合适再到会员服务查看是否需要开通声音服务。
          </text>
          <view
            class="voice-service-back-step"
            :class="{
              'voice-service-back-step--disabled': isReturningToReview,
            }"
            role="button"
            :aria-disabled="isReturningToReview"
            @tap="handleReturnToReview"
            @click="handleReturnToReview"
          >
            <Loading v-if="isReturningToReview" color="#77728f" size="14" />
            <text>{{ isReturningToReview ? "正在返回" : "返回上一步" }}</text>
          </view>
        </view>
      </view>

      <view
        v-else-if="
          session?.status === 'preview_ready' || session?.status === 'completed'
        "
        class="voice-service-workspace"
      >
        <view class="voice-service-preview">
          <text class="voice-service-preview__eyebrow">声音已经生成</text>
          <text class="voice-service-preview__title">现在方便听一听吗？</text>
          <text class="voice-service-preview__text">
            先试听确认熟悉的感觉，再选择要使用这个声音的天之灵。
          </text>
          <view class="voice-service-preview__retention-notice">
            <text>
              受大模型厂家限制，生成的音色暂存 7 天；7 天内未使用，厂家会自动清理。
            </text>
          </view>
          <button
            class="voice-service-preview__play"
            @tap="handlePlayAudio(session.previewAudioUrl, PREVIEW_AUDIO_ID)"
          >
            <Loading
              v-if="downloadingAudioId === PREVIEW_AUDIO_ID"
              color="#ffffff"
              size="16"
            />
            <PlayStop
              v-if="playingAudioId === PREVIEW_AUDIO_ID"
              color="#ffffff"
              size="18"
            />
            <PlayStart
              v-else-if="downloadingAudioId !== PREVIEW_AUDIO_ID"
              color="#ffffff"
              size="18"
            />
            <text>{{
              downloadingAudioId === PREVIEW_AUDIO_ID
                ? `加载中 ${audioDownloadProgress}%`
                : playingAudioId === PREVIEW_AUDIO_ID
                ? "停止试听"
                : "播放试听"
            }}</text>
          </button>
          <view
            v-if="
              downloadingAudioId === PREVIEW_AUDIO_ID ||
              playingAudioId === PREVIEW_AUDIO_ID
            "
            class="voice-service-audio-progress voice-service-audio-progress--preview"
          >
            <view class="voice-service-audio-progress__row">
              <text>{{
                downloadingAudioId === PREVIEW_AUDIO_ID
                  ? "正在加载试听"
                  : formatPlaybackTime(audioPlaybackCurrentSeconds)
              }}</text>
              <text>{{
                downloadingAudioId === PREVIEW_AUDIO_ID
                  ? `${audioDownloadProgress}%`
                  : formatPlaybackTime(audioPlaybackDurationSeconds)
              }}</text>
            </view>
            <view class="voice-service-audio-progress__track">
              <view
                class="voice-service-audio-progress__bar"
                :style="{
                  width: `${
                    downloadingAudioId === PREVIEW_AUDIO_ID
                      ? audioDownloadProgress
                      : audioPlaybackProgressPercent
                  }%`,
                }"
              />
            </view>
          </view>
          <view
            v-if="session.status === 'preview_ready'"
            class="voice-service-back-step"
            :class="{
              'voice-service-back-step--disabled': isReturningToReview,
            }"
            role="button"
            :aria-disabled="isReturningToReview"
            @tap="handleReturnToReview"
            @click="handleReturnToReview"
          >
            <Loading v-if="isReturningToReview" color="#77728f" size="14" />
            <text>{{ isReturningToReview ? "正在返回" : "返回上一步" }}</text>
          </view>
        </view>

        <view class="voice-service-agent-select">
          <view class="voice-service-section-heading">
            <view>
              <text class="voice-service-section-heading__title"
                >选择天之灵</text
              >
              <text class="voice-service-section-heading__desc">
                {{
                  session.voiceAccessEligible
                    ? "已有声音权益，选择后直接接入"
                    : "选择使用对象，开通声音权益后自动接入"
                }}
              </text>
            </view>
          </view>
          <view
            v-if="isLoadingAgents"
            class="voice-service-agent-select__loading"
          >
            <Loading color="#77728f" size="18" />
            <text>正在加载天之灵...</text>
          </view>
          <view v-else-if="agents.length" class="voice-service-agents">
            <view
              v-for="agent in agents"
              :key="agent.id"
              class="voice-service-agent"
              :class="{
                'voice-service-agent--selected': agent.id === selectedAgentId,
              }"
              @tap="handleSelectAgent(agent.id)"
            >
              <image
                v-if="agent.avatar"
                class="voice-service-agent__avatar"
                :src="agent.avatar"
                mode="aspectFill"
              />
              <view
                v-else
                class="voice-service-agent__avatar voice-service-agent__avatar--fallback"
              >
                {{ buildAgentFallback(agent.name) }}
              </view>
              <view class="voice-service-agent__copy">
                <text class="voice-service-agent__name">{{
                  agent.name || "未命名"
                }}</text>
                <text class="voice-service-agent__hint">
                  {{
                    agent.id === selectedAgentId
                      ? session.voiceBindingStatus === "bound"
                        ? "声音已接入"
                        : session.voiceBindingStatus ===
                          "existing_voice_preserved"
                        ? "已保留原有声音"
                        : "已选择，等待接入"
                      : "选择他"
                  }}
                </text>
              </view>
              <Check
                v-if="agent.id === selectedAgentId"
                color="#1b8f70"
                size="19"
              />
              <Right v-else color="#b7bac1" size="17" />
            </view>
          </view>
          <view v-else class="voice-service-agent-select__empty">
            <text>还没有天之灵，可以先创建一个再回来选择。</text>
            <nut-button
              shape="round"
              type="primary"
              size="small"
              @click="handleCreateAgent"
            >
              创建天之灵
            </nut-button>
          </view>
        </view>
      </view>

      <view
        v-else-if="session?.status === 'failed'"
        class="voice-service-workspace"
      >
        <view class="voice-service-failed">
          <text class="voice-service-failed__title">
            {{
              session.failureStage === "training"
                ? "这次没有生成成功"
                : "这次没有整理成功"
            }}
          </text>
          <text class="voice-service-failed__text">
            {{
              session.failureReason ||
              "可能是素材格式或声音质量的问题，可以继续添加其他素材。"
            }}
          </text>
          <view class="voice-service-failed__actions">
            <nut-button
              shape="round"
              type="primary"
              :loading="
                session.failureStage === 'training'
                  ? isStartingTraining
                  : isSubmittingMaterials
              "
              :disabled="
                session.failureStage !== 'training' && !hasPersistedMaterials
              "
              @click="handleRetryFailed"
            >
              {{
                session.failureStage === "training"
                  ? "重新生成声音"
                  : "重新识别与剪辑"
              }}
            </nut-button>
            <nut-button
              v-if="session.failureStage !== 'training'"
              shape="round"
              plain
              @click="handleAddMaterials"
            >
              添加其他素材
            </nut-button>
            <view
              class="voice-service-back-step"
              :class="{
                'voice-service-back-step--disabled':
                  session.failureStage === 'training'
                    ? isReturningToReview
                    : isReturningToMaterials,
              }"
              role="button"
              :aria-disabled="
                session.failureStage === 'training'
                  ? isReturningToReview
                  : isReturningToMaterials
              "
              @tap="handleFailedReturn"
              @click="handleFailedReturn"
            >
              <Loading
                v-if="
                  session.failureStage === 'training'
                    ? isReturningToReview
                    : isReturningToMaterials
                "
                color="#77728f"
                size="14"
              />
              {{
                (
                  session.failureStage === "training"
                    ? isReturningToReview
                    : isReturningToMaterials
                )
                  ? "正在返回"
                  : "返回上一步"
              }}
            </view>
          </view>
        </view>
      </view>

      <view class="voice-service-question">
        <text class="voice-service-question__title">有疑问，直接问小使者</text>
        <textarea
          class="voice-service-question__input"
          :value="inputValue"
          placeholder="也可以告诉我你手里的素材情况"
          placeholder-class="voice-service-question__placeholder"
          maxlength="500"
          confirm-type="send"
          :show-confirm-bar="false"
          :disabled="isSendingMessage"
          @input="handleInput"
          @confirm="handleSendMessage"
        />
        <view class="voice-service-question__footer">
          <view class="voice-service-question__voice-tool">
            <button
              class="voice-service-question__voice-button"
              :class="{
                'voice-service-question__voice-button--recording':
                  isVoiceRecording,
              }"
              open-type="agreePrivacyAuthorization"
              aria-label="语音输入"
              @tap="handleVoiceButtonTap"
              @agreeprivacyauthorization="handleVoicePrivacyAgreed"
            >
              <PlayStop v-if="isVoiceRecording" color="#ffffff" size="17" />
              <Microphone v-else color="#ffffff" size="19" />
            </button>
            <text>{{ isVoiceRecording ? "正在转成文字" : "语音输入" }}</text>
          </view>
          <nut-button
            class="voice-service-question__send"
            size="small"
            type="primary"
            :loading="isSendingMessage"
            :disabled="!canSendMessage"
            @click="handleSendMessage"
          >
            发送问题
            <Right v-if="!isSendingMessage" color="#ffffff" size="15" />
          </nut-button>
        </view>
      </view>

      <view v-if="hasVoiceServiceData" class="voice-service-privacy">
        <view class="voice-service-privacy__copy">
          <text class="voice-service-privacy__title">删除声音数据</text>
          <text class="voice-service-privacy__text">
            将删除原始素材、切片、训练音频和声音模型，并解除已选天之灵的声音绑定。
          </text>
          <text
            v-if="session?.dataDeletionStatus === 'partial_failed'"
            class="voice-service-privacy__error"
          >
            {{ session.dataDeletionFailureReason || "仍有部分数据未删除" }}
          </text>
        </view>
        <nut-button
          class="voice-service-privacy__delete"
          type="danger"
          plain
          block
          :loading="isDeletingVoiceData"
          :disabled="isVoiceDataActionBusy"
          @click="handleDeleteVoiceData"
        >
          <Del v-if="!isDeletingVoiceData" size="16" />
          {{
            session?.dataDeletionStatus === "partial_failed"
              ? "重试删除"
              : "删除全部声音数据"
          }}
        </nut-button>
      </view>

      <view id="voice-service-bottom" class="voice-service-bottom-anchor" />
    </view>

    <template #overlay>
      <nut-dialog
        v-model:visible="isRecutDialogVisible"
        title="这一段要怎么剪？"
        custom-class="voice-service-recut-dialog"
        text-align="left"
        :close-on-click-overlay="false"
        :lock-scroll="true"
        :z-index="130"
      >
        <view class="voice-service-recut-dialog__content">
          <text class="voice-service-recut-dialog__label">
            请写清要去掉或保留的时间
          </text>
          <textarea
            class="voice-service-recut-dialog__textarea"
            :value="recutInstruction"
            maxlength="120"
            placeholder="例如：去掉开头 2 秒；只保留 3 秒到 8 秒"
            :show-confirm-bar="false"
            :adjust-position="true"
            :cursor-spacing="96"
            @input="handleRecutInstructionInput"
          />
          <text class="voice-service-recut-dialog__hint">
            当前片段 {{ recutTargetDurationText }}
          </text>
        </view>
        <template #footer>
          <view class="voice-service-recut-dialog__footer">
            <nut-button
              class="voice-service-recut-dialog__cancel"
              plain
              :disabled="isSubmittingRecut"
              @click="handleCloseRecutDialog"
            >
              取消
            </nut-button>
            <nut-button
              class="voice-service-recut-dialog__confirm"
              type="primary"
              :loading="isSubmittingRecut"
              :disabled="!recutInstruction.trim()"
              @click="handleSubmitRecut"
            >
              开始重新剪辑
            </nut-button>
          </view>
        </template>
      </nut-dialog>
    </template>
  </page-scaffold>
</template>

<script lang="ts">
export default {
  name: "VoicePackagePage",
};
</script>

<script setup lang="ts">
import {
  Check,
  Close,
  Del,
  Loading,
  Microphone,
  PlayStart,
  PlayStop,
  Plus,
  Right,
  Scan2,
  Voice,
} from "@nutui/icons-vue-taro";
import Taro, { useDidHide, useDidShow, useLoad, useUnload } from "@tarojs/taro";
import { computed, nextTick, ref } from "vue";
import { ApiException } from "../../api/api-exception";
import { getAgents, type AgentSummary } from "../../apis/agent";
import { uploadLocalFile } from "../../apis/storage";
import {
  addVoiceServiceMaterials,
  deleteVoiceServiceData,
  getCurrentVoiceServiceSession,
  getUserVoiceTimbreLibrary,
  removeVoiceServiceMaterial,
  recutVoiceServiceClip,
  returnVoiceServiceToMaterials,
  returnVoiceServiceToReview,
  reviewVoiceServiceClip,
  selectVoiceServiceAgent,
  sendVoiceServiceMessage,
  startVoiceServiceTraining,
  startVoiceServiceSession,
  submitVoiceServiceMaterials,
  type VoiceServiceClipReviewStatusDTO,
  type VoiceServiceFilteredClipDTO,
  type VoiceServiceMaterialDTO,
  type VoiceServiceReviewClipDTO,
  type VoiceServiceSessionDTO,
} from "../../apis/voice-service";
import messengerImageUrl from "../../assets/images/agent-create/header-mark.png";
import { clearAuthSession } from "../../auth/session";
import AppBar from "../../components/app-bar/app-bar.vue";
import PageScaffold from "../../components/page-scaffold/page-scaffold.vue";
import { openAgentCreatePage } from "../../utils/agent-create-navigation";
import { getAgentCreateMessengerSpeech } from "../../utils/agent-create-messenger-speech";
import { ensureInnerAudioPlaybackOptions } from "../../utils/audio";
import {
  ensureAuthenticatedSession,
  redirectToAuthPage,
} from "../../utils/auth-guard";
import { requestVoiceprintConsent } from "../../legal/voiceprint-consent";
import { getVoiceServiceFixedPromptSpeech } from "./voice-service-prompt-speech";
import {
  buildVoiceServiceMessengerState,
  getAcceptedVoiceClipDurationSeconds,
  getVoiceClipIssueDisplayText,
  isVoiceClipRecutReason,
  isVoiceClipUnusedReason,
  VOICE_SERVICE_CLIP_UNUSED_REASON,
  VOICE_SERVICE_PROMPTS,
  VOICE_SERVICE_SELECTION_LIMIT_SECONDS,
  wouldExceedVoiceClipSelectionLimit,
} from "./voice-service-progress";

type LocalUploadStatus =
  | "queued"
  | "uploading"
  | "saving"
  | "failed"
  | "oversized";

interface LocalMaterialItem {
  id: string;
  path: string;
  name: string;
  durationSeconds?: number;
  sizeBytes?: number;
  progressPercent?: number;
  status: LocalUploadStatus;
  error?: string;
  createdAt: number;
}

interface DisplayMaterialItem {
  id: string;
  name: string;
  durationSeconds?: number;
  sizeBytes?: number;
  progressPercent?: number;
  status: "uploaded" | LocalUploadStatus;
  error?: string;
  persisted: boolean;
}

interface ChosenMaterialFile {
  path: string;
  name: string;
  durationSeconds?: number;
  sizeBytes?: number;
}

interface RealtimeRecognitionResult {
  result?: string;
  Result?: string;
  msg?: string;
}

interface RealtimeRecognitionManager {
  start: (options: { duration: number; lang: "zh_CN" }) => void;
  stop: () => void;
  onStart?: () => void;
  onRecognize?: (result: RealtimeRecognitionResult) => void;
  onStop?: (result: RealtimeRecognitionResult) => void;
  onError?: (result: RealtimeRecognitionResult) => void;
}

interface WechatSIPlugin {
  getRecordRecognitionManager?: () => RealtimeRecognitionManager;
}

declare const requirePlugin: (name: "WechatSI") => WechatSIPlugin;

const MAX_MATERIAL_COUNT = 30;
const MAX_MATERIAL_SIZE_BYTES = 50 * 1024 * 1024;
const MAX_PENDING_UPLOAD_AGE_MS = 2 * 24 * 60 * 60 * 1000;
const MATERIAL_UPLOAD_FOLDER = "voice-training-materials";
const LOCAL_UPLOAD_STORAGE_KEY = "voice-service-pending-materials:v1";
const PREVIEW_AUDIO_ID = "voice-service-preview";
const ASSISTANT_SPEECH_TIMEOUT_MS = 10000;
const UPLOAD_INTERRUPTED_MESSAGE = "上次上传中断，可以点重试继续";

const session = ref<VoiceServiceSessionDTO | null>(null);
const localUploads = ref<LocalMaterialItem[]>([]);
const agents = ref<AgentSummary[]>([]);
const inputValue = ref("");
const scrollIntoView = ref("");
const routeAgentId = ref("");
const isCheckingAuth = ref(true);
const isLoading = ref(false);
const isLoadingAgents = ref(false);
const isUploadingMaterials = ref(false);
const isSubmittingMaterials = ref(false);
const isSendingMessage = ref(false);
const isStartingTraining = ref(false);
const isReviewingClip = ref(false);
const isSubmittingRecut = ref(false);
const isRecutDialogVisible = ref(false);
const recutTargetClipId = ref("");
const recutInstruction = ref("");
const isReturningToMaterials = ref(false);
const isReturningToReview = ref(false);
const isSelectingAgent = ref(false);
const isDeletingVoiceData = ref(false);
const loadError = ref("");
const materialAuthorized = ref(false);
const playingAudioId = ref("");
const downloadingAudioId = ref("");
const audioDownloadProgress = ref(0);
const audioPlaybackCurrentSeconds = ref(0);
const audioPlaybackDurationSeconds = ref(0);
const isVoiceRecording = ref(false);
const isAssistantSpeechLoading = ref(false);
const isAssistantSpeechPlaying = ref(false);
const shouldShowResumePrompt = ref(false);
const selectionAssistantPrompt = ref("");
const completedTimbreCount = ref(0);

let pollTimer: ReturnType<typeof setTimeout> | null = null;
let audioContext: Taro.InnerAudioContext | null = null;
let audioDownloadTask: ReturnType<typeof Taro.downloadFile> | null = null;
let assistantAudioContext: Taro.InnerAudioContext | null = null;
let recognitionManager: RealtimeRecognitionManager | null = null;
let recognitionBaseText = "";
let assistantSpeechGeneration = 0;
let lastAutoSpokenPrompt = "";
let sessionRefreshGeneration = 0;
let audioPlaybackGeneration = 0;
const preparedAudioSources = new Map<string, string>();

const fallbackAssistantPrompt = VOICE_SERVICE_PROMPTS.materialCollection;

const latestAssistantPrompt = computed(() => {
  const messages = session.value?.messages ?? [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === "assistant" && message.text.trim()) {
      return normalizeAssistantPrompt(message.text);
    }
  }

  return fallbackAssistantPrompt;
});
const messengerState = computed(() =>
  buildVoiceServiceMessengerState(session.value)
);
const activeAssistantPrompt = computed(() => {
  if (selectionAssistantPrompt.value) {
    return selectionAssistantPrompt.value;
  }
  if (shouldShowResumePrompt.value) {
    const progressPrompt = messengerState.value.prompt;
    if (progressPrompt) {
      return progressPrompt;
    }
  }

  return latestAssistantPrompt.value;
});
const displayedAssistantPrompt = computed(() => {
  const text = activeAssistantPrompt.value.trim();
  if (text === fallbackAssistantPrompt) {
    return [
      "各种留有他声音的素材，你发给我就行。",
      "音频、视频都可以，不用提前剪辑或整理，我会帮你处理好。",
    ].join("\n");
  }

  return text.replace(/([。！？])\s*(?=\S)/g, "$1\n");
});
const assistantSpeechControlLabel = computed(() => {
  if (isAssistantSpeechLoading.value) {
    return "正在准备小使者语音";
  }
  if (isAssistantSpeechPlaying.value) {
    return "暂停小使者语音";
  }

  return "朗读小使者的话";
});
const showMaterialGuide = computed(() => {
  return !session.value || session.value.status === "collecting";
});
const persistedMaterials = computed(() => session.value?.materials ?? []);
const hasPersistedMaterials = computed(
  () => persistedMaterials.value.length > 0
);
const activeLocalUploadCount = computed(
  () =>
    localUploads.value.filter(
      (item) =>
        item.status === "queued" ||
        item.status === "uploading" ||
        item.status === "saving"
    ).length
);
const materialItems = computed<DisplayMaterialItem[]>(() => {
  const remoteItems = persistedMaterials.value.map((item) => ({
    id: item.id,
    name: item.name,
    durationSeconds: item.durationSeconds,
    sizeBytes: undefined,
    progressPercent: undefined,
    status: "uploaded" as const,
    persisted: true,
  }));
  const pendingItems = localUploads.value.map((item) => ({
    ...item,
    persisted: false,
  }));

  return [...remoteItems, ...pendingItems];
});
const canRemoveMaterials = computed(() => {
  return (
    !session.value ||
    session.value.status === "collecting" ||
    session.value.status === "failed"
  );
});
const reviewClips = computed(() => session.value?.reviewClips ?? []);
const activeRecutClipCount = computed(
  () => reviewClips.value.filter((item) => isClipRecutActive(item)).length
);
const recutTargetClip = computed(() =>
  reviewClips.value.find((item) => item.id === recutTargetClipId.value)
);
const recutTargetDurationText = computed(() =>
  formatDurationText(
    recutTargetClip.value?.qualityMetrics?.durationSeconds ??
      recutTargetClip.value?.durationSeconds ??
      0
  )
);
const filteredClips = computed(() => session.value?.filteredClips ?? []);
const reviewedClipCount = computed(() => {
  return reviewClips.value.filter((item) => item.reviewStatus !== "pending")
    .length;
});
const acceptedClipCount = computed(() => {
  return reviewClips.value.filter((item) => item.reviewStatus === "accepted")
    .length;
});
const acceptedClipDurationSeconds = computed(() =>
  getAcceptedVoiceClipDurationSeconds(reviewClips.value)
);
const acceptedClipDurationText = computed(() =>
  acceptedClipDurationSeconds.value > 0
    ? formatDurationText(acceptedClipDurationSeconds.value)
    : "0秒"
);
const acceptedClipProgressPercent = computed(() =>
  Math.min(
    100,
    Math.round(
      (acceptedClipDurationSeconds.value /
        VOICE_SERVICE_SELECTION_LIMIT_SECONDS) *
        100
    )
  )
);
const audioPlaybackProgressPercent = computed(() => {
  if (audioPlaybackDurationSeconds.value <= 0) {
    return 0;
  }

  return Math.min(
    100,
    Math.max(
      0,
      (audioPlaybackCurrentSeconds.value / audioPlaybackDurationSeconds.value) *
        100
    )
  );
});
const allClipsReviewed = computed(() => {
  return (
    reviewClips.value.length > 0 &&
    reviewedClipCount.value === reviewClips.value.length
  );
});
const showReviewSummary = computed(() => {
  return (
    allClipsReviewed.value ||
    (reviewClips.value.length === 0 && filteredClips.value.length > 0)
  );
});
const selectedAgentId = computed(() => session.value?.selectedAgentId ?? "");
const isDataDeletionIncomplete = computed(() => {
  return (
    session.value?.dataDeletionStatus === "pending" ||
    session.value?.dataDeletionStatus === "partial_failed"
  );
});
const hasVoiceServiceData = computed(() => {
  const current = session.value;
  return Boolean(
    current &&
      (current.materials.length ||
        current?.reviewClips.length ||
        current?.filteredClips?.length ||
        current?.trainingAudioObjectKey ||
        current?.previewAudioUrl ||
        current?.voiceTimbreId ||
        current?.dataDeletionStatus === "pending" ||
        current?.dataDeletionStatus === "partial_failed")
  );
});
const isVoiceDataActionBusy = computed(() => {
  return (
    isDeletingVoiceData.value ||
    isUploadingMaterials.value ||
    isSubmittingMaterials.value ||
    isStartingTraining.value ||
    isReviewingClip.value ||
    isSubmittingRecut.value ||
    isReturningToMaterials.value ||
    isReturningToReview.value ||
    isSelectingAgent.value
  );
});
const canSendMessage = computed(() => {
  return Boolean(inputValue.value.trim()) && !isSendingMessage.value;
});
const serviceStatusText = computed(() => {
  if (activeRecutClipCount.value > 0) {
    return `正在重新剪辑 ${activeRecutClipCount.value} 段声音`;
  }

  return messengerState.value.statusText;
});

function normalizeAssistantPrompt(text: string) {
  const normalized = text.trim();
  if (
    (normalized.includes("我会陪你一步步完成声音模型训练") &&
      normalized.includes("最推荐使用微信语音")) ||
    (normalized.includes("我会陪你一起整理他的声音") &&
      normalized.includes("我们先从声音素材开始吧"))
  ) {
    return fallbackAssistantPrompt;
  }

  return normalized;
}

useLoad((options) => {
  routeAgentId.value = decodeRouteParam(options?.agentId);
  void preparePage();
});

useDidShow(() => {
  if (!isCheckingAuth.value && !isUploadingMaterials.value) {
    void refreshSession({ silent: true, showResumePrompt: true });
    void loadCompletedTimbreCount();
  }
});

useDidHide(() => {
  stopAssistantSpeech();
});

useUnload(() => {
  stopPolling();
  stopAssistantSpeech();
  recognitionManager?.stop?.();
  recognitionManager = null;
  cancelAudioDownload();
  destroyPlaybackAudio();
});

async function preparePage() {
  isCheckingAuth.value = true;
  const authenticated = await ensureAuthenticatedSession();

  if (!authenticated) {
    await redirectToAuthPage();
    return;
  }

  isCheckingAuth.value = false;

  const consented = await requestVoiceprintConsent();
  if (!consented) {
    loadError.value = "需要授权声纹信息才能使用声音服务";
    isLoading.value = false;
    return;
  }

  restoreLocalUploads();
  await Promise.all([
    refreshSession({ showResumePrompt: true, start: true }),
    loadCompletedTimbreCount(),
  ]);
}

async function refreshSession(
  options: {
    silent?: boolean;
    showResumePrompt?: boolean;
    start?: boolean;
  } = {}
) {
  if (isLoading.value) {
    return;
  }
  const refreshGeneration = ++sessionRefreshGeneration;

  if (!options.silent) {
    isLoading.value = true;
  }
  loadError.value = "";

  try {
    const previousStatus = session.value?.status;
    const previousRecutClipIds = new Set(
      (session.value?.reviewClips ?? [])
        .filter((item) => isClipRecutActive(item))
        .map((item) => item.id)
    );
    const nextSession = options.start
      ? await startVoiceServiceSession()
      : (await getCurrentVoiceServiceSession()) ?? null;
    if (refreshGeneration !== sessionRefreshGeneration) {
      return;
    }
    const completedRecut = nextSession?.reviewClips.find(
      (item) =>
        previousRecutClipIds.has(item.id) && item.recutStatus === "completed"
    );
    const failedRecut = nextSession?.reviewClips.find(
      (item) =>
        previousRecutClipIds.has(item.id) && item.recutStatus === "failed"
    );
    session.value = nextSession;
    if (completedRecut) {
      selectionAssistantPrompt.value = VOICE_SERVICE_PROMPTS.recutCompleted;
      shouldShowResumePrompt.value = false;
    } else if (failedRecut) {
      selectionAssistantPrompt.value = VOICE_SERVICE_PROMPTS.recutFailed;
      shouldShowResumePrompt.value = false;
    }
    if (
      options.showResumePrompt ||
      (previousStatus && previousStatus !== nextSession?.status)
    ) {
      shouldShowResumePrompt.value = true;
    }
    await handleSessionChanged();
    const recutResultClip = completedRecut ?? failedRecut;
    if (recutResultClip) {
      await scrollToClip(recutResultClip.id);
    }
  } catch (error) {
    if (await handleAuthError(error)) {
      return;
    }

    loadError.value = formatError(error, "声音服务加载失败，请稍后重试");
  } finally {
    isLoading.value = false;
  }
}

async function loadCompletedTimbreCount() {
  try {
    const library = await getUserVoiceTimbreLibrary();
    completedTimbreCount.value = library.items.length;
  } catch {
    completedTimbreCount.value = 0;
  }
}

async function handleSessionChanged() {
  const status = session.value?.status;

  if (status === "preview_ready" || status === "completed") {
    await loadAgents();
  }

  if (
    status === "analyzing" ||
    status === "training" ||
    activeRecutClipCount.value > 0
  ) {
    startPolling();
  } else {
    stopPolling();
  }

  void presentLatestAssistantSpeech();
}

function startPolling() {
  stopPolling();
  pollTimer = setTimeout(async () => {
    await refreshSession({ silent: true });
  }, 8000);
}

function stopPolling() {
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
}

async function loadAgents() {
  if (isLoadingAgents.value || agents.value.length) {
    await selectRouteAgentIfNeeded();
    return;
  }

  isLoadingAgents.value = true;
  try {
    agents.value = await getAgents();
    await selectRouteAgentIfNeeded();
  } catch (error) {
    if (!(await handleAuthError(error))) {
      showToast(formatError(error, "天之灵加载失败，请稍后重试"));
    }
  } finally {
    isLoadingAgents.value = false;
  }
}

async function selectRouteAgentIfNeeded() {
  const agentId = routeAgentId.value;
  if (
    !agentId ||
    !session.value ||
    selectedAgentId.value ||
    !agents.value.some((item) => item.id === agentId)
  ) {
    return;
  }

  routeAgentId.value = "";
  await handleSelectAgent(agentId);
}

function handleRetry() {
  void refreshSession();
}

async function handleBack() {
  if (Taro.getCurrentPages().length > 1) {
    try {
      await Taro.navigateBack();
      return;
    } catch {}
  }

  await Taro.reLaunch({ url: "/pages/me/index" });
}

function openVoiceLibrary() {
  void Taro.navigateTo({ url: "/pages/voice-library/index" });
}

async function handleAddMaterials() {
  if (isSubmittingMaterials.value) {
    return;
  }
  if (isDataDeletionIncomplete.value) {
    showToast("请先重试删除剩余声音数据");
    return;
  }

  if (!(await ensureMaterialAuthorization())) {
    return;
  }

  if (getRemainingMaterialCount() <= 0) {
    showToast(`最多添加 ${MAX_MATERIAL_COUNT} 份素材`);
    return;
  }

  try {
    const result = await Taro.showActionSheet({
      itemList: ["从微信聊天选择文件", "从手机相册选择"],
    });
    const files =
      result.tapIndex === 0
        ? await chooseWechatChatFiles()
        : await choosePhoneAlbumMedia();

    await uploadMaterialFiles(files);
  } catch {}
}

async function ensureMaterialAuthorization() {
  if (materialAuthorized.value) {
    return true;
  }

  const result = await Taro.showModal({
    title: "添加声音素材",
    content:
      "请确认你有权使用这些声音素材。素材只用于声音整理、剪辑确认和声音模型训练。",
    confirmText: "我已确认",
    cancelText: "暂不添加",
    confirmColor: "#77728f",
  });

  materialAuthorized.value = result.confirm;
  return result.confirm;
}

async function choosePhoneAlbumMedia(): Promise<ChosenMaterialFile[]> {
  const result = await Taro.chooseMedia({
    count: Math.min(9, getRemainingMaterialCount()),
    mediaType: ["video"],
    sourceType: ["album"],
    sizeType: ["original", "compressed"],
  });

  return (Array.isArray(result.tempFiles) ? result.tempFiles : [])
    .map((file, index) => {
      const raw = file as unknown as Record<string, unknown>;
      const path = getRecordString(raw, "tempFilePath");
      const durationSeconds = getRecordPositiveNumber(raw, "duration");
      const sizeBytes = getRecordPositiveNumber(raw, "size");

      return {
        path,
        name: buildMaterialFileName(path, `相册视频_${index + 1}`, ".mp4"),
        durationSeconds,
        sizeBytes,
      };
    })
    .filter((item) => Boolean(item.path));
}

async function chooseWechatChatFiles(): Promise<ChosenMaterialFile[]> {
  const taroWithMessageFile = Taro as typeof Taro & {
    chooseMessageFile(options: {
      count: number;
      type: "all" | "file" | "image" | "video";
    }): Promise<{ tempFiles?: Array<Record<string, unknown>> }>;
  };
  const result = await taroWithMessageFile.chooseMessageFile({
    count: Math.min(9, getRemainingMaterialCount()),
    type: "all",
  });

  return (Array.isArray(result.tempFiles) ? result.tempFiles : [])
    .map((file, index) => {
      const path = getRecordString(file, "path");
      const rawName = getRecordString(file, "name");
      const durationSeconds = getRecordPositiveNumber(file, "duration");
      const sizeBytes = getRecordPositiveNumber(file, "size");
      const sanitizedRawName = sanitizeMaterialFileName(rawName, "");
      const materialName = isSupportedMaterialFile(sanitizedRawName)
        ? sanitizedRawName
        : buildMaterialFileName(path, `声音素材_${index + 1}`, "");

      return {
        path,
        name: materialName,
        durationSeconds,
        sizeBytes,
      };
    })
    .filter((item) => Boolean(item.path) && isSupportedMaterialFile(item.name));
}

async function uploadMaterialFiles(files: ChosenMaterialFile[]) {
  if (!files.length) {
    showToast("请选择音频或视频素材");
    return;
  }

  const oversizedFiles = files.filter(
    (file) => (file.sizeBytes ?? 0) > MAX_MATERIAL_SIZE_BYTES
  );
  const selectedFiles = files
    .filter((file) => (file.sizeBytes ?? 0) <= MAX_MATERIAL_SIZE_BYTES)
    .slice(0, getRemainingMaterialCount());

  if (oversizedFiles.length > 0) {
    appendLocalUploads(
      oversizedFiles.map((file, index) =>
        createLocalUploadItem(file, {
          index,
          status: "oversized",
          error: `文件 ${formatFileSize(
            file.sizeBytes
          )}，超过 50MB，请压缩或分段后再上传`,
        })
      )
    );
  }

  if (!selectedFiles.length) {
    showToast(
      oversizedFiles.length
        ? `${oversizedFiles.length} 份文件超过 50MB`
        : "已达到素材数量上限"
    );
    return;
  }

  if (oversizedFiles.length > 0) {
    showToast(`${oversizedFiles.length} 份文件超过 50MB，已保留提示`);
  }

  const pendingItems = selectedFiles.map((file, index) =>
    createLocalUploadItem(file, { index, status: "queued" })
  );
  appendLocalUploads(pendingItems);
  const wasAlreadyUploading = isUploadingMaterials.value;
  showToast(
    wasAlreadyUploading
      ? `${pendingItems.length} 份素材已加入上传队列`
      : `${pendingItems.length} 份素材开始上传`
  );
  void processMaterialUploadQueue();
}

async function processMaterialUploadQueue() {
  if (isUploadingMaterials.value) {
    return;
  }

  isUploadingMaterials.value = true;
  let savedMaterialCount = 0;
  let failedMaterialCount = 0;

  try {
    while (!isCheckingAuth.value) {
      const pending = localUploads.value.find(
        (item) => item.status === "queued"
      );
      if (!pending) {
        break;
      }

      const uploaded = await uploadLocalMaterial(pending.id);
      if (uploaded) {
        savedMaterialCount += 1;
      } else {
        failedMaterialCount += 1;
      }
      if (isCheckingAuth.value) {
        break;
      }
    }

    if (savedMaterialCount > 0) {
      if (failedMaterialCount === 0) {
        showToast(`${savedMaterialCount} 份素材上传成功`);
      } else {
        showToast(
          `${savedMaterialCount} 份上传成功，${failedMaterialCount} 份需要重试`
        );
      }
      await handleSessionChanged();
      await scrollToPrompt();
    } else if (failedMaterialCount > 0 && !isCheckingAuth.value) {
      showToast("素材上传失败，请稍后重试");
    }
  } finally {
    isUploadingMaterials.value = false;
    if (
      !isCheckingAuth.value &&
      localUploads.value.some((item) => item.status === "queued")
    ) {
      void processMaterialUploadQueue();
    }
  }
}

async function handleRetryLocalUpload(localUploadId: string) {
  const item = localUploads.value.find(
    (localUpload) => localUpload.id === localUploadId
  );
  if (!item || item.status !== "failed" || isSubmittingMaterials.value) {
    return;
  }

  if (isDataDeletionIncomplete.value) {
    showToast("请先重试删除剩余声音数据");
    return;
  }

  updateLocalUpload(localUploadId, {
    status: "queued",
    progressPercent: 0,
    error: "",
  });
  showToast(isUploadingMaterials.value ? "已加入上传队列" : "正在重新上传");
  void processMaterialUploadQueue();
}

function createLocalUploadItem(
  file: ChosenMaterialFile,
  options: {
    index: number;
    status: LocalUploadStatus;
    error?: string;
  }
): LocalMaterialItem {
  return {
    id: `local_${Date.now()}_${options.index}_${Math.random()
      .toString(36)
      .slice(2, 8)}`,
    path: file.path,
    name: file.name,
    durationSeconds: file.durationSeconds,
    sizeBytes: file.sizeBytes,
    progressPercent: options.status === "uploading" ? 1 : 0,
    status: options.status,
    error: options.error,
    createdAt: Date.now(),
  };
}

function appendLocalUploads(items: LocalMaterialItem[]) {
  if (!items.length) {
    return;
  }

  localUploads.value = [...localUploads.value, ...items];
  persistLocalUploads();
}

async function uploadLocalMaterial(localUploadId: string): Promise<boolean> {
  const item = localUploads.value.find(
    (localUpload) => localUpload.id === localUploadId
  );
  if (!item) {
    return false;
  }

  if ((item.sizeBytes ?? 0) > MAX_MATERIAL_SIZE_BYTES) {
    updateLocalUpload(localUploadId, {
      status: "oversized",
      progressPercent: 0,
      error: `文件 ${formatFileSize(
        item.sizeBytes
      )}，超过 50MB，请压缩或分段后再上传`,
    });
    return false;
  }

  if (!(await isLocalMaterialFileAvailable(item.path))) {
    updateLocalUpload(localUploadId, {
      status: "failed",
      progressPercent: 0,
      error: "本地临时文件已失效，请重新选择素材",
    });
    return false;
  }

  updateLocalUpload(localUploadId, {
    status: "uploading",
    progressPercent: Math.max(item.progressPercent || 0, 1),
    error: "",
  });

  let uploaded: Awaited<ReturnType<typeof uploadLocalFile>>;
  try {
    uploaded = await uploadLocalFile(item.path, {
      folder: MATERIAL_UPLOAD_FOLDER,
      fileName: item.name,
      onProgress: (progress) => {
        updateLocalUpload(
          localUploadId,
          {
            status: progress.progress >= 100 ? "saving" : "uploading",
            progressPercent: progress.progress,
          },
          { persist: false }
        );
      },
    });
  } catch (error) {
    updateLocalUpload(localUploadId, {
      status: "failed",
      error: formatError(error, "上传失败"),
    });

    await handleAuthError(error);
    return false;
  }

  try {
    session.value = await addVoiceServiceMaterials({
      materials: [
        {
          name: item.name,
          objectKey: uploaded.objectKey,
          publicUrl: uploaded.publicUrl,
          durationSeconds: item.durationSeconds,
        },
      ],
    });
    shouldShowResumePrompt.value = true;
    removeLocalUpload(localUploadId);
    return true;
  } catch (error) {
    updateLocalUpload(localUploadId, {
      status: "failed",
      error: formatError(error, "素材登记失败"),
    });

    await handleAuthError(error);
    return false;
  }
}

async function isLocalMaterialFileAvailable(filePath: string) {
  if (!filePath.trim()) {
    return false;
  }

  try {
    await Taro.getFileInfo({ filePath });
    return true;
  } catch {
    return false;
  }
}

async function handleRemoveMaterial(materialId: string) {
  if (!session.value || !canRemoveMaterials.value) {
    return;
  }

  const result = await Taro.showModal({
    title: "删除这份素材？",
    content: "删除后，这份原始素材会从声音服务永久移除，无法恢复。",
    confirmText: "删除",
    cancelText: "保留",
    confirmColor: "#d14343",
  });
  if (!result.confirm) {
    return;
  }

  try {
    session.value = await removeVoiceServiceMaterial(
      session.value.id,
      materialId
    );
    shouldShowResumePrompt.value = true;
    await handleSessionChanged();
    await scrollToPrompt();
  } catch (error) {
    if (!(await handleAuthError(error))) {
      showToast(formatError(error, "删除失败，请稍后重试"));
    }
  }
}

async function handleDeleteVoiceData() {
  if (!session.value || isDeletingVoiceData.value) {
    return;
  }
  if (isVoiceDataActionBusy.value) {
    showToast("请等待当前操作完成后再删除");
    return;
  }

  const result = await Taro.showModal({
    title: "删除全部声音数据？",
    content:
      "原始素材、切片、训练音频和声音模型都会被永久删除，已选天之灵的声音绑定也会解除。此操作无法恢复。",
    confirmText: "永久删除",
    cancelText: "取消",
    confirmColor: "#c83f49",
  });
  if (!result.confirm) {
    return;
  }

  try {
    isDeletingVoiceData.value = true;
    stopPolling();
    stopAssistantSpeech();
    cancelAudioDownload();
    destroyPlaybackAudio();
    session.value = await deleteVoiceServiceData(session.value.id);
    localUploads.value = [];
    persistLocalUploads();
    shouldShowResumePrompt.value = true;
    await handleSessionChanged();

    if (session.value.dataDeletionStatus === "partial_failed") {
      await Taro.showModal({
        title: "仍有部分数据未删除",
        content:
          session.value.dataDeletionFailureReason ||
          "平台或存储服务暂时不可用，请稍后点击重试删除。",
        confirmText: "知道了",
        showCancel: false,
        confirmColor: "#c83f49",
      });
    } else {
      showToast("声音数据已全部删除");
    }
    await scrollToPrompt();
  } catch (error) {
    if (!(await handleAuthError(error))) {
      showToast(formatError(error, "删除失败，请稍后重试"));
    }
  } finally {
    isDeletingVoiceData.value = false;
  }
}

async function handleReturnToMaterials() {
  if (!session.value || isReturningToMaterials.value) {
    return;
  }

  isReturningToMaterials.value = true;
  cancelAudioDownload();
  destroyPlaybackAudio();
  try {
    sessionRefreshGeneration += 1;
    stopPolling();
    session.value = await returnVoiceServiceToMaterials(session.value.id);
    shouldShowResumePrompt.value = true;
    await handleSessionChanged();
    await scrollToPrompt();
  } catch (error) {
    if (!(await handleAuthError(error))) {
      showToast(formatError(error, "暂时无法返回，请稍后重试"));
      await handleSessionChanged();
    }
  } finally {
    isReturningToMaterials.value = false;
  }
}

async function handleReturnToReview() {
  if (!session.value || isReturningToReview.value) {
    return;
  }

  isReturningToReview.value = true;
  cancelAudioDownload();
  destroyPlaybackAudio();
  try {
    sessionRefreshGeneration += 1;
    stopPolling();
    session.value = await returnVoiceServiceToReview(session.value.id);
    shouldShowResumePrompt.value = true;
    await handleSessionChanged();
    await scrollToPrompt();
  } catch (error) {
    if (!(await handleAuthError(error))) {
      showToast(formatError(error, "暂时无法返回，请稍后重试"));
      await handleSessionChanged();
    }
  } finally {
    isReturningToReview.value = false;
  }
}

function handleFailedReturn() {
  if (session.value?.failureStage === "training") {
    void handleReturnToReview();
    return;
  }

  void handleReturnToMaterials();
}

async function handleSubmitMaterials(
  processingMode: "assisted" | "ready_to_use" = "assisted"
) {
  const pendingStatuses = localUploads.value.map((item) => item.status);
  if (pendingStatuses.includes("saving")) {
    showToast("声音正在被解析，完成后才可以开始");
    return;
  }
  if (
    pendingStatuses.includes("queued") ||
    pendingStatuses.includes("uploading")
  ) {
    showToast("声音正在被解析，完成后才可以开始");
    return;
  }

  await submitMaterialsForAnalysis(processingMode);
}

async function submitMaterialsForAnalysis(
  processingMode: "assisted" | "ready_to_use" = "assisted"
) {
  if (
    !session.value ||
    !hasPersistedMaterials.value ||
    isSubmittingMaterials.value ||
    isDataDeletionIncomplete.value
  ) {
    return false;
  }

  if (
    session.value.status !== "collecting" &&
    session.value.status !== "failed" &&
    !(
      session.value.status === "reviewing" &&
      allClipsReviewed.value &&
      acceptedClipCount.value === 0
    )
  ) {
    return false;
  }

  try {
    isSubmittingMaterials.value = true;
    session.value = await submitVoiceServiceMaterials(session.value.id, {
      processingMode,
    });
    shouldShowResumePrompt.value = true;
    await handleSessionChanged();
    await scrollToPrompt();
    return true;
  } catch (error) {
    if (!(await handleAuthError(error))) {
      showToast(formatError(error, "开始识别失败，请稍后重试"));
    }
    return false;
  } finally {
    isSubmittingMaterials.value = false;
  }
}

async function handleRetryFailed() {
  if (session.value?.failureStage === "training") {
    await handleStartTraining();
    return;
  }

  await handleSubmitMaterials(session.value?.processingMode ?? "assisted");
}

async function handleReviewClip(
  clipId: string,
  reviewStatus: VoiceServiceClipReviewStatusDTO,
  rejectionReason?: string
) {
  if (!session.value || isReviewingClip.value) {
    return;
  }

  if (
    reviewStatus === "accepted" &&
    wouldExceedVoiceClipSelectionLimit(reviewClips.value, clipId)
  ) {
    selectionAssistantPrompt.value = VOICE_SERVICE_PROMPTS.selectionLimit;
    shouldShowResumePrompt.value = false;
    stopAssistantSpeech();
    await scrollToPrompt();
    void presentLatestAssistantSpeech();
    return;
  }

  try {
    isReviewingClip.value = true;
    session.value = await reviewVoiceServiceClip(session.value.id, clipId, {
      reviewStatus,
      rejectionReason,
    });
    selectionAssistantPrompt.value = "";
    shouldShowResumePrompt.value = true;
    await handleSessionChanged();
    if (allClipsReviewed.value) {
      await scrollToPrompt();
    }
  } catch (error) {
    if (!(await handleAuthError(error))) {
      showToast(formatError(error, "确认失败，请稍后重试"));
    }
  } finally {
    isReviewingClip.value = false;
  }
}

function isClipRecutActive(clip: VoiceServiceReviewClipDTO) {
  return clip.recutStatus === "queued" || clip.recutStatus === "processing";
}

function handleOpenRecutDialog(clip: VoiceServiceReviewClipDTO) {
  if (isClipRecutActive(clip) || isSubmittingRecut.value) {
    return;
  }

  stopAssistantSpeech();
  recutTargetClipId.value = clip.id;
  recutInstruction.value =
    clip.recutStatus === "failed" ? clip.recutInstruction ?? "" : "";
  isRecutDialogVisible.value = true;
}

function handleCloseRecutDialog() {
  if (isSubmittingRecut.value) {
    return;
  }

  isRecutDialogVisible.value = false;
  recutTargetClipId.value = "";
  recutInstruction.value = "";
}

function handleRecutInstructionInput(event: { detail?: { value?: string } }) {
  recutInstruction.value = event.detail?.value ?? "";
}

async function handleSubmitRecut() {
  const currentSession = session.value;
  const clipId = recutTargetClipId.value;
  const instruction = recutInstruction.value.trim();
  if (!currentSession || !clipId || !instruction || isSubmittingRecut.value) {
    return;
  }

  try {
    isSubmittingRecut.value = true;
    session.value = await recutVoiceServiceClip(currentSession.id, clipId, {
      instruction,
    });
    isRecutDialogVisible.value = false;
    recutTargetClipId.value = "";
    recutInstruction.value = "";
    selectionAssistantPrompt.value = VOICE_SERVICE_PROMPTS.recutProcessing;
    shouldShowResumePrompt.value = false;
    await handleSessionChanged();
    await scrollToClip(clipId);
  } catch (error) {
    if (!(await handleAuthError(error))) {
      showToast(formatError(error, "没有开始重新剪辑，请检查填写内容"));
    }
  } finally {
    isSubmittingRecut.value = false;
  }
}

async function scrollToClip(clipId: string) {
  scrollIntoView.value = "";
  await nextTick();
  scrollIntoView.value = `voice-service-clip-${clipId}`;
}

async function handleStartTraining() {
  if (!session.value || !acceptedClipCount.value) {
    return;
  }

  try {
    isStartingTraining.value = true;
    session.value = await startVoiceServiceTraining(session.value.id, {
      agentId: routeAgentId.value || undefined,
    });
    shouldShowResumePrompt.value = true;
    await handleSessionChanged();
    await scrollToPrompt();
  } catch (error) {
    if (!(await handleAuthError(error))) {
      showToast(formatError(error, "声音生成暂时无法开始"));
    }
  } finally {
    isStartingTraining.value = false;
  }
}

async function handleSelectAgent(agentId: string) {
  if (
    !session.value ||
    isSelectingAgent.value ||
    agentId === selectedAgentId.value
  ) {
    return;
  }

  try {
    isSelectingAgent.value = true;
    session.value = await selectVoiceServiceAgent(session.value.id, {
      agentId,
    });
    shouldShowResumePrompt.value = true;
    showToast(
      session.value.voiceBindingStatus === "bound"
        ? "声音已接入这个天之灵"
        : session.value.voiceBindingStatus === "existing_voice_preserved"
        ? "已保留原来的声音服务"
        : "已选择，开通声音权益后自动接入"
    );
    await handleSessionChanged();
    await scrollToPrompt();
  } catch (error) {
    if (!(await handleAuthError(error))) {
      showToast(formatError(error, "选择失败，请稍后重试"));
    }
  } finally {
    isSelectingAgent.value = false;
  }
}

async function handleCreateAgent() {
  try {
    await openAgentCreatePage({ source: "voiceTraining" });
  } catch {
    showToast("页面打开失败，请重试");
  }
}

function handleInput(event: { detail?: { value?: string } }) {
  inputValue.value = event.detail?.value ?? "";
}

async function handleSendMessage() {
  const text = inputValue.value.trim();
  if (!text || isSendingMessage.value) {
    return;
  }

  inputValue.value = "";
  stopAssistantSpeech();
  try {
    isSendingMessage.value = true;
    session.value = await sendVoiceServiceMessage(session.value?.id, { text });
    shouldShowResumePrompt.value = false;
    await handleSessionChanged();
    await scrollToPrompt();
  } catch (error) {
    inputValue.value = text;
    if (!(await handleAuthError(error))) {
      showToast(formatError(error, "小使者暂时没有回答，请重试"));
    }
  } finally {
    isSendingMessage.value = false;
  }
}

async function handleVoiceButtonTap() {
  if (isVoiceRecording.value) {
    recognitionManager?.stop();
    return;
  }

  await startRealtimeRecognition();
}

function handleVoicePrivacyAgreed() {
  if (!isVoiceRecording.value) {
    void startRealtimeRecognition();
  }
}

async function startRealtimeRecognition() {
  if (!(await ensureRecordPermission())) {
    return;
  }

  const manager = getRecognitionManager();
  if (!manager) {
    showToast("语音输入暂不可用，请稍后再试");
    return;
  }

  stopAssistantSpeech();
  recognitionBaseText = inputValue.value.trim();
  manager.start({ duration: 60000, lang: "zh_CN" });
}

function getRecognitionManager() {
  if (recognitionManager) {
    return recognitionManager;
  }

  try {
    const manager = requirePlugin("WechatSI").getRecordRecognitionManager?.();
    if (!manager) {
      return null;
    }

    manager.onStart = () => {
      isVoiceRecording.value = true;
    };
    manager.onRecognize = (result) => {
      inputValue.value = joinVoiceInput(
        recognitionBaseText,
        readRecognitionText(result)
      );
    };
    manager.onStop = (result) => {
      inputValue.value = joinVoiceInput(
        recognitionBaseText,
        readRecognitionText(result)
      );
      isVoiceRecording.value = false;
      recognitionBaseText = "";
    };
    manager.onError = (result) => {
      isVoiceRecording.value = false;
      recognitionBaseText = "";
      showToast(result.msg || "语音输入失败，请重试");
    };
    recognitionManager = manager;
    return manager;
  } catch {
    return null;
  }
}

async function ensureRecordPermission() {
  try {
    const setting = await Taro.getSetting();
    const authorized = (
      setting.authSetting as Record<string, boolean | undefined>
    )["scope.record"];

    if (authorized) {
      return true;
    }
    if (authorized === false) {
      const result = await Taro.showModal({
        title: "开启麦克风",
        content: "需要开启麦克风权限，才能把你的问题转成文字。",
        confirmText: "去开启",
        cancelText: "取消",
        confirmColor: "#77728f",
      });
      if (!result.confirm) {
        return false;
      }
      const opened = await Taro.openSetting();
      return Boolean(
        (opened.authSetting as Record<string, boolean | undefined>)[
          "scope.record"
        ]
      );
    }

    await Taro.authorize({ scope: "scope.record" });
    return true;
  } catch {
    return false;
  }
}

function stopAssistantSpeech() {
  assistantSpeechGeneration += 1;
  const audio = assistantAudioContext;
  assistantAudioContext = null;
  isAssistantSpeechLoading.value = false;
  isAssistantSpeechPlaying.value = false;

  if (!audio) {
    return;
  }

  try {
    audio.stop();
  } catch {}
  audio.destroy();
}

async function presentLatestAssistantSpeech(force = false) {
  const text = activeAssistantPrompt.value.trim();
  if (!text || (!force && text === lastAutoSpokenPrompt)) {
    return;
  }

  if (!force) {
    lastAutoSpokenPrompt = text;
  }

  stopAssistantSpeech();
  const generation = assistantSpeechGeneration;
  isAssistantSpeechLoading.value = true;

  let source = "";
  source = getVoiceServiceFixedPromptSpeech(text);
  if (!source) {
    try {
      source = await withTimeout(
        getAgentCreateMessengerSpeech(text),
        ASSISTANT_SPEECH_TIMEOUT_MS
      );
    } catch {}
  }

  if (generation !== assistantSpeechGeneration) {
    return;
  }
  if (!source.trim()) {
    isAssistantSpeechLoading.value = false;
    if (force) {
      showToast("小使者语音暂时无法播放");
    }
    return;
  }

  cancelAudioDownload();
  destroyPlaybackAudio();
  void ensureInnerAudioPlaybackOptions();

  const audio = Taro.createInnerAudioContext();
  assistantAudioContext = audio;
  audio.obeyMuteSwitch = false;
  audio.onPlay(() => {
    if (
      assistantAudioContext !== audio ||
      generation !== assistantSpeechGeneration
    ) {
      return;
    }
    isAssistantSpeechLoading.value = false;
    isAssistantSpeechPlaying.value = true;
  });
  audio.onEnded(() => {
    if (assistantAudioContext !== audio) {
      return;
    }
    assistantAudioContext = null;
    isAssistantSpeechLoading.value = false;
    isAssistantSpeechPlaying.value = false;
    audio.destroy();
  });
  audio.onError(() => {
    if (assistantAudioContext !== audio) {
      return;
    }
    assistantAudioContext = null;
    isAssistantSpeechLoading.value = false;
    isAssistantSpeechPlaying.value = false;
    audio.destroy();
    if (force) {
      showToast("小使者语音暂时无法播放");
    }
  });
  audio.src = source.trim();
  audio.play();
}

async function withTimeout<T>(task: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      task,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error("assistant speech timeout")),
          timeoutMs
        );
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

function handleAssistantSpeechTap() {
  if (isAssistantSpeechLoading.value || isAssistantSpeechPlaying.value) {
    stopAssistantSpeech();
    return;
  }

  void presentLatestAssistantSpeech(true);
}

async function handlePlayAudio(
  url: string | undefined,
  audioId: string,
  expectedDurationSeconds = 0
) {
  const source = url?.trim();
  if (!source) {
    showToast("试听文件正在准备中");
    return;
  }

  if (downloadingAudioId.value === audioId) {
    cancelAudioDownload();
    return;
  }

  if (playingAudioId.value === audioId) {
    audioPlaybackGeneration += 1;
    destroyPlaybackAudio();
    return;
  }

  cancelAudioDownload();
  const playbackGeneration = audioPlaybackGeneration;
  stopAssistantSpeech();
  destroyPlaybackAudio();
  let playbackSource = preparedAudioSources.get(source) ?? source;

  if (!preparedAudioSources.has(source) && isRemoteAudioSource(source)) {
    downloadingAudioId.value = audioId;
    audioDownloadProgress.value = 0;
    const downloadTask = Taro.downloadFile({ url: source, timeout: 60000 });
    audioDownloadTask = downloadTask;
    downloadTask.onProgressUpdate((result) => {
      if (
        playbackGeneration !== audioPlaybackGeneration ||
        downloadingAudioId.value !== audioId
      ) {
        return;
      }
      audioDownloadProgress.value = Math.max(
        0,
        Math.min(100, Math.round(result.progress))
      );
    });

    try {
      const downloaded = await downloadTask;
      if (playbackGeneration !== audioPlaybackGeneration) {
        return;
      }
      if (
        downloaded.statusCode < 200 ||
        downloaded.statusCode >= 300 ||
        !downloaded.tempFilePath?.trim()
      ) {
        throw new Error(`audio download failed: ${downloaded.statusCode}`);
      }
      playbackSource = downloaded.tempFilePath.trim();
      preparedAudioSources.set(source, playbackSource);
      audioDownloadProgress.value = 100;
    } catch (error) {
      if (playbackGeneration !== audioPlaybackGeneration) {
        return;
      }
      showToast(formatError(error, "声音加载失败，请稍后重试"));
      return;
    } finally {
      if (playbackGeneration === audioPlaybackGeneration) {
        audioDownloadTask = null;
        downloadingAudioId.value = "";
        audioDownloadProgress.value = 0;
      }
    }
  }

  if (playbackGeneration !== audioPlaybackGeneration) {
    return;
  }

  void ensureInnerAudioPlaybackOptions();
  const audio = Taro.createInnerAudioContext();
  audioContext = audio;
  audio.obeyMuteSwitch = false;
  audioPlaybackCurrentSeconds.value = 0;
  audioPlaybackDurationSeconds.value = normalizeAudioTime(
    expectedDurationSeconds
  );
  audio.src = playbackSource;
  audio.onCanplay(() => {
    if (audioContext !== audio) {
      return;
    }
    audioPlaybackDurationSeconds.value =
      normalizeAudioTime(audio.duration) ||
      normalizeAudioTime(expectedDurationSeconds);
  });
  audio.onPlay(() => {
    if (
      audioContext !== audio ||
      playbackGeneration !== audioPlaybackGeneration
    ) {
      return;
    }
    playingAudioId.value = audioId;
  });
  audio.onTimeUpdate(() => {
    if (audioContext !== audio) {
      return;
    }
    audioPlaybackCurrentSeconds.value = normalizeAudioTime(audio.currentTime);
    audioPlaybackDurationSeconds.value =
      normalizeAudioTime(audio.duration) ||
      normalizeAudioTime(expectedDurationSeconds);
  });
  audio.onEnded(() => {
    if (audioContext === audio) {
      audioContext = null;
      resetPlaybackProgress();
      audio.destroy();
    }
  });
  audio.onStop(() => {
    if (audioContext === audio) {
      audioContext = null;
      resetPlaybackProgress();
      audio.destroy();
    }
  });
  audio.onError((error) => {
    if (audioContext !== audio) {
      return;
    }
    audioContext = null;
    resetPlaybackProgress();
    audio.destroy();
    showToast(formatError(error, "声音暂时无法播放"));
  });
  audio.play();
}

function cancelAudioDownload() {
  audioPlaybackGeneration += 1;
  const task = audioDownloadTask;
  audioDownloadTask = null;
  if (task) {
    task.abort();
  }
  downloadingAudioId.value = "";
  audioDownloadProgress.value = 0;
}

function destroyPlaybackAudio() {
  const audio = audioContext;
  audioContext = null;
  if (audio) {
    audio.stop();
    audio.destroy();
  }
  resetPlaybackProgress();
}

function resetPlaybackProgress() {
  playingAudioId.value = "";
  audioPlaybackCurrentSeconds.value = 0;
  audioPlaybackDurationSeconds.value = 0;
}

function isRemoteAudioSource(source: string) {
  return /^https?:\/\//i.test(source);
}

function normalizeAudioTime(value: number) {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
}

function formatPlaybackTime(value: number) {
  const totalSeconds = Math.max(0, Math.floor(normalizeAudioTime(value)));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, "0");

  return `${minutes}:${seconds}`;
}

function buildClipMeta(clip: VoiceServiceReviewClipDTO) {
  const parts: string[] = [];
  if (clip.durationSeconds) {
    parts.push(formatDurationText(clip.durationSeconds));
  }
  if (clip.qualityLabel) {
    parts.push(clip.qualityLabel);
  }

  return parts.join(" · ") || "请试听确认";
}

function buildFilteredClipMeta(clip: VoiceServiceFilteredClipDTO) {
  const parts = [clip.sourceName || "已上传素材"];
  if (clip.durationSeconds) {
    parts.push(formatDurationText(clip.durationSeconds));
  }

  return parts.join(" · ");
}

function getMaterialStatusText(item: DisplayMaterialItem) {
  if (item.status === "queued") {
    return "等待上传";
  }
  if (item.status === "uploading") {
    const progress = Math.max(1, Math.min(99, item.progressPercent || 1));
    const sizeText = item.sizeBytes
      ? ` · ${formatFileSize(item.sizeBytes)}`
      : "";

    return `正在上传 ${progress}%${sizeText}`;
  }
  if (item.status === "saving") {
    return "文件已传完，正在安全保存";
  }
  if (item.status === "failed") {
    return item.error || "上传失败";
  }
  if (item.status === "oversized") {
    return (
      item.error ||
      `文件 ${formatFileSize(item.sizeBytes)}，超过 50MB，请压缩或分段后再上传`
    );
  }

  return item.durationSeconds
    ? `上传成功 · ${formatDurationText(item.durationSeconds)}`
    : "上传成功";
}

function getRemainingMaterialCount() {
  return Math.max(
    MAX_MATERIAL_COUNT -
      persistedMaterials.value.length -
      activeLocalUploadCount.value,
    0
  );
}

function getMaterialSectionMeta() {
  const savedCount = persistedMaterials.value.length;
  const localCount = localUploads.value.length;
  if (savedCount > 0 && localCount > 0) {
    return `${savedCount} 份已保存 · ${localCount} 份待处理`;
  }
  if (savedCount > 0) {
    return `${savedCount} 份已保存`;
  }

  return `${localCount} 份待处理`;
}

function updateLocalUpload(
  id: string,
  patch: Partial<LocalMaterialItem>,
  options: { persist?: boolean } = {}
) {
  localUploads.value = localUploads.value.map((item) =>
    item.id === id ? { ...item, ...patch } : item
  );
  if (options.persist !== false) {
    persistLocalUploads();
  }
}

function removeLocalUpload(id: string) {
  localUploads.value = localUploads.value.filter((item) => item.id !== id);
  persistLocalUploads();
}

function handleRemoveLocalUpload(id: string) {
  removeLocalUpload(id);
}

function restoreLocalUploads() {
  const restored = readStoredLocalUploads();
  if (!restored.length) {
    return;
  }

  localUploads.value = restored;
  persistLocalUploads();
  showToast("已恢复上次未完成的素材，可点重试");
}

function readStoredLocalUploads(): LocalMaterialItem[] {
  let parsed: unknown;
  try {
    const raw = Taro.getStorageSync<string>(LOCAL_UPLOAD_STORAGE_KEY);
    parsed = raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) {
    return [];
  }

  const now = Date.now();
  return parsed
    .map((item): LocalMaterialItem | null => {
      const raw = item as Record<string, unknown>;
      const path = getRecordString(raw, "path");
      const name = sanitizeMaterialFileName(
        getRecordString(raw, "name"),
        "声音素材"
      );
      if (!path || !name) {
        return null;
      }

      const createdAt = getRecordPositiveNumber(raw, "createdAt") || now;
      if (now - createdAt > MAX_PENDING_UPLOAD_AGE_MS) {
        return null;
      }

      const sizeBytes = getRecordPositiveNumber(raw, "sizeBytes");
      const storedStatus = getRecordString(raw, "status");
      const status =
        sizeBytes && sizeBytes > MAX_MATERIAL_SIZE_BYTES
          ? "oversized"
          : storedStatus === "oversized"
          ? "oversized"
          : "failed";

      return {
        id:
          getRecordString(raw, "id") ||
          `local_restored_${createdAt}_${Math.random()
            .toString(36)
            .slice(2, 8)}`,
        path,
        name,
        durationSeconds: getRecordPositiveNumber(raw, "durationSeconds"),
        sizeBytes,
        progressPercent:
          status === "failed"
            ? 0
            : Math.max(
                0,
                Math.min(
                  100,
                  Math.round(
                    getRecordPositiveNumber(raw, "progressPercent") || 0
                  )
                )
              ),
        status,
        error:
          status === "oversized"
            ? `文件 ${formatFileSize(
                sizeBytes
              )}，超过 50MB，请压缩或分段后再上传`
            : UPLOAD_INTERRUPTED_MESSAGE,
        createdAt,
      };
    })
    .filter((item): item is LocalMaterialItem => Boolean(item));
}

function persistLocalUploads() {
  try {
    if (!localUploads.value.length) {
      Taro.removeStorageSync(LOCAL_UPLOAD_STORAGE_KEY);
      return;
    }

    Taro.setStorageSync(
      LOCAL_UPLOAD_STORAGE_KEY,
      JSON.stringify(localUploads.value.slice(-MAX_MATERIAL_COUNT))
    );
  } catch {}
}

function readRecognitionText(result: RealtimeRecognitionResult) {
  return (result.result || result.Result || "").trim();
}

function joinVoiceInput(baseText: string, transcript: string) {
  const base = baseText.trim();
  const voiceText = transcript.trim();
  if (!base) {
    return voiceText;
  }
  if (!voiceText) {
    return base;
  }

  return `${base}${/[，。！？；：,.!?;:]$/.test(base) ? "" : "，"}${voiceText}`;
}

async function scrollToPrompt() {
  scrollIntoView.value = "";
  await nextTick();
  scrollIntoView.value = "voice-service-prompt";
}

async function handleAuthError(error: unknown) {
  if (!(error instanceof ApiException) || !error.requiresReLogin) {
    return false;
  }

  isCheckingAuth.value = true;
  await clearAuthSession();
  await redirectToAuthPage();
  return true;
}

function showToast(title: string) {
  void Taro.showToast({ title, icon: "none", duration: 1800 });
}

function formatError(error: unknown, fallback: string) {
  return error instanceof ApiException || error instanceof Error
    ? error.message || fallback
    : fallback;
}

function decodeRouteParam(value?: string) {
  if (typeof value !== "string") {
    return "";
  }

  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function getRecordString(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "string" ? value.trim() : "";
}

function getRecordPositiveNumber(record: Record<string, unknown>, key: string) {
  const value = Number(record[key]);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function formatDurationText(durationSeconds: number) {
  const totalSeconds = Math.max(1, Math.round(durationSeconds));
  if (totalSeconds < 60) {
    return `${totalSeconds}秒`;
  }

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds ? `${minutes}分${seconds}秒` : `${minutes}分钟`;
}

function formatFileSize(sizeBytes?: number) {
  const size = Number(sizeBytes);
  if (!Number.isFinite(size) || size <= 0) {
    return "未知大小";
  }
  if (size < 1024 * 1024) {
    return `${Math.max(1, Math.round(size / 1024))}KB`;
  }

  return `${(size / 1024 / 1024).toFixed(1).replace(/\.0$/, "")}MB`;
}

function buildMaterialFileName(
  path: string,
  prefix: string,
  fallbackExt: string
) {
  const pathWithoutQuery = path.split("?")[0];
  const pathName = pathWithoutQuery.split(/[\\/]/).pop()?.trim();
  const extension = pathName?.match(
    /\.(mp3|m4a|aac|wav|ogg|webm|amr|silk|mp4|m4v|mov)$/i
  )?.[0];

  return sanitizeMaterialFileName(
    `${prefix}_${Date.now()}${extension || fallbackExt}`,
    `${prefix}${fallbackExt}`
  );
}

function sanitizeMaterialFileName(fileName: string, fallback: string) {
  return fileName.trim().replace(/[\\/:*?"<>|]/g, "_") || fallback;
}

function isSupportedMaterialFile(fileName: string) {
  return /\.(mp3|m4a|aac|wav|ogg|webm|amr|silk|mp4|m4v|mov)$/i.test(fileName);
}

function buildAgentFallback(name: string) {
  const trimmed = name.trim();
  return trimmed ? trimmed.slice(0, 1) : "灵";
}
</script>

<style lang="scss">
.voice-service-page {
  min-height: 100vh;
}

.voice-service-state {
  min-height: calc(100vh - 148px);
  box-sizing: border-box;
  padding: 32px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  text-align: center;
}

.voice-service-state__title,
.voice-service-state__text {
  display: block;
}

.voice-service-state__title {
  color: #24222b;
  font-size: 17px;
  line-height: 25px;
  font-weight: 600;
}

.voice-service-state__text {
  color: #85818d;
  font-size: 14px;
  line-height: 21px;
}

.voice-service-content {
  min-height: 100%;
  box-sizing: border-box;
  padding: 16px 16px 28px;
}

.voice-service-messenger {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 0 0 2px;
}

.voice-service-messenger__visual {
  position: relative;
  width: 82px;
  height: 82px;
}

.voice-service-messenger__halo {
  position: absolute;
  inset: -20px;
  border-radius: 50%;
  background: radial-gradient(
    circle,
    rgba(132, 168, 255, 0.22) 0%,
    rgba(150, 115, 231, 0.1) 45%,
    rgba(255, 255, 255, 0) 72%
  );
  animation: voice-service-glow 2.8s ease-in-out infinite;
}

.voice-service-messenger__image {
  position: relative;
  z-index: 1;
  display: block;
  width: 82px;
  height: 82px;
  border-radius: 50%;
  box-shadow: 0 0 18px rgba(100, 127, 220, 0.2);
}

.voice-service-messenger__name,
.voice-service-messenger__status {
  display: block;
}

.voice-service-messenger__name {
  margin-top: 8px;
  color: #24222b;
  font-size: 17px;
  line-height: 24px;
  font-weight: 600;
}

.voice-service-messenger__status {
  margin-top: 2px;
  color: #8a8791;
  font-size: 13px;
  line-height: 20px;
}

.voice-service-prompt {
  display: flex;
  min-height: 84px;
  box-sizing: border-box;
  margin-top: 14px;
  padding: 14px 4px;
  align-items: center;
  border-top: 1px solid #e9e8ed;
  border-bottom: 1px solid #e9e8ed;
}

.voice-service-prompt__content {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 14px;
}

.voice-service-prompt__copy {
  min-width: 0;
  flex: 1;
}

.voice-service-prompt__speech {
  display: flex;
  width: 42px;
  height: 42px;
  flex: 0 0 42px;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: #f0eef5;
}

.voice-service-prompt__speech--active {
  background: #302d3c;
}

.voice-service-prompt__text,
.voice-service-prompt__waiting {
  color: #35313b;
  font-size: 18px;
  line-height: 1.7;
  font-weight: 600;
  white-space: pre-line;
}

.voice-service-prompt__waiting {
  color: #55515d;
}

.voice-service-thinking-dots {
  display: flex;
  margin-left: 10px;
  gap: 5px;
}

.voice-service-thinking-dots view {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #77728f;
  animation: voice-service-dot 1.1s ease-in-out infinite;
}

.voice-service-thinking-dots view:nth-child(2) {
  animation-delay: 0.15s;
}

.voice-service-thinking-dots view:nth-child(3) {
  animation-delay: 0.3s;
}

.voice-service-workspace {
  margin-top: 18px;
}

.voice-service-library-entry {
  min-height: 58px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid #e3e0e7;
  border-radius: 8px;
  background: #ffffff;
}

.voice-service-library-entry__icon {
  width: 36px;
  height: 36px;
  flex: 0 0 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  background: #77728f;
}

.voice-service-library-entry__copy {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.voice-service-library-entry__title {
  color: #302d36;
  font-size: 14px;
  font-weight: 600;
}

.voice-service-library-entry__desc,
.voice-service-library-entry__action {
  color: #8a8690;
  font-size: 12px;
}

.voice-service-section-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.voice-service-section-heading__title,
.voice-service-section-heading__desc,
.voice-service-section-heading__meta {
  display: block;
}

.voice-service-section-heading__title {
  color: #24222b;
  font-size: 16px;
  line-height: 23px;
  font-weight: 600;
}

.voice-service-section-heading__desc {
  margin-top: 3px;
  color: #8a8791;
  font-size: 12px;
  line-height: 18px;
}

.voice-service-section-heading__meta {
  flex: 0 0 auto;
  color: #77728f;
  font-size: 13px;
  line-height: 20px;
}

.voice-service-materials {
  margin-top: 18px;
}

.voice-service-material {
  display: flex;
  align-items: center;
  gap: 11px;
  min-height: 54px;
  border-top: 1px solid #f0eef3;
}

.voice-service-material--attention {
  align-items: flex-start;
  padding: 10px 0;
}

.voice-service-material__icon {
  flex: 0 0 auto;
  width: 34px;
  height: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: #f1eff5;
}

.voice-service-material__copy {
  min-width: 0;
  flex: 1;
}

.voice-service-material__name,
.voice-service-material__status {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.voice-service-material__name {
  color: #38353f;
  font-size: 14px;
  line-height: 20px;
}

.voice-service-material__status {
  margin-top: 2px;
  color: #96929d;
  font-size: 12px;
  line-height: 17px;
}

.voice-service-material--attention .voice-service-material__status {
  white-space: normal;
  overflow: visible;
  color: #a05a40;
}

.voice-service-material__progress {
  width: 100%;
  height: 4px;
  margin-top: 7px;
  border-radius: 999px;
  overflow: hidden;
  background: #ece8f2;
}

.voice-service-material__progress-bar {
  height: 100%;
  border-radius: inherit;
  background: #297b69;
  transition: width 0.2s ease;
}

.voice-service-material__retry {
  flex: 0 0 auto;
  margin: 0;
  padding: 0 10px;
  min-width: 48px;
  height: 30px;
  border: 1px solid #d8d4df;
  border-radius: 999px;
  background: #ffffff;
  color: #5f5a69;
  font-size: 12px;
  line-height: 28px;
}

.voice-service-icon-button,
.voice-service-clip__play,
.voice-service-clip__action,
.voice-service-preview__play,
.voice-service-question__voice-button {
  margin: 0;
  padding: 0;
  border: 0;
  line-height: 1;
}

.voice-service-icon-button::after,
.voice-service-material__retry::after,
.voice-service-clip__play::after,
.voice-service-clip__action::after,
.voice-service-preview__play::after,
.voice-service-question__voice-button::after {
  border: 0;
}

.voice-service-icon-button {
  flex: 0 0 auto;
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
}

.voice-service-material-actions {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 16px;
}

.voice-service-material-actions__secondary,
.voice-service-material-actions__primary {
  width: 100%;
  height: 46px;
}

.voice-service-material-actions__secondary {
  border-color: #d8d4df;
  color: #5f5a69;
}

.voice-service-material-actions__primary {
  border: 0;
  background: #297b69;
}

.voice-service-processing {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 12px 4px 8px;
  text-align: center;
}

.voice-service-processing__orb {
  position: relative;
  width: 58px;
  height: 58px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: #f0eef5;
}

.voice-service-processing__ring {
  position: absolute;
  inset: -5px;
  border: 2px solid rgba(119, 114, 143, 0.15);
  border-top-color: #297b69;
  border-radius: 50%;
  animation: voice-service-spin 1.4s linear infinite;
}

.voice-service-processing__orb--training .voice-service-processing__ring {
  animation-duration: 2s;
}

.voice-service-processing__title,
.voice-service-processing__text,
.voice-service-processing__hint {
  display: block;
}

.voice-service-processing__title {
  margin-top: 18px;
  color: #24222b;
  font-size: 17px;
  line-height: 24px;
  font-weight: 600;
}

.voice-service-processing__text {
  margin-top: 7px;
  color: #6f6b76;
  font-size: 14px;
  line-height: 22px;
}

.voice-service-processing__hint {
  margin-top: 12px;
  color: #a19da7;
  font-size: 12px;
  line-height: 18px;
}

.voice-service-back-step {
  display: inline-flex;
  min-width: 128px;
  height: 36px;
  box-sizing: border-box;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin-top: 18px;
  padding: 0 18px;
  border: 1px solid #d8d4df;
  border-radius: 18px;
  color: #5f5a69;
  font-size: 13px;
  line-height: 1;
  background: #ffffff;
}

.voice-service-back-step::after {
  border: 0;
}

.voice-service-back-step--disabled {
  opacity: 0.64;
  pointer-events: none;
}

.voice-service-back-step--review {
  width: 100%;
  margin-top: 12px;
}

.voice-service-selection-guide {
  margin-top: 14px;
  padding: 0 2px;
}

.voice-service-selection-guide__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.voice-service-selection-guide__selected,
.voice-service-selection-guide__limit {
  font-size: 12px;
  line-height: 18px;
}

.voice-service-selection-guide__selected {
  color: #35313b;
  font-weight: 600;
}

.voice-service-selection-guide__limit {
  color: #85818d;
}

.voice-service-selection-guide__track {
  height: 4px;
  margin-top: 7px;
  overflow: hidden;
  border-radius: 2px;
  background: #e9e7ed;
}

.voice-service-selection-guide__bar {
  height: 100%;
  border-radius: inherit;
  background: #297b69;
  transition: width 0.2s ease;
}

.voice-service-review-start {
  margin-top: 12px;
}

.voice-service-review-start .nut-button {
  height: 44px;
  border: 0;
  background: #297b69;
}

.voice-service-clip {
  margin-top: 12px;
  padding: 14px;
  border: 1px solid #e9e7ed;
  border-radius: 8px;
  background: #fafafb;
}

.voice-service-clip--accepted {
  border-color: rgba(27, 143, 112, 0.32);
  background: #f5fbf8;
}

.voice-service-clip--rejected {
  opacity: 0.72;
}

.voice-service-clip__top {
  display: flex;
  align-items: center;
  gap: 11px;
}

.voice-service-clip__play {
  flex: 0 0 auto;
  width: 38px;
  height: 38px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: #77728f;
}

.voice-service-clip__play--active {
  background: #5e596f;
}

.voice-service-clip__play--loading {
  background: #6d687e;
}

.voice-service-clip__copy {
  min-width: 0;
  flex: 1;
}

.voice-service-clip__name,
.voice-service-clip__source {
  display: block;
}

.voice-service-clip__name {
  color: #2f2c35;
  font-size: 14px;
  line-height: 20px;
  font-weight: 600;
}

.voice-service-clip__source {
  margin-top: 2px;
  overflow: hidden;
  color: #8f8b95;
  font-size: 12px;
  line-height: 18px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.voice-service-clip__result {
  flex: 0 0 auto;
}

.voice-service-audio-progress {
  margin-top: 10px;
}

.voice-service-audio-progress--preview {
  width: 100%;
  max-width: 260px;
  margin: 12px auto 0;
}

.voice-service-audio-progress__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: #817c89;
  font-size: 11px;
  line-height: 17px;
}

.voice-service-audio-progress--playing .voice-service-audio-progress__row {
  color: #686371;
}

.voice-service-audio-progress__track {
  width: 100%;
  height: 4px;
  margin-top: 5px;
  overflow: hidden;
  border-radius: 2px;
  background: #e5e2e9;
}

.voice-service-audio-progress__bar {
  height: 100%;
  border-radius: inherit;
  background: #297b69;
  transition: width 0.15s linear;
}

.voice-service-clip-quality {
  margin-top: 10px;
}

.voice-service-clip-quality__notice {
  display: block;
  margin-top: 4px;
  color: #8a641f;
  font-size: 12px;
  line-height: 18px;
}

.voice-service-clip-quality__notice:first-child {
  margin-top: 0;
}

.voice-service-clip-recut {
  margin-top: 12px;
  padding: 10px 11px;
  border-left: 3px solid #aaa5b5;
  background: #f1eff4;
}

.voice-service-clip-recut--failed {
  border-left-color: #b16a61;
  background: #faf3f2;
}

.voice-service-clip-recut__heading {
  display: flex;
  align-items: center;
  gap: 7px;
  color: #4d4856;
  font-size: 13px;
  line-height: 20px;
  font-weight: 600;
}

.voice-service-clip-recut--failed .voice-service-clip-recut__heading {
  color: #874d47;
}

.voice-service-clip-recut__instruction {
  display: block;
  margin-top: 4px;
  color: #77727e;
  font-size: 12px;
  line-height: 19px;
}

.voice-service-clip-recut__completed {
  display: block;
  margin-top: 11px;
  color: #25745f;
  font-size: 12px;
  line-height: 19px;
}

.voice-service-clip__actions {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  margin-top: 12px;
}

.voice-service-clip__action {
  display: flex;
  min-width: 0;
  height: 36px;
  box-sizing: border-box;
  align-items: center;
  justify-content: center;
  padding: 0 8px;
  border: 1px solid #dedbe3;
  border-radius: 6px;
  color: #6f6b76;
  font-size: 12px;
  line-height: 17px;
  text-align: center;
  background: #ffffff;
}

.voice-service-clip__action--selected {
  border-color: #aaa5b5;
  color: #403c49;
  background: #ece9f1;
}

.voice-service-clip__action--accept.voice-service-clip__action--selected {
  border-color: #1b8f70;
  color: #ffffff;
  background: #1b8f70;
}

.voice-service-filtered-section {
  margin-top: 18px;
  padding-top: 16px;
  border-top: 1px solid #eeecf1;
}

.voice-service-filtered-section__title,
.voice-service-filtered-section__desc,
.voice-service-filtered-clip__name,
.voice-service-filtered-clip__source,
.voice-service-filtered-clip__reason {
  display: block;
}

.voice-service-filtered-section__title {
  color: #35313a;
  font-size: 15px;
  line-height: 22px;
  font-weight: 600;
}

.voice-service-filtered-section__desc {
  margin-top: 3px;
  color: #85818d;
  font-size: 12px;
  line-height: 19px;
}

.voice-service-filtered-clip {
  margin-top: 10px;
  padding: 12px;
  border: 1px solid #eadedb;
  border-radius: 8px;
  background: #fcf9f8;
}

.voice-service-filtered-clip__top {
  display: flex;
  align-items: baseline;
  gap: 10px;
}

.voice-service-filtered-clip__name {
  flex: 0 0 auto;
  color: #4f4543;
  font-size: 13px;
  line-height: 20px;
  font-weight: 600;
}

.voice-service-filtered-clip__source {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  color: #938784;
  font-size: 11px;
  line-height: 18px;
  text-align: right;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.voice-service-filtered-clip__reason {
  margin-top: 6px;
  color: #a04436;
  font-size: 12px;
  line-height: 18px;
}

.voice-service-review-summary {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid #eeecf1;
}

.voice-service-review-summary__title,
.voice-service-review-summary__text {
  display: block;
}

.voice-service-review-summary__title {
  color: #24222b;
  font-size: 15px;
  line-height: 22px;
  font-weight: 600;
}

.voice-service-review-summary__text {
  margin: 4px 0 13px;
  color: #85818d;
  font-size: 13px;
  line-height: 20px;
}

.voice-service-review-summary .nut-button {
  height: 46px;
  border: 0;
  background: #297b69;
}

.voice-service-preview {
  text-align: center;
}

.voice-service-preview__eyebrow,
.voice-service-preview__title,
.voice-service-preview__text {
  display: block;
}

.voice-service-preview__eyebrow {
  color: #1b8f70;
  font-size: 12px;
  line-height: 18px;
  font-weight: 600;
}

.voice-service-preview__title {
  margin-top: 4px;
  color: #24222b;
  font-size: 20px;
  line-height: 28px;
  font-weight: 600;
}

.voice-service-preview__text {
  margin-top: 7px;
  color: #77737e;
  font-size: 14px;
  line-height: 22px;
}

.voice-service-preview__retention-notice {
  margin-top: 12px;
  padding: 10px 12px;
  border-left: 3px solid #1b8f70;
  background: #f1f7f4;
  color: #50635c;
  font-size: 12px;
  line-height: 19px;
  text-align: left;
}

.voice-service-preview__play {
  height: 44px;
  margin: 16px auto 0;
  padding: 0 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border-radius: 22px;
  color: #ffffff;
  font-size: 14px;
  background: #297b69;
}

.voice-service-agent-select {
  margin-top: 22px;
  padding-top: 18px;
  border-top: 1px solid #eeecf1;
}

.voice-service-agent-select__loading,
.voice-service-agent-select__empty {
  min-height: 88px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 9px;
  color: #85818d;
  font-size: 13px;
  text-align: center;
}

.voice-service-agent {
  min-height: 62px;
  display: flex;
  align-items: center;
  gap: 11px;
  border-top: 1px solid #efedf2;
}

.voice-service-agent--selected {
  color: #1b8f70;
}

.voice-service-agent__avatar {
  flex: 0 0 auto;
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border-radius: 50%;
}

.voice-service-agent__avatar--fallback {
  color: #ffffff;
  font-size: 15px;
  font-weight: 600;
  background: #8f89a2;
}

.voice-service-agent__copy {
  min-width: 0;
  flex: 1;
}

.voice-service-agent__name,
.voice-service-agent__hint {
  display: block;
}

.voice-service-agent__name {
  color: #302d36;
  font-size: 14px;
  line-height: 20px;
  font-weight: 600;
}

.voice-service-agent__hint {
  margin-top: 2px;
  color: #93909a;
  font-size: 12px;
  line-height: 17px;
}

.voice-service-failed {
  padding: 8px 0;
  text-align: center;
}

.voice-service-failed__title,
.voice-service-failed__text {
  display: block;
}

.voice-service-failed__title {
  color: #24222b;
  font-size: 17px;
  line-height: 24px;
  font-weight: 600;
}

.voice-service-failed__text {
  margin: 7px 0 15px;
  color: #77737e;
  font-size: 14px;
  line-height: 22px;
}

.voice-service-failed__actions {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.voice-service-failed__actions .voice-service-back-step {
  width: 100%;
  margin-top: 0;
}

.voice-service-question {
  margin-top: 22px;
  padding: 14px;
  border: 1px solid #dedce3;
  border-radius: 8px;
  background: #ffffff;
}

.voice-service-question__title {
  display: block;
  color: #55515d;
  font-size: 13px;
  line-height: 20px;
  font-weight: 600;
}

.voice-service-question__input {
  width: 100%;
  min-height: 64px;
  max-height: 96px;
  margin-top: 8px;
  color: #2f2c35;
  font-size: 16px;
  line-height: 1.55;
}

.voice-service-question__placeholder {
  color: #aaa7af;
}

.voice-service-question__footer {
  display: flex;
  min-height: 40px;
  margin-top: 7px;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.voice-service-question__voice-tool {
  display: flex;
  align-items: center;
  color: #77747f;
  font-size: 12px;
  gap: 8px;
}

.voice-service-question__voice-button {
  display: flex;
  width: 40px;
  height: 40px;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: #302d3c;
}

.voice-service-question__voice-button--recording {
  background: #9d4c55;
  animation: voice-service-recording 1.2s ease-in-out infinite;
}

.voice-service-question__send {
  min-width: 108px;
  --nut-button-primary-background-color: #297b69;
  --nut-button-primary-border-color: #297b69;
}

.voice-service-question__send :deep(.nut-button__wrap) {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}

.voice-service-privacy {
  margin-top: 24px;
  padding-top: 18px;
  border-top: 1px solid #e5e2e8;
}

.voice-service-privacy__copy {
  margin-bottom: 12px;
}

.voice-service-privacy__title,
.voice-service-privacy__text,
.voice-service-privacy__error {
  display: block;
}

.voice-service-privacy__title {
  color: #4c4852;
  font-size: 14px;
  line-height: 21px;
  font-weight: 600;
}

.voice-service-privacy__text {
  margin-top: 4px;
  color: #88848e;
  font-size: 12px;
  line-height: 19px;
}

.voice-service-privacy__error {
  margin-top: 6px;
  color: #b23b45;
  font-size: 12px;
  line-height: 19px;
}

.voice-service-privacy__delete {
  height: 42px;
}

.voice-service-privacy__delete :deep(.nut-button__wrap) {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
}

.voice-service-bottom-anchor {
  height: 1px;
}

.voice-service-recut-dialog__content {
  padding-top: 2px;
}

.voice-service-recut-dialog__label,
.voice-service-recut-dialog__hint {
  display: block;
}

.voice-service-recut-dialog__label {
  color: #4d4954;
  font-size: 13px;
  line-height: 20px;
}

.voice-service-recut-dialog__textarea {
  width: 100%;
  height: 104px;
  box-sizing: border-box;
  margin-top: 9px;
  padding: 10px 11px;
  border: 1px solid #dedbe3;
  border-radius: 6px;
  color: #302d36;
  font-size: 15px;
  line-height: 23px;
  background: #fafafb;
}

.voice-service-recut-dialog__hint {
  margin-top: 7px;
  color: #918d97;
  font-size: 12px;
  line-height: 18px;
}

.voice-service-recut-dialog__footer {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.45fr);
  gap: 9px;
  width: 100%;
}

.voice-service-recut-dialog__cancel,
.voice-service-recut-dialog__confirm {
  width: 100%;
  height: 42px;
}

.voice-service-recut-dialog__confirm {
  --nut-button-primary-background-color: #297b69;
  --nut-button-primary-border-color: #297b69;
}

@keyframes voice-service-dot {
  0%,
  60%,
  100% {
    opacity: 0.35;
    transform: translateY(0);
  }

  30% {
    opacity: 1;
    transform: translateY(-3px);
  }
}

@keyframes voice-service-spin {
  from {
    transform: rotate(0deg);
  }

  to {
    transform: rotate(360deg);
  }
}

@keyframes voice-service-glow {
  0%,
  100% {
    opacity: 0.55;
    transform: scale(0.94);
  }

  50% {
    opacity: 1;
    transform: scale(1.08);
  }
}

@keyframes voice-service-recording {
  0%,
  100% {
    box-shadow: 0 0 0 0 rgba(157, 76, 85, 0.24);
  }

  50% {
    box-shadow: 0 0 0 8px rgba(157, 76, 85, 0);
  }
}
</style>
