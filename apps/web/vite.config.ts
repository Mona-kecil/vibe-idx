import react from '@vitejs/plugin-react';
import { defineConfig, lazyPlugins } from 'vite-plus';
import type { PluginOption } from 'vite-plus';

export default defineConfig({
  plugins: lazyPlugins(() => react() as unknown as PluginOption[]),
  server: {
    proxy: {
      '/data': {
        target: 'https://pub-7982bfb066694e6e8615750132283eba.r2.dev',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/data/, ''),
      },
    },
  },
  test: {
    include: ['src/**/*.test.{ts,tsx}', 'convex/**/*.test.ts'],
  },
});
