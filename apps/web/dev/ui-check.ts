import { parseArgs } from 'node:util';
import { outsideRepo } from '../../pipeline/dev/checkout.js';
import { cliErrors } from '../../pipeline/dev/cli.js';
import { hidePreviewPanel, launch, open, scope, shotArea } from './browser.js';
import { recordHelp, startPreview } from './preview.js';

cliErrors();
const { values: args, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    clock: { type: 'string', default: 'close' },
    'signed-out': { type: 'boolean', default: false },
    size: { type: 'string', default: '1440x900' },
    within: { type: 'string' },
    shot: { type: 'string' },
    urls: { type: 'boolean', default: false },
    depth: { type: 'string' },
    strict: { type: 'boolean', default: false },
    click: { type: 'string', multiple: true, default: [] },
    fill: { type: 'string', multiple: true, default: [] },
    record: { type: 'boolean', default: false },
    lines: { type: 'string', default: '200' },
    json: { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  },
});
const usage = `pnpm ui:check [path] [options]

Opens a page of the app in the local preview, on the fixtures, and prints console errors, failed requests, 404s and
the page's accessibility outline. Exits 1 on errors and failed requests, and with --strict on 404s too. A 404 the
preview sends on purpose, such as the order book before the close, is listed apart and never fails.

path            / by default. The terminal is /terminal?t=<TICKER>&l=<grid|focus|flow>; others include /market.
--clock HH:MM   a time in the as-of session, or close (the default). During the session broker data, daily
                prices and the tick panes end the session before, as in production: the session's running trade
                and order book are published after the close.
--signed-out    the site as a visitor sees it
--size WxH      the window, 1440x900 by default
--click NAME    presses the tab or button with that accessible name; repeat for more, in order
--fill NAME=V   types V into the field with that accessible name and presses Enter; runs after the clicks.
                The terminal's command bar is Command: --fill Command=TLKM switches ticker
--within NAME   keeps the outline to the panel or region with that name, such as a terminal pane's tab;
                a tab that isn't open is opened, before any --click
--depth N       keeps the outline to its first N levels; 0 leaves it out, to check only errors and requests
--lines N       prints at most N outline lines, 200 by default
--urls          keeps link targets in the outline
--shot FILE     saves a screenshot outside the repository: the --within panel with its tabs, or the window
--strict        fails on 404s too
--json          prints the result as JSON on stdout: the URL reached, problems, requests and outline
${recordHelp}`;
if (args.help) {
  console.log(usage);
  process.exit(0);
}
const path = positionals.find((arg) => arg !== '--') ?? '/';
if (!path.startsWith('/')) throw new Error(usage);
const fill = args.fill.map((pair): [string, string] => {
  const at = pair.indexOf('=');
  if (at < 1) throw new Error(`--fill takes name=value.\n\n${usage}`);
  return [pair.slice(0, at), pair.slice(at + 1)];
});

const shot = args.shot && outsideRepo(args.shot);
const depth = args.depth === undefined ? Infinity : Number(args.depth);
if (!(depth >= 0)) throw new Error(`--depth takes a number from 0.\n\n${usage}`);
const maxLines = Number(args.lines);
if (!(maxLines >= 1)) throw new Error(`--lines takes a number from 1.\n\n${usage}`);

const preview = await startPreview({ port: 0, quiet: true, record: args.record });
const browser = await launch();
try {
  const visit = await open(browser, preview.url, {
    path,
    clock: args.clock,
    signedOut: args['signed-out'],
    size: args.size,
    within: args.within,
    click: args.click,
    fill,
  });
  const target = await scope(visit.page, args.within);
  // Clicks and fills can move the page, such as a ticker typed into the command bar.
  const landed = visit.page.url().replace(preview.url, '');
  // Link targets are long and rarely the point, so they stay out unless asked for.
  const lines = depth
    ? (await target.ariaSnapshot())
        .split('\n')
        .filter((line) => args.urls || !/^\s*- \/url: /.test(line))
    : [];
  const deep = lines.filter((line) => line.search(/\S/) / 2 < depth);
  const outline = deep.slice(0, maxLines);
  if (shot) {
    await hidePreviewPanel(visit.page);
    const area = await shotArea(visit.page, args.within);
    await visit.page.screenshot({
      path: shot,
      animations: 'disabled',
      ...(area && { clip: area.clip }),
    });
  }
  const unique = (list: string[]) => [...new Set(list)];
  if (args.json)
    console.log(
      JSON.stringify(
        {
          path,
          url: landed,
          clock: args.clock,
          signedIn: !args['signed-out'],
          asOf: preview.asOf,
          problems: visit.problems,
          missing: unique(visit.missing),
          held: unique(visit.held),
          unrecorded: unique(visit.unrecorded),
          fetched: unique(preview.fetched),
          outline,
          ...(shot && { shot }),
        },
        null,
        2,
      ),
    );
  else {
    console.log(
      `${landed} at ${args.clock}, ${args['signed-out'] ? 'signed out' : 'signed in'}, ${args.size}, data as of ${preview.asOf}${landed === path ? '' : `, opened as ${path}`}`,
    );
    for (const url of unique(visit.held))
      console.log(`held until the close, as in production: ${url}`);
    for (const url of unique(visit.missing)) console.log(`not found (404): ${url}`);
    for (const url of unique(visit.unrecorded))
      console.log(`not recorded yet, --record fetches it: ${url}`);
    console.log(
      preview.fetched.length
        ? `fetched from production and recorded: ${unique(preview.fetched).join(', ')}`
        : 'nothing fetched from production',
    );
    console.log(
      visit.problems.length
        ? visit.problems.join('\n')
        : `no errors or failed requests${visit.missing.length ? ' besides the 404s above' : ''}`,
    );
    if (outline.length) console.log(`\n${outline.join('\n')}`);
    if (deep.length < lines.length)
      console.log(`  ${lines.length - deep.length} deeper lines hidden, raise --depth to see them`);
    if (outline.length < deep.length)
      console.log(`  ${deep.length - outline.length} more lines, --lines N shows more`);
    if (shot) console.log(`\nscreenshot ${shot}`);
  }
  process.exitCode = visit.problems.length || (args.strict && visit.missing.length) ? 1 : 0;
} finally {
  await browser.close();
  await preview.close();
}
