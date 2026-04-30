import axios from 'axios';
import type { RouteRecordNormalized } from 'vue-router';
import { UserState } from '@/store/modules/user/types';

export interface LoginData {
  username: string;
  password: string;
}

export interface LoginRes {
  accessToken: string;
  tokenType: 'Bearer';
  expiresAt: number;
  admin: {
    id: string;
    account: string;
    roles: string[];
  };
}
export function login(data: LoginData) {
  return axios.post<LoginRes>('/admin_api/auth/login', {
    account: data.username,
    password: data.password,
  });
}

export function logout() {
  return Promise.resolve();
}

export function getUserInfo() {
  return axios.get<UserState>('/admin_api/auth/me');
}

export interface AdminBootstrapStatus {
  hasSuperAdmin: boolean;
}

export interface AdminBootstrapRegisterData {
  name: string;
  account: string;
  password: string;
}

export interface AdminBootstrapRegisterRes {
  admin: {
    id: string;
    account: string;
    name: string;
    roles: string[];
  };
}

export function getAdminBootstrapStatus() {
  return axios.get<AdminBootstrapStatus>('/admin_api/auth/bootstrap-status', {
    hideErrorMessage: true,
  } as Parameters<typeof axios.get<AdminBootstrapStatus>>[1] & {
    hideErrorMessage: boolean;
  });
}

export function registerAdminBootstrap(data: AdminBootstrapRegisterData) {
  return axios.post<AdminBootstrapRegisterRes>(
    '/admin_api/auth/bootstrap-register',
    data
  );
}

export function getMenuList() {
  return axios.post<RouteRecordNormalized[]>('/api/user/menu');
}
