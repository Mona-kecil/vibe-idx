import { useTerminal } from './state';
import { Availability, Empty, Scroll } from './ui';
import type { Ticker } from '../data';
import { PinButton } from './MarketPanes';
import { dateText, nf, short, signed } from '../ticker/format';
import { bounds, inRange, registryAt } from '../ticker/logic';
import { FilingAttachments } from '../ticker/Feeds';

export function DescriptionPane() {
  const { detail, ticker } = useTerminal();
  return (
    <Scroll reset={ticker}>
      <Availability resource={detail} name="Ticker history">
        {(data) => {
          const last = data.prices.at(-1),
            previous = data.prices.at(-2),
            registry = registryAt(data, last?.date ?? '');
          const fields = [
            ['LAST IDR', last ? nf(last.close) : '—'],
            [
              'CHANGE',
              last && previous
                ? `${signed(last.close - previous.close, nf)} (${nf((last.close / previous.close - 1) * 100, 2)}%)`
                : '—',
            ],
            ['PRICE DATE', last ? dateText(last.date) : '—'],
            ['VALUE IDR', last ? short(last.value) : '—'],
            ['VOLUME SHARES', last ? short(last.volume) : '—'],
            ['NET FOREIGN EST. IDR', last ? signed(last.net_foreign, short) : '—'],
            [
              'FREE FLOAT',
              registry?.free_float_pct == null ? '—' : `${nf(registry.free_float_pct, 2)}%`,
            ],
            ['SID COUNT', registry?.sid_count == null ? '—' : nf(registry.sid_count)],
            ['ISSUED SHARES', registry?.issued_shares == null ? '—' : nf(registry.issued_shares)],
            ['REGISTRY DATE', registry ? dateText(registry.date) : '—'],
          ];
          return (
            <div className="description">
              <div className="key-heading">
                <h1>{data.name}</h1>
                <PinButton ticker={ticker} showTicker />
              </div>
              <dl>
                {fields.map(([key, value]) => (
                  <div key={key}>
                    <dt>{key}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          );
        }}
      </Availability>
    </Scroll>
  );
}
type HolderPoint = { date: string; pct: number | null; shares: number | null };
type HolderHistory = { key: string; name: string; points: HolderPoint[] };
function holderHistories(data: Ticker, date: string | null) {
  const histories = new Map<string, HolderHistory>();
  function add(key: string, name: string, point: HolderPoint) {
    const history = histories.get(key) ?? { key, name, points: [] };
    history.name = name;
    history.points = history.points.filter((p) => p.date !== point.date);
    history.points.push(point);
    histories.set(key, history);
  }
  for (const snapshot of [...data.registry_history].sort((a, b) => a.date.localeCompare(b.date)))
    for (const holder of snapshot.holders)
      if (holder.pct >= 5)
        add(holder.holder_key, holder.investor, {
          date: snapshot.date,
          pct: holder.pct,
          shares: null,
        });
  for (const row of [...data.changes].sort((a, b) => a.date.localeCompare(b.date)))
    add(row.holder_key, row.investor, {
      date: row.date,
      pct: row.pct_after,
      shares: row.shares_after,
    });
  if (date)
    for (const holder of data.holders)
      add(holder.holder_key, holder.investor, { date, pct: holder.pct, shares: holder.shares });
  return [...histories.values()].map((history) => ({
    ...history,
    points: history.points.sort((a, b) => a.date.localeCompare(b.date)),
  }));
}
function HolderChart({ history }: { history: HolderHistory }) {
  const first = history.points[0],
    last = history.points.at(-1);
  if (!first || !last) return null;
  const values = history.points.flatMap((p) => (p.pct === null ? [] : [p.pct]));
  const low = Math.min(...values),
    high = Math.max(...values);
  const span = Date.parse(last.date) - Date.parse(first.date) || 1;
  const x = (point: HolderPoint) =>
    4 + ((Date.parse(point.date) - Date.parse(first.date)) / span) * 292;
  const y = (pct: number) => 54 - ((pct - low) / (high - low || 1)) * 44;
  const path = history.points
    .map((point, i, all) =>
      point.pct === null
        ? ''
        : `${i === 0 || all[i - 1]?.pct === null ? 'M' : 'L'}${x(point)},${y(point.pct)}`,
    )
    .join(' ');
  return (
    <section className="holder-history" aria-label={history.name}>
      <div className="holder-title">
        <span>{history.name}</span>
        <b>{last.pct === null ? 'Below 5%' : `${nf(last.pct, 2)}%`}</b>
      </div>
      {values.length > 0 && (
        <div className="holder-plot">
          <svg
            viewBox="0 0 300 64"
            preserveAspectRatio="none"
            role="img"
            aria-label={`${history.name} reported holding percentage from ${dateText(first.date)} to ${dateText(last.date)}, ${nf(low, 2)}% to ${nf(high, 2)}%`}
          >
            <path d={path} fill="none" stroke="currentColor" vectorEffect="non-scaling-stroke" />
            {history.points.map((point) =>
              point.pct === null ? null : (
                <circle key={point.date} cx={x(point)} cy={y(point.pct)} r="2">
                  <title>
                    {dateText(point.date)} {nf(point.pct, 2)}%
                  </title>
                </circle>
              ),
            )}
          </svg>
          <div className="holder-scale">
            <span>{nf(high, 2)}%</span>
            <span>{nf(low, 2)}%</span>
          </div>
        </div>
      )}
      <div className="holder-dates">
        <time>{dateText(first.date)}</time>
        {first.date !== last.date && <time>{dateText(last.date)}</time>}
      </div>
      <details>
        <summary>Reported values ({history.points.length})</summary>
        <table>
          <thead>
            <tr>
              <th>DATE</th>
              <th>HOLDING</th>
              <th>SHARES</th>
            </tr>
          </thead>
          <tbody>
            {[...history.points].reverse().map((point) => (
              <tr key={point.date}>
                <td>{dateText(point.date)}</td>
                <td>{point.pct === null ? 'Below 5%' : `${nf(point.pct, 2)}%`}</td>
                <td>{point.shares === null ? '—' : nf(point.shares)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
  );
}
export function HoldersPane() {
  const { data: market, detail, ticker, selection, select } = useTerminal();
  const range = bounds(selection);
  return (
    <>
      {range && (
        <div className="holder-range" role="status">
          <span>
            Chart range {dateText(range.start)} to {dateText(range.end)}
          </span>
          <button onClick={() => select(null)}>Clear chart range</button>
        </div>
      )}
      <Scroll reset={`${ticker}:${selection?.anchor}:${selection?.end}`}>
        <Availability resource={detail} name="Ownership">
          {(data) => {
            const histories = holderHistories(data, market.health.five_pct)
              .map((history) => ({
                ...history,
                points: history.points.filter((point) => inRange(point.date, selection)),
              }))
              .filter((history) => history.points.length > 0)
              .sort((a, b) => (b.points.at(-1)?.pct ?? 0) - (a.points.at(-1)?.pct ?? 0));
            return histories.length ? (
              <div className="holders">
                {histories.map((history) => (
                  <HolderChart key={history.key} history={history} />
                ))}
              </div>
            ) : (
              <Empty>
                {range ? 'No holder reports in this chart range' : 'No 5% holders reported'}
              </Empty>
            );
          }}
        </Availability>
      </Scroll>
    </>
  );
}
export function DisclosuresPane() {
  const { detail, ticker } = useTerminal();
  return (
    <Scroll reset={ticker}>
      <Availability resource={detail} name="Disclosures">
        {(data) =>
          data.disclosures.length ? (
            <table className="disclosures-table">
              <tbody>
                {[...data.disclosures]
                  .sort((a, b) => b.published_at.localeCompare(a.published_at))
                  .map((row) => (
                    <tr key={row.id}>
                      <td className="mut">{dateText(row.published_at)}</td>
                      <td className="l">
                        <a href={row.url} target="_blank" rel="noreferrer">
                          {row.title}
                        </a>
                        <FilingAttachments filing={row} />
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          ) : (
            <Empty>No disclosures for {ticker}</Empty>
          )
        }
      </Availability>
    </Scroll>
  );
}
