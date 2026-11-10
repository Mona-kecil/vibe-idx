import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  CandlestickSeries,
  HistogramSeries,
  type CandlestickData,
  type UTCTimestamp,
} from 'lightweight-charts';
import { nf, short } from '../ticker/format';
import {
  bars,
  clock,
  doneDetail,
  tradeBook,
  type Block,
  type TickBook,
  type TickKind,
  type TickTrades,
} from '../ticks';
import { fetchTicks } from './sources';
import { useTerminal } from './state';
import { terminalChart } from './charts';
import { Empty, Scroll, Segments, SignInPrompt } from './ui';
import './tick-panes.css';

type Loaded<K extends TickKind> = K extends 'book' ? TickBook : TickTrades;
type TickState<K extends TickKind> =
  | { kind: 'loading' }
  | { kind: 'missing' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; data: Loaded<K> };

// Past sessions never change, so every pane showing the same ticker and day shares one request.
const cache = new Map<string, Promise<TickBook | TickTrades | null>>();

/** Sessions the ticker traded in 2026, and the one the tick panes show. */
function useSession() {
  const { detail, tickDate, setTickDate } = useTerminal();
  const dates = useMemo(
    () =>
      detail.kind === 'ready'
        ? detail.data.prices.map((p) => p.date).filter((date) => date >= '2026-01-01')
        : [],
    [detail],
  );
  const date = tickDate && dates.includes(tickDate) ? tickDate : dates.at(-1);
  return { dates, date, setTickDate };
}

function useTicks<K extends TickKind>(kind: K, date: string | undefined): TickState<K> {
  const { ticker, session, getToken } = useTerminal();
  const signedIn = session === 'signed-in';
  const [state, setState] = useState<TickState<K>>({ kind: 'loading' });
  useEffect(() => {
    if (!signedIn || !date) return;
    let current = true;
    const key = `${ticker}:${date}:${kind}`;
    setState({ kind: 'loading' });
    let request = cache.get(key);
    if (!request) {
      request = getToken().then((token) => {
        if (!token) throw new Error('Your session expired. Sign in again.');
        return fetchTicks(ticker, date, kind, token);
      });
      cache.set(key, request);
    }
    request.then(
      (data) => {
        if (current)
          setState(data ? { kind: 'ready', data: data as Loaded<K> } : { kind: 'missing' });
      },
      (error: unknown) => {
        cache.delete(key);
        if (current)
          setState({
            kind: 'error',
            message: error instanceof Error ? error.message : 'Tick data is unavailable. Retry.',
          });
      },
    );
    return () => {
      current = false;
    };
  }, [ticker, date, kind, signedIn, getToken]);
  return state;
}

function SessionPicker() {
  const { dates, date, setTickDate } = useSession();
  const index = date ? dates.indexOf(date) : -1;
  return (
    <div className="tick-session">
      <button
        aria-label="Previous session"
        disabled={index <= 0}
        onClick={() => setTickDate(dates[index - 1] ?? null)}
      >
        ‹
      </button>
      <time>{date ?? '—'}</time>
      <button
        aria-label="Next session"
        disabled={index < 0 || index >= dates.length - 1}
        onClick={() => setTickDate(dates[index + 1] ?? null)}
      >
        ›
      </button>
    </div>
  );
}

function TickPane<K extends TickKind>({
  kind,
  controls,
  children,
}: {
  kind: K;
  controls?: ReactNode;
  children: (data: Loaded<K>) => ReactNode;
}) {
  const { session } = useTerminal();
  const { date } = useSession();
  const state = useTicks(kind, date);
  let body: ReactNode;
  if (session !== 'signed-in') body = <SignInPrompt />;
  else if (!date) body = <Empty>No 2026 sessions for this ticker</Empty>;
  else if (state.kind === 'loading') body = <Empty>Loading {date}…</Empty>;
  else if (state.kind === 'missing') body = <Empty>Not collected for {date}</Empty>;
  else if (state.kind === 'error')
    body = (
      <p className="empty" role="alert">
        {state.message}
      </p>
    );
  else body = children(state.data);
  return (
    <>
      <div className="broker-controls">
        <SessionPicker />
        {controls}
      </div>
      {body}
    </>
  );
}

const lots = (shares: number) => nf(shares / 100, shares % 100 ? 2 : 0);
function Broker({ code, foreign }: { code: string; foreign: boolean }) {
  return <span className={foreign ? 'tick-foreign' : undefined}>{code}</span>;
}

export function OrderBookPane() {
  return <TickPane kind="book">{(book) => <Ladder book={book} />}</TickPane>;
}
function Ladder({ book }: { book: TickBook }) {
  if (!book.bid.length && !book.offer.length) return <Empty>No resting orders at the close</Empty>;
  const deepest = Math.max(...[...book.bid, ...book.offer].map(([, , shares]) => shares));
  const total = (side: TickBook['bid'], at: 1 | 2) =>
    side.reduce((sum, level) => sum + level[at], 0);
  const depth = (shares: number) => ({ '--depth': `${(shares / deepest) * 100}%` }) as object;
  return (
    <Scroll reset={`${book.ticker}${book.date}`}>
      <table className="tick-table tick-book">
        <thead>
          <tr>
            <th>Orders</th>
            <th>Lot</th>
            <th>Bid</th>
            <th>Offer</th>
            <th>Lot</th>
            <th>Orders</th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: Math.max(book.bid.length, book.offer.length) }, (_, i) => {
            const bid = book.bid[i],
              offer = book.offer[i];
            return (
              <tr key={i}>
                <td>{bid && nf(bid[1])}</td>
                <td className="depth bid" style={bid && depth(bid[2])}>
                  {bid && lots(bid[2])}
                </td>
                <td className="up">{bid && nf(bid[0])}</td>
                <td className="dn">{offer && nf(offer[0])}</td>
                <td className="depth offer" style={offer && depth(offer[2])}>
                  {offer && lots(offer[2])}
                </td>
                <td>{offer && nf(offer[1])}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <td>{nf(total(book.bid, 1))}</td>
            <td>{lots(total(book.bid, 2))}</td>
            <td colSpan={2}>{book.close !== null && `C ${nf(book.close)}`}</td>
            <td>{lots(total(book.offer, 2))}</td>
            <td>{nf(total(book.offer, 1))}</td>
          </tr>
        </tfoot>
      </table>
    </Scroll>
  );
}

const sides = ['ALL', 'BUY', 'SELL'] as const;
function BrokerFilter({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <input
      className="tick-filter"
      aria-label="Filter by broker"
      placeholder="Broker"
      value={value}
      maxLength={4}
      onChange={(event) => onChange(event.target.value.toUpperCase().trim())}
    />
  );
}

export function RunningTradePane() {
  const [broker, setBroker] = useState('');
  const [side, setSide] = useState<(typeof sides)[number]>('ALL');
  const [limit, setLimit] = useState(500);
  return (
    <TickPane
      kind="trades"
      controls={
        <>
          <Segments label="Aggressor side" values={sides} value={side} onChange={setSide} />
          <BrokerFilter value={broker} onChange={setBroker} />
        </>
      }
    >
      {(trades) => {
        const rows: number[] = [];
        for (let i = trades.time.length - 1; i >= 0; i--) {
          if (side !== 'ALL' && trades.side[i] !== (side === 'BUY' ? 'b' : 's')) continue;
          if (broker && trades.buyer[i] !== broker && trades.seller[i] !== broker) continue;
          rows.push(i);
        }
        if (!rows.length) return <Empty>No trades in this view</Empty>;
        return (
          <Scroll reset={`${trades.ticker}${trades.date}${broker}${side}`}>
            <table className="tick-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Price</th>
                  <th>Lot</th>
                  <th>Buyer</th>
                  <th>Seller</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, limit).map((i) => (
                  <tr key={i}>
                    <td>{clock(trades.time[i]!)}</td>
                    <td
                      className={trades.auction[i] ? 'mut' : trades.side[i] === 'b' ? 'up' : 'dn'}
                    >
                      {nf(trades.price[i]!)}
                      {trades.board[i] !== 'RG' && <small> {trades.board[i]}</small>}
                    </td>
                    <td>{lots(trades.shares[i]!)}</td>
                    <td>
                      <Broker code={trades.buyer[i]!} foreign={trades.buyer_foreign[i]!} />
                    </td>
                    <td>
                      <Broker code={trades.seller[i]!} foreign={trades.seller_foreign[i]!} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length > limit && (
              <button className="tick-more" onClick={() => setLimit(limit + 500)}>
                {nf(rows.length - limit)} more
              </button>
            )}
          </Scroll>
        );
      }}
    </TickPane>
  );
}

const blockSorts = ['LOT', 'TIME'] as const;
export function DoneDetailPane() {
  const [sort, setSort] = useState<(typeof blockSorts)[number]>('LOT');
  const [side, setSide] = useState<(typeof sides)[number]>('ALL');
  const [broker, setBroker] = useState('');
  return (
    <TickPane
      kind="trades"
      controls={
        <>
          <Segments label="Block sort" values={blockSorts} value={sort} onChange={setSort} />
          <Segments label="Block side" values={sides} value={side} onChange={setSide} />
          <BrokerFilter value={broker} onChange={setBroker} />
        </>
      }
    >
      {(trades) => <Blocks trades={trades} sort={sort} side={side} broker={broker} />}
    </TickPane>
  );
}
function Blocks({
  trades,
  sort,
  side,
  broker,
}: {
  trades: TickTrades;
  sort: (typeof blockSorts)[number];
  side: (typeof sides)[number];
  broker: string;
}) {
  const all = useMemo(() => doneDetail(trades), [trades]);
  const [open, setOpen] = useState<string | null>(null);
  const shown = all
    .filter(
      (block) =>
        (side === 'ALL' || block.side === side.toLowerCase()) &&
        (!broker ||
          block.broker === broker ||
          block.counterparties.some((party) => party.broker === broker)),
    )
    .sort((a, b) => (sort === 'LOT' ? b.shares - a.shares : a.start - b.start))
    .slice(0, 300);
  if (!shown.length) return <Empty>No blocks in this view</Empty>;
  const id = (block: Block) => `${block.session}:${block.side}:${block.order}`;
  return (
    <Scroll reset={`${trades.ticker}${trades.date}${sort}${side}${broker}`}>
      <table className="tick-table tick-blocks">
        <thead>
          <tr>
            <th>Time</th>
            <th>Broker</th>
            <th>Lot</th>
            <th>Avg</th>
            <th>Range</th>
            <th>Fills</th>
            <th>Counterparties</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((block) => (
            <tr
              key={id(block)}
              className={open === id(block) ? 'on' : undefined}
              onClick={() => setOpen(open === id(block) ? null : id(block))}
            >
              <td>
                {clock(block.start)}
                {block.session === 'auction' && <small> Auction</small>}
              </td>
              <td className={block.side === 'buy' ? 'up' : 'dn'}>
                <Broker code={block.broker} foreign={block.foreign} />
              </td>
              <td>{lots(block.shares)}</td>
              <td>{nf(block.value / block.shares, 1)}</td>
              <td>
                {block.low === block.high ? nf(block.low) : `${nf(block.low)}–${nf(block.high)}`}
              </td>
              <td>{nf(block.fills)}</td>
              <td className="l">
                {(open === id(block) ? block.counterparties : block.counterparties.slice(0, 3)).map(
                  (party) => (
                    <span className="tick-party" key={`${party.broker}${party.foreign}`}>
                      <Broker code={party.broker} foreign={party.foreign} /> {lots(party.shares)}
                    </span>
                  ),
                )}
                {open !== id(block) && block.counterparties.length > 3 && (
                  <small>+{block.counterparties.length - 3}</small>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Scroll>
  );
}

export function TradeBookPane() {
  return <TickPane kind="trades">{(trades) => <PriceLevels trades={trades} />}</TickPane>;
}
function PriceLevels({ trades }: { trades: TickTrades }) {
  const levels = useMemo(() => tradeBook(trades), [trades]);
  if (!levels.length) return <Empty>No regular-board trades</Empty>;
  const widest = Math.max(...levels.map((l) => l.buy + l.sell + l.auction));
  const width = (shares: number) => `${(shares / widest) * 100}%`;
  return (
    <Scroll reset={`${trades.ticker}${trades.date}`}>
      <table className="tick-table tick-levels">
        <thead>
          <tr>
            <th>Price</th>
            <th>Buy lot</th>
            <th>Sell lot</th>
            <th />
            <th>Foreign</th>
          </tr>
        </thead>
        <tbody>
          {levels.map((level) => {
            const total = level.buy + level.sell + level.auction;
            return (
              <tr key={level.price}>
                <td>{nf(level.price)}</td>
                <td className="up">{lots(level.buy)}</td>
                <td className="dn">{lots(level.sell)}</td>
                <td className="tick-split" title={`Auction ${lots(level.auction)} lot`}>
                  <i className="up" style={{ width: width(level.buy) }} />
                  <i className="dn" style={{ width: width(level.sell) }} />
                  <i className="mut" style={{ width: width(level.auction) }} />
                </td>
                <td>{total ? `${nf((level.foreign / total) * 100, 1)}%` : '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Scroll>
  );
}

const sizes = { '1M': 1, '5M': 5, '15M': 15, '1H': 60 } as const;
export function IntradayPane() {
  const [size, setSize] = useState<keyof typeof sizes>('5M');
  return (
    <TickPane
      kind="trades"
      controls={
        <Segments
          label="Bar size"
          values={Object.keys(sizes) as (keyof typeof sizes)[]}
          value={size}
          onChange={setSize}
        />
      }
    >
      {(trades) => <Intraday trades={trades} minutes={sizes[size]} />}
    </TickPane>
  );
}
function Intraday({ trades, minutes }: { trades: TickTrades; minutes: number }) {
  const host = useRef<HTMLDivElement>(null);
  const series = useMemo(() => bars(trades, minutes), [trades, minutes]);
  const [hover, setHover] = useState<number | null>(null);
  // The chart runs in UTC, so offsetting by the session's midnight shows Jakarta clock times.
  const midnight = Date.parse(`${trades.date}T00:00:00Z`) / 1000;
  useEffect(() => {
    if (!host.current || !series.length) return;
    const chart = terminalChart(host.current);
    chart.applyOptions({ timeScale: { timeVisible: true, secondsVisible: false } });
    const candles = chart.addSeries(CandlestickSeries, {
      upColor: '#22a6a0',
      downColor: '#e4573f',
      borderVisible: false,
      wickUpColor: '#22a6a0',
      wickDownColor: '#e4573f',
      priceFormat: { type: 'custom', minMove: 1, formatter: (value: number) => nf(value) },
    });
    candles.setData(
      series.map(
        (bar): CandlestickData<UTCTimestamp> => ({
          time: (midnight + bar.time) as UTCTimestamp,
          open: bar.open,
          high: bar.high,
          low: bar.low,
          close: bar.close,
        }),
      ),
    );
    chart
      .addSeries(
        HistogramSeries,
        {
          lastValueVisible: false,
          priceLineVisible: false,
          priceFormat: { type: 'custom', formatter: short },
        },
        1,
      )
      .setData(
        series.map((bar) => ({
          time: (midnight + bar.time) as UTCTimestamp,
          value: bar.shares / 100,
          color: bar.close >= bar.open ? '#22a6a08c' : '#e4573f8c',
        })),
      );
    chart.subscribeCrosshairMove((event) =>
      setHover(typeof event.time === 'number' ? event.time - midnight : null),
    );
    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [series, midnight]);
  const bar = series.find((b) => b.time === hover) ?? series.at(-1);
  if (!bar) return <Empty>No regular-board trades</Empty>;
  return (
    <div className="flow-view">
      <div className="legend">
        <time>{clock(bar.time)}</time>
        <span>O {nf(bar.open)}</span>
        <span>H {nf(bar.high)}</span>
        <span>L {nf(bar.low)}</span>
        <span>C {nf(bar.close)}</span>
        <span>{lots(bar.shares)} lot</span>
        <span className="tick-foreign">
          F {lots(bar.foreignBuy)} buy {lots(bar.foreignSell)} sell
        </span>
      </div>
      <div className="flow-chart" ref={host} />
    </div>
  );
}
