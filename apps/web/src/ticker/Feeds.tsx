import { useEffect, useState } from 'react';
import { loadNews, type Ticker } from '../data';
import {
  aggregateRange,
  attachments,
  bounds,
  holderLabel,
  inRange,
  isOwnershipFiling,
  summaryEvents,
  totalAt,
  type Filing,
  type HoldingEvent,
  type Selection,
} from './logic';
import { dateText, direction, itemDate, nf, rangeText, short, signed } from './format';

export function OwnershipName({
  event,
  label = event.name,
}: {
  event: HoldingEvent;
  label?: string;
}) {
  return event.sources[0] ? (
    <a
      href={event.sources[0]}
      title={event.sources.slice(1).join('\n') || undefined}
      target="_blank"
      rel="noopener noreferrer"
    >
      {label}
    </a>
  ) : (
    <>{label}</>
  );
}
export function HoldingValue({
  data,
  event,
  side,
  exact = false,
}: {
  data: Ticker;
  event: HoldingEvent;
  side: 'before' | 'after';
  exact?: boolean;
}) {
  const value = side === 'before' ? event.shares_before : event.shares_after;
  const total = totalAt(data, event.date);
  return (
    <>
      {value === null
        ? 'Below 5%'
        : `${exact ? nf(value) : short(value)}${total ? ` (${nf((value / total) * 100, 2)}%)` : ''}`}
    </>
  );
}
export function FilingAttachments({ filing }: { filing: Filing }) {
  const links = attachments(filing);
  return (
    links.length > 0 && (
      <div className="filing-attachments">
        {links.map((a) => (
          <a key={a.url} href={a.url} target="_blank" rel="noopener noreferrer">
            {a.label}
          </a>
        ))}
      </div>
    )
  );
}
export function SelectionSummary({
  data,
  events,
  selection,
  clear,
}: {
  data: Ticker;
  events: HoldingEvent[];
  selection: Selection;
  clear: () => void;
}) {
  const b = bounds(selection),
    totals = aggregateRange(data.prices, selection);
  if (!b || !totals) return null;
  const isRange = b.start !== b.end;
  const fields = [
    ...(!isRange
      ? [{ label: 'Close', unit: 'IDR', value: nf(totals.close), cls: '', title: '' }]
      : []),
    {
      label: 'Change',
      unit: isRange ? 'IDR' : '',
      value:
        totals.change === null
          ? '—'
          : `${signed(totals.change, nf)} (${signed(totals.changePct ?? 0, (v) => nf(v, 2))}%)`,
      cls: direction(totals.change),
      title: totals.prior
        ? `From ${nf(totals.prior.close)} on ${dateText(totals.prior.date)}`
        : 'No preceding close',
    },
    ...(isRange
      ? [
          { label: 'High close', unit: 'IDR', value: nf(totals.high), cls: '', title: '' },
          { label: 'Low close', unit: 'IDR', value: nf(totals.low), cls: '', title: '' },
        ]
      : []),
    ...(!isRange && totals.suspended === 1
      ? [{ label: 'Status', unit: '', value: 'Suspended', cls: '', title: '' }]
      : [
          {
            label: 'Volume',
            unit: 'shares',
            value: short(totals.volume),
            cls: '',
            title: nf(totals.volume) + ' shares',
          },
          {
            label: 'Value',
            unit: 'IDR',
            value: short(totals.value),
            cls: '',
            title: nf(totals.value) + ' IDR',
          },
          {
            label: 'Net foreign',
            unit: 'IDR (est.)',
            value: signed(totals.netForeign),
            cls: direction(totals.netForeign),
            title: signed(totals.netForeign, nf) + ' IDR',
          },
        ]),
  ];
  return (
    <div id="day-strip" className={`day-strip ${isRange ? 'range-summary' : ''}`}>
      <button
        className="clear-day"
        aria-label="Clear selection"
        title="Clear selection  Esc"
        onClick={clear}
      >
        ×
      </button>
      <div className={`day-values ${isRange ? 'range-values' : ''}`}>
        {!isRange && <strong className="day-date">{dateText(b.start)}</strong>}
        {fields.map((f) => (
          <dl key={f.label}>
            <dt>
              {f.label}
              {f.unit && <small className="unit-suffix">{f.unit}</small>}
            </dt>
            <dd className={f.cls} title={f.title || undefined}>
              {f.value}
            </dd>
          </dl>
        ))}
      </div>
      <ul className="day-events">
        {summaryEvents(events, data.disclosures, selection).map((row) =>
          row.kind === 'ownership' ? (
            <li
              key={`o:${row.event.name}:${row.date}`}
              className="day-ownership"
              data-date={row.date}
            >
              <span>
                <time className="event-date-inline">{dateText(row.date, false)}</time>
                <OwnershipName
                  event={row.event}
                  label={holderLabel(row.event.name).replace(/ TRADING$/i, '')}
                />
              </span>
              <span
                title={`${row.event.shares_before === null ? 'Below 5%' : nf(row.event.shares_before)} → ${row.event.shares_after === null ? 'Below 5%' : nf(row.event.shares_after)} shares`}
              >
                <HoldingValue data={data} event={row.event} side="before" /> →{' '}
                <HoldingValue data={data} event={row.event} side="after" />
                <span
                  className={`event-delta ${direction(row.event.shares_after !== null && row.event.shares_before !== null ? row.event.shares_after - row.event.shares_before : null)}`}
                >
                  {row.event.shares_before === null || row.event.shares_after === null
                    ? 'Below 5%'
                    : signed(row.event.shares_after - row.event.shares_before)}
                </span>
              </span>
            </li>
          ) : (
            <li key={row.filing.id} className="day-filing" data-date={row.date}>
              <time className="event-date-inline">{dateText(row.date, false)}</time>
              <div className="filing-body">
                <a
                  href={row.filing.url}
                  title={row.filing.title}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {row.filing.title}
                </a>
                <FilingAttachments filing={row.filing} />
              </div>
            </li>
          ),
        )}
      </ul>
    </div>
  );
}
export function FilingsNews({
  data,
  events,
  selection,
}: {
  data: Ticker;
  events: HoldingEvent[];
  selection: Selection;
}) {
  const [news, setNews] = useState<Awaited<ReturnType<typeof loadNews>>>([]);
  const [allFilings, setAllFilings] = useState(false),
    [allNews, setAllNews] = useState(false);
  const b = bounds(selection),
    start = b?.start,
    end = b?.end;
  useEffect(() => {
    let active = true;
    setNews([]);
    const timer = setTimeout(() => {
      void loadNews(data.ticker, start && end ? { start, end } : undefined).then(
        (rows) => {
          if (active) setNews(rows);
        },
        () => {},
      );
    }, 300);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [data.ticker, start, end]);
  const filings = data.disclosures
    .filter(
      (f) =>
        inRange(f.published_at.slice(0, 10), selection) &&
        (!selection || !isOwnershipFiling(f, events)),
    )
    .sort((a, b) => b.published_at.localeCompare(a.published_at));
  const articles = news
    .filter((n) => inRange(itemDate(n.published_at), selection))
    .sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at));
  const range = b ? rangeText(b.start, b.end) : '';
  return (
    <section className="section" id="filings-section" aria-labelledby="filings-heading">
      <div className="section-head">
        <h2 id="filings-heading">Filings & news</h2>
      </div>
      <div className="filing-grid">
        <div>
          <div className="subhead">
            <h3>IDX disclosures</h3>
            <span className="date-label">{filings.length} filings</span>
          </div>
          <ul className="feed" id="filings">
            {filings.slice(0, allFilings ? filings.length : 8).map((f) => (
              <li key={f.id} data-date={f.published_at.slice(0, 10)}>
                <div className="feed-meta">
                  <time dateTime={f.published_at.slice(0, 10)}>{dateText(f.published_at)}</time>
                </div>
                <a className="feed-title" href={f.url} target="_blank" rel="noopener noreferrer">
                  {f.title}
                  <External />
                </a>
                <FilingAttachments filing={f} />
              </li>
            ))}
            {!filings.length && <li className="empty-state">No filings {range}</li>}
          </ul>
          {filings.length > 8 && (
            <button
              className="show-all"
              id="filing-toggle"
              aria-expanded={allFilings}
              onClick={() => setAllFilings(!allFilings)}
            >
              {allFilings ? 'Show less' : 'Show all disclosures'}
            </button>
          )}
        </div>
        <div>
          <div className="subhead">
            <h3>News</h3>
            <span className="date-label">{articles.length} articles</span>
          </div>
          <ul className="feed" id="news">
            {articles.slice(0, allNews ? articles.length : 8).map((n) => (
              <li key={n.url} data-date={itemDate(n.published_at)}>
                <div className="feed-meta">
                  <span>{n.source}</span>
                  <time dateTime={itemDate(n.published_at)}>{dateText(n.published_at)}</time>
                </div>
                <a className="feed-title" href={n.url} target="_blank" rel="noopener noreferrer">
                  {n.title}
                  <External />
                </a>
              </li>
            ))}
            {!articles.length && <li className="empty-state">No news {range}</li>}
          </ul>
          {articles.length > 8 && (
            <button
              className="show-all"
              aria-expanded={allNews}
              onClick={() => setAllNews(!allNews)}
            >
              {allNews ? 'Show less' : 'Show all news'}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
function External() {
  return (
    <svg viewBox="0 0 16 16" fill="none" strokeWidth="1.3" aria-hidden="true">
      <path d="M5 3h8v8M13 3 3 13" />
    </svg>
  );
}
