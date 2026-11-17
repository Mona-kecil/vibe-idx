import { readFileSync } from 'node:fs';
import react from '@vitejs/plugin-react';
import { defineConfig, lazyPlugins } from 'vite-plus';
import type { PluginOption } from 'vite-plus';

type WranglerVars = { vars: { WORKOS_CLIENT_ID: string } };

/** The WorkOS client ID the Worker verifies against, so the client bundle signs in against the same one. */
function deployedClientId(mode: string) {
  const config = JSON.parse(
    readFileSync(new URL('./wrangler.jsonc', import.meta.url), 'utf8').replace(
      /,(\s*[}\]])/g,
      '$1',
    ),
  ) as WranglerVars & { env: Record<string, WranglerVars> };
  const target = mode === 'production' ? config : config.env[mode];
  if (!target) throw new Error(`wrangler.jsonc has no environment named ${mode}`);
  return target.vars.WORKOS_CLIENT_ID;
}

export default defineConfig(({ command, mode }) => ({
  plugins: lazyPlugins(() => react() as unknown as PluginOption[]),
  // Vercel keeps the client ID from its own environment variables until it is retired.
  define:
    command === 'build' && mode !== 'development' && !process.env.VERCEL
      ? { 'import.meta.env.VITE_WORKOS_CLIENT_ID': JSON.stringify(deployedClientId(mode)) }
      : undefined,
  server: {
    proxy: {
      '/api': { target: 'https://idx.monosodiums.com', changeOrigin: true },
      '/data': {
        target: 'https://pub-7982bfb066694e6e8615750132283eba.r2.dev',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/data/, ''),
      },
    },
  },
  test: {
    include: ['src/**/*.test.{ts,tsx}', 'dev/**/*.test.ts'],
    execArgv: ['--no-experimental-webstorage'],
  },
}));
