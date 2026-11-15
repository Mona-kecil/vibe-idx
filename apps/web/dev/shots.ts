import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import type { Browser, Page } from 'playwright-core';
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
const out = args.out ?? join(homedir(), '.cache/vibe-idx/shots', stamp);
await mkdir(out, { recursive: true });

const web = fileURLToPath(new URL('..', import.meta.url));
const repo = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: web }).toString().trim();

/** A detached checkout of the base ref that borrows this checkout's installed packages. */
async function checkout(ref: string) {
  const sha = execFileSync('git', ['rev-parse', '--verify', `${ref}^{commit}`], { cwd: repo })
    .toString()
    .trim();
  const dir = join(tmpdir(), `vibe-idx-base-${sha.slice(0, 12)}`);
  if (!existsSync(dir)) {
    execFileSync('git', ['worktree', 'add', '--detach', '--quiet', dir, sha], { cwd: repo });
    for (const modules of ['node_modules', 'apps/web/node_modules', 'apps/pipeline/node_modules'])
      if (existsSync(join(repo, modules))) await symlink(join(repo, modules), join(dir, modules));
  }
  return {
    web: join(dir, 'apps/web'),
    label: `${ref} (${sha.slice(0, 7)})`,
    remove: () => execFileSync('git', ['worktree', 'remove', '--force', dir], { cwd: repo }),
  };
}

/** Draws each note's box and number into the page, then returns the shot of the scenario's area. */
async function shoot(page: Page, scenario: Scenario, side: 'before' | 'after') {
  const marks: { number: number; box: { x: number; y: number; width: number; height: number } }[] =
    [];
  const missing: number[] = [];
  for (const [i, note] of (scenario.notes ?? []).entries()) {
    const on = note.on ?? 'after';
    if (on !== side && on !== 'both') continue;
    const box = await page
      .locator(note.at)
      .first()
      .boundingBox({ timeout: 3000 })
      .catch(() => null);
    if (box) marks.push({ number: i + 1, box });
    else missing.push(i + 1);
  }
  if (!scenario.panel)
    await page.locator('#preview-panel').evaluate((panel: HTMLElement) => (panel.hidden = true));
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
  const area = scenario.within ? await scope(page, scenario.within).boundingBox() : null;
  const size = page.viewportSize()!;
  const pad = 16;
  const clip = area && {
    x: Math.max(0, area.x - pad),
    y: Math.max(0, area.y - pad),
    width: Math.min(size.width, area.x + area.width + pad) - Math.max(0, area.x - pad),
    height: Math.min(size.height, area.y + area.height + pad) - Math.max(0, area.y - pad),
  };
  return { image: await page.screenshot(clip ? { clip } : {}), missing };
}

async function compare(browser: Browser, before: Buffer, after: Buffer, labels: [string, string]) {
  const page = await browser.newPage({ viewport: { width: 400, height: 300 } });
  const column = (label: string, image: Buffer) =>
    `<figure><figcaption>${label}</figcaption><img src="data:image/png;base64,${image.toString('base64')}"></figure>`;
  await page.setContent(`<style>
      body { margin: 0; background: #fff; display: flex; gap: 24px; padding: 16px; width: max-content; }
      figure { margin: 0; } figcaption { font: 600 16px system-ui, sans-serif; margin-bottom: 8px; color: #111; }
      img { display: block; border: 1px solid #ccc; }
    </style>${column(`Before: ${labels[0]}`, before)}${column(`After: ${labels[1]}`, after)}`);
  const image = await page.screenshot({ fullPage: true });
  await page.close();
  return image;
}

const base = args.base ? await checkout(args.base) : undefined;
const head = await startPreview({ port: 0, quiet: true });
const before = base ? await startPreview({ port: 0, quiet: true, web: base.web }) : undefined;
const browser = await launch();
const report: string[] = [];
try {
  for (const scenario of scenarios) {
    const shots: Partial<Record<'before' | 'after', Buffer>> = {};
    const sides = [
      ...(before ? [['before', before.url] as const] : []),
      ['after', head.url] as const,
    ];
    for (const [side, url] of sides) {
      const visit = await open(browser, url, scenario);
      const { image, missing } = await shoot(visit.page, scenario, side);
      await visit.close();
      shots[side] = image;
      await writeFile(join(out, `${scenario.name}-${side}.png`), image);
      for (const problem of visit.problems) console.warn(`${scenario.name} ${side}: ${problem}`);
      for (const number of missing)
        console.warn(`${scenario.name} ${side}: note ${number} found nothing at its selector`);
    }
    if (shots.before && shots.after)
      await writeFile(
        join(out, `${scenario.name}-compare.png`),
        await compare(browser, shots.before, shots.after, [base!.label, 'this checkout']),
      );
    report.push(
      `## ${scenario.name}`,
      '',
      ...(scenario.notes ?? []).map((note, i) => `${i + 1}. ${note.text}`),
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
