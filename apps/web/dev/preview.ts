import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createServer } from 'vite-plus';
import { z } from 'zod';
import { cliErrors } from '../../pipeline/dev/cli.js';
import { createNewsHandler } from '../api/_news.js';
import { writeAtomic } from '../../pipeline/dev/local-r2.js';
import { fixtureState, fixturesRoot, localBrokerApi } from './local-api.js';
import { previewClient } from './preview-client.js';

/** This checkout's app, which the preview serves unless asked for another, such as a base checkout. */
const ownWeb = fileURLToPath(new URL('..', import.meta.url));
const publicBucket = 'https://pub-7982bfb066694e6e8615750132283eba.r2.dev';
const liveApi = 'https://idx.monosodiums.com';
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

/** Copies the public data once per fixture date, so prices and broker data describe the same session. */
async function snapshotPublic(asOf: string, record: boolean) {
  const marker = join(snapshot, 'snapshot.json');
  if (existsSync(marker) && JSON.parse(await readFile(marker, 'utf8')).asOf === asOf) return;
  if (!record)
    throw new Error(
      `No public data copied for ${asOf} yet. Run once with --record, which copies it from the public bucket.`,
    );
  const started = performance.now();
  // Responses recorded for the previous date would no longer match the data.
  await rm(join(snapshot, 'api'), { recursive: true, force: true });
  const fetchFile = async (path: string) => {
    const response = await fetch(`${publicBucket}/${path}`);
    if (response.status === 404) return;
    if (!response.ok) throw new Error(`Public ${path} HTTP ${response.status}`);
    await writeAtomic(join(snapshot, path), Buffer.from(await response.arrayBuffer()));
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
  await writeAtomic(marker, Buffer.from(JSON.stringify({ asOf, prices: health.prices })));
  console.log(`public data copied in ${((performance.now() - started) / 1000).toFixed(1)}s`);
}

function cookies(req: IncomingMessage) {
  return new Map(
    (req.headers.cookie ?? '')
      .split('; ')
      .filter(Boolean)
      .map((pair) => pair.split('=') as [string, string]),
  );
}

/** Whether the preview clock is set to a time inside the session rather than after the close. */
function duringSession(req: IncomingMessage) {
  const clock = cookies(req).get('preview-clock');
  return clock !== undefined && clock !== 'close';
}

/** A 404 the preview sends on purpose, marked so ui:check can tell it from a missing file. */
const heldHeader = 'X-Preview-Held';
function heldUntilClose(res: ServerResponse) {
  res.statusCode = 404;
  res.setHeader(heldHeader, 'until the close');
  res.end();
}

/**
 * `web` is the app checkout to serve; the preview's own code always comes from this checkout. It never reaches
 * production unless `record` is set: an API response not recorded yet answers 503, marked so ui:check can list it.
 */
export async function startPreview({
  port = 5173,
  quiet = false,
  web = ownWeb,
  record = false,
}: { port?: number; quiet?: boolean; web?: string; record?: boolean } = {}) {
  const state = await fixtureState();
  await snapshotPublic(state.asOf, record);
  const api = await localBrokerApi(web);
  /** API responses fetched from production during this preview, to record them. */
  const fetched: string[] = [];

  async function brokers(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url!, 'http://localhost');
    const headers = new Headers();
    if (cookies(req).get('preview-signed-out') !== '1')
      headers.set('Authorization', `Bearer ${api.token}`);
    const response = await api.handle(new Request(url, { headers }));
    let body: Buffer = Buffer.from(await response.arrayBuffer());
    if (duringSession(req) && response.ok) {
      const view = url.searchParams.get('view');
      // The collector publishes a session's running trade and closing order book once the session is over.
      if (view === 'ticks' && url.searchParams.get('date') === state.asOf)
        return heldUntilClose(res);
      if (view === null) {
        // Broker data for a session is published in the evening, so during it the history ends the day before.
        const history = JSON.parse(body.toString()) as { days: { date: string }[] };
        history.days = history.days.filter((day) => day.date !== state.asOf);
        body = Buffer.from(JSON.stringify(history));
      }
    }
    res.statusCode = response.status;
    response.headers.forEach((value, key) => {
      if (key !== 'content-length') res.setHeader(key, value);
    });
    res.end(body);
  }

  /** The production news handler over the ticker news files in the public snapshot. */
  const tickerNews = createNewsHandler({
    now: () => Date.parse(`${state.asOf}T12:00:00+07:00`),
    store: (key) =>
      readFile(join(snapshot, key)).then(
        (bytes) => new Response(bytes),
        () => new Response(null, { status: 404 }),
      ),
  });
  async function news(req: IncomingMessage, res: ServerResponse) {
    const response = await tickerNews(new Request(new URL(req.url!, 'http://localhost')));
    res.statusCode = response.status;
    response.headers.forEach((value, key) => res.setHeader(key, value));
    res.end(Buffer.from(await response.arrayBuffer()));
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
    let body = await readFile(file);
    // Daily prices and the broker data for a session are published after the close, so during it they end the
    // session before. Market-wide files keep the as-of close; the snapshot has no earlier copy of them.
    if (duringSession(req)) {
      const previous = state.sessions[state.sessions.indexOf(state.asOf) - 1];
      if (path.startsWith('ticker/')) {
        const ticker = JSON.parse(body.toString()) as { prices?: { date: string }[] };
        ticker.prices = ticker.prices?.filter((price) => price.date !== state.asOf);
        body = Buffer.from(JSON.stringify(ticker));
      } else if (path === 'health.json' && previous) {
        const health = JSON.parse(body.toString()) as Record<string, unknown>;
        for (const key of ['prices', 'indices', 'brokers'])
          if (health[key] === state.asOf) health[key] = previous;
        body = Buffer.from(JSON.stringify(health));
      }
    }
    res.end(body);
  }

  /**
   * Other API routes come from production once, then replay, so the page stays the same between runs. Errors pass
   * through unrecorded, so a failed request is tried again next time.
   */
  async function recorded(req: IncomingMessage, res: ServerResponse) {
    const key = createHash('sha256').update(req.url!).digest('hex').slice(0, 16);
    const file = join(snapshot, 'api', `${key}.json`);
    let entry: { status: number; type: string; body: string };
    if (existsSync(file)) entry = JSON.parse(await readFile(file, 'utf8')) as typeof entry;
    else if (!record) {
      if (!quiet) console.warn(`not recorded yet, --record fetches it: ${req.url}`);
      res.statusCode = 503;
      res.setHeader('X-Preview-Offline', 'not recorded');
      return res.end();
    } else {
      const response = await fetch(`${liveApi}${req.url}`);
      entry = {
        status: response.status,
        type: response.headers.get('Content-Type') ?? 'application/json',
        body: await response.text(),
      };
      fetched.push(req.url!);
      if (response.ok) {
        await writeAtomic(file, JSON.stringify(entry));
        console.log(`recorded ${req.url} from production`);
      }
    }
    res.statusCode = entry.status;
    res.setHeader('Content-Type', entry.type);
    res.end(entry.body);
  }

  const server = await createServer({
    root: web,
    configFile: join(web, 'vite.config.ts'),
    logLevel: quiet ? 'silent' : 'info',
    // Checkouts share node_modules through symlinks, so each keeps its own prebundle cache. A temporary base
    // checkout keeps it inside itself, so it goes when the checkout is removed instead of piling up.
    cacheDir:
      web === ownWeb
        ? join(fixturesRoot, 'vite', createHash('sha256').update(web).digest('hex').slice(0, 12))
        : join(web, '.vite-preview'),
    server: { port, strictPort: port !== 0, proxy: {} },
    define: { 'import.meta.env.VITE_WORKOS_CLIENT_ID': JSON.stringify('client_local') },
    resolve: {
      alias: {
        '@workos-inc/authkit-react': fileURLToPath(new URL('preview-auth.tsx', import.meta.url)),
      },
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
              : path.startsWith('/api/news')
                ? news
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
    fetched,
    close: () => server.close(),
  };
}

export const recordHelp = `--record      fetch from production what isn't recorded yet, and record it; without it nothing
              leaves this machine, and a response not recorded yet answers 503`;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  cliErrors();
  const { values: args } = parseArgs({
    options: {
      port: { type: 'string', default: '5173' },
      record: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
  });
  if (args.help) {
    console.log(`pnpm preview:local [--port N] [--record]

Runs the app on the fixtures, signed in, with broker data and running trade read only from them, and the public
data and other API responses replayed from recordings. --record copies the public data for a new fixture date and
records responses the first time they're asked for. The panel at the bottom left sets the clock and signs in or out.

--port N      5173 by default
${recordHelp}`);
    process.exit(0);
  }
  const preview = await startPreview({ port: Number(args.port), record: args.record });
  console.log(`${preview.url}  data as of ${preview.asOf}${args.record ? ', recording' : ''}`);
}
