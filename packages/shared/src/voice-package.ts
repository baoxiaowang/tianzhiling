export type VoicePackageStatusDTO = 'active' | 'disabled';

export interface VoicePackageDeliverableDTO {
  title: string;
  description?: string;
}

export interface AdminVoicePackageRecordDTO {
  id: string;
  code: string;
  name: string;
  description: string;
  priceAmount: number;
  originalPriceAmount?: number;
  currency: string;
  deliverables: VoicePackageDeliverableDTO[];
  materialRequirement: string;
  estimatedServiceDays?: number;
  status: VoicePackageStatusDTO;
  sort: number;
  createdAt: string;
  updatedAt: string;
}

export interface AdminVoicePackageListParamsDTO {
  keyword?: string;
  status?: VoicePackageStatusDTO;
  page?: number;
  pageSize?: number;
}

export interface AdminVoicePackageListDTO {
  items: AdminVoicePackageRecordDTO[];
  total: number;
  page: number;
  pageSize: number;
}

export interface VoicePackageRecordDTO {
  id: string;
  code: string;
  name: string;
  description: string;
  priceAmount: number;
  originalPriceAmount?: number;
  currency: string;
  deliverables: VoicePackageDeliverableDTO[];
  materialRequirement: string;
  estimatedServiceDays?: number;
}

export interface SaveAdminVoicePackageDTO {
  code: string;
  name: string;
  description?: string;
  priceAmount: number;
  originalPriceAmount?: number;
  currency?: string;
  deliverables?: VoicePackageDeliverableDTO[];
  materialRequirement?: string;
  estimatedServiceDays?: number;
  status?: VoicePackageStatusDTO;
  sort?: number;
}

export type VoiceTrainingTaskStatusDTO =
  | 'paid'
  | 'awaiting_material'
  | 'processing'
  | 'training'
  | 'completed'
  | 'failed'
  | 'refunded';

export interface VoiceTrainingTaskUserDTO {
  id: string;
  account: string;
  name: string;
  phone: string;
}

export interface VoiceTrainingTaskAgentDTO {
  id: string;
  name: string;
  avatar: string;
}

export interface AdminVoiceTrainingTaskRecordDTO {
  id: string;
  userId: string;
  user?: VoiceTrainingTaskUserDTO;
  agentId: string;
  agent?: VoiceTrainingTaskAgentDTO;
  orderId: string;
  orderNo?: string;
  voicePackageId: string;
  voicePackageCode: string;
  voicePackageName?: string;
  status: VoiceTrainingTaskStatusDTO;
  assigneeName: string;
  materialObjectKeys: string[];
  voiceTimbreId?: string;
  remark: string;
  paidAt?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AdminVoiceTrainingTaskListParamsDTO {
  keyword?: string;
  status?: VoiceTrainingTaskStatusDTO;
  agentId?: string;
  userId?: string;
  page?: number;
  pageSize?: number;
}

export interface AdminVoiceTrainingTaskListDTO {
  items: AdminVoiceTrainingTaskRecordDTO[];
  total: number;
  page: number;
  pageSize: number;
}

export interface UpdateAdminVoiceTrainingTaskDTO {
  status?: Exclude<VoiceTrainingTaskStatusDTO, 'completed'>;
  assigneeName?: string;
  materialObjectKeys?: string[];
  voiceTimbreId?: string;
  remark?: string;
}

export interface CompleteAdminVoiceTrainingTaskDTO {
  voiceTimbreId: string;
  remark?: string;
}

export interface VoiceTrainingTaskRecordDTO {
  id: string;
  agentId: string;
  orderId: string;
  voicePackageId: string;
  voicePackageCode: string;
  voicePackageName?: string;
  status: VoiceTrainingTaskStatusDTO;
  voiceTimbreId?: string;
  remark: string;
  paidAt?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AgentVoicePackageCenterDTO {
  packages: VoicePackageRecordDTO[];
  task?: VoiceTrainingTaskRecordDTO;
}
