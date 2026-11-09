import { Fragment, useState } from 'react';
import { useTerminal } from './state';
import type { Headline, Risk, Resource } from './sources';
import { Availability, Empty, Publication, RiskFlags, Scroll, Segments, TickerLink } from './ui';
import { dateText } from '../ticker/format';
import './publication-panes.css';

const perShare = ({ value, currency }: { value: number; currency: string }) =>
  `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 }).format(value)} ${currency} per share`;

const wib = (value: string, options: Intl.DateTimeFormatOptions = {}) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jakarta',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    ...options,
  }).format(new Date(value));
export function NewsPane() {
  const { publications, filters, filter, ticker, tickerNews } = useTerminal();
  const [article, setArticle] = useState<Headline | null>(null);
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
  const index = article ? list.indexOf(article) : -1;
  return (
    <>
      <div className="sub">
        <Segments
          label="News region"
          values={['ID', 'WORLD', 'TICKER']}
          value={filters.news}
          onChange={(value) => {
            filter('news', value);
            setArticle(null);
          }}
        />
        <Segments
          label="Open news in"
          values={['READER', 'NEW TAB']}
          value={filters.open}
          onChange={(value) => {
            filter('open', value);
            setArticle(null);
          }}
        />
      </div>
      <Scroll reset={`${filters.news}:${ticker}`}>
        <Availability resource={resource} name="News">
          {() => (
            <>
              {publications.news.kind === 'ready' && (
                <Publication
                  date={publications.news.data.as_of}
                  errors={publications.news.data.errors}
                />
              )}
              {list.length ? (
                list.map((item) => {
                  const body = (
                    <>
                      <div className="news-meta">
                        <time>{wib(item.ts)} WIB</time>
                        <span>{item.src}</span>
                      </div>
                      <strong>{item.title}</strong>
                      <div className="tags">
                        {item.tags.map((tag) => (
                          <span key={tag}>{tag}</span>
                        ))}
                      </div>
                    </>
                  );
                  return filters.open === 'NEW TAB' ? (
                    <a
                      className="news-item"
                      key={item.link}
                      href={item.link}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {body}
                    </a>
                  ) : (
                    <button
                      className={`news-item${article === item ? ' on' : ''}`}
                      key={item.link}
                      onClick={() => setArticle(item)}
                    >
                      {body}
                    </button>
                  );
                })
              ) : (
                <Empty>No news in this view</Empty>
              )}
            </>
          )}
        </Availability>
      </Scroll>
      {article && (
        <aside className="reader" aria-label="Article reader">
          <header>
            <span>{article.src}</span>
            <time>{wib(article.ts)} WIB</time>
            <nav>
              <button
                aria-label="Previous article"
                disabled={index <= 0}
                onClick={() => setArticle(list[index - 1] ?? null)}
              >
                ↑
              </button>
              <button
                aria-label="Next article"
                disabled={index < 0 || index >= list.length - 1}
                onClick={() => setArticle(list[index + 1] ?? null)}
              >
                ↓
              </button>
              <button aria-label="Close reader" onClick={() => setArticle(null)}>
                ×
              </button>
            </nav>
          </header>
          <div className="reader-body" key={article.link}>
            <h1>{article.title}</h1>
            <div className="tags">
              {article.tags.map((tag) => (
                <TickerLink key={tag} ticker={tag} />
              ))}
            </div>
            {article.sum ? <p>{article.sum}</p> : <Empty>Summary unavailable</Empty>}
          </div>
          <footer>
            <a href={article.link} target="_blank" rel="noreferrer">
              OPEN ORIGINAL
            </a>
          </footer>
        </aside>
      )}
    </>
  );
}
export function CalendarPane() {
  const { publications, filters, filter } = useTerminal();
  const [open, setOpen] = useState<string | null>(null);
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
      <Scroll reset={filters.cal}>
        <Availability resource={publications.calendar} name="Calendar">
          {(data) => {
            const rows = data.cal
              .filter(
                (item) =>
                  filters.cal === 'ALL' ||
                  (filters.cal === 'HIGH' ? item.imp === 3 : item.c === 'ID'),
              )
              .sort((a, b) => a.ts.localeCompare(b.ts));
            let day = '';
            return (
              <>
                <Publication date={data.as_of} errors={data.errors} />
                {rows.length ? (
                  <table className="calendar">
                    <thead>
                      <tr>
                        <th>WIB</th>
                        <th>CTRY</th>
                        <th>EVENT</th>
                        <th>IMP</th>
                        <th>FCST</th>
                        <th>PREV</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((item) => {
                        const date = wib(item.ts, {
                          hour: undefined,
                          minute: undefined,
                          year: 'numeric',
                        });
                        const heading = day !== date;
                        day = date;
                        const key = item.ts + item.ev;
                        return (
                          <Fragment key={key}>
                            {heading && (
                              <tr className="day">
                                <td colSpan={6}>{date}</td>
                              </tr>
                            )}
                            <tr className={Date.parse(item.ts) < Date.now() ? 'past' : ''}>
                              <td>{wib(item.ts, { day: undefined, month: undefined })}</td>
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
                              <td>{item.f}</td>
                              <td className="mut">{item.p}</td>
                            </tr>
                            {open === key && (
                              <tr className="details">
                                <td colSpan={6}>
                                  <a href={item.url} target="_blank" rel="noreferrer">
                                    {item.by}
                                  </a>
                                  {item.sUrl && (
                                    <a href={item.sUrl} target="_blank" rel="noreferrer">
                                      {item.sBy ?? 'Schedule'}
                                    </a>
                                  )}
                                  {item.note && <p>{item.note}</p>}
                                  {item.est && <p>{item.est}</p>}
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
      </Scroll>
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
  const { publications, filters, filter, ticker, setTicker, data: market } = useTerminal();
  const [open, setOpen] = useState<string | null>(null);
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
      <Scroll reset={`${filters.ca}:${filters.ca === 'TICKER' ? ticker : ''}`}>
        <Availability resource={publications.actions} name="Corporate actions">
          {(data) => {
            const rows = data.actions
              .filter(
                (item) =>
                  filters.ca === 'ALL' ||
                  (filters.ca === 'TICKER' ? item.ticker === ticker : item.kind === filters.ca),
              )
              .flatMap((action) => action.steps.map((step) => ({ action, ...step })))
              .sort((a, b) => a.date.localeCompare(b.date));
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
                            <tr className={row.action.ticker === ticker ? 'on' : ''}>
                              <td className="accent">{steps[row.step]}</td>
                              <td>
                                <TickerLink ticker={row.action.ticker} />
                              </td>
                              <td className="l">
                                <button
                                  aria-expanded={open === key}
                                  onClick={() => {
                                    setOpen(open === key ? null : key);
                                    setTicker(row.action.ticker);
                                  }}
                                >
                                  {row.action.label}
                                </button>
                                {row.action.amount && (
                                  <span className="mut"> {perShare(row.action.amount)}</span>
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
                                            ? `${dateText(step.date)} ${step.date.slice(11, 16)} WIB`
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
      </Scroll>
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
                  <table>
                    <tbody>
                      {rows.map(([code, risk]) => (
                        <tr key={code} className={ticker === code ? 'on' : ''}>
                          <td>
                            <TickerLink ticker={code} />
                          </td>
                          <td>
                            <RiskFlags risk={risk} />
                          </td>
                          <td className="mut">{risk.susp?.since ?? risk.uma?.date}</td>
                          <td className="l">
                            {[
                              risk.susp?.reason,
                              ...risk.notes
                                .filter((note) => note.code !== 'X')
                                .map((note) => note.text),
                            ]
                              .filter(Boolean)
                              .join('; ')}
                          </td>
                        </tr>
                      ))}
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
