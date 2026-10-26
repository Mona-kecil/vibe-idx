import { useEffect, useRef, useState, type ReactNode } from 'react';
import { initialPins, readStorage, writeStorage } from './watchlist';
import { AccountControls } from './BrokerPanel';
import { load, type Feed, type Health, type Market, type Stock, type Ticker } from './data';
import { dateText, direction, nf } from './ticker/format';

type Event = Feed[number];
type Ownership = Extract<Event, { kind: 'five_pct_change' }>;
type Signal = Exclude<Event, Ownership>;
const short = (n: number) => {
  const a = Math.abs(n);
  return a >= 1e12
    ? nf(a / 1e12, 2) + 'T'
    : a >= 1e9
      ? nf(a / 1e9, 2) + 'B'
      : a >= 1e6
        ? nf(a / 1e6, 2) + 'M'
        : a >= 1e3
          ? nf(a / 1e3, 2) + 'K'
          : nf(a);
};
const signed = (n: number, format = short) =>
  (n > 0 ? '+' : n < 0 ? '−' : '') + format(Math.abs(n));
const pct = (n: number | null) => (n === null ? '—' : signed(n, (v) => nf(v, 2)) + '%');
const date = (d: string | null) => (d ? dateText(d) : 'Not reported');
const isExit = (row: Ownership) =>
  row.numbers.exited === true ||
  (row.numbers.pct_after === null && row.numbers.net_shares === null);
function move(row: Ownership) {
  return isExit(row)
    ? row.numbers.pct_before - 5
    : row.numbers.pct_after === null
      ? -1
      : Math.abs(row.numbers.pct_after - row.numbers.pct_before);
}
function group<T extends Event>(rows: T[]) {
  const groups = new Map<string, T[]>();
  for (const row of rows) groups.set(row.ticker, [...(groups.get(row.ticker) ?? []), row]);
  return [...groups];
}
const rank = { ara: 0, volume_spike: 1, foreign_streak: 2, green_on_red: 3 };
const strength = (s: Signal) =>
  s.kind === 'volume_spike'
    ? s.numbers.multiple
    : s.kind === 'foreign_streak'
      ? s.numbers.streak_days
      : s.numbers.change_pct;
const compareSignal = (a: Signal, b: Signal) =>
  rank[a.kind] - rank[b.kind] ||
  strength(b) - strength(a) ||
  (a.kind === 'foreign_streak' && b.kind === 'foreign_streak'
    ? b.numbers.net_foreign - a.numbers.net_foreign
    : 0);
function SignalText({ row }: { row: Signal }) {
  switch (row.kind) {
    case 'ara':
      return (
        <>
          <b className={direction(row.numbers.change_pct)}>
            {signed(row.numbers.change_pct, (v) => nf(v, 1))}%
          </b>{' '}
          ARA
        </>
      );
    case 'volume_spike':
      return (
        <>
          <b>{nf(row.numbers.multiple, 1)}×</b> volume{' '}
          <span>vs {row.numbers.prior_days}-day avg</span>
        </>
      );
    case 'green_on_red':
      return (
        <>
          <b className={direction(row.numbers.change_pct)}>{pct(row.numbers.change_pct)}</b> vs
          market{' '}
          <b className={direction(row.numbers.market_change_pct)}>
            {pct(row.numbers.market_change_pct)}
          </b>
        </>
      );
    case 'foreign_streak':
      return (
        <>
          <b>{row.numbers.streak_days}-day</b> foreign streak{' '}
          <b className={direction(row.numbers.net_foreign)}>
            {signed(row.numbers.net_foreign)} IDR
          </b>
        </>
      );
    default: {
      const exhaustive: never = row;
      return exhaustive;
    }
  }
}
function signalTitle(s: Signal) {
  switch (s.kind) {
    case 'ara':
      return `${date(s.date)}; previous close ${nf(s.numbers.prev)}; close ${nf(s.numbers.close)} IDR; ARA band ${s.numbers.band_pct}%`;
    case 'volume_spike':
      return `${date(s.date)}; ${nf(s.numbers.volume)} shares vs ${nf(s.numbers.avg_volume)} average over ${s.numbers.prior_days} days; value ${nf(s.numbers.value)} IDR`;
    case 'green_on_red':
      return `${date(s.date)}; stock ${pct(s.numbers.change_pct)}; market ${pct(s.numbers.market_change_pct)}; value ${nf(s.numbers.value)} IDR`;
    case 'foreign_streak':
      return `${date(s.date)}; net foreign ${signed(s.numbers.net_foreign, nf)} IDR across ${s.numbers.streak_days} days`;
  }
}
function Line({
  rows,
  width,
  height,
  label,
  market = false,
}: {
  rows: { date: string; close: number; change_pct?: number | null }[];
  width: number;
  height: number;
  label: string;
  market?: boolean;
}) {
  const [inspected, inspect] = useState<number | null>(null);
  const values = rows.map((r) => r.close),
    min = Math.min(...values),
    max = Math.max(...values);
  const x = (i: number) => 3 + (i / Math.max(1, rows.length - 1)) * (width - 6);
  const y = (value: number) => height - 3 - ((value - min) / (max - min || 1)) * (height - 6);
  const selected = inspected === null ? null : rows[inspected];
  return (
    <>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={label}
        onPointerMove={
          market
            ? (e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                inspect(
                  Math.max(
                    0,
                    Math.min(
                      rows.length - 1,
                      Math.round(((e.clientX - rect.left) / rect.width) * (rows.length - 1)),
                    ),
                  ),
                );
              }
            : undefined
        }
        onPointerLeave={() => inspect(null)}
      >
        <title>{rows.map((r) => `${date(r.date)}: ${nf(r.close, 3)}`).join('; ')}</title>
        {market &&
          [24, 47, 70, 93].map((y) => (
            <line key={y} x1="0" x2={width} y1={y} y2={y} stroke="#e3e3da" strokeDasharray="2 4" />
          ))}
        <path
          d={rows
            .map((r, i) => `${i ? 'L' : 'M'}${x(i).toFixed(2)},${y(r.close).toFixed(2)}`)
            .join(' ')}
          fill="none"
          stroke={market ? '#222320' : '#62635c'}
          strokeWidth={market ? 1.8 : 1.4}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      {selected && (
        <div className="chart-tip">
          {date(selected.date)} {nf(selected.close, 3)}{' '}
          {selected.change_pct !== undefined && pct(selected.change_pct)}
        </div>
      )}
    </>
  );
}
function MarketBlock({ market }: { market: Market }) {
  const history = market.history.slice(-60),
    last = history.at(-1);
  if (!last) return <p role="status">Market history unavailable</p>;
  return (
    <section className="market-line" aria-label="IDX market">
      <div>
        <div className="market-title">
          <h1>IHSG</h1>
        </div>
        <div className="market-level">{nf(last.close, 2)}</div>
        <div className={`market-change ${direction(last.change)}`}>
          <span>{last.change === null ? '—' : signed(last.change, (v) => nf(v, 2))}</span>
          <span>{pct(last.change_pct)}</span>
        </div>
      </div>
      <div className="market-chart">
        <Line
          rows={history}
          width={650}
          height={94}
          label="Index closing levels over 60 trading days"
          market
        />
        <div className="chart-axis">
          <span>{dateText(history[0]?.date ?? last.date, false)}</span>
          <span>{dateText(last.date, false)}</span>
        </div>
        <details className="market-details">
          <summary className="inspect">View records</summary>
          <div className="market-records">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Close</th>
                  <th>Change</th>
                  <th>%</th>
                </tr>
              </thead>
              <tbody>
                {[...history].reverse().map((r) => (
                  <tr key={r.date}>
                    <td>{date(r.date)}</td>
                    <td>{nf(r.close, 3)}</td>
                    <td className={direction(r.change)}>
                      {r.change === null ? '—' : signed(r.change, (v) => nf(v, 3))}
                    </td>
                    <td className={direction(r.change_pct)}>{pct(r.change_pct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </div>
      <div className="breadth">
        <div className="breadth-bar" aria-hidden="true">
          <span style={{ width: `${(market.up / (market.up + market.down || 1)) * 100}%` }} />
          <span style={{ flex: 1 }} />
        </div>
        <div className="breadth-line">
          <span>Advancers</span>
          <strong>{nf(market.up)}</strong>
        </div>
        <div className="breadth-line">
          <span>Decliners</span>
          <strong>{nf(market.down)}</strong>
        </div>
      </div>
    </section>
  );
}
function Identity({ stock, ownership = false }: { stock: Stock; ownership?: boolean }) {
  return (
    <div className="stock-id">
      <strong>{stock.ticker}</strong>
      {ownership && (
        <span className="ownership-mark" title="Also has a 5% ownership move">
          5% move
        </span>
      )}
      <span className="company">{stock.name}</span>
    </div>
  );
}
function More({
  total,
  limit,
  expanded,
  toggle,
  controls,
}: {
  total: number;
  limit: number;
  expanded: boolean;
  toggle: () => void;
  controls: string;
}) {
  return (
    total > limit && (
      <button
        className="show-all"
        type="button"
        aria-controls={controls}
        aria-expanded={expanded}
        onClick={toggle}
      >
        {expanded ? 'Show less' : `Show all ${total}`}
      </button>
    )
  );
}
function WatchRow({ stock, feed, pin }: { stock: Stock; feed: Feed; pin: ReactNode }) {
  const [history, setHistory] = useState<Ticker | null>(null),
    [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    void load(`ticker/${stock.ticker}.json`).then(
      (data) => {
        if (active) {
          setHistory(data);
          setFailed(!data);
        }
      },
      () => {
        if (active) setFailed(true);
      },
    );
    return () => {
      active = false;
    };
  }, [stock.ticker]);
  const prices = history?.prices.slice(-60) ?? [];
  const events: { date: string; text: ReactNode }[] = feed
    .filter((s) => s.ticker === stock.ticker)
    .map((s) => ({
      date: s.date,
      text:
        s.kind === 'five_pct_change' ? (
          <>
            {s.numbers.investor}{' '}
            {isExit(s)
              ? `${nf(s.numbers.pct_before, 2)} → <5%`
              : s.numbers.net_shares === null
                ? 'holding not reported'
                : `${signed(s.numbers.net_shares)} shares`}
          </>
        ) : (
          <SignalText row={s} />
        ),
    }));
  for (const d of history?.disclosures ?? []) events.push({ date: d.published_at, text: d.title });
  const event = events.sort((a, b) => b.date.localeCompare(a.date))[0];
  return (
    <div className="watch-group">
      <a
        className="ticker-row watch-link"
        href={`/t/${stock.ticker}`}
        aria-label={`Open ${stock.ticker}, ${stock.name}, watchlist`}
      >
        <Identity stock={stock} />
        <div className="spark">
          {prices.length ? (
            <Line
              rows={prices}
              width={150}
              height={44}
              label={`${stock.ticker} closing price over 60 trading days`}
            />
          ) : (
            <span className="spark-empty">
              {failed ? 'History unavailable' : 'Loading history…'}
            </span>
          )}
        </div>
        <span className="signal-price num">{nf(stock.close)}</span>
        <span className={`signal-change num ${direction(stock.change_pct)}`}>
          {pct(stock.change_pct)}
        </span>
        <span className="latest-event">
          {event ? (
            <>
              {event.text}
              <time dateTime={event.date}>{date(event.date)}</time>
            </>
          ) : (
            'No event in this snapshot'
          )}
        </span>
      </a>
      {pin}
    </div>
  );
}
export function Home() {
  const [state, setState] = useState<
    | { kind: 'loading' }
    | { kind: 'error' }
    | { kind: 'ready'; stocks: Stock[]; feed: Feed; health: Health; market: Market }
  >({ kind: 'loading' });
  const [pins, setPins] = useState(initialPins),
    [announcement, announce] = useState('');
  const [sort, setSort] = useState(() =>
    readStorage('vibe-idx:ownership-sort') === 'move' ? 'move' : 'az',
  );
  const [expanded, setExpanded] = useState(false),
    [openSignals, setOpenSignals] = useState<string[]>([]);
  const [query, setQuery] = useState(''),
    [searchOpen, setSearchOpen] = useState(false),
    [active, setActive] = useState(0);
  const search = useRef<HTMLInputElement>(null),
    searchBox = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let active = true;
    void Promise.all([
      load('tickers.json'),
      load('feed.json'),
      load('health.json'),
      load('market.json'),
    ]).then(
      ([stocks, feed, health, market]) => {
        if (active) setState({ kind: 'ready', stocks, feed, health, market });
      },
      () => {
        if (active) setState({ kind: 'error' });
      },
    );
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSearchOpen(false);
        if (e.target instanceof Node && searchBox.current?.contains(e.target))
          search.current?.focus();
      }
      if (
        e.key === '/' &&
        !(e.target instanceof HTMLElement && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName))
      ) {
        e.preventDefault();
        search.current?.focus();
      }
    };
    const outside = (e: MouseEvent) => {
      if (e.target instanceof Node && !searchBox.current?.contains(e.target)) setSearchOpen(false);
    };
    document.addEventListener('keydown', key);
    document.addEventListener('click', outside);
    return () => {
      document.removeEventListener('keydown', key);
      document.removeEventListener('click', outside);
    };
  }, []);
  function pin(ticker: string) {
    const pinned = pins.includes(ticker);
    return (
      <button
        className="pin"
        type="button"
        aria-label={`${pinned ? 'Unpin' : 'Pin'} ${ticker}`}
        aria-pressed={pinned}
        onClick={(event) => {
          const button = event.currentTarget;
          const next = pinned ? pins.filter((t) => t !== ticker) : [...pins, ticker];
          setPins(next);
          writeStorage('vibe-idx:watchlist', JSON.stringify(next));
          announce(`${ticker} ${pinned ? 'removed from' : 'added to'} watchlist`);
          requestAnimationFrame(() => {
            if (!document.contains(button)) {
              const next = document.querySelector('.home-page .watch-group .pin');
              if (next instanceof HTMLButtonElement) next.focus();
              else search.current?.focus();
            }
          });
        }}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M7 3h10v18l-5-3-5 3z" />
        </svg>
      </button>
    );
  }
  const stocks = state.kind === 'ready' ? state.stocks : [];
  const q = query.trim().toLowerCase();
  const matches = stocks
    .filter((s) => s.ticker.toLowerCase().includes(q) || s.name.toLowerCase().includes(q))
    .sort(
      (a, b) =>
        Number(b.ticker.toLowerCase() === q) - Number(a.ticker.toLowerCase() === q) ||
        a.ticker.localeCompare(b.ticker),
    )
    .slice(0, 12);
  const stockMap = new Map(stocks.map((s) => [s.ticker, s]));
  const feed = state.kind === 'ready' ? state.feed.filter((s) => stockMap.has(s.ticker)) : [];
  const owners = feed.filter((s) => s.kind === 'five_pct_change');
  const latest = owners
    .map((s) => s.date)
    .sort()
    .at(-1);
  const byHolder = (a: Ownership, b: Ownership) =>
    a.numbers.investor.localeCompare(b.numbers.investor);
  const ownership = group(owners.filter((s) => s.date === latest))
    .map(([ticker, rows]) => {
      const holders = new Map<string, Ownership>();
      for (const row of rows) {
        const key = row.numbers.investor
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, ' ')
          .split(' ')
          .filter((t) => t && !['pt', 'tbk'].includes(t))
          .join(' ');
        if (!holders.has(key)) holders.set(key, row);
      }
      return {
        ticker,
        rows: [...holders.values()].sort(
          (a, b) => (sort === 'move' ? move(b) - move(a) : 0) || byHolder(a, b),
        ),
      };
    })
    .sort(
      (a, b) =>
        (sort === 'move' ? Math.max(...b.rows.map(move)) - Math.max(...a.rows.map(move)) : 0) ||
        a.ticker.localeCompare(b.ticker),
    );
  const signals = group(feed.filter((s) => s.kind !== 'five_pct_change'))
    .map(([ticker, rows]) => ({ ticker, rows: rows.sort(compareSignal) }))
    .sort((a, b) =>
      a.rows[0] && b.rows[0]
        ? compareSignal(a.rows[0], b.rows[0]) || a.ticker.localeCompare(b.ticker)
        : 0,
    );
  const lists = [
    {
      kind: 'multiple',
      label: 'Multiple signals',
      groups: signals.filter((g) => g.rows.length >= 2),
    },
    ...[
      { kind: 'ara', label: 'ARA' },
      { kind: 'volume_spike', label: 'Volume spike' },
      { kind: 'foreign_streak', label: 'Foreign streak' },
      { kind: 'green_on_red', label: 'Green on red' },
    ].map((list) => ({
      ...list,
      groups: signals.filter((g) => g.rows.length === 1 && g.rows[0]?.kind === list.kind),
    })),
  ].filter((list) => list.groups.length);
  const ownerTickers = new Set(owners.map((s) => s.ticker));
  return (
    <div className="home-page">
      <header className="topbar">
        <div className="wrap topbar-inner">
          <a className="wordmark" href="/" aria-label="Vibe IDX home">
            Vibe <span>IDX</span>
          </a>
          <nav className="main-nav" aria-label="Main">
            <a href="/" aria-current="page">
              Home
            </a>
            <a href="/market">Market</a>
          </nav>
          <div className="search" ref={searchBox}>
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              aria-hidden="true"
            >
              <circle cx="10.5" cy="10.5" r="6.5" />
              <path d="m16 16 4.5 4.5" />
            </svg>
            <input
              ref={search}
              type="search"
              placeholder="Search tickers"
              aria-label="Search tickers or companies"
              autoComplete="off"
              aria-controls="search-results"
              aria-expanded={searchOpen && !!q}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
                setSearchOpen(true);
              }}
              onFocus={() => setSearchOpen(true)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && searchOpen && q && matches[active]) {
                  e.preventDefault();
                  window.location.assign(`/t/${matches[active].ticker}`);
                }
                if (['ArrowDown', 'ArrowUp'].includes(e.key) && matches.length) {
                  e.preventDefault();
                  const next =
                    (active + (e.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length;
                  setActive(next);
                  setSearchOpen(true);
                  searchBox.current
                    ?.querySelectorAll('.search-option')
                    [next]?.scrollIntoView({ block: 'nearest' });
                }
              }}
            />
            <span className="keyhint">/</span>
            {searchOpen && q && (
              <div className="search-results" id="search-results">
                {matches.length ? (
                  matches.map((s, i) => (
                    <div className={`search-option ${i === active ? 'active' : ''}`} key={s.ticker}>
                      <a href={`/t/${s.ticker}`} aria-label={`Open ${s.ticker}, ${s.name}`}>
                        <b>{s.ticker}</b>
                        <small>{s.name}</small>
                      </a>
                      {pin(s.ticker)}
                    </div>
                  ))
                ) : (
                  <div className="search-empty">No stocks found</div>
                )}
              </div>
            )}
          </div>
          <div className="signin">
            <AccountControls />
          </div>
        </div>
      </header>
      <main className="wrap">
        {state.kind === 'loading' ? (
          <p role="status">Loading data…</p>
        ) : state.kind === 'error' ? (
          <p role="alert">
            Could not load data. <button onClick={() => window.location.reload()}>Reload</button>
          </p>
        ) : (
          <>
            <div className="freshness">
              <span>Prices {date(state.health.prices)}</span>
              <span>5% ownership {date(state.health.five_pct)}</span>
              <span>Registry {date(state.health.one_pct)}</span>
              <details className="sources">
                <summary>Sources</summary>
                <div className="source-panel">
                  <dl>
                    <dt>Indices</dt>
                    <dd>{date(state.health.indices)}</dd>
                    <dt>Issuers</dt>
                    <dd>{date(state.health.issuers)}</dd>
                    <dt>Snapshot</dt>
                    <dd>{date(state.health.run_at)}</dd>
                  </dl>
                  {state.feed.length > feed.length && (
                    <p>
                      {state.feed.length - feed.length} feed{' '}
                      {state.feed.length - feed.length === 1
                        ? 'record excluded'
                        : 'records excluded'}
                      : ticker absent from the stock directory.
                    </p>
                  )}
                </div>
              </details>
            </div>
            <MarketBlock market={state.market} />
            <section className="section" aria-labelledby="watch-heading">
              <div className="section-head">
                <h2 id="watch-heading">Watchlist</h2>
              </div>
              {pins.some((t) => stockMap.has(t)) ? (
                <>
                  <div className="table-head watch-head" aria-hidden="true">
                    <span>Stock</span>
                    <span>Price history</span>
                    <span className="num">
                      Close <small>IDR</small>
                    </span>
                    <span className="num">Day change</span>
                    <span>Latest event</span>
                    <span />
                  </div>
                  {pins.map((t) => {
                    const s = stockMap.get(t);
                    return s && <WatchRow key={t} stock={s} feed={feed} pin={pin(t)} />;
                  })}
                </>
              ) : (
                <div className="empty-state">Pin a stock from search or a row.</div>
              )}
            </section>
            <section className="section" aria-labelledby="ownership-heading">
              <div className="section-head">
                <h2 id="ownership-heading">Ownership moves</h2>
                <select
                  className="ownership-sort"
                  aria-label="Sort ownership moves"
                  value={sort}
                  onChange={(e) => {
                    const value = e.target.value === 'move' ? 'move' : 'az';
                    setSort(value);
                    setExpanded(false);
                    writeStorage('vibe-idx:ownership-sort', value);
                  }}
                >
                  <option value="az">A–Z</option>
                  <option value="move">Largest move</option>
                </select>
              </div>
              <div className="table-head ownership-head" aria-hidden="true">
                <span>Stock</span>
                <span>Holder</span>
                <span className="num">Net shares</span>
                <span className="num">Holding %</span>
                <span />
              </div>
              <div id="ownership-rows">
                {ownership.slice(0, expanded ? undefined : 10).map((g) => {
                  const s = stockMap.get(g.ticker);
                  return (
                    s && (
                      <div className="stock-group" key={g.ticker}>
                        <a
                          className="ticker-row stock-link"
                          href={`/t/${s.ticker}`}
                          aria-label={`Open ${s.ticker}, ${s.name}, ownership moves`}
                        >
                          <Identity stock={s} />
                          <div className="holder-list">
                            {g.rows.map((row) => {
                              const n = row.numbers,
                                exit = isExit(row);
                              return (
                                <div className="holder-row" key={n.investor}>
                                  <span className="holder">{n.investor}</span>
                                  <span
                                    className={`net num ${exit ? 'exit' : n.net_shares === null ? 'unreported' : direction(n.net_shares)}`}
                                    title={
                                      exit
                                        ? 'Exited the 5% report; net shares unknown'
                                        : n.net_shares === null
                                          ? 'Net shares not reported'
                                          : signed(n.net_shares, nf) + ' shares'
                                    }
                                  >
                                    {exit
                                      ? 'Exit'
                                      : n.net_shares === null
                                        ? 'Not reported'
                                        : signed(n.net_shares)}
                                  </span>
                                  <span
                                    className="transition num"
                                    title={`${nf(n.shares_before)} → ${exit ? 'unknown' : n.shares_after === null ? 'not reported' : nf(n.shares_after)} shares; previous report ${date(n.previous_date)}`}
                                  >
                                    <span className="before">{nf(n.pct_before, 2)}</span> →{' '}
                                    {exit
                                      ? '<5%'
                                      : n.pct_after === null
                                        ? '—'
                                        : nf(n.pct_after, 2) + '%'}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        </a>
                        {pin(s.ticker)}
                      </div>
                    )
                  );
                })}
              </div>
              <More
                total={ownership.length}
                limit={10}
                expanded={expanded}
                toggle={() => setExpanded(!expanded)}
                controls="ownership-rows"
              />
            </section>
            <section className="section" aria-labelledby="signals-heading">
              <div className="section-head">
                <h2 id="signals-heading">Signals</h2>
              </div>
              <div className="table-head signal-head" aria-hidden="true">
                <span>Stock</span>
                <span>Signal</span>
                <span className="num">
                  Close <small>IDR</small>
                </span>
                <span className="num">Day change</span>
                <span />
              </div>
              {lists.map((list) => {
                const expanded = openSignals.includes(list.kind);
                return (
                  <div className="signal-list" key={list.kind}>
                    <h3 id={`signals-${list.kind}-heading`}>{list.label}</h3>
                    <div
                      id={`signals-${list.kind}-rows`}
                      aria-labelledby={`signals-${list.kind}-heading`}
                    >
                      {list.groups.slice(0, expanded ? undefined : 5).map((g) => {
                        const s = stockMap.get(g.ticker),
                          hasChange = g.rows.some(
                            (s) => s.kind === 'ara' || s.kind === 'green_on_red',
                          );
                        return (
                          s && (
                            <div className="signal-group" key={g.ticker}>
                              <a
                                className="ticker-row signal-link"
                                href={`/t/${s.ticker}`}
                                aria-label={`Open ${s.ticker}, ${s.name}, signals`}
                              >
                                <Identity stock={s} ownership={ownerTickers.has(s.ticker)} />
                                <div className="signal-items">
                                  {g.rows.map((row) => (
                                    <span
                                      className="signal-item"
                                      key={row.kind}
                                      title={signalTitle(row)}
                                    >
                                      <SignalText row={row} />
                                    </span>
                                  ))}
                                </div>
                                <span className="signal-price num">{nf(s.close)}</span>
                                <span
                                  className={`signal-change num ${hasChange ? '' : direction(s.change_pct)}`}
                                >
                                  {hasChange ? '' : pct(s.change_pct)}
                                </span>
                              </a>
                              {pin(s.ticker)}
                            </div>
                          )
                        );
                      })}
                    </div>
                    <More
                      total={list.groups.length}
                      limit={5}
                      expanded={expanded}
                      toggle={() =>
                        setOpenSignals(
                          expanded
                            ? openSignals.filter((s) => s !== list.kind)
                            : [...openSignals, list.kind],
                        )
                      }
                      controls={`signals-${list.kind}-rows`}
                    />
                  </div>
                );
              })}
            </section>
          </>
        )}
      </main>
      <div className="sr-only" role="status" aria-live="polite">
        {announcement}
      </div>
    </div>
  );
}
