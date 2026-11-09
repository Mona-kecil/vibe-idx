import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Resource, Risk } from './sources';
import { useTerminal } from './state';
import { dateText, nf, short, signed } from '../ticker/format';

export const direction = (value: number | null | undefined) =>
  value && value > 0 ? 'up' : value && value < 0 ? 'dn' : 'mut';
export const percent = (value: number | null) =>
  value === null ? '—' : `${signed(value, (n) => nf(n, 2))}%`;
export function Segments<T extends string>({
  label,
  values,
  value,
  onChange,
}: {
  label: string;
  values: readonly T[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {values.map((option) => (
        <button key={option} aria-pressed={option === value} onClick={() => onChange(option)}>
          {option}
        </button>
      ))}
    </div>
  );
}
export function Scroll({
  reset,
  children,
  className = '',
}: {
  reset: string;
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = 0;
  }, [reset]);
  return (
    <div ref={ref} className={`pb ${className}`}>
      {children}
    </div>
  );
}
export function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="empty" role="status">
      {children}
    </p>
  );
}
export function Availability<T>({
  resource,
  name,
  children,
}: {
  resource: Resource<T>;
  name: string;
  children: (data: T) => ReactNode;
}) {
  return resource.kind === 'ready' ? (
    children(resource.data)
  ) : (
    <Empty>{resource.kind === 'loading' ? `Loading ${name}…` : `${name} unavailable`}</Empty>
  );
}
export function Publication({ date, errors = [] }: { date?: string | null; errors?: string[] }) {
  return (
    <>
      {date && <div className="publication">As of {dateText(date)}</div>}
      {errors.length > 0 && (
        <p className="empty" role="status">
          {errors.join(' ')}
        </p>
      )}
    </>
  );
}
export function TickerLink({ ticker }: { ticker: string }) {
  const terminal = useTerminal();
  return (
    <a
      className="ticker"
      href={`/terminal?t=${encodeURIComponent(ticker)}&l=focus`}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0)
          return;
        event.preventDefault();
        terminal.setTicker(ticker);
      }}
    >
      {ticker}
    </a>
  );
}
export function RiskFlags({ risk }: { risk?: Risk }) {
  if (!risk) return null;
  return (
    <span className="flags">
      {risk.susp && (
        <a
          className="flag sus"
          title={`Suspended since ${dateText(risk.susp.since)} ${risk.susp.reason ?? ''}`}
          href={risk.susp.url}
          target="_blank"
          rel="noreferrer"
        >
          SUSP
        </a>
      )}
      {risk.uma && (
        <a
          className="flag uma"
          href={risk.uma.url}
          title={`Unusual market activity ${dateText(risk.uma.date)}`}
          target="_blank"
          rel="noreferrer"
        >
          UMA
        </a>
      )}
      {risk.notes.map((note) => (
        <span className="flag" key={note.code} title={note.text}>
          {note.code === 'X' ? 'FCA' : note.code}
        </span>
      ))}
    </span>
  );
}
export function StatusBar() {
  const { data, publications } = useTerminal();
  const [clock] = useClock();
  const last = data.market.history.at(-1);
  const next =
    publications.calendar.kind === 'ready'
      ? [...publications.calendar.data.cal]
          .sort((a, b) => a.ts.localeCompare(b.ts))
          .find((event) => event.imp === 3 && Date.parse(event.ts) > clock)
      : undefined;
  const values = data.market.history.slice(-40).map((row) => row.close);
  const low = Math.min(...values),
    high = Math.max(...values);
  return (
    <footer className="status">
      <span className="hidenarrow" title="Weekday trading schedule; holidays are not reflected">
        {sessionLabel(clock)}
      </span>
      <span>{new Date(clock).toLocaleTimeString('en-GB', { timeZone: 'Asia/Jakarta' })} WIB</span>
      {last && (
        <span>
          IHSG <b>{nf(last.close, 2)}</b>{' '}
          <span className={direction(last.change_pct)}>{percent(last.change_pct)}</span>
        </span>
      )}
      <svg className="spark" width="64" height="14" aria-label="IHSG recent daily closes">
        <path
          d={values
            .map(
              (value, i) =>
                `${i ? 'L' : 'M'}${(i / Math.max(1, values.length - 1)) * 62 + 1},${13 - ((value - low) / (high - low || 1)) * 12}`,
            )
            .join(' ')}
          fill="none"
          stroke="currentColor"
        />
      </svg>
      <span className="hidenarrow">
        <span className="up">{data.market.up} up</span>{' '}
        <span className="dn">{data.market.down} down</span>
      </span>
      <span className="hidenarrow">
        FOREIGN EST. IDR{' '}
        {signed(
          data.stocks.reduce((sum, stock) => sum + stock.net_foreign, 0),
          short,
        )}
      </span>
      {next && (
        <span className="hidenarrow">
          {next.c} {next.ev} {dateText(next.ts)}
        </span>
      )}
      <time className="asof">EOD {data.health.prices ?? data.market.date ?? 'unavailable'}</time>
    </footer>
  );
}
function useClock() {
  const ref = useRef(0);
  const [value, setValue] = useState(Date.now());
  useEffect(() => {
    ref.current = window.setInterval(() => setValue(Date.now()), 1000);
    return () => clearInterval(ref.current);
  }, []);
  return [value, setValue] as const;
}

function sessionLabel(now: number) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Jakarta',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(now)
      .map((part) => [part.type, part.value]),
  );
  if (parts.weekday === 'Sat' || parts.weekday === 'Sun') return 'CLOSED';
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  const friday = parts.weekday === 'Fri';
  if (minutes >= 525 && minutes < 540) return 'PRE-OPEN';
  if (minutes >= 540 && minutes < (friday ? 690 : 720)) return 'SESSION 1';
  if (minutes >= (friday ? 690 : 720) && minutes < (friday ? 840 : 810)) return 'BREAK';
  if (minutes >= (friday ? 840 : 810) && minutes < 950) return 'SESSION 2';
  if (minutes >= 950 && minutes < 960) return 'PRE-CLOSE';
  return 'CLOSED';
}
