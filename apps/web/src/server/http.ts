import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createHTTPHandler } from '@trpc/server/adapters/standalone';

import { createHttpRequestEvent, createLifecycleEvent, writeLogEvent } from './logging.js';
import { appRouter } from './router.js';

const port = Number(process.env.VIBE_IDX_API_PORT ?? 20240);
const host = process.env.VIBE_IDX_API_HOST ?? '127.0.0.1';
const serverDir = dirname(fileURLToPath(import.meta.url));
const staticDir = resolve(process.env.VIBE_IDX_STATIC_DIR ?? resolve(serverDir, '../../dist'));

const trpcHandler = createHTTPHandler({
  basePath: '/trpc/',
  createContext() {
    return {
      databaseUrl: process.env.VIBE_IDX_DATABASE_URL,
    };
  },
  router: appRouter,
});

const server = createServer((request, response) => {
  const startedAt = Date.now();
  const requestId = requestIdFromHeader(request.headers['x-request-id']);
  let capturedError: unknown;
  let logged = false;

  response.setHeader('x-request-id', requestId);
  response.on('finish', () => {
    logRequest();
  });
  response.on('close', () => {
    if (!logged && !response.writableEnded) {
      logRequest(499);
    }
  });

  function logRequest(statusCode = response.statusCode) {
    if (logged) {
      return;
    }
    logged = true;
    writeLogEvent(
      createHttpRequestEvent({
        durationMs: Date.now() - startedAt,
        error: capturedError,
        method: request.method ?? 'GET',
        path: request.url ?? '/',
        requestId,
        statusCode,
      }),
      statusCode >= 500 ? console.error : console.log,
    );
  }

  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? `${host}:${port}`}`);

  try {
    if (url.pathname.startsWith('/trpc')) {
      trpcHandler(request, response);
      return;
    }

    serveStatic(request, response, url.pathname);
  } catch (error) {
    capturedError = error;
    response.writeHead(500);
    response.end('Internal server error');
  }
});

server.listen(port, host);

writeLogEvent(createLifecycleEvent('server_started', { binding: `${host}:${port}` }));

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => {
      process.exit(0);
    });
  });
}

function requestIdFromHeader(value: IncomingMessage['headers'][string]) {
  if (Array.isArray(value)) {
    return value[0] ?? randomUUID();
  }
  return value ?? randomUUID();
}

const contentTypes: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function serveStatic(request: IncomingMessage, response: ServerResponse, pathname: string) {
  const filePath = resolveStaticPath(pathname);

  if (!filePath) {
    response.writeHead(404);
    response.end('Not found');
    return;
  }

  const contentType = contentTypes[extname(filePath)] ?? 'application/octet-stream';
  response.writeHead(200, {
    'Cache-Control': filePath.includes(`${sep}assets${sep}`)
      ? 'public, max-age=31536000, immutable'
      : 'no-cache',
    'Content-Type': contentType,
  });
  createReadStream(filePath).pipe(response);

  request.on('aborted', () => response.destroy());
}

function resolveStaticPath(pathname: string) {
  const decodedPathname = decodeURIComponent(pathname);
  const normalizedPath = normalize(decodedPathname).replace(/^(\.\.(\/|\\|$))+/, '');
  const requestedPath =
    normalizedPath === sep ? 'index.html' : normalizedPath.replace(/^[/\\]/, '');
  const candidate = resolve(staticDir, requestedPath);

  if (!isWithinStaticDir(candidate)) {
    return null;
  }

  if (existsSync(candidate) && statSync(candidate).isFile()) {
    return candidate;
  }

  if (extname(candidate)) {
    return null;
  }

  const indexPath = join(staticDir, 'index.html');
  return existsSync(indexPath) ? indexPath : null;
}

function isWithinStaticDir(candidate: string) {
  return candidate === staticDir || candidate.startsWith(`${staticDir}${sep}`);
}
