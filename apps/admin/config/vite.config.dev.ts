import { mergeConfig } from 'vite';
import eslint from 'vite-plugin-eslint';
import baseConfig from './vite.config.base';

export default mergeConfig(
  {
    mode: 'development',
    server: {
      host: '0.0.0.0',
      open: true,
      fs: {
        strict: true,
      },
      proxy: {
        '/admin_api': {
          // target: 'http://admin.tianzhiling.chat',
          // target: 'http://192.168.0.111:7101',
          // target: 'http://192.168.19.31:7101',
          target: 'http://127.0.0.1:7101',
          changeOrigin: true,
        },
      },
    },
    plugins: [
      eslint({
        cache: false,
        include: ['src/**/*.ts', 'src/**/*.tsx', 'src/**/*.vue'],
        exclude: ['node_modules'],
      }),
    ],
  },
  baseConfig
);
