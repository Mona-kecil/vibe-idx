import { chromium } from 'playwright-core';
import type { Browser, Page } from 'playwright-core';

/** One page in a given state: where to go, the preview settings, and what to do there. */
export type Visit = {
  path: string;
  clock?: string;
  signedOut?: boolean;
  /** Stops the preview clock, so the same page renders the same pixels every time. */
  frozen?: boolean;
  size?: string;
  /** Tabs or buttons to press, by accessible name, in order. */
  click?: string[];
  /** Fields to type into, by accessible name; each gets Enter after its value. */
  fill?: [name: string, value: string][];
  /** For anything the names above can't reach. */
  steps?: (page: Page) => Promise<void>;
};

export const launch = () =>
  chromium.launch(
    process.env.HILLCLIMB_CHROME
      ? { executablePath: process.env.HILLCLIMB_CHROME }
      : { channel: 'chrome' },
  );

export function viewport(size = '1440x900') {
  const [width, height] = size.split('x').map(Number);
  if (!width || !height) throw new Error(`A size is WIDTHxHEIGHT, not ${size}.`);
  return { width, height };
}

/** Opens the visit's page and brings it to a settled state, collecting what went wrong on the way. */
export async function open(browser: Browser, base: string, visit: Visit) {
  const context = await browser.newContext({ viewport: viewport(visit.size) });
  await context.addCookies([
    { name: 'preview-clock', value: visit.clock ?? 'close', url: base },
    { name: 'preview-signed-out', value: visit.signedOut ? '1' : '0', url: base },
    { name: 'preview-frozen', value: visit.frozen ? '1' : '0', url: base },
  ]);
  const page = await context.newPage();
  const problems: string[] = [];
  const missing: string[] = [];
  /** 404s the preview sends on purpose, such as the order book before the close. */
  const held: string[] = [];
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
      problems.push(`failed: ${request.url().replace(base, '')} ${reason}`);
  });
  page.on('response', (response) => {
    const url = response.url().replace(base, '');
    if (response.status() === 404)
      (response.headers()['x-preview-held'] ? held : missing).push(url);
    else if (response.status() >= 400) problems.push(`HTTP ${response.status()}: ${url}`);
  });
  await page.goto(base + visit.path, { waitUntil: 'networkidle' });
  for (const name of visit.click ?? []) {
    await (await named(page, ['tab', 'button'], name)).click();
    await page.waitForLoadState('networkidle');
  }
  for (const [name, value] of visit.fill ?? []) {
    const field = await named(page, ['combobox', 'textbox'], name);
    await field.fill(value);
    await field.press('Enter');
    await page.waitForLoadState('networkidle');
  }
  await visit.steps?.(page);
  // An idle network can still leave the app decoding data, so also wait for its loading messages to go.
  await page
    .getByRole('status')
    .filter({ hasText: /^Loading/ })
    .first()
    .waitFor({ state: 'detached', timeout: 15000 })
    .catch(() => problems.push('still loading after 15s'));
  return { page, problems, missing, held, close: () => context.close() };
}

/** The first element with one of these roles and this exact accessible name, or an error naming the ones there are. */
async function named(
  page: Page,
  roles: ('tab' | 'button' | 'combobox' | 'textbox')[],
  name: string,
) {
  const [first, ...rest] = roles.map((role) => page.getByRole(role, { name, exact: true }));
  const match = rest.reduce((all, next) => all.or(next), first!).first();
  if (await match.count()) return match;
  const selectors = {
    tab: '[role=tab]',
    button: 'button, [role=button]',
    combobox: 'select, [role=combobox]',
    textbox: 'input:not([type]), input[type=text], input[type=search], textarea, [role=textbox]',
  };
  const names = await page
    .locator(roles.map((role) => selectors[role]).join(', '))
    .evaluateAll((elements) =>
      elements.flatMap((element) => {
        const label = (
          element.getAttribute('aria-label') ??
          (element.textContent?.trim() || element.getAttribute('placeholder')) ??
          ''
        ).trim();
        return label && label.length <= 40 ? [label] : [];
      }),
    );
  const unique = [...new Set(names)];
  throw new Error(
    `No ${roles.join(' or ')} named ${name}. On this page: ${unique.slice(0, 30).join(', ')}${unique.length > 30 ? `, and ${unique.length - 30} more` : ''}`,
  );
}

/** The panel or region with this accessible name, or the whole page. */
export async function scope(page: Page, name?: string) {
  if (!name) return page.locator('body');
  const area = page
    .getByRole('tabpanel', { name, exact: true })
    .or(page.getByRole('region', { name, exact: true }))
    .first();
  if (await area.count()) return area;
  const names = await page
    .locator('[role=tabpanel], [role=region], section[aria-label], section[aria-labelledby]')
    .evaluateAll((areas) =>
      areas.flatMap((area) => {
        const label =
          area.getAttribute('aria-label') ??
          document.getElementById(area.getAttribute('aria-labelledby') ?? '')?.textContent;
        return label ? [label.trim()] : [];
      }),
    );
  throw new Error(
    `No panel or region named ${name}. On this page: ${[...new Set(names)].join(', ')}`,
  );
}
