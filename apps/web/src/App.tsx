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
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type MouseEvent,
  type ReactNode,
  type SetStateAction,
} from 'react';

import { trpc, type RouterInputs, type RouterOutputs } from './trpc';

type SurfaceId = 'prices' | 'fivePct' | 'onePct' | 'insiders';
type Primitive = number | string | null;
type BaseFilters = { page: number; pageSize: number; q: string; ticker: string };
type TransactionType = 'BUY' | 'SELL' | 'BUYBACK' | 'GRANT' | 'TRANSFER' | 'OTHER';

type PriceRow = RouterOutputs['prices']['list']['rows'][number];
type PriceSort = NonNullable<RouterInputs['prices']['list']['sort']>;
type FivePctRow = RouterOutputs['ownership']['fivePct']['list']['rows'][number];
type FivePctAccountRow = FivePctRow['accounts'][number];
type OnePctRow = RouterOutputs['ownership']['onePct']['list']['rows'][number];
type InsiderRow = RouterOutputs['insiders']['transactions']['list']['rows'][number];

export const dailyPricesPrefetchPages = 5;

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
    description: 'KSEI major shareholder rows and percentage-change summary.',
    path: '/ownership/5pct',
  },
  {
    id: 'onePct',
    label: '1% Ownership',
    description: 'Monthly KSEI shareholder concentration list.',
    path: '/ownership/1pct',
  },
  {
    id: 'insiders',
    label: 'Insider Transactions',
    description: 'Daily ownership-change disclosures at transaction level.',
    path: '/insiders',
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
        <Workspace initialUrl={initialUrl} />
      </QueryClientProvider>
    </trpc.Provider>
  );
}

function Workspace({ initialUrl }: { initialUrl?: string }) {
  const [location, navigateToPath, replaceSearch] = useWorkspaceLocation(initialUrl);
  const route = resolveWorkspaceRoute(location.pathname);
  const latestDates = trpc.meta.latestDates.useQuery();
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
          <Metric label="Prices" value={latestDates.data?.prices} />
          <Metric label="5%" value={latestDates.data?.fivePctOwnership} />
          <Metric label="1%" value={latestDates.data?.onePctOwnership} />
          <Metric label="Insider" value={latestDates.data?.insiderTransactions} />
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
              <p className="eyebrow">Read-only SQLite view</p>
              <h2 id="surface-title">{active.label}</h2>
            </div>
            <p>{active.description}</p>
          </div>

          {active.id === 'prices' ? (
            <PricesSurface onUrlSearchChange={replaceSearch} urlSearch={location.search} />
          ) : null}
          {active.id === 'fivePct' ? (
            <FivePctSurface onUrlSearchChange={replaceSearch} urlSearch={location.search} />
          ) : null}
          {active.id === 'onePct' ? (
            <OnePctSurface onUrlSearchChange={replaceSearch} urlSearch={location.search} />
          ) : null}
          {active.id === 'insiders' ? (
            <InsidersSurface onUrlSearchChange={replaceSearch} urlSearch={location.search} />
          ) : null}
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

export function keepPreviousListResult<T>(previousData: T | undefined) {
  return previousData;
}

export function maxPageForTotal(total: number, pageSize: number) {
  return Math.max(1, Math.ceil(total / pageSize));
}

export function nextPageFilters<F extends BaseFilters>(filters: F, total: number) {
  const maxPage = maxPageForTotal(total, filters.pageSize);

  if (filters.page >= maxPage) {
    return null;
  }

  return {
    ...filters,
    page: filters.page + 1,
  };
}

export function prefetchPageFilters<F extends BaseFilters>(
  filters: F,
  total: number,
  pagesAhead: number,
) {
  const maxPage = maxPageForTotal(total, filters.pageSize);
  const pageFilters: F[] = [];

  for (
    let page = filters.page + 1;
    page <= Math.min(maxPage, filters.page + pagesAhead);
    page += 1
  ) {
    pageFilters.push({
      ...filters,
      page,
    });
  }

  return pageFilters;
}

export async function prefetchSequentially<T>(
  items: T[],
  prefetch: (item: T) => Promise<unknown> | void,
  shouldContinue: () => boolean = () => true,
) {
  for (const item of items) {
    if (!shouldContinue()) {
      return;
    }
    await prefetch(item);
  }
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

function PricesSurface({ onUrlSearchChange, urlSearch }: UrlFilterProps) {
  const [filters, setFilters] = useUrlListFilters(
    urlSearch,
    onUrlSearchChange,
    { sort: 'tickerAsc' as PriceSort, tradeDate: '' },
    { pageSize: 10, urlKeys: { tradeDate: 'date' } },
  );
  const trpcUtils = trpc.useUtils();
  const priceQueryInput = useMemo(
    () => ({
      ...filters,
      tradeDate: filters.tradeDate || undefined,
    }),
    [filters],
  );
  const query = trpc.prices.list.useQuery(priceQueryInput, {
    placeholderData: keepPreviousListResult,
  });
  const datesQuery = trpc.prices.dates.useQuery();

  useEffect(() => {
    if (!query.data || query.isPlaceholderData) {
      return;
    }

    let isActive = true;
    const pageInputs = prefetchPageFilters(
      priceQueryInput,
      query.data.total,
      dailyPricesPrefetchPages,
    );

    void prefetchSequentially(
      pageInputs,
      (pageInput) => trpcUtils.prices.list.prefetch(pageInput),
      () => isActive,
    );

    return () => {
      isActive = false;
    };
  }, [priceQueryInput, query.data, query.isPlaceholderData, trpcUtils]);

  return (
    <SurfaceFrame
      dateLabel={filters.tradeDate ? 'Date' : 'Latest'}
      filters={filters}
      isLoading={query.isLoading}
      onFiltersChange={setFilters}
      pageInfo={query.data}
      extraControls={
        <>
          <DailyPriceSortSelector
            onSortChange={(sort) =>
              setFilters((current) => ({
                ...current,
                page: 1,
                sort,
              }))
            }
            selectedSort={filters.sort}
          />
          <SnapshotDateSelector
            dates={datesQuery.data ?? []}
            isLoading={datesQuery.isLoading}
            onDateChange={(tradeDate) =>
              setFilters((current) => ({
                ...current,
                page: 1,
                tradeDate,
              }))
            }
            selectedDate={filters.tradeDate}
          />
        </>
      }
    >
      <DailyPricesTable rows={query.data?.rows ?? []} />
      <QueryState error={query.error?.message} isLoading={query.isLoading} />
    </SurfaceFrame>
  );
}

function FivePctSurface({ onUrlSearchChange, urlSearch }: UrlFilterProps) {
  const [filters, setFilters] = useUrlListFilters<{
    asOfDate: string;
    view: 'all' | 'percentageChanges';
  }>(
    urlSearch,
    onUrlSearchChange,
    { asOfDate: '', view: 'all' },
    { urlKeys: { asOfDate: 'date' } },
  );
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
  return (
    <SnapshotDateSelector
      dates={dates}
      isLoading={isLoading}
      onDateChange={onDateChange}
      selectedDate={selectedDate}
    />
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

export function DailyPriceSortSelector({
  onSortChange,
  selectedSort,
}: {
  onSortChange: (sort: PriceSort) => void;
  selectedSort: PriceSort;
}) {
  const options: Array<{ label: string; value: PriceSort }> = [
    { label: 'Ticker A-Z', value: 'tickerAsc' },
    { label: '%1d price high', value: 'price1dDesc' },
    { label: '%1d volume high', value: 'volume1dDesc' },
    { label: '%3d volume high', value: 'volume3dDesc' },
  ];

  return (
    <label className="field compact-field sort-field">
      Sort
      <select
        onChange={(event) => onSortChange(event.target.value as PriceSort)}
        value={selectedSort}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function OnePctSurface({ onUrlSearchChange, urlSearch }: UrlFilterProps) {
  const [filters, setFilters] = useUrlListFilters(urlSearch, onUrlSearchChange, { investor: '' });
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

function InsidersSurface({ onUrlSearchChange, urlSearch }: UrlFilterProps) {
  const [filters, setFilters] = useUrlListFilters(urlSearch, onUrlSearchChange, {
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

export function createListFilters<T extends Record<string, unknown> = Record<never, never>>(
  extra?: T,
  options: { pageSize?: number } = {},
) {
  return {
    page: 1,
    pageSize: options.pageSize ?? 50,
    q: '',
    ticker: '',
    ...extra,
  } as BaseFilters & T;
}

export function createListFiltersFromSearch<
  T extends Record<string, unknown> = Record<never, never>,
>(
  search: string,
  extra?: T,
  options: { pageSize?: number; urlKeys?: Record<string, string> } = {},
) {
  const filters = createListFilters(extra, options);
  const params = new URLSearchParams(normalizeSearch(search).slice(1));

  filters.page = positiveIntegerParam(params.get('page'), filters.page);
  filters.pageSize = positiveIntegerParam(params.get('pageSize'), filters.pageSize);
  filters.q = params.get('q') ?? filters.q;
  filters.ticker = (params.get('ticker') ?? filters.ticker).toUpperCase();

  for (const [key, defaultValue] of Object.entries(extra ?? {})) {
    const paramName = options.urlKeys?.[key] ?? key;
    const value = params.get(paramName);
    if (value === null) {
      continue;
    }

    (filters as Record<string, unknown>)[key] =
      typeof defaultValue === 'number' ? Number(value) : value;
  }

  return filters;
}

export function filtersToSearch<F extends Record<string, unknown>>(
  filters: F,
  defaults: F,
  urlKeys: Record<string, string> = {},
) {
  const params = new URLSearchParams();
  const orderedKeys = [
    'q',
    'ticker',
    'page',
    'pageSize',
    ...Object.keys(filters).filter((key) => !['q', 'ticker', 'page', 'pageSize'].includes(key)),
  ];

  for (const key of orderedKeys) {
    if (!(key in filters)) {
      continue;
    }

    const value = filters[key];
    const defaultValue = defaults[key];

    if (!isUrlParamValue(value) || value === '') {
      continue;
    }

    if (isUrlParamValue(defaultValue) && String(value) === String(defaultValue)) {
      continue;
    }

    params.set(urlKeys[key] ?? key, String(value));
  }

  const encoded = params.toString();
  return encoded ? `?${encoded}` : '';
}

function isUrlParamValue(value: unknown): value is boolean | number | string {
  return ['boolean', 'number', 'string'].includes(typeof value);
}

function positiveIntegerParam(value: string | null, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function useUrlListFilters<T extends Record<string, unknown> = Record<never, never>>(
  search: string,
  onSearchChange: (search: string) => void,
  extra?: T,
  options: { pageSize?: number; urlKeys?: Record<string, string> } = {},
) {
  const filters = createListFiltersFromSearch(search, extra, options);
  const setFilters: Dispatch<SetStateAction<BaseFilters & T>> = (nextFilters) => {
    const currentFilters = createListFiltersFromSearch(search, extra, options);
    const resolvedFilters =
      typeof nextFilters === 'function' ? nextFilters(currentFilters) : nextFilters;
    onSearchChange(
      filtersToSearch(resolvedFilters, createListFilters(extra, options), options.urlKeys),
    );
  };

  return [filters, setFilters] as const;
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
  const maxPage = maxPageForTotal(total, filters.pageSize);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target instanceof HTMLElement ? event.target : null;
      const nextPage = pageFromPaginationHotkey(
        {
          key: event.key,
          targetIsContentEditable: target?.isContentEditable,
          targetTagName: target?.tagName,
        },
        filters.page,
        maxPage,
      );

      if (nextPage === null || isLoading) {
        return;
      }

      event.preventDefault();
      onFiltersChange((current) => ({
        ...current,
        page: nextPage,
      }));
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [filters.page, isLoading, maxPage, onFiltersChange]);

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
                        hasShareDelta
                          ? 'shareholder-name shareholder-name-changed'
                          : 'shareholder-name'
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
            <th className="broker-code-column">Broker</th>
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
              <td className="broker-code-cell">{formatText(account.brokerCode)}</td>
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
  textColumn('name', 'Name', (row) => row.name),
  numberColumn('price', 'Price', (row) => row.price),
  movementPercentColumn('price1dChangePercent', '%1d price', (row) => row.price1dChangePercent),
  movementPercentColumn('volume1dChangePercent', '%1d volume', (row) => row.volume1dChangePercent),
  movementPercentColumn('volume3dChangePercent', '%3d volume', (row) => row.volume3dChangePercent),
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
