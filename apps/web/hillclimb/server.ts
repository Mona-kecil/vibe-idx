import { fileURLToPath } from 'node:url';
import { createServer } from 'vite-plus';

export async function devServer() {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const server = await createServer({
    root,
    configFile: `${root}/vite.config.ts`,
    logLevel: 'silent',
    server: { port: 0, strictPort: false, proxy: {}, hmr: false },
    define: { 'import.meta.env.VITE_WORKOS_CLIENT_ID': JSON.stringify('client_hillclimb') },
    resolve: {
      alias: {
        '@workos-inc/authkit-react': fileURLToPath(new URL('./authkit.tsx', import.meta.url)),
      },
    },
  });
  await server.listen();
  const address = server.httpServer?.address();
  if (!address || typeof address === 'string') throw new Error('Dev server has no port');
  return { url: `http://localhost:${address.port}`, close: () => server.close() };
}
