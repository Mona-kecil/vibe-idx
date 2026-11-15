import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import type { Browser, Page } from 'playwright-core';
import { checkout, outsideRepo } from '../../pipeline/dev/checkout.js';
import { cliErrors } from '../../pipeline/dev/cli.js';
import { launch, open, scope } from './browser.js';
import type { Visit } from './browser.js';
import { startPreview } from './preview.js';

export type Note = {
  /** A Playwright selector: CSS, or `role=button[name="1D"]`, `text=...`. */
  at: string;
  text: string;
  /** Which shot gets the box. Changed or new things go on after, removed things on before. */
  on?: 'before' | 'after' | 'both';
};
export type Scenario = Visit & {
  name: string;
  /** The panel or region to shoot, by accessible name; the whole window when left out. */
  within?: string;
  notes?: Note[];
  /** Keeps the preview panel in the shot; it is hidden otherwise. */
  panel?: boolean;
};

cliErrors();
const usage = `pnpm shots <scenarios.ts> [--base <git ref>] [--only <name>] [--out <dir>]

Shoots each scenario on this checkout and, with --base, on that ref too, then writes before, after and
side-by-side images with numbered red boxes from each note's selector. A scenarios file default-exports
an array of Scenario from apps/web/dev/shots.ts.`;
const { values: args, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    base: { type: 'string' },
    only: { type: 'string' },
    out: { type: 'string' },
  },
});
const file = positionals.find((arg) => arg !== '--');
if (!file) throw new Error(usage);
const scenarios = (
  (await import(pathToFileURL(resolve(process.env.INIT_CWD ?? '.', file)).href)) as {
    default: Scenario[];
  }
).default.filter((s) => !args.only || s.name === args.only);
if (!scenarios.length)
  throw new Error(`No scenarios${args.only ? ` named ${args.only}` : ''} in ${file}.`);
const stamp = new Date().toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-');
// Shots show private broker data, so they stay outside the repository.
const out = args.out ? outsideRepo(args.out) : join(homedir(), '.cache/vibe-idx/shots', stamp);
await mkdir(out, { recursive: true });

type Box = { x: number; y: number; width: number; height: number };

/** The scenario's area: its panel with the panel's tab strip, grown to fit every note's box and badge. */
async function area(page: Page, scenario: Scenario, marks: Box[]): Promise<Box | undefined> {
  if (!scenario.within) return undefined;
  const panel = await scope(page, scenario.within);
  const boxes = await panel.evaluate((element) => {
    const rect = (el: Element | null | undefined) => {
      const r = el?.getBoundingClientRect();
      return r ? { x: r.x, y: r.y, width: r.width, height: r.height } : undefined;
    };
    const tab =
      document.getElementById(element.getAttribute('aria-labelledby') ?? '') ??
      (element.id ? document.querySelector(`[role=tab][aria-controls="${element.id}"]`) : null);
    return [rect(element), rect(tab?.closest('[role=tablist]'))].filter((r) => r !== undefined);
  });
  // A badge sits 14px above and left of its box.
  const all = [
    ...boxes,
    ...marks.map((b) => ({
      ...b,
      x: b.x - 14,
      y: b.y - 14,
      width: b.width + 18,
      height: b.height + 18,
    })),
  ];
  const size = page.viewportSize()!;
  const pad = 4;
  const left = Math.max(0, Math.min(...all.map((b) => b.x)) - pad);
  const top = Math.max(0, Math.min(...all.map((b) => b.y)) - pad);
  const right = Math.min(size.width, Math.max(...all.map((b) => b.x + b.width)) + pad);
  const bottom = Math.min(size.height, Math.max(...all.map((b) => b.y + b.height)) + pad);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** Shoots the scenario's area twice: clean, for comparing, and with each note's numbered box. */
async function shoot(page: Page, scenario: Scenario, side: 'before' | 'after') {
  const marks: { number: number; box: Box }[] = [];
  for (const [i, note] of (scenario.notes ?? []).entries()) {
    const on = note.on ?? 'after';
    if (on !== side && on !== 'both') continue;
    const box = await page
      .locator(note.at)
      .first()
      .boundingBox({ timeout: 3000 })
      .catch(() => null);
    if (box) marks.push({ number: i + 1, box });
  }
  if (!scenario.panel)
    await page.locator('#preview-panel').evaluate((panel: HTMLElement) => (panel.hidden = true));
  const clip = await area(
    page,
    scenario,
    marks.map((m) => m.box),
  );
  const clean = await page.screenshot(clip ? { clip } : {});
  await page.evaluate((list) => {
    const layer = document.createElement('div');
    layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647';
    for (const { number, box } of list) {
      const frame = document.createElement('div');
      frame.style.cssText = `position:fixed;left:${box.x - 4}px;top:${box.y - 4}px;width:${box.width + 8}px;height:${box.height + 8}px;border:3px solid #ff1f1f;border-radius:4px;box-sizing:border-box`;
      const badge = document.createElement('div');
      badge.textContent = String(number);
      badge.style.cssText = `position:fixed;left:${Math.max(0, box.x - 14)}px;top:${Math.max(0, box.y - 14)}px;width:22px;height:22px;border-radius:11px;background:#ff1f1f;color:#fff;font:bold 13px/22px system-ui,sans-serif;text-align:center`;
      layer.append(frame, badge);
    }
    document.body.append(layer);
  }, marks);
  return {
    image: await page.screenshot(clip ? { clip } : {}),
    clean,
    placed: marks.map((m) => m.number),
  };
}

type Shot = { image: Buffer; clean: Buffer };
/**
 * Puts before and after side by side, and outlines in blue where the clean shots differ. The clock is frozen while
 * shooting, so an unchanged page compares as identical.
 */
async function compare(browser: Browser, before: Shot, after: Shot, labels: [string, string]) {
  const page = await browser.newPage({ viewport: { width: 400, height: 300 } });
  // tsx names the functions below with an `__name` helper, which a blank page lacks.
  await page.evaluate('globalThis.__name = (f) => f');
  const url = (image: Buffer) => `data:image/png;base64,${image.toString('base64')}`;
  const change = await page.evaluate(
    async ([a, b]) => {
      const load = (src: string) =>
        new Promise<HTMLImageElement>((done) => {
          const img = new Image();
          img.onload = () => done(img);
          img.src = src;
        });
      const [first, second] = await Promise.all([load(a!), load(b!)]);
      if (first.width !== second.width || first.height !== second.height)
        return { sized: false as const };
      const pixels = (img: HTMLImageElement) => {
        const canvas = new OffscreenCanvas(img.width, img.height);
        const context = canvas.getContext('2d')!;
        context.drawImage(img, 0, 0);
        return context.getImageData(0, 0, img.width, img.height).data;
      };
      const [p, q] = [pixels(first), pixels(second)];
      let count = 0,
        left = Infinity,
        top = Infinity,
        right = -1,
        bottom = -1;
      for (let i = 0; i < p.length; i += 4)
        if (p[i] !== q[i] || p[i + 1] !== q[i + 1] || p[i + 2] !== q[i + 2]) {
          const x = (i / 4) % first.width,
            y = Math.floor(i / 4 / first.width);
          count++;
          left = Math.min(left, x);
          top = Math.min(top, y);
          right = Math.max(right, x);
          bottom = Math.max(bottom, y);
        }
      return { sized: true as const, count, box: count ? { left, top, right, bottom } : null };
    },
    [url(before.clean), url(after.clean)],
  );
  const outline =
    change.sized && change.box
      ? `<div style="position:absolute;left:${change.box.left - 3}px;top:${change.box.top - 3}px;width:${change.box.right - change.box.left + 7}px;height:${change.box.bottom - change.box.top + 7}px;border:2px dashed #1f6fff;box-sizing:border-box"></div>`
      : '';
  const column = (label: string, image: Buffer, extra = '') =>
    `<figure><figcaption>${label}</figcaption><div style="position:relative"><img src="${url(image)}">${extra}</div></figure>`;
  await page.setContent(`<style>
      body { margin: 0; background: #fff; display: flex; gap: 24px; padding: 16px; width: max-content; }
      figure { margin: 0; } figcaption { font: 600 16px system-ui, sans-serif; margin-bottom: 8px; color: #111; }
      img { display: block; outline: 1px solid #ccc; }
    </style>${column(`Before: ${labels[0]}`, before.image)}${column(`After: ${labels[1]}`, after.image, outline)}`);
  const image = await page.screenshot({ fullPage: true });
  await page.close();
  const summary = !change.sized
    ? 'the two shots differ in size'
    : !change.box
      ? 'no visible change'
      : `${change.count.toLocaleString('en')} pixels changed, inside the blue dashed box (${change.box.right - change.box.left + 1} by ${change.box.bottom - change.box.top + 1} px)`;
  return { image, summary };
}

const base = args.base ? await checkout(args.base) : undefined;
const head = await startPreview({ port: 0, quiet: true });
const before = base
  ? await startPreview({ port: 0, quiet: true, web: join(base.dir, 'apps/web') })
  : undefined;
const browser = await launch();
const report: string[] = [];
let unplaced = 0;
try {
  for (const scenario of scenarios) {
    const shots: Partial<Record<'before' | 'after', Shot>> = {};
    const placed = new Set<number>();
    const sides = [
      ...(before ? [['before', before.url] as const] : []),
      ['after', head.url] as const,
    ];
    for (const [side, url] of sides) {
      const visit = await open(browser, url, { ...scenario, frozen: true });
      const { image, clean, placed: marked } = await shoot(visit.page, scenario, side);
      await visit.close();
      shots[side] = { image, clean };
      await writeFile(join(out, `${scenario.name}-${side}.png`), image);
      for (const problem of visit.problems) console.warn(`${scenario.name} ${side}: ${problem}`);
      for (const number of marked) placed.add(number);
    }
    let change: string | undefined;
    if (shots.before && shots.after) {
      const compared = await compare(browser, shots.before, shots.after, [
        base!.label,
        'this checkout',
      ]);
      await writeFile(join(out, `${scenario.name}-compare.png`), compared.image);
      change = compared.summary;
    }
    const notes = scenario.notes ?? [];
    const shot = new Set(sides.map(([side]) => side));
    const lost = notes.flatMap((note, i) => {
      const on = note.on ?? 'after';
      const applies = on === 'both' || shot.has(on);
      return applies && !placed.has(i + 1) ? [i + 1] : [];
    });
    unplaced += lost.length;
    for (const number of lost)
      console.error(`${scenario.name}: note ${number} matched nothing at ${notes[number - 1]!.at}`);
    report.push(
      `## ${scenario.name}`,
      '',
      ...(change ? [`Change: ${change}.`, ''] : []),
      ...notes.map(
        (note, i) =>
          `${i + 1}. ${note.text}${lost.includes(i + 1) ? ' (not shown: its selector matched nothing)' : ''}`,
      ),
      '',
    );
  }
} finally {
  await browser.close();
  await head.close();
  await before?.close();
  base?.remove();
}
await writeFile(join(out, 'notes.md'), report.join('\n'));
console.log(`${out}\n\n${report.join('\n')}`);
// A note without its box would describe something the reader can't find.
if (unplaced) process.exitCode = 1;
