import {
  computed,
  onBeforeUnmount,
  reactive,
  ref,
  toValue,
  type Ref,
} from 'vue';
import { Message } from '@arco-design/web-vue';
import uploadAdminFile from '@/api/storage';
import {
  auditionTencentVrs,
  detectTencentVrsQuality,
  getTencentVrsTrainingText,
  getTencentVrsTrainStatus,
  trainTencentVrs,
  type TencentVrsTrainingTextRes,
  type TencentVrsTrainStatusRes,
} from '@/api/tencent-vrs';

/**
 * 腾讯云声音复刻（一句话版）额度不足 / 未开通错误判定。
 * 与后端约定：HTTP 402 或业务码 TENCENT_VRS_QUOTA_EXHAUSTED。
 */
export function isVrsQuotaError(error: unknown): boolean {
  const status = (error as { response?: { status?: number } })?.response
    ?.status;
  const code = (error as { response?: { data?: { code?: string } } })?.response
    ?.data?.code;
  return status === 402 || code === 'TENCENT_VRS_QUOTA_EXHAUSTED';
}

const MAX_AUDIO_SIZE = 2 * 1024 * 1024; // 2MB

export interface TencentVrsWizardLoading {
  text: boolean;
  upload: boolean;
  detect: boolean;
  train: boolean;
  status: boolean;
  audition: boolean;
}

/**
 * 腾讯云声音复刻（一句话版）6 步向导的状态机 + API 调用 + 轮询逻辑。
 *
 * 状态流转：
 *   选择性别 → 获取文案(trainingText) → 上传录音(audioKey) → 音质检测(detectedAudioId)
 *   → 创建训练(result.timbreId) → 轮询状态(phase: waiting/running/success/failed) → 试听(auditionUrl)
 *
 * 每个 composable 实例独立持有轮询 timer，组件卸载时自动清理。
 */
export default function useTencentVrsWizard(userId: Ref<string> | string) {
  const form = reactive({
    voiceName: '',
    voiceGender: 2 as number, // 1=男，2=女（整数）
    audioKey: '',
  });

  const loading = reactive<TencentVrsWizardLoading>({
    text: false,
    upload: false,
    detect: false,
    train: false,
    status: false,
    audition: false,
  });

  const trainingText = ref<TencentVrsTrainingTextRes>();
  const detectedAudioId = ref('');
  const detectError = ref('');
  const quotaError = ref(false);
  const result = ref<Partial<TencentVrsTrainStatusRes>>({});
  const auditionUrl = ref('');
  /** 当前录音的本地预览地址，避免依赖 COS 桶的公开读取权限。 */
  const uploadedAudioUrl = ref('');
  let localAudioUrl = '';

  let pollTimer: number | undefined;
  let generation = 0;

  /** 当前所处步骤（1~6），与 UI 步骤条一一对应。 */
  const step = computed(() => {
    if (result.value.phase === 'success') return 6;
    if (result.value.phase === 'failed') return 5;
    if (result.value.timbreId) return 5;
    if (detectedAudioId.value) return 4;
    if (form.audioKey) return 3;
    if (trainingText.value) return 2;
    return 1;
  });

  const statusTag = computed(() => {
    const { phase } = result.value;
    if (phase === 'success') return 'success';
    if (phase === 'failed') return 'danger';
    if (phase === 'running') return 'warning';
    return 'default';
  });

  const stopPolling = () => {
    if (pollTimer !== undefined) {
      window.clearTimeout(pollTimer);
      pollTimer = undefined;
    }
  };

  const clearAudioPreview = () => {
    if (localAudioUrl) URL.revokeObjectURL(localAudioUrl);
    localAudioUrl = '';
    uploadedAudioUrl.value = '';
  };

  const fetchTrainingText = async () => {
    generation += 1;
    const requestGeneration = generation;
    stopPolling();
    trainingText.value = undefined;
    form.audioKey = '';
    clearAudioPreview();
    detectedAudioId.value = '';
    detectError.value = '';
    result.value = {};
    auditionUrl.value = '';
    Object.keys(loading).forEach((key) => {
      loading[key as keyof TencentVrsWizardLoading] = false;
    });
    loading.text = true;
    quotaError.value = false;
    try {
      const { data } = await getTencentVrsTrainingText();
      if (requestGeneration !== generation) return;
      trainingText.value = data;
      Message.success('已获取指定训练文案，请严格按文案朗读');
    } catch (error) {
      if (requestGeneration !== generation) return;
      if (isVrsQuotaError(error)) quotaError.value = true;
      Message.error(error instanceof Error ? error.message : '获取文案失败');
    } finally {
      if (requestGeneration === generation) loading.text = false;
    }
  };

  /** Arco a-upload 的 before-upload 钩子：手动上传到 COS，返回 false 阻止自动上传。 */
  const handleBeforeUpload = async (file: File) => {
    if (!trainingText.value) {
      Message.warning('请先获取指定训练文案');
      return false;
    }
    if (file.size > MAX_AUDIO_SIZE) {
      Message.error('录音文件不能超过 2MB');
      return false;
    }
    generation += 1;
    const requestGeneration = generation;
    stopPolling();
    form.audioKey = '';
    clearAudioPreview();
    detectedAudioId.value = '';
    detectError.value = '';
    result.value = {};
    auditionUrl.value = '';
    loading.detect = false;
    loading.train = false;
    loading.status = false;
    loading.audition = false;
    loading.upload = true;
    try {
      const uploaded = await uploadAdminFile(file, {
        folder: 'voice-timbres',
        contentType: file.type,
      });
      if (requestGeneration !== generation) return false;
      form.audioKey = uploaded.objectKey;
      localAudioUrl = URL.createObjectURL(file);
      uploadedAudioUrl.value = localAudioUrl;
      detectedAudioId.value = '';
      detectError.value = '';
      result.value = {};
      auditionUrl.value = '';
      Message.success('录音已上传到 COS');
    } catch (error) {
      if (requestGeneration !== generation) return false;
      Message.error(error instanceof Error ? error.message : '上传失败');
    } finally {
      if (requestGeneration === generation) loading.upload = false;
    }
    return false;
  };

  const runDetect = async () => {
    if (!trainingText.value) {
      Message.warning('请先获取指定文案');
      return;
    }
    if (!form.audioKey) {
      Message.warning('请先上传按稿录音');
      return;
    }
    const requestGeneration = generation;
    loading.detect = true;
    detectError.value = '';
    quotaError.value = false;
    detectedAudioId.value = '';
    try {
      const { data } = await detectTencentVrsQuality({
        audioKey: form.audioKey,
        textId: trainingText.value.textId,
      });
      if (requestGeneration !== generation) return;
      detectedAudioId.value = data.audioId;
      Message.success('音质检测通过');
    } catch (error) {
      if (requestGeneration !== generation) return;
      if (isVrsQuotaError(error)) {
        quotaError.value = true;
      } else {
        detectError.value =
          (error as { response?: { data?: { message?: string } } })?.response
            ?.data?.message ||
          (error instanceof Error ? error.message : '音质检测未通过');
      }
    } finally {
      if (requestGeneration === generation) loading.detect = false;
    }
  };

  const runTrain = async () => {
    if (loading.train || result.value.timbreId) return;
    if (!detectedAudioId.value) {
      Message.warning('请先完成音质检测');
      return;
    }
    const ownerId = toValue(userId).trim();
    if (!ownerId || !form.voiceName.trim()) {
      Message.warning('请填写归属用户 ID 与音色名称');
      return;
    }
    const textId = trainingText.value?.textId;
    if (!textId) {
      Message.warning('请先获取指定文案');
      return;
    }
    const requestGeneration = generation;
    loading.train = true;
    quotaError.value = false;
    try {
      const { data } = await trainTencentVrs({
        audioId: detectedAudioId.value,
        voiceName: form.voiceName.trim(),
        voiceGender: form.voiceGender,
        textId,
        userId: ownerId,
        audioKey: form.audioKey,
      });
      if (requestGeneration !== generation) return;
      result.value = {
        timbreId: data.timbreId,
        providerTaskId: data.providerTaskId,
        status: data.status,
        phase: 'waiting',
      };
      Message.success('训练任务已创建');
      await pollStatus();
    } catch (error) {
      if (requestGeneration !== generation) return;
      if (isVrsQuotaError(error)) quotaError.value = true;
      Message.error(
        error instanceof Error ? error.message : '创建训练任务失败'
      );
    } finally {
      if (requestGeneration === generation) loading.train = false;
    }
  };

  const pollStatus = async () => {
    const { timbreId } = result.value;
    if (!timbreId || loading.status) return;
    const requestGeneration = generation;
    loading.status = true;
    try {
      const { data } = await getTencentVrsTrainStatus(timbreId);
      if (requestGeneration !== generation) return;
      result.value = data;
      if (data.phase === 'waiting' || data.phase === 'running') {
        stopPolling();
        pollTimer = window.setTimeout(pollStatus, 3000);
      }
    } catch (error) {
      if (requestGeneration !== generation) return;
      if (isVrsQuotaError(error)) quotaError.value = true;
      Message.error(
        error instanceof Error ? error.message : '查询训练状态失败'
      );
    } finally {
      if (requestGeneration === generation) loading.status = false;
    }
  };

  const runAudition = async () => {
    const { timbreId } = result.value;
    if (!timbreId) return;
    const requestGeneration = generation;
    loading.audition = true;
    try {
      const { data } = await auditionTencentVrs({
        timbreId,
        text: trainingText.value?.text || '我好想你，最近过得好吗',
      });
      if (requestGeneration !== generation) return;
      auditionUrl.value = data.audioUrl;
    } catch (error) {
      if (requestGeneration !== generation) return;
      if (isVrsQuotaError(error)) quotaError.value = true;
      Message.error(error instanceof Error ? error.message : '试听合成失败');
    } finally {
      if (requestGeneration === generation) loading.audition = false;
    }
  };

  /** 重置向导到初始状态（停止轮询并清空全部步骤数据）。 */
  const reset = () => {
    generation += 1;
    stopPolling();
    Object.keys(loading).forEach((key) => {
      loading[key as keyof TencentVrsWizardLoading] = false;
    });
    form.voiceName = '';
    form.voiceGender = 2;
    form.audioKey = '';
    clearAudioPreview();
    trainingText.value = undefined;
    detectedAudioId.value = '';
    detectError.value = '';
    quotaError.value = false;
    result.value = {};
    auditionUrl.value = '';
  };

  onBeforeUnmount(() => {
    generation += 1;
    stopPolling();
    clearAudioPreview();
  });

  return {
    form,
    loading,
    trainingText,
    detectedAudioId,
    detectError,
    quotaError,
    result,
    auditionUrl,
    uploadedAudioUrl,
    step,
    statusTag,
    fetchTrainingText,
    handleBeforeUpload,
    runDetect,
    runTrain,
    pollStatus,
    runAudition,
    reset,
    stopPolling,
  };
}
