import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { cpus, loadavg, tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import type { Browser } from 'playwright-core';
import { build } from 'vite-plus';
import { checkout, outsideRepo } from '../../pipeline/dev/checkout.js';
import { cliErrors } from '../../pipeline/dev/cli.js';
import { launch, viewport } from './browser.js';
import { startPreview } from './preview.js';
import { previewClient } from './preview-client.js';
import { summarize, verdict, type Click, type Run } from './terminal-perf-verdict.js';

cliErrors();
const { values: args } = parseArgs({
  options: {
    base: { type: 'string' },
    runs: { type: 'string', default: '5' },
    out: { type: 'string' },
    profile: { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  },
});
if (args.help) {
  console.log(`pnpm perf:terminal [--base REF] [--runs N] [--out DIR] [--profile]

Builds production React with preview auth, using only local fixtures and recorded responses.
Each fresh browser context opens BBCA FLOW, RT, BRK, BFL, TB, FF, BBRI, FOCUS,
BBCA, GRID, then FLOW. Reports long-animation frames (>50ms), blocking duration,
errors, requests and mounted rows. Score is the sum of the ten post-boot medians.
Sides alternate AB BA; each has a fresh context per run. No CPU throttling.
--profile collects separate CPU profiles instead of decision-grade timings.
Artifacts stay outside the repository. No response bodies or screenshots are saved.`);
  process.exit(0);
}
const count = Number(args.runs);
if (!Number.isInteger(count) || count < 1) throw new Error('--runs must be a positive integer');
const out = args.out ? outsideRepo(args.out) : await mkdtemp(join(tmpdir(), 'terminal-perf-'));
await mkdir(out, { recursive: true });
const web = fileURLToPath(new URL('..', import.meta.url));
const base = args.base ? await checkout(args.base) : undefined;
const fixture = await startPreview({ port: 0, quiet: true });

async function production(root: string, side: string) {
  const dir = join(out, `${side}-build`);
  // startPreview creates a dev server first; Vite otherwise inherits its development NODE_ENV.
  process.env.NODE_ENV = 'production';
  await build({
    root,
    configFile: join(root, 'vite.config.ts'),
    mode: 'production',
    logLevel: 'error',
    define: { 'import.meta.env.VITE_WORKOS_CLIENT_ID': JSON.stringify('client_local') },
    resolve: { alias: { '@workos-inc/authkit-react': join(web, 'dev/preview-auth.tsx') } },
    build: { outDir: dir, emptyOutDir: true },
  });
  const server = createServer((req, res) => {
    void (async () => {
      const path = new URL(req.url ?? '/', 'http://localhost').pathname;
      if (path.startsWith('/api/') || path.startsWith('/data/')) {
        const response = await fetch(fixture.url + req.url, {
          headers: { cookie: req.headers.cookie ?? '' },
        });
        res.statusCode = response.status;
        response.headers.forEach((value, key) => {
          if (!['content-encoding', 'content-length', 'transfer-encoding'].includes(key))
            res.setHeader(key, value);
        });
        res.end(Buffer.from(await response.arrayBuffer()));
      } else if (path.startsWith('/assets/') && !path.includes('..')) {
        res.setHeader('Content-Type', extname(path) === '.css' ? 'text/css' : 'text/javascript');
        res.end(await readFile(join(dir, path)));
      } else {
        res.setHeader('Content-Type', 'text/html');
        res.end(
          (await readFile(join(dir, 'index.html'), 'utf8')).replace(
            '<head>',
            `<head><script>var __name = (f) => f; (${previewClient.toString()})(${JSON.stringify(fixture.asOf)})</script>`,
          ),
        );
      }
    })().catch((error: unknown) => {
      console.error(error);
      res.statusCode = 500;
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No production server port');
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  };
}

async function measure(browser: Browser, url: string, label: string): Promise<Run> {
  const context = await browser.newContext({ viewport: viewport() });
  await context.addCookies(
    ['preview-clock=close', 'preview-signed-out=0', 'preview-frozen=0'].map((pair) => {
      const [name, value] = pair.split('=');
      return { name: name!, value: value!, url };
    }),
  );
  await context.addInitScript(() => {
    // A DOM event marks each region without depending on injected globals or React internals.
    let frames: { start: number; duration: number; blocking: number }[] = [];
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const json = entry.toJSON();
        frames.push({
          start: entry.startTime,
          duration: entry.duration,
          blocking: Number(json.blockingDuration),
        });
      }
    }).observe({ type: 'long-animation-frame', buffered: true });
    document.addEventListener('perf-reset', () => {
      frames = [];
    });
    document.addEventListener('perf-read', () => {
      document.documentElement.dataset.perf = JSON.stringify(frames);
    });
  });
  const page = await context.newPage();
  const errors: string[] = [];
  let requests = 0;
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().startsWith('Failed to load resource'))
      errors.push(message.text());
  });
  page.on('request', () => requests++);
  page.on('requestfailed', (request) => {
    if (request.failure()?.errorText !== 'net::ERR_ABORTED')
      errors.push(`failed ${new URL(request.url()).pathname}`);
  });
  page.on('response', (response) => {
    if (response.status() >= 400)
      errors.push(`HTTP ${response.status()} ${new URL(response.url()).pathname}`);
  });
  const cdp = args.profile ? await context.newCDPSession(page) : undefined;
  await cdp?.send('Profiler.enable');
  const command = async (value: string) => {
    const field = page
      .getByRole('combobox', { name: 'Command', exact: true })
      .or(page.getByRole('textbox', { name: 'Command', exact: true }))
      .first();
    await field.fill(value);
    await field.press('Enter');
  };
  const tab = (name: string) => page.getByRole('tab', { name, exact: true }).first().click();
  const steps: [string, () => Promise<unknown>, string, string][] = [
    ['boot-flow', () => page.goto(`${url}/terminal?t=BBCA&l=flow`), 'BBCA', 'flow'],
    ...['RT', 'BRK', 'BFL', 'TB', 'FF'].map(
      (name): [string, () => Promise<unknown>, string, string] => [
        `tab-${name}`,
        () => tab(name),
        'BBCA',
        'flow',
      ],
    ),
    ['ticker-switch-flow', () => command('BBRI'), 'BBRI', 'flow'],
    ['mode-focus', () => command('FOCUS'), 'BBRI', 'focus'],
    ['ticker-switch-focus', () => command('BBCA'), 'BBCA', 'focus'],
    ['mode-grid', () => command('GRID'), 'BBCA', 'grid'],
    ['mode-flow-again', () => command('FLOW'), 'BBCA', 'flow'],
  ];
  const results: Click[] = [];
  try {
    for (const [step, act, ticker, mode] of steps) {
      const errorStart = errors.length,
        requestStart = requests;
      await page.evaluate(() => document.dispatchEvent(new Event('perf-reset')));
      await cdp?.send('Profiler.start');
      await act();
      await page.waitForLoadState('networkidle', { timeout: 15000 });
      await page.waitForTimeout(800);
      if (cdp) {
        const { profile } = await cdp.send('Profiler.stop');
        await writeFile(join(out, `${label}-${step}.cpuprofile`), JSON.stringify(profile));
      }
      const stats = await page.evaluate(() => {
        document.dispatchEvent(new Event('perf-read'));
        const frames: { duration: number; blocking: number }[] = JSON.parse(
          document.documentElement.dataset.perf ?? '[]',
        );
        return {
          longest: Math.max(0, ...frames.map((frame) => frame.duration)),
          blocking: frames.reduce((sum, frame) => sum + frame.blocking, 0),
          rows: document.querySelectorAll('tbody tr').length,
        };
      });
      const query = new URL(page.url()).searchParams;
      if (query.get('t') !== ticker || query.get('l') !== mode)
        errors.push(`Wrong state after ${step}`);
      if (
        step.startsWith('tab-') &&
        (await page
          .getByRole('tab', { name: step.slice(4), exact: true })
          .first()
          .getAttribute('aria-selected')) !== 'true'
      )
        errors.push(`Inactive ${step}`);
      if (
        await page
          .getByRole('status')
          .filter({ hasText: /^Loading/ })
          .count()
      )
        errors.push(`Still loading after ${step}`);
      results.push({
        step,
        ...stats,
        errors: errors.length - errorStart,
        requests: requests - requestStart,
      });
    }
    if (errors.length) console.error(label, errors);
    return results;
  } finally {
    await context.close();
  }
}

const servers: Awaited<ReturnType<typeof production>>[] = [];
const browser = await launch();
try {
  const head = await production(web, 'after');
  servers.push(head);
  const before = base ? await production(join(base.dir, 'apps/web'), 'before') : undefined;
  if (before) servers.push(before);
  console.log(
    `production React; Chrome ${browser.version()}; fixtures ${fixture.asOf}; ${count} runs per side; ${cpus().length} cores; load ${loadavg()
      .map((n) => n.toFixed(2))
      .join(', ')}${args.profile ? '; PROFILED: diagnostic only' : ''}`,
  );
  const runs: Record<string, Run[]> = { after: [], ...(before ? { before: [] } : {}) };
  for (let i = 0; i < count; i++) {
    const sides: [string, string][] = [
      ...(before ? [['before', before.url] satisfies [string, string]] : []),
      ['after', head.url],
    ];
    if (i % 2) sides.reverse();
    for (const [side, url] of sides) {
      const run = await measure(browser, url, `${side}-${i + 1}`);
      runs[side]!.push(run);
      await writeFile(join(out, `${side}-${i + 1}.json`), JSON.stringify(run, null, 2));
      console.log(
        `${side} ${i + 1}: score ${run
          .slice(1)
          .reduce((sum, click) => sum + click.longest, 0)
          .toFixed(1)} ms; errors ${run.reduce((sum, click) => sum + click.errors, 0)}`,
      );
    }
  }
  const summaries = Object.fromEntries(
    Object.entries(runs).map(([side, samples]) => [side, summarize(samples)]),
  );
  const range = (s: { median: number; low: number; high: number }) =>
    `${s.median.toFixed(1)} [${s.low.toFixed(1)}–${s.high.toFixed(1)}]`;
  for (const [side, summary] of Object.entries(summaries)) {
    console.log(
      `\n${side}: click | longest ms median [range] | blocking ms median [range] | errors | requests median [range] | rows median [range]`,
    );
    for (const step of summary.steps)
      console.log(
        `${step.step} | ${range(step.longest)} | ${range(step.blocking)} | ${step.errors} | ${range(step.requests)} | ${range(step.rows)}`,
      );
    console.log(
      `SCORE ${summary.score.toFixed(1)} ms; run sums ${range(summary.scores)}; errors ${summary.errors}; work ${summary.worked ? 'yes' : 'NO'}`,
    );
  }
  const result = summaries.before ? verdict(summaries.before, summaries.after!) : 'baseline';
  console.log(`\n${args.profile ? 'diagnostic only' : result}; artifacts ${out}`);
  await writeFile(
    join(out, 'summary.json'),
    JSON.stringify(
      { fixture: fixture.asOf, profiled: args.profile, runs, summaries, verdict: result },
      null,
      2,
    ),
  );
  if (Object.values(summaries).some((s) => s.errors || !s.worked)) process.exitCode = 1;
} finally {
  await browser.close();
  for (const server of servers) await server.close();
  await fixture.close();
  base?.remove();
  for (const side of ['before', 'after'])
    await rm(join(out, `${side}-build`), { recursive: true, force: true });
}
