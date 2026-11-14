import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { LineSeries } from 'lightweight-charts';
import {
  ledgerPositions,
  matchBrokers,
  net,
  sessionLines,
  sessionPositions,
  type Position,
} from '../broker-activity.js';
import { brokerName } from '../broker-data.js';
import type { BrokerLedger, BrokerSession } from '../brokers.js';
import { bounds } from '../ticker/logic.js';
import { dateText, nf, rangeText, short, signed } from '../ticker/format.js';
import { readStorage, writeStorage } from '../watchlist.js';
import { palette } from './BrokerPanes.js';
import { terminalChart } from './charts.js';
import { fetchBrokerLedger, fetchBrokerSession } from './sources.js';
import { useTerminal } from './state.js';
import { Empty, Scroll, Segments, SignInPrompt, direction } from './ui.js';
import './broker-panes.css';

type Load<T> =
  | { kind: 'idle' | 'loading' | 'missing' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; data: T };
const storageKey = 'terminal:ba-broker';

function useLoad<T>(key: string | null, read: () => Promise<T | null>): Load<T> {
  const [state, setState] = useState<Load<T> & { key?: string }>({ kind: 'idle' });
  const reader = useRef(read);
  reader.current = read;
  useEffect(() => {
    if (!key) return;
    let current = true;
    setState({ kind: 'loading', key });
    reader.current().then(
      (data) => current && setState(data ? { kind: 'ready', data, key } : { kind: 'missing', key }),
      (error: unknown) =>
        current &&
        setState({
          kind: 'error',
          key,
          message: error instanceof Error ? error.message : 'Broker data is unavailable. Retry.',
        }),
    );
    return () => {
      current = false;
    };
  }, [key]);
  return !key ? { kind: 'idle' } : state.key === key ? state : { kind: 'loading' };
}

/** Sessions on or after the start of the flow period, counted back from the latest session. */
function periodDates(dates: string[], period: '1W' | '1M' | '3M' | 'YTD') {
  const last = dates.at(-1);
  if (!last) return [];
  const since = new Date(`${last}T00:00:00Z`);
  if (period === 'YTD') since.setUTCMonth(0, 1);
  else if (period === '1W') since.setUTCDate(since.getUTCDate() - 7);
  else since.setUTCMonth(since.getUTCMonth() - parseInt(period));
  const from = since.toISOString().slice(0, 10);
  return dates.filter((date) => date >= from);
}

export function BrokerActivityPane() {
  const { authState, getToken, broker, setBroker, selection, select } = useTerminal();
  const [code, setCode] = useState(() => readStorage(storageKey) ?? '');
  const [picked, setPicked] = useState<string | null>(null);
  const ledger = useLoad<BrokerLedger>(code || null, async () => {
    const token = await getToken();
    if (!token) throw new Error('Your sign-in expired. Sign in again.');
    return fetchBrokerLedger(code, token);
  });
  const dates = useMemo(
    () =>
      ledger.kind === 'ready' ? [...new Set(ledger.data.days.map((day) => day.date))].sort() : [],
    [ledger],
  );
  const b = bounds(selection);
  const oneDay = b ? b.start === b.end : broker.flow === '1D';
  const day = oneDay
    ? (b?.start ?? (picked && dates.includes(picked) ? picked : dates.at(-1)))
    : undefined;
  const session = useLoad<BrokerSession>(code && day ? `${code}:${day}` : null, async () => {
    const token = await getToken();
    if (!token) throw new Error('Your sign-in expired. Sign in again.');
    return fetchBrokerSession(code, day!, token);
  });
  const range = useMemo(
    () =>
      oneDay
        ? []
        : b
          ? dates.filter((date) => date >= b.start && date <= b.end)
          : periodDates(dates, broker.flow === '1D' ? '1M' : broker.flow),
    [oneDay, b?.start, b?.end, dates, broker.flow],
  );
  if (authState !== 'signed-in') return <SignInPrompt />;
  function choose(next: string) {
    if (next === code) return;
    setCode(next);
    setPicked(null);
    writeStorage(storageKey, next);
  }
  const controls = (
    <div className="broker-controls">
      <BrokerPicker value={code} onPick={choose} />
      <Segments
        label="Board"
        values={['regular', 'negotiation', 'cash', 'all']}
        value={broker.board}
        onChange={(value) => setBroker('board', value)}
      />
      <Segments
        label="Broker unit"
        values={['VALUE', 'LOT']}
        value={broker.unit}
        onChange={(value) => setBroker('unit', value)}
      />
      <Segments
        label="Flow period"
        values={['1D', '1W', '1M', '3M', 'YTD']}
        value={broker.flow}
        onChange={(value) => {
          setBroker('flow', value);
          select(null);
        }}
      />
    </div>
  );
  let body: ReactNode;
  if (!code) body = <Empty>Enter a broker code</Empty>;
  else if (ledger.kind === 'error' || (oneDay && session.kind === 'error'))
    body = (
      <p className="empty" role="alert">
        {ledger.kind === 'error' ? ledger.message : session.kind === 'error' && session.message}
      </p>
    );
  else if (ledger.kind === 'missing') body = <Empty>No activity for {code}</Empty>;
  else if (ledger.kind !== 'ready' || (oneDay && session.kind === 'loading'))
    body = <Empty>Loading broker activity…</Empty>;
  else if (oneDay && session.kind !== 'ready')
    body = (
      <>
        <SessionSteps dates={dates} day={day} onStep={setPicked} fixed={!!b} />
        <Empty>No running trade for {code} in this session</Empty>
      </>
    );
  else {
    const positions =
      oneDay && session.kind === 'ready'
        ? sessionPositions(session.data, broker.board)
        : ledgerPositions(ledger.data, new Set(range), broker.board);
    body = (
      <>
        {oneDay ? (
          <SessionSteps dates={dates} day={day} onStep={setPicked} fixed={!!b} />
        ) : (
          <div className="broker-date">
            <span>{range[0] && rangeText(range[0], range.at(-1)!, true)}</span>
          </div>
        )}
        {oneDay && session.kind === 'ready' && (
          <TickerLines session={session.data} positions={positions} />
        )}
        <Positions positions={positions} reset={`${code}:${day}:${range.join()}`} />
      </>
    );
  }
  return (
    <>
      {controls}
      {body}
    </>
  );
}

function BrokerPicker({ value, onPick }: { value: string; onPick: (code: string) => void }) {
  const [text, setText] = useState(value);
  const [open, setOpen] = useState(false);
  // Picking blurs the input before the parent passes the new code down.
  useEffect(() => setText(value), [value]);
  const [active, setActive] = useState(0);
  const matches = open ? matchBrokers(text) : [];
  const pick = (code: string) => {
    setText(code);
    setOpen(false);
    onPick(code);
  };
  return (
    <div className="ba-picker">
      <input
        role="combobox"
        aria-label="Broker"
        aria-controls="ba-brokers"
        aria-expanded={matches.length > 0}
        aria-activedescendant={matches[active] ? `ba-broker-${matches[active].code}` : undefined}
        autoComplete="off"
        spellCheck={false}
        placeholder="Broker"
        title={value ? brokerName(value) : undefined}
        value={text}
        onFocus={(event) => {
          event.target.select();
          setOpen(true);
          setActive(0);
        }}
        onBlur={() => {
          setOpen(false);
          setText(value);
        }}
        onChange={(event) => {
          setText(event.target.value.toUpperCase());
          setOpen(true);
          setActive(0);
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            if (matches.length)
              setActive(
                (active + (event.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length,
              );
          } else if (event.key === 'Enter') {
            event.preventDefault();
            const match = matches[active] ?? matchBrokers(text, 1)[0];
            if (match) pick(match.code);
            event.currentTarget.blur();
          } else if (event.key === 'Escape') {
            event.stopPropagation();
            event.currentTarget.blur();
          }
        }}
      />
      {matches.length > 0 && (
        <div id="ba-brokers" className="ba-options" role="listbox" aria-label="Brokers">
          {matches.map((broker, index) => (
            <div
              key={broker.code}
              id={`ba-broker-${broker.code}`}
              role="option"
              aria-selected={index === active}
              className={index === active ? 'on' : ''}
              onMouseEnter={() => setActive(index)}
              onMouseDown={(event) => {
                event.preventDefault();
                pick(broker.code);
              }}
            >
              <b>{broker.code}</b>
              <span>{broker.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SessionSteps({
  dates,
  day,
  onStep,
  fixed,
}: {
  dates: string[];
  day: string | undefined;
  onStep: (date: string) => void;
  fixed: boolean;
}) {
  const index = day ? dates.indexOf(day) : -1;
  if (fixed)
    return (
      <div className="broker-date">
        <span>{day && dateText(day)}</span>
      </div>
    );
  return (
    <div className="tick-session">
      <button
        aria-label="Previous session"
        disabled={index <= 0}
        onClick={() => onStep(dates[index - 1]!)}
      >
        ‹
      </button>
      <time>{day ? dateText(day) : '—'}</time>
      <button
        aria-label="Next session"
        disabled={index < 0 || index >= dates.length - 1}
        onClick={() => onStep(dates[index + 1]!)}
      >
        ›
      </button>
    </div>
  );
}

function TickerLines({ session, positions }: { session: BrokerSession; positions: Position[] }) {
  const { broker } = useTerminal();
  const host = useRef<HTMLDivElement>(null);
  const tickers = useMemo(() => {
    const ranked = [...positions].sort((a, b) => net(b, broker.unit) - net(a, broker.unit));
    return [
      ...ranked.filter((p) => net(p, broker.unit) > 0).slice(0, 3),
      ...ranked
        .filter((p) => net(p, broker.unit) < 0)
        .slice(-3)
        .reverse(),
    ].map((p) => p.ticker);
  }, [positions, broker.unit]);
  const lines = useMemo(
    () => sessionLines(session, broker.board, broker.unit, tickers),
    [session, broker.board, broker.unit, tickers],
  );
  useEffect(() => {
    if (!host.current || !lines.length) return;
    const chart = terminalChart(host.current);
    lines.forEach((line, i) => {
      const series = chart.addSeries(LineSeries, {
        color: palette[i % palette.length],
        title: line.ticker,
        lineWidth: 2,
        priceLineVisible: false,
        priceFormat: { type: 'custom', formatter: short },
      });
      series.setData(line.points);
    });
    chart
      .timeScale()
      .applyOptions({ rightOffsetPixels: 6, timeVisible: true, secondsVisible: false });
    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [lines]);
  if (!lines.length) return null;
  return (
    <div className="ba-chart">
      <div className="legend">
        {lines.map((line, i) => {
          const end = line.points.at(-1)?.value ?? 0;
          return (
            <span key={line.ticker} className="broker-key">
              <i style={{ background: palette[i % palette.length] }} />
              {line.ticker} <span className={direction(end)}>{signed(end, short)}</span>
            </span>
          );
        })}
      </div>
      <div className="flow-chart" ref={host} />
    </div>
  );
}

function Positions({ positions, reset }: { positions: Position[]; reset: string }) {
  const { broker, openTicker } = useTerminal();
  const lots = broker.unit === 'LOT';
  const buys = positions
    .filter((p) => net(p, broker.unit) > 0)
    .sort((a, b) => net(b, broker.unit) - net(a, broker.unit));
  const sells = positions
    .filter((p) => net(p, broker.unit) < 0)
    .sort((a, b) => net(a, broker.unit) - net(b, broker.unit));
  if (!buys.length && !sells.length) return <Empty>No trades</Empty>;
  const table = (rows: Position[], which: 'BUY' | 'SELL') => (
    <table className={`broker-ledger ${which.toLowerCase()}`}>
      <thead>
        <tr>
          <th>{`NET ${which}`}</th>
          <th>VALUE IDR</th>
          <th>LOT</th>
          <th>AVG IDR</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((p) => {
          const value = Math.abs(p.buyValue - p.sellValue),
            shares = Math.abs(p.buyShares - p.sellShares);
          const avg =
            which === 'BUY'
              ? p.buyShares && p.buyValue / p.buyShares
              : p.sellShares && p.sellValue / p.sellShares;
          return (
            <tr key={p.ticker}>
              <td className="l">
                <button onClick={() => openTicker(p.ticker)}>{p.ticker}</button>
              </td>
              <td className={lots ? '' : which === 'BUY' ? 'up' : 'dn'} title={`${nf(value)} IDR`}>
                {short(value)}
              </td>
              <td
                className={lots ? (which === 'BUY' ? 'up' : 'dn') : ''}
                title={`${nf(shares)} shares`}
              >
                {short(shares / 100)}
              </td>
              <td title={`${nf(avg, 2)} IDR`}>{nf(avg, 1)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
  return (
    <Scroll reset={reset}>
      <div className="broker-ledgers ba-ledgers">
        {table(buys, 'BUY')}
        {table(sells, 'SELL')}
      </div>
    </Scroll>
  );
}
