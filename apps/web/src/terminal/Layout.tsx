import { Fragment, useState, type ReactNode, type PointerEvent } from 'react';
import { z } from 'zod';
import { readStorage, writeStorage } from '../watchlist';
import type { FunctionId, Layout } from './state';
import './layout.css';

export type LayoutNode =
  | string
  | { direction: 'row' | 'col'; sizes: number[]; children: LayoutNode[] };
export const layouts: Record<Layout, { tree: LayoutNode; slots: Record<string, FunctionId[]> }> = {
  grid: {
    tree: {
      direction: 'row',
      sizes: [45, 55],
      children: [{ direction: 'col', sizes: [35, 65], children: ['a', 'c'] }, 'b'],
    },
    slots: {
      a: ['WL'],
      b: ['NEWS', 'CA', 'CAL'],
      c: ['SIG', 'MOV', 'HEAT', 'RISK'],
    },
  },
  focus: {
    tree: {
      direction: 'row',
      sizes: [60, 40],
      children: [{ direction: 'col', sizes: [65, 35], children: ['b', 'c'] }, 'f'],
    },
    slots: {
      b: ['GP', 'KEY'],
      c: ['DISC', 'NEWS'],
      f: ['HDS', 'CA'],
    },
  },
  flow: {
    tree: {
      direction: 'col',
      sizes: [24, 76],
      children: ['b', { direction: 'row', sizes: [38, 36, 26], children: ['d', 'e', 'c'] }],
    },
    slots: {
      b: ['GP', 'RT'],
      c: ['TB', 'OB'],
      d: ['BRK', 'BFL'],
      e: ['FF', 'DD'],
    },
  },
};
export function SplitLayout({
  node,
  path,
  pane,
}: {
  node: LayoutNode;
  path: string;
  pane: (slot: string) => ReactNode;
}) {
  const defaults = typeof node === 'string' ? [] : node.sizes;
  const [sizes, setSizes] = useState(() => {
    try {
      const saved = z
        .array(z.number().positive().finite())
        .parse(JSON.parse(readStorage(`terminal:split:${path}`) ?? 'null'));
      return saved.length === defaults.length ? saved : defaults;
    } catch {
      return defaults;
    }
  });
  if (typeof node === 'string') return pane(node);
  function save(next: number[]) {
    setSizes(next);
    writeStorage(`terminal:split:${path}`, JSON.stringify(next));
  }
  function resize(index: number, delta: number) {
    const a = sizes[index],
      b = sizes[index + 1];
    if (a === undefined || b === undefined) return;
    const next = [...sizes],
      pair = a + b;
    next[index] = Math.max(pair * 0.1, Math.min(pair * 0.9, a + delta));
    next[index + 1] = pair - next[index];
    save(next);
  }
  function start(event: PointerEvent<HTMLDivElement>, index: number) {
    const a = sizes[index],
      b = sizes[index + 1],
      box = event.currentTarget.parentElement;
    if (a === undefined || b === undefined || !box) return;
    const horizontal = typeof node !== 'string' && node.direction === 'row';
    const total = horizontal ? box.clientWidth : box.clientHeight;
    const origin = horizontal ? event.clientX : event.clientY;
    const weights = sizes.reduce((sum, value) => sum + value, 0);
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const move = (e: globalThis.PointerEvent) =>
      resize(index, (((horizontal ? e.clientX : e.clientY) - origin) / total) * weights);
    const end = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', end);
      handle.removeEventListener('pointercancel', end);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  }
  return (
    <div className={`box ${node.direction}`}>
      {node.children.map((child, index) => (
        <Fragment key={`${path}.${index}`}>
          {index > 0 && (
            <div
              className={`split ${node.direction}`}
              role="separator"
              tabIndex={0}
              aria-label="Resize panes"
              aria-orientation={node.direction === 'row' ? 'vertical' : 'horizontal'}
              aria-valuenow={Math.round(sizes[index - 1] ?? 0)}
              onPointerDown={(e) => start(e, index - 1)}
              onDoubleClick={() => save(defaults)}
              onKeyDown={(e) => {
                if (['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown'].includes(e.key)) {
                  e.preventDefault();
                  resize(index - 1, e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -2 : 2);
                }
                if (e.key === 'Home') save(defaults);
              }}
            />
          )}
          <div className="split-child" style={{ flex: `${sizes[index]} 1 0px` }}>
            <SplitLayout node={child} path={`${path}.${index}`} pane={pane} />
          </div>
        </Fragment>
      ))}
    </div>
  );
}
