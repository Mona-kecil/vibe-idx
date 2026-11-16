import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import type { Browser, Page } from 'playwright-core';
import { checkout, outsideRepo } from '../../pipeline/dev/checkout.js';
import { cliErrors, plural } from '../../pipeline/dev/cli.js';
import { hidePreviewPanel, launch, open, scope, shotArea } from './browser.js';
import type { Box } from './browser.js';
import { offlineHelp, startPreview } from './preview.js';
import type { Scenario } from './scenario.js';

cliErrors();
const usage = `pnpm shots <scenarios.ts> [--base <git ref>] [--only <name>] [--out <dir>] [--offline]

Shoots each scenario on this checkout and, with --base, on that ref too, with the clock frozen. For each scenario it
writes, outside the repository:
  NAME-before.png, NAME-after.png   with a numbered red box for each note
  NAME-compare.png                  side by side, changed pixels shaded in blue, each region lettered
  NAME-diff.png                     the after shot faded, with changed pixels in magenta
  NAME-*-clean.png                  both shots without boxes
  notes.md                          the numbered notes, the changed regions, and outline lines that changed
A note whose selector matches nothing, or matches something reaching outside the scenario's panel, fails the run.
Blank margins frame the panel, so neighbouring panes stay out of the shot.

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

// A pixel of slack, since boxes come with fractions.
const inside = (box: Box, area: Box) =>
  box.x >= area.x - 1 &&
  box.y >= area.y - 1 &&
  box.x + box.width <= area.x + area.width + 1 &&
  box.y + box.height <= area.y + area.height + 1;

const size = (box: Box) =>
  `${Math.round(box.width)} by ${Math.round(box.height)} px at ${Math.round(box.x)},${Math.round(box.y)}`;

/**
 * Shoots the scenario's area twice, clean for comparing and with each note's numbered box, and reads its
 * accessibility outline, so a renamed label shows up even when the pixels barely move.
 */
async function shoot(page: Page, scenario: Scenario, side: 'before' | 'after') {
  const marks: { number: number; box: Box }[] = [];
  const outside = new Map<number, string>();
  if (!scenario.panel) await hidePreviewPanel(page);
  // The area doesn't depend on the notes, so before and after come out the same size.
  const area = await shotArea(page, scenario.within);
  const clip = area ? { clip: area.clip } : {};
  for (const [i, note] of (scenario.notes ?? []).entries()) {
    const on = note.on ?? 'after';
    if (on !== side && on !== 'both') continue;
    const box = await page
      .locator(note.at)
      .first()
      .boundingBox({ timeout: 3000 })
      .catch(() => null);
    if (!box) continue;
    if (area && !inside(box, area.content))
      outside.set(
        i + 1,
        `matched an element of ${size(box)}, which reaches outside ${scenario.within} (${size(area.content)}); pick an element within it`,
      );
    else marks.push({ number: i + 1, box });
  }
  const outline = (await (await scope(page, scenario.within)).ariaSnapshot())
    .split('\n')
    .filter((line) => !/^\s*- \/url: /.test(line));
  const clean = await page.screenshot(clip);
  await page.evaluate((list) => {
    const layer = document.createElement('div');
    layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647';
    type Rect = { x: number; y: number; width: number; height: number };
    const frames = list.map(({ box }) => ({
      x: box.x - 4,
      y: box.y - 4,
      width: box.width + 8,
      height: box.height + 8,
    }));
    const overlaps = (a: Rect, b: Rect) =>
      a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
    const badges: Rect[] = [];
    list.forEach(({ number }, i) => {
      const frame = frames[i]!;
      const box = document.createElement('div');
      box.style.cssText = `position:fixed;left:${frame.x}px;top:${frame.y}px;width:${frame.width}px;height:${frame.height}px;border:3px solid #ff1f1f;border-radius:4px;box-sizing:border-box`;
      // Outside the frame's corners, so it never covers what it marks; the first spot clear of other notes wins.
      const spots = [
        [frame.x - 20, frame.y - 20],
        [frame.x + frame.width - 2, frame.y - 20],
        [frame.x - 20, frame.y + frame.height - 2],
        [frame.x + frame.width - 2, frame.y + frame.height - 2],
      ].map(([x, y]) => ({ x: Math.max(0, x!), y: Math.max(0, y!), width: 22, height: 22 }));
      const spot =
        spots.find(
          (s) =>
            !badges.some((b) => overlaps(s, b)) &&
            !frames.some((f, j) => j !== i && overlaps(s, f)),
        ) ?? spots[0]!;
      badges.push(spot);
      const badge = document.createElement('div');
      badge.textContent = String(number);
      badge.style.cssText = `position:fixed;left:${spot.x}px;top:${spot.y}px;width:22px;height:22px;border-radius:11px;background:#ff1f1f;color:#fff;font:bold 13px/22px system-ui,sans-serif;text-align:center`;
      layer.append(box, badge);
    });
    document.body.append(layer);
  }, marks);
  return {
    image: await page.screenshot(clip),
    clean,
    outline,
    placed: marks.map((m) => m.number),
    outside,
  };
}

/** Outline lines only one side has, in the order each side shows them. */
function outlineChanges(before: string[], after: string[]) {
  const count = (lines: string[]) => {
    const counts = new Map<string, number>();
    for (const line of lines) counts.set(line, (counts.get(line) ?? 0) + 1);
    return counts;
  };
  const only = (lines: string[], other: Map<string, number>, sign: string) =>
    lines.flatMap((line) => {
      const left = other.get(line) ?? 0;
      if (left) {
        other.set(line, left - 1);
        return [];
      }
      return [`${sign} ${line.trim()}`];
    });
  return [...only(before, count(after), '-'), ...only(after, count(before), '+')];
}

type Shot = { image: Buffer; clean: Buffer; outline: string[] };
type Region = { left: number; top: number; right: number; bottom: number; pixels: number };

/**
 * Puts before and after side by side and shades in blue each 8px cell where the clean shots differ, so a changed
 * line shows as a line. Changed cells within 16px of each other form one lettered region. The clock is frozen while
 * shooting, so an unchanged page has no regions.
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
      const original = q.slice();
      /**
       * Whether the pixel at x,y in `a` could be an anti-aliased edge of what `b` shows there: within 32 levels of
       * the pixel in `b`, and in each channel between the darkest and lightest of `b`'s 3 by 3 neighbourhood, give
       * or take 12 levels. A recoloured or replaced shape steps further or leaves that range.
       */
      const edge = (a: Uint8ClampedArray, b: Uint8ClampedArray, x: number, y: number) => {
        const at = (y * width + x) * 4;
        for (let c = 0; c < 3; c++) {
          if (Math.abs(a[at + c]! - b[at + c]!) > 32) return false;
          let low = 255,
            high = 0;
          for (let dy = -1; dy <= 1; dy++)
            for (let dx = -1; dx <= 1; dx++) {
              const nx = x + dx,
                ny = y + dy;
              if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
              const value = b[(ny * width + nx) * 4 + c]!;
              low = Math.min(low, value);
              high = Math.max(high, value);
            }
          if (a[at + c]! < low - 12 || a[at + c]! > high + 12) return false;
        }
        return true;
      };
      // Text edges come out slightly shaded or shifted from run to run on a busy machine, so they are counted apart.
      let faint = 0;
      const faintPixels = new Uint8Array(width * height);
      for (let i = 0; i < p.length; i += 4) {
        if (p[i] === q[i] && p[i + 1] === q[i + 1] && p[i + 2] === q[i + 2]) continue;
        const x = (i / 4) % width,
          y = Math.floor(i / 4 / width);
        if (edge(p, original, x, y) && edge(original, p, x, y)) {
          faint++;
          faintPixels[i / 4] = 1;
        } else {
          counts[Math.floor(y / cell) * columns + Math.floor(x / cell)]!++;
          changed[i / 4] = 1;
        }
      }
      for (let i = 0; i < q.length; i += 4) {
        // Faded, so the changed pixels stand out; faint ones show in light orange.
        const faded = 255 - (255 - (q[i]! + q[i + 1]! + q[i + 2]!) / 3) / 4;
        q.set(faintPixels[i / 4] ? [255, 190, 120] : [faded, faded, faded], i);
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
      const encode = async (canvas: OffscreenCanvas) => {
        const bytes = new Uint8Array(
          await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer(),
        );
        let binary = '';
        for (let i = 0; i < bytes.length; i += 0x8000)
          binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        return btoa(binary);
      };
      const diff = new OffscreenCanvas(width, height);
      diff.getContext('2d')!.putImageData(mask, 0, 0);
      const shade = new OffscreenCanvas(width, height);
      const context = shade.getContext('2d')!;
      context.fillStyle = 'rgba(31, 111, 255, 0.45)';
      counts.forEach((count, at) => {
        if (count)
          context.fillRect((at % columns) * cell, Math.floor(at / columns) * cell, cell, cell);
      });
      return {
        sized: true as const,
        sizes,
        faint,
        regions,
        mask: await encode(diff),
        shade: await encode(shade),
      };
    },
    [url(before.clean), url(after.clean)],
  );
  const regions: Region[] = change.sized
    ? change.regions.sort((a, b) => a.top - b.top || a.left - b.left)
    : [];
  const letter = (i: number) => String.fromCharCode(65 + (i % 26));
  const outlines =
    change.sized && regions.length
      ? `<img src="data:image/png;base64,${change.shade}" style="position:absolute;left:0;top:0;outline:none">${regions
          .map(
            (r, i) =>
              `<span style="position:absolute;left:${r.left}px;top:${Math.max(0, r.top - 18)}px;font:600 11px system-ui,sans-serif;color:#fff;background:#1f6fff;padding:1px 4px;border-radius:3px">${letter(i)}</span>`,
          )
          .join('')}`
      : '';
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
          `${plural(regions.length, 'changed region')}, shaded in blue on the after shot:`,
          ...regions.map(
            (r, i) =>
              `   ${letter(i)}. ${r.right - r.left + 1} by ${r.bottom - r.top + 1} px at ${r.left},${r.top}, ${plural(r.pixels, 'pixel')} changed${
                // A changed border or rule covers a long box with few pixels.
                r.pixels < 0.05 * (r.right - r.left + 1) * (r.bottom - r.top + 1)
                  ? ', thinly spread, such as a line or border'
                  : ''
              }`,
          ),
        ];
  if (change.sized && change.faint)
    summary.push(
      `${plural(change.faint, 'pixel')} differ slightly, as anti-aliased edges vary between runs; not counted, and light orange in the diff image`,
    );
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
    /** Each note's number with the sides it was placed on. */
    const placed = new Map<number, Set<string>>();
    const outside = new Map<number, string>();
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
      for (const number of shot.placed)
        placed.set(number, new Set([...(placed.get(number) ?? []), side]));
      for (const [number, why] of shot.outside) outside.set(number, why);
    }
    const outline =
      shots.before && shots.after ? outlineChanges(shots.before.outline, shots.after.outline) : [];
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
      if (outside.has(number)) return outside.get(number);
      const on = notes[number - 1]!.on ?? 'after';
      const missed = (on === 'both' ? ['before', 'after'] : [on]).filter(
        (side) => shot.has(side as 'before' | 'after') && !placed.get(number)?.has(side),
      );
      if (!missed.length) return undefined;
      return `matched nothing${shot.size > 1 && missed.length === 1 ? ` on the ${missed[0]} side` : ''}; \`pnpm ui:check '${scenario.path}' --within <panel>\` lists the names on the page`;
    };
    const lost = notes.flatMap((_, i) => (problem(i + 1) ? [i + 1] : []));
    failed += lost.length;
    for (const number of lost)
      console.error(
        `${scenario.name}: note ${number} at ${notes[number - 1]!.at} ${problem(number)}`,
      );
    report.push(
      `## ${scenario.name}`,
      '',
      ...(change.length ? [`Change: ${change.join('\n')}`, ''] : []),
      ...(shots.before && shots.after
        ? outline.length
          ? [
              'Accessibility outline, lines only one side has (- before, + after):',
              ...outline.slice(0, 40).map((line) => `    ${line}`),
              ...(outline.length > 40 ? [`    ${outline.length - 40} more`] : []),
              '',
            ]
          : ['Accessibility outline: no change.', '']
        : []),
      ...notes.map(
        (note, i) =>
          `${i + 1}. ${note.text}${lost.includes(i + 1) ? ` (not shown: ${problem(i + 1)})` : ''}`,
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
