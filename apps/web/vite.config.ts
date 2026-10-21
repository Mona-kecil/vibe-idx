import react from '@vitejs/plugin-react';
import { defineConfig, lazyPlugins } from 'vite-plus';
import type { PluginOption } from 'vite-plus';

export default defineConfig({
  plugins: lazyPlugins(() => react() as unknown as PluginOption[]),
  test: {
    include: ['src/**/*.test.{ts,tsx}', 'convex/**/*.test.ts'],
  },
});
