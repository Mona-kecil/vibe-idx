import react from '@vitejs/plugin-react';
import { defineConfig, lazyPlugins } from 'vite-plus';
import type { PluginOption } from 'vite-plus';

const apiProxyTarget = process.env.VIBE_IDX_API_PROXY_TARGET ?? 'http://127.0.0.1:20240';

export default defineConfig({
  plugins: lazyPlugins(() => react() as unknown as PluginOption[]),
  server: {
    proxy: {
      '/trpc': {
        target: apiProxyTarget,
      },
    },
  },
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
