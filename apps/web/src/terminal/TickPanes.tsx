import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { dateText, nf, short } from '../ticker/format';
import {
  blockId,
  sessionOpen,
  clock,
  doneDetail,
  isBlockTrade,
  tradeBook,
  type Block,
  type TickBook,
  type TickKind,
  type TickTrades,
  type SessionOpen,
  type Party,
} from '../ticks';
import { useSession, useTicks, type Loaded } from './tick-data';
import { useTerminal } from './state';
import { Empty, Scroll, Segments, SignInPrompt } from './ui';
import './tick-panes.css';

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
      <time>{date ? dateText(date) : '—'}</time>
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
  if (session !== 'signed-in') return <SignInPrompt />;
  let body: ReactNode;
  if (!date) body = <Empty>No 2026 sessions for this ticker</Empty>;
  else if (state.kind === 'loading') body = <Empty>Loading {dateText(date)}…</Empty>;
  else if (state.kind === 'missing') body = <Empty>Not collected for {dateText(date)}</Empty>;
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

const fillCount = (fills: number) => `${nf(fills)} ${fills === 1 ? 'fill' : 'fills'}`;
const lots = (shares: number) => nf(shares / 100, shares % 100 ? 2 : 0);
function Broker({ code, foreign }: { code: string; foreign: boolean }) {
  return (
    <span className={foreign ? 'tick-foreign' : undefined}>
      {code} {foreign ? 'F' : 'D'}
    </span>
  );
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
                <td className={bid ? 'depth bid' : undefined} style={bid && depth(bid[2])}>
                  {bid && lots(bid[2])}
                </td>
                <td className="up">{bid && nf(bid[0])}</td>
                <td className="dn">{offer && nf(offer[0])}</td>
                <td className={offer ? 'depth offer' : undefined} style={offer && depth(offer[2])}>
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

function action(side: Block['side'], auction: boolean, board: string) {
  if (board !== 'RG') return board === 'NG' ? 'NEGO' : board === 'TN' ? 'CASH' : board;
  return auction ? 'AUC' : side === 'buy' ? 'BUY' : 'SELL';
}
function useSessionOpen(trades: TickTrades) {
  const { detail } = useTerminal();
  return useMemo(
    () => sessionOpen(detail.kind === 'ready' ? detail.data.prices : [], trades),
    [detail, trades],
  );
}
function Price({
  value,
  open,
  decimals = 0,
}: {
  value: number;
  open: SessionOpen | null;
  decimals?: number;
}) {
  const change = open ? (value / open.price - 1) * 100 : null;
  const whole = decimals > 0 && Number.isInteger(Number(value.toFixed(decimals)));
  return (
    <span
      className={change === null || change === 0 ? 'mut' : change > 0 ? 'up' : 'dn'}
      title={open ? `${open.source} ${nf(open.price)}` : 'Opening price unavailable'}
    >
      {whole ? <span className="tick-whole-price">{nf(value)}</span> : nf(value, decimals)}
      {change !== null &&
        ` (${change > 0 ? '+' : change < 0 ? '−' : ''}${nf(Math.abs(change), 2)}%)`}
    </span>
  );
}
function PriceRange({ block, open }: { block: Block; open: SessionOpen | null }) {
  return (
    <>
      <Price value={block.low} open={open} />
      {block.low !== block.high && (
        <>
          {' '}
          to <Price value={block.high} open={open} />
        </>
      )}
    </>
  );
}
const tradeColumns = ['Time', 'Price', 'Action', 'Lot', 'Val', 'Buy', 'Sell', 'Market'];
function TradeHeader() {
  return (
    <thead>
      <tr>
        {tradeColumns.map((column) => (
          <th key={column} title={column === 'Val' ? 'Value in IDR' : undefined}>
            {column}
          </th>
        ))}
      </tr>
    </thead>
  );
}

export function RunningTradePane() {
  const { tickBlock } = useTerminal();
  const [broker, setBroker] = useState('');
  const [side, setSide] = useState<(typeof sides)[number]>('ALL');
  useEffect(() => {
    if (tickBlock) {
      setBroker('');
      setSide('ALL');
    }
  }, [tickBlock]);
  return (
    <TickPane
      kind="trades"
      controls={
        <>
          <Segments label="Trade side" values={sides} value={side} onChange={setSide} />
          <BrokerFilter value={broker} onChange={setBroker} />
        </>
      }
    >
      {(trades) => (
        <TradeTape
          key={`${trades.ticker}${trades.date}`}
          trades={trades}
          broker={broker}
          side={side}
        />
      )}
    </TickPane>
  );
}

function SummaryLine({
  className,
  items,
  title,
}: {
  className: string;
  items: { key: string; content: ReactNode }[];
  title: string;
}) {
  const line = useRef<HTMLDivElement>(null);
  const measure = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(items.length);
  useLayoutEffect(() => {
    const container = line.current;
    const ruler = measure.current;
    if (!container || !ruler) return;
    const fit = () => {
      if (!container.clientWidth) return;
      const measured = [...ruler.children];
      let width = 0,
        count = 0;
      for (const item of measured.slice(0, -1)) {
        const next = item.getBoundingClientRect().width;
        const remaining = items.length - count - 1;
        const overflow = remaining ? (measured.at(-1)?.getBoundingClientRect().width ?? 0) + 12 : 0;
        if (width + next + overflow > container.clientWidth) break;
        width += next + 12;
        count++;
      }
      setVisible(count);
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(container);
    return () => observer.disconnect();
  }, [items]);
  return (
    <>
      <div className={`tick-summary-line ${className}`} ref={line} title={title}>
        {items.slice(0, visible).map((item) => (
          <span key={item.key}>{item.content}</span>
        ))}
        {visible < items.length && <span>+{items.length - visible}</span>}
      </div>
      <div className="tick-summary-line tick-summary-measure" ref={measure} aria-hidden="true">
        {items.map((item) => (
          <span key={item.key}>{item.content}</span>
        ))}
        <span>+{items.length}</span>
      </div>
    </>
  );
}

function BlockSummary({
  block,
  open,
  prices,
  onHover,
  onFocus,
}: {
  block: Block;
  open: SessionOpen | null;
  prices: [number, number][];
  onHover: (party: Party | null) => void;
  onFocus: (party: Party | null) => void;
}) {
  const partyText = (party: Block['counterparties'][number]) =>
    `${party.broker} ${party.foreign ? 'F' : 'D'} ${lots(party.shares)}`;
  return (
    <div className="tick-summary" aria-label="Selected block summary">
      <div className="tick-summary-main">
        <Broker code={block.broker} foreign={block.foreign} />
        <span
          className={block.session !== 'continuous' ? 'mut' : block.side === 'buy' ? 'up' : 'dn'}
        >
          {action(block.side, block.session === 'auction', block.board)}
        </span>
        <span title={fillCount(block.fills)}>{lots(block.shares)} lot</span>
        <span>
          <PriceRange block={block} open={open} />
        </span>
      </div>
      <SummaryLine
        className="tick-counterparties"
        title={block.counterparties.map(partyText).join('  ')}
        items={block.counterparties.map((party) => ({
          key: `${party.broker}:${party.foreign}`,
          content: (
            <button
              className="tick-counterparty"
              onMouseEnter={() => onHover(party)}
              onMouseLeave={() => onHover(null)}
              onFocus={() => onFocus(party)}
              onBlur={() => onFocus(null)}
            >
              <Broker code={party.broker} foreign={party.foreign} /> {lots(party.shares)}
            </button>
          ),
        }))}
      />
      {prices.length > 1 && (
        <SummaryLine
          className="tick-prices"
          title={prices.map(([price, shares]) => `${nf(price)} ${lots(shares)}`).join('  ')}
          items={prices.map(([price, shares]) => ({
            key: String(price),
            content: (
              <>
                <Price value={price} open={open} /> {lots(shares)}
              </>
            ),
          }))}
        />
      )}
    </div>
  );
}
function TradeTape({
  trades,
  broker,
  side,
}: {
  trades: TickTrades;
  broker: string;
  side: (typeof sides)[number];
}) {
  const { tickBlock } = useTerminal();
  const open = useSessionOpen(trades);
  const block = useMemo(
    () =>
      tickBlock
        ? doneDetail(trades).find((candidate) => blockId(candidate) === blockId(tickBlock))
        : undefined,
    [trades, tickBlock],
  );
  const [limit, setLimit] = useState(500);
  const [hovered, setHovered] = useState<{ block: Block; party: Party } | null>(null);
  const [focused, setFocused] = useState<{ block: Block; party: Party } | null>(null);
  const isolated =
    (hovered && hovered.block === block ? hovered.party : null) ??
    (focused && focused.block === block ? focused.party : null);
  const prices = useMemo(() => {
    const levels = new Map<number, number>();
    if (tickBlock && block) {
      trades.price.forEach((price, i) => {
        if (isBlockTrade(trades, i, tickBlock))
          levels.set(price, (levels.get(price) ?? 0) + trades.shares[i]!);
      });
    }
    return [...levels].sort(([a], [b]) =>
      block?.session === 'continuous' && block.side === 'sell' ? b - a : a - b,
    );
  }, [trades, tickBlock, block]);
  const firstFill = useRef<HTMLTableRowElement>(null);
  const rows: number[] = [];
  let lastFill = -1;
  for (let i = trades.time.length - 1; i >= 0; i--) {
    if (
      side !== 'ALL' &&
      (trades.board[i] !== 'RG' || trades.side[i] !== (side === 'BUY' ? 'b' : 's'))
    )
      continue;
    if (broker && trades.buyer[i] !== broker && trades.seller[i] !== broker) continue;
    rows.push(i);
    if (tickBlock && isBlockTrade(trades, i, tickBlock)) lastFill = rows.length - 1;
  }
  // Keep every fill in the tape, including orders older than the initial page.
  const loaded = Math.max(limit, lastFill + 51);
  const firstMatch = tickBlock ? rows.find((i) => isBlockTrade(trades, i, tickBlock)) : undefined;
  useEffect(() => {
    setLimit((previous) => Math.max(previous, lastFill + 51));
    firstFill.current?.scrollIntoView({ block: 'start' });
  }, [tickBlock, trades, lastFill]);
  return (
    <>
      <Scroll reset={`${trades.ticker}${trades.date}${broker}${side}`}>
        {!rows.length && <Empty>No trades in this view</Empty>}
        <table className="tick-table tick-tape tick-orders">
          <TradeHeader />
          <tbody>
            {rows.slice(0, loaded).map((i) => {
              const highlighted = tickBlock !== null && isBlockTrade(trades, i, tickBlock);
              const counterparty =
                block?.side === 'buy'
                  ? { broker: trades.seller[i], foreign: trades.seller_foreign[i] }
                  : { broker: trades.buyer[i], foreign: trades.buyer_foreign[i] };
              const dimmed =
                highlighted &&
                isolated &&
                (counterparty.broker !== isolated.broker ||
                  counterparty.foreign !== isolated.foreign);
              return (
                <tr
                  key={i}
                  ref={i === firstMatch ? firstFill : undefined}
                  className={
                    highlighted ? `tick-highlight${dimmed ? ' tick-dimmed' : ''}` : undefined
                  }
                  data-highlighted={highlighted || undefined}
                >
                  <td className="mut">{clock(trades.time[i]!)}</td>
                  <td>
                    <Price value={trades.price[i]!} open={open} />
                  </td>
                  <td
                    className={
                      trades.auction[i] || trades.board[i] !== 'RG'
                        ? 'mut'
                        : trades.side[i] === 'b'
                          ? 'up'
                          : 'dn'
                    }
                  >
                    {action(
                      trades.side[i] === 'b' ? 'buy' : 'sell',
                      trades.auction[i]!,
                      trades.board[i]!,
                    )}
                  </td>
                  <td>{lots(trades.shares[i]!)}</td>
                  <td title={`${nf(trades.price[i]! * trades.shares[i]!)} IDR`}>
                    {short(trades.price[i]! * trades.shares[i]!)}
                  </td>
                  <td>
                    <Broker code={trades.buyer[i]!} foreign={trades.buyer_foreign[i]!} />
                  </td>
                  <td>
                    <Broker code={trades.seller[i]!} foreign={trades.seller_foreign[i]!} />
                  </td>
                  <td>{trades.board[i]}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length > loaded && (
          <button className="tick-more" onClick={() => setLimit(loaded + 500)}>
            {nf(rows.length - loaded)} more
          </button>
        )}
      </Scroll>
      <div className="tick-summary-dock">
        {block && (
          <BlockSummary
            key={blockId(block)}
            block={block}
            open={open}
            prices={prices}
            onHover={(party) => setHovered(party ? { block, party } : null)}
            onFocus={(party) => setFocused(party ? { block, party } : null)}
          />
        )}
      </div>
    </>
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
      {(trades) => (
        <Blocks
          key={`${trades.ticker}${trades.date}`}
          trades={trades}
          sort={sort}
          side={side}
          broker={broker}
        />
      )}
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
  const [limit, setLimit] = useState(300);
  const open = useSessionOpen(trades);
  const { tickBlock, selectTickBlock } = useTerminal();
  const shown = all
    .filter(
      (block) =>
        (side === 'ALL' || block.side === side.toLowerCase()) &&
        (!broker ||
          block.broker === broker ||
          block.counterparties.some((party) => party.broker === broker)),
    )
    .sort((a, b) =>
      sort === 'LOT' ? b.shares - a.shares || a.start - b.start : a.start - b.start,
    );
  if (!shown.length) return <Empty>No blocks in this view</Empty>;
  return (
    <Scroll reset={`${trades.ticker}${trades.date}${sort}${side}${broker}`}>
      <table className="tick-table tick-blocks tick-orders">
        <TradeHeader />
        <tbody>
          {shown.slice(0, limit).map((block) => {
            const selected =
              tickBlock?.ticker === trades.ticker &&
              tickBlock.date === trades.date &&
              blockId(tickBlock) === blockId(block);
            const select = () =>
              selectTickBlock(
                selected
                  ? null
                  : {
                      ticker: trades.ticker,
                      date: trades.date,
                      ...block,
                    },
              );
            return (
              <tr
                key={blockId(block)}
                className={selected ? 'tick-highlight' : undefined}
                onClick={(event) => {
                  event.currentTarget.querySelector('button')?.focus({ preventScroll: true });
                  select();
                }}
              >
                <td className="mut">
                  <button
                    className="tick-block-select"
                    aria-pressed={selected}
                    aria-label={`${clock(block.start)} ${action(block.side, block.session === 'auction', block.board)} ${lots(block.shares)} lot ${block.broker} ${block.foreign ? 'F' : 'D'}, show fills`}
                    title={fillCount(block.fills)}
                  >
                    {clock(block.start)}
                  </button>
                </td>
                <td>
                  <Price value={block.value / block.shares} open={open} decimals={1} />
                </td>
                <td
                  className={
                    block.session !== 'continuous' ? 'mut' : block.side === 'buy' ? 'up' : 'dn'
                  }
                >
                  {action(block.side, block.session === 'auction', block.board)}
                </td>
                <td title={fillCount(block.fills)}>{lots(block.shares)}</td>
                <td title={`${nf(block.value)} IDR`}>{short(block.value)}</td>
                <td className="tick-buy up">
                  <BlockSide block={block} side="buy" />
                </td>
                <td className="tick-sell dn">
                  <BlockSide block={block} side="sell" />
                </td>
                <td>{block.board}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {shown.length > limit && (
        <button className="tick-more" onClick={() => setLimit(limit + 300)}>
          {nf(shown.length - limit)} more
        </button>
      )}
    </Scroll>
  );
}

function BlockSide({ block, side }: { block: Block; side: 'buy' | 'sell' }) {
  const parties =
    side === (block.side === 'none' ? 'sell' : block.side) ? [block] : block.counterparties;
  const brokers = [...new Set(parties.map((party) => party.broker))];
  return brokers.length === 1 ? (
    <Broker code={brokers[0]!} foreign={parties.some((party) => party.foreign)} />
  ) : (
    <span className="tick-stack" aria-label={`${nf(brokers.length)} brokers`}>
      <svg
        aria-hidden="true"
        width="18"
        height="14"
        viewBox="0 0 18 14"
        fill="none"
        stroke="currentColor"
      >
        <path d="M1 9h10v4H1zM4 5h10v4M7 1h10v4" />
      </svg>
      {nf(brokers.length)}
    </span>
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
