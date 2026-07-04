export type PostModerationStatusDTO = 'normal' | 'risk_controlled';

export interface AdminPostAuthorDTO {
  id: string;
  account: string;
  name: string;
  avatar: string;
  phone: string;
}

export interface AdminPostRecordDTO {
  id: string;
  userId: string;
  user: AdminPostAuthorDTO | null;
  content: string;
  images: string[];
  remindAgentIds: string[];
  moderationStatus: PostModerationStatusDTO;
  moderationReason: string;
  moderatedAt: string;
  isRiskControlled: boolean;
  likeCount: number;
  commentCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface AdminPostListParamsDTO {
  keyword?: string;
  userId?: string;
  moderationStatus?: PostModerationStatusDTO;
  page?: number;
  pageSize?: number;
}

export interface AdminPostListDTO {
  items: AdminPostRecordDTO[];
  total: number;
  page: number;
  pageSize: number;
}

export interface UpdateAdminPostModerationDTO {
  moderationStatus: PostModerationStatusDTO;
  moderationReason?: string;
}
