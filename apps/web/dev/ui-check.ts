import { parseArgs } from 'node:util';
import { chromium } from 'playwright-core';
import { startPreview } from './preview.js';

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

--click presses the tab or button with that name, and --fill types into the field with that name and presses Enter.\nClicks run first, then fills, in the order given. --within keeps the outline to the panel or region with that name.

Opens the path in the local preview and prints errors, failed requests and the page's accessibility outline.`;
const path = positionals.find((arg) => arg !== '--') ?? '/';
if (!path.startsWith('/')) throw new Error(usage);
const [width, height] = args.size.split('x').map(Number);
if (!width || !height) throw new Error(`--size takes WIDTHxHEIGHT.\n\n${usage}`);

const preview = await startPreview({ port: 0, quiet: true });
const browser = await chromium.launch(
  process.env.HILLCLIMB_CHROME
    ? { executablePath: process.env.HILLCLIMB_CHROME }
    : { channel: 'chrome' },
);
const problems: string[] = [];
const missing: string[] = [];
try {
  const context = await browser.newContext({ viewport: { width, height } });
  await context.addCookies([
    { name: 'preview-clock', value: args.clock, url: preview.url },
    { name: 'preview-signed-out', value: args['signed-out'] ? '1' : '0', url: preview.url },
  ]);
  const page = await context.newPage();
  page.on('console', (message) => {
    // Chrome logs every HTTP error too; the response handler below already reports those.
    if (message.type() === 'error' && !message.text().startsWith('Failed to load resource'))
      problems.push(`console: ${message.text()}`);
  });
  page.on('pageerror', (error) => problems.push(`page error: ${error.message}`));
  page.on('requestfailed', (request) => {
    // The app aborts requests it no longer needs, such as on unmount.
    const reason = request.failure()?.errorText;
    if (reason !== 'net::ERR_ABORTED')
      problems.push(`failed: ${request.url().replace(preview.url, '')} ${reason}`);
  });
  page.on('response', (response) => {
    if (response.status() === 404) missing.push(response.url().replace(preview.url, ''));
    else if (response.status() >= 400)
      problems.push(`HTTP ${response.status()}: ${response.url().replace(preview.url, '')}`);
  });
  await page.goto(preview.url + path, { waitUntil: 'networkidle' });
  for (const name of args.click) {
    await page
      .getByRole('tab', { name, exact: true })
      .or(page.getByRole('button', { name, exact: true }))
      .first()
      .click();
    await page.waitForLoadState('networkidle');
  }
  for (const pair of args.fill) {
    const [name, value] = pair.split('=');
    if (!name || value === undefined) throw new Error(`--fill takes name=value.\n\n${usage}`);
    const field = page
      .getByRole('combobox', { name, exact: true })
      .or(page.getByRole('textbox', { name, exact: true }))
      .first();
    await field.fill(value);
    await field.press('Enter');
    await page.waitForLoadState('networkidle');
  }
  // An idle network can still leave the app decoding data, so also wait for its loading messages to go.
  await page
    .getByRole('status')
    .filter({ hasText: /^Loading/ })
    .first()
    .waitFor({ state: 'detached', timeout: 15000 })
    .catch(() => problems.push('still loading after 15s'));
  const scope = args.within
    ? page
        .getByRole('tabpanel', { name: args.within, exact: true })
        .or(page.getByRole('region', { name: args.within, exact: true }))
        .first()
    : page.locator('body');
  console.log(
    `${path} at ${args.clock}, ${args['signed-out'] ? 'signed out' : 'signed in'}, ${width}x${height}, data as of ${preview.asOf}`,
  );
  console.log(problems.length ? problems.join('\n') : 'no errors or failed requests');
  for (const url of missing) console.log(`not found (404): ${url}`);
  console.log();
  const outline = await scope.ariaSnapshot();
  // Link targets are long and rarely the point, so they stay out unless asked for.
  console.log(args.urls ? outline : outline.replace(/\n\s*- \/url: .*/g, ''));
  if (args.shot) {
    await scope.screenshot({ path: args.shot });
    console.log(`\nscreenshot ${args.shot}`);
  }
} finally {
  await browser.close();
  await preview.close();
}
process.exitCode = problems.length ? 1 : 0;
