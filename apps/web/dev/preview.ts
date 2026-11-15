import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';
import { createServer } from 'vite-plus';
import { z } from 'zod';
import { fixtureState, fixturesRoot, localBrokerApi } from './local-api.js';
import { previewClient } from './preview-client.js';

const publicBucket = 'https://pub-7982bfb066694e6e8615750132283eba.r2.dev';
const liveApi = 'https://vibe-idx.vercel.app';
const snapshot = join(fixturesRoot, 'public');
const snapshotFiles = [
  'tickers.json',
  'market.json',
  'health.json',
  'feed.json',
  'market-summary.json',
  'news.json',
  'calendar.json',
  'risk.json',
  'corporate-actions.json',
];

async function save(file: string, bytes: Buffer) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file + '.tmp', bytes);
  await rename(file + '.tmp', file);
}

/** Copies the public data once per fixture date, so prices and broker data describe the same session. */
async function snapshotPublic(asOf: string) {
  const marker = join(snapshot, 'snapshot.json');
  if (existsSync(marker) && JSON.parse(await readFile(marker, 'utf8')).asOf === asOf) return;
  const started = performance.now();
  const fetchFile = async (path: string) => {
    const response = await fetch(`${publicBucket}/${path}`);
    if (response.status === 404) return;
    if (!response.ok) throw new Error(`Public ${path} HTTP ${response.status}`);
    await save(join(snapshot, path), Buffer.from(await response.arrayBuffer()));
  };
  await Promise.all(snapshotFiles.map(fetchFile));
  const tickers = z
    .array(z.object({ ticker: z.string().regex(/^[A-Z0-9-]{1,12}$/) }))
    .parse(JSON.parse(await readFile(join(snapshot, 'tickers.json'), 'utf8')))
    .map((row) => `ticker/${row.ticker}.json`);
  await Promise.all(
    Array.from({ length: 16 }, async () => {
      for (let path = tickers.pop(); path; path = tickers.pop()) await fetchFile(path);
    }),
  );
  const health = z
    .object({ prices: z.string() })
    .parse(JSON.parse(await readFile(join(snapshot, 'health.json'), 'utf8')));
  if (health.prices !== asOf)
    console.warn(
      `Public prices are through ${health.prices} but broker data through ${asOf}. Run \`pnpm fixtures --latest\` once both are published.`,
    );
  await save(marker, Buffer.from(JSON.stringify({ asOf, prices: health.prices })));
  console.log(`public data copied in ${((performance.now() - started) / 1000).toFixed(1)}s`);
}

/** Keeps a session's columns up to the clock, as running trade looks while the market is open. */
function cutAtClock(body: Buffer, seconds: number) {
  const data = JSON.parse(body.toString()) as Record<string, unknown>;
  const clock = Array.isArray(data.time)
    ? data.time
    : Array.isArray(data.minute)
      ? data.minute
      : null;
  if (!clock) return body;
  const keep = clock.map((t) => typeof t === 'number' && t <= seconds);
  for (const [key, column] of Object.entries(data))
    if (Array.isArray(column) && column.length === keep.length)
      data[key] = column.filter((_, i) => keep[i]);
  return Buffer.from(JSON.stringify(data));
}

function cookies(req: IncomingMessage) {
  return new Map(
    (req.headers.cookie ?? '')
      .split('; ')
      .filter(Boolean)
      .map((pair) => pair.split('=') as [string, string]),
  );
}

export async function startPreview({
  port = 5173,
  quiet = false,
}: { port?: number; quiet?: boolean } = {}) {
  const state = await fixtureState();
  await snapshotPublic(state.asOf);
  const api = await localBrokerApi();
  const web = fileURLToPath(new URL('..', import.meta.url));

  async function brokers(req: IncomingMessage, res: ServerResponse) {
    const jar = cookies(req);
    const url = new URL(req.url!, 'http://localhost');
    const headers = new Headers();
    if (jar.get('preview-signed-out') !== '1') headers.set('Authorization', `Bearer ${api.token}`);
    const response = await api.handle(new Request(url, { headers }));
    let body: Buffer = Buffer.from(await response.arrayBuffer());
    const clock = jar.get('preview-clock');
    if (clock && clock !== 'close' && url.searchParams.get('date') === state.asOf) {
      // The closing order book only exists after the close.
      if (url.searchParams.get('kind') === 'book') {
        res.statusCode = 404;
        return res.end();
      }
      if (response.ok) {
        const gzip = response.headers.get('Content-Encoding') === 'gzip';
        const cut = cutAtClock(
          gzip ? gunzipSync(body) : body,
          Number(clock.slice(0, 2)) * 3600 + Number(clock.slice(3, 5)) * 60,
        );
        body = gzip ? gzipSync(cut) : cut;
      }
    }
    res.statusCode = response.status;
    response.headers.forEach((value, key) => res.setHeader(key, value));
    res.end(body);
  }

  async function publicData(req: IncomingMessage, res: ServerResponse) {
    const path = new URL(req.url!, 'http://localhost').pathname.slice('/data/'.length);
    const file = join(snapshot, path);
    if (!file.startsWith(snapshot + '/') || !existsSync(file)) {
      console.warn(`not in the public snapshot: /data/${path}`);
      res.statusCode = 404;
      return res.end();
    }
    res.setHeader('Content-Type', 'application/json');
    res.end(await readFile(file));
  }

  /** Other API routes come from production once, then replay, so the page stays the same between runs. */
  async function recorded(req: IncomingMessage, res: ServerResponse) {
    const key = createHash('sha256').update(req.url!).digest('hex').slice(0, 16);
    const file = join(snapshot, 'api', `${key}.json`);
    if (!existsSync(file)) {
      const response = await fetch(`${liveApi}${req.url}`);
      const entry = {
        status: response.status,
        type: response.headers.get('Content-Type') ?? 'application/json',
        body: await response.text(),
      };
      await save(file, Buffer.from(JSON.stringify(entry)));
      console.log(`recorded ${req.url} from production`);
    }
    const entry = JSON.parse(await readFile(file, 'utf8')) as {
      status: number;
      type: string;
      body: string;
    };
    res.statusCode = entry.status;
    res.setHeader('Content-Type', entry.type);
    res.end(entry.body);
  }

  const server = await createServer({
    root: web,
    configFile: join(web, 'vite.config.ts'),
    logLevel: quiet ? 'silent' : 'info',
    server: { port, strictPort: port !== 0, proxy: {} },
    define: { 'import.meta.env.VITE_WORKOS_CLIENT_ID': JSON.stringify('client_local') },
    resolve: {
      alias: { '@workos-inc/authkit-react': join(web, 'dev/preview-auth.tsx') },
    },
    plugins: [
      {
        name: 'local-preview',
        // tsx keeps function names with an `__name` helper, which the serialised client needs too.
        transformIndexHtml: (html) =>
          html.replace(
            '<head>',
            `<head><script>var __name = (f) => f; (${previewClient.toString()})(${JSON.stringify(state.asOf)})</script>`,
          ),
        configureServer(vite) {
          vite.middlewares.use((req, res, next) => {
            const path = req.url ?? '';
            const route = path.startsWith('/api/brokers')
              ? brokers
              : path.startsWith('/data/')
                ? publicData
                : path.startsWith('/api/')
                  ? recorded
                  : null;
            if (!route) return next();
            route(req, res).catch((error: unknown) => {
              console.error(path, error);
              res.statusCode = 500;
              res.end();
            });
          });
        },
      },
    ],
  });
  await server.listen();
  const address = server.httpServer?.address();
  if (!address || typeof address === 'string') throw new Error('Preview server has no port');
  return {
    url: `http://localhost:${address.port}`,
    asOf: state.asOf,
    close: () => server.close(),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.argv[process.argv.indexOf('--port') + 1]) || 5173;
  const preview = await startPreview({ port });
  console.log(`${preview.url}  data as of ${preview.asOf}`);
}
