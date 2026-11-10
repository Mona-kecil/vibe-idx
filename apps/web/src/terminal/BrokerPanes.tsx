import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { HistogramSeries, LineSeries, type ISeriesApi } from 'lightweight-charts';
import { aggregateBrokers, brokerName, edgeFills } from '../broker-data';
import { matchesInvestor, type InvestorFilter, type BrokerDay } from '../brokers';
import { bounds } from '../ticker/logic';
import { nf, short, signed } from '../ticker/format';
import { useTerminal, type BrokerFilters } from './state';
import { Empty, Scroll, Segments, SignInPrompt, direction } from './ui';
import { terminalChart, chartDate } from './charts';
import { Attribution } from './PricePane';
import './broker-panes.css';

function BrokerGate({ children }: { children: (days: BrokerDay[]) => ReactNode }) {
  const { brokers, session, signIn, brokerError, retryBrokers } = useTerminal();
  if (session !== 'signed-in') return <SignInPrompt />;
  if (brokerError)
    return (
      <p className="empty" role="alert">
        {brokerError} <button onClick={retryBrokers}>Retry</button>{' '}
        <button onClick={signIn}>Sign in</button>
      </p>
    );
  if (brokers.kind !== 'ready')
    return (
      <Empty>
        {brokers.kind === 'loading' ? 'Loading broker summaries…' : 'Broker summaries unavailable'}
      </Empty>
    );
  return children(brokers.data);
}
function BrokerControls({ flow = false, foreign = false }: { flow?: boolean; foreign?: boolean }) {
  const { broker, setBroker, select, selection, session } = useTerminal();
  if (session !== 'signed-in') return null;
  return (
    <div className="broker-controls">
      <Segments
        label="Market board"
        values={['regular', 'negotiation', 'cash', 'all']}
        value={broker.board}
        onChange={(value) => setBroker('board', value)}
      />
      {!foreign && (
        <Segments
          label="Client domicile"
          values={['ALL', 'FOREIGN', 'DOMESTIC']}
          value={broker.type}
          onChange={(value) => setBroker('type', value)}
        />
      )}
      {!flow && (
        <Segments
          label="Broker mode"
          values={['NET', 'GROSS']}
          value={broker.mode}
          onChange={(value) => setBroker('mode', value)}
        />
      )}
      <Segments
        label="Broker unit"
        values={['VALUE', 'LOT']}
        value={broker.unit}
        onChange={(value) => setBroker('unit', value)}
      />
      {flow ? (
        <Segments
          label="Flow period"
          values={['1W', '1M', '3M', 'YTD']}
          value={broker.flow}
          onChange={(value) => {
            setBroker('flow', value);
            select(null);
          }}
        />
      ) : (
        <Segments
          label="Broker period"
          values={['1D', '5D', '20D']}
          value={selection ? '' : broker.period}
          onChange={(value) => {
            if (value === '1D' || value === '5D' || value === '20D') setBroker('period', value);
            select(null);
          }}
        />
      )}
    </div>
  );
}
export function BrokerSummaryPane() {
  const { broker, ticker, selection } = useTerminal();
  return (
    <>
      <BrokerControls />
      <Scroll reset={`${ticker}:${JSON.stringify(broker)}:${JSON.stringify(selection)}`}>
        <BrokerGate>
          {(days) => (
            <Summary
              key={`${ticker}:${JSON.stringify(broker)}:${JSON.stringify(selection)}`}
              days={days}
            />
          )}
        </BrokerGate>
      </Scroll>
    </>
  );
}
function Summary({ days }: { days: BrokerDay[] }) {
  const { broker, selection } = useTerminal();
  const [pair, setPair] = useState<string | null>(null);
  const onBoard = days.filter((day) => broker.board === 'all' || day.board === broker.board);
  const b = bounds(selection);
  const dates = [...new Set(onBoard.map((day) => day.date))].sort().reverse();
  const selected = new Set(
    b
      ? dates.filter((date) => date >= b.start && date <= b.end)
      : dates.slice(0, parseInt(broker.period)),
  );
  const totals = aggregateBrokers(
    onBoard.filter((day) => selected.has(day.date)),
    broker.type,
  );
  const lots = broker.unit === 'LOT',
    gross = broker.mode === 'GROSS';
  const side = (which: 'buy' | 'sell') =>
    totals
      .map((row) => {
        const value = which === 'buy' ? row.buyValue : row.sellValue,
          shares = which === 'buy' ? row.buy : row.sell;
        const otherValue = which === 'buy' ? row.sellValue : row.buyValue,
          otherShares = which === 'buy' ? row.sell : row.buy;
        const amount = gross ? value : value - otherValue,
          volume = gross ? shares : shares - otherShares;
        return {
          code: row.code,
          type: row.broker_type === 'government' ? 'GOV' : row.broker_type.toUpperCase(),
          amount,
          volume,
          avg: which === 'buy' ? row.buyAvg : row.sellAvg,
          metric: lots ? volume / 100 : amount,
        };
      })
      .filter((row) => row.metric > 0)
      .sort((a, b) => b.metric - a.metric);
  const buyers = side('buy'),
    sellers = side('sell'),
    edges = edgeFills(buyers, sellers);
  const max = Math.max(1, ...buyers.map((row) => row.metric), ...sellers.map((row) => row.metric));
  function ledger(rows: typeof buyers, which: 'BUY' | 'SELL') {
    const fill = (metric: number) => ({
      background: `linear-gradient(to right, ${which === 'BUY' ? '#22a6a018' : '#e4573f18'} ${(metric / max) * 100}%, transparent 0)`,
    });
    return (
      <table className={`broker-ledger ${which.toLowerCase()}`}>
        <thead>
          <tr>
            <th>{gross ? which : `NET ${which}`}</th>
            <th>VALUE IDR</th>
            <th>LOT</th>
            <th>AVG IDR</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.code}
              className={pair && pair !== row.code ? 'dim' : pair === row.code ? 'on' : ''}
            >
              <td className="l">
                {gross ? (
                  <button
                    title={`${brokerName(row.code)}\n${row.type}`}
                    className={`type-${row.type}`}
                    aria-pressed={pair === row.code}
                    onClick={() => setPair(pair === row.code ? null : row.code)}
                  >
                    {row.code}
                  </button>
                ) : (
                  <span
                    title={`${brokerName(row.code)}\n${row.type}`}
                    className={`type-${row.type}`}
                  >
                    {row.code}
                  </span>
                )}
              </td>
              <td
                className={lots ? '' : `bar ${which === 'BUY' ? 'up' : 'dn'}`}
                style={lots ? undefined : fill(row.metric)}
                title={`${nf(row.amount)} IDR`}
              >
                {short(row.amount)}
              </td>
              <td
                className={lots ? `bar ${which === 'BUY' ? 'up' : 'dn'}` : ''}
                style={lots ? fill(row.metric) : undefined}
                title={`${nf(row.volume)} shares`}
              >
                {short(row.volume / 100)}
              </td>
              <td className={edges.has(row) ? 'edge' : ''} title={`${nf(row.avg, 2)} IDR`}>
                {nf(row.avg, 1)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }
  return totals.length ? (
    <>
      <div className={`broker-ledgers${gross ? ' pairable' : ''}`}>
        {ledger(buyers, 'BUY')}
        {ledger(sellers, 'SELL')}
      </div>
      <div className="broker-foot">
        {selected.size} trading days{' '}
        <span>
          {[...selected].sort()[0]} to {[...selected].sort().at(-1)}
        </span>
      </div>
    </>
  ) : (
    <Empty>No broker summary in this view</Empty>
  );
}
/** The board's days inside the flow period, or inside the chart selection when there is one. */
function flowDays(days: BrokerDay[], broker: BrokerFilters, start?: string, end?: string) {
  const board = days.filter((day) => broker.board === 'all' || day.board === broker.board);
  const all = [...new Set(board.map((day) => day.date))].sort();
  const last = all.at(-1);
  if (!last) return { dates: [], onBoard: [] };
  const since = new Date(`${last}T00:00:00Z`);
  if (broker.flow === 'YTD') since.setUTCMonth(0, 1);
  else if (broker.flow === '1W') since.setUTCDate(since.getUTCDate() - 7);
  else since.setUTCMonth(since.getUTCMonth() - parseInt(broker.flow));
  const from = since.toISOString().slice(0, 10);
  const dates = all.filter((date) => (start && end ? date >= start && date <= end : date >= from));
  const selected = new Set(dates);
  return { dates, onBoard: board.filter((day) => selected.has(day.date)) };
}
const palette = ['#22a6a0', '#d6b25e', '#709fe3', '#e4573f', '#b494db', '#d985a5'];
export function BrokerFlowPane() {
  return (
    <>
      <BrokerControls flow />
      <BrokerGate>{(days) => <Flow days={days} />}</BrokerGate>
    </>
  );
}
export function cumulativeFlows(
  days: BrokerDay[],
  dates: string[],
  unit: 'VALUE' | 'LOT',
  type: InvestorFilter,
) {
  const daily = new Map<string, Map<string, number>>();
  for (const day of days)
    for (const [side, sign] of [
      ['buy', 1],
      ['sell', -1],
    ] as const)
      for (const row of day[side]) {
        if (!matchesInvestor(row, type)) continue;
        const series = daily.get(row.broker) ?? new Map<string, number>();
        series.set(
          day.date,
          (series.get(day.date) ?? 0) + sign * (unit === 'LOT' ? row.shares / 100 : row.value),
        );
        daily.set(row.broker, series);
      }
  return [...daily].map(([code, values]) => {
    let sum = 0;
    return {
      code,
      points: dates.map((date) => ({ time: date, value: (sum += values.get(date) ?? 0) })),
    };
  });
}
function Flow({ days }: { days: BrokerDay[] }) {
  const {
    broker,
    selection,
    ticker,
    detail,
    flowPins: pins,
    setFlowPins: setPins,
    flowHidden: hidden,
    setFlowHidden: setHidden,
  } = useTerminal();
  const [hover, setHover] = useState<string | null>(null);
  const lines = useRef(new Map<string, ISeriesApi<'Line'>>());
  const [adding, setAdding] = useState(false),
    [query, setQuery] = useState('');
  const host = useRef<HTMLDivElement>(null);
  const b = bounds(selection),
    start = b?.start,
    end = b?.end;
  const flows = useMemo(() => {
    const { dates, onBoard } = flowDays(days, broker, start, end);
    return { dates, series: cumulativeFlows(onBoard, dates, broker.unit, broker.type) };
  }, [days, broker, start, end]);
  const total = (series: (typeof flows.series)[number]) => series.points.at(-1)?.value ?? 0;
  const shown = useMemo(() => {
    const pinned = flows.series.filter((s) => pins.includes(s.code));
    const automatic = flows.series.filter((s) => !pins.includes(s.code));
    return [
      ...pinned,
      ...automatic
        .filter((s) => total(s) > 0)
        .sort((a, b) => total(b) - total(a))
        .slice(0, 3),
      ...automatic
        .filter((s) => total(s) < 0)
        .sort((a, b) => total(a) - total(b))
        .slice(0, 3),
    ].slice(0, 6);
  }, [flows, pins]);
  useEffect(() => {
    if (!host.current || !shown.length) return;
    const chart = terminalChart(host.current);
    shown.forEach((series, index) => {
      const line = chart.addSeries(LineSeries, {
        color: palette[index % palette.length],
        title: series.code,
        lineWidth: 2,
        priceLineVisible: false,
        priceFormat: { type: 'custom', formatter: short },
      });
      line.setData(series.points);
      lines.current.set(series.code, line);
    });
    chart.subscribeCrosshairMove((event) => setHover(chartDate(event.time)));
    chart.timeScale().fitContent();
    return () => {
      lines.current.clear();
      chart.remove();
    };
  }, [shown, ticker]);
  useEffect(() => {
    for (const [code, line] of lines.current)
      line.applyOptions({ visible: !hidden.includes(code) });
  }, [hidden, shown]);
  const date = hover && flows.dates.includes(hover) ? hover : flows.dates.at(-1);
  const price =
    detail.kind === 'ready' ? detail.data.prices.find((p) => p.date === date) : undefined;
  const currentValue = (series: (typeof flows.series)[number]) =>
    series.points.find((p) => p.time === date)?.value ?? total(series);
  if (!flows.dates.length || !flows.series.length)
    return <Empty>No broker summary in this view</Empty>;
  return (
    <div className="flow-view">
      <div className="legend">
        <time>{date}</time>
        {price && <span>C {nf(price.close)} IDR</span>}
        {shown.map((series, index) => (
          <span className="broker-key" key={series.code}>
            <button
              aria-pressed={!hidden.includes(series.code)}
              title={brokerName(series.code)}
              onClick={() =>
                setHidden(
                  hidden.includes(series.code)
                    ? hidden.filter((code) => code !== series.code)
                    : [...hidden, series.code],
                )
              }
            >
              <i style={{ background: palette[index % palette.length] }} />
              {series.code}{' '}
              <span className={direction(currentValue(series))}>
                {signed(currentValue(series), short)}
              </span>
            </button>
            {pins.includes(series.code) && (
              <button
                aria-label={`Remove ${series.code}`}
                onClick={() => setPins(pins.filter((code) => code !== series.code))}
              >
                ×
              </button>
            )}
          </span>
        ))}
        <button
          aria-label="Add broker"
          disabled={pins.length >= 6}
          onClick={() => setAdding(!adding)}
        >
          +
        </button>
      </div>
      {adding && (
        <div className="broker-picker">
          <input
            aria-label="Find a broker"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            autoFocus
          />
          {flows.series
            .filter(
              (series) =>
                !pins.includes(series.code) &&
                `${series.code} ${brokerName(series.code)}`
                  .toLowerCase()
                  .includes(query.toLowerCase()),
            )
            .map((series) => (
              <button
                key={series.code}
                onClick={() => {
                  setPins([...pins, series.code]);
                  setHidden(hidden.filter((code) => code !== series.code));
                  setAdding(false);
                }}
              >
                {series.code} {brokerName(series.code)}
              </button>
            ))}
        </div>
      )}
      <div className="flow-chart" ref={host} />
      <div className="chart-foot">
        <span>
          {broker.unit === 'LOT' ? 'Net lot' : 'Net IDR'} {flows.dates[0]} to {flows.dates.at(-1)}
        </span>
        <Attribution />
      </div>
    </div>
  );
}

export function ForeignFlowPane() {
  return (
    <>
      <BrokerControls flow foreign />
      <BrokerGate>{(days) => <ForeignFlow days={days} />}</BrokerGate>
    </>
  );
}
/** Net buying by foreign clients per day, its running total, and foreign clients' share of gross trading. */
export function foreignFlow(days: BrokerDay[], dates: string[], unit: 'VALUE' | 'LOT') {
  const net = new Map<string, number>();
  const gross = new Map<string, number>();
  const foreign = new Map<string, number>();
  const add = (map: Map<string, number>, date: string, amount: number) =>
    map.set(date, (map.get(date) ?? 0) + amount);
  for (const day of days)
    for (const [side, sign] of [
      ['buy', 1],
      ['sell', -1],
    ] as const)
      for (const row of day[side]) {
        const amount = unit === 'LOT' ? row.shares / 100 : row.value;
        add(gross, day.date, amount);
        if (row.investor !== 'foreign') continue;
        add(foreign, day.date, amount);
        add(net, day.date, sign * amount);
      }
  let cumulative = 0;
  return dates.map((date) => {
    const total = gross.get(date);
    return {
      date,
      net: net.get(date) ?? 0,
      cumulative: (cumulative += net.get(date) ?? 0),
      share: total ? (foreign.get(date) ?? 0) / total : null,
    };
  });
}
function ForeignFlow({ days }: { days: BrokerDay[] }) {
  const { broker, selection, detail, ticker } = useTerminal();
  const [hover, setHover] = useState<string | null>(null);
  const host = useRef<HTMLDivElement>(null);
  const b = bounds(selection);
  const flow = useMemo(() => {
    const { dates, onBoard } = flowDays(days, broker, b?.start, b?.end);
    return foreignFlow(onBoard, dates, broker.unit);
  }, [days, broker, b?.start, b?.end]);
  useEffect(() => {
    if (!host.current || !flow.length) return;
    const chart = terminalChart(host.current);
    const style = getComputedStyle(host.current);
    const up = style.getPropertyValue('--up').trim() || '#22a6a0';
    const down = style.getPropertyValue('--down').trim() || '#e4573f';
    const format = { type: 'custom' as const, formatter: short };
    chart
      .addSeries(HistogramSeries, { priceLineVisible: false, priceFormat: format })
      .setData(flow.map((d) => ({ time: d.date, value: d.net, color: d.net < 0 ? down : up })));
    chart
      .addSeries(LineSeries, {
        color: '#d6b25e',
        lineWidth: 2,
        priceScaleId: 'left',
        priceLineVisible: false,
        priceFormat: format,
      })
      .setData(flow.map((d) => ({ time: d.date, value: d.cumulative })));
    chart.priceScale('left').applyOptions({ visible: true, borderColor: '#222826' });
    chart.subscribeCrosshairMove((event) => setHover(chartDate(event.time)));
    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [flow, ticker]);
  const day = flow.find((d) => d.date === hover) ?? flow.at(-1);
  if (!day) return <Empty>No foreign client activity in this view</Empty>;
  const price =
    detail.kind === 'ready' ? detail.data.prices.find((p) => p.date === day.date) : undefined;
  return (
    <div className="flow-view">
      <div className="legend">
        <time>{day.date}</time>
        {price && <span>C {nf(price.close)} IDR</span>}
        <span>
          Net <b className={direction(day.net)}>{signed(day.net, short)}</b>
        </span>
        <span>
          Total <b className={direction(day.cumulative)}>{signed(day.cumulative, short)}</b>
        </span>
        {day.share !== null && <span>Share {(day.share * 100).toFixed(1)}%</span>}
      </div>
      <div className="flow-chart" ref={host} />
      <div className="chart-foot">
        <span>
          Foreign clients {broker.unit === 'LOT' ? 'net lot' : 'net IDR'} {flow[0]?.date} to{' '}
          {flow.at(-1)?.date}
        </span>
        <Attribution />
      </div>
    </div>
  );
}
