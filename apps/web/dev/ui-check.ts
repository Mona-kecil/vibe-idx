import { parseArgs } from 'node:util';
import { outsideRepo } from '../../pipeline/dev/checkout.js';
import { cliErrors } from '../../pipeline/dev/cli.js';
import { launch, open, scope } from './browser.js';
import { startPreview } from './preview.js';

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
  },
});
const usage = `pnpm ui:check [path] [--clock HH:MM] [--signed-out] [--size 1440x900] [--click name]... [--fill name=value]...
                [--within name] [--depth N] [--urls] [--shot file.png] [--strict]

Opens the path in the local preview and prints errors, failed requests, 404s and the page's accessibility outline.
Exits 1 on errors and failed requests, and with --strict on 404s too. A 404 the preview sends on purpose, such as
the order book before the close, is listed apart and never fails.
--click presses the tab or button with that name, and --fill types into the field with that name and presses Enter.
Clicks run first, then fills, in the order given. --within keeps the outline to the panel or region with that name,
and --depth N to its first N levels.`;
const path = positionals.find((arg) => arg !== '--') ?? '/';
if (!path.startsWith('/')) throw new Error(usage);
const fill = args.fill.map((pair): [string, string] => {
  const at = pair.indexOf('=');
  if (at < 1) throw new Error(`--fill takes name=value.\n\n${usage}`);
  return [pair.slice(0, at), pair.slice(at + 1)];
});

const shot = args.shot && outsideRepo(args.shot);
const depth = args.depth === undefined ? Infinity : Number(args.depth);
if (!(depth >= 1)) throw new Error(`--depth takes a number from 1.\n\n${usage}`);

const preview = await startPreview({ port: 0, quiet: true });
const browser = await launch();
try {
  const visit = await open(browser, preview.url, {
    path,
    clock: args.clock,
    signedOut: args['signed-out'],
    size: args.size,
    click: args.click,
    fill,
  });
  console.log(
    `${path} at ${args.clock}, ${args['signed-out'] ? 'signed out' : 'signed in'}, ${args.size}, data as of ${preview.asOf}`,
  );
  for (const url of visit.held) console.log(`held until the close, as in production: ${url}`);
  for (const url of visit.missing) console.log(`not found (404): ${url}`);
  console.log(
    visit.problems.length
      ? visit.problems.join('\n')
      : `no errors or failed requests${visit.missing.length ? ' besides the 404s above' : ''}`,
  );
  console.log();
  const target = await scope(visit.page, args.within);
  // Link targets are long and rarely the point, so they stay out unless asked for.
  const lines = (await target.ariaSnapshot())
    .split('\n')
    .filter((line) => args.urls || !/^\s*- \/url: /.test(line));
  const shown = lines.filter((line) => line.search(/\S/) / 2 < depth);
  console.log(shown.join('\n'));
  if (shown.length < lines.length)
    console.log(`  ${lines.length - shown.length} deeper lines hidden, raise --depth to see them`);
  if (shot) {
    await target.screenshot({ path: shot });
    console.log(`\nscreenshot ${shot}`);
  }
  process.exitCode = visit.problems.length || (args.strict && visit.missing.length) ? 1 : 0;
} finally {
  await browser.close();
  await preview.close();
}
