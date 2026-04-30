import axios from 'axios';
import type { AxiosRequestConfig, AxiosResponse } from 'axios';
import { Message, Modal } from '@arco-design/web-vue';
import { useUserStore } from '@/store';
import { getToken } from '@/utils/auth';

export interface HttpResponse<T = unknown> {
  status?: number;
  msg?: string;
  success?: boolean;
  message?: string;
  code: number | string;
  data: T;
}

interface TzlAxiosRequestConfig extends AxiosRequestConfig {
  hideErrorMessage?: boolean;
}

const TOKEN_ERROR_CODES = [
  50008,
  50012,
  50014,
  'UNAUTHORIZED',
  'INVALID_AUTHORIZATION',
  'INVALID_TOKEN',
  'TOKEN_EXPIRED',
];

function shouldHandleTokenError(code?: number | string) {
  return code !== undefined && TOKEN_ERROR_CODES.includes(code);
}

function getErrorMessage(response?: Partial<HttpResponse>) {
  return response?.message || response?.msg || 'Request Error';
}

function showErrorMessage(
  config: TzlAxiosRequestConfig | undefined,
  message: string
) {
  if (config?.hideErrorMessage) {
    return;
  }

  Message.error({
    content: message,
    duration: 5 * 1000,
  });
}

function handleTokenError(
  code: number | string | undefined,
  url: string | undefined
) {
  if (!shouldHandleTokenError(code) || url === '/admin_api/auth/me') {
    return;
  }

  Modal.error({
    title: 'Confirm logout',
    content:
      'You have been logged out, you can cancel to stay on this page, or log in again',
    okText: 'Re-Login',
    async onOk() {
      const userStore = useUserStore();

      await userStore.logout();
      window.location.reload();
    },
  });
}

if (import.meta.env.VITE_API_BASE_URL) {
  axios.defaults.baseURL = import.meta.env.VITE_API_BASE_URL;
}

axios.interceptors.request.use(
  (config: AxiosRequestConfig) => {
    // let each request carry token
    // this example using the JWT token
    // Authorization is a custom headers key
    // please modify it according to the actual situation
    const token = getToken();
    if (token) {
      if (!config.headers) {
        config.headers = {};
      }
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    // do something
    return Promise.reject(error);
  }
);
// add response interceptors
axios.interceptors.response.use(
  (response: AxiosResponse<HttpResponse>) => {
    const res = response.data;
    const config = response.config as TzlAxiosRequestConfig;
    const isSuccess =
      res.success === true || res.code === 20000 || res.code === 'OK';

    if (!isSuccess) {
      const message = res.message || res.msg || 'Error';

      showErrorMessage(config, message);
      handleTokenError(res.code, response.config.url);

      return Promise.reject(new Error(message));
    }
    return res;
  },
  (error) => {
    const config = error.config as TzlAxiosRequestConfig | undefined;
    const response = error.response?.data as Partial<HttpResponse> | undefined;
    const message = response
      ? getErrorMessage(response)
      : error.message || 'Request Error';

    showErrorMessage(config, message);
    handleTokenError(response?.code, error.config?.url);

    return Promise.reject(new Error(message));
  }
);
