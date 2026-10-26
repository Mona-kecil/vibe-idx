import { useEffect, useState } from 'react';
import { useAuth } from '@workos-inc/authkit-react';
import { AccountControls } from '../BrokerPanel';
import { aggregateBrokers, brokerName } from '../broker-data';
import { brokerHistorySchema, type BrokerDay } from '../brokers';
import { bounds, inRange, type Selection } from './logic';
import { dateText, direction, nf, rangeText, short, signed } from './format';

export function BrokerFlow({
  ticker,
  selection,
  start,
  end,
}: {
  ticker: string;
  selection: Selection;
  start: string;
  end: string;
}) {
  const { user, isLoading } = useAuth();
  const b = bounds(selection);
  return (
    <section className="section" id="broker-section" aria-labelledby="broker-heading">
      <div className="section-head">
        <h2 id="broker-heading">
          Broker flow
          {b && <span className="broker-heading-date">{rangeText(b.start, b.end, true)}</span>}
        </h2>
        {!b && (
          <span className="date-label">
            {dateText(start, false)} – {dateText(end)}
          </span>
        )}
      </div>
      {!user ? (
        <div className="signin">
          <AccountControls />
        </div>
      ) : isLoading ? (
        <p role="status">Loading data…</p>
      ) : (
        <BrokerData
          key={`${user.id}:${ticker}`}
          ticker={ticker}
          selection={selection}
          start={start}
          end={end}
        />
      )}
    </section>
  );
}
function BrokerData({
  ticker,
  selection,
  start,
  end,
}: {
  ticker: string;
  selection: Selection;
  start: string;
  end: string;
}) {
  const { getAccessToken } = useAuth();
  const [state, setState] = useState<
    | { kind: 'loading' | 'error' | 'unauthorized' | 'missing' }
    | { kind: 'ready'; days: BrokerDay[] }
  >({ kind: 'loading' });
  const [attempt, retry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: 'loading' });
    async function read() {
      const token = await getAccessToken();
      if (controller.signal.aborted) return;
      if (!token) {
        setState({ kind: 'unauthorized' });
        return;
      }
      const response = await fetch(`/api/brokers?ticker=${encodeURIComponent(ticker)}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      if (response.status === 401) {
        setState({ kind: 'unauthorized' });
        return;
      }
      if (response.status === 404) {
        setState({ kind: 'missing' });
        return;
      }
      if (!response.ok) throw new Error('Broker request failed');
      const history = brokerHistorySchema.parse(await response.json());
      if (history.ticker !== ticker) throw new Error('Broker ticker mismatch');
      if (!controller.signal.aborted) setState({ kind: 'ready', days: history.days });
    }
    void read().catch(() => {
      if (!controller.signal.aborted) setState({ kind: 'error' });
    });
    return () => controller.abort();
  }, [ticker, getAccessToken, attempt]);
  if (state.kind === 'loading') return <p role="status">Loading data…</p>;
  if (state.kind === 'unauthorized') return <AccountControls />;
  if (state.kind === 'missing')
    return <p className="empty-state">Broker data is not available yet.</p>;
  if (state.kind === 'error')
    return (
      <p role="alert">
        Could not load broker data. <button onClick={() => retry(attempt + 1)}>Retry</button>
      </p>
    );
  if (state.kind !== 'ready') return null;
  const days = state.days.filter((d) =>
    selection ? inRange(d.date, selection) : d.date >= start && d.date <= end,
  );
  const rows = aggregateBrokers(days)
    .map((b) => ({ ...b, net: b.buyValue - b.sellValue }))
    .sort((a, b) => b.net - a.net);
  const buyers = rows.filter((b) => b.net > 0).slice(0, 5),
    sellers = rows
      .filter((b) => b.net < 0)
      .reverse()
      .slice(0, 5),
    max = Math.max(1, ...rows.map((b) => Math.abs(b.net)));
  if (!rows.length) return <p className="empty-state">No trades reported in this period</p>;
  const side = (row: (typeof rows)[number] | undefined, type: 'buy' | 'sell') =>
    row ? (
      <div className={`broker-side ${type}`}>
        <div className="broker-label">
          <strong>{row.code}</strong>
          <span title={brokerName(row.code)}>
            {brokerName(row.code)
              .replace(/^PT /, '')
              .replace(/ Sekuritas( Indonesia)?$/, '')}
          </span>
        </div>
        <div className="broker-track">
          <svg
            className="broker-fill"
            style={{ width: (Math.abs(row.net) / max) * 100 + '%' }}
            aria-hidden="true"
          >
            <rect width="100%" height="7" fill="currentColor" />
          </svg>
          <span
            className={`broker-value ${direction(row.net)}`}
            title={signed(row.net, nf) + ' IDR'}
          >
            {signed(row.net)}
          </span>
        </div>
      </div>
    ) : (
      <div />
    );
  return (
    <>
      <div className="broker-head">
        <span>
          Net sellers <small className="unit-suffix">IDR</small>
        </span>
        <span>
          Net buyers <small className="unit-suffix">IDR</small>
        </span>
      </div>
      <div className="broker-pairs">
        {Array.from({ length: Math.max(buyers.length, sellers.length) }, (_, i) => (
          <div className="broker-pair" key={i}>
            {side(sellers[i], 'sell')}
            {side(buyers[i], 'buy')}
          </div>
        ))}
      </div>
      <div className="table-scroll" tabIndex={0} role="region" aria-label="Broker values in IDR">
        <table className="broker-table">
          <thead>
            <tr>
              <th>Code</th>
              <th>Broker</th>
              {['Buy', 'Sell', 'Net', ...(selection ? ['Avg buy', 'Avg sell'] : [])].map((t) => (
                <th className="num" key={t}>
                  {t} <small className="unit-suffix">IDR</small>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(selection ? rows : [...buyers, ...sellers]).map((row) => (
              <tr key={row.code}>
                <td>{row.code}</td>
                <td>{brokerName(row.code)}</td>
                <td className="num" title={nf(row.buyValue) + ' IDR'}>
                  {short(row.buyValue)}
                </td>
                <td className="num" title={nf(row.sellValue) + ' IDR'}>
                  {short(row.sellValue)}
                </td>
                <td className={`num ${direction(row.net)}`} title={signed(row.net, nf) + ' IDR'}>
                  {signed(row.net)}
                </td>
                {selection && (
                  <>
                    <td className="num">{row.buy ? nf(row.buyValue / row.buy, 2) : '—'}</td>
                    <td className="num">{row.sell ? nf(row.sellValue / row.sell, 2) : '—'}</td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
