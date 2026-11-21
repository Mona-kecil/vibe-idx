import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@workos-inc/authkit-react';
import { brokerOwners, distribution, type BrokerOwner } from '../broker-distribution.js';
import { brokerOwnership } from '../brokers.js';
import { DistributionChart } from '../DistributionChart.js';
import { loadTicks } from '../terminal/tick-data.js';
import type { TickTrades } from '../ticks.js';
import { useBrokerHistory } from './BrokerSummary.js';
import { bounds, type Selection } from './logic.js';
import { dateText, rangeText, short } from './format.js';

const sessionLimit = 20;
const ownerships = ['local', 'government', 'foreign'] as const;

export function BrokerDistribution({
  ticker,
  selection,
  dates,
}: {
  ticker: string;
  selection: Selection;
  dates: string[];
}) {
  const { user } = useAuth();
  if (!user || !dates.length) return null;
  return (
    <Distribution
      key={`${user.id}:${ticker}`}
      ticker={ticker}
      selection={selection}
      dates={dates}
    />
  );
}

function Distribution({
  ticker,
  selection,
  dates,
}: {
  ticker: string;
  selection: Selection;
  dates: string[];
}) {
  const { getAccessToken } = useAuth();
  const [session, setSession] = useState(dates.at(-1)!);
  const [unit, setUnit] = useState<'VALUE' | 'LOT'>('VALUE');
  const b = bounds(selection);
  const range = b ? dates.filter((date) => date >= b.start && date <= b.end) : [session];
  const shown = range.slice(-sessionLimit);
  const list = shown.join(',');
  const [state, setState] = useState<
    | { kind: 'loading' }
    | { kind: 'error'; message: string }
    | { kind: 'ready'; list: string; data: TickTrades[] }
  >({ kind: 'loading' });
  useEffect(() => {
    if (!list) return;
    let current = true;
    setState({ kind: 'loading' });
    Promise.all(list.split(',').map((date) => loadTicks(ticker, date, 'trades', getAccessToken)))
      .then((sessions) => {
        if (current)
          setState({ kind: 'ready', list, data: sessions.filter((data) => data !== null) });
      })
      .catch((error: unknown) => {
        if (current)
          setState({
            kind: 'error',
            message: error instanceof Error ? error.message : 'Running trade is unavailable.',
          });
      });
    return () => {
      current = false;
    };
  }, [ticker, list, getAccessToken]);
  const history = useBrokerHistory(ticker).state;
  const owners = useMemo(
    () => (history.kind === 'ready' ? brokerOwners(history.days) : new Map<string, BrokerOwner>()),
    [history],
  );
  const data = useMemo(
    () => (state.kind === 'ready' ? distribution(state.data, 'regular', unit, 7) : null),
    [state, unit],
  );
  const index = dates.indexOf(session);
  const first = shown[0],
    last = shown.at(-1);
  return (
    <section className="section" id="distribution-section" aria-labelledby="distribution-heading">
      <div className="section-head">
        <h2 id="distribution-heading">Broker distribution</h2>
        {b && first && last ? (
          <span className="date-label">{rangeText(first, last, true)}</span>
        ) : (
          <span className="bd-session">
            <button
              aria-label="Previous session"
              disabled={index <= 0}
              onClick={() => setSession(dates[index - 1]!)}
            >
              ‹
            </button>
            <time>{dateText(session)}</time>
            <button
              aria-label="Next session"
              disabled={index >= dates.length - 1}
              onClick={() => setSession(dates[index + 1]!)}
            >
              ›
            </button>
          </span>
        )}
      </div>
      <div className="ranges bd-unit" aria-label="Unit">
        {(['VALUE', 'LOT'] as const).map((option) => (
          <button key={option} aria-pressed={unit === option} onClick={() => setUnit(option)}>
            {option === 'VALUE' ? 'Value' : 'Volume'}
          </button>
        ))}
      </div>
      {range.length > shown.length && (
        <p className="bd-note" role="status">
          Latest {sessionLimit} sessions of the selection
        </p>
      )}
      {state.kind === 'error' ? (
        <p role="alert">{state.message}</p>
      ) : !data || (state.kind === 'ready' && state.list !== list) ? (
        <p role="status">Loading data…</p>
      ) : !data.total ? (
        <p className="empty-state">No running trade for this session</p>
      ) : (
        <>
          <div className="bd-columns">
            <span className="up">Buyers</span>
            <span className="down">Sellers</span>
          </div>
          <DistributionChart
            data={data}
            owners={owners}
            unit={unit === 'LOT' ? 'lot' : 'IDR'}
            format={short}
          />
          <div className="bd-keys">
            {ownerships.map((type) => (
              <span key={type} className={`owner-${type}`}>
                <i />
                {brokerOwnership[type]}
              </span>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
