import { useLayoutEffect, useRef, useState } from 'react';
import {
  distributionLayout,
  others,
  type BrokerType,
  type Distribution,
} from './broker-distribution.js';

type Focus = { side: 'buyer' | 'seller'; code: string };
const bar = 6;

export function DistributionChart({
  data,
  types,
  format,
  unit,
}: {
  data: Distribution;
  types: Map<string, BrokerType>;
  format: (amount: number) => string;
  unit: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const element = host.current;
    if (!element) return;
    const measure = () => setSize({ width: element.clientWidth, height: element.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const top = data.buyers[0];
  const [picked, setPicked] = useState<Focus | null>(null);
  const focus =
    picked &&
    (picked.side === 'buyer' ? data.buyers : data.sellers).some((n) => n.code === picked.code)
      ? picked
      : top && { side: 'buyer' as const, code: top.code };
  const { width, height } = size;
  const view = width > 0 && height > 0 ? distributionLayout(data, height) : null;
  const type = (code: string) => (code === others ? 'unknown' : (types.get(code) ?? 'unknown'));
  const x0 = bar,
    x1 = width - bar,
    mid = width / 2;
  const lit = (band: { buyer: string; seller: string }) =>
    focus !== null && focus !== undefined && band[focus.side] === focus.code;
  const node = (side: 'buyer' | 'seller', code: string, amount: number, y: number, h: number) => {
    const left = side === 'buyer';
    const on = focus?.side === side && focus.code === code;
    return (
      <g
        key={`${side}:${code}`}
        className={`bd-node bd-${type(code)}${on ? ' on' : ''}`}
        role="button"
        tabIndex={0}
        aria-pressed={on}
        aria-label={`${code} ${left ? 'bought' : 'sold'} ${format(amount)} ${unit}`}
        onClick={() => setPicked({ side, code })}
        onMouseEnter={() => setPicked({ side, code })}
        onFocus={() => setPicked({ side, code })}
      >
        <rect x={left ? 0 : width - bar} y={y} width={bar} height={Math.max(h, 1)} rx={1} />
        <text
          x={left ? bar + 6 : width - bar - 6}
          y={y + h / 2}
          textAnchor={left ? 'start' : 'end'}
          dominantBaseline="central"
        >
          {left ? (
            <>
              <tspan className="bd-code">{code}</tspan> {format(amount)}
            </>
          ) : (
            <>
              {format(amount)} <tspan className="bd-code">{code}</tspan>
            </>
          )}
        </text>
      </g>
    );
  };
  return (
    <div className="bd-chart" ref={host}>
      {view && (
        <svg
          width={width}
          height={height}
          role="group"
          aria-label={`Buyers to sellers, ${unit}`}
          onMouseLeave={() => setPicked(null)}
        >
          {[...view.bands]
            .sort((a, b) => Number(lit(a)) - Number(lit(b)))
            .map((band) => (
              <path
                key={`${band.buyer} ${band.seller}`}
                className={lit(band) ? `bd-band bd-${type(focus!.code)}` : 'bd-band dim'}
                d={`M${x0},${band.from.y + band.from.h / 2} C${mid},${band.from.y + band.from.h / 2} ${mid},${band.to.y + band.to.h / 2} ${x1},${band.to.y + band.to.h / 2}`}
                strokeWidth={Math.max(1, Math.min(band.from.h, band.to.h))}
              >
                <title>{`${band.buyer} bought from ${band.seller} ${format(band.amount)} ${unit}`}</title>
              </path>
            ))}
          {data.buyers.map((n) => {
            const box = view.left.get(n.code)!;
            return node('buyer', n.code, n.amount, box.y, box.h);
          })}
          {data.sellers.map((n) => {
            const box = view.right.get(n.code)!;
            return node('seller', n.code, n.amount, box.y, box.h);
          })}
        </svg>
      )}
    </div>
  );
}
