import { useEffect, useRef, useState } from 'react';
import { useLocale } from './locale';

export type ChartPoint = { date: string; value: number | null; delta: number | null };
export type ChartSeries = { label: string; color: string; points: ChartPoint[] };
export function chartSegments(points: ChartPoint[]): ChartPoint[][] {
  const segments: ChartPoint[][] = [];
  let current: ChartPoint[] = [];
  for (const point of points) {
    if (point.value === null) {
      if (current.length) segments.push(current);
      current = [];
    } else current.push(point);
  }
  if (current.length) segments.push(current);
  return segments;
}
export function Chart({
  series,
  label,
  unit,
  height = 235,
  bars = false,
  minZero = false,
  onInspect,
  renderLabel,
  deltaUnit = unit,
  deltaLabel = 'Day Δ',
  inspectedDate,
}: {
  series: ChartSeries[];
  label: string;
  unit: string;
  height?: number;
  bars?: boolean;
  minZero?: boolean;
  onInspect?: (date: string) => void;
  renderLabel?: (label: string) => React.ReactNode;
  deltaUnit?: string;
  deltaLabel?: string;
  inspectedDate?: string | null;
}) {
  const { t, n, d, p } = useLocale();
  const [cursor, setCursor] = useState<string | null>(null);
  const [hover, setHover] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(760);
  const dates = [
    ...new Set(series.flatMap((item) => item.points.map((point) => point.date))),
  ].sort();
  const first = dates[0],
    last = dates.at(-1);
  useEffect(() => {
    if (!wrapper.current) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setWidth(Math.max(300, Math.min(1100, entry.contentRect.width)));
    });
    observer.observe(wrapper.current);
    return () => observer.disconnect();
  }, [first, last]);
  if (!first || !last) return <p className="monthly-empty">{t('No dated observations.')}</p>;
  const activeDate = inspectedDate ?? cursor;
  const day = activeDate && dates.includes(activeDate) ? activeDate : last;
  const values = series.flatMap((item) =>
    item.points.flatMap((point) => (point.value === null ? [] : [point.value])),
  );
  const low = Math.min(...values, ...(minZero || !values.length ? [0] : []));
  const high = Math.max(...values, ...(!values.length ? [1] : []));
  const padding = (high - low || 1) * 0.1;
  const min = minZero && low === 0 ? 0 : low - padding,
    max = high + padding;
  const left = 52,
    right = 54,
    top = 20,
    bottom = 29,
    pw = width - left - right,
    ph = height - top - bottom;
  const time = (date: string) => Date.parse(`${date}T12:00:00Z`);
  const x = (date: string) =>
    dates.length === 1
      ? left + pw / 2
      : left + ((time(date) - time(first)) / (time(last) - time(first))) * pw;
  const y = (value: number) => top + ((max - value) / (max - min || 1)) * ph;
  const compact = (value: number) =>
    Math.abs(value) >= 1e9
      ? `${n(Math.round(value / 1e7) / 100)}B`
      : Math.abs(value) >= 1e6
        ? `${n(Math.round(value / 1e4) / 100)}M`
        : Math.abs(value) >= 1e3
          ? `${n(Math.round(value / 100) / 10)}K`
          : n(Math.round(value * 100) / 100);
  const inspect = (date: string) => {
    setCursor(date);
    setHover(true);
    onInspect?.(date);
  };
  return (
    <div ref={wrapper} className="time-chart-wrap">
      <svg
        className="time-chart"
        viewBox={`0 0 ${width} ${height}`}
        style={{ height }}
        tabIndex={0}
        role="img"
        aria-label={`${label} ${t('by date. Arrow keys inspect reported dates.')}`}
        onFocus={() => inspect(day)}
        onPointerLeave={() => setHover(false)}
        onBlur={() => setHover(false)}
        onKeyDown={(event) => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          const index =
            event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? dates.length - 1
                : Math.max(
                    0,
                    Math.min(
                      dates.length - 1,
                      dates.indexOf(day) + (event.key === 'ArrowLeft' ? -1 : 1),
                    ),
                  );
          const date = dates[index];
          if (date) inspect(date);
        }}
      >
        <title>{label}</title>
        {[0, 0.5, 1].map((fraction) => {
          const value = min + (max - min) * fraction;
          return (
            <g key={fraction}>
              <line
                x1={left}
                x2={width - right}
                y1={y(value)}
                y2={y(value)}
                stroke="#dce5db"
                strokeDasharray="2 4"
              />
              <text x={left - 6} y={y(value) + 3} textAnchor="end">
                {compact(value)}
                {unit === '%' ? '%' : ''}
              </text>
            </g>
          );
        })}
        {min < 0 && max > 0 && (
          <line x1={left} x2={width - right} y1={y(0)} y2={y(0)} stroke="#9aafa2" />
        )}
        {series.map((item) => (
          <g key={item.label} data-series={item.label}>
            {bars
              ? item.points.map((point) =>
                  point.value === null ? null : (
                    <rect
                      key={point.date}
                      x={x(point.date) - (pw / dates.length) * 0.28}
                      y={y(point.value)}
                      width={Math.max(1.4, (pw / dates.length) * 0.56)}
                      height={Math.max(0, y(0) - y(point.value))}
                      fill={item.color}
                    />
                  ),
                )
              : chartSegments(item.points).map((segment, index) => (
                  <g key={index} data-segment={index}>
                    {segment.length > 1 && (
                      <polyline
                        points={segment
                          .map((point) => `${x(point.date)},${y(point.value ?? 0)}`)
                          .join(' ')}
                        fill="none"
                        stroke={item.color}
                        strokeWidth="2"
                      />
                    )}
                    {segment.map((point) => (
                      <circle
                        key={point.date}
                        cx={x(point.date)}
                        cy={y(point.value ?? 0)}
                        r="1.4"
                        fill={item.color}
                      />
                    ))}
                  </g>
                ))}
          </g>
        ))}
        {hover && (
          <>
            <line
              x1={x(day)}
              x2={x(day)}
              y1={top}
              y2={height - bottom}
              stroke="#7fa69a"
              strokeDasharray="3 3"
            />
            {series.map((item) => {
              const point = item.points.find((point) => point.date === day);
              return point?.value != null ? (
                <circle key={item.label} cx={x(day)} cy={y(point.value)} r="4" fill={item.color} />
              ) : null;
            })}
          </>
        )}
        {[...new Set([first, dates[Math.floor(dates.length / 2)] ?? first, last])].map((date) => (
          <text
            key={date}
            x={x(date)}
            y={height - 5}
            textAnchor={
              first === last
                ? 'middle'
                : date === first
                  ? 'start'
                  : date === last
                    ? 'end'
                    : 'middle'
            }
          >
            {date.slice(5)}
          </text>
        ))}
        {dates.map((date, index) => {
          const before = dates[index - 1],
            after = dates[index + 1];
          const start = before ? (x(before) + x(date)) / 2 : left,
            end = after ? (x(date) + x(after)) / 2 : width - right;
          return (
            <rect
              key={date}
              className="date-hit"
              data-plot-date={date}
              x={start}
              y={top}
              width={Math.max(1, end - start)}
              height={ph}
              fill="transparent"
              onPointerMove={() => inspect(date)}
              onClick={() => inspect(date)}
            />
          );
        })}
      </svg>
      <div className="chart-readout">
        <div className="chart-readout-date">{d(day)}</div>
        <div className="chart-readout-table">
          <table>
            <thead>
              <tr>
                <th>{t('Series')}</th>
                <th className="numeric">
                  {t(label)} · {t(unit)}
                </th>
                <th className="numeric">
                  {t(deltaLabel)}
                  {deltaUnit === '%' ? ' · %' : ''}
                </th>
              </tr>
            </thead>
            <tbody>
              {series.map((item) => {
                const point = item.points.find((point) => point.date === day);
                return (
                  <tr key={item.label}>
                    <td style={{ color: item.color }}>
                      {renderLabel ? renderLabel(item.label) : item.label}
                    </td>
                    <td className="numeric">
                      {point?.value == null ? t('Not reported') : n(point.value)}
                    </td>
                    <td className={`numeric ${(point?.delta ?? 0) < 0 ? 'down' : 'up'}`}>
                      {point?.delta == null
                        ? t('Not reported')
                        : `${point.delta > 0 ? '+' : ''}${deltaUnit === '%' ? p(point.delta) : n(point.delta)}`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
