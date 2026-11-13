import type { Ticker } from '../data';
import { attachments } from '../ticker/logic';
import { dateText } from '../ticker/format';
import type { NewsArticle, TerminalData } from './sources';
import { useTerminal, type usePublications } from './state';
import { Availability, Empty, Scroll } from './ui';
import './company-feed.css';

type Action = Extract<
  ReturnType<typeof usePublications>['actions'],
  { kind: 'ready' }
>['data']['actions'][number];
type FeedItem =
  | { kind: 'disclosure'; date: string; key: string; filing: Ticker['disclosures'][number] }
  | { kind: 'news'; date: string; key: string; article: NewsArticle }
  | {
      kind: 'action';
      date: string;
      key: string;
      action: Action;
      step: Action['steps'][number]['step'];
    };
const stepNames: Record<Action['steps'][number]['step'], string> = {
  cum: 'Cum date',
  ex: 'Ex date',
  record: 'Record date',
  pay: 'Payment',
  distribution: 'Distribution',
  listing: 'Listing',
  trade_start: 'Trading starts',
  trade_end: 'Trading ends',
  meeting: 'RUPS',
  delisting: 'Delisting',
};
const dateOnly = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date);
const timestamp = (date: string) =>
  new Date(
    dateOnly(date)
      ? `${date}T00:00:00+07:00`
      : /T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(date)
        ? `${date}+07:00`
        : date,
  );
const dayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' });
const day = (date: Date) => dayFormat.format(date);
const typeNames = { disclosure: 'IDX disclosure', news: 'News', action: 'Corporate action' };
function TypeMark({ kind }: { kind: FeedItem['kind'] }) {
  return (
    <svg className="feed-type" viewBox="0 0 20 20" role="img" aria-label={typeNames[kind]}>
      <title>{typeNames[kind]}</title>
      {kind === 'disclosure' ? (
        <path d="M4 2h8l4 4v12H4z M12 2v5h4 M7 10h6 M7 13h6" />
      ) : kind === 'news' ? (
        <path d="M2 4h16v12H2z M5 7h4v4H5z M12 7h3 M12 10h3 M5 13h10" />
      ) : (
        <path d="M3 4h14v14H3z M3 8h14 M6 2v4 M14 2v4 M6 11h2 M12 11h2 M6 14h2 M12 14h2" />
      )}
    </svg>
  );
}
// A label with a lowercase word reads as a title; one without is a file code such as 036CSGIVR2026.
const readable = (label: string) => /[a-z]{3,}/.test(label);
function FeedAttachments({ filing }: { filing: Ticker['disclosures'][number] }) {
  const links = attachments(filing);
  return (
    links.length > 0 && (
      <div className="filing-attachments">
        {links.map((attachment, index) => (
          <a
            key={attachment.url}
            href={attachment.url}
            target="_blank"
            rel="noopener noreferrer"
            title={`${attachment.label}\n${attachment.name}`}
          >
            {readable(attachment.label) ? attachment.label : `Lampiran ${index + 1}`}
          </a>
        ))}
      </div>
    )
  );
}
function FeedRow({ item }: { item: FeedItem }) {
  const date = timestamp(item.date);
  const source =
    item.kind === 'disclosure'
      ? item.filing.url
      : item.kind === 'news'
        ? item.article.link
        : undefined;
  return (
    <tr data-feed-kind={item.kind} data-source-date={item.date}>
      <td>
        <TypeMark kind={item.kind} />
      </td>
      <td className="feed-date">
        <time
          dateTime={dateOnly(item.date) ? item.date : date.toISOString()}
          title={
            new Intl.DateTimeFormat('en-GB', {
              timeZone: 'Asia/Jakarta',
              dateStyle: 'full',
              ...(dateOnly(item.date) ? {} : { timeStyle: 'short' }),
            }).format(date) + (dateOnly(item.date) ? '' : ' WIB')
          }
        >
          {dateText(day(date))}
        </time>
      </td>
      <td className="l feed-content">
        {item.kind === 'action' ? (
          <>
            <span className="accent">{stepNames[item.step]}</span> {item.action.label}
            {item.action.amount && (
              <>
                {' '}
                {new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 }).format(
                  item.action.amount.value,
                )}{' '}
                {item.action.amount.currency} per share
              </>
            )}
            {item.date.length > 10 && (
              <time className="feed-time">
                {' '}
                {new Intl.DateTimeFormat('en-GB', {
                  timeZone: 'Asia/Jakarta',
                  hour: '2-digit',
                  minute: '2-digit',
                }).format(date)}{' '}
                WIB
              </time>
            )}
          </>
        ) : (
          <>
            <a
              href={source}
              target="_blank"
              rel="noreferrer"
              title={
                item.kind === 'news' ? `${item.article.src}\n${item.article.link}` : item.filing.url
              }
            >
              {item.kind === 'disclosure' ? item.filing.title : item.article.title}
            </a>
            {item.kind === 'disclosure' && <FeedAttachments filing={item.filing} />}
          </>
        )}
      </td>
    </tr>
  );
}
function SourceDate({ health, noActions }: { health: TerminalData['health']; noActions: boolean }) {
  const { ticker, publications } = useTerminal();
  const dates = [
    health.disclosures && `Disclosures ${dateText(health.disclosures)}`,
    publications.news.kind === 'ready' &&
      publications.news.data.as_of &&
      `Market news ${dateText(publications.news.data.as_of)}`,
    health.corporate_actions && `Corporate actions ${dateText(health.corporate_actions)}`,
  ]
    .filter(Boolean)
    .join('\n');
  return health.corporate_actions ? (
    <span className="feed-asof" title={dates} data-feed-empty={noActions ? 'action' : undefined}>
      {noActions ? `No corporate actions for ${ticker} as of ` : 'Actions as of '}
      {dateText(health.corporate_actions)}
    </span>
  ) : (
    <Empty>
      {noActions
        ? `No corporate actions for ${ticker}; reporting date unavailable`
        : 'Corporate action reporting date unavailable'}
    </Empty>
  );
}
export function CompanyFeedPane() {
  const { ticker, detail, tickerNews, publications, data } = useTerminal();
  const filings = detail.kind === 'ready' ? detail.data.disclosures : [];
  const candidates = [
    ...(publications.news.kind === 'ready'
      ? publications.news.data.news.filter((item) => item.tags.includes(ticker))
      : []),
    ...(tickerNews.kind === 'ready' ? tickerNews.data : []),
  ];
  const news = [...new Map([...candidates].reverse().map((item) => [item.link, item])).values()];
  const actions =
    publications.actions.kind === 'ready'
      ? publications.actions.data.actions.filter((item) => item.ticker === ticker)
      : [];
  const items: FeedItem[] = [
    ...filings.map(
      (filing): FeedItem => ({
        kind: 'disclosure',
        date: filing.published_at,
        key: `d:${filing.id}`,
        filing,
      }),
    ),
    ...news.map(
      (article): FeedItem => ({
        kind: 'news',
        date: article.ts,
        key: `n:${article.link}`,
        article,
      }),
    ),
    ...actions.flatMap((action, i) =>
      action.steps.map(
        (step, j): FeedItem => ({
          kind: 'action',
          date: step.date,
          key: `a:${i}:${j}`,
          action,
          step: step.step,
        }),
      ),
    ),
  ];
  const now = Date.now();
  const today = day(new Date(now));
  const upcoming = (item: FeedItem) =>
    item.kind === 'action' &&
    (dateOnly(item.date) ? item.date >= today : timestamp(item.date).getTime() >= now);
  items.sort(
    (a, b) =>
      Number(upcoming(b)) - Number(upcoming(a)) ||
      (upcoming(a) ? 1 : -1) * (timestamp(a.date).getTime() - timestamp(b.date).getTime()) ||
      a.key.localeCompare(b.key),
  );
  const upcomingItems = items.filter(upcoming);
  const recentItems = items.filter((item) => !upcoming(item));
  return (
    <Scroll reset={ticker} className="company-feed">
      <div className="feed-status">
        <SourceDate
          health={data.health}
          noActions={
            publications.actions.kind === 'ready' && !actions.some((action) => action.steps.length)
          }
        />
        {publications.news.kind === 'ready' &&
          publications.news.data.errors.map((error) => <Empty key={error}>{error}</Empty>)}
        <Availability resource={detail} name="Disclosures">
          {() => !filings.length && <Empty>No disclosures for {ticker}</Empty>}
        </Availability>
        <Availability resource={tickerNews} name="Ticker news">
          {() =>
            !news.length && (
              <Empty>
                <span data-feed-empty="news">No news for {ticker}</span>
              </Empty>
            )
          }
        </Availability>
        <Availability resource={publications.actions} name="Corporate actions">
          {() => null}
        </Availability>
      </div>
      <table aria-label="Company feed">
        <colgroup>
          <col className="feed-mark-column" />
          <col className="feed-date-column" />
          <col />
        </colgroup>
        {upcomingItems.length > 0 && (
          <tbody aria-label="Upcoming actions">
            {upcomingItems.map((item) => (
              <FeedRow key={item.key} item={item} />
            ))}
          </tbody>
        )}
        {recentItems.length > 0 && (
          <tbody aria-label="Recent items">
            {recentItems.map((item) => (
              <FeedRow key={item.key} item={item} />
            ))}
          </tbody>
        )}
      </table>
    </Scroll>
  );
}
