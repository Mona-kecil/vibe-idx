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
  /** For anything the names above can't reach: a Playwright page, after the clicks and fills. */
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
  /** Production responses that offline previews have no recording of. */
  const unrecorded: string[] = [];
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
    else if (response.headers()['x-preview-offline']) unrecorded.push(url);
    else if (response.status() >= 400) problems.push(`HTTP ${response.status()}: ${url}`);
  });
  // Pages that keep a request open, such as one polling for prices, never go idle, so idle is waited for only so long.
  const settle = () =>
    page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => undefined);
  await page.goto(base + visit.path, { waitUntil: 'load' });
  await settle();
  for (const name of visit.click ?? []) {
    await (await named(page, ['tab', 'button'], name)).click();
    await settle();
  }
  for (const [name, value] of visit.fill ?? []) {
    const field = await named(page, ['combobox', 'textbox'], name);
    await field.fill(value);
    await field.press('Enter');
    await settle();
  }
  await visit.steps?.(page);
  if (!(await settled(page))) problems.push('still loading after 15s');
  return { page, problems, missing, held, unrecorded, close: () => context.close() };
}

/** The first element with one of these roles and this exact accessible name, or an error naming the ones there are. */
async function named(
  page: Page,
  roles: ('tab' | 'button' | 'combobox' | 'textbox')[],
  name: string,
) {
  const [first, ...rest] = roles.map((role) => page.getByRole(role, { name, exact: true }));
  const match = rest.reduce((all, next) => all.or(next), first!).first();
  // A tab can appear a moment after the network goes idle, once the app has rendered its data.
  const found = await match
    .waitFor({ state: 'attached', timeout: 5000 })
    .then(() => true)
    .catch(() => false);
  if (found) return match;
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

/**
 * The panel or region with this accessible name, or the whole page. A pane's tab that isn't open is opened first,
 * as a click on it would.
 */
export async function scope(page: Page, name?: string) {
  if (!name) return page.locator('body');
  const area = page
    .getByRole('tabpanel', { name, exact: true })
    .or(page.getByRole('region', { name, exact: true }))
    .first();
  if (await area.count()) return area;
  const tab = page.getByRole('tab', { name, exact: true }).first();
  if (await tab.count()) {
    await tab.click();
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => undefined);
    await settled(page);
    if (await area.count()) return area;
  }
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

export type Box = { x: number; y: number; width: number; height: number };

/** Space kept around a panel's shot for note badges, which sit just outside the box they mark. */
const margin = 30;

/**
 * The area to shoot for a panel or region, with the content it frames: the panel and its tab strip. The area is the
 * content plus a fixed margin, so before and after shots of one panel come out the same size, and the margin is
 * blanked so neighbouring panes stay out of the shot. The whole window without a name.
 */
export async function shotArea(
  page: Page,
  within?: string,
): Promise<{ clip: Box; content: Box } | undefined> {
  if (!within) return undefined;
  const panel = await scope(page, within);
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
  const left = Math.min(...boxes.map((b) => b.x));
  const top = Math.min(...boxes.map((b) => b.y));
  const content = {
    x: left,
    y: top,
    width: Math.max(...boxes.map((b) => b.x + b.width)) - left,
    height: Math.max(...boxes.map((b) => b.y + b.height)) - top,
  };
  await panel.evaluate((element, box) => {
    // The nearest painted background behind the panel; the page's own is often transparent.
    let background = 'rgb(0, 0, 0)';
    for (let at: Element | null = element; at; at = at.parentElement) {
      const colour = getComputedStyle(at).backgroundColor;
      if (colour !== 'rgba(0, 0, 0, 0)' && colour !== 'transparent') {
        background = colour;
        break;
      }
    }
    const bands = [
      `left:0;top:0;right:0;height:${box.y}px`,
      `left:0;top:${box.y + box.height}px;right:0;bottom:0`,
      `left:0;top:${box.y}px;width:${box.x}px;height:${box.height}px`,
      `left:${box.x + box.width}px;top:${box.y}px;right:0;height:${box.height}px`,
    ];
    for (const band of bands) {
      const cover = document.createElement('div');
      cover.style.cssText = `position:fixed;${band};background:${background};z-index:2147483646;pointer-events:none`;
      document.body.append(cover);
    }
  }, content);
  const size = page.viewportSize()!;
  const x = Math.max(0, content.x - margin);
  const y = Math.max(0, content.y - margin);
  const clip = {
    x,
    y,
    width: Math.min(size.width, content.x + content.width + margin) - x,
    height: Math.min(size.height, content.y + content.height + margin) - y,
  };
  return { clip, content };
}

/** Hides the preview's own panel, which is not part of the app. */
export const hidePreviewPanel = (page: Page) =>
  page.locator('#preview-panel').evaluate((panel: HTMLElement) => (panel.hidden = true));

/** Waits for the app's loading messages to go, since an idle network can still leave it decoding data. */
const settled = (page: Page) =>
  page
    .getByRole('status')
    .filter({ hasText: /^Loading/ })
    .first()
    .waitFor({ state: 'detached', timeout: 15000 })
    .then(() => true)
    .catch(() => false);
