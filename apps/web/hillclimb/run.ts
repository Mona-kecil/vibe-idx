import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { chromium, type Browser } from 'playwright-core';
import { frozenStore } from './network';
import { questions } from './questions';
import { devServer } from './server';
import { modes, Ui } from './ui';

const { values: args } = parseArgs({
  options: {
    record: { type: 'boolean', default: false },
    repeat: { type: 'string', default: '1' },
    shots: { type: 'string' },
    verbose: { type: 'boolean', default: false },
  },
});
const store = process.env.HILLCLIMB_DATA ?? join(homedir(), '.cache/vibe-idx/hillclimb');
const privateSite = process.env.VIBE_FIXTURES ?? join(homedir(), '.cache/vibe-idx/fixtures');

const tickers = ['SINI', 'BBCA', 'UNVR'];
const viewports = [
  { name: '16in', width: 1728, height: 1000 },
  { name: '24in', width: 1920, height: 960 },
  { name: '27in', width: 2560, height: 1320 },
];
const pins = ['SINI', 'BBCA', 'BREN', 'TLKM', 'BBRI', 'ADRO', 'GOTO', 'ANTM'];
const interactive = 'a[href], button, input, select, textarea, summary, [role="tab"]';

await mkdir(store, { recursive: true });
const metaPath = join(store, 'meta.json');
const meta: { now: string } = JSON.parse(
  await readFile(metaPath, 'utf8').catch(() => JSON.stringify({ now: new Date().toISOString() })),
);
await writeFile(metaPath, JSON.stringify(meta));

type Session = {
  ticker: string;
  viewport: string;
  steps: (number | null)[];
  errors: string[];
  log: string[][];
  controls: Record<string, number>;
};

async function session(
  browser: Browser,
  url: string,
  ticker: string,
  viewport: (typeof viewports)[number],
): Promise<Session> {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  // tsx keeps function names with a __name helper that functions sent to the page still call.
  await context.addInitScript({ content: 'globalThis.__name = (f) => f;' });
  await context.addInitScript((list) => {
    localStorage.setItem('vibe-idx:watchlist', JSON.stringify(list));
  }, pins);
  await network.attach(context);
  const page = await context.newPage();
  await page.clock.setFixedTime(new Date(meta.now));
  const errors: string[] = [];
  page.on('pageerror', (error) => {
    if (!error.message.startsWith('ResizeObserver loop'))
      errors.push(`page error: ${error.message}`);
  });
  const ui = new Ui(page);

  const controls: Record<string, number> = {};
  for (const mode of modes) {
    await page.goto(`${url}/terminal?t=${ticker}&l=${mode}`);
    await ui.settle();
    controls[mode] = await page.evaluate(countVisible, interactive);
    if (args.shots && ticker === tickers[0]) {
      await mkdir(args.shots, { recursive: true });
      await page.screenshot({ path: join(args.shots, `${viewport.name}-${mode}.png`) });
    }
  }

  await page.goto(`${url}/terminal?t=${ticker}`);
  await ui.settle();
  const steps: (number | null)[] = [],
    log: string[][] = [];
  for (const [index, question] of questions.entries()) {
    const before = ui.steps;
    ui.log = [];
    try {
      await question.ask(ui);
      steps.push(ui.steps - before);
    } catch (error) {
      steps.push(null);
      errors.push(`Q${index + 1}: ${(error as Error).message.split('\n')[0]}`);
    }
    log.push(ui.log);
  }
  await context.unrouteAll({ behavior: 'wait' });
  await context.close();
  return { ticker, viewport: viewport.name, steps, errors, log, controls };
}

/** Runs in the page. Counts interactive elements that are at least half on screen. */
function countVisible(selector: string) {
  let count = 0;
  for (const el of document.querySelectorAll(selector)) {
    const rect = el.getBoundingClientRect();
    if (!rect.width || !rect.height) continue;
    let top = Math.max(rect.top, 0),
      left = Math.max(rect.left, 0),
      bottom = Math.min(rect.bottom, innerHeight),
      right = Math.min(rect.right, innerWidth);
    for (let p = el.parentElement; p; p = p.parentElement) {
      const style = getComputedStyle(p);
      if (style.visibility === 'hidden' || style.display === 'none') top = bottom;
      const clip = p.getBoundingClientRect();
      if (style.overflowY !== 'visible') {
        top = Math.max(top, clip.top);
        bottom = Math.min(bottom, clip.bottom);
      }
      if (style.overflowX !== 'visible') {
        left = Math.max(left, clip.left);
        right = Math.min(right, clip.right);
      }
    }
    if (Math.max(0, bottom - top) * Math.max(0, right - left) >= 0.5 * rect.width * rect.height)
      count++;
  }
  return count;
}

const network = await frozenStore({ store, record: args.record, privateSite });
const server = await devServer();
const browser = await chromium.launch({
  ...(process.env.HILLCLIMB_CHROME
    ? { executablePath: process.env.HILLCLIMB_CHROME }
    : { channel: 'chrome' }),
});
const totals: number[] = [];
try {
  for (let run = 0; run < Number(args.repeat); run++) {
    const jobs = tickers.flatMap((ticker) => viewports.map((viewport) => ({ ticker, viewport })));
    // Recording runs one session at a time so concurrent misses never fetch the same file twice.
    const width = args.record ? 1 : 3;
    const results: Awaited<ReturnType<typeof session>>[] = [];
    for (let i = 0; i < jobs.length; i += width)
      results.push(
        ...(await Promise.all(
          jobs
            .slice(i, i + width)
            .map((job) => session(browser, server.url, job.ticker, job.viewport)),
        )),
      );
    await network.save();
    const misses = network.misses;
    const errors = results.flatMap((r) => r.errors.map((e) => `${r.ticker} ${r.viewport} ${e}`));
    const answered = results.flatMap((r) => r.steps).filter((s) => s !== null).length;
    const total = results.flatMap((r) => r.steps).reduce<number>((sum, s) => sum + (s ?? 0), 0);
    totals.push(total);

    console.log(`run ${run + 1}`);
    console.log(
      ['Q', ...results.map((r) => `${r.ticker}/${r.viewport}`), 'sum']
        .map((c) => c.padStart(10))
        .join(''),
    );
    for (const [index] of questions.entries()) {
      const row = results.map((r) => r.steps[index]);
      console.log(
        [
          `Q${index + 1}`,
          ...row.map((s) => (s === null ? 'ERR' : String(s))),
          String(row.reduce<number>((a, s) => a + (s ?? 0), 0)),
        ]
          .map((c) => c.padStart(10))
          .join(''),
      );
    }
    for (const mode of modes)
      console.log(
        [`ctl ${mode}`, ...results.map((r) => String(r.controls[mode]))]
          .map((c) => c.padStart(10))
          .join(''),
      );
    if (args.verbose)
      for (const r of results)
        for (const [index, lines] of r.log.entries())
          console.log(`${r.ticker}/${r.viewport} Q${index + 1}: ${lines.join(', ')}`);
    for (const error of errors) console.log(`error: ${error}`);
    for (const miss of misses) console.log(`unrecorded: ${miss}`);
    console.log(
      `total ${total} answered ${answered}/${results.length * questions.length} errors ${errors.length + misses.size}`,
    );
  }
  if (totals.length > 1)
    console.log(
      `totals ${totals.join(' ')} ${new Set(totals).size === 1 ? 'repeatable' : 'NOT REPEATABLE'}`,
    );
} finally {
  await browser.close();
  await server.close();
}
