import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@workos-inc/authkit-react';
import { AccountControls, SignInButton } from './BrokerPanel';
import { brokerName } from './broker-data';
import { accumulationSchema, type Accumulation } from './brokers';
import { load, type MarketPeriod, type MarketSummary } from './data';
import { dateText, direction, nf } from './ticker/format';
import { initialPins, readStorage, writeStorage } from './watchlist';
import './market.css';

type Stock = MarketSummary['stocks'][number];
type SortKey = 'ticker' | 'close' | 'change_pct' | 'value' | 'rel_volume' | 'acc' | 'size';
const columns: { key: SortKey; label: string; unit?: string; title?: string }[] = [
  { key: 'ticker', label: 'Stock' },
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

export function MarketPage() {
  const { user, isLoading, getAccessToken } = useAuth();
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
  const [sort, setSort] = useState<{ key: SortKey; ascending: boolean }>({
    key: 'value',
    ascending: false,
  });
  const [query, setQuery] = useState('');
  const [pins, setPins] = useState(initialPins);
  const [announcement, announce] = useState('');
  const search = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let active = true;
    document.title = 'Market summary  Vibe IDX';
    void load('market-summary.json').then(
      (data) => {
        if (active) setState({ kind: 'ready', data });
      },
      () => {
        if (active) setState({ kind: 'error' });
      },
    );
    const key = (event: KeyboardEvent) => {
      if (
        event.key === '/' &&
        !(event.target instanceof HTMLElement && /INPUT|TEXTAREA|SELECT/.test(event.target.tagName))
      ) {
        event.preventDefault();
        search.current?.focus();
      }
    };
    document.addEventListener('keydown', key);
    return () => {
      active = false;
      document.title = 'Vibe IDX';
      document.removeEventListener('keydown', key);
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
  const field = (stock: Stock, key: SortKey) =>
    key === 'ticker' || key === 'close'
      ? stock[key]
      : key === 'acc'
        ? (accumulation.get(stock.ticker)?.pct ?? null)
        : key === 'size'
          ? (accumulation.get(stock.ticker)?.size ?? null)
          : stock.windows[period][key];
  const rows = (data?.stocks ?? [])
    .filter((stock) =>
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
  const togglePin = (ticker: string) => {
    const next = pins.includes(ticker) ? pins.filter((pin) => pin !== ticker) : [...pins, ticker];
    setPins(next);
    writeStorage('vibe-idx:watchlist', JSON.stringify(next));
    announce(`${ticker} ${next.includes(ticker) ? 'pinned' : 'unpinned'}`);
  };
  return (
    <div className="market-page">
      <header className="topbar">
        <div className="wrap topbar-inner">
          <a className="wordmark" href="/" aria-label="Vibe IDX home">
            Vibe <span>IDX</span>
          </a>
          <nav className="main-nav" aria-label="Main">
            <a href="/">Home</a>
            <a href="/market" aria-current="page">
              Market
            </a>
          </nav>
          <div className="search">
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
              aria-controls="market-rows"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <span className="keyhint">/</span>
          </div>
          {user && (
            <div className="signin">
              <AccountControls />
            </div>
          )}
        </div>
      </header>
      <main className="wrap">
        <div className="freshness">
          {data?.date && (
            <>
              Prices <time dateTime={data.date}>{dateText(data.date)}</time>
            </>
          )}
        </div>
        <div className="section-head">
          <h1>Market summary</h1>
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
          <div className="table-scroll" role="region" aria-label="Market stocks" tabIndex={0}>
            <table>
              <caption>Every IDX stock traded on the latest price date</caption>
              <colgroup>
                {['stock', 'close', 'change', 'value', 'volume', 'acc', 'size', 'pin-col'].map(
                  (name) => (
                    <col key={name} className={name} />
                  ),
                )}
              </colgroup>
              <thead>
                <tr>
                  {columns.map((column) =>
                    column.key === 'acc' && !privateData ? (
                      <th key={column.key} scope="col" className="accumulation-gate">
                        {column.label}{' '}
                        {isLoading || (user && privateState.kind === 'loading') ? (
                          <span role="status">Loading…</span>
                        ) : !user ? (
                          <SignInButton />
                        ) : (
                          <span role="alert">
                            Unavailable{' '}
                            <button onClick={() => window.location.reload()}>Reload</button>
                          </span>
                        )}
                      </th>
                    ) : column.key === 'size' && !privateData ? (
                      <th key={column.key} scope="col" />
                    ) : (
                      <th
                        key={column.key}
                        scope="col"
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
                    ),
                  )}
                  <th scope="col">
                    <span className="sr-only">Pin</span>
                  </th>
                </tr>
              </thead>
              <tbody id="market-rows">
                {rows.map((stock) => {
                  const metrics = stock.windows[period],
                    acc = accumulation.get(stock.ticker),
                    pinned = pins.includes(stock.ticker);
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
                      <td>
                        <a className="stock-link" href={`/t/${stock.ticker}`}>
                          <strong>{stock.ticker}</strong>
                          <span className="company" title={stock.name}>
                            {stock.name}
                          </span>
                        </a>
                      </td>
                      <td>{stock.close === null ? '—' : nf(stock.close)}</td>
                      <td
                        className={direction(metrics.change_pct ?? 0)}
                        title={
                          metrics.change_pct === null
                            ? 'Price data is missing'
                            : `${metrics.change_pct}%`
                        }
                      >
                        {pct(metrics.change_pct)}
                      </td>
                      <td
                        title={
                          metrics.value === null
                            ? 'Traded value is missing'
                            : `${nf(metrics.value)} IDR`
                        }
                      >
                        {compact(metrics.value)}
                      </td>
                      <td
                        title={
                          metrics.rel_volume === null
                            ? 'Volume data is missing'
                            : `${metrics.rel_volume}×`
                        }
                      >
                        {metrics.rel_volume === null ? '—' : nf(metrics.rel_volume, 1) + '×'}
                      </td>
                      {privateData ? (
                        <td
                          title={
                            acc
                              ? `${brokerName(acc.broker)}; ${acc.pct * 100}% of traded volume`
                              : 'Broker data is incomplete for this window.'
                          }
                        >
                          {acc ? (
                            <>
                              {nf(acc.pct * 100, 1)}%<span className="broker">{acc.broker}</span>
                            </>
                          ) : (
                            '—'
                          )}
                        </td>
                      ) : (
                        <td />
                      )}
                      <td
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
                      <td>
                        <button
                          className="pin"
                          type="button"
                          aria-label={`${pinned ? 'Unpin' : 'Pin'} ${stock.ticker}`}
                          aria-pressed={pinned}
                          onClick={() => togglePin(stock.ticker)}
                        >
                          <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M7 3h10v18l-5-3-5 3z" />
                          </svg>
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {!rows.length && (
                  <tr>
                    <td colSpan={8} className="empty-state">
                      {query
                        ? 'No stocks match this search.'
                        : 'No stocks traded on the latest date.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
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
