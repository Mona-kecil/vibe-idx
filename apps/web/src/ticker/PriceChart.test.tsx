// @vitest-environment happy-dom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { PriceChart } from './PriceChart';
import type { ChartMark, Period, Price, Selection } from './logic';

type Call = { path: string; args: unknown[] };
// happy-dom has no canvas, so the chart is a recording stand-in. Every call is logged under its
// path, such as "timeScale().setVisibleLogicalRange", and each series is named by type and pane.
const recorder = vi.hoisted(() => {
  const calls: Call[] = [];
  const returns: Record<string, (...args: unknown[]) => unknown> = {
    addSeries: (definition, _options, pane) =>
      node(`series:${(definition as { type: string }).type}@${String(pane)}`),
    panes: () => [0, 1, 2, 3].map((i) => node(`pane${i}`)),
    'timeScale().width': () => 1000,
    'timeScale().coordinateToLogical': (x) => (x as number) / 10,
    'timeScale().logicalToCoordinate': (i) => (i as number) * 10,
    'timeScale().getVisibleLogicalRange': () => null,
  };
  function node(path: string): object {
    return new Proxy(function () {}, {
      get: (_, key) =>
        key === 'then'
          ? undefined
          : key === Symbol.toPrimitive
            ? () => 0
            : typeof key === 'symbol'
              ? undefined
              : node(path ? `${path}.${key}` : key),
      apply: (_, __, args: unknown[]) => {
        calls.push({ path, args });
        const handler = returns[path];
        return handler ? handler(...args) : node(`${path}()`);
      },
    });
  }
  return { calls, chart: node('') };
});
vi.mock('lightweight-charts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('lightweight-charts')>()),
  createSeriesMarkers: (...args: unknown[]) =>
    (recorder.chart as { markers: (...a: unknown[]) => unknown }).markers(...args),
}));
vi.mock('../terminal/charts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../terminal/charts')>()),
  publicChart: () => recorder.chart,
}));

const calls = (path: string) => recorder.calls.filter((call) => call.path === path);
const lastArg = (path: string) => calls(path).at(-1)?.args[0];
const seriesData = (name: string) => lastArg(`series:${name}.setData`) as Record<string, unknown>[];
const lastRange = () =>
  lastArg('timeScale().setVisibleLogicalRange') as { from: number; to: number };
const emit = (path: string, event: unknown) =>
  act(async () => (lastArg(path) as (event: unknown) => void)(event));

const day = (i: number) => new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);
const prices = (count: number, patch: (i: number) => Partial<Price> = () => ({})): Price[] =>
  Array.from({ length: count }, (_, i) => ({
    date: day(i),
    open: 99 + i,
    high: 101 + i,
    low: 98 + i,
    close: 100 + i,
    volume: 1000 + i,
    value: (1000 + i) * 100,
    net_foreign: (i % 2 ? 1 : -1) * (i + 1) * 1_000_000,
    ...patch(i),
  }));

let host: HTMLDivElement, root: Root;
const selected = vi.fn<(selection: Selection) => void>();
function Harness({ data, marks }: { data: Price[]; marks?: ChartMark[] }) {
  const [period, setPeriod] = useState<Period>('3M');
  const [selection, select] = useState<Selection>(null);
  return (
    <PriceChart
      ticker="TEST"
      prices={data}
      period={period}
      setPeriod={setPeriod}
      selection={selection}
      marks={marks}
      select={(next) => {
        selected(next);
        select(next);
      }}
    >
      <div id="below" />
    </PriceChart>
  );
}
const settle = () =>
  act(async () => void (await new Promise((resolve) => setTimeout(resolve, 40))));
async function mount(data = prices(300), marks?: ChartMark[]) {
  await act(async () => root.render(<Harness data={data} marks={marks} />));
  await settle();
}
const element = (selector: string) => {
  const found = host.querySelector(selector);
  if (!found) throw new Error(`Missing ${selector}`);
  return found;
};
const click = (selector: string) =>
  act(async () => (element(selector) as HTMLButtonElement).click());
const pointer = (target: Element, type: string, init: PointerEventInit) =>
  act(async () => {
    target.dispatchEvent(
      new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, pointerId: 1, ...init }),
    );
  });

beforeEach(() => {
  recorder.calls.length = 0;
  selected.mockClear();
  window.localStorage.clear();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  HTMLElement.prototype.setPointerCapture = () => {};
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('ticker price chart', () => {
  it('stacks price, volume, net foreign and cumulative foreign panes in that order', async () => {
    await mount();
    expect(calls('addSeries').map((c) => (c.args[0] as { type: string }).type)).toEqual([
      'Candlestick',
      'Histogram',
      'Histogram',
      'Baseline',
    ]);
    expect(calls('addSeries').map((c) => c.args[2])).toEqual([0, 1, 2, 3]);
  });

  it('sets the visible range from the period buttons and keeps the whole history loaded', async () => {
    await mount();
    expect(seriesData('Candlestick@0')).toHaveLength(300);
    expect(lastRange().from).toBe(206.5);
    const from = { '1M': 268.5, '6M': 115.5, YTD: -0.5, '3M': 206.5 };
    for (const [period, expected] of Object.entries(from)) {
      await click(`[data-range="${period}"]`);
      expect(lastRange().from).toBe(expected);
      expect(lastRange().to).toBeGreaterThan(299);
      expect(element(`[data-range="${period}"]`).getAttribute('aria-pressed')).toBe('true');
    }
    expect(seriesData('Candlestick@0')).toHaveLength(300);
  });

  it('draws candles by default and remembers the Line choice', async () => {
    await mount();
    expect(calls('addSeries').map((c) => (c.args[0] as { type: string }).type)[0]).toBe(
      'Candlestick',
    );
    expect(element('[data-type="candles"]').getAttribute('aria-pressed')).toBe('true');
    await click('[data-type="line"]');
    expect(seriesData('Area@0')).toHaveLength(300);
    expect(window.localStorage.getItem('ticker:chart:type')).toBe('line');
    await act(async () => root.unmount());
    recorder.calls.length = 0;
    root = createRoot(host);
    await mount();
    expect(calls('addSeries').map((c) => (c.args[0] as { type: string }).type)[0]).toBe('Area');
    expect(element('[data-type="line"]').getAttribute('aria-pressed')).toBe('true');
  });

  it('shows the readout only while the crosshair tracks a bar', async () => {
    await mount();
    expect(host.querySelector('.readout')).toBeNull();
    await emit('subscribeCrosshairMove', { time: '2026-01-03' });
    const readout = element('.readout').textContent;
    expect(element('.readout-date').textContent).toBe('3 Jan 2026');
    expect(element('.readout-change').textContent).toBe('+1 (+0.99%)');
    for (const part of ['O101', 'H103', 'L100', 'C102', 'Net foreign−3.0M'])
      expect(readout).toContain(part);
    await emit('subscribeCrosshairMove', {});
    expect(host.querySelector('.readout')).toBeNull();
  });

  it('colours the line by the visible window and keeps candles behind the toggle on phones', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('max-width: 900px'),
      addEventListener() {},
      removeEventListener() {},
    }));
    await mount();
    expect(calls('addSeries').map((c) => (c.args[0] as { type: string }).type)).toEqual([
      'Area',
      'Histogram',
      'Histogram',
    ]);
    expect(lastArg('series:Area@0.applyOptions')).toMatchObject({ lineColor: '#167049' });
    await emit('timeScale().subscribeVisibleLogicalRangeChange', { from: 10, to: 20.4 });
    expect(element('[data-range][aria-pressed="true"]').getAttribute('title')).toMatch(/\+9\.09%$/);
    expect(host.querySelector('.period-change')).toBeNull();
    await click('.pane-toggle');
    expect(element('.pane-toggle').getAttribute('aria-pressed')).toBe('true');
    expect(seriesData('Baseline@3')?.length).toBeGreaterThan(0);
  });

  it('flags bars with missing OHLC as estimated and draws them flat', async () => {
    await mount(
      prices(4, (i) => (i === 2 ? { open: null, high: null, low: null, close: 150 } : {})),
    );
    const bar = seriesData('Candlestick@0')[2];
    expect([bar?.open, bar?.high, bar?.low, bar?.close]).toEqual([150, 150, 150, 150]);
    expect(bar?.color).toBe('#a3a49b');
    expect(seriesData('Candlestick@0')[1]?.color).toBe('#167049');
    await emit('subscribeCrosshairMove', { time: '2026-01-03' });
    expect(element('.readout-status').textContent).toBe('Est.');
  });

  it('rebases cumulative foreign to the first visible bar as the range moves', async () => {
    await mount();
    const initial = seriesData('Baseline@3');
    expect(initial).toHaveLength(93);
    expect([initial[0]?.time, initial[0]?.value, initial[1]?.value]).toEqual([
      '2026-07-27',
      208_000_000,
      -1_000_000,
    ]);
    await emit('timeScale().subscribeVisibleLogicalRangeChange', { from: 10, to: 20.4 });
    const panned = seriesData('Baseline@3');
    expect(panned.map((point) => point.value)).toEqual(
      [-11, 1, -12, 2, -13, 3, -14, 4, -15, 5, -16].map((million) => million * 1e6),
    );
    expect(panned[0]?.time).toBe('2026-01-11');
    expect(element('[data-range][aria-pressed="true"]').getAttribute('title')).toMatch(/\+9\.09%$/);
    expect(host.querySelector('.period-change')).toBeNull();
  });
});

describe('ticker chart event marks', () => {
  it('draws filings, ownership changes and actions as markers and selects a tapped day', async () => {
    await mount(prices(300), [
      { date: day(250), kind: 'filing', label: 'Annual report' },
      { date: day(260), kind: 'ownership', label: 'Holder' },
      { date: day(270), kind: 'action', label: 'Ex-div' },
    ]);
    expect(calls('markers').at(-1)?.args[1]).toEqual([
      expect.objectContaining({ time: day(250), shape: 'circle', position: 'belowBar' }),
      expect.objectContaining({ time: day(260), shape: 'circle', position: 'aboveBar' }),
      expect.objectContaining({ time: day(270), shape: 'arrowUp', position: 'belowBar' }),
    ]);
    await emit('subscribeClick', { hoveredObjectId: day(260) });
    expect(selected).toHaveBeenLastCalledWith({ anchor: day(260), end: day(260) });
  });
});

describe('ticker chart range selection', () => {
  const drag = async (from: number, to: number) => {
    const axis = element('.chart-axis');
    await pointer(axis, 'pointerdown', { clientX: from, pointerType: 'touch' });
    await pointer(axis, 'pointermove', { clientX: to, pointerType: 'touch' });
    await pointer(axis, 'pointerup', { clientX: to, pointerType: 'touch' });
  };

  it('selects the bars under a drag along the time axis and marks them with a band', async () => {
    await mount();
    await drag(20, 50);
    expect(selected).toHaveBeenLastCalledWith({ anchor: '2026-01-03', end: '2026-01-06' });
    expect(element('.chart-selection').textContent).toContain('3–6 Jan');
    expect(element('.chart-selection').textContent).toContain('4 trading days');
    const band = element('.selection-band') as HTMLElement;
    expect([band.style.left, band.style.width]).toEqual(['15px', '40px']);
    const count = selected.mock.calls.length;
    await pointer(element('.chart-axis'), 'pointermove', { clientX: 90, pointerType: 'touch' });
    expect(selected).toHaveBeenCalledTimes(count);
  });

  it('leaves a plain drag on the plot to the chart and selects only with shift held', async () => {
    await mount();
    const plot = element('.chart-host');
    await pointer(plot, 'pointerdown', { clientX: 20, pointerType: 'mouse' });
    await pointer(plot, 'pointermove', { clientX: 50, pointerType: 'mouse' });
    expect(selected).not.toHaveBeenCalled();
    await pointer(plot, 'pointerup', { clientX: 50, pointerType: 'mouse' });
    await pointer(plot, 'pointerdown', { clientX: 20, pointerType: 'mouse', shiftKey: true });
    await pointer(plot, 'pointermove', { clientX: 50, pointerType: 'mouse', shiftKey: true });
    expect(selected).toHaveBeenLastCalledWith({ anchor: '2026-01-03', end: '2026-01-06' });
  });

  it('clears the selection and its band with Escape', async () => {
    await mount();
    await drag(20, 50);
    expect(host.querySelector('.selection-band')).not.toBeNull();
    await act(async () =>
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
    );
    expect(selected).toHaveBeenLastCalledWith(null);
    expect(host.querySelector('.selection-band')).toBeNull();
    expect(element('.chart-selection').textContent).toBe('');
  });

  it('shows a clear button in the sticky bar once the chart has scrolled out of view', async () => {
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect');
    rect.mockReturnValue({ left: 0, bottom: 500 } as DOMRect);
    await mount();
    await drag(20, 50);
    const sticky = element('#selection-sticky') as HTMLElement;
    expect(sticky.hidden).toBe(true);
    rect.mockReturnValue({ left: 0, bottom: -10 } as DOMRect);
    await act(async () => window.dispatchEvent(new Event('scroll')));
    expect(sticky.hidden).toBe(false);
    await click('#selection-sticky button');
    expect(selected).toHaveBeenLastCalledWith(null);
    expect(sticky.hidden).toBe(true);
  });
});
