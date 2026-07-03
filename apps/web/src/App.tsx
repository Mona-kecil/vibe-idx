import './styles.css';

import { httpBatchLink } from '@trpc/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table';
import { Fragment, useMemo, useState, type ReactNode } from 'react';

import { trpc, type RouterOutputs } from './trpc';

type SurfaceId = 'prices' | 'fivePct' | 'onePct' | 'insiders';
type Primitive = number | string | null;
type BaseFilters = { page: number; pageSize: number; q: string; ticker: string };
type TransactionType = 'BUY' | 'SELL' | 'BUYBACK' | 'GRANT' | 'TRANSFER' | 'OTHER';

type PriceRow = RouterOutputs['prices']['list']['rows'][number];
type FivePctRow = RouterOutputs['ownership']['fivePct']['list']['rows'][number];
type FivePctAccountRow = FivePctRow['accounts'][number];
type OnePctRow = RouterOutputs['ownership']['onePct']['list']['rows'][number];
type InsiderRow = RouterOutputs['insiders']['transactions']['list']['rows'][number];

type DataColumn<T> = {
  align?: 'right';
  header: string;
  id: string;
  render: (row: T) => ReactNode;
  sortValue: (row: T) => Primitive;
};

const surfaces: Array<{ id: SurfaceId; label: string; description: string }> = [
  {
    id: 'prices',
    label: 'Daily Prices',
    description: 'Latest IDX trading summary by ticker.',
  },
  {
    id: 'fivePct',
    label: '5% Ownership',
    description: 'KSEI major shareholder rows and percentage-change summary.',
  },
  {
    id: 'onePct',
    label: '1% Ownership',
    description: 'Monthly KSEI shareholder concentration list.',
  },
  {
    id: 'insiders',
    label: 'Insider Transactions',
    description: 'Daily ownership-change disclosures at transaction level.',
  },
];
const defaultSurface = surfaces[0]!;

export function renderAppTitle() {
  return 'Vibe IDX';
}

export function App() {
  const [queryClient] = useState(() => new QueryClient());
  const [trpcClient] = useState(() =>
    trpc.createClient({
      links: [
        httpBatchLink({
          url: '/trpc',
        }),
      ],
    }),
  );

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <Workspace />
      </QueryClientProvider>
    </trpc.Provider>
  );
}

function Workspace() {
  const [activeSurface, setActiveSurface] = useState<SurfaceId>('prices');
  const latestDates = trpc.meta.latestDates.useQuery();
  const active = surfaces.find((surface) => surface.id === activeSurface) ?? defaultSurface;

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">IDX monitoring workspace</p>
          <h1>{renderAppTitle()}</h1>
        </div>
        <div className="status-strip" aria-label="Latest available data dates">
          <Metric label="Prices" value={latestDates.data?.prices} />
          <Metric label="5%" value={latestDates.data?.fivePctOwnership} />
          <Metric label="1%" value={latestDates.data?.onePctOwnership} />
          <Metric label="Insider" value={latestDates.data?.insiderTransactions} />
        </div>
      </header>

      <nav className="surface-nav" aria-label="Data surfaces">
        {surfaces.map((surface) => (
          <button
            aria-pressed={surface.id === activeSurface}
            className="surface-tab"
            key={surface.id}
            onClick={() => setActiveSurface(surface.id)}
            type="button"
          >
            <span>{surface.label}</span>
            <small>{surface.description}</small>
          </button>
        ))}
      </nav>

      <section className="workspace-panel" aria-labelledby="surface-title">
        <div className="surface-heading">
          <div>
            <p className="eyebrow">Read-only SQLite view</p>
            <h2 id="surface-title">{active.label}</h2>
          </div>
          <p>{active.description}</p>
        </div>

        {activeSurface === 'prices' ? <PricesSurface /> : null}
        {activeSurface === 'fivePct' ? <FivePctSurface /> : null}
        {activeSurface === 'onePct' ? <OnePctSurface /> : null}
        {activeSurface === 'insiders' ? <InsidersSurface /> : null}
      </section>
    </main>
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

export function keepPreviousListResult<T>(previousData: T | undefined) {
  return previousData;
}

function PricesSurface() {
  const [filters, setFilters] = useListFilters();
  const query = trpc.prices.list.useQuery(filters, {
    placeholderData: keepPreviousListResult,
  });

  return (
    <SurfaceFrame
      filters={filters}
      isLoading={query.isLoading}
      onFiltersChange={setFilters}
      pageInfo={query.data}
    >
      <DataTable columns={priceColumns} rows={query.data?.rows ?? []} />
      <QueryState error={query.error?.message} isLoading={query.isLoading} />
    </SurfaceFrame>
  );
}

function FivePctSurface() {
  const [filters, setFilters] = useListFilters<{
    asOfDate: string;
    view: 'all' | 'percentageChanges';
  }>({ asOfDate: '', view: 'all' });
  const query = trpc.ownership.fivePct.list.useQuery(
    {
      ...filters,
      asOfDate: filters.asOfDate || undefined,
    },
    {
      placeholderData: keepPreviousListResult,
    },
  );
  const datesQuery = trpc.ownership.fivePct.dates.useQuery();

  return (
    <SurfaceFrame
      dateLabel={filters.asOfDate ? 'Date' : 'Latest'}
      filters={filters}
      isLoading={query.isLoading}
      onFiltersChange={setFilters}
      pageInfo={query.data}
      extraControls={
        <>
          <FivePctDateSelector
            dates={datesQuery.data ?? []}
            isLoading={datesQuery.isLoading}
            onDateChange={(asOfDate) =>
              setFilters((current) => ({
                ...current,
                asOfDate,
                page: 1,
              }))
            }
            selectedDate={filters.asOfDate}
          />
          <div className="segmented" aria-label="5 percent ownership view">
            {[
              ['all', 'All rows'],
              ['percentageChanges', '% Changes'],
            ].map(([view, label]) => (
              <button
                aria-pressed={filters.view === view}
                key={view}
                onClick={() =>
                  setFilters((current) => ({
                    ...current,
                    page: 1,
                    view: view as 'all' | 'percentageChanges',
                  }))
                }
                type="button"
              >
                {label}
              </button>
            ))}
          </div>
        </>
      }
    >
      <FivePctOwnershipTable rows={query.data?.rows ?? []} />
      <QueryState error={query.error?.message} isLoading={query.isLoading} />
    </SurfaceFrame>
  );
}

export function FivePctDateSelector({
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

function OnePctSurface() {
  const [filters, setFilters] = useListFilters({ investor: '' });
  const query = trpc.ownership.onePct.list.useQuery(filters, {
    placeholderData: keepPreviousListResult,
  });

  return (
    <SurfaceFrame
      filters={filters}
      isLoading={query.isLoading}
      onFiltersChange={setFilters}
      pageInfo={query.data}
      extraControls={
        <label className="field compact-field">
          Investor
          <input
            onChange={(event) =>
              setFilters((current) => ({
                ...current,
                investor: event.target.value,
                page: 1,
              }))
            }
            placeholder="holder name"
            value={filters.investor}
          />
        </label>
      }
    >
      <DataTable columns={onePctColumns} rows={query.data?.rows ?? []} />
      <QueryState error={query.error?.message} isLoading={query.isLoading} />
    </SurfaceFrame>
  );
}

function InsidersSurface() {
  const [filters, setFilters] = useListFilters({
    type: '' as '' | TransactionType,
  });
  const query = trpc.insiders.transactions.list.useQuery(
    {
      ...filters,
      type: filters.type || undefined,
    },
    {
      placeholderData: keepPreviousListResult,
    },
  );

  return (
    <SurfaceFrame
      filters={filters}
      isLoading={query.isLoading}
      onFiltersChange={setFilters}
      pageInfo={query.data}
      extraControls={
        <label className="field compact-field">
          Type
          <select
            onChange={(event) =>
              setFilters((current) => ({
                ...current,
                page: 1,
                type: event.target.value as '' | TransactionType,
              }))
            }
            value={filters.type}
          >
            <option value="">All</option>
            <option value="BUY">Buy</option>
            <option value="SELL">Sell</option>
            <option value="BUYBACK">Buyback</option>
            <option value="GRANT">Grant</option>
            <option value="TRANSFER">Transfer</option>
            <option value="OTHER">Other</option>
          </select>
        </label>
      }
    >
      <DataTable columns={insiderColumns} rows={query.data?.rows ?? []} />
      <QueryState error={query.error?.message} isLoading={query.isLoading} />
    </SurfaceFrame>
  );
}

function useListFilters<T extends Record<string, unknown> = Record<never, never>>(extra?: T) {
  return useState<BaseFilters & T>({
    page: 1,
    pageSize: 50,
    q: '',
    ticker: '',
    ...extra,
  } as BaseFilters & T);
}

function SurfaceFrame<
  F extends BaseFilters,
  T extends { latestDate: string | null; page: number; pageSize: number; total: number },
>({
  children,
  dateLabel = 'Latest',
  extraControls,
  filters,
  isLoading,
  onFiltersChange,
  pageInfo,
}: {
  children: ReactNode;
  dateLabel?: string;
  extraControls?: ReactNode;
  filters: F;
  isLoading: boolean;
  onFiltersChange: React.Dispatch<React.SetStateAction<F>>;
  pageInfo?: T;
}) {
  const total = pageInfo?.total ?? 0;
  const maxPage = Math.max(1, Math.ceil(total / filters.pageSize));

  return (
    <>
      <div className="toolbar">
        <label className="field">
          Search
          <input
            onChange={(event) =>
              onFiltersChange((current) => ({
                ...current,
                page: 1,
                q: event.target.value,
              }))
            }
            placeholder="ticker, issuer, holder"
            value={filters.q}
          />
        </label>
        <label className="field ticker-field">
          Ticker
          <input
            maxLength={8}
            onChange={(event) =>
              onFiltersChange((current) => ({
                ...current,
                page: 1,
                ticker: event.target.value.toUpperCase(),
              }))
            }
            placeholder="AADI"
            value={filters.ticker}
          />
        </label>
        {extraControls}
        <div className="pager" aria-label="Pagination">
          <button
            disabled={filters.page <= 1 || isLoading}
            onClick={() =>
              onFiltersChange((current) => ({
                ...current,
                page: Math.max(1, current.page - 1),
              }))
            }
            type="button"
          >
            Prev
          </button>
          <span>
            Page {filters.page} / {maxPage}
          </span>
          <button
            disabled={filters.page >= maxPage || isLoading}
            onClick={() =>
              onFiltersChange((current) => ({
                ...current,
                page: current.page + 1,
              }))
            }
            type="button"
          >
            Next
          </button>
        </div>
      </div>
      <div className="result-meta">
        <span>
          {dateLabel}: {pageInfo?.latestDate ?? '-'}
        </span>
        <span>{formatNumber(total)} rows</span>
      </div>
      {children}
    </>
  );
}

function DataTable<T extends object>({
  columns,
  rows,
}: {
  columns: Array<DataColumn<T>>;
  rows: T[];
}) {
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
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id}>
              {row.getVisibleCells().map((cell) => (
                <td
                  className={columnAlign(cell.column.columnDef) === 'right' ? 'numeric' : ''}
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
          <col className="ownership-col-issuer" />
          <col className="ownership-col-shareholder" />
          <col className="ownership-col-percent" />
          <col className="ownership-col-percent" />
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
            <th>Issuer</th>
            <th>Shareholder</th>
            <th className="numeric">Current %</th>
            <th className="numeric">Prev %</th>
            <th className="numeric">Current total shares</th>
            <th className="numeric">Share delta</th>
            <th className="numeric">Account count</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const isExpanded = expandedIds.has(row.id);
            const detailId = `details-${stableDomId(row.id)}`;
            const hasShareDelta =
              hasNonZeroValue(row.actualChange) || hasNonZeroValue(row.reportedChange);

            return (
              <Fragment key={row.id}>
                <tr className="ownership-summary-row">
                  <td className="expand-column">
                    <button
                      aria-controls={detailId}
                      aria-expanded={isExpanded}
                      aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${row.ticker} ${row.shareholderName}`}
                      className="expand-button"
                      onClick={() => toggleRow(row.id)}
                      type="button"
                    >
                      <span aria-hidden="true">{isExpanded ? '-' : '+'}</span>
                    </button>
                  </td>
                  <td className="ticker-cell">{row.ticker}</td>
                  <td>{formatText(row.issuerName)}</td>
                  <td>
                    <span
                      className={
                        hasShareDelta ? 'shareholder-name shareholder-name-changed' : 'shareholder-name'
                      }
                    >
                      {formatText(row.shareholderName)}
                    </span>
                    {row.kind === 'unlinkedAccounts' ? (
                      <span className="row-badge">Unlinked</span>
                    ) : null}
                  </td>
                  <td className="numeric">{formatPercent(row.currentPercent)}</td>
                  <td className="numeric">{formatPercent(row.previousPercent)}</td>
                  <td className="numeric">{formatNumber(row.currentTotalShares)}</td>
                  <td className="numeric">{formatNumber(row.actualChange)}</td>
                  <td className="numeric">{formatNumber(row.accountCount)}</td>
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
            <th>Status</th>
            <th className="numeric">Prev account shares</th>
            <th className="numeric">Current account shares</th>
            <th className="numeric">Prev %</th>
            <th className="numeric">Current %</th>
            <th className="numeric">Reported change</th>
            <th className="numeric">Actual change</th>
          </tr>
        </thead>
        <tbody>
          {accounts.map((account) => (
            <tr key={account.id}>
              <td>{formatText(account.accountHolderName)}</td>
              <td>{formatText(account.accountName)}</td>
              <td>{formatInvestorStatus(account.investorStatus)}</td>
              <td className="numeric">{formatNumber(account.previousShares)}</td>
              <td className="numeric">{formatNumber(account.currentShares)}</td>
              <td className="numeric">{formatPercent(account.previousPercent)}</td>
              <td className="numeric">{formatPercent(account.currentPercent)}</td>
              <td className="numeric">{formatNumber(account.reportedChange)}</td>
              <td className="numeric">{formatNumber(account.actualChange)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function QueryState({ error, isLoading }: { error?: string; isLoading: boolean }) {
  if (isLoading) {
    return <p className="query-state">Loading rows from SQLite...</p>;
  }

  if (error) {
    return <p className="query-state error">Backend unavailable: {error}</p>;
  }

  return null;
}

function columnAlign<T>(columnDef: ColumnDef<T, unknown>) {
  return (columnDef.meta as { align?: 'right' } | undefined)?.align;
}

const priceColumns: Array<DataColumn<PriceRow>> = [
  textColumn('ticker', 'Ticker', (row) => row.ticker),
  textColumn('name', 'Name', (row) => row.name),
  numberColumn('previous', 'Prev', (row) => row.previous),
  numberColumn('open', 'Open', (row) => row.open),
  numberColumn('high', 'High', (row) => row.high),
  numberColumn('low', 'Low', (row) => row.low),
  numberColumn('close', 'Close', (row) => row.close),
  numberColumn('volume', 'Volume', (row) => row.volume),
  numberColumn('value', 'Value', (row) => row.value),
];

const onePctColumns: Array<DataColumn<OnePctRow>> = [
  textColumn('ticker', 'Ticker', (row) => row.ticker),
  textColumn('issuerName', 'Issuer', (row) => row.issuerName),
  textColumn('investorName', 'Investor', (row) => row.investorName),
  textColumn('investorClassification', 'Class', (row) => row.investorClassification),
  textColumn('nationality', 'Nationality', (row) => row.nationality),
  numberColumn('totalHoldingShares', 'Shares', (row) => row.totalHoldingShares),
  percentColumn('percentage', 'Pct', (row) => row.percentage),
];

const insiderColumns: Array<DataColumn<InsiderRow>> = [
  textColumn('publishedDate', 'Published', (row) => row.publishedDate),
  textColumn('transactionDate', 'Transaction', (row) => row.transactionDate),
  textColumn('ticker', 'Ticker', (row) => row.ticker),
  textColumn('issuerName', 'Issuer', (row) => row.issuerName),
  textColumn('reporterName', 'Reporter', (row) => row.reporterName),
  textColumn('transactionType', 'Type', (row) => row.transactionType),
  numberColumn('shares', 'Shares', (row) => row.shares),
  numberColumn('price', 'Price', (row) => row.price),
  numberColumn('deltaTotal', 'Delta', (row) => row.deltaTotal),
  textColumn('purpose', 'Purpose', (row) => row.purpose),
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

function formatText(value: Primitive) {
  return value === null || value === '' ? '-' : String(value);
}

function formatNumber(value: number | null | undefined) {
  return value === null || value === undefined ? '-' : new Intl.NumberFormat('en-US').format(value);
}

function formatPercent(value: number | null | undefined) {
  return value === null || value === undefined ? '-' : `${value.toFixed(2)}%`;
}

function formatInvestorStatus(value: string | null) {
  if (value === 'L') {
    return 'Local';
  }

  if (value === 'A') {
    return 'Foreign';
  }

  return formatText(value);
}

function hasNonZeroValue(value: number | null | undefined) {
  return value !== null && value !== undefined && value !== 0;
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
