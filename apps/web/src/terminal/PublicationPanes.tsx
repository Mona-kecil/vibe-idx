import { Fragment, useEffect, useRef, useState } from 'react';
import { useTerminal } from './state';
import type { Headline, Risk, Resource } from './sources';
import { Availability, Empty, Publication, Scroll, Segments, TickerLink } from './ui';
import { dateText } from '../ticker/format';
import './publication-panes.css';

const perShare = ({ value, currency }: { value: number; currency: string }) =>
  `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 }).format(value)} ${currency} per share`;

const publicationDate = (value: string) =>
  new Date(/T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(value) ? `${value}+07:00` : value);
const wib = (value: string, options: Intl.DateTimeFormatOptions = {}) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jakarta',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    ...options,
  })
    .format(publicationDate(value))
    .replace('Sept', 'Sep');
const calendarDate = (value: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(publicationDate(value));
function usePublicationTimeline(data: unknown, filter: string) {
  const scroll = useRef<HTMLDivElement>(null);
  const now = Date.now();
  const today = calendarDate(new Date(now).toISOString());
  const isPast = (date: string, dateOnly = false) =>
    dateOnly ? calendarDate(date) < today : Date.parse(date) < now;
  useEffect(() => {
    const body = scroll.current;
    const event = body?.querySelector('[data-upcoming="true"]');
    const next = event?.previousElementSibling?.classList.contains('day')
      ? event.previousElementSibling
      : event;
    if (body)
      body.scrollTop = next
        ? next.getBoundingClientRect().top -
          body.getBoundingClientRect().top +
          body.scrollTop -
          (body.querySelector('thead')?.getBoundingClientRect().height ?? 0)
        : body.scrollHeight;
  }, [data, filter]);
  return { scroll, isPast };
}
export function NewsPane() {
  const { publications, filters, filter, ticker, tickerNews } = useTerminal();
  const published = publications.news.kind === 'ready' ? publications.news.data.news : [];
  const source: Resource<Headline[]> =
    filters.news === 'TICKER'
      ? tickerNews
      : publications.news.kind === 'ready'
        ? { kind: 'ready', data: publications.news.data.news }
        : publications.news;
  const tickerItems = tickerNews.kind === 'ready' ? tickerNews.data : [];
  const candidates =
    filters.news === 'TICKER'
      ? [...published.filter((item) => item.tags.includes(ticker)), ...tickerItems]
      : published.filter((item) => item.region === filters.news);
  const list = [
    ...new Map([...candidates].reverse().map((item) => [item.link, item])).values(),
  ].sort((a, b) => b.ts.localeCompare(a.ts));
  const resource: Resource<Headline[]> = list.length ? { kind: 'ready', data: list } : source;
  return (
    <>
      <div className="sub">
        <Segments
          label="News region"
          values={['ID', 'WORLD', 'TICKER']}
          value={filters.news}
          onChange={(value) => filter('news', value)}
        />
      </div>
      <Scroll reset={`${filters.news}:${ticker}`}>
        <Availability resource={resource} name="News">
          {() => {
            let day = '';
            return (
              <>
                {publications.news.kind === 'ready' && (
                  <Publication
                    date={publications.news.data.as_of}
                    errors={publications.news.data.errors}
                  />
                )}
                {list.length ? (
                  list.map((item) => {
                    const date = dateText(calendarDate(item.ts));
                    const heading = date !== day;
                    day = date;
                    const tags = item.tags.filter(
                      (tag) => filters.news !== 'TICKER' || tag !== ticker,
                    );
                    return (
                      <Fragment key={item.link}>
                        {heading && <h3 className="news-day">{date}</h3>}
                        <a className="news-item" href={item.link} target="_blank" rel="noreferrer">
                          <time dateTime={item.ts} title={`${wib(item.ts)} WIB`}>
                            {wib(item.ts, { day: undefined, month: undefined })}
                          </time>
                          <span>
                            <strong>{item.title}</strong>
                            <span className="news-src">{item.src}</span>
                            {tags.length > 0 && (
                              <span className="tags">
                                {tags.map((tag) => (
                                  <span key={tag}>{tag}</span>
                                ))}
                              </span>
                            )}
                          </span>
                        </a>
                      </Fragment>
                    );
                  })
                ) : (
                  <Empty>No news in this view</Empty>
                )}
              </>
            );
          }}
        </Availability>
      </Scroll>
    </>
  );
}
export function CalendarPane() {
  const { publications, filters, filter } = useTerminal();
  const [open, setOpen] = useState<string | null>(null);
  const data = publications.calendar.kind === 'ready' ? publications.calendar.data : null;
  const { scroll, isPast } = usePublicationTimeline(data, filters.cal);
  const rows = (data?.cal ?? [])
    .filter(
      (item) =>
        filters.cal === 'ALL' || (filters.cal === 'HIGH' ? item.imp === 3 : item.c === 'ID'),
    )
    .sort((a, b) => a.ts.localeCompare(b.ts));
  const upcoming = rows.find((item) => !isPast(item.ts, item.dateOnly));
  return (
    <>
      <div className="sub">
        <Segments
          label="Calendar"
          values={['ALL', 'HIGH', 'ID']}
          value={filters.cal}
          onChange={(value) => filter('cal', value)}
        />
      </div>
      {data && <Publication errors={data.errors} />}
      <div className="pb" ref={scroll}>
        <Availability resource={publications.calendar} name="Calendar">
          {(data) => {
            let day = '';
            return (
              <>
                <Publication date={data.as_of} />
                {rows.length ? (
                  <table className="calendar">
                    <thead>
                      <tr>
                        <th>WIB</th>
                        <th>CTRY</th>
                        <th>EVENT</th>
                        <th>IMP</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((item) => {
                        const date = dateText(calendarDate(item.ts));
                        const heading = day !== date;
                        day = date;
                        const key = item.ts + item.ev;
                        return (
                          <Fragment key={key}>
                            {heading && (
                              <tr className="day">
                                <td colSpan={4}>{date}</td>
                              </tr>
                            )}
                            <tr
                              data-upcoming={item === upcoming}
                              className={isPast(item.ts, item.dateOnly) ? 'past' : ''}
                            >
                              <td>
                                {!item.dateOnly &&
                                  wib(item.ts, { day: undefined, month: undefined })}
                              </td>
                              <td>{item.c}</td>
                              <td className="l">
                                <button
                                  aria-expanded={open === key}
                                  onClick={() => setOpen(open === key ? null : key)}
                                >
                                  {item.ev}
                                </button>
                              </td>
                              <td>
                                <span
                                  className={`impact imp-${item.imp}`}
                                  aria-label={`${item.imp === 3 ? 'High' : item.imp === 2 ? 'Medium' : 'Low'} impact`}
                                >
                                  {[1, 2, 3].map((n) => (
                                    <i key={n} className={n <= item.imp ? 'filled' : ''} />
                                  ))}
                                </span>
                              </td>
                            </tr>
                            {open === key && (
                              <tr className="details">
                                <td colSpan={4}>
                                  <a href={item.url} target="_blank" rel="noreferrer">
                                    {item.by}
                                  </a>
                                  {item.sUrl && (
                                    <a href={item.sUrl} target="_blank" rel="noreferrer">
                                      {item.sBy ?? 'Schedule'}
                                    </a>
                                  )}
                                  {(item.f || item.p) && (
                                    <dl>
                                      {item.f && (
                                        <div>
                                          <dt>Forecast</dt>
                                          <dd>{item.f}</dd>
                                        </div>
                                      )}
                                      {item.p && (
                                        <div>
                                          <dt>Previous</dt>
                                          <dd>{item.p}</dd>
                                        </div>
                                      )}
                                    </dl>
                                  )}
                                  {item.note && <p>{item.note}</p>}
                                  {item.est && (
                                    <p>
                                      {/^Date only/i.test(item.est)
                                        ? 'Release time not published by source'
                                        : item.est}
                                    </p>
                                  )}
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                ) : (
                  <Empty>No calendar events</Empty>
                )}
              </>
            );
          }}
        </Availability>
      </div>
    </>
  );
}
const steps = {
  cum: 'CUM',
  ex: 'EX',
  record: 'REC',
  pay: 'PAY',
  distribution: 'DIST',
  listing: 'LIST',
  trade_start: 'TRADE',
  trade_end: 'TRADE END',
  meeting: 'RUPS',
  delisting: 'DELIST',
};
export function ActionsPane() {
  const { publications, filters, filter, ticker, data: market } = useTerminal();
  const [open, setOpen] = useState<string | null>(null);
  const data = publications.actions.kind === 'ready' ? publications.actions.data : null;
  const { scroll, isPast } = usePublicationTimeline(
    data,
    `${filters.ca}:${filters.ca === 'TICKER' ? ticker : ''}`,
  );
  const rows = (data?.actions ?? [])
    .filter(
      (item) =>
        filters.ca === 'ALL' ||
        (filters.ca === 'TICKER' ? item.ticker === ticker : item.kind === filters.ca),
    )
    .flatMap((action) => action.steps.map((step) => ({ action, ...step })))
    .sort((a, b) => a.date.localeCompare(b.date));
  const upcoming = rows.find((row) => !isPast(row.date, true));
  return (
    <>
      <div className="sub">
        <Segments
          label="Corporate actions"
          values={['ALL', 'DIV', 'RIGHTS', 'RUPS', 'TICKER']}
          value={filters.ca}
          onChange={(value) => filter('ca', value)}
        />
      </div>
      <div className="pb" ref={scroll}>
        <Availability resource={publications.actions} name="Corporate actions">
          {() => {
            let day = '';
            return (
              <>
                <Publication date={market.health.corporate_actions} />
                {rows.length ? (
                  <table className="actions">
                    <tbody>
                      {rows.map((row, i) => {
                        const heading = day !== row.date.slice(0, 10);
                        day = row.date.slice(0, 10);
                        const key = `${row.action.ticker}:${row.action.label}:${row.step}:${i}`;
                        return (
                          <Fragment key={key}>
                            {heading && (
                              <tr className="day">
                                <td colSpan={3}>{dateText(row.date)}</td>
                              </tr>
                            )}
                            <tr
                              data-upcoming={row === upcoming}
                              className={`${row.action.ticker === ticker ? 'on' : ''}${isPast(row.date, true) ? ' past' : ''}`}
                            >
                              <td className="accent">{steps[row.step]}</td>
                              <td>
                                <TickerLink ticker={row.action.ticker} />
                              </td>
                              <td className="l">
                                <button
                                  aria-expanded={open === key}
                                  onClick={() => setOpen(open === key ? null : key)}
                                >
                                  {row.action.label}
                                </button>
                                {row.action.amount && (
                                  <span className="mut action-amount">
                                    {' '}
                                    {perShare(row.action.amount)}
                                  </span>
                                )}
                              </td>
                            </tr>
                            {open === key && (
                              <tr className="details">
                                <td colSpan={3}>
                                  <dl>
                                    {row.action.steps.map((step) => (
                                      <div key={`${step.step}:${step.date}`}>
                                        <dt>{steps[step.step]}</dt>
                                        <dd>
                                          {step.date.length > 10
                                            ? `${wib(step.date)} WIB`
                                            : dateText(step.date)}
                                        </dd>
                                      </div>
                                    ))}
                                  </dl>
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                ) : (
                  <Empty>No corporate actions in this view</Empty>
                )}
              </>
            );
          }}
        </Availability>
      </div>
    </>
  );
}
const hasRisk = (risk: Risk, filter: string) =>
  filter === 'ALL'
    ? risk.susp || risk.uma || risk.notes.length > 0
    : filter === 'SUSP'
      ? risk.susp
      : filter === 'UMA'
        ? risk.uma
        : filter === 'FCA'
          ? risk.notes.some((note) => note.code === 'X')
          : risk.notes.length > 0;
export function RiskPane() {
  const { publications, filters, filter, ticker, data: market } = useTerminal();
  const [open, setOpen] = useState<string | null>(null);
  return (
    <>
      <div className="sub">
        <Segments
          label="Risk flags"
          values={['ALL', 'SUSP', 'UMA', 'FCA', 'NOTES']}
          value={filters.risk}
          onChange={(value) => filter('risk', value)}
        />
      </div>
      <Scroll reset={filters.risk}>
        <Availability resource={publications.risks} name="Risk flags">
          {(data) => {
            const rows = Object.entries(data.risk)
              .filter(([, risk]) => hasRisk(risk, filters.risk))
              .sort(
                (a, b) =>
                  (b[1].susp?.since ?? b[1].uma?.date ?? '').localeCompare(
                    a[1].susp?.since ?? a[1].uma?.date ?? '',
                  ) || a[0].localeCompare(b[0]),
              );
            return (
              <>
                <Publication date={market.health.risk} />
                {rows.length ? (
                  <table className="risk-table">
                    <colgroup>
                      <col className="risk-ticker" />
                      <col className="risk-flags" />
                      <col className="risk-date" />
                      <col />
                    </colgroup>
                    <tbody>
                      {rows.map(([code, risk]) => {
                        const date = risk.susp?.since ?? risk.uma?.date;
                        const flags = [
                          ...(risk.susp
                            ? [{ code: 'SUSP', text: 'Suspended', url: risk.susp.url }]
                            : []),
                          ...(risk.uma
                            ? [{ code: 'UMA', text: 'Unusual market activity', url: risk.uma.url }]
                            : []),
                          ...risk.notes.map((note) => ({
                            ...note,
                            code: note.code === 'X' ? 'FCA' : note.code,
                            url: undefined,
                          })),
                        ];
                        const reason = [risk.susp?.reason, ...risk.notes.map((note) => note.text)]
                          .filter(Boolean)
                          .join('; ');
                        return (
                          <Fragment key={code}>
                            <tr className={ticker === code ? 'on' : ''}>
                              <td>
                                <TickerLink ticker={code} />
                              </td>
                              <td>
                                <button
                                  aria-label={`Risk details for ${code}`}
                                  aria-expanded={open === code}
                                  onClick={() => setOpen(open === code ? null : code)}
                                >
                                  <span className="flags">
                                    {flags.map((flag) => (
                                      <span
                                        className={`flag${flag.code === 'SUSP' ? ' sus' : flag.code === 'UMA' ? ' uma' : ''}`}
                                        key={flag.code}
                                        aria-label={`${flag.code}: ${flag.text}`}
                                      >
                                        {flag.code}
                                      </span>
                                    ))}
                                  </span>
                                </button>
                              </td>
                              <td className="mut">{date && dateText(date)}</td>
                              <td className="l">
                                <span className="risk-reason">{reason}</span>
                              </td>
                            </tr>
                            {open === code && (
                              <tr className="details">
                                <td colSpan={4}>
                                  <dl>
                                    {flags.map((flag) => (
                                      <div key={flag.code}>
                                        <dt>{flag.code}</dt>
                                        <dd>
                                          {flag.url ? (
                                            <a href={flag.url} target="_blank" rel="noreferrer">
                                              {flag.text}
                                            </a>
                                          ) : (
                                            flag.text
                                          )}
                                        </dd>
                                      </div>
                                    ))}
                                  </dl>
                                  {risk.susp?.reason && <p>{risk.susp.reason}</p>}
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                ) : (
                  <Empty>No flagged stocks</Empty>
                )}
              </>
            );
          }}
        </Availability>
      </Scroll>
    </>
  );
}
