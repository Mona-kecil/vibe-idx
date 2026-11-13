// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vite-plus/test';
import { CommandBar, commandSuggestions } from './CommandBar';
import { functions } from './state';

const togglePin = vi.fn<(ticker: string) => void>();
const setTicker = vi.fn<(ticker: string) => void>();
vi.mock('./state', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./state')>()),
  useTerminal: () => ({
    data: { stocks: tickers },
    pins: ['MARK'],
    ticker: 'BBCA',
    togglePin,
    setTicker,
    filter: vi.fn<() => void>(),
  }),
}));

// Real names and 9 Nov traded values for the codes that used to lose to another row.
const tickers = [
  { ticker: 'BBCA', name: 'PT Bank Central Asia Tbk.', value: 598398085000 },
  { ticker: 'MARK', name: 'PT Mark Dynamics Indonesia Tbk.', value: 6010663500 },
  { ticker: 'LIVE', name: 'PT Homeco Victoria Makmur Tbk', value: 158687900 },
  { ticker: 'BANK', name: 'PT Bank Aladin Syariah Tbk', value: 113400600 },
  { ticker: 'NICE', name: 'PT Adhi Kartiko Pratama Tbk', value: 62368600 },
  { ticker: 'CASA', name: 'PT Capital Financial Indonesia Tbk', value: 61874500 },
  { ticker: 'ADHI', name: 'PT Adhi Karya (Persero) Tbk.', value: 0 },
];

describe('command ranking', () => {
  it('puts each exact ticker code ahead of functions, prefixes and company name matches', () => {
    for (const stock of tickers) {
      expect(commandSuggestions(tickers, stock.ticker)[0]?.code).toBe(stock.ticker);
    }
    expect(commandSuggestions(tickers, 'CA')[0]).toEqual({
      code: 'CA',
      label: 'Corporate actions',
    });
    expect(commandSuggestions(tickers, 'LIVE')[0]?.code).toBe('LIVE');
  });
  it('keeps code prefixes before name words and traded value order within each tier', () => {
    const stocks = [
      { ticker: 'OTHER', name: 'ABC Industries', value: 300 },
      { ticker: 'ABCZ', name: 'Low value', value: 100 },
      { ticker: 'ABCA', name: 'High value', value: 200 },
    ];
    expect(commandSuggestions(stocks, 'ABC').map((item) => item.code)).toEqual([
      'ABCA',
      'ABCZ',
      'OTHER',
    ]);
  });
});

it('keeps every shortcut and function in help and restores focus on close', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => {
      root.render(
        <CommandBar
          mode="grid"
          setMode={vi.fn<() => void>()}
          openFunction={vi.fn<() => void>()}
          maximize={vi.fn<() => void>()}
        />,
      );
    });
    const help = host.querySelector<HTMLButtonElement>('[aria-label="Keyboard reference"]');
    await act(async () => help?.click());
    const dialog = host.querySelector('[role="dialog"]');
    expect(dialog?.getAttribute('aria-label')).toBe('Keyboard reference');
    const keys = dialog?.querySelector('[aria-labelledby="terminal-help-keys"]');
    expect(keys?.querySelectorAll('dt')).toHaveLength(11);
    expect(keys?.textContent).toContain('BREN PIN');
    expect(keys?.textContent).toContain('Shift-drag chart');
    const reference = dialog?.querySelector('[aria-labelledby="terminal-help-functions"]');
    expect(Array.from(reference?.querySelectorAll('dt') ?? [], (item) => item.textContent)).toEqual(
      Object.keys(functions),
    );
    expect(Array.from(reference?.querySelectorAll('dd') ?? [], (item) => item.textContent)).toEqual(
      Object.values(functions),
    );
    const close = dialog?.querySelector<HTMLButtonElement>(
      '[aria-label="Close keyboard reference"]',
    );
    await act(async () => close?.click());
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(help);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});

it('pins the named or current ticker from the command line and from a suggestion', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const input = () => host.querySelector<HTMLInputElement>('[aria-label="Command"]')!;
  async function type(text: string) {
    await act(async () => {
      input().focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
        input(),
        text,
      );
      input().dispatchEvent(new Event('input', { bubbles: true }));
    });
  }
  async function enter() {
    await act(async () => {
      input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
  }
  try {
    await act(async () => {
      root.render(
        <CommandBar
          mode="grid"
          setMode={vi.fn<() => void>()}
          openFunction={vi.fn<() => void>()}
          maximize={vi.fn<() => void>()}
        />,
      );
    });
    togglePin.mockClear();
    await type('NICE PIN');
    await enter();
    expect(togglePin.mock.calls).toEqual([['NICE']]);
    expect(setTicker).toHaveBeenCalledWith('NICE');
    expect(host.querySelector('[role="alert"]')).toBeNull();

    togglePin.mockClear();
    await type('PIN');
    await enter();
    expect(togglePin.mock.calls).toEqual([['BBCA']]);

    togglePin.mockClear();
    setTicker.mockClear();
    await type('MAR');
    const star = host.querySelector<HTMLButtonElement>('[role="option"] [aria-label="Unpin MARK"]');
    expect(star?.getAttribute('aria-pressed')).toBe('true');
    await act(async () => {
      star?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    });
    expect(togglePin.mock.calls).toEqual([['MARK']]);
    expect(setTicker).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
