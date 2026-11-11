import type { Locator, Page } from 'playwright-core';

export const modes = ['grid', 'focus', 'flow'] as const;
type Mode = (typeof modes)[number];
const modeButton = { grid: '1GRID', focus: '2FOCUS', flow: '3FLOW' } as const;

/** Elements that must all be seen. `first` keeps only the leading rows of a ranked list. */
export type Target = Locator | { rows: Locator; first: number };

type Cost = { steps: number; hidden: string[] };

/**
 * Drives one terminal session and counts the steps a person would take.
 * A click, tab switch, mode switch or command is one step. Each screen of scrolling a pane needs
 * to bring every target into view is one step.
 */
export class Ui {
  steps = 0;
  log: string[] = [];
  constructor(readonly page: Page) {}

  pane(fn: string) {
    return this.page.getByRole('tabpanel', { name: fn, exact: true });
  }

  async settle() {
    await this.page.waitForLoadState('networkidle');
    await this.page
      .getByRole('status')
      .filter({ hasText: /^(Loading|Checking)/ })
      .first()
      .waitFor({ state: 'detached', timeout: 15000 })
      .catch(() => {});
    await this.page.evaluate(
      () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
    );
  }

  private step(what: string, count = 1) {
    this.steps += count;
    this.log.push(`${count} ${what}`);
  }

  private async mode(): Promise<Mode> {
    for (const mode of modes)
      if (
        (await this.page
          .getByRole('button', { name: modeButton[mode] })
          .getAttribute('aria-pressed')) === 'true'
      )
        return mode;
    throw new Error('No layout is pressed');
  }

  private async switchTo(mode: Mode) {
    await this.page.getByRole('button', { name: modeButton[mode] }).click();
    await this.settle();
  }

  private async shown(fn: string) {
    const panel = this.pane(fn);
    return (await panel.count()) > 0 && (await panel.isVisible());
  }

  /**
   * Brings a function's pane on screen by the cheapest route: already visible costs nothing, then a
   * tab in this mode, a mode where it is already showing, or the command bar, one step each.
   */
  async open(fn: string): Promise<Locator> {
    if (await this.shown(fn)) return this.pane(fn);
    const tab = this.page.getByRole('tab', { name: fn, exact: true });
    if ((await tab.count()) > 0) {
      await tab.click();
      await this.settle();
      this.step(`tab ${fn}`);
      return this.pane(fn);
    }
    const start = await this.mode();
    for (const mode of modes) {
      if (mode === start) continue;
      await this.switchTo(mode);
      if (await this.shown(fn)) {
        this.step(`mode ${mode} for ${fn}`);
        return this.pane(fn);
      }
    }
    await this.switchTo(start);
    const command = this.page.getByRole('combobox', { name: 'Command' });
    await command.fill(fn);
    await command.press('Enter');
    await this.settle();
    if (!(await this.shown(fn))) throw new Error(`${fn} did not open from the command bar`);
    this.step(`command ${fn}`);
    return this.pane(fn);
  }

  async click(target: Locator, what: string) {
    await target.click();
    await this.settle();
    this.step(`click ${what}`);
  }

  /** Presses a segmented-control option unless it is already pressed. */
  async press(panel: Locator, option: string) {
    const button = panel.getByRole('button', { name: option, exact: true });
    if ((await button.getAttribute('aria-pressed')) === 'true') return;
    await this.click(button, option);
  }

  async see(...targets: Target[]) {
    const elements: Locator[] = [];
    for (const target of targets) {
      const rows = 'rows' in target ? target.rows : target;
      const all = await rows.all();
      const kept = 'rows' in target ? all.slice(0, target.first) : all;
      if (kept.length === 0) throw new Error(`No element matches ${rows.toString()}`);
      elements.push(...kept);
    }
    const handles = await Promise.all(elements.map((e) => e.elementHandle()));
    const cost: Cost = await this.page.evaluate(scrollCost, handles);
    if (cost.hidden.length)
      throw new Error(`${cost.hidden.length} of ${handles.length} hidden, e.g. ${cost.hidden[0]}`);
    if (cost.steps) this.step(`scroll ${handles.length} targets`, cost.steps);
  }
}

/** Runs in the page. Counts the screens of scrolling, per scroll container and axis, that bring every element into view. */
function scrollCost(elements: (Element | null)[]): Cost {
  const scroller = (el: Element, axis: 'x' | 'y') => {
    for (let p = el.parentElement; p; p = p.parentElement) {
      const style = getComputedStyle(p);
      const overflow = axis === 'y' ? style.overflowY : style.overflowX;
      const room = axis === 'y' ? p.scrollHeight - p.clientHeight : p.scrollWidth - p.clientWidth;
      if ((overflow === 'auto' || overflow === 'scroll') && room > 1) return p;
    }
    return null;
  };
  const spans = {
    x: new Map<Element, [number, number]>(),
    y: new Map<Element, [number, number]>(),
  };
  const hidden: string[] = [];
  const label = (el: Element) => (el.textContent ?? el.tagName).trim().slice(0, 60);
  // A table row spans the table's width even when its text is short, so measure only its text and drawings.
  const extent = (el: Element) => {
    const parts: DOMRect[] = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    for (let node: Node | null = el; node; node = walker.nextNode()) {
      if (node instanceof Element && !['CANVAS', 'svg', 'IMG'].includes(node.tagName)) continue;
      if (node instanceof Text && !node.data.trim()) continue;
      const owner = node instanceof Element ? node : node.parentElement;
      if (!owner?.checkVisibility({ contentVisibilityAuto: true, visibilityProperty: true }))
        continue;
      if (node instanceof Text && owner.closest('svg')) continue;
      const range = document.createRange();
      range.selectNode(node);
      const rect =
        node instanceof Element ? node.getBoundingClientRect() : range.getBoundingClientRect();
      if (rect.width && rect.height) parts.push(rect);
    }
    if (!parts.length) return el.getBoundingClientRect();
    const left = Math.min(...parts.map((r) => r.left)),
      top = Math.min(...parts.map((r) => r.top));
    return new DOMRect(
      left,
      top,
      Math.max(...parts.map((r) => r.right)) - left,
      Math.max(...parts.map((r) => r.bottom)) - top,
    );
  };
  for (const el of elements) {
    if (!el) continue;
    const rect = extent(el);
    if (rect.width === 0 || rect.height === 0) {
      hidden.push(`${label(el)} has no size`);
      continue;
    }
    for (const axis of ['y', 'x'] as const) {
      const box = scroller(el, axis);
      if (!box) continue;
      const outer = box.getBoundingClientRect();
      const start =
        axis === 'y'
          ? rect.top - outer.top - box.clientTop + box.scrollTop
          : rect.left - outer.left - box.clientLeft + box.scrollLeft;
      const end = start + (axis === 'y' ? rect.height : rect.width);
      const [lo, hi] = spans[axis].get(box) ?? [start, end];
      spans[axis].set(box, [Math.min(lo, start), Math.max(hi, end)]);
    }
  }
  let steps = 0;
  for (const axis of ['y', 'x'] as const)
    for (const [box, [lo, hi]] of spans[axis]) {
      const size = axis === 'y' ? box.clientHeight : box.clientWidth;
      const at = axis === 'y' ? box.scrollTop : box.scrollLeft;
      steps +=
        Math.ceil(Math.max(0, at - lo - 1) / size) +
        Math.ceil(Math.max(0, hi - (at + size) - 1) / size);
    }
  for (const el of elements) {
    if (!el) continue;
    const rect = extent(el);
    // Where the element would sit once its scroll containers bring it into view.
    let { top, left, bottom, right } = rect;
    for (const axis of ['y', 'x'] as const) {
      const box = scroller(el, axis);
      if (!box) continue;
      const outer = box.getBoundingClientRect();
      const lo = axis === 'y' ? outer.top + box.clientTop : outer.left + box.clientLeft;
      const hi = lo + (axis === 'y' ? box.clientHeight : box.clientWidth);
      const [a, b] = axis === 'y' ? [top, bottom] : [left, right];
      const shift = a < lo ? a - lo : b > hi ? Math.min(b - hi, a - lo) : 0;
      if (axis === 'y') {
        top -= shift;
        bottom -= shift;
      } else {
        left -= shift;
        right -= shift;
      }
    }
    const height = bottom - top,
      width = right - left;
    top = Math.max(top, 0);
    left = Math.max(left, 0);
    bottom = Math.min(bottom, innerHeight);
    right = Math.min(right, innerWidth);
    for (let p = el.parentElement; p; p = p.parentElement) {
      const style = getComputedStyle(p);
      if (style.overflowX === 'visible' && style.overflowY === 'visible') continue;
      const clip = p.getBoundingClientRect();
      if (style.overflowY !== 'visible') {
        top = Math.max(top, clip.top);
        bottom = Math.min(bottom, clip.bottom);
      }
      if (style.overflowX !== 'visible') {
        left = Math.max(left, clip.left);
        right = Math.min(right, clip.right);
      }
    }
    const seen = Math.max(0, bottom - top) * Math.max(0, right - left);
    const full = Math.min(height, innerHeight) * Math.min(width, innerWidth);
    if (seen < 0.9 * full) hidden.push(`${label(el)} is clipped`);
  }
  return { steps, hidden };
}
