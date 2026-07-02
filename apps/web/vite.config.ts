import react from '@vitejs/plugin-react';
import { defineConfig, lazyPlugins } from 'vite-plus';
import type { PluginOption } from 'vite-plus';

export default defineConfig({
  plugins: lazyPlugins(() => react() as unknown as PluginOption[]),
  server: {
    proxy: {
      '/trpc': {
        target: 'http://127.0.0.1:20240',
      },
    },
  },
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
