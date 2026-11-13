import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { load, type Health, type Stock, type Ticker } from '../data';
import { usePublished } from '../publicData';
import { RiskFlagChips, useRiskFor } from '../RiskFlagChips';
import { PinButton, SiteHeader } from '../SiteHeader';
import { Stale } from '../Stale';
import { usePins } from '../watchlist';
import {
  holdingSeries,
  nextAction,
  ownershipEvents,
  registryAt,
  visiblePrices,
  type Period,
  type Selection,
  chartMarks,
  openingPeriod,
} from './logic';
import { calendarDate, dateText, direction, nf, short, signed, moveWord } from './format';
import { Freshness } from './Freshness';
import { PriceChart } from './PriceChart';
import { SelectionSummary, Timeline } from './Timeline';
import { Ownership } from './Ownership';
import { BrokerSummary } from './BrokerSummary';
import { ShareButton } from './ShareButton';
import './ticker.css';

export function TickerPage({ ticker }: { ticker: string }) {
  const [state, setState] = useState<
    { kind: 'loading' | 'error' | 'missing' } | { kind: 'ready'; data: Ticker }
  >({ kind: 'loading' });
  const [health, setHealth] = useState<Health | null>(null),
    [stocks, setStocks] = useState<Stock[]>([]);
  const [pins, toggle] = usePins(),
    [announcement, announce] = useState('');
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
  const pin = (symbol: string) => (
    <PinButton
      ticker={symbol}
      pinned={pins.includes(symbol)}
      toggle={() => announce(`${symbol} ${toggle(symbol) ? 'added to' : 'removed from'} watchlist`)}
    />
  );
  return (
    <div className="site ticker-page">
      <SiteHeader page="ticker" stocks={stocks} pin={pin} />
      {state.kind === 'ready' ? (
        <TickerDetail key={ticker} data={state.data} health={health} pin={pin} />
      ) : (
        <main className="wrap ticker-state">
          {state.kind === 'loading' ? (
            <p role="status">Loading data…</p>
          ) : state.kind === 'missing' ? (
            <p>
              Ticker {ticker} not found. <a href="/market">Open Market</a>
            </p>
          ) : (
            <p role="alert">
              Could not load {ticker}.{' '}
              <button onClick={() => window.location.reload()}>Reload</button>
            </p>
          )}
        </main>
      )}
      <div className="sr-only" role="status" aria-live="polite">
        {announcement}
      </div>
    </div>
  );
}
function TickerDetail({
  data,
  health,
  pin,
}: {
  data: Ticker;
  health: Health | null;
  pin: (ticker: string) => ReactNode;
}) {
  const [selection, select] = useState<Selection>(null),
    [period, setPeriod] = useState<Period>(openingPeriod);
  const risk = useRiskFor(data.ticker),
    actions = usePublished('actions');
  const dailyDate =
    health?.five_pct ??
    data.changes
      .map((c) => c.date)
      .sort()
      .at(-1) ??
    null;
  const events = useMemo(() => ownershipEvents(data), [data]);
  const series = useMemo(() => holdingSeries(data, dailyDate, events), [data, dailyDate, events]);
  const actionList = actions.kind === 'ready' ? actions.data.actions : null;
  const marks = useMemo(
    () => chartMarks(data, events, actionList ?? []),
    [data, events, actionList],
  );
  const prices = data.prices,
    last = prices.at(-1),
    previous = prices.at(-2),
    first = prices[0];
  const registry = registryAt(data, last?.date ?? dailyDate ?? '');
  const change = last && previous ? last.close - previous.close : null,
    pct = change !== null && previous?.close ? (change / previous.close) * 100 : null,
    ytd = last && first?.close ? (last.close / first.close - 1) * 100 : null;
  const visible = visiblePrices(prices, period);
  const chip =
    actions.kind === 'ready'
      ? nextAction(actions.data.actions, data.ticker, calendarDate(new Date().toISOString()))
      : null;
  const stats = last
    ? [
        {
          label: 'Value',
          unit: 'IDR',
          value: short(last.value),
          title: nf(last.value) + ' IDR',
          cls: '',
        },
        {
          label: 'Net foreign',
          unit: 'IDR (est.)',
          value: signed(last.net_foreign),
          title: nf(last.net_foreign) + ' IDR',
          cls: direction(last.net_foreign),
        },
        {
          label: 'Free float',
          value: registry?.free_float_pct == null ? '—' : nf(registry.free_float_pct, 2) + '%',
          title: registry
            ? `${registry.free_float_shares === null ? '' : nf(registry.free_float_shares) + ' shares  '}${dateText(registry.date)}`
            : '',
          cls: '',
        },
      ]
    : [];
  const more = last
    ? [
        { label: 'Volume', value: short(last.volume), title: nf(last.volume) + ' shares', cls: '' },
        {
          label: 'YTD change',
          value: ytd === null ? '—' : signed(ytd, (v) => nf(v, 2)) + '%',
          title: first ? `From first available close: ${dateText(first.date)}` : '',
          cls: direction(ytd),
        },
        {
          label: 'Shareholders',
          value: registry?.sid_count == null ? '—' : nf(registry.sid_count),
          title: registry ? dateText(registry.date) : '',
          cls: '',
        },
        {
          label: 'Share base',
          value: registry?.issued_shares == null ? '—' : short(registry.issued_shares),
          title: registry?.issued_shares
            ? `${nf(registry.issued_shares)} shares  ${dateText(registry.date)}`
            : '',
          cls: '',
        },
      ]
    : [];
  const statList = (rows: typeof stats) =>
    rows.map((s) => (
      <div className="stat" key={s.label}>
        <dt>
          {s.label}
          {'unit' in s && s.unit && <small className="unit-suffix">{s.unit}</small>}
        </dt>
        <dd className={s.cls} title={s.title || undefined}>
          {s.value}
        </dd>
      </div>
    ));
  return (
    <main className="wrap">
      <header className="ticker-header">
        <div className="identity-heading">
          <h1>{data.ticker}</h1>
          {last && (
            <div className="quote">
              <span className="price-main">
                <span className="currency">IDR</span>
                {nf(last.close)}
              </span>
              <span className={`price-change ${direction(change)}`}>
                {change === null || pct === null ? (
                  '—'
                ) : change === 0 ? (
                  'Unchanged today'
                ) : (
                  <>
                    {moveWord(change)} <span className="change-abs">{nf(Math.abs(change))} (</span>
                    {nf(Math.abs(pct), 2)}%<span className="change-abs">)</span> today
                  </>
                )}
              </span>
            </div>
          )}
          <span className="identity-actions">
            {pin(data.ticker)}
            <ShareButton ticker={data.ticker} name={data.name} />
          </span>
        </div>
        <div className="identity-sub">
          <p>{data.name.replace(/\.$/, '')}</p>
          <RiskFlagChips risk={risk} />
          {chip && (
            <span className="action-chip" title={chip.title} tabIndex={0}>
              {chip.label}
            </span>
          )}
          {last && (
            <Freshness label={dateText(last.date)}>
              <dt>Prices</dt>
              <dd>{dateText(health?.prices ?? last.date)}</dd>
              {dailyDate && (
                <>
                  <dt>5% ownership</dt>
                  <dd>{dateText(dailyDate)}</dd>
                </>
              )}
              {registry && (
                <>
                  <dt>Registry</dt>
                  <dd>{dateText(registry.date)}</dd>
                </>
              )}
            </Freshness>
          )}
          {health && <Stale health={health} />}
        </div>
      </header>
      <PriceChart
        ticker={data.ticker}
        prices={prices}
        period={period}
        setPeriod={setPeriod}
        selection={selection}
        select={select}
        marks={marks}
      >
        <SelectionSummary
          data={data}
          events={events}
          selection={selection}
          clear={() => select(null)}
        />
      </PriceChart>
      {stats.length > 0 && (
        <div className="stats-block">
          <dl className="stats">{statList(stats)}</dl>
          <details className="more-stats">
            <summary>More</summary>
            <dl className="stats">{statList(more)}</dl>
          </details>
        </div>
      )}
      <Ownership
        data={data}
        series={series}
        events={events}
        selection={selection}
        dailyDate={dailyDate}
      />
      <Timeline data={data} events={events} selection={selection} />
      {last && (
        <BrokerSummary
          ticker={data.ticker}
          selection={selection}
          start={visible[0]?.date ?? last.date}
          end={last.date}
        />
      )}
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
