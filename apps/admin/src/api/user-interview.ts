import axios from 'axios';

export interface InterviewAnswer {
  no: number;
  question: string;
  answer: string;
  quotes?: string[];
}

export interface UserInterviewRecord {
  id: string;
  userId: string;
  title: string;
  interviewDate: string;
  transcript: string;
  transcriptFileName?: string;
  transcriptChars: number;
  answers: InterviewAnswer[];
  status: 'draft' | 'structured';
  model?: string;
  structuredAt?: string | null;
  lastError?: string;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface InterviewOutlineItem {
  no: number;
  question: string;
}

export interface InterviewSection {
  title: string;
  from: number;
  to: number;
}

export function listUserInterviews(userId: string) {
  return axios.get<UserInterviewRecord[]>('/admin_api/user-interviews', {
    params: { userId },
  });
}

export function getInterviewOutline() {
  return axios.get<{
    outline: InterviewOutlineItem[];
    sections: InterviewSection[];
  }>('/admin_api/user-interviews/outline');
}

export function createUserInterview(data: {
  userId: string;
  title?: string;
  interviewDate?: string;
  transcript: string;
  transcriptFileName?: string;
}) {
  return axios.post<UserInterviewRecord>('/admin_api/user-interviews', data);
}

export function updateUserInterview(
  id: string,
  data: {
    title?: string;
    interviewDate?: string;
    transcript?: string;
    answers?: InterviewAnswer[];
  }
) {
  return axios.put<UserInterviewRecord>(
    `/admin_api/user-interviews/${id}`,
    data
  );
}

export function structureUserInterview(id: string) {
  return axios.post<UserInterviewRecord>(
    `/admin_api/user-interviews/${id}/structure`
  );
}

export function deleteUserInterview(id: string) {
  return axios.delete(`/admin_api/user-interviews/${id}`);
}

export function extractInterviewDocx(data: {
  fileName?: string;
  base64: string;
}) {
  return axios.post<{ fileName: string; chars: number; text: string }>(
    '/admin_api/user-interviews/extract-docx',
    data
  );
}
