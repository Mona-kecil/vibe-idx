import { createHTTPServer } from '@trpc/server/adapters/standalone';

import { appRouter } from './router';

const port = Number(process.env.VIBE_IDX_API_PORT ?? 20240);
const host = process.env.VIBE_IDX_API_HOST ?? '127.0.0.1';

const server = createHTTPServer({
  basePath: '/trpc/',
  createContext() {
    return {
      databaseUrl: process.env.VIBE_IDX_DATABASE_URL,
    };
  },
  router: appRouter,
});

server.listen(port, host);

console.log(`Vibe IDX tRPC server listening on http://${host}:${port}/trpc`);
