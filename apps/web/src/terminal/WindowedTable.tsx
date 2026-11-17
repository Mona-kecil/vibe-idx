import { useLayoutEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';

/** Uniform-height trade rows. Keep the focused row mounted when the pointer scrolls away. */
export function WindowedTable({
  reset,
  count,
  target,
  className,
  header,
  row,
  children,
}: {
  reset: string;
  count: number;
  target?: number;
  className: string;
  header: ReactNode;
  row: (index: number) => ReactElement;
  children?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ reset, top: 0, height: 300, row: 22, header: 22 });
  const [focused, setFocused] = useState<number | null>(null);
  const pending = useRef<number | null>(null);
  const previousReset = useRef(reset);
  const current = viewport.reset === reset ? viewport : { ...viewport, top: 0 };
  const start = Math.min(
    Math.max(0, count - 1),
    Math.max(0, Math.floor((current.top - current.header) / current.row) - 6),
  );
  const end = Math.min(count, Math.ceil((current.top + current.height) / current.row) + 6);
  const indices = Array.from({ length: Math.max(0, end - start) }, (_, i) => start + i);
  if (focused !== null && focused < count && !indices.includes(focused)) indices.push(focused);
  indices.sort((a, b) => a - b);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => {
      const rowHeight =
        element.querySelector('tr[data-rowindex]')?.getBoundingClientRect().height || 22;
      const headerHeight = element.querySelector('thead')?.getBoundingClientRect().height || 22;
      setViewport((previous) => {
        const next = {
          reset,
          top: element.scrollTop,
          height: element.clientHeight || 300,
          row: rowHeight,
          header: headerHeight,
        };
        return Object.keys(next).every(
          (key) => Reflect.get(previous, key) === Reflect.get(next, key),
        )
          ? previous
          : next;
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [reset]);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (previousReset.current !== reset) element.scrollTop = 0;
    if (target !== undefined) element.scrollTop = target * current.row;
    previousReset.current = reset;
    setViewport((previous) => ({ ...previous, reset, top: element.scrollTop }));
    setFocused(null);
  }, [reset, target, current.row]);
  useLayoutEffect(() => {
    if (pending.current === null) return;
    ref.current
      ?.querySelector<HTMLButtonElement>(`tr[data-rowindex="${pending.current}"] button`)
      ?.focus({ preventScroll: true });
    pending.current = null;
  });
  const spacer = (from: number, to: number) =>
    to > from && (
      <tr key={`space-${from}`} aria-hidden="true" className="tick-spacer">
        <td colSpan={8} style={{ height: (to - from) * current.row, padding: 0, border: 0 }} />
      </tr>
    );
  return (
    <div
      ref={ref}
      className="pb"
      onScroll={(event) => {
        const top = event.currentTarget.scrollTop;
        setViewport((previous) => (previous.top === top ? previous : { ...previous, reset, top }));
      }}
      onFocusCapture={(event) => {
        const index = event.target.closest('tr')?.getAttribute('data-rowindex');
        if (index !== null && index !== undefined) setFocused(Number(index));
      }}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(null);
      }}
      onKeyDownCapture={(event) => {
        if (event.key !== 'Tab' || !(event.target instanceof HTMLButtonElement)) return;
        const value = event.target.closest('tr')?.getAttribute('data-rowindex');
        if (value === null || value === undefined) return;
        const next = Number(value) + (event.shiftKey ? -1 : 1);
        if (next < 0 || next >= count) return;
        event.preventDefault();
        pending.current = next;
        const element = event.currentTarget;
        const top = (next + 1) * current.row;
        if (
          top < element.scrollTop + current.header ||
          top + current.row > element.scrollTop + element.clientHeight
        )
          element.scrollTop = next * current.row;
        setFocused(next);
        setViewport((previous) => ({ ...previous, reset, top: element.scrollTop }));
      }}
    >
      <table className={className} aria-rowcount={count + 1}>
        {header}
        <tbody>
          {indices.flatMap((index, position) => [
            spacer((indices[position - 1] ?? -1) + 1, index),
            row(index),
          ])}
          {spacer((indices.at(-1) ?? -1) + 1, count)}
        </tbody>
      </table>
      {children}
    </div>
  );
}
