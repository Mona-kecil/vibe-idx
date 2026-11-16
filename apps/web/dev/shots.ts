import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import type { Browser, Page } from 'playwright-core';
import { checkout, outsideRepo } from '../../pipeline/dev/checkout.js';
import { cliErrors, plural } from '../../pipeline/dev/cli.js';
import {
  changeSummary,
  diffPixels,
  gutterFor,
  letter,
  outlineChanges,
  outlineSelectors,
  placeBadges,
  withinPanel,
} from './annotate.js';
import { hidePreviewPanel, launch, open, scope, shotArea } from './browser.js';
import type { Box } from './browser.js';
import { recordHelp, startPreview } from './preview.js';
import type { Scenario } from './scenario.js';

cliErrors();
const usage = `pnpm shots <scenarios.ts> [--base <git ref>] [--only <name>] [--out <dir>] [--record]

Shoots each scenario on this checkout and, with --base, on that ref too, with the clock frozen. For each scenario it
writes, outside the repository:
  NAME-before.png, NAME-after.png   with a numbered red box for each note
  NAME-compare.png                  side by side, changed pixels shaded in blue, each region lettered
  NAME-diff.png                     the after shot faded, with changed pixels in magenta
  NAME-*-clean.png                  both shots without boxes
  notes.md                          the numbered notes, the changed regions, and outline lines that changed
A note whose selector matches nothing, or only something outside the scenario's panel, fails the run; one that
runs past the panel is boxed where it shows.
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
    fill: [['Command', 'TLKM']],           fields by accessible name, each then Enter
    steps: async (page) => {},             a Playwright Page, for anything else, after clicks and fills
    within: 'BRK',                         the panel or region to shoot; the window when left out
    notes: [{ at: 'role=tab[name="1D"]', text: 'What the reader should see', on: 'after' }],
  }] satisfies Scenario[];

on is before, after (the default) or both. apps/web/dev/shots/preview-panel.ts is an example. The clock and CSS
animations are frozen while shooting, and errors or 404s on either side are listed in notes.md.

--base REF   the ref to compare with, such as origin/master or the PR's base
--only NAME  one scenario
--out DIR    where the files go; ~/.cache/vibe-idx/shots/<time> by default
${recordHelp}`;
const { values: args, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    base: { type: 'string' },
    only: { type: 'string' },
    out: { type: 'string' },
    record: { type: 'boolean', default: false },
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
  // The clock is frozen too, so an unchanged page shoots the same pixels every time; a blinking cursor would not.
  const clip = { animations: 'disabled' as const, ...(area && { clip: area.clip }) };
  for (const [i, note] of (scenario.notes ?? []).entries()) {
    const on = note.on ?? 'after';
    if (on !== side && on !== 'both') continue;
    const box = await page
      .locator(note.at)
      .first()
      .boundingBox({ timeout: 3000 })
      .catch((error: Error) => {
        // A selector Playwright can't parse is a mistake in the note, not an element missing from the page.
        if (error.name !== 'TimeoutError')
          throw new Error(
            `${scenario.name}: note ${i + 1} at ${note.at} is not a valid selector: ${error.message.split('\n')[0]}`,
          );
        return null;
      });
    if (!box) continue;
    const shown = area ? withinPanel(box, area.content) : { box, cut: false };
    if (!shown)
      outside.set(
        i + 1,
        `matched an element of ${size(box)}, which lies outside ${scenario.within} (${size(area!.content)}); pick an element within it`,
      );
    else {
      if (shown.cut)
        console.warn(
          `${scenario.name} ${side}: note ${i + 1} at ${note.at} runs past ${scenario.within}, so its box is cut to the panel`,
        );
      marks.push({ number: i + 1, box: shown.box });
    }
  }
  const outline = (await (await scope(page, scenario.within)).ariaSnapshot())
    .split('\n')
    .filter((line) => !/^\s*- \/url: /.test(line));
  const clean = await page.screenshot(clip);
  const frames = marks.map(({ box }) => ({
    x: box.x - 4,
    y: box.y - 4,
    width: box.width + 8,
    height: box.height + 8,
  }));
  const viewport = page.viewportSize()!;
  const badges = placeBadges(
    frames,
    gutterFor(area),
    area?.clip ?? { x: 0, y: 0, width: viewport.width, height: viewport.height },
  );
  await page.evaluate(
    ({ frames, badges, numbers }) => {
      const layer = document.createElement('div');
      layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647';
      const lines = badges.flatMap(({ line }) =>
        line
          ? [
              `<line x1="${line.x1}" y1="${line.y1}" x2="${line.x2}" y2="${line.y2}" stroke="#ff1f1f" stroke-width="1" stroke-opacity="0.7"/>`,
            ]
          : [],
      );
      layer.innerHTML = `<svg style="position:fixed;inset:0;width:100%;height:100%;overflow:visible">${lines.join('')}</svg>`;
      frames.forEach((frame, i) => {
        const box = document.createElement('div');
        box.style.cssText = `position:fixed;left:${frame.x}px;top:${frame.y}px;width:${frame.width}px;height:${frame.height}px;border:3px solid #ff1f1f;border-radius:4px;box-sizing:border-box`;
        const { spot } = badges[i]!;
        const badge = document.createElement('div');
        badge.textContent = String(numbers[i]);
        badge.style.cssText = `position:fixed;left:${spot.x}px;top:${spot.y}px;width:22px;height:22px;border-radius:11px;background:#ff1f1f;color:#fff;font:bold 13px/22px system-ui,sans-serif;text-align:center`;
        layer.append(box, badge);
      });
      document.body.append(layer);
    },
    { frames, badges, numbers: marks.map((m) => m.number) },
  );
  return {
    image: await page.screenshot(clip),
    clean,
    outline,
    placed: marks.map((m) => m.number),
    outside,
  };
}

type Shot = { image: Buffer; clean: Buffer; outline: string[] };

/** PNG bytes and RGBA pixels, converted by a blank browser page, which can decode and encode PNG. */
async function pngCodec(browser: Browser) {
  const page = await browser.newPage();
  // tsx names the functions below with an `__name` helper, which a blank page lacks.
  await page.evaluate('globalThis.__name = (f) => f');
  return {
    async decode(png: Buffer) {
      const { width, height, data } = await page.evaluate(
        async (src) => {
          const image = await createImageBitmap(await (await fetch(src)).blob());
          const canvas = new OffscreenCanvas(image.width, image.height);
          const context = canvas.getContext('2d')!;
          context.drawImage(image, 0, 0);
          const pixels = context.getImageData(0, 0, image.width, image.height).data;
          let binary = '';
          for (let i = 0; i < pixels.length; i += 0x8000)
            binary += String.fromCharCode(...pixels.subarray(i, i + 0x8000));
          return { width: image.width, height: image.height, data: btoa(binary) };
        },
        `data:image/png;base64,${png.toString('base64')}`,
      );
      return { width, height, pixels: new Uint8ClampedArray(Buffer.from(data, 'base64')) };
    },
    async encode(pixels: Uint8ClampedArray, width: number, height: number) {
      const data = await page.evaluate(
        async ({ data, width, height }) => {
          const bytes = Uint8ClampedArray.from(atob(data), (c) => c.charCodeAt(0));
          const canvas = new OffscreenCanvas(width, height);
          canvas.getContext('2d')!.putImageData(new ImageData(bytes, width, height), 0, 0);
          const png = new Uint8Array(
            await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer(),
          );
          let binary = '';
          for (let i = 0; i < png.length; i += 0x8000)
            binary += String.fromCharCode(...png.subarray(i, i + 0x8000));
          return btoa(binary);
        },
        { data: Buffer.from(pixels.buffer).toString('base64'), width, height },
      );
      return Buffer.from(data, 'base64');
    },
    close: () => page.close(),
  };
}

/**
 * Puts before and after side by side and shades in blue each 8px cell where the clean shots differ, so a changed
 * line shows as a line, with each region lettered. The clock is frozen while shooting, so an unchanged page has no
 * regions.
 */
async function compare(browser: Browser, before: Shot, after: Shot, labels: [string, string]) {
  const codec = await pngCodec(browser);
  const [a, b] = [await codec.decode(before.clean), await codec.decode(after.clean)];
  const sized = a.width === b.width && a.height === b.height;
  const diff = sized ? diffPixels(a.pixels, b.pixels, a.width, a.height) : undefined;
  const mask = diff && (await codec.encode(diff.mask, a.width, a.height));
  const shade = diff?.regions.length
    ? await codec.encode(diff.shade, a.width, a.height)
    : undefined;
  await codec.close();

  const url = (image: Buffer) => `data:image/png;base64,${image.toString('base64')}`;
  const overlay =
    diff && shade
      ? `<img src="${url(shade)}" style="position:absolute;left:0;top:0;outline:none">${diff.regions
          .map(
            (r, i) =>
              `<span style="position:absolute;left:${r.left}px;top:${Math.max(0, r.top - 18)}px;font:600 11px system-ui,sans-serif;color:#fff;background:#1f6fff;padding:1px 4px;border-radius:3px">${letter(i)}</span>`,
          )
          .join('')}`
      : '';
  const column = (label: string, image: Buffer, extra = '') =>
    `<figure><figcaption>${label}</figcaption><div style="position:relative"><img src="${url(image)}">${extra}</div></figure>`;
  const page = await browser.newPage({ viewport: { width: 400, height: 300 } });
  await page.setContent(`<style>
      body { margin: 0; background: #fff; display: flex; gap: 24px; padding: 16px; width: max-content; }
      figure { margin: 0; } figcaption { font: 600 16px system-ui, sans-serif; margin-bottom: 8px; color: #111; }
      img { display: block; outline: 1px solid #ccc; }
    </style>${column(`Before: ${labels[0]}`, before.image)}${column(`After: ${labels[1]}`, after.image, overlay)}`);
  const image = await page.screenshot({ fullPage: true });
  await page.close();
  const dimensions = (side: { width: number; height: number }) =>
    `${side.width} by ${side.height} px`;
  return {
    image,
    mask,
    summary: changeSummary(diff ?? { sizes: [dimensions(a), dimensions(b)] }),
  };
}

const base = args.base ? await checkout(args.base) : undefined;
const head = await startPreview({ port: 0, quiet: true, record: args.record });
const before = base
  ? await startPreview({
      port: 0,
      quiet: true,
      web: join(base.dir, 'apps/web'),
      record: args.record,
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
    /** Errors and 404s while shooting, so the notes say when a shot shows a page that didn't fully load. */
    const trouble: string[] = [];
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
      for (const url of new Set(visit.missing)) {
        console.warn(`${scenario.name} ${side}: not found (404): ${url}`);
        trouble.push(`${side}: not found (404): ${url}`);
      }
      for (const problem of visit.problems) trouble.push(`${side}: ${problem}`);
      for (const url of new Set(visit.unrecorded)) {
        console.warn(`${scenario.name} ${side}: not recorded yet, --record fetches it: ${url}`);
        trouble.push(`${side}: not recorded yet, --record fetches it: ${url}`);
      }
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
      return `matched nothing${shot.size > 1 && missed.length === 1 ? ` on the ${missed[0]} side` : ''}`;
    };
    const lost = notes.flatMap((_, i) => (problem(i + 1) ? [i + 1] : []));
    failed += lost.length;
    for (const number of lost)
      console.error(
        `${scenario.name}: note ${number} at ${notes[number - 1]!.at} ${problem(number)}`,
      );
    const candidates = outlineSelectors((shots.after ?? shots.before)!.outline);
    if (lost.length && candidates.length)
      console.error(
        `selectors for named elements in ${scenario.within ?? 'the page'}:\n  ${candidates.slice(0, 30).join('\n  ')}${candidates.length > 30 ? `\n  and ${candidates.length - 30} more` : ''}`,
      );
    report.push(
      `## ${scenario.name}`,
      '',
      ...(trouble.length
        ? ['While shooting:', ...[...new Set(trouble)].map((line) => `    ${line}`), '']
        : []),
      ...(change.length
        ? [
            `Change: ${change.join('\n')}${change[0] === 'no visible change' && outline.length ? ', but the accessibility outline differs, below' : ''}`,
            '',
          ]
        : []),
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
// Failed notes lead the file, so the images beside it aren't taken for a finished set.
if (failed)
  report.unshift(
    `This run failed: ${plural(failed, 'note')} could not be placed, listed below as not shown. Fix the scenario and run again.`,
    '',
  );
await writeFile(join(out, 'notes.md'), report.join('\n'));
console.log(`${out}\n\n${report.join('\n')}`);
// A note without its box would describe something the reader can't find.
if (failed) process.exitCode = 1;
