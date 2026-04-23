import type { UserConfigExport } from "@tarojs/cli";
export default {
   logger: {
    quiet: false,
    stats: true
  },
  mini: {},
  h5: {
    devServer: {
      port: 10086,
      proxy: {
        '/api': {
          target: 'http://localhost:7001/',
          changeOrigin: true,
        },
      },
    },
  }
} satisfies UserConfigExport<'webpack5'>
