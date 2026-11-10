import react from '@vitejs/plugin-react';
import { defineConfig, lazyPlugins } from 'vite-plus';
import type { PluginOption } from 'vite-plus';
import { fixtures } from './dev/fixtures';

const fixtureDir = process.env.VIBE_FIXTURES;

export default defineConfig({
  plugins: [
    lazyPlugins(() => react() as unknown as PluginOption[]),
    fixtureDir ? fixtures(fixtureDir) : null,
  ],
  server: {
    proxy: {
      '/api': { target: 'https://vibe-idx.vercel.app', changeOrigin: true },
      '/data': {
        target: 'https://pub-7982bfb066694e6e8615750132283eba.r2.dev',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/data/, ''),
      },
    },
  },
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
