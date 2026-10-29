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
  const [mode, setMode] = useState<'net' | 'gross'>('net');
  const [showAll, setShowAll] = useState(false);
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
  const rows = aggregateBrokers(days);
  if (!rows.length) return <p className="empty-state">No trades reported in this period</p>;
  const side = (type: 'buy' | 'sell') =>
    rows
      .map((b) => {
        const [value, shares, other] =
          type === 'buy' ? [b.buyValue, b.buy, b.sellValue] : [b.sellValue, b.sell, b.buyValue];
        return {
          code: b.code,
          amount: mode === 'net' ? value - other : value,
          avg: value / shares,
        };
      })
      .filter((b) => b.amount > 0)
      .sort((a, b) => b.amount - a.amount);
  const buyers = side('buy'),
    sellers = side('sell'),
    limit = showAll ? Infinity : 10;
  const ledger = (type: 'buy' | 'sell', list: typeof buyers) => (
    <table className={`broker-ledger ${type}`}>
      <thead>
        <tr>
          <th>{type === 'buy' ? 'Buyers' : 'Sellers'}</th>
          <th className="num">
            {mode === 'net' ? 'Net' : 'Value'} <small className="unit-suffix">IDR</small>
          </th>
          <th className="num">
            Avg <small className="unit-suffix">IDR</small>
          </th>
        </tr>
      </thead>
      <tbody>
        {list.slice(0, limit).map((row) => {
          const amount = mode === 'net' && type === 'sell' ? -row.amount : row.amount,
            format = (f: typeof nf) => (mode === 'net' ? signed(amount, f) : f(amount));
          return (
            <tr key={row.code}>
              <td title={brokerName(row.code)}>
                <strong>{row.code}</strong>
                <span>
                  {brokerName(row.code)
                    .replace(/^PT /, '')
                    .replace(/ (and )?Sekuritas.*$/, '')}
                </span>
              </td>
              <td
                className={`num ${mode === 'net' ? direction(amount) : ''}`}
                title={`${format(nf)} IDR`}
              >
                {format(short)}
              </td>
              <td className="num" title={`${nf(row.avg, 2)} IDR`}>
                {nf(row.avg)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
  return (
    <>
      <div className="ranges broker-unit" aria-label="Broker flow mode">
        {(['net', 'gross'] as const).map((m) => (
          <button key={m} aria-pressed={m === mode} onClick={() => setMode(m)}>
            {m === 'net' ? 'Net' : 'Gross'}
          </button>
        ))}
      </div>
      <div className="broker-ledgers">
        {ledger('buy', buyers)}
        {ledger('sell', sellers)}
      </div>
      {Math.max(buyers.length, sellers.length) > 10 && (
        <button className="broker-more" onClick={() => setShowAll(!showAll)}>
          {showAll ? 'Show top 10' : 'Show all'}
        </button>
      )}
    </>
  );
}
