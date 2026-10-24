import { Children, useEffect, useRef, useState, type ReactNode } from 'react';
import { load, loadNews, type Ticker, type Feed, type Health, type Stock } from './data';
import { BrokerBadge, BrokerPanel } from './BrokerPanel';
import { accountIdentity } from './broker-data';
import { Chart, type ChartSeries } from './Chart';
import { useLocale } from './locale';
import type { Controls, Panel } from './workspace';

type Query<T> =
  | { key: string; status: 'loading' | 'error' }
  | { key: string; status: 'ready'; data: T };
const tickerCache = new Map<string, Promise<Ticker | null>>();
function readTicker(ticker: string) {
  let pending = tickerCache.get(ticker);
  if (!pending) {
    pending = load(`ticker/${ticker}.json`).catch((error) => {
      tickerCache.delete(ticker);
      throw error;
    });
    tickerCache.set(ticker, pending);
  }
  return pending;
}
function useQuery<T>(key: string, read: (key: string) => Promise<T>) {
  const [state, setState] = useState<Query<T>>({ key, status: 'loading' });
  useEffect(() => {
    let active = true;
    read(key).then(
      (data) => {
        if (active) setState({ key, status: 'ready', data });
      },
      () => {
        if (active) setState({ key, status: 'error' });
      },
    );
    return () => {
      active = false;
    };
  }, [key, read]);
  return state.key === key ? state : { key, status: 'loading' as const };
}
const readMarket = () => load('market.json');
const readFeed = () => load('feed.json');
function Pending({ status }: { status: 'loading' | 'error' }) {
  const { t } = useLocale();
  return (
    <p className="query-state" role={status === 'error' ? 'alert' : 'status'}>
      {t(status === 'loading' ? 'Loading data…' : 'Could not load data. Reload to try again.')}
    </p>
  );
}
function Table({ headers, children }: { headers: ReactNode[]; children: ReactNode }) {
  const { t } = useLocale();
  const rows = Children.toArray(children);
  return (
    <div className="data-table">
      <table>
        <thead>
          <tr>
            {headers.map((header, i) => (
              <th key={i}>{header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length ? (
            rows
          ) : (
            <tr>
              <td colSpan={headers.length} className="empty">
                {t('No records in this view.')}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
function Source({ path, details, data }: { path: string; details: string; data?: unknown }) {
  const { t } = useLocale();
  const dialog = useRef<HTMLDialogElement>(null);
  return (
    <div className="source-foot">
      <button data-tip={t(details)} onClick={() => dialog.current?.showModal()}>
        {t('Source')}
      </button>
      <dialog ref={dialog} className="source-dialog">
        <div className="dialog-head">
          <h3>{t('Source')}</h3>
          <button aria-label={t('Close source')} onClick={() => dialog.current?.close()}>
            ×
          </button>
        </div>
        <p>{t(details)}</p>
        <p>
          <a href={path} target="_blank" rel="noreferrer">
            {t('Open the source')} ↗
          </a>
        </p>
        {data !== undefined && <pre>{JSON.stringify(data, null, 2)}</pre>}
      </dialog>
    </div>
  );
}
function Account({ name }: { name: string }) {
  const { t } = useLocale();
  const identity = accountIdentity(name);
  return identity?.kind === 'broker' ? (
    <span className="account-broker">
      <BrokerBadge code={identity.code} />
      <span>{name}</span>
    </span>
  ) : identity?.kind === 'custodian' ? (
    <span data-tip={t('Custodian bank')} tabIndex={0}>
      {name} · {t('Custodian bank')}
    </span>
  ) : (
    <>{name}</>
  );
}
export function ModuleView({
  panel,
  stocks,
  health,
  update,
  selectTicker,
}: {
  panel: Panel;
  stocks: Stock[];
  health: Health | null;
  update: (patch: Partial<Controls>) => void;
  selectTicker: (ticker: string) => void;
}) {
  switch (panel.type) {
    case 'market':
      return (
        <MarketModule
          controls={panel.state}
          stocks={stocks}
          update={update}
          selectTicker={selectTicker}
        />
      );
    case 'radar':
      return <Radar controls={panel.state} update={update} selectTicker={selectTicker} />;
    case 'report':
      return (
        <Report
          controls={panel.state}
          stocks={stocks}
          health={health}
          update={update}
          selectTicker={selectTicker}
        />
      );
    case 'news':
      return <News ticker={panel.state.ticker} />;
    default:
      return <TickerModule panel={panel} health={health} update={update} />;
  }
}
function TickerModule({
  panel,
  health,
  update,
}: {
  panel: Panel;
  health: Health | null;
  update: (patch: Partial<Controls>) => void;
}) {
  const query = useQuery(panel.state.ticker, readTicker);
  const { t } = useLocale();
  if (query.status !== 'ready') return <Pending status={query.status} />;
  if (!query.data) return <p>{t('Ticker data is not available.')}</p>;
  const data = query.data;
  switch (panel.type) {
    case 'brokers':
      return (
        <BrokerPanel
          ticker={data.ticker}
          tradingDates={data.prices.map((row) => row.date)}
          controls={panel.state}
          update={update}
        />
      );
    case 'price':
      return <Price key={data.ticker} data={data} controls={panel.state} update={update} />;
    case 'ownership':
      return <Ownership data={data} health={health} controls={panel.state} update={update} />;
    case 'profile':
      return <Profile data={data} health={health} />;
    case 'sources':
      return <Sources data={data} health={health} />;
    default:
      return null;
  }
}
function MarketModule({
  controls,
  stocks,
  update,
  selectTicker,
}: {
  controls: Controls;
  stocks: Stock[];
  update: (patch: Partial<Controls>) => void;
  selectTicker: (ticker: string) => void;
}) {
  const query = useQuery('market', readMarket);
  const { t, n, p, c } = useLocale();
  const rows = stocks
    .filter((row) =>
      `${row.ticker} ${row.name}`.toLowerCase().includes(controls.query.toLowerCase()),
    )
    .sort((a, b) => {
      const x = a[controls.sort],
        y = b[controls.sort];
      return (
        (typeof x === 'string' && typeof y === 'string'
          ? x.localeCompare(y)
          : Number(x ?? -Infinity) - Number(y ?? -Infinity)) * controls.direction
      );
    });
  const latest = query.status === 'ready' ? query.data.history.at(-1) : null;
  const columns = [
    { id: 'ticker', name: 'Ticker' },
    { id: 'close', name: 'Close' },
    { id: 'change_pct', name: 'Change' },
    { id: 'volume', name: 'Volume' },
    { id: 'value', name: 'Value' },
    { id: 'net_foreign', name: 'Net foreign · est.' },
  ] satisfies { id: Controls['sort']; name: string }[];
  return (
    <>
      {query.status !== 'ready' ? (
        <Pending status={query.status} />
      ) : (
        <>
          <div className="market-index">
            <div>
              <strong>IHSG {n(latest?.close)}</strong>
              <small>
                {query.data.date} ·{' '}
                <span className={(latest?.change_pct ?? 0) < 0 ? 'down' : 'up'}>
                  {p(latest?.change_pct)}
                </span>
              </small>
            </div>
            <div className="breadth">
              {n(query.data.up)} {t('up')} · {n(query.data.down)} {t('down')}
            </div>
          </div>
        </>
      )}
      <section className="scan-panel">
        <div className="filter-buttons">
          <input
            aria-label={t('Filter stocks')}
            placeholder={t('Ticker or company name')}
            value={controls.query}
            onChange={(event) => update({ query: event.target.value })}
          />
        </div>
        <p className="meta">
          {n(rows.length)} {t('stocks')}
        </p>
        <Table
          headers={columns.map((column) => (
            <button
              onClick={() =>
                update({
                  sort: column.id,
                  direction: controls.sort === column.id ? -controls.direction : 1,
                })
              }
            >
              {t(column.name)}
              {controls.sort === column.id ? (controls.direction > 0 ? ' ↑' : ' ↓') : ''}
            </button>
          ))}
        >
          {rows.map((row) => (
            <tr key={row.ticker} className={row.ticker === controls.ticker ? 'selected-stock' : ''}>
              <td>
                <button className="ticker-link" onClick={() => selectTicker(row.ticker)}>
                  {row.ticker}
                </button>
                <div className="inline-meta">{row.name}</div>
              </td>
              <td className="numeric">{n(row.close)}</td>
              <td className={`numeric ${(row.change_pct ?? 0) < 0 ? 'down' : 'up'}`}>
                {p(row.change_pct)}
              </td>
              <td className="numeric">
                <span tabIndex={0} data-tip={`${n(row.volume)} ${t('shares')}`}>
                  {c(row.volume)}
                </span>
              </td>
              <td className="numeric">
                <span tabIndex={0} data-tip={`Rp ${n(row.value)}`}>
                  {c(row.value)}
                </span>
              </td>
              <td className="numeric">
                <span tabIndex={0} data-tip={`Rp ${n(row.net_foreign)}`}>
                  {row.net_foreign > 0 ? '+' : ''}
                  {c(row.net_foreign)}
                </span>
              </td>
            </tr>
          ))}
        </Table>
        <Source
          path="/data/tickers.json"
          details="Net foreign value is estimated as net foreign shares times close."
        />
      </section>
    </>
  );
}
const signalGroups = [
  { kind: 'five_pct_change', label: '5% ownership changes' },
  { kind: 'volume_spike', label: 'Volume spikes' },
  { kind: 'ara', label: 'ARA moves' },
  { kind: 'foreign_streak', label: 'Foreign buying streaks' },
  { kind: 'green_on_red', label: 'Green on red' },
];
function Observation({ item }: { item: Feed[number] }) {
  const { t, n, p } = useLocale();
  switch (item.kind) {
    case 'five_pct_change':
      return (
        <>
          {item.numbers.investor}
          <div className="inline-meta">
            {p(item.numbers.pct_before)} →{' '}
            {item.numbers.pct_after === null ? t('Not reported') : p(item.numbers.pct_after)} ·{' '}
            {t('Net shares')}: {n(item.numbers.net_shares)}
          </div>
        </>
      );
    case 'volume_spike':
      return (
        <span
          data-tip={`${n(item.numbers.volume)} ${t('shares')} / ${n(item.numbers.avg_volume)} ${t('average')} · ${item.numbers.prior_days} ${t('trading days')} · Rp ${n(item.numbers.value)}`}
          tabIndex={0}
        >
          {n(item.numbers.multiple)}× {t('Volume')}
        </span>
      );
    case 'ara':
      return (
        <span
          data-tip={`${n(item.numbers.prev)} → ${n(item.numbers.close)} · ${t('threshold')} ${p(item.numbers.band_pct)}`}
          tabIndex={0}
        >
          {p(item.numbers.change_pct)}
        </span>
      );
    case 'foreign_streak':
      return (
        <span data-tip={`Rp ${n(item.numbers.net_foreign)}`} tabIndex={0}>
          {n(item.numbers.streak_days)} {t('trading days')}
        </span>
      );
    case 'green_on_red':
      return (
        <span data-tip={`Rp ${n(item.numbers.value)}`} tabIndex={0}>
          {p(item.numbers.change_pct)} vs IHSG {p(item.numbers.market_change_pct)}
        </span>
      );
  }
}
function Radar({
  controls,
  update,
  selectTicker,
}: {
  controls: Controls;
  update: (patch: Partial<Controls>) => void;
  selectTicker: (ticker: string) => void;
}) {
  const query = useQuery('feed', readFeed);
  const { t } = useLocale();
  if (query.status !== 'ready') return <Pending status={query.status} />;
  return (
    <section className="scan-panel">
      <div className="filter-buttons">
        <button
          className={`small-button ${controls.marketFilter === 'all' ? 'selected' : ''}`}
          onClick={() => update({ marketFilter: 'all' })}
        >
          {t('All signals')}
        </button>
        {signalGroups.map((group) => (
          <button
            key={group.kind}
            className={`small-button ${controls.marketFilter === group.kind ? 'selected' : ''}`}
            onClick={() => update({ marketFilter: group.kind })}
          >
            {t(group.label)}
          </button>
        ))}
      </div>
      {signalGroups
        .filter((group) => controls.marketFilter === 'all' || controls.marketFilter === group.kind)
        .map((group) => {
          const rows = query.data.filter((item) => item.kind === group.kind);
          return (
            <section className="feed-group" key={group.kind}>
              <h3>
                {t(group.label)} <span className="row-badge">{rows.length}</span>
              </h3>
              {rows.length ? (
                <Table headers={[t('Ticker'), t('Date'), t('Observation')]}>
                  {rows.map((item, index) => (
                    <tr key={index}>
                      <td>
                        <button className="ticker-link" onClick={() => selectTicker(item.ticker)}>
                          {item.ticker}
                        </button>
                      </td>
                      <td>{item.date}</td>
                      <td>
                        <Observation item={item} />
                      </td>
                    </tr>
                  ))}
                </Table>
              ) : (
                <p className="query-state">{t('No signals.')}</p>
              )}
            </section>
          );
        })}
      <Source
        path="/data/feed.json"
        details="Production market signals and reported ownership changes."
        data={query.data}
      />
    </section>
  );
}
function Report({
  controls,
  stocks,
  health,
  update,
  selectTicker,
}: {
  controls: Controls;
  stocks: Stock[];
  health: Health | null;
  update: (patch: Partial<Controls>) => void;
  selectTicker: (ticker: string) => void;
}) {
  const { t, n, p } = useLocale();
  const feed = useQuery('feed', readFeed);
  const ticker = controls.reportTicker === 'all' ? controls.ticker : controls.reportTicker;
  const detail = useQuery(ticker, readTicker);
  const changes =
    feed.status === 'ready'
      ? feed.data.filter(
          (row) =>
            row.kind === 'five_pct_change' &&
            (controls.reportTicker === 'all' || row.ticker === ticker),
        )
      : [];
  return (
    <section className="scan-panel">
      <div className="surface-heading">
        <p className="eyebrow">
          {t('Ownership')} · {health?.five_pct ?? t('Not reported')}
        </p>
      </div>
      <div className="filter-buttons">
        <button
          className={`small-button ${controls.reportMode === 'all' ? 'selected' : ''}`}
          onClick={() => update({ reportMode: 'all' })}
        >
          {t('Current 5% holders')}
        </button>
        <button
          className={`small-button ${controls.reportMode === 'changed' ? 'selected' : ''}`}
          onClick={() => update({ reportMode: 'changed' })}
        >
          {t('5% changes')}
        </button>
        <select
          aria-label={t('Filter report ticker')}
          value={controls.reportMode === 'changed' ? controls.reportTicker : ticker}
          onChange={(event) => update({ reportTicker: event.target.value })}
        >
          {controls.reportMode === 'changed' && <option value="all">{t('All tickers')}</option>}
          {!stocks.some((row) => row.ticker === ticker) && <option value={ticker}>{ticker}</option>}
          {stocks.map((row) => (
            <option key={row.ticker}>{row.ticker}</option>
          ))}
        </select>
      </div>
      {controls.reportMode === 'all' ? (
        detail.status !== 'ready' ? (
          <Pending status={detail.status} />
        ) : (
          <>
            <Table headers={[t('Ticker / investor'), t('Shares'), t('Holding')]}>
              {detail.data?.holders.map((row, i) => (
                <tr key={i}>
                  <td>
                    <button className="ticker-link" onClick={() => selectTicker(ticker)}>
                      {ticker}
                    </button>
                    <div className="inline-meta">
                      <Account name={row.investor} />
                    </div>
                  </td>
                  <td className="numeric">{n(row.shares)}</td>
                  <td className="numeric">{p(row.pct)}</td>
                </tr>
              ))}
            </Table>
            <Source
              path={`/data/ticker/${ticker}.json`}
              details="Disclosed holdings. The public export has no account-level breakdown."
              data={detail.data?.holders}
            />
          </>
        )
      ) : feed.status !== 'ready' ? (
        <Pending status={feed.status} />
      ) : (
        <>
          <Table
            headers={[
              t('Ticker / investor'),
              t('Report date'),
              t('Before shares'),
              t('After shares'),
              t('Net shares'),
            ]}
          >
            {changes.map(
              (row, i) =>
                row.kind === 'five_pct_change' && (
                  <tr className="changed" key={i}>
                    <td>
                      <button className="ticker-link" onClick={() => selectTicker(row.ticker)}>
                        {row.ticker}
                      </button>
                      <div className="inline-meta">{row.numbers.investor}</div>
                    </td>
                    <td>{row.date}</td>
                    <td className="numeric">{n(row.numbers.shares_before)}</td>
                    <td className="numeric">{n(row.numbers.shares_after)}</td>
                    <td className="numeric">{n(row.numbers.net_shares)}</td>
                  </tr>
                ),
            )}
          </Table>
          <Source
            path="/data/feed.json"
            details="A missing exact-name match does not prove a sale. Null after-values remain unknown."
            data={changes}
          />
        </>
      )}
    </section>
  );
}
function HolderName({
  name,
  data,
  through,
}: {
  name: string;
  data: Ticker;
  through?: string | null;
}) {
  const { t } = useLocale();
  const normalize = (text: string) => text.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const snapshot = data.registry_history.filter((row) => !through || row.date <= through).at(-1);
  const holder = snapshot?.holders.find((row) => normalize(row.investor) === normalize(name));
  return (
    <>
      <Account name={name} />
      {holder && snapshot && (
        <>
          {holder.controller === true && (
            <a
              className="relationship-badge"
              href={snapshot.url}
              target="_blank"
              rel="noreferrer"
              data-tip={`${t('Controller')} · ${snapshot.date} · Pengendali · ${t('Page')} ${holder.page}`}
            >
              {t('Controller')}
            </a>
          )}
          {holder.controller_affiliate === true && (
            <a
              className="relationship-badge controllerAffiliate"
              href={snapshot.url}
              target="_blank"
              rel="noreferrer"
              data-tip={`${t('Controller affiliate')} · ${snapshot.date} · Afiliasi Pengendali · ${t('Page')} ${holder.page}`}
            >
              {t('Controller affiliate')}
            </a>
          )}
        </>
      )}
    </>
  );
}
export function registrySeries(
  history: Ticker['registry_history'],
  field: 'sid_count' | 'free_float_pct',
): ChartSeries[] {
  const first = history[0],
    last = history.at(-1);
  const points: ChartSeries['points'] = [];
  if (first && last) {
    for (let month = first.date.slice(0, 7); month <= last.date.slice(0, 7); ) {
      const date = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0))
        .toISOString()
        .slice(0, 10);
      const value = history.find((row) => row.date === date)?.[field] ?? null;
      const previous = points.at(-1)?.value;
      points.push({
        date,
        value,
        delta: value !== null && previous != null ? value - previous : null,
      });
      month = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 1))
        .toISOString()
        .slice(0, 7);
    }
  }
  return [
    { label: field === 'sid_count' ? 'SID' : 'Reported free float', color: '#3d755a', points },
  ];
}
function MonthlyRegistry({ data }: { data: Ticker }) {
  const { t, n, p } = useLocale();
  const history = data.registry_history;
  const latest = history.at(-1);
  const chart = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState(700);
  useEffect(() => {
    if (!chart.current) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setWidth(Math.max(300, Math.min(1000, entry.contentRect.width)));
    });
    observer.observe(chart.current);
    return () => observer.disconnect();
  }, [latest]);
  const left = Math.min(140, width * 0.34),
    plotWidth = width - left - 55;
  const compact = (value: number) =>
    value >= 1e9
      ? `${n(Math.round(value / 1e7) / 100)}B`
      : value >= 1e6
        ? `${n(Math.round(value / 1e4) / 100)}M`
        : value >= 1e3
          ? `${n(Math.round(value / 100) / 10)}K`
          : n(value);
  if (!latest) return <p className="monthly-empty">{t('Monthly registry report not sourced.')}</p>;
  const types = latest.investor_types
    .filter((row) => row.shares !== null && row.shares > 0)
    .sort((a, b) => (b.shares ?? 0) - (a.shares ?? 0));
  const maximum = Math.max(...types.map((row) => row.shares ?? 0), 1);
  const maxLabel = Math.floor((left - 16) / 5.4);
  return (
    <>
      <div className="compact-source">
        <span>{latest.date}</span>
        <a className="qol-source-link" href={latest.url} target="_blank" rel="noreferrer">
          {t('Source')}
        </a>
      </div>
      <div className="registry-metrics">
        {(['sid_count', 'free_float_pct'] as const).map((field) => (
          <div className="registry-metric" key={field}>
            <h3>{t(field === 'sid_count' ? 'SID' : 'Reported free float')}</h3>
            <strong>{field === 'sid_count' ? n(latest[field]) : p(latest[field])}</strong>
            <Chart
              series={registrySeries(history, field)}
              label={t(field === 'sid_count' ? 'SID' : 'Reported free float')}
              unit={field === 'sid_count' ? 'SID' : '%'}
              height={125}
              deltaLabel="Month Δ"
            />
          </div>
        ))}
      </div>
      <div className="registry-chart-head">
        <h3>{t('Investor types')}</h3>
        <span className="meta">{t('KSEI scripless shares')}</span>
      </div>
      {types.length ? (
        <svg
          className="composition-chart investor-types-chart"
          ref={chart}
          viewBox={`0 0 ${width} ${types.length * 29 + 36}`}
          style={{ height: types.length * 29 + 36 }}
          role="img"
          aria-label={`${data.ticker} ${t('KSEI scripless shares')} ${latest.date}`}
        >
          {[0, 0.5, 1].map((fraction) => (
            <g key={fraction}>
              <line
                x1={left + fraction * plotWidth}
                x2={left + fraction * plotWidth}
                y1={0}
                y2={types.length * 29 + 9}
                stroke="#e0e8de"
                strokeDasharray="2 4"
              />
              <text x={left + fraction * plotWidth} y={types.length * 29 + 31} textAnchor="middle">
                {compact(fraction * maximum)}
              </text>
            </g>
          ))}
          {types.map((row, index) => (
            <g
              key={row.label}
              tabIndex={0}
              data-tip={`${row.label} · ${n(row.shares)} ${t('KSEI scripless shares')} · ${latest.date}`}
            >
              <title>
                {row.label}: {n(row.shares)} {t('shares')}
              </title>
              <text x={left - 8} y={index * 29 + 21} textAnchor="end">
                {row.label.length > maxLabel ? row.label.slice(0, maxLabel - 1) + '…' : row.label}
              </text>
              <rect
                x={left}
                y={index * 29 + 9}
                width={((row.shares ?? 0) / maximum) * plotWidth}
                height={17}
                rx={2}
                fill="#4b7e62"
              />
              <text x={left + ((row.shares ?? 0) / maximum) * plotWidth + 5} y={index * 29 + 21}>
                {compact(row.shares ?? 0)}
              </text>
            </g>
          ))}
        </svg>
      ) : (
        <p className="monthly-empty">{t('Investor types not sourced.')}</p>
      )}
      <details className="history-details">
        <summary>{t('Monthly records')}</summary>
        <Table
          headers={[
            t('Date'),
            'SID',
            t('Reported free float'),
            t('Total shares'),
            t('Free float shares'),
          ]}
        >
          {history.map((row) => (
            <tr key={row.date}>
              <td>
                <a href={row.url} target="_blank" rel="noreferrer">
                  {row.date}
                </a>
              </td>
              <td className="numeric">{n(row.sid_count)}</td>
              <td className="numeric">{p(row.free_float_pct)}</td>
              <td className="numeric">{n(row.total_shares)}</td>
              <td className="numeric">{n(row.free_float_shares)}</td>
            </tr>
          ))}
        </Table>
        <Table headers={[t('Investor types'), t('KSEI scripless shares')]}>
          {latest.investor_types.map((row) => (
            <tr key={row.label}>
              <td>{row.label}</td>
              <td className="numeric">{n(row.shares)}</td>
            </tr>
          ))}
        </Table>
      </details>
      <div className="registry-chart-head">
        <h3>{t('Reported holders')}</h3>
        <span className="meta">{latest.date}</span>
      </div>
      <Table headers={[t('Investor'), t('Holding')]}>
        {latest.holders.map((row) => (
          <tr key={row.investor}>
            <td>
              <HolderName name={row.investor} data={data} />
            </td>
            <td className="numeric">{p(row.pct)}</td>
          </tr>
        ))}
      </Table>
    </>
  );
}
function Ownership({
  data,
  health,
  controls,
  update,
}: {
  data: Ticker;
  health: Health | null;
  controls: Controls;
  update: (patch: Partial<Controls>) => void;
}) {
  const { t, n, p } = useLocale();
  return (
    <div className="stack">
      <section className="card">
        <div className="filter-buttons">
          <button
            className={`small-button ${controls.ownershipView === 'five' ? 'selected' : ''}`}
            onClick={() => update({ ownershipView: 'five' })}
          >
            {t('5% ownership')} · {health?.five_pct ?? t('Not reported')}
          </button>
          <button
            className={`small-button ${controls.ownershipView === 'registry' ? 'selected' : ''}`}
            onClick={() => update({ ownershipView: 'registry' })}
          >
            {t('Monthly registry')}
          </button>
          <button
            className={`small-button ${controls.ownershipView === 'one' ? 'selected' : ''}`}
            onClick={() => update({ ownershipView: 'one' })}
          >
            {t('1% ownership')} · {data.one_pct.date ?? t('Not reported')}
          </button>
        </div>
        {controls.ownershipView === 'registry' ? (
          <MonthlyRegistry data={data} />
        ) : controls.ownershipView === 'five' ? (
          <Holders data={data} />
        ) : (
          <Table
            headers={[
              t('Investor'),
              t('Classification'),
              t('Local / foreign'),
              t('Shares'),
              t('Holding'),
            ]}
          >
            {data.one_pct.holders.map((row, i) => (
              <tr key={i}>
                <td>
                  <HolderName name={row.investor} data={data} through={data.one_pct.date} />
                </td>
                <td>{row.classification ?? t('Not reported')}</td>
                <td>{row.local_foreign ?? t('Not reported')}</td>
                <td className="numeric">{n(row.shares)}</td>
                <td className="numeric">{p(row.pct)}</td>
              </tr>
            ))}
          </Table>
        )}
        <Source
          path={`/data/ticker/${data.ticker}.json`}
          details={
            controls.ownershipView === 'registry'
              ? 'Monthly IDX registry reports. Blank relationship cells remain unknown. KSEI types cover scripless shares.'
              : 'Disclosed holdings. The public export has no account-level breakdown.'
          }
          data={
            controls.ownershipView === 'registry'
              ? data.registry_history
              : controls.ownershipView === 'five'
                ? data.holders
                : data.one_pct
          }
        />
      </section>
      <section className="card">
        <div className="card-head">
          <h3>{t('5% changes')}</h3>
        </div>
        <Table
          headers={[t('Report date'), t('Investor'), t('Before'), t('After'), t('Net shares')]}
        >
          {data.changes.map((row, i) => (
            <tr className="changed" key={i}>
              <td>{row.date}</td>
              <td>
                <Account name={row.investor} />
              </td>
              <td className="numeric">{p(row.pct_before)}</td>
              <td className="numeric">
                {row.pct_after === null ? t('Not reported') : p(row.pct_after)}
              </td>
              <td className="numeric">{n(row.net_shares)}</td>
            </tr>
          ))}
        </Table>
        <Source
          path={`/data/ticker/${data.ticker}.json`}
          details="A missing exact-name match does not prove a sale. Null after-values remain unknown."
          data={data.changes}
        />
      </section>
      <section className="card">
        <div className="registry-chart-head">
          <h3>{t('Reported holdings')}</h3>
        </div>
        <Chart
          series={reportedHoldings(data, health?.five_pct ?? null)}
          label={t('Reported holdings')}
          unit="shares"
          deltaLabel="Δ shares"
          minZero
          renderLabel={(name) => <Account name={name} />}
        />
        <Source
          path={`/data/ticker/${data.ticker}.json`}
          details="Dated disclosed holdings only. Names are kept as reported; missing values remain unknown."
        />
      </section>
    </div>
  );
}
function reportedHoldings(data: Ticker, currentDate: string | null): ChartSeries[] {
  const groups = new Map<
    string,
    Map<string, { date: string; value: number | null; delta: number | null }>
  >();
  const add = (name: string, date: string, value: number | null, delta: number | null) => {
    const points = groups.get(name) ?? new Map();
    const prior = points.get(date);
    points.set(date, { date, value, delta: delta ?? prior?.delta ?? null });
    groups.set(name, points);
  };
  if (data.one_pct.date)
    for (const row of data.one_pct.holders) add(row.investor, data.one_pct.date, row.shares, null);
  for (const row of data.changes) add(row.investor, row.date, row.shares_after, row.net_shares);
  if (currentDate) for (const row of data.holders) add(row.investor, currentDate, row.shares, null);
  const colors = [
    '#3d755a',
    '#47859a',
    '#ab6a53',
    '#89733e',
    '#786397',
    '#697e4d',
    '#91677e',
    '#658896',
    '#a07f50',
  ];
  return [...groups.entries()].map(([label, points], index) => ({
    label,
    color: colors[index % colors.length] ?? '#3d755a',
    points: [...points.values()].sort((a, b) => a.date.localeCompare(b.date)),
  }));
}
function Holders({ data }: { data: Ticker }) {
  const { t, n, p } = useLocale();
  return (
    <Table headers={[t('Investor'), t('Shares'), t('Holding')]}>
      {data.holders.map((row, i) => (
        <tr key={i}>
          <td>
            <HolderName name={row.investor} data={data} />
          </td>
          <td className="numeric">{n(row.shares)}</td>
          <td className="numeric">{p(row.pct)}</td>
        </tr>
      ))}
    </Table>
  );
}
function Profile({ data, health }: { data: Ticker; health: Health | null }) {
  const { t, n, p } = useLocale();
  return (
    <div className="stack">
      <h3 className="module-profile-name">{data.name}</h3>
      <section className="card">
        <div className="card-head">
          <h3>{t('Current 5% holders')}</h3>
          <span className="meta">{health?.five_pct ?? t('Not reported')}</span>
        </div>
        <Holders data={data} />
      </section>
      {data.registry && (
        <section className="card">
          <div className="registry-chart-head">
            <h3>{t('Registry report')}</h3>
            <a
              className="qol-source-link"
              href={data.registry.url}
              target="_blank"
              rel="noreferrer"
            >
              {t('Source')}
            </a>
          </div>
          <p className="meta">{data.registry.date}</p>
          {[
            [t('Reported free float'), p(data.registry.free_float_pct)],
            [t('Total shares'), n(data.registry.total_shares)],
            [t('SID count'), n(data.registry.sid_count)],
            [t('Free float shares'), n(data.registry.free_float_shares)],
          ].map(([label, value]) => (
            <div className="row-detail" key={label}>
              <span>{label}</span>
              <strong>{value}</strong>
            </div>
          ))}
        </section>
      )}
      <section className="card">
        <h3>{t('Disclosures and reports')}</h3>
        <ul className="summary-list news-list">
          {data.disclosures.map((row) => (
            <li key={row.id}>
              <a href={row.url} target="_blank" rel="noreferrer">
                {row.title}
              </a>
              <span className="meta">{row.published_at}</span>
              {row.attachments.map((attachment, i) => (
                <a key={i} className="meta" href={attachment.url} target="_blank" rel="noreferrer">
                  {attachment.name}
                </a>
              ))}
            </li>
          ))}
        </ul>
        {!data.disclosures.length && (
          <p className="monthly-empty">{t('No disclosures in this period.')}</p>
        )}
      </section>
      <section className="card">
        <h3>{t('Insider share changes')}</h3>
        <Table
          headers={[
            t('Date'),
            t('Reporter'),
            t('Before shares'),
            t('After shares'),
            t('Net shares'),
            t('Source'),
          ]}
        >
          {data.insiders.map((row, i) => (
            <tr key={i}>
              <td>{row.date}</td>
              <td>{row.reporter ?? t('Not reported')}</td>
              <td className="numeric">{n(row.shares_before)}</td>
              <td className="numeric">{n(row.shares_after)}</td>
              <td className="numeric">{n(row.net_shares)}</td>
              <td>
                <a href={row.url} target="_blank" rel="noreferrer">
                  {t('Source')}
                </a>
              </td>
            </tr>
          ))}
        </Table>
      </section>
      <Source
        path={`/data/ticker/${data.ticker}.json`}
        details="Company evidence from the production ticker export."
      />
    </div>
  );
}
function Price({
  data,
  controls,
  update,
}: {
  data: Ticker;
  controls: Controls;
  update: (patch: Partial<Controls>) => void;
}) {
  const { t, n, p } = useLocale();
  const market = useQuery('market', readMarket);
  const cursor = controls.priceDay;
  const setCursor = (priceDay: string) => update({ priceDay });
  const sorted = data.prices.slice().sort((a, b) => a.date.localeCompare(b.date));
  const first = sorted[0]?.date ?? '',
    last = sorted.at(-1)?.date ?? '';
  const from = controls.from || first,
    through = controls.through || last;
  const marketDates = new Set(
    market.status === 'ready' ? market.data.history.map((row) => row.date) : [],
  );
  const rows = sorted.filter(
    (row) =>
      row.date >= from &&
      row.date <= through &&
      (!controls.compare || market.status !== 'ready' || marketDates.has(row.date)),
  );
  const inspected = rows.find((row) => row.date === cursor) ?? rows.at(-1);
  const baseline = rows[0]?.close;
  const series: ChartSeries[] = [
    {
      label: data.ticker,
      color: '#123c35',
      points: rows.map((row) => {
        const prior = sorted[sorted.indexOf(row) - 1];
        return {
          date: row.date,
          value: controls.compare && baseline ? (row.close / baseline - 1) * 100 : row.close,
          delta: prior ? (row.close / prior.close - 1) * 100 : null,
        };
      }),
    },
  ];
  if (controls.compare && market.status === 'ready') {
    const initial = market.data.history.find((row) => row.date === rows[0]?.date);
    if (initial)
      series.push({
        label: 'IHSG',
        color: '#8b9a8f',
        points: rows.map((row) => {
          const index = market.data.history.find((item) => item.date === row.date);
          return {
            date: row.date,
            value: index ? (index.close / initial.close - 1) * 100 : null,
            delta: index?.change_pct ?? null,
          };
        }),
      });
  }
  const prior = inspected ? sorted[sorted.indexOf(inspected) - 1] : null;
  const priorVolumes = inspected
    ? sorted.slice(Math.max(0, sorted.indexOf(inspected) - 20), sorted.indexOf(inspected))
    : [];
  const averageVolume =
    priorVolumes.length === 20
      ? priorVolumes.reduce((total, row) => total + row.volume, 0) / 20
      : null;
  return (
    <>
      <div className="range-toolbar">
        <div className="date-fields">
          <label>
            {t('From')}{' '}
            <input
              type="date"
              aria-label={t('Range start')}
              value={from}
              max={through}
              onChange={(event) => {
                if (event.target.value && event.target.checkValidity())
                  update({ from: event.target.value, priceDay: null });
              }}
            />
          </label>
          <label>
            {t('Through')}{' '}
            <input
              type="date"
              aria-label={t('Range end')}
              value={through}
              min={from}
              max={last}
              onChange={(event) => {
                if (event.target.value && event.target.checkValidity())
                  update({ through: event.target.value, priceDay: null });
              }}
            />
          </label>
        </div>
      </div>
      <section className="card">
        {inspected && (
          <div className="metrics">
            <div>
              <label>{t('Close')}</label>
              <strong>Rp {n(inspected.close)}</strong>
              <small>{inspected.date}</small>
            </div>
            <div>
              <label>{t('Session change')}</label>
              <strong>
                {prior ? p((inspected.close / prior.close - 1) * 100) : t('Not reported')}
              </strong>
            </div>
            <div>
              <label>{t('Volume')}</label>
              <strong>{n(inspected.volume)}</strong>
              <small>{t('shares')}</small>
            </div>
            <div>
              <label>{t('Volume / 20D average')}</label>
              <strong>
                {averageVolume
                  ? `${n(inspected.volume / averageVolume)}×`
                  : t('Not enough history')}
              </strong>
            </div>
          </div>
        )}
        <Chart
          series={series}
          deltaUnit="%"
          inspectedDate={cursor}
          label={t('Daily close')}
          unit={controls.compare ? '%' : 'IDR'}
          onInspect={setCursor}
        />
        <Chart
          series={[
            {
              label: t('Volume'),
              color: '#719983',
              points: rows.map((row) => {
                const prior = sorted[sorted.indexOf(row) - 1];
                return {
                  date: row.date,
                  value: row.volume,
                  delta: prior ? row.volume - prior.volume : null,
                };
              }),
            },
          ]}
          inspectedDate={cursor}
          label={t('Daily volume')}
          unit="shares"
          height={110}
          bars
          minZero
          onInspect={setCursor}
        />
        <div className="chart-legend">
          <label>
            <input
              type="checkbox"
              checked={controls.compare}
              onChange={(event) => update({ compare: event.target.checked })}
            />
            {t('Compare IHSG returns')}
          </label>
        </div>
        <Source
          path={`/data/ticker/${data.ticker}.json`}
          details="Closing prices only; OHLC candles are absent. Net foreign value is estimated as net foreign shares times close."
        />
      </section>
      <section className="card">
        <h3>{t('Recent trading days')}</h3>
        <Table
          headers={[
            t('Date'),
            t('Close · IDR'),
            t('Volume · shares'),
            t('Value · IDR'),
            t('Net foreign · est. IDR'),
          ]}
        >
          {rows
            .filter((row) => !inspected || row.date <= inspected.date)
            .slice(-10)
            .reverse()
            .map((row) => (
              <tr key={row.date}>
                <td>
                  <button className="text-link" onClick={() => setCursor(row.date)}>
                    {row.date}
                  </button>
                </td>
                <td className="numeric">{n(row.close)}</td>
                <td className="numeric">{n(row.volume)}</td>
                <td className="numeric">{n(row.value)}</td>
                <td className="numeric">{n(row.net_foreign)}</td>
              </tr>
            ))}
        </Table>
      </section>
    </>
  );
}
function News({ ticker }: { ticker: string }) {
  const query = useQuery(ticker, loadNews);
  const { t } = useLocale();
  if (query.status !== 'ready') return <Pending status={query.status} />;
  return (
    <>
      <ul className="summary-list news-list">
        {query.data.map((item, i) => (
          <li key={i}>
            <a href={item.url} target="_blank" rel="noreferrer">
              {item.title}
            </a>
            <span className="meta">
              {item.source} · {item.published_at}
            </span>
          </li>
        ))}
      </ul>
      {!query.data.length && <p>{t('No recent news.')}</p>}
      <Source
        path={`/api/news?ticker=${ticker}`}
        details="News matches the stock code and may include unrelated articles."
        data={query.data}
      />
    </>
  );
}
function Sources({ data, health }: { data: Ticker; health: Health | null }) {
  const { t } = useLocale();
  const entries = [
    {
      title: 'Prices',
      date: health?.prices,
      count: data.prices.length,
      path: `/data/ticker/${data.ticker}.json`,
      details:
        'Closing prices only; OHLC candles are absent. Net foreign value is estimated as net foreign shares times close.',
    },
    {
      title: 'IHSG',
      date: health?.indices,
      count: null,
      path: '/data/market.json',
      details: 'Production index history and market breadth.',
    },
    {
      title: '5% ownership',
      date: health?.five_pct,
      count: data.holders.length,
      path: `/data/ticker/${data.ticker}.json`,
      details: 'Disclosed holdings. The public export has no account-level breakdown.',
    },
    {
      title: '1% ownership',
      date: data.one_pct.date,
      count: data.one_pct.holders.length,
      path: `/data/ticker/${data.ticker}.json`,
      details: 'Use each source’s reporting date. This is not the full shareholder base.',
    },
    {
      title: 'Issuers',
      date: health?.issuers,
      count: null,
      path: '/data/tickers.json',
      details: 'Company evidence from the production ticker export.',
    },
    {
      title: 'Disclosures and reports',
      date: data.disclosures
        .map((row) => row.published_at.slice(0, 10))
        .sort()
        .at(-1),
      count: data.disclosures.length,
      path: `/data/ticker/${data.ticker}.json`,
      details: 'Company evidence from the production ticker export.',
    },
    {
      title: 'Insider share changes',
      date: data.insiders
        .map((row) => row.date)
        .sort()
        .at(-1),
      count: data.insiders.length,
      path: `/data/ticker/${data.ticker}.json`,
      details: 'Company evidence from the production ticker export.',
    },
    {
      title: 'Registry report',
      date: data.registry?.date,
      count: data.registry ? 1 : 0,
      path: data.registry?.url ?? `/data/ticker/${data.ticker}.json`,
      details: 'Latest registry snapshot only.',
    },
  ];
  return (
    <div className="stack">
      <div className="sources-grid">
        {entries.map((entry) => (
          <section className="source-entry" key={entry.title}>
            <h4>{t(entry.title)}</h4>
            <span className={`badge ${entry.date ? 'available' : 'missing'}`}>
              {entry.date ?? t('Not reported')}
            </span>
            {entry.count !== null && (
              <p className="meta">
                {entry.count} {t('records')}
              </p>
            )}
            <Source path={entry.path} details={entry.details} />
          </section>
        ))}
        <section className="source-entry">
          <h4>Broksum</h4>
          <span className="meta">
            {t('Coverage is shown in the Broksum module after sign-in.')}
          </span>
        </section>
        <section className="source-entry">
          <h4>{t('News')}</h4>
          <Source
            path={`/api/news?ticker=${data.ticker}`}
            details="News matches the stock code and may include unrelated articles."
          />
        </section>
      </div>
    </div>
  );
}
