import axios from 'axios';
import type {
  AdminPostListDTO,
  AdminPostListParamsDTO,
  AdminPostRecordDTO,
  UpdateAdminPostModerationDTO,
  UpdateAdminPostPinningDTO,
} from '@tzl/shared';

export type PostRecord = AdminPostRecordDTO;
export type PostListParams = AdminPostListParamsDTO;
export type PostListRes = AdminPostListDTO;
export type UpdatePostModerationData = UpdateAdminPostModerationDTO;
export type UpdatePostPinningData = UpdateAdminPostPinningDTO;

export function queryPostList(params: PostListParams) {
  return axios.get<PostListRes>('/admin_api/posts', { params });
}

export function updatePostModeration(
  id: string,
  data: UpdatePostModerationData
) {
  return axios.put<PostRecord>(`/admin_api/posts/${id}/moderation`, data);
}

export function updatePostPinning(id: string, data: UpdatePostPinningData) {
  return axios.put<PostRecord>(`/admin_api/posts/${id}/pinning`, data);
}
