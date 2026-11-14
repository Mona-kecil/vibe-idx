import { useMemo, type ReactNode } from 'react';
import { brokerTypes, distribution, type BrokerType } from '../broker-distribution.js';
import { DistributionChart } from '../DistributionChart.js';
import { bounds } from '../ticker/logic.js';
import { rangeText, short } from '../ticker/format.js';
import { useTerminal } from './state.js';
import { useSession, useSessionsTrades } from './tick-data.js';
import { SessionPicker } from './TickPanes.js';
import { Empty, Segments, SignInPrompt } from './ui.js';
import './broker-panes.css';

/** A selection longer than this sums only its latest sessions, so a year never loads at once. */
const distributionSessions = 20;
const typeLabels: Record<BrokerType, string> = {
  local: 'LOCAL',
  government: 'GOV',
  foreign: 'FOREIGN',
  unknown: 'OTHER',
};

export function BrokerDistributionPane() {
  const { broker, setBroker, selection, brokers, authState } = useTerminal();
  const session = useSession();
  const b = bounds(selection);
  const range = b
    ? session.dates.filter((date) => date >= b.start && date <= b.end)
    : session.date
      ? [session.date]
      : [];
  const dates = range.slice(-distributionSessions);
  const state = useSessionsTrades(dates);
  const types = useMemo(
    () => (brokers.kind === 'ready' ? brokerTypes(brokers.data) : new Map<string, BrokerType>()),
    [brokers],
  );
  const data = useMemo(
    () =>
      state.kind === 'ready' ? distribution(state.data, broker.board, broker.unit) : undefined,
    [state, broker.board, broker.unit],
  );
  if (authState !== 'signed-in') return <SignInPrompt />;
  const first = dates[0],
    last = dates.at(-1);
  const header =
    b && first && last ? (
      <div className="broker-date" role={range.length > dates.length ? 'status' : undefined}>
        <span>{rangeText(first, last, true)}</span>
        {range.length > dates.length && <span>Latest {distributionSessions} sessions</span>}
      </div>
    ) : (
      <SessionPicker />
    );
  let body: ReactNode;
  if (!dates.length) body = <Empty>No 2026 sessions for this ticker</Empty>;
  else if (state.kind === 'error')
    body = (
      <p className="empty" role="alert">
        {state.message}
      </p>
    );
  else if (!data) body = <Empty>Loading running trade…</Empty>;
  else if (!data.total) body = <Empty>No trades</Empty>;
  else {
    const shown = new Set(
      [...data.buyers, ...data.sellers].map((node) => types.get(node.code) ?? 'unknown'),
    );
    body = (
      <div className="flow-view">
        <DistributionChart
          data={data}
          types={types}
          unit={broker.unit === 'LOT' ? 'lot' : 'IDR'}
          format={short}
        />
        <div className="chart-foot">
          <span>{broker.unit === 'LOT' ? 'Gross lot' : 'Gross IDR'}</span>
          <span className="bd-keys">
            {(['local', 'government', 'foreign', 'unknown'] as const)
              .filter((type) => shown.has(type))
              .map((type) => (
                <span key={type} className={`bd-key bd-${type}`}>
                  <i />
                  {typeLabels[type]}
                </span>
              ))}
          </span>
        </div>
      </div>
    );
  }
  return (
    <>
      <div className="broker-controls">
        <Segments
          label="Board"
          values={['regular', 'negotiation', 'cash', 'all']}
          value={broker.board}
          onChange={(value) => setBroker('board', value)}
        />
        <Segments
          label="Broker unit"
          values={['VALUE', 'LOT']}
          value={broker.unit}
          onChange={(value) => setBroker('unit', value)}
        />
      </div>
      {header}
      {body}
    </>
  );
}
