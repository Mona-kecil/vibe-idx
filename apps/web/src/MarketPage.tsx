import { useEffect, useState } from 'react';
import { useAuth } from '@workos-inc/authkit-react';
import { brokerName } from './broker-data';
import { accumulationSchema, type Accumulation } from './brokers';
import { load, type Feed, type Health, type MarketPeriod, type MarketSummary } from './data';
import {
  briefing,
  byTicker,
  EventText,
  eventTitle,
  lenses,
  parseLens,
  strength,
  type Event,
  type Lens,
} from './events';
import { PinButton, SiteHeader } from './SiteHeader';
import { Stale } from './Stale';
import { dateText, direction, nf } from './ticker/format';
import { readStorage, usePins, writeStorage } from './watchlist';
import './market.css';

type Stock = MarketSummary['stocks'][number];
type SortKey =
  | 'ticker'
  | 'event'
  | 'close'
  | 'change_pct'
  | 'value'
  | 'rel_volume'
  | 'acc'
  | 'size';
const columns: { key: SortKey; label: string; unit?: string; title?: string }[] = [
  { key: 'ticker', label: 'Stock' },
  { key: 'event', label: 'Signal' },
  { key: 'close', label: 'Close', unit: 'IDR' },
  {
    key: 'change_pct',
    label: 'Change %',
    title: 'Latest close compared with the close N trading days earlier.',
  },
  {
    key: 'value',
    label: 'Value traded',
    unit: 'IDR',
    title: 'Total traded value over the window.',
  },
  {
    key: 'rel_volume',
    label: 'Volume × average',
    title: 'Mean daily volume in the window ÷ mean daily volume in the 20 trading days before it.',
  },
  {
    key: 'acc',
    label: 'Accumulation',
    title:
      'Top net-buying broker’s net shares ÷ total price volume over the window. Broker net buying does not identify the underlying investor.',
  },
  {
    key: 'size',
    label: 'Buy size',
    title:
      'Top net-buying broker’s average buy trade ÷ the stock’s average trade, in shares, over the window.',
  },
];
const compact = (n: number | null) => {
  if (n === null) return '—';
  for (const [unit, scale] of [
    ['T', 1e12],
    ['B', 1e9],
    ['M', 1e6],
    ['K', 1e3],
  ] as const)
    if (Math.abs(n) >= scale) return nf(n / scale, 1) + unit;
  return nf(n);
};
const pct = (n: number | null) =>
  n === null ? '—' : (n > 0 ? '+' : n < 0 ? '−' : '') + nf(Math.abs(n), 2) + '%';
const defaultSort = (lens: Lens | null) =>
  ({ key: lens ? 'event' : 'value', ascending: false }) as const;
const lensFromUrl = () =>
  typeof window === 'undefined'
    ? null
    : parseLens(new URLSearchParams(window.location.search).get('show'));

export function MarketPage() {
  const { user, getAccessToken } = useAuth();
  const [state, setState] = useState<
    { kind: 'loading' | 'error' } | { kind: 'ready'; data: MarketSummary }
  >({ kind: 'loading' });
  const [privateState, setPrivateState] = useState<
    { kind: 'loading' | 'error' } | { kind: 'ready'; userId: string; data: Accumulation }
  >({ kind: 'loading' });
  const [period, setPeriod] = useState<MarketPeriod>(() => {
    const saved = readStorage('vibe-idx:market-period');
    return saved === '3d' || saved === '5d' ? saved : '1d';
  });
  const [lens, setLens] = useState<Lens | null>(lensFromUrl);
  const [sort, setSort] = useState<{ key: SortKey; ascending: boolean }>(() =>
    defaultSort(lensFromUrl()),
  );
  const [health, setHealth] = useState<Health | null>(null);
  const [feed, setFeed] = useState<Feed>([]);
  const [query, setQuery] = useState('');
  const [pins, toggle] = usePins();
  const [announcement, announce] = useState('');
  useEffect(() => {
    let active = true;
    document.title = 'Market  Vibe IDX';
    void load('market-summary.json').then(
      (data) => {
        if (active) setState({ kind: 'ready', data });
      },
      () => {
        if (active) setState({ kind: 'error' });
      },
    );
    void load('health.json').then(
      (data) => {
        if (active) setHealth(data);
      },
      () => {},
    );
    void load('feed.json').then(
      (data) => {
        if (active) setFeed(data);
      },
      () => {},
    );
    return () => {
      active = false;
      document.title = 'Vibe IDX';
    };
  }, []);
  const userId = user?.id;
  useEffect(() => {
    if (!userId) return;
    let active = true;
    setPrivateState({ kind: 'loading' });
    void (async () => {
      try {
        const token = await getAccessToken();
        if (!token) throw new Error('Sign in required');
        const response = await fetch('/api/brokers?view=market', {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        });
        if (!response.ok) throw new Error('Could not load accumulation');
        const data = accumulationSchema.parse(await response.json());
        if (active) setPrivateState({ kind: 'ready', userId, data });
      } catch {
        if (active) setPrivateState({ kind: 'error' });
      }
    })();
    return () => {
      active = false;
    };
  }, [userId, getAccessToken]);
  const data = state.kind === 'ready' ? state.data : null;
  const privateData =
    userId &&
    privateState.kind === 'ready' &&
    privateState.userId === userId &&
    privateState.data.date === data?.date
      ? privateState.data
      : null;
  const accumulation = new Map(
    privateData?.stocks.map((stock) => [stock.ticker, stock.windows[period]]),
  );
  const listed = new Set(data?.stocks.map((stock) => stock.ticker));
  const events = byTicker(briefing(feed, (ticker) => listed.has(ticker)));
  const lensEvents = (ticker: string): Event[] =>
    lens ? (events.get(ticker) ?? []).filter((event) => event.kind === lens) : [];
  const counts = new Map<Lens, number>();
  for (const rows of events.values())
    for (const kind of new Set(rows.map((event) => event.kind)))
      counts.set(kind, (counts.get(kind) ?? 0) + 1);
  const chooseLens = (next: Lens | null) => {
    setLens(next);
    setSort(defaultSort(next));
    const url = new URL(window.location.href);
    if (next) url.searchParams.set('show', next);
    else url.searchParams.delete('show');
    window.history.replaceState(window.history.state, '', url);
  };
  const shown = columns.filter(
    (column) =>
      (column.key !== 'event' || lens !== null) &&
      ((column.key !== 'acc' && column.key !== 'size') || privateData),
  );
  const field = (stock: Stock, key: SortKey) =>
    key === 'ticker' || key === 'close'
      ? stock[key]
      : key === 'event'
        ? (lensEvents(stock.ticker).map(strength)[0] ?? null)
        : key === 'acc'
          ? (accumulation.get(stock.ticker)?.pct ?? null)
          : key === 'size'
            ? (accumulation.get(stock.ticker)?.size ?? null)
            : stock.windows[period][key];
  const rows = (data?.stocks ?? [])
    .filter(
      (stock) =>
        (!lens || lensEvents(stock.ticker).length > 0) &&
        (stock.ticker + ' ' + stock.name).toLowerCase().includes(query.trim().toLowerCase()),
    )
    .sort((a, b) => {
      const av = field(a, sort.key),
        bv = field(b, sort.key);
      if (av === null || bv === null)
        return av === bv ? a.ticker.localeCompare(b.ticker) : av === null ? 1 : -1;
      const result =
        typeof av === 'string' && typeof bv === 'string'
          ? av.localeCompare(bv)
          : Number(av) - Number(bv);
      return result * (sort.ascending ? 1 : -1) || a.ticker.localeCompare(b.ticker);
    });
  const pin = (ticker: string) => (
    <PinButton
      ticker={ticker}
      pinned={pins.includes(ticker)}
      toggle={() => announce(`${ticker} ${toggle(ticker) ? 'pinned' : 'unpinned'}`)}
    />
  );
  return (
    <div className="site market-page">
      <SiteHeader page="market" stocks={data?.stocks ?? []} pin={pin} />
      <main className="wrap">
        <div className="market-head">
          <h1>Market</h1>
          <div className="freshness">
            {health && <Stale health={health} />}
            {data?.date && <time dateTime={data.date}>{dateText(data.date)}</time>}
          </div>
        </div>
        <div className="toolbar">
          <div className="tabs" role="group" aria-label="Show">
            <button type="button" aria-pressed={!lens} onClick={() => chooseLens(null)}>
              All
            </button>
            {lenses
              .filter((l) => counts.has(l.kind) || lens === l.kind)
              .map((l) => (
                <button
                  key={l.kind}
                  type="button"
                  title={l.label}
                  aria-pressed={lens === l.kind}
                  onClick={() => chooseLens(l.kind)}
                >
                  {l.tag} <small>{counts.get(l.kind) ?? 0}</small>
                </button>
              ))}
          </div>
          <input
            className="filter"
            type="search"
            placeholder="Filter"
            aria-label="Filter stocks"
            aria-controls="market-rows"
            autoComplete="off"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className="ranges" role="group" aria-label="Period">
            {(['1d', '3d', '5d'] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={period === value}
                onClick={() => {
                  setPeriod(value);
                  writeStorage('vibe-idx:market-period', value);
                }}
              >
                {value.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
        {state.kind === 'loading' ? (
          <p role="status">Loading data…</p>
        ) : state.kind === 'error' ? (
          <p role="alert">
            Could not load market data.{' '}
            <button onClick={() => window.location.reload()}>Reload</button>
          </p>
        ) : (
          <>
            {user && privateState.kind === 'error' && (
              <p className="notice" role="alert">
                Broker accumulation is unavailable.{' '}
                <button onClick={() => window.location.reload()}>Reload</button>
              </p>
            )}
            <div className="table-scroll" role="region" aria-label="Market stocks" tabIndex={0}>
              <table>
                <caption>Every IDX stock traded on the latest price date</caption>
                <colgroup>
                  {shown.map((column) => (
                    <col key={column.key} className={column.key} />
                  ))}
                  <col className="pin-col" />
                </colgroup>
                <thead>
                  <tr>
                    {shown.map((column) => (
                      <th
                        key={column.key}
                        scope="col"
                        className={
                          column.key === 'ticker' || column.key === 'event' ? 'left' : undefined
                        }
                        aria-sort={
                          sort.key === column.key
                            ? sort.ascending
                              ? 'ascending'
                              : 'descending'
                            : 'none'
                        }
                      >
                        <button
                          type="button"
                          title={column.title}
                          onClick={() =>
                            setSort({
                              key: column.key,
                              ascending:
                                sort.key === column.key ? !sort.ascending : column.key === 'ticker',
                            })
                          }
                        >
                          {column.label}
                          {column.unit && <small>{column.unit}</small>}
                          <span className="sort-icon" aria-hidden="true">
                            {sort.key === column.key ? (sort.ascending ? '↑' : '↓') : ''}
                          </span>
                        </button>
                      </th>
                    ))}
                    <th scope="col">
                      <span className="sr-only">Pin</span>
                    </th>
                  </tr>
                </thead>
                <tbody id="market-rows">
                  {rows.map((stock) => {
                    const metrics = stock.windows[period],
                      acc = accumulation.get(stock.ticker);
                    const cell = (key: SortKey) => {
                      switch (key) {
                        case 'ticker':
                          return (
                            <td key={key}>
                              <a className="stock-link" href={`/t/${stock.ticker}`}>
                                <strong>{stock.ticker}</strong>
                                <span className="company" title={stock.name}>
                                  {stock.name}
                                </span>
                              </a>
                            </td>
                          );
                        case 'event':
                          return (
                            <td key={key} className="event">
                              {lensEvents(stock.ticker).map((event, i) => (
                                <span key={i} title={eventTitle(event)}>
                                  <EventText event={event} />
                                </span>
                              ))}
                            </td>
                          );
                        case 'close':
                          return <td key={key}>{stock.close === null ? '—' : nf(stock.close)}</td>;
                        case 'change_pct':
                          return (
                            <td
                              key={key}
                              className={direction(metrics.change_pct ?? 0)}
                              title={
                                metrics.change_pct === null
                                  ? 'Price data is missing'
                                  : `${metrics.change_pct}%`
                              }
                            >
                              {pct(metrics.change_pct)}
                            </td>
                          );
                        case 'value':
                          return (
                            <td
                              key={key}
                              title={
                                metrics.value === null
                                  ? 'Traded value is missing'
                                  : `${nf(metrics.value)} IDR`
                              }
                            >
                              {compact(metrics.value)}
                            </td>
                          );
                        case 'rel_volume':
                          return (
                            <td
                              key={key}
                              title={
                                metrics.rel_volume === null
                                  ? 'Volume data is missing'
                                  : `${metrics.rel_volume}×`
                              }
                            >
                              {metrics.rel_volume === null ? '—' : nf(metrics.rel_volume, 1) + '×'}
                            </td>
                          );
                        case 'acc':
                          return (
                            <td
                              key={key}
                              title={
                                acc
                                  ? `${brokerName(acc.broker)}; ${acc.pct * 100}% of traded volume`
                                  : 'Broker data is incomplete for this window.'
                              }
                            >
                              {acc ? (
                                <>
                                  {nf(acc.pct * 100, 1)}%
                                  <span className="broker">{acc.broker}</span>
                                </>
                              ) : (
                                '—'
                              )}
                            </td>
                          );
                        case 'size':
                          return (
                            <td
                              key={key}
                              title={
                                acc?.size != null &&
                                acc.broker_avg !== null &&
                                acc.stock_avg !== null &&
                                acc.buy_trades !== null &&
                                acc.trades !== null
                                  ? `${acc.broker} avg ${nf(acc.broker_avg)} shares per buy trade over ${nf(acc.buy_trades)} trades; stock avg ${nf(acc.stock_avg)} over ${nf(acc.trades)} trades`
                                  : undefined
                              }
                            >
                              {acc?.size == null ? '' : nf(acc.size, 1) + '×'}
                            </td>
                          );
                      }
                    };
                    return (
                      <tr
                        key={stock.ticker}
                        onClick={(event) => {
                          if (
                            event.target instanceof Element &&
                            !event.target.closest('a, button') &&
                            !window.getSelection()?.toString()
                          )
                            window.location.assign(`/t/${stock.ticker}`);
                        }}
                      >
                        {shown.map((column) => cell(column.key))}
                        <td>{pin(stock.ticker)}</td>
                      </tr>
                    );
                  })}
                  {!rows.length && (
                    <tr>
                      <td colSpan={shown.length + 1} className="empty-state">
                        {query ? 'No stocks match this filter.' : 'No stocks in this view.'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
        <div className="sr-only" role="status">
          {rows.length} stocks; {period.toUpperCase()}
        </div>
        <div className="sr-only" role="status">
          {announcement}
        </div>
      </main>
    </div>
  );
}
