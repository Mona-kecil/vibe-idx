import { useEffect, useMemo, useRef, useState } from 'react';
import { AccountControls } from '../BrokerPanel';
import { load, type Health, type Market, type Stock, type Ticker } from '../data';
import { holdingSeries, ownershipEvents, registryAt, type Selection } from './logic';
import { dateText, direction, nf, short, signed } from './format';
import { PriceChart, visiblePrices, type Period } from './PriceChart';
import { SelectionSummary, FilingsNews } from './Feeds';
import { Ownership } from './Ownership';
import { BrokerFlow } from './BrokerFlow';
import './ticker.css';

export function TickerPage({ ticker }: { ticker: string }) {
  const [state, setState] = useState<
    { kind: 'loading' | 'error' | 'missing' } | { kind: 'ready'; data: Ticker }
  >({ kind: 'loading' });
  const [health, setHealth] = useState<Health | null>(null),
    [market, setMarket] = useState<Market | null>(null),
    [stocks, setStocks] = useState<Stock[]>([]);
  useEffect(() => {
    let active = true;
    void load(`ticker/${ticker}.json`).then(
      (data) => {
        if (active) setState(data ? { kind: 'ready', data } : { kind: 'missing' });
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
    void load('market.json').then(
      (data) => {
        if (active) setMarket(data);
      },
      () => {},
    );
    void load('tickers.json').then(
      (data) => {
        if (active) setStocks(data);
      },
      () => {},
    );
    return () => {
      active = false;
    };
  }, [ticker]);
  useEffect(() => {
    document.title = `${ticker}  Vibe IDX`;
    return () => {
      document.title = 'Vibe IDX';
    };
  }, [ticker]);
  return (
    <div className="ticker-page">
      <TickerNav market={market} stocks={stocks} />
      {state.kind === 'ready' ? (
        <TickerDetail key={ticker} data={state.data} health={health} />
      ) : (
        <main className="wrap ticker-state">
          {state.kind === 'loading' ? (
            <p role="status">Loading data…</p>
          ) : state.kind === 'missing' ? (
            <p>
              Ticker {ticker} not found. <a href="/">Open workspace</a>
            </p>
          ) : (
            <p role="alert">
              Could not load {ticker}.{' '}
              <button onClick={() => window.location.reload()}>Reload</button>
            </p>
          )}
        </main>
      )}
    </div>
  );
}
function TickerNav({ market, stocks }: { market: Market | null; stocks: Stock[] }) {
  const [query, setQuery] = useState(''),
    [open, setOpen] = useState(false),
    search = useRef<HTMLInputElement>(null),
    container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
      if (
        e.key === '/' &&
        !(e.target instanceof HTMLElement && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName))
      ) {
        e.preventDefault();
        search.current?.focus();
      }
    };
    const outside = (e: MouseEvent) => {
      if (e.target instanceof Node && !container.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('keydown', key);
    document.addEventListener('click', outside);
    return () => {
      document.removeEventListener('keydown', key);
      document.removeEventListener('click', outside);
    };
  }, []);
  const matches = stocks
      .filter((s) => (s.ticker + ' ' + s.name).toLowerCase().includes(query.toLowerCase()))
      .slice(0, 12),
    latest = market?.history.at(-1);
  return (
    <header className="topbar">
      <div className="wrap topbar-inner">
        <a className="wordmark" href="/" aria-label="Vibe IDX home">
          Vibe <span>IDX</span>
        </a>
        <div className="search" ref={container}>
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
            aria-label="Search tickers"
            autoComplete="off"
            aria-controls="ticker-results"
            aria-expanded={open && !!query}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && matches[0])
                window.location.assign(`/t/${matches[0].ticker}`);
            }}
          />
          <span className="keyhint">/</span>
          {open && query && (
            <div className="search-results" id="ticker-results">
              {matches.length ? (
                matches.map((s) => (
                  <a className="search-option" key={s.ticker} href={`/t/${s.ticker}`}>
                    <b>{s.ticker}</b>
                    <small>{s.name}</small>
                  </a>
                ))
              ) : (
                <div className="search-option">No tickers found</div>
              )}
            </div>
          )}
        </div>
        {latest && (
          <div className="ihsg">
            <span className="market-label">IHSG</span>
            <strong>{nf(latest.close, 3)}</strong>
            {latest.change_pct !== null && (
              <span className={`change ${direction(latest.change_pct)}`}>
                {signed(latest.change_pct, (v) => nf(v, 2))}%
              </span>
            )}
          </div>
        )}
        <div className="language" aria-label="Language">
          <b>EN</b>
          <span>/</span>
          <span>ID</span>
        </div>
        <div className="signin">
          <AccountControls />
        </div>
      </div>
    </header>
  );
}
function TickerDetail({ data, health }: { data: Ticker; health: Health | null }) {
  const [selection, select] = useState<Selection>(null),
    [period, setPeriod] = useState<Period>('3M');
  const dailyDate =
    health?.five_pct ??
    data.changes
      .map((c) => c.date)
      .sort()
      .at(-1) ??
    null;
  const events = useMemo(() => ownershipEvents(data), [data]);
  const series = useMemo(() => holdingSeries(data, dailyDate, events), [data, dailyDate, events]);
  const prices = data.prices,
    last = prices.at(-1),
    previous = prices.at(-2),
    first = prices[0];
  const registry = registryAt(data, last?.date ?? dailyDate ?? '');
  const change = last && previous ? last.close - previous.close : null,
    pct = change !== null && previous?.close ? (change / previous.close) * 100 : null,
    ytd = last && first?.close ? (last.close / first.close - 1) * 100 : null;
  const visible = visiblePrices(prices, period);
  const stats = last
    ? [
        { label: 'Volume', value: short(last.volume), title: nf(last.volume) + ' shares', cls: '' },
        {
          label: 'Value',
          unit: 'IDR',
          value: short(last.value),
          title: nf(last.value) + ' IDR',
          cls: '',
        },
        {
          label: 'Net foreign (est.)',
          value: signed(last.net_foreign),
          title: nf(last.net_foreign) + ' IDR',
          cls: direction(last.net_foreign),
        },
        {
          label: 'YTD change',
          value: ytd === null ? '—' : signed(ytd, (v) => nf(v, 2)) + '%',
          title: first ? `From first available close: ${dateText(first.date)}` : '',
          cls: direction(ytd),
        },
        {
          label: 'Free float',
          value: registry?.free_float_pct == null ? '—' : nf(registry.free_float_pct, 2) + '%',
          title: registry
            ? `${registry.free_float_shares === null ? '' : nf(registry.free_float_shares) + ' shares  '}${dateText(registry.date)}`
            : '',
          cls: '',
        },
        {
          label: 'Shareholders',
          value: registry?.sid_count == null ? '—' : nf(registry.sid_count),
          title: registry ? dateText(registry.date) : '',
          cls: '',
        },
        {
          label: 'Total shares',
          value: registry?.total_shares == null ? '—' : short(registry.total_shares),
          title: registry?.total_shares
            ? `${nf(registry.total_shares)} shares  ${dateText(registry.date)}`
            : '',
          cls: '',
        },
      ]
    : [];
  return (
    <main className="wrap">
      <div className="freshness">
        {last && <span>Prices {dateText(health?.prices ?? last.date)}</span>}
        {dailyDate && <span>5% ownership {dateText(dailyDate)}</span>}
        {registry && <span>Registry {dateText(registry.date)}</span>}
      </div>
      <div className="ticker-header">
        <div className="identity">
          <h1>{data.ticker}</h1>
          <p>{data.name.replace(/\.$/, '')}</p>
        </div>
        {last && (
          <div className="price">
            <div className="price-main">
              <span className="currency">IDR</span>
              {nf(last.close)}
            </div>
            <div className="price-change">
              <span className={direction(change)}>
                {change === null
                  ? '—'
                  : `${signed(change, nf)} (${signed(pct ?? 0, (v) => nf(v, 2))}%)`}
              </span>
              <span className="price-date">{dateText(last.date)}</span>
            </div>
          </div>
        )}
      </div>
      <dl className="stats">
        {stats.map((s) => (
          <div className="stat" key={s.label}>
            <dt>
              {s.label}
              {s.unit && <small className="unit-suffix">{s.unit}</small>}
            </dt>
            <dd className={s.cls} title={s.title || undefined}>
              {s.value}
            </dd>
          </div>
        ))}
      </dl>
      <PriceChart
        ticker={data.ticker}
        prices={prices}
        period={period}
        setPeriod={setPeriod}
        selection={selection}
        select={select}
      >
        <SelectionSummary
          data={data}
          events={events}
          selection={selection}
          clear={() => select(null)}
        />
      </PriceChart>
      {last && (
        <BrokerFlow
          ticker={data.ticker}
          selection={selection}
          start={visible[0]?.date ?? last.date}
          end={last.date}
        />
      )}
      <Ownership
        data={data}
        series={series}
        events={events}
        selection={selection}
        dailyDate={dailyDate}
      />
      <FilingsNews data={data} events={events} selection={selection} />
      <footer>
        <span className="footer-brand">Vibe IDX</span>
        <span>
          {data.ticker}
          <span className="footer-exchange">Indonesia Stock Exchange</span>
        </span>
      </footer>
    </main>
  );
}
