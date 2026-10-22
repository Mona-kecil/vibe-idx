import './styles.css';

import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table';
import { useCallback, useEffect, useMemo, useState, type MouseEvent, type ReactNode } from 'react';

import {
  load,
  type Health,
  type Market,
  type Feed,
  type Stock,
  type Ticker,
  type OwnershipChange,
} from './data';

type Primitive = number | string | null | undefined;
type DataColumn<T> = {
  align?: 'right';
  cellClass?: (row: T) => string;
  header: string;
  id: string;
  render: (row: T) => ReactNode;
  sortValue: (row: T) => Primitive;
};

type WorkspaceLocation = { pathname: string; search: string };
type WorkspaceRoute =
  | { id: 'radar' | 'stocks' }
  | { id: 'ticker'; ticker: string }
  | { id: 'notFound' };
type InitialData = {
  health?: Health;
  radar?: { market: Market; feed: Feed };
  ticker?: Ticker | null;
};
type DataState<T> = { status: 'loading' } | { status: 'error' } | { status: 'ready'; data: T };

const readHealth = () => load('health.json');
const readStocks = () => load('tickers.json');
const readRadar = async () => {
  const [market, feed] = await Promise.all([load('market.json'), load('feed.json')]);
  return { market, feed };
};

function useData<T>(read: () => Promise<T>, initial?: T): DataState<T> {
  const [state, setState] = useState<DataState<T>>(() =>
    initial === undefined ? { status: 'loading' } : { status: 'ready', data: initial },
  );
  useEffect(() => {
    if (initial !== undefined) return;
    let active = true;
    read().then(
      (data) => {
        if (active) setState({ status: 'ready', data });
      },
      () => {
        if (active) setState({ status: 'error' });
      },
    );
    return () => {
      active = false;
    };
  }, [read, initial]);
  return state;
}

function QueryState({ status }: { status: 'loading' | 'error' }) {
  return (
    <p
      role={status === 'error' ? 'alert' : 'status'}
      className={`query-state ${status === 'error' ? 'error' : ''}`}
    >
      {status === 'loading' ? 'Loading data…' : 'Could not load data. Reload to try again.'}
    </p>
  );
}

export function App({
  initialUrl,
  initialData = {},
}: { initialUrl?: string; initialData?: InitialData } = {}) {
  const [location, navigateToPath, replaceSearch] = useWorkspaceLocation(initialUrl);
  const route = resolveWorkspaceRoute(location.pathname);
  const health = useData(readHealth, initialData.health);

  function followLink(event: MouseEvent<HTMLElement>) {
    const anchor = event.target instanceof Element ? event.target.closest('a') : null;
    const href = anchor?.getAttribute('href');
    if (
      href?.startsWith('/') &&
      event.button === 0 &&
      !event.defaultPrevented &&
      !event.metaKey &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.shiftKey
    ) {
      event.preventDefault();
      navigateToPath(href);
    }
  }

  return (
    <main className="app-shell" onClick={followLink}>
      <header className="topbar">
        <div>
          <p className="eyebrow">IDX anomaly radar</p>
          <h1>Vibe IDX</h1>
        </div>
        {health.status === 'ready' ? (
          <div className="status-strip" aria-label="Latest available data dates">
            <Metric label="Prices" value={health.data.prices} />
            <Metric label="IHSG" value={health.data.indices} />
            <Metric label="5% ownership" value={health.data.five_pct} />
            <Metric label="Issuers" value={health.data.issuers} />
          </div>
        ) : (
          <QueryState status={health.status} />
        )}
      </header>
      <nav className="surface-nav" aria-label="Data surfaces">
        <a
          className="surface-tab"
          aria-current={route.id === 'radar' ? 'page' : undefined}
          href="/"
        >
          <span>Radar</span>
          <small>Daily signals across the market.</small>
        </a>
        <a
          className="surface-tab"
          aria-current={route.id === 'stocks' ? 'page' : undefined}
          href="/stocks"
        >
          <span>Stocks</span>
          <small>Prices, volume and foreign flows.</small>
        </a>
      </nav>
      <section className="workspace-panel">
        {route.id === 'radar' ? <RadarPage initial={initialData.radar} /> : null}
        {route.id === 'stocks' ? (
          <StocksPage
            urlSearch={location.search}
            onUrlSearchChange={replaceSearch}
            date={health.status === 'ready' ? health.data.prices : null}
          />
        ) : null}
        {route.id === 'ticker' ? (
          <TickerPage
            key={route.ticker}
            ticker={route.ticker}
            initial={initialData.ticker}
            ownershipDate={health.status === 'ready' ? health.data.five_pct : null}
          />
        ) : null}
        {route.id === 'notFound' ? <NotFound /> : null}
      </section>
    </main>
  );
}

function NotFound() {
  return (
    <div className="surface-heading">
      <div>
        <p className="eyebrow">Unknown route</p>
        <h2 id="surface-title">Page not found</h2>
      </div>
      <p>The requested Vibe IDX page does not exist.</p>
    </div>
  );
}

function resolveWorkspaceRoute(pathname: string): WorkspaceRoute {
  const path = normalizeWorkspacePath(pathname);
  if (path === '/') return { id: 'radar' };
  if (path === '/stocks') return { id: 'stocks' };
  const match = /^\/t\/([A-Z0-9-]+)$/.exec(path);
  if (match?.[1]) return { id: 'ticker', ticker: match[1] };
  return { id: 'notFound' };
}

function Metric({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value ?? '—'}</strong>
    </div>
  );
}

const feedGroups = [
  {
    kind: 'volume_spike',
    title: 'Volume spikes',
    rule: 'Volume is at least 5× the prior 20-day average, with at least Rp 5 billion traded.',
  },
  {
    kind: 'ara',
    title: 'ARA moves',
    rule: 'Price rose at least 34% below Rp 200, 24% below Rp 5,000, or 19% above, based on the previous close.',
  },
  {
    kind: 'foreign_streak',
    title: 'Foreign buying streaks',
    rule: 'Foreign investors bought more than they sold for at least 5 trading days in a row.',
  },
  {
    kind: 'green_on_red',
    title: 'Green on red',
    rule: 'The stock rose while IHSG fell at least 2%, with at least Rp 1 billion traded.',
  },
  {
    kind: 'five_pct_change',
    title: '5% ownership changes',
    rule: 'An investor changed shares or left the 5% list. An exit means a holding fell below 5%.',
  },
] satisfies Array<{ kind: Feed[number]['kind']; title: string; rule: string }>;

function RadarPage({ initial }: { initial?: InitialData['radar'] }) {
  const state = useData(readRadar, initial);
  if (state.status !== 'ready') return <QueryState status={state.status} />;
  const { market, feed } = state.data;
  const latest = market.history.at(-1);
  return (
    <>
      <div className="surface-heading">
        <div>
          <p className="eyebrow">Radar · {market.date}</p>
          <h2>IHSG {formatNumber(latest?.close)}</h2>
        </div>
        <p>
          <span className={movementCellClass(latest?.change_pct)}>
            {formatNumber(latest?.change)} · {formatPercent(latest?.change_pct)}
          </span>
          {' · '}
          {market.up} up · {market.down} down · Index date: {latest?.date ?? '—'}
        </p>
      </div>
      <LineChart points={market.history} label="IHSG close history" compact />
      {feedGroups.map((group) => {
        const items = feed.filter((item) => item.kind === group.kind);
        return (
          <section className="feed-group" key={group.kind} aria-label={group.title}>
            <h3>
              {group.title} <span className="row-badge">{items.length}</span>
            </h3>
            <p className="rule">{group.rule}</p>
            {items.length ? (
              <ul className="feed-list">
                {items.map((item, index) => (
                  <li key={`${item.ticker}:${index}`}>
                    <a className="ticker-cell" href={`/t/${item.ticker}`}>
                      {item.ticker}
                    </a>
                    <time>{item.date}</time>
                    <div>
                      <FeedNumbers item={item} />
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="empty">No signals.</p>
            )}
          </section>
        );
      })}
    </>
  );
}

function FeedNumbers({ item }: { item: Feed[number] }) {
  switch (item.kind) {
    case 'volume_spike':
      return (
        <>
          {formatNumber(item.numbers.volume)} shares · {item.numbers.multiple.toFixed(2)}× average (
          {formatNumber(item.numbers.avg_volume)} over {item.numbers.prior_days} days) · Rp{' '}
          {formatNumber(item.numbers.value)}
        </>
      );
    case 'ara':
      return (
        <>
          {formatNumber(item.numbers.prev)} → {formatNumber(item.numbers.close)} ·{' '}
          {formatPercent(item.numbers.change_pct)}
          {' · '}
          {item.numbers.band_pct}% threshold
        </>
      );
    case 'foreign_streak':
      return (
        <>
          {item.numbers.streak_days} trading days · Net foreign Rp{' '}
          {formatNumber(item.numbers.net_foreign)}
        </>
      );
    case 'green_on_red':
      return (
        <>
          Stock {formatPercent(item.numbers.change_pct)} · IHSG{' '}
          {formatPercent(item.numbers.market_change_pct)}
          {' · '}Rp {formatNumber(item.numbers.value)}
        </>
      );
    case 'five_pct_change':
      return (
        <>
          <OwnershipMovement change={item.numbers} /> · Since {item.numbers.previous_date}
        </>
      );
  }
}

function OwnershipMovement({ change }: { change: OwnershipChange }) {
  const exit = change.shares_after === null;
  const entry = change.pct_before === 0 && change.net_shares !== null && change.net_shares > 0;
  return (
    <>
      {change.investor} · {formatPercent(change.pct_before)} →{' '}
      {exit ? 'below 5%' : formatPercent(change.pct_after)}
      {' · '}
      {exit ? 'Exit' : entry ? 'Entry' : 'Change'} · Net shares: {formatNumber(change.net_shares)}
    </>
  );
}

function StocksPage({
  urlSearch,
  onUrlSearchChange,
  date,
}: {
  urlSearch: string;
  onUrlSearchChange: (search: string) => void;
  date: string | null;
}) {
  const state = useData(readStocks);
  const search = new URLSearchParams(urlSearch).get('q') ?? '';
  return (
    <>
      <div className="surface-heading">
        <h2>Stocks</h2>
        <p>Prices: {date ?? '—'} · All stocks on the latest trading date.</p>
      </div>
      <div className="toolbar">
        <label className="field">
          Filter stocks
          <input
            placeholder="Ticker or company name"
            value={search}
            onChange={(event) => {
              const params = new URLSearchParams();
              if (event.target.value) params.set('q', event.target.value);
              onUrlSearchChange(params.size ? `?${params}` : '');
            }}
          />
        </label>
      </div>
      {state.status !== 'ready' ? (
        <QueryState status={state.status} />
      ) : (
        <>
          <p className="result-meta">{state.data.length} stocks · Click a column to sort.</p>
          <DataTable
            columns={stockColumns}
            rows={state.data.filter((row) =>
              `${row.ticker} ${row.name}`.toLowerCase().includes(search.toLowerCase()),
            )}
          />
        </>
      )}
    </>
  );
}

function TickerPage({
  ticker,
  initial,
  ownershipDate,
}: {
  ticker: string;
  initial?: Ticker | null;
  ownershipDate: string | null;
}) {
  const read = useCallback(() => load(`ticker/${ticker}.json`), [ticker]);
  const state = useData(read, initial);
  if (state.status !== 'ready') return <QueryState status={state.status} />;
  if (!state.data || state.data.ticker !== ticker) return <NotFound />;
  const data = state.data;
  const latest = data.prices.at(-1);
  const previous = data.prices.at(-2);
  const change =
    latest && previous && previous.close ? (latest.close / previous.close - 1) * 100 : null;
  return (
    <>
      <div className="surface-heading">
        <div>
          <p className="eyebrow">
            {ticker} · Prices: {latest?.date ?? '—'}
          </p>
          <h2>{data.name}</h2>
        </div>
        <p className="quote">
          Rp {formatNumber(latest?.close)}{' '}
          <span className={movementCellClass(change)}>{formatPercent(change)}</span>
        </p>
      </div>
      <LineChart points={data.prices} label={`${ticker} closing price history`} />
      <h3>Recent trading days</h3>
      <DataTable columns={recentColumns} rows={data.prices.slice(-10).reverse()} />
      <h3>Current 5% holders</h3>
      <p className="rule">Ownership as of {ownershipDate ?? '—'}</p>
      <DataTable columns={holderColumns} rows={data.holders} />
      <h3>5% changes · Last 90 days</h3>
      <p className="rule">
        Ownership through {ownershipDate ?? '—'} · Each change uses its own reporting date.
      </p>
      {data.changes.length ? (
        <ul className="changes-list">
          {data.changes.map((change, index) => (
            <li key={`${change.date}:${index}`}>
              <time>{change.date}</time> · <OwnershipMovement change={change} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="query-state">No 5% changes in this period.</p>
      )}
    </>
  );
}

function LineChart({
  points,
  label,
  compact = false,
}: {
  points: Array<{ date: string; close: number }>;
  label: string;
  compact?: boolean;
}) {
  if (!points.length) return <p className="query-state">No price history.</p>;
  const low = Math.min(...points.map((point) => point.close));
  const high = Math.max(...points.map((point) => point.close));
  const height = compact ? 64 : 200;
  const line = points
    .map(
      (point, index) =>
        `${8 + (index / Math.max(1, points.length - 1)) * 984},${8 + ((high - point.close) / (high - low || 1)) * (height - 16)}`,
    )
    .join(' ');
  return (
    <figure className={`line-chart ${compact ? 'sparkline' : ''}`}>
      <svg viewBox={`0 0 1000 ${height}`} role="img" aria-label={label} preserveAspectRatio="none">
        <title>{label}</title>
        <polyline
          points={line}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <figcaption>
        <span>
          {points[0]?.date} → {points.at(-1)?.date}
        </span>
        <span>
          Close range {formatNumber(low)}–{formatNumber(high)}
        </span>
      </figcaption>
    </figure>
  );
}

function normalizeWorkspacePath(pathname: string) {
  const pathOnly = pathname.split('?')[0] || '/';
  const withLeadingSlash = pathOnly.startsWith('/') ? pathOnly : `/${pathOnly}`;
  return withLeadingSlash.length > 1 ? withLeadingSlash.replace(/\/+$/, '') : '/';
}

function useWorkspaceLocation(initialUrl?: string) {
  const [location, setLocation] = useState<WorkspaceLocation>(() =>
    initialWorkspaceLocation(initialUrl),
  );

  useEffect(() => {
    if (!canUseBrowserHistory()) {
      return;
    }

    const handlePopState = () => setLocation(currentBrowserLocation());
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const navigateToPath = useCallback((pathname: string) => {
    const nextLocation = { pathname: normalizeWorkspacePath(pathname), search: '' };
    if (canUseBrowserHistory()) {
      window.history.pushState(null, '', nextLocation.pathname);
    }
    setLocation(nextLocation);
  }, []);

  const replaceSearch = useCallback((search: string) => {
    setLocation((current) => {
      const nextLocation = {
        ...current,
        search: normalizeSearch(search),
      };
      if (canUseBrowserHistory()) {
        window.history.replaceState(null, '', `${current.pathname}${nextLocation.search}`);
      }
      return nextLocation;
    });
  }, []);

  return [location, navigateToPath, replaceSearch] as const;
}

function initialWorkspaceLocation(initialUrl?: string): WorkspaceLocation {
  if (initialUrl) {
    const url = new URL(initialUrl, 'http://vibe-idx.local');
    return {
      pathname: normalizeWorkspacePath(url.pathname),
      search: normalizeSearch(url.search),
    };
  }

  if (canUseBrowserHistory()) {
    return currentBrowserLocation();
  }

  return { pathname: '/', search: '' };
}

function currentBrowserLocation(): WorkspaceLocation {
  return {
    pathname: normalizeWorkspacePath(window.location.pathname),
    search: normalizeSearch(window.location.search),
  };
}

function canUseBrowserHistory() {
  return typeof window !== 'undefined' && typeof window.history?.pushState === 'function';
}

function normalizeSearch(search: string) {
  if (!search) {
    return '';
  }
  return search.startsWith('?') ? search : `?${search}`;
}

type PaginationHotkey = {
  key: string;
  targetIsContentEditable?: boolean;
  targetTagName?: string;
};

export function rowIndexFromKeyboard(
  event: PaginationHotkey,
  currentIndex: number | null,
  rowCount: number,
) {
  if (isKeyboardTargetEditable(event) || rowCount <= 0) {
    return null;
  }

  if (event.key === 'ArrowDown') {
    return currentIndex === null ? 0 : Math.min(rowCount - 1, currentIndex + 1);
  }

  if (event.key === 'ArrowUp') {
    return currentIndex === null ? rowCount - 1 : Math.max(0, currentIndex - 1);
  }

  return null;
}

function isKeyboardTargetEditable(event: PaginationHotkey) {
  if (event.targetIsContentEditable) {
    return true;
  }

  return ['INPUT', 'SELECT', 'TEXTAREA'].includes(event.targetTagName ?? '');
}

function DataTable<T extends object>({
  columns,
  rows,
}: {
  columns: Array<DataColumn<T>>;
  rows: T[];
}) {
  const [highlightedRowIndex, setHighlightedRowIndex] = useState<number | null>(null);
  const [sorting, setSorting] = useState<SortingState>([]);
  const tableColumns = useMemo<Array<ColumnDef<T, Primitive>>>(
    () =>
      columns.map((column) => ({
        accessorFn: column.sortValue,
        cell: ({ row }) => column.render(row.original),
        header: ({ column: tableColumn }) => (
          <button
            className="sort-button"
            onClick={tableColumn.getToggleSortingHandler()}
            type="button"
          >
            {column.header}
            <span>{sortGlyph(tableColumn.getIsSorted())}</span>
          </button>
        ),
        id: column.id,
        meta: {
          align: column.align,
          cellClass: column.cellClass,
        },
      })),
    [columns],
  );
  const table = useReactTable({
    columns: tableColumns,
    data: rows,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    onSortingChange: setSorting,
    state: {
      sorting,
    },
  });
  const visibleRows = table.getRowModel().rows;

  useEffect(() => {
    setHighlightedRowIndex(null);
  }, [rows]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target instanceof HTMLElement ? event.target : null;
      const nextIndex = rowIndexFromKeyboard(
        {
          key: event.key,
          targetIsContentEditable: target?.isContentEditable,
          targetTagName: target?.tagName,
        },
        highlightedRowIndex,
        visibleRows.length,
      );

      if (nextIndex === null) {
        return;
      }

      event.preventDefault();
      setHighlightedRowIndex(nextIndex);
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [highlightedRowIndex, visibleRows.length]);

  return (
    <div className="table-wrap">
      <table>
        <thead>
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <th
                  className={columnAlign(header.column.columnDef) === 'right' ? 'numeric' : ''}
                  key={header.id}
                >
                  {header.isPlaceholder
                    ? null
                    : flexRender(header.column.columnDef.header, header.getContext())}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {visibleRows.map((row, rowIndex) => (
            <tr
              aria-selected={rowIndex === highlightedRowIndex}
              className={rowIndex === highlightedRowIndex ? 'data-row-highlighted' : ''}
              key={row.id}
            >
              {row.getVisibleCells().map((cell) => (
                <td
                  className={cellClassName(cell.column.columnDef, cell.row.original)}
                  key={cell.id}
                >
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
          {rows.length === 0 ? (
            <tr>
              <td className="empty" colSpan={columns.length}>
                No rows for the current filters.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

function columnAlign<T>(columnDef: ColumnDef<T, unknown>) {
  return (columnDef.meta as { align?: 'right' } | undefined)?.align;
}

function cellClassName<T>(columnDef: ColumnDef<T, unknown>, row: T) {
  const meta = columnDef.meta as
    | {
        align?: 'right';
        cellClass?: (row: T) => string;
      }
    | undefined;

  return [meta?.align === 'right' ? 'numeric' : '', meta?.cellClass?.(row) ?? '']
    .filter(Boolean)
    .join(' ');
}

const stockColumns: Array<DataColumn<Stock>> = [
  {
    ...textColumn<Stock>('ticker', 'Ticker', (row) => row.ticker),
    render: (row) => (
      <a className="ticker-cell" href={`/t/${row.ticker}`}>
        {row.ticker}
      </a>
    ),
  },
  textColumn('name', 'Company', (row) => row.name),
  numberColumn('close', 'Close', (row) => row.close),
  movementPercentColumn('change_pct', 'Change', (row) => row.change_pct),
  numberColumn('volume', 'Volume', (row) => row.volume),
  numberColumn('value', 'Value (Rp)', (row) => row.value),
  numberColumn('net_foreign', 'Net foreign (Rp)', (row) => row.net_foreign),
];
const recentColumns: Array<DataColumn<Ticker['prices'][number]>> = [
  textColumn('date', 'Date', (row) => row.date),
  numberColumn('close', 'Close', (row) => row.close),
  numberColumn('volume', 'Volume', (row) => row.volume),
  numberColumn('value', 'Value (Rp)', (row) => row.value),
  numberColumn('net_foreign', 'Net foreign (Rp)', (row) => row.net_foreign),
];
const holderColumns: Array<DataColumn<Ticker['holders'][number]>> = [
  textColumn('investor', 'Investor', (row) => row.investor),
  numberColumn('shares', 'Shares', (row) => row.shares),
  percentColumn('pct', 'Holding', (row) => row.pct),
];

function textColumn<T>(id: string, header: string, value: (row: T) => Primitive): DataColumn<T> {
  return {
    header,
    id,
    render: (row) => formatText(value(row)),
    sortValue: value,
  };
}

function numberColumn<T>(
  id: string,
  header: string,
  value: (row: T) => number | null,
): DataColumn<T> {
  return {
    align: 'right',
    header,
    id,
    render: (row) => formatNumber(value(row)),
    sortValue: value,
  };
}

function percentColumn<T>(
  id: string,
  header: string,
  value: (row: T) => number | null,
): DataColumn<T> {
  return {
    align: 'right',
    header,
    id,
    render: (row) => formatPercent(value(row)),
    sortValue: value,
  };
}

function movementPercentColumn<T>(
  id: string,
  header: string,
  value: (row: T) => number | null,
): DataColumn<T> {
  return {
    ...percentColumn(id, header, value),
    cellClass: (row) => movementCellClass(value(row)),
  };
}

function formatText(value: Primitive) {
  return value === undefined || value === null || value === '' ? '-' : String(value);
}

function formatNumber(value: number | null | undefined) {
  return value === null || value === undefined ? '-' : new Intl.NumberFormat('en-US').format(value);
}

function formatPercent(value: number | null | undefined) {
  return value === null || value === undefined ? '-' : `${value.toFixed(2)}%`;
}

function movementCellClass(value: number | null | undefined) {
  if (value === null || value === undefined || value === 0) {
    return '';
  }

  return value > 0 ? 'movement-positive' : 'movement-negative';
}

function sortGlyph(sort: false | 'asc' | 'desc') {
  if (sort === 'asc') {
    return 'A-Z';
  }

  if (sort === 'desc') {
    return 'Z-A';
  }

  return '';
}
