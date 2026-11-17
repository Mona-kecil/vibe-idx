import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cliErrors } from '../../pipeline/dev/cli.js';

cliErrors();

// Renders Ticker cards in workerd, which Node tests cannot: workerd refuses to compile the
// HarfBuzz bytes satori bundles, so the card path only works through the shim in _workerd-satori.
// Needs `pnpm --filter @vibe-idx/web build` first, for the fonts in dist.
const web = new URL('..', import.meta.url).pathname;
const fixture = 'src/ticker/fixtures/TPIA-history.json';
const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];

if (!existsSync(join(web, 'dist/index.html')))
  throw new Error('dist is missing. Run pnpm --filter @vibe-idx/web build first.');

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const server = createServer().once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolve(port));
    });
  });

const state = await mkdtemp(join(tmpdir(), 'workerd-check-'));
const wranglerEnv = { ...process.env, CI: 'true', WRANGLER_SEND_METRICS: 'false' };
const seeded = spawnSync(
  'pnpm',
  [
    ...['exec', 'wrangler', 'r2', 'object', 'put', 'vibe-idx-public/ticker/TPIA.json'],
    ...['--file', fixture, '--content-type', 'application/json', '--local'],
    ...['--persist-to', state],
  ],
  { cwd: web, env: wranglerEnv, encoding: 'utf8' },
);
if (seeded.status !== 0) throw new Error(`Seeding the local bucket failed:\n${seeded.stderr}`);

const port = await freePort();
const server = spawn(
  'pnpm',
  [
    ...['exec', 'wrangler', 'dev', '--local', '--ip', '127.0.0.1', '--port', String(port)],
    ...['--inspector-port', '0', '--persist-to', state],
  ],
  { cwd: web, env: wranglerEnv, detached: true },
);
let output = '';
const ready = new Promise<void>((resolve, reject) => {
  const take = (chunk: Buffer) => {
    output += chunk.toString();
    if (output.includes(`Ready on http://127.0.0.1:${port}`)) resolve();
  };
  server.stdout.on('data', take);
  server.stderr.on('data', take);
  server.once('exit', (code) => reject(new Error(`wrangler dev exited with ${code}`)));
});

function stop() {
  if (server.pid) {
    try {
      process.kill(-server.pid, 'SIGKILL');
    } catch {
      // Already gone.
    }
  }
}

async function get(path: string) {
  const started = performance.now();
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    signal: AbortSignal.timeout(30000),
  });
  const bytes = new Uint8Array(await response.arrayBuffer());
  const ms = Math.round(performance.now() - started);
  const cache = response.headers.get('x-cache');
  console.log(`${response.status} ${cache ?? '-'} ${ms}ms ${path}`);
  return { response, bytes, cache };
}

function expectCard(card: Awaited<ReturnType<typeof get>>, path: string) {
  const { response, bytes } = card;
  const size = new DataView(bytes.buffer);
  const problems = [
    response.status !== 200 && `status ${response.status}`,
    response.headers.get('content-type') !== 'image/png' &&
      `content type ${response.headers.get('content-type')}`,
    pngSignature.some((byte, i) => bytes[i] !== byte) && 'not a PNG',
    bytes.length >= 24 &&
      (size.getUint32(16) !== 1200 || size.getUint32(20) !== 630) &&
      `size ${size.getUint32(16)}x${size.getUint32(20)}`,
  ].filter(Boolean);
  if (problems.length > 0) throw new Error(`${path}: ${problems.join(', ')}`);
}

try {
  const timeout = setTimeout(() => stop(), 90000);
  await ready.finally(() => clearTimeout(timeout));
  const history = JSON.parse(await readFile(join(web, fixture), 'utf8')) as {
    prices: { date: string }[];
  };
  const date = history.prices.at(-1)?.date ?? '';
  const ticker = `/api/og?ticker=TPIA&d=${date}`;
  const first = await get(ticker);
  expectCard(first, ticker);
  const again = await get(ticker);
  expectCard(again, ticker);
  const brand = await get('/api/og');
  expectCard(brand, '/api/og');
  if (first.cache !== 'MISS' || again.cache !== 'HIT')
    throw new Error(`Expected MISS then HIT, got ${first.cache} then ${again.cache}`);
  if (Buffer.compare(first.bytes, again.bytes) !== 0)
    throw new Error('The cached card differs from the rendered one');
  if (/ERROR|Not reported to Sentry/.test(output))
    throw new Error('wrangler dev logged an error while rendering');
} catch (error) {
  console.error(output.split('\n').slice(-40).join('\n'));
  throw error;
} finally {
  stop();
  await rm(state, { recursive: true, force: true });
}
