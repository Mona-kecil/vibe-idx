import { useEffect, useRef, useState, type ReactNode } from 'react';
import { load, type Feed, type Health, type Market, type Stock, type Ticker } from './data';
import {
  briefing,
  date,
  EventMetric,
  EventText,
  eventTitle,
  lensOf,
  lenses,
  pct,
  signed,
  type Event,
  type Lens,
} from './events';
import { PinButton, SiteHeader } from './SiteHeader';
import { Stale } from './Stale';
import { fetchHeadlines, type Headline } from './terminal/sources';
import { treemap } from './treemap';
import { calendarDate, dateText, direction, nf, wib } from './ticker/format';
import { readStorage, usePins, writeStorage } from './watchlist';
import './home.css';

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
      <div className="today">
        <Heatmap stocks={data.stocks} />
        <Signals events={events} stockMap={stockMap} />
      </div>
      {watched.length > 0 && (
        <section className="panel watchlist" aria-labelledby="watch-heading">
          <h2 id="watch-heading">Watchlist</h2>
          {watched.map((s) => (
            <WatchRow key={s.ticker} stock={s} events={events} pin={pin(s.ticker)} />
          ))}
        </section>
      )}
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
      <div className="pulse-stat">
        <span className="up num">{nf(data.market.up)}</span> up{' '}
        <span className="down num">{nf(data.market.down)}</span> down
      </div>
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

function Heatmap({ stocks }: { stocks: Stock[] }) {
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
    .slice(0, 50);
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
        {treemap(top, size.width, size.height).map(({ item: s, x, y, w, h }) => (
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
            {w > 40 && h > 22 && <b>{s.ticker}</b>}
            {w > 52 && h > 40 && <span>{pct(s.change_pct)}</span>}
          </a>
        ))}
      </div>
    </section>
  );
}

const listLimit = 14;
function Signals({ events, stockMap }: { events: Event[]; stockMap: Map<string, Stock> }) {
  const [lens, setLens] = useState<Lens | null>(() => {
    const saved = readStorage('vibe-idx:home-signals');
    return lenses.find((l) => l.kind === saved)?.kind ?? null;
  });
  const choose = (next: Lens | null) => {
    setLens(next);
    writeStorage('vibe-idx:home-signals', next ?? 'all');
  };
  const counts = new Map<Lens, number>();
  for (const e of events) counts.set(e.kind, (counts.get(e.kind) ?? 0) + 1);
  const rows = lens ? events.filter((e) => e.kind === lens) : events;
  return (
    <section className="panel signals" aria-labelledby="signals-heading">
      <div className="panel-head">
        <h2 id="signals-heading">Signals</h2>
      </div>
      <div className="tabs" role="group" aria-label="Signal kind">
        <button type="button" aria-pressed={!lens} onClick={() => choose(null)}>
          All <small>{events.length}</small>
        </button>
        {lenses
          .filter((l) => counts.has(l.kind))
          .map((l) => (
            <button
              key={l.kind}
              type="button"
              title={l.label}
              aria-pressed={lens === l.kind}
              onClick={() => choose(l.kind)}
            >
              {l.tag} <small>{counts.get(l.kind)}</small>
            </button>
          ))}
      </div>
      {rows.length ? (
        <ol className="signal-rows" id="signal-rows">
          {rows.slice(0, listLimit).map((e, i) => (
            <li key={`${e.ticker}:${e.kind}:${i}`}>
              <a
                href={`/t/${e.ticker}`}
                title={`${stockMap.get(e.ticker)?.name ?? e.ticker}\n${eventTitle(e)}`}
              >
                <b className="sym">{e.ticker}</b>
                <span className="tag">{lensOf(e.kind).tag}</span>
                <span className="detail">
                  {e.kind === 'five_pct_change' ? (
                    <EventText event={e} />
                  ) : (
                    <EventMetric event={e} />
                  )}
                </span>
              </a>
            </li>
          ))}
        </ol>
      ) : (
        <p className="empty">No signals on the latest day.</p>
      )}
      {lens ? (
        rows.length > listLimit && (
          <a className="more" href={`/market?show=${lens}`}>
            All {rows.length} in Market
          </a>
        )
      ) : (
        <a className="more" href="/market">
          Open Market
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
      <a
        className="watch-link"
        href={`/t/${stock.ticker}`}
        aria-label={`Open ${stock.ticker}, ${stock.name}, watchlist`}
      >
        <span className="watch-id">
          <b className="sym">{stock.ticker}</b>
          <small>{stock.name}</small>
        </span>
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
      </a>
      {pin}
    </div>
  );
}

function News({ news }: { news: Headline[] | null }) {
  if (news === null) return null;
  const rows = news
    .filter((n) => n.region === 'ID')
    .sort((a, b) => b.ts.localeCompare(a.ts))
    .slice(0, 12);
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
