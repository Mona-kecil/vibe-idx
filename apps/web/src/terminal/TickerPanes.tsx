import { useTerminal } from './state';
import { Availability, Empty, Scroll, direction } from './ui';
import { dateText, nf, short, signed } from '../ticker/format';
import { inRange, registryAt } from '../ticker/logic';
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
            ['PRICES', last?.date ?? '—'],
            ['VALUE IDR', last ? short(last.value) : '—'],
            ['VOLUME SHARES', last ? short(last.volume) : '—'],
            ['NET FOREIGN EST. IDR', last ? signed(last.net_foreign, short) : '—'],
            [
              'FREE FLOAT',
              registry?.free_float_pct == null ? '—' : `${nf(registry.free_float_pct, 2)}%`,
            ],
            ['SID COUNT', registry?.sid_count == null ? '—' : nf(registry.sid_count)],
            ['ISSUED SHARES', registry?.issued_shares == null ? '—' : nf(registry.issued_shares)],
            ['REGISTRY', registry?.date ?? '—'],
          ];
          return (
            <div className="description">
              <h1>{data.name}</h1>
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
export function HoldersPane() {
  const { detail, ticker, selection } = useTerminal();
  return (
    <Scroll reset={`${ticker}:${selection?.anchor}:${selection?.end}`}>
      <Availability resource={detail} name="Ownership">
        {(data) => (
          <>
            {data.holders.length ? (
              <div className="holders">
                {data.holders.map((holder) => (
                  <div className="holder-row" key={holder.holder_key}>
                    <span title={holder.investor}>{holder.investor}</span>
                    <meter
                      min="0"
                      max={Math.max(...data.holders.map((h) => h.pct))}
                      value={holder.pct}
                    />
                    <span>{nf(holder.pct, 2)}%</span>
                  </div>
                ))}
              </div>
            ) : (
              <Empty>No 5% holders reported</Empty>
            )}
            <table>
              <tbody>
                {[...data.changes]
                  .filter((row) => inRange(row.date, selection))
                  .sort((a, b) => b.date.localeCompare(a.date))
                  .map((row, index) => (
                    <tr key={`${row.holder_key}:${row.date}:${index}`}>
                      <td className="mut">{dateText(row.date, false)}</td>
                      <td className="l">{row.investor}</td>
                      <td>
                        {nf(row.pct_before, 2)}% →{' '}
                        <span className={direction((row.pct_after ?? 0) - row.pct_before)}>
                          {row.pct_after === null ? 'Below 5%' : `${nf(row.pct_after, 2)}%`}
                        </span>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </>
        )}
      </Availability>
    </Scroll>
  );
}
export function DisclosuresPane() {
  const { detail, ticker } = useTerminal();
  return (
    <Scroll reset={ticker}>
      <Availability resource={detail} name="Disclosures">
        {(data) =>
          data.disclosures.length ? (
            <table>
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
