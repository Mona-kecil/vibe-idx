import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import type { Browser, Page } from 'playwright-core';
import { checkout, outsideRepo } from '../../pipeline/dev/checkout.js';
import { cliErrors, plural } from '../../pipeline/dev/cli.js';
import { hidePreviewPanel, launch, open, shotArea } from './browser.js';
import type { Box } from './browser.js';
import { offlineHelp, startPreview } from './preview.js';
import type { Scenario } from './scenario.js';

cliErrors();
const usage = `pnpm shots <scenarios.ts> [--base <git ref>] [--only <name>] [--out <dir>] [--offline]

Shoots each scenario on this checkout and, with --base, on that ref too, with the clock frozen. For each scenario it
writes, outside the repository:
  NAME-before.png, NAME-after.png   with a numbered red box for each note
  NAME-compare.png                  side by side, each changed region outlined in blue
  NAME-diff.png                     the after shot faded, with changed pixels in magenta
  NAME-*-clean.png                  both shots without boxes
  notes.md                          the numbered notes and what changed
A note whose selector matches nothing, or matches outside the scenario's panel, fails the run.

A scenarios file can live anywhere and default-exports an array of scenarios:

  import type { Scenario } from '${fileURLToPath(new URL('scenario.ts', import.meta.url))}';
  export default [{
    name: 'brk-1030',                      names the files
    path: '/terminal?t=BBCA&l=flow',       the page
    clock: '10:30',                        HH:MM in the as-of session, or close (the default)
    signedOut: false,
    size: '1440x900',
    click: ['BRK'],                        tabs or buttons by accessible name, in order
    fill: [['Ticker', 'TLKM']],            fields by accessible name, each then Enter
    steps: async (page) => {},             a Playwright Page, for anything else, after clicks and fills
    within: 'BRK',                         the panel or region to shoot; the window when left out
    notes: [{ at: 'role=tab[name="1D"]', text: 'What the reader should see', on: 'after' }],
  }] satisfies Scenario[];

on is before, after (the default) or both. apps/web/dev/shots/preview-panel.ts is an example.

--base REF   the ref to compare with, such as origin/master or the PR's base
--only NAME  one scenario
--out DIR    where the files go; ~/.cache/vibe-idx/shots/<time> by default
${offlineHelp}`;
const { values: args, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    base: { type: 'string' },
    only: { type: 'string' },
    out: { type: 'string' },
    offline: { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  },
});
if (args.help) {
  console.log(usage);
  process.exit(0);
}
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

const inside = (box: Box, area: Box) =>
  box.x >= area.x &&
  box.y >= area.y &&
  box.x + box.width <= area.x + area.width &&
  box.y + box.height <= area.y + area.height;

/** Shoots the scenario's area twice: clean, for comparing, and with each note's numbered box. */
async function shoot(page: Page, scenario: Scenario, side: 'before' | 'after') {
  const marks: { number: number; box: Box }[] = [];
  const outside: number[] = [];
  if (!scenario.panel) await hidePreviewPanel(page);
  // The area doesn't depend on the notes, so before and after come out the same size.
  const clip = await shotArea(page, scenario.within);
  for (const [i, note] of (scenario.notes ?? []).entries()) {
    const on = note.on ?? 'after';
    if (on !== side && on !== 'both') continue;
    const box = await page
      .locator(note.at)
      .first()
      .boundingBox({ timeout: 3000 })
      .catch(() => null);
    if (!box) continue;
    if (clip && !inside(box, clip)) outside.push(i + 1);
    else marks.push({ number: i + 1, box });
  }
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
    outside,
  };
}

type Shot = { image: Buffer; clean: Buffer };
type Region = { left: number; top: number; right: number; bottom: number; pixels: number };

/**
 * Puts before and after side by side and outlines each region where the clean shots differ. Changed pixels within
 * 16px of each other form one region. The clock is frozen while shooting, so an unchanged page has no regions.
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
      const sizes = [first, second].map((img) => `${img.width} by ${img.height} px`);
      if (first.width !== second.width || first.height !== second.height)
        return { sized: false as const, sizes };
      const { width, height } = first;
      const pixels = (img: HTMLImageElement) => {
        const canvas = new OffscreenCanvas(width, height);
        const context = canvas.getContext('2d')!;
        context.drawImage(img, 0, 0);
        return context.getImageData(0, 0, width, height);
      };
      const p = pixels(first).data;
      // The after shot becomes the diff mask, each pixel overwritten once it has been compared.
      const mask = pixels(second);
      const q = mask.data;
      const cell = 8;
      const columns = Math.ceil(width / cell);
      const rows = Math.ceil(height / cell);
      const counts = new Uint32Array(columns * rows);
      const changed = new Uint8Array(width * height);
      for (let i = 0; i < p.length; i += 4) {
        const x = (i / 4) % width,
          y = Math.floor(i / 4 / width);
        if (p[i] !== q[i] || p[i + 1] !== q[i + 1] || p[i + 2] !== q[i + 2]) {
          counts[Math.floor(y / cell) * columns + Math.floor(x / cell)]!++;
          changed[i / 4] = 1;
        }
        // Faded, so the changed pixels stand out.
        const faded = 255 - (255 - (q[i]! + q[i + 1]! + q[i + 2]!) / 3) / 4;
        q.set([faded, faded, faded], i);
      }
      // Each changed pixel is drawn 3px wide, so a one-pixel line still shows.
      for (let at = 0; at < changed.length; at++) {
        if (!changed[at]) continue;
        const x = at % width,
          y = Math.floor(at / width);
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++)
            if (x + dx >= 0 && x + dx < width && y + dy >= 0 && y + dy < height)
              q.set([255, 0, 200, 255], ((y + dy) * width + x + dx) * 4);
      }
      // Cells with changes, joined with their neighbours up to two cells away.
      const seen = new Uint8Array(columns * rows);
      const regions: {
        left: number;
        top: number;
        right: number;
        bottom: number;
        pixels: number;
      }[] = [];
      for (let start = 0; start < counts.length; start++) {
        if (!counts[start] || seen[start]) continue;
        const stack = [start];
        seen[start] = 1;
        const region = { left: Infinity, top: Infinity, right: -1, bottom: -1, pixels: 0 };
        while (stack.length) {
          const at = stack.pop()!;
          const cx = at % columns,
            cy = Math.floor(at / columns);
          region.pixels += counts[at]!;
          region.left = Math.min(region.left, cx * cell);
          region.top = Math.min(region.top, cy * cell);
          region.right = Math.min(width - 1, Math.max(region.right, cx * cell + cell - 1));
          region.bottom = Math.min(height - 1, Math.max(region.bottom, cy * cell + cell - 1));
          for (let dy = -2; dy <= 2; dy++)
            for (let dx = -2; dx <= 2; dx++) {
              const nx = cx + dx,
                ny = cy + dy;
              const next = ny * columns + nx;
              if (nx < 0 || ny < 0 || nx >= columns || ny >= rows || seen[next] || !counts[next])
                continue;
              seen[next] = 1;
              stack.push(next);
            }
        }
        regions.push(region);
      }
      const canvas = new OffscreenCanvas(width, height);
      canvas.getContext('2d')!.putImageData(mask, 0, 0);
      const blob = await canvas.convertToBlob({ type: 'image/png' });
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let binary = '';
      for (let i = 0; i < bytes.length; i += 0x8000)
        binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return { sized: true as const, sizes, regions, mask: btoa(binary) };
    },
    [url(before.clean), url(after.clean)],
  );
  const regions: Region[] = change.sized
    ? change.regions.sort((a, b) => a.top - b.top || a.left - b.left)
    : [];
  const outlines = regions
    .map(
      (r, i) =>
        `<div style="position:absolute;left:${r.left - 3}px;top:${r.top - 3}px;width:${r.right - r.left + 7}px;height:${r.bottom - r.top + 7}px;border:2px dashed #1f6fff;box-sizing:border-box"><span style="position:absolute;right:-2px;top:-18px;font:600 11px system-ui,sans-serif;color:#fff;background:#1f6fff;padding:1px 4px;border-radius:3px">${String.fromCharCode(65 + (i % 26))}</span></div>`,
    )
    .join('');
  const column = (label: string, image: Buffer, extra = '') =>
    `<figure><figcaption>${label}</figcaption><div style="position:relative"><img src="${url(image)}">${extra}</div></figure>`;
  await page.setContent(`<style>
      body { margin: 0; background: #fff; display: flex; gap: 24px; padding: 16px; width: max-content; }
      figure { margin: 0; } figcaption { font: 600 16px system-ui, sans-serif; margin-bottom: 8px; color: #111; }
      img { display: block; outline: 1px solid #ccc; }
    </style>${column(`Before: ${labels[0]}`, before.image)}${column(`After: ${labels[1]}`, after.image, outlines)}`);
  const image = await page.screenshot({ fullPage: true });
  await page.close();
  const summary = !change.sized
    ? [
        `the shots differ in size, before ${change.sizes[0]} and after ${change.sizes[1]}, so the panel itself changed size; compare them by eye`,
      ]
    : !regions.length
      ? ['no visible change']
      : [
          `${plural(regions.length, 'changed region')}, outlined in blue on the after shot:`,
          ...regions.map(
            (r, i) =>
              `   ${String.fromCharCode(65 + (i % 26))}. ${r.right - r.left + 1} by ${r.bottom - r.top + 1} px at ${r.left},${r.top}, ${plural(r.pixels, 'pixel')} changed${
                // A changed border or rule covers a long box with few pixels.
                r.pixels < 0.05 * (r.right - r.left + 1) * (r.bottom - r.top + 1)
                  ? ', thinly spread, such as a line or border; see the diff image'
                  : ''
              }`,
          ),
        ];
  return {
    image,
    mask: change.sized ? Buffer.from(change.mask, 'base64') : undefined,
    summary,
  };
}

const base = args.base ? await checkout(args.base) : undefined;
const head = await startPreview({ port: 0, quiet: true, offline: args.offline });
const before = base
  ? await startPreview({
      port: 0,
      quiet: true,
      web: join(base.dir, 'apps/web'),
      offline: args.offline,
    })
  : undefined;
const browser = await launch();
const report: string[] = base ? [`Before is ${base.label}, after is this checkout.`, ''] : [];
let failed = 0;
try {
  for (const scenario of scenarios) {
    const shots: Partial<Record<'before' | 'after', Shot>> = {};
    const placed = new Set<number>();
    const outside = new Set<number>();
    const sides = [
      ...(before ? [['before', before.url] as const] : []),
      ['after', head.url] as const,
    ];
    for (const [side, url] of sides) {
      const visit = await open(browser, url, { ...scenario, frozen: true });
      const shot = await shoot(visit.page, scenario, side);
      await visit.close();
      shots[side] = shot;
      await writeFile(join(out, `${scenario.name}-${side}.png`), shot.image);
      await writeFile(join(out, `${scenario.name}-${side}-clean.png`), shot.clean);
      for (const problem of visit.problems) console.warn(`${scenario.name} ${side}: ${problem}`);
      for (const url of new Set(visit.unrecorded))
        console.warn(`${scenario.name} ${side}: offline, not recorded yet: ${url}`);
      for (const number of shot.placed) placed.add(number);
      for (const number of shot.outside) outside.add(number);
    }
    let change: string[] = [];
    if (shots.before && shots.after) {
      const compared = await compare(browser, shots.before, shots.after, [
        base!.label,
        'this checkout',
      ]);
      await writeFile(join(out, `${scenario.name}-compare.png`), compared.image);
      if (compared.mask) await writeFile(join(out, `${scenario.name}-diff.png`), compared.mask);
      change = compared.summary;
    }
    const notes = scenario.notes ?? [];
    const shot = new Set(sides.map(([side]) => side));
    const problem = (number: number) => {
      if (outside.has(number)) return `matched outside ${scenario.within}`;
      const on = notes[number - 1]!.on ?? 'after';
      const applies = on === 'both' || shot.has(on);
      return applies && !placed.has(number) ? 'matched nothing' : undefined;
    };
    const lost = notes.flatMap((_, i) => (problem(i + 1) ? [i + 1] : []));
    failed += lost.length;
    for (const number of lost)
      console.error(
        `${scenario.name}: note ${number} ${problem(number)} at ${notes[number - 1]!.at}`,
      );
    report.push(
      `## ${scenario.name}`,
      '',
      ...(change.length ? [`Change: ${change.join('\n')}`, ''] : []),
      ...notes.map(
        (note, i) =>
          `${i + 1}. ${note.text}${lost.includes(i + 1) ? ` (not shown: its selector ${problem(i + 1)})` : ''}`,
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
if (failed) process.exitCode = 1;
