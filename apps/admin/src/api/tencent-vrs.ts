import axios from 'axios';

/**
 * 腾讯云声音复刻（一句话版）管理员 API。
 * 凭证只在服务端，前端只传业务字段。
 */

export interface TencentVrsGenderOption {
  value: number;
  label: string;
}

export interface TencentVrsTrainingTextRes {
  textId: string;
  text: string;
  genderOptions: TencentVrsGenderOption[];
  requirements: string[];
}

export interface TencentVrsDetectionTip {
  word: string;
  tag: number;
  pronAccuracy?: number;
  pronFluency?: number;
}

export interface TencentVrsDetectQualityRes {
  audioId: string;
  detectionCode: number;
  detectionMsg: string;
  detectionTip: TencentVrsDetectionTip[];
}

export interface TencentVrsTrainRes {
  timbreId: string;
  providerTaskId: string;
  voiceGender: number;
  status: string;
}

export interface TencentVrsTrainStatusRes {
  timbreId: string;
  providerTaskId: string;
  providerVoiceId: string;
  providerVoiceType: string;
  status: string;
  /** waiting / running / success / failed */
  phase: 'waiting' | 'running' | 'success' | 'failed';
  statusStr: string;
  errorCode: string;
  errorMessage: string;
  previewAudioUrl: string;
}

export interface TencentVrsVoiceItem {
  voiceType: number;
  voiceName: string;
  voiceGender?: number;
  taskType?: number;
  taskId?: string;
  dateCreated?: string;
  isDeployed?: boolean;
  expireTime?: string;
  fastVoiceType?: string;
}

export interface TencentVrsAuditionRes {
  audioUrl: string;
}

export function getTencentVrsTrainingText() {
  return axios.get<TencentVrsTrainingTextRes>(
    '/admin_api/tencent-vrs/training-text'
  );
}

export function detectTencentVrsQuality(data: {
  audioKey: string;
  textId: string;
}) {
  return axios.post<TencentVrsDetectQualityRes>(
    '/admin_api/tencent-vrs/detect-quality',
    data
  );
}

export function trainTencentVrs(data: {
  audioId: string;
  voiceName: string;
  /** 1=男，2=女（整数） */
  voiceGender: number;
  textId: string;
  userId: string;
  audioKey: string;
  voiceDescription?: string;
  remark?: string;
}) {
  return axios.post<TencentVrsTrainRes>('/admin_api/tencent-vrs/train', data);
}

export function getTencentVrsTrainStatus(timbreId: string) {
  return axios.get<TencentVrsTrainStatusRes>(
    `/admin_api/tencent-vrs/timbres/${timbreId}/status`
  );
}

export function listTencentVrsVoices() {
  return axios.get<{ items: TencentVrsVoiceItem[] }>(
    '/admin_api/tencent-vrs/voices'
  );
}

export function auditionTencentVrs(data: { timbreId: string; text: string }) {
  return axios.post<TencentVrsAuditionRes>(
    '/admin_api/tencent-vrs/audition',
    data
  );
}
