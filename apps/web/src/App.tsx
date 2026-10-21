import './styles.css';

import { useQuery } from 'convex/react';
import { api } from '../convex/_generated/api';
import type { Doc } from '../convex/_generated/dataModel';
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table';
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type MouseEvent,
  type ReactNode,
} from 'react';

type SurfaceId = 'prices' | 'fivePct' | 'onePct';
type Primitive = number | string | null | undefined;
type PriceRow = Omit<Doc<'dailyPrices'>, '_id' | '_creationTime'>;
type FivePctRow = Omit<Doc<'fivePctChanges'>, '_id' | '_creationTime'> & { _id: string };
type FivePctAccountRow = FivePctRow['accounts'][number];
type OnePctRow = Doc<'onePctHoldings'>;

type DataColumn<T> = {
  align?: 'right';
  cellClass?: (row: T) => string;
  header: string;
  id: string;
  render: (row: T) => ReactNode;
  sortValue: (row: T) => Primitive;
};

const surfaces: Array<{ id: SurfaceId; label: string; description: string; path: string }> = [
  {
    id: 'prices',
    label: 'Daily Prices',
    description: 'Latest IDX trading summary by ticker.',
    path: '/prices',
  },
  {
    id: 'fivePct',
    label: '5% Ownership',
    description: 'KSEI major shareholder changes by date.',
    path: '/ownership/5pct',
  },
  {
    id: 'onePct',
    label: '1% Ownership',
    description: 'Monthly KSEI shareholder concentration list.',
    path: '/ownership/1pct',
  },
];
const defaultSurface = surfaces[0]!;
type WorkspaceRoute = { id: SurfaceId; status: 'ok' } | { pathname: string; status: 'notFound' };

type WorkspaceLocation = {
  pathname: string;
  search: string;
};

type UrlFilterProps = {
  onUrlSearchChange: (search: string) => void;
  urlSearch: string;
};

export function renderAppTitle() {
  return 'Vibe IDX';
}

export function App({ initialUrl }: { initialUrl?: string } = {}) {
  const [location, navigateToPath, replaceSearch] = useWorkspaceLocation(initialUrl);
  const route = resolveWorkspaceRoute(location.pathname);
  const latestDates = useQuery(api.ui.latestDates);
  const active =
    route.status === 'ok'
      ? (surfaces.find((surface) => surface.id === route.id) ?? defaultSurface)
      : null;

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">IDX monitoring workspace</p>
          <h1>{renderAppTitle()}</h1>
        </div>
        <div className="status-strip" aria-label="Latest available data dates">
          <Metric label="Prices" value={latestDates?.prices} />
          <Metric label="5%" value={latestDates?.fivePctOwnership} />
          <Metric label="1%" value={latestDates?.onePctOwnership} />
        </div>
      </header>

      <nav className="surface-nav" aria-label="Data surfaces">
        {surfaces.map((surface) => (
          <a
            aria-current={active?.id === surface.id ? 'page' : undefined}
            className="surface-tab"
            href={surface.path}
            key={surface.id}
            onClick={(event) => {
              if (shouldHandleAppLink(event)) {
                event.preventDefault();
                navigateToPath(surface.path);
              }
            }}
          >
            <span>{surface.label}</span>
            <small>{surface.description}</small>
          </a>
        ))}
      </nav>

      {active ? (
        <section className="workspace-panel" aria-labelledby="surface-title">
          <div className="surface-heading">
            <div>
              <p className="eyebrow">IDX source data</p>
              <h2 id="surface-title">{active.label}</h2>
            </div>
            <p>{active.description}</p>
          </div>

          <DataSurface
            key={active.id}
            kind={active.id}
            onUrlSearchChange={replaceSearch}
            urlSearch={location.search}
          />
        </section>
      ) : (
        <section className="workspace-panel" aria-labelledby="surface-title">
          <div className="surface-heading">
            <div>
              <p className="eyebrow">Unknown route</p>
              <h2 id="surface-title">Page not found</h2>
            </div>
            <p>The requested Vibe IDX page does not exist.</p>
          </div>
        </section>
      )}
    </main>
  );
}

export function resolveWorkspaceRoute(pathname: string): WorkspaceRoute {
  const normalizedPathname = normalizeWorkspacePath(pathname);

  if (normalizedPathname === '/') {
    return { id: 'prices', status: 'ok' };
  }

  const surface = surfaces.find((candidate) => candidate.path === normalizedPathname);
  if (surface) {
    return { id: surface.id, status: 'ok' };
  }

  return { pathname: normalizedPathname, status: 'notFound' };
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

function shouldHandleAppLink(event: MouseEvent<HTMLAnchorElement>) {
  return (
    event.button === 0 &&
    !event.defaultPrevented &&
    !event.metaKey &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.shiftKey
  );
}

function Metric({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value ?? '-'}</strong>
    </div>
  );
}

type PaginationHotkey = {
  key: string;
  targetIsContentEditable?: boolean;
  targetTagName?: string;
};

export function pageFromPaginationHotkey(
  event: PaginationHotkey,
  currentPage: number,
  maxPage: number,
) {
  if (isKeyboardTargetEditable(event)) {
    return null;
  }

  if (event.key === 'ArrowLeft') {
    return currentPage > 1 ? currentPage - 1 : null;
  }

  if (event.key === 'ArrowRight') {
    return currentPage < maxPage ? currentPage + 1 : null;
  }

  return null;
}

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

function DataSurface({ kind, onUrlSearchChange, urlSearch }: UrlFilterProps & { kind: SurfaceId }) {
  const dates = useQuery(api.ui.dates, { kind });
  const params = new URLSearchParams(urlSearch);
  const selectedDate = params.get('date') ?? '';
  const date = selectedDate || dates?.[0] || '';
  const ticker = params.get('ticker') ?? '';
  const search = params.get('q') ?? '';

  function changeFilter(key: string, value: string) {
    const next = new URLSearchParams(urlSearch);
    if (value) next.set(key, value);
    else next.delete(key);
    onUrlSearchChange(next.size ? `?${next}` : '');
  }

  return (
    <>
      <div className="toolbar">
        <label className="field">
          Search this page
          <input
            onChange={(event) => changeFilter('q', event.target.value)}
            placeholder="ticker, holder"
            value={search}
          />
        </label>
        <label className="field ticker-field">
          Exact ticker
          <input
            maxLength={8}
            onChange={(event) => changeFilter('ticker', event.target.value.toUpperCase())}
            placeholder="AADI"
            value={ticker}
          />
        </label>
        <SnapshotDateSelector
          dates={dates ?? []}
          isLoading={dates === undefined}
          onDateChange={(value) => changeFilter('date', value)}
          selectedDate={selectedDate}
        />
      </div>
      {date ? (
        <SnapshotPage
          key={`${kind}:${date}:${ticker}`}
          kind={kind}
          date={date}
          ticker={ticker}
          search={search}
        />
      ) : (
        <p className="query-state">
          {dates === undefined ? 'Loading dates...' : 'No data available.'}
        </p>
      )}
    </>
  );
}

function SnapshotPage({
  kind,
  date,
  ticker,
  search,
}: {
  kind: SurfaceId;
  date: string;
  ticker: string;
  search: string;
}) {
  const [cursors, setCursors] = useState<Array<string | null>>([null]);
  const result = useQuery(api.ui.list, {
    kind,
    date,
    ticker,
    cursor: cursors[cursors.length - 1] ?? null,
  });
  const isLoading = result === undefined;
  const canNext = result !== undefined && !result.isDone;

  const previous = useCallback(() => setCursors((current) => current.slice(0, -1)), []);
  const next = useCallback(() => {
    if (result && !result.isDone) setCursors((current) => [...current, result.continueCursor]);
  }, [result]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target instanceof HTMLElement ? event.target : null;
      const page = pageFromPaginationHotkey(
        {
          key: event.key,
          targetIsContentEditable: target?.isContentEditable,
          targetTagName: target?.tagName,
        },
        cursors.length,
        cursors.length + (canNext ? 1 : 0),
      );
      if (page === null || isLoading) return;
      event.preventDefault();
      if (page < cursors.length) previous();
      else next();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [cursors.length, canNext, isLoading, previous, next]);

  const matches = (row: { ticker: string; investorName?: string; issuerName?: string }) =>
    [row.ticker, row.investorName, row.issuerName].some((value) =>
      value?.toLowerCase().includes(search.toLowerCase()),
    );

  return (
    <>
      <div className="result-meta">
        <span>
          {kind === 'onePct' ? 'As of' : 'Date'}: {date} · Sort and search apply to this page.
        </span>
        <div className="pager" aria-label="Pagination">
          <button disabled={cursors.length <= 1 || isLoading} onClick={previous} type="button">
            Prev
          </button>
          <span>Page {cursors.length}</span>
          <button disabled={!canNext || isLoading} onClick={next} type="button">
            Next
          </button>
        </div>
      </div>
      {isLoading ? <p className="query-state">Loading rows...</p> : null}
      {result?.kind === 'prices' ? <DailyPricesTable rows={result.page.filter(matches)} /> : null}
      {result?.kind === 'fivePct' ? (
        <FivePctOwnershipTable rows={result.page.filter(matches)} />
      ) : null}
      {result?.kind === 'onePct' ? (
        <DataTable columns={onePctColumns} rows={result.page.filter(matches)} />
      ) : null}
    </>
  );
}

export function SnapshotDateSelector({
  dates,
  isLoading = false,
  onDateChange,
  selectedDate,
}: {
  dates: string[];
  isLoading?: boolean;
  onDateChange: (date: string) => void;
  selectedDate: string;
}) {
  const visibleDates =
    selectedDate && !dates.includes(selectedDate) ? [selectedDate, ...dates] : dates;

  return (
    <label className="field compact-field date-field">
      Date
      <select
        disabled={isLoading && dates.length === 0}
        onChange={(event) => onDateChange(event.target.value)}
        value={selectedDate}
      >
        <option value="">Latest</option>
        {visibleDates.map((date) => (
          <option key={date} value={date}>
            {date}
          </option>
        ))}
      </select>
    </label>
  );
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

export function FivePctOwnershipTable({
  initialExpandedIds = [],
  rows,
}: {
  initialExpandedIds?: string[];
  rows: FivePctRow[];
}) {
  const [expandedIds, setExpandedIds] = useState(() => new Set(initialExpandedIds));

  function toggleRow(rowId: string) {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(rowId)) {
        next.delete(rowId);
      } else {
        next.add(rowId);
      }

      return next;
    });
  }

  return (
    <div className="table-wrap ownership-table-wrap">
      <table className="ownership-table">
        <colgroup>
          <col className="ownership-col-expand" />
          <col className="ownership-col-ticker" />
          <col className="ownership-col-shareholder" />
          <col className="ownership-col-percent" />
          <col className="ownership-col-percent" />
          <col className="ownership-col-shares" />
          <col className="ownership-col-shares" />
          <col className="ownership-col-delta" />
          <col className="ownership-col-count" />
        </colgroup>
        <thead>
          <tr>
            <th className="expand-column">
              <span className="visually-hidden">Expand</span>
            </th>
            <th>Ticker</th>
            <th>Shareholder</th>
            <th className="numeric">Current %</th>
            <th className="numeric">Prev %</th>
            <th className="numeric">Previous shares</th>
            <th className="numeric">Current shares</th>
            <th className="numeric">Share delta</th>
            <th className="numeric">Account count</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const isExpanded = expandedIds.has(row._id);
            const detailId = `details-${stableDomId(row._id)}`;
            const hasShareDelta = hasNonZeroValue(row.currentCombined - row.previousCombined);

            return (
              <Fragment key={row._id}>
                <tr className="ownership-summary-row">
                  <td className="expand-column">
                    <button
                      aria-controls={detailId}
                      aria-expanded={isExpanded}
                      aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${row.ticker} ${row.investorName}`}
                      className="expand-button"
                      onClick={() => toggleRow(row._id)}
                      type="button"
                    >
                      <span aria-hidden="true">{isExpanded ? '-' : '+'}</span>
                    </button>
                  </td>
                  <td className="ticker-cell">{row.ticker}</td>
                  <td>
                    <span
                      className={
                        hasShareDelta
                          ? 'shareholder-name shareholder-name-changed'
                          : 'shareholder-name'
                      }
                    >
                      {formatText(row.investorName)}
                    </span>
                  </td>
                  <td className="numeric">{formatPercent(row.currentPercent)}</td>
                  <td className="numeric">{formatPercent(row.previousPercent)}</td>
                  <td className="numeric">{formatNumber(row.previousCombined)}</td>
                  <td className="numeric">{formatNumber(row.currentCombined)}</td>
                  <td className="numeric">
                    {formatNumber(row.currentCombined - row.previousCombined)}
                  </td>
                  <td className="numeric">{formatNumber(row.accounts.length)}</td>
                </tr>
                {isExpanded ? (
                  <tr className="ownership-detail-row">
                    <td colSpan={9} id={detailId}>
                      <FivePctAccountDetails accounts={row.accounts} />
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
          {rows.length === 0 ? (
            <tr>
              <td className="empty" colSpan={9}>
                No rows for the current filters.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

function FivePctAccountDetails({ accounts }: { accounts: FivePctAccountRow[] }) {
  return (
    <div className="account-detail-panel">
      <table className="account-detail-table">
        <thead>
          <tr>
            <th>Nama Pemegang Rekening Efek</th>
            <th>Nama Rekening Efek</th>
            <th className="numeric">Previous shares</th>
            <th className="numeric">Current shares</th>
            <th className="numeric">Share change</th>
          </tr>
        </thead>
        <tbody>
          {accounts.map((account, index) => (
            <tr key={index}>
              <td>{account.holderName}</td>
              <td>{account.accountName}</td>
              <td className="numeric">{formatNumber(account.previousShares)}</td>
              <td className="numeric">{formatNumber(account.currentShares)}</td>
              <td className="numeric">{formatNumber(account.change)}</td>
            </tr>
          ))}
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

export function DailyPricesTable({ rows }: { rows: PriceRow[] }) {
  return <DataTable columns={priceColumns} rows={rows} />;
}

const priceColumns: Array<DataColumn<PriceRow>> = [
  textColumn('ticker', 'Ticker', (row) => row.ticker),
  numberColumn('close', 'Price', (row) => row.close),
  movementPercentColumn('price1dChangePercent', '%1d price', (row) =>
    row.previous ? (row.change / row.previous) * 100 : null,
  ),
  numberColumn('open', 'Open', (row) => row.open),
  numberColumn('high', 'High', (row) => row.high),
  numberColumn('low', 'Low', (row) => row.low),
  numberColumn('volume', 'Volume', (row) => row.volume),
  numberColumn('value', 'Value', (row) => row.value),
];

const onePctColumns: Array<DataColumn<OnePctRow>> = [
  textColumn('ticker', 'Ticker', (row) => row.ticker),
  textColumn('issuerName', 'Issuer', (row) => row.issuerName),
  textColumn('investorName', 'Investor', (row) => row.investorName),
  textColumn('classification', 'Class', (row) => row.classification),
  textColumn('nationality', 'Nationality', (row) => row.nationality),
  numberColumn('total', 'Shares', (row) => row.total),
  percentColumn('percent', 'Pct', (row) => row.percent),
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

function hasNonZeroValue(value: number | null | undefined) {
  return value !== null && value !== undefined && value !== 0;
}

function movementCellClass(value: number | null | undefined) {
  if (value === null || value === undefined || value === 0) {
    return '';
  }

  return value > 0 ? 'movement-positive' : 'movement-negative';
}

function stableDomId(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, '-');
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
