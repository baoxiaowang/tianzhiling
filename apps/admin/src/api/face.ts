import axios from 'axios';

export interface AdminFacePerson {
  personId: string;
  name: string;
  relation?: string;
  aliases?: string[];
  linkedAgentId?: string;
  faceCount: number;
  lastRegisteredAt?: string;
}

export interface AdminFaceRecognizeFace {
  decision: 'confirmed' | 'ask' | 'unknown';
  top1?: { personId?: string; name?: string; score?: number };
  margin?: number;
  quality?: {
    faceSize?: number;
    blur?: number;
    brightness?: number;
    yaw?: number;
  };
  gatedBy?: string;
}

export interface AdminFaceRecognizeResult {
  enabled: boolean;
  model?: string;
  latencyMs: number;
  faces: AdminFaceRecognizeFace[];
  candidates: Array<
    Array<{ personId: string; name: string; score: number; distance: number }>
  >;
}

/** 某用户的「家人相册」：已认识的人 + 已登记人脸数 */
export function queryFacePersons(userId: string) {
  return axios.get<AdminFacePerson[]>('/admin_api/face/persons', {
    params: { userId },
  });
}

/** 给某个「认识的人」登记人脸（传 COS objectKey） */
export function registerFaceTemplates(
  userId: string,
  personId: string,
  objectKeys: string[]
) {
  return axios.post<{ stored: number; skipped: number }>(
    `/admin_api/face/persons/${personId}/faces`,
    { userId, objectKeys }
  );
}

/** 清空某个人的全部人脸模板 */
export function deleteFaceTemplates(userId: string, personId: string) {
  return axios.post<{ deleted: number }>(
    `/admin_api/face/persons/${personId}/faces/delete`,
    { userId }
  );
}

/** 识别测试：上传一张图，返回每张脸的判定 */
export function recognizeFaceImage(body: {
  userId: string;
  agentId?: string;
  objectKey?: string;
  imageBase64?: string;
}) {
  return axios.post<AdminFaceRecognizeResult>(
    '/admin_api/face/recognize',
    body,
    {
      hideErrorMessage: true,
    } as never
  );
}
