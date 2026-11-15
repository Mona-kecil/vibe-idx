import { parseArgs } from 'node:util';
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
    click: { type: 'string', multiple: true, default: [] },
    fill: { type: 'string', multiple: true, default: [] },
  },
});
const usage = `pnpm ui:check [path] [--clock HH:MM] [--signed-out] [--size 1440x900] [--within name] [--shot file.png] [--urls] [--click name]... [--fill name=value]...

Opens the path in the local preview and prints errors, failed requests, 404s and the page's accessibility outline.
--click presses the tab or button with that name, and --fill types into the field with that name and presses Enter.
Clicks run first, then fills, in the order given. --within keeps the outline to the panel or region with that name.`;
const path = positionals.find((arg) => arg !== '--') ?? '/';
if (!path.startsWith('/')) throw new Error(usage);
const fill = args.fill.map((pair): [string, string] => {
  const at = pair.indexOf('=');
  if (at < 1) throw new Error(`--fill takes name=value.\n\n${usage}`);
  return [pair.slice(0, at), pair.slice(at + 1)];
});

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
  console.log(visit.problems.length ? visit.problems.join('\n') : 'no errors or failed requests');
  for (const url of visit.missing) console.log(`not found (404): ${url}`);
  console.log();
  const target = await scope(visit.page, args.within);
  const outline = await target.ariaSnapshot();
  // Link targets are long and rarely the point, so they stay out unless asked for.
  console.log(args.urls ? outline : outline.replace(/\n\s*- \/url: .*/g, ''));
  if (args.shot) {
    await target.screenshot({ path: args.shot });
    console.log(`\nscreenshot ${args.shot}`);
  }
  process.exitCode = visit.problems.length ? 1 : 0;
} finally {
  await browser.close();
  await preview.close();
}
