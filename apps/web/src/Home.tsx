import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { load, type Feed, type Health, type Market, type Stock, type Ticker } from './data';
import {
  briefing,
  date,
  EventMetric,
  EventText,
  eventTitle,
  lensOf,
  magnitude,
  pct,
  signalTiles,
  signed,
  tone,
  weekAhead,
  type Event,
  type SignalTile,
} from './events';
import { usePublished } from './publicData';
import { RiskBadge, useRiskFor } from './RiskBadge';
import { PinButton, SiteHeader } from './SiteHeader';
import { Stale } from './Stale';
import { fetchHeadlines, type Headline } from './terminal/sources';
import { treemap } from './treemap';
import { calendarDate, dateText, direction, nf, wib } from './ticker/format';
import { usePins } from './watchlist';
import './home.css';

const phoneQuery = '(max-width: 900px)';
const usePhone = () =>
  useSyncExternalStore(
    (change) => {
      const query = window.matchMedia(phoneQuery);
      query.addEventListener('change', change);
      return () => query.removeEventListener('change', change);
    },
    () => window.matchMedia(phoneQuery).matches,
    () => false,
  );

type Data = { stocks: Stock[]; feed: Feed; health: Health; market: Market };

export function Home() {
  const [state, setState] = useState<
    { kind: 'loading' } | { kind: 'error' } | ({ kind: 'ready' } & Data)
  >({ kind: 'loading' });
  const [news, setNews] = useState<Headline[] | null>(null);
  const [pins, toggle] = usePins(),
    [announcement, announce] = useState('');
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
    void fetchHeadlines().then((r) => {
      if (active) setNews(r.kind === 'ready' ? r.data.news : []);
    });
    return () => {
      active = false;
    };
  }, []);
  const pin = (ticker: string) => (
    <PinButton
      ticker={ticker}
      pinned={pins.includes(ticker)}
      toggle={() => announce(`${ticker} ${toggle(ticker) ? 'added to' : 'removed from'} watchlist`)}
    />
  );
  const stocks = state.kind === 'ready' ? state.stocks : [];
  return (
    <div className="site home-page">
      <SiteHeader page="home" stocks={stocks} pin={pin} />
      <main className="wrap">
        {state.kind === 'loading' ? (
          <p role="status">Loading data…</p>
        ) : state.kind === 'error' ? (
          <p role="alert">
            Could not load data. <button onClick={() => window.location.reload()}>Reload</button>
          </p>
        ) : (
          <Briefing data={state} news={news} pins={pins} pin={pin} />
        )}
      </main>
      <div className="sr-only" role="status" aria-live="polite">
        {announcement}
      </div>
    </div>
  );
}

function Briefing({
  data,
  news,
  pins,
  pin,
}: {
  data: Data;
  news: Headline[] | null;
  pins: string[];
  pin: (ticker: string) => ReactNode;
}) {
  const stockMap = new Map(data.stocks.map((s) => [s.ticker, s]));
  const events = briefing(data.feed, (t) => stockMap.has(t));
  const watched = pins.flatMap((t) => stockMap.get(t) ?? []);
  return (
    <>
      <Pulse
        data={data}
        excluded={data.feed.length - data.feed.filter((e) => stockMap.has(e.ticker)).length}
      />
      {watched.length > 0 && (
        <section className="panel watchlist" aria-labelledby="watch-heading">
          <h2 id="watch-heading">Watchlist</h2>
          {watched.map((s) => (
            <WatchRow key={s.ticker} stock={s} events={events} pin={pin(s.ticker)} />
          ))}
        </section>
      )}
      <div className="today">
        <Heatmap stocks={data.stocks} />
        <Signals tiles={signalTiles(events)} stockMap={stockMap} />
      </div>
      <Week pins={pins} />
      <News news={news} />
    </>
  );
}

function Pulse({ data, excluded }: { data: Data; excluded: number }) {
  const history = data.market.history.slice(-60),
    last = history.at(-1),
    foreign = data.stocks.reduce((sum, s) => sum + s.net_foreign, 0),
    h = data.health;
  return (
    <section className="pulse" aria-label="IDX market">
      {last ? (
        <div className="pulse-index">
          <h1>IHSG</h1>
          <strong className="num">{nf(last.close, 2)}</strong>
          <span className={`num ${direction(last.change)}`}>
            {last.change === null ? '—' : signed(last.change, (v) => nf(v, 2))}{' '}
            {pct(last.change_pct)}
          </span>
          <Spark rows={history} label="IHSG closing levels over 60 trading days" />
        </div>
      ) : (
        <p role="status">Market history unavailable</p>
      )}
      <Breadth up={data.market.up} down={data.market.down} />
      <div className="pulse-stat" title="Sum of estimated net foreign flow across listed stocks">
        Foreign est. <span className={`num ${direction(foreign)}`}>{signed(foreign)} IDR</span>
      </div>
      <Stale health={h} />
      <details className="sources">
        <summary>{date(h.prices)}</summary>
        <div className="source-panel">
          <dl>
            <dt>Prices</dt>
            <dd>{date(h.prices)}</dd>
            <dt>Indices</dt>
            <dd>{date(h.indices)}</dd>
            <dt>5% ownership</dt>
            <dd>{date(h.five_pct)}</dd>
            <dt>Registry</dt>
            <dd>{date(h.one_pct)}</dd>
            <dt>Issuers</dt>
            <dd>{date(h.issuers)}</dd>
            <dt>Snapshot</dt>
            <dd>{date(h.run_at)}</dd>
          </dl>
          {excluded > 0 && (
            <p>
              {excluded} feed {excluded === 1 ? 'record' : 'records'} excluded: ticker absent from
              the stock directory.
            </p>
          )}
        </div>
      </details>
    </section>
  );
}

function Breadth({ up, down }: { up: number; down: number }) {
  return (
    <div className="pulse-stat breadth" role="img" aria-label={`${nf(up)} up, ${nf(down)} down`}>
      <span className="up num">{nf(up)}</span>
      {up + down > 0 && (
        <span className="split">
          <span className="up" style={{ flexGrow: up }} />
          <span className="down" style={{ flexGrow: down }} />
        </span>
      )}
      <span className="down num">{nf(down)}</span>
    </div>
  );
}

function Spark({ rows, label }: { rows: { date: string; close: number }[]; label: string }) {
  const width = 120,
    height = 28,
    values = rows.map((r) => r.close),
    min = Math.min(...values),
    max = Math.max(...values);
  const d = rows
    .map((r, i) => {
      const x = (i / Math.max(1, rows.length - 1)) * width,
        y = height - 2 - ((r.close - min) / (max - min || 1)) * (height - 4);
      return `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg
      className="spark"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
    >
      <title>{rows.map((r) => `${date(r.date)}: ${nf(r.close, 2)}`).join('; ')}</title>
      <path d={d} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

const heatTone = (change: number | null) => {
  const c = change ?? 0,
    strength = Math.min(1, Math.abs(c) / 4) ** 0.8,
    end = c >= 0 ? [22, 112, 73] : [180, 60, 54],
    base = [231, 230, 223];
  return {
    background: `rgb(${base.map((n, i) => Math.round(n + (end[i]! - n) * strength)).join(',')})`,
    color: strength > 0.45 ? '#fdfcf9' : '#222320',
  };
};

const heatLimit = { phone: 20, desktop: 50 };

function Heatmap({ stocks }: { stocks: Stock[] }) {
  const phone = usePhone();
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const host = ref.current;
    if (!host) return;
    const measure = () => setSize({ width: host.clientWidth, height: host.clientHeight });
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    return () => observer.disconnect();
  }, []);
  const top = stocks
    .filter((s) => s.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, phone ? heatLimit.phone : heatLimit.desktop)
    .map((stock) => ({ stock, value: phone ? Math.sqrt(stock.value) : stock.value }));
  return (
    <section className="panel heat-panel" aria-labelledby="heat-heading">
      <div className="panel-head">
        <h2 id="heat-heading">Most traded</h2>
        <div className="heat-scale" aria-label="Daily change colour scale">
          {[-4, -2, 0, 2, 4].map((c) => (
            <span key={c} style={heatTone(c)}>
              {c === -4 ? '≤−4%' : c === 4 ? '≥+4%' : `${signed(c, nf)}%`}
            </span>
          ))}
        </div>
      </div>
      <div ref={ref} className="heat">
        {treemap(top, size.width, size.height).map(({ item: { stock: s }, x, y, w, h }) => (
          <a
            key={s.ticker}
            href={`/t/${s.ticker}`}
            aria-label={`${s.ticker} ${s.name}, change ${pct(s.change_pct)}, traded value ${nf(s.value)} IDR`}
            title={`${s.name}\n${nf(s.close)} IDR\n${nf(s.value)} IDR traded`}
            style={{
              left: x,
              top: y,
              width: Math.max(0, w - 2),
              height: Math.max(0, h - 2),
              ...heatTone(s.change_pct),
            }}
          >
            {(phone || (w > 40 && h > 22)) && <b>{s.ticker}</b>}
            {(phone || (w > 52 && h > 40)) && <span>{pct(s.change_pct)}</span>}
          </a>
        ))}
      </div>
    </section>
  );
}

function Signals({ tiles, stockMap }: { tiles: SignalTile[]; stockMap: Map<string, Stock> }) {
  if (!tiles.length) return <p className="signals-empty">No signals on the latest day.</p>;
  return (
    <section className="tiles" aria-label="Signals">
      {tiles.map(({ kind, count, top }) => {
        const lens = lensOf(kind);
        return (
          <div className="tile" key={kind}>
            <a
              className="tile-head"
              href={`/market?show=${kind}`}
              title={lens.label}
              aria-label={`${lens.label}, ${count} ${count === 1 ? 'stock' : 'stocks'}, open in Market`}
            >
              <b>{lens.tag}</b>
              <span className="num">{count}</span>
            </a>
            <ul>
              {top.map((e) => (
                <li key={e.ticker}>
                  <a
                    className="tile-row"
                    href={`/t/${e.ticker}`}
                    title={`${stockMap.get(e.ticker)?.name ?? e.ticker}\n${eventTitle(e)}`}
                  >
                    <b className="sym">{e.ticker}</b>
                    <span className="metric">
                      <EventMetric event={e} />
                    </span>
                    <span className="mag">
                      <i
                        className={tone(e)}
                        style={{ width: `${Math.max(6, magnitude(e, top[0]!) * 100)}%` }}
                      />
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </section>
  );
}

const weekLimit = 6;

function Week({ pins }: { pins: string[] }) {
  const phone = usePhone(),
    calendar = usePublished('calendar'),
    actions = usePublished('actions');
  const items = weekAhead(
    calendar.kind === 'ready' ? calendar.data.cal : [],
    actions.kind === 'ready' ? actions.data.actions : [],
    pins,
    new Date(),
  );
  if (!items.length) return null;
  return (
    <section className="panel week" aria-labelledby="week-heading">
      <h2 id="week-heading">This week</h2>
      <ol>
        {items.slice(0, weekLimit).map((item) => {
          const chip = (
            <time dateTime={item.date} title={dateText(item.date)}>
              {dateText(item.date, false)}
            </time>
          );
          return item.type === 'event' ? (
            <li key={`${item.ts}:${item.country}:${item.title}`} title={item.source}>
              {chip}
              <span className="what">
                <span className="tag">{item.country}</span>
                {item.title}
              </span>
              {item.timed && (
                <span className="when">
                  {wib(item.ts, { day: undefined, month: undefined })} WIB
                </span>
              )}
            </li>
          ) : (
            <li
              key={`${item.ticker}:${item.kind}:${item.date}`}
              className={item.pinned ? 'pinned' : undefined}
              title={item.pinned ? 'On your watchlist' : undefined}
            >
              {chip}
              <a className="what" href={`/t/${item.ticker}`}>
                <b className="sym">{item.ticker}</b>
                <span className="tag">{item.kind}</span>
                <span className="label">{item.label}</span>
              </a>
            </li>
          );
        })}
      </ol>
      {!phone && items.length > weekLimit && (
        <a className="more" href="/terminal">
          {items.length - weekLimit} more in Terminal
        </a>
      )}
    </section>
  );
}

function WatchRow({ stock, events, pin }: { stock: Stock; events: Event[]; pin: ReactNode }) {
  const [history, setHistory] = useState<Ticker | null | 'failed'>(null);
  useEffect(() => {
    let active = true;
    void load(`ticker/${stock.ticker}.json`).then(
      (data) => {
        if (active) setHistory(data ?? 'failed');
      },
      () => {
        if (active) setHistory('failed');
      },
    );
    return () => {
      active = false;
    };
  }, [stock.ticker]);
  const risk = useRiskFor(stock.ticker);
  const detail = history && history !== 'failed' ? history : null;
  const latest: { date: string; text: ReactNode }[] = [
    ...events
      .filter((e) => e.ticker === stock.ticker)
      .map((e) => ({ date: e.date, text: <EventText event={e} /> })),
    ...(detail?.disclosures ?? []).map((d) => ({ date: d.published_at, text: d.title })),
  ].sort((a, b) => b.date.localeCompare(a.date));
  const event = latest[0];
  return (
    <div className="watch-row">
      <div className="watch-id">
        <span className="watch-name">
          <a
            className="watch-link"
            href={`/t/${stock.ticker}`}
            aria-label={`Open ${stock.ticker}, ${stock.name}, watchlist`}
          >
            <b className="sym">{stock.ticker}</b>
          </a>
          <RiskBadge risk={risk} />
        </span>
        <small>{stock.name}</small>
      </div>
      {detail?.prices.length ? (
        <Spark
          rows={detail.prices.slice(-60)}
          label={`${stock.ticker} closing price over 60 trading days`}
        />
      ) : (
        <span className="spark spark-empty">
          {history === 'failed' ? 'History unavailable' : ''}
        </span>
      )}
      <span className="num close">{nf(stock.close)}</span>
      <span className={`num change ${direction(stock.change_pct)}`}>{pct(stock.change_pct)}</span>
      <span className="latest-event">
        {event && (
          <>
            {event.text} <time dateTime={event.date}>{dateText(event.date, false)}</time>
          </>
        )}
      </span>
      {pin}
    </div>
  );
}

const newsLimit = { phone: 6, desktop: 12 };

function News({ news }: { news: Headline[] | null }) {
  const phone = usePhone();
  if (news === null) return null;
  const rows = news
    .filter((n) => n.region === 'ID')
    .sort((a, b) => b.ts.localeCompare(a.ts))
    .slice(0, phone ? newsLimit.phone : newsLimit.desktop);
  if (!rows.length) return null;
  let day = '';
  return (
    <section className="panel news" aria-labelledby="news-heading">
      <h2 id="news-heading">News</h2>
      <ol>
        {rows.map((item) => {
          const d = calendarDate(item.ts),
            heading = d !== day;
          day = d;
          return (
            <li key={item.link}>
              {heading && <h3>{dateText(d)}</h3>}
              <a href={item.link} target="_blank" rel="noreferrer">
                <time dateTime={item.ts} title={`${wib(item.ts)} WIB`}>
                  {wib(item.ts, { day: undefined, month: undefined })}
                </time>
                <span>
                  <strong>{item.title}</strong> <small>{item.src}</small>
                  {item.tags.map((t) => (
                    <span className="tag" key={t}>
                      {t}
                    </span>
                  ))}
                </span>
              </a>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
