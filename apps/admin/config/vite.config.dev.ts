import { mergeConfig, type Plugin } from 'vite';
import eslint from 'vite-plugin-eslint';
import baseConfig from './vite.config.base';

const adminApiProxyTarget =
  process.env.ADMIN_API_PROXY_TARGET || 'http://127.0.0.1:7101';
const adminApiReadOnly = process.env.ADMIN_API_READ_ONLY === 'true';

const isAllowedReadOnlyRequest = (method = 'GET', url = '') =>
  ['GET', 'HEAD', 'OPTIONS'].includes(method) ||
  (method === 'POST' &&
    (url.startsWith('/admin_api/auth/login') ||
      url.split('?')[0] === '/admin_api/voice-materials/analyze-timbre'));

const adminApiReadOnlyGuard: Plugin = {
  name: 'admin-api-read-only-guard',
  configureServer(server) {
    server.middlewares.use((request, response, next) => {
      const url = request.url || '';
      if (
        adminApiReadOnly &&
        url.startsWith('/admin_api') &&
        !isAllowedReadOnlyRequest(request.method, url)
      ) {
        response.statusCode = 403;
        response.setHeader('Content-Type', 'application/json; charset=utf-8');
        response.end(
          JSON.stringify({
            code: 403,
            message: '本地生产数据环境已禁止写操作',
          })
        );
        return;
      }
      next();
    });
  },
};

export default mergeConfig(
  {
    mode: 'development',
    optimizeDeps: {
      include: ['@tzl/shared'],
    },
    server: {
      host: '0.0.0.0',
      open: process.env.ADMIN_AUTO_OPEN !== 'false',
      fs: {
        strict: true,
      },
      proxy: {
        '/admin_api': {
          target: adminApiProxyTarget,
          changeOrigin: true,
        },
      },
    },
    plugins: [
      adminApiReadOnlyGuard,
      eslint({
        cache: false,
        include: ['src/**/*.ts', 'src/**/*.tsx', 'src/**/*.vue'],
        exclude: ['node_modules'],
      }),
    ],
  },
  baseConfig
);
