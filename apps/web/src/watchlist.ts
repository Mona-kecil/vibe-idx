import { useState } from 'react';
import { z } from 'zod';

export function readStorage(key: string) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
export function writeStorage(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* Storage may be blocked. */
  }
}
export function initialPins() {
  try {
    const saved = readStorage('vibe-idx:watchlist');
    if (saved !== null) return z.array(z.string()).parse(JSON.parse(saved));
    const legacy = z
      .object({ panels: z.array(z.object({ state: z.object({ ticker: z.string() }) })) })
      .safeParse(JSON.parse(readStorage('vibe-idx-workspace-v1') ?? 'null'));
    const pins = legacy.success ? [...new Set(legacy.data.panels.map((p) => p.state.ticker))] : [];
    writeStorage('vibe-idx:watchlist', JSON.stringify(pins));
    return pins;
  } catch {
    return [];
  }
}

export function usePins() {
  const [pins, setPins] = useState(initialPins);
  const toggle = (ticker: string) => {
    const next = pins.includes(ticker) ? pins.filter((t) => t !== ticker) : [...pins, ticker];
    setPins(next);
    writeStorage('vibe-idx:watchlist', JSON.stringify(next));
    return next.includes(ticker);
  };
  return [pins, toggle] as const;
}
