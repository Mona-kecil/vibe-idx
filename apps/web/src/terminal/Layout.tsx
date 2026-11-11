import { Fragment, useRef, useState, type ReactNode, type PointerEvent } from 'react';
import { z } from 'zod';
import { readStorage, writeStorage } from '../watchlist';
import type { FunctionId, Layout } from './state';
import './layout.css';

export type LayoutNode =
  | string
  | {
      direction: 'row' | 'col';
      sizes: number[];
      widths?: (number | null)[];
      children: LayoutNode[];
    };
export const layouts: Record<Layout, { tree: LayoutNode; slots: Record<string, FunctionId[]> }> = {
  grid: {
    tree: {
      direction: 'row',
      sizes: [45, 55],
      children: [{ direction: 'col', sizes: [35, 65], children: ['a', 'c'] }, 'b'],
    },
    slots: {
      a: ['WL'],
      b: ['NEWS', 'CA'],
      c: ['SIG', 'MOV'],
    },
  },
  focus: {
    tree: {
      direction: 'row',
      sizes: [64, 36],
      children: [{ direction: 'col', sizes: [50, 50], children: ['b', 'f'] }, 'c'],
    },
    slots: {
      b: ['GP'],
      c: ['FEED'],
      f: ['HDS'],
    },
  },
  flow: {
    tree: {
      direction: 'row',
      sizes: [52, 24, 24],
      widths: [null, 427, 398],
      children: [{ direction: 'col', sizes: [50, 50], children: ['b', 'e'] }, 'c', 'd'],
    },
    slots: {
      b: ['GP'],
      c: ['DD'],
      d: ['OB', 'RT'],
      e: ['FF', 'BRK', 'BFL', 'TB'],
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
  const boxRef = useRef<HTMLDivElement>(null);
  const defaults = typeof node === 'string' ? [] : node.sizes;
  const [sizes, setSizes] = useState(() => {
    try {
      const saved = z
        .array(z.number().positive().finite())
        .parse(JSON.parse(readStorage(`terminal:split:${path}`) ?? 'null'));
      return saved.length === defaults.length && saved.some((size, i) => size !== defaults[i])
        ? saved
        : defaults;
    } catch {
      return defaults;
    }
  });
  if (typeof node === 'string') return pane(node);
  function save(next: number[]) {
    setSizes(next);
    writeStorage(`terminal:split:${path}`, JSON.stringify(next));
  }
  function measuredSizes() {
    const box = boxRef.current;
    if (!box) return sizes;
    const children = [...box.querySelectorAll(':scope > .split-child')];
    const lengths = children.map((child) => {
      const rect = child.getBoundingClientRect();
      return typeof node !== 'string' && node.direction === 'row' ? rect.width : rect.height;
    });
    const total = lengths.reduce((sum, length) => sum + length, 0);
    return total ? lengths.map((length) => (length / total) * 100) : sizes;
  }
  function resize(index: number, delta: number, current = measuredSizes()) {
    const a = current[index],
      b = current[index + 1];
    if (a === undefined || b === undefined) return;
    const next = [...current],
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
    const current = measuredSizes();
    const weights = current.reduce((sum, value) => sum + value, 0);
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const move = (e: globalThis.PointerEvent) =>
      resize(index, (((horizontal ? e.clientX : e.clientY) - origin) / total) * weights, current);
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
    <div ref={boxRef} className={`box ${node.direction}`}>
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
          <div
            className="split-child"
            style={{
              flex:
                sizes === defaults && node.widths?.[index] != null
                  ? `0 1 ${node.widths[index]}px`
                  : `${sizes[index]} 1 0px`,
            }}
          >
            <SplitLayout node={child} path={`${path}.${index}`} pane={pane} />
          </div>
        </Fragment>
      ))}
    </div>
  );
}
