import { useEffect, useRef, useState, type MouseEvent } from 'react';
import type { SignalFeed, Stock } from '../data';
import { treemap } from '../treemap';
import { nf, short, signed, dateText } from '../ticker/format';
import { useTerminal } from './state';
import { Empty, Scroll, Segments, TickerLink, percent, direction } from './ui';
import './market-panes.css';

export function WatchlistPane() {
  const { data, pins, ticker } = useTerminal();
  const stocks = pins.flatMap((pin) => {
    const stock = data.stocks.find((s) => s.ticker === pin);
    return stock ? [stock] : [];
  });
  return (
    <Scroll reset="watchlist" className="watchlist">
      {stocks.length ? (
        <QuoteTable stocks={stocks} selected={ticker} />
      ) : (
        <Empty>
          No pinned stocks. <PinButton ticker={ticker} showTicker /> or type a ticker then PIN.
        </Empty>
      )}
    </Scroll>
  );
}
export function PinButton({
  ticker,
  showTicker = false,
}: {
  ticker: string;
  showTicker?: boolean;
}) {
  const { pins, togglePin } = useTerminal();
  const pinned = pins.includes(ticker);
  const label = `${pinned ? 'Unpin' : 'Pin'} ${ticker}`;
  return (
    <button
      className="pin-button"
      aria-label={label}
      aria-pressed={pinned}
      title={label}
      onClick={() => togglePin(ticker)}
    >
      {showTicker ? label : pinned ? '★' : '☆'}
    </button>
  );
}
function selectRow(
  event: MouseEvent<HTMLTableRowElement>,
  ticker: string,
  setTicker: (ticker: string) => void,
) {
  if (event.target instanceof Element && event.target.closest('a,button')) return;
  setTicker(ticker);
}
function QuoteTable({
  stocks,
  selected,
  foreign = false,
  columns = 'quote',
}: {
  stocks: Stock[];
  selected: string;
  foreign?: boolean;
  columns?: 'quote' | 'change' | 'value';
}) {
  const { setTicker } = useTerminal();
  return (
    <table
      className="quote-table"
      aria-label={
        columns === 'change' ? 'Change ranking' : columns === 'value' ? 'Value ranking' : undefined
      }
    >
      <thead>
        <tr>
          <th>TICKER</th>
          {columns !== 'value' && <th>LAST IDR</th>}
          <th>CHG</th>
          {columns !== 'change' && <th>{foreign ? 'F NET EST. IDR' : 'VALUE IDR'}</th>}
        </tr>
      </thead>
      <tbody>
        {stocks.map((stock) => (
          <tr
            key={stock.ticker}
            className={`ticker-row${stock.ticker === selected ? ' on' : ''}`}
            onClick={(event) => selectRow(event, stock.ticker, setTicker)}
          >
            <td className="quote-ticker">
              <PinButton ticker={stock.ticker} />
              <TickerLink ticker={stock.ticker} />
            </td>
            {columns !== 'value' && <td>{nf(stock.close)}</td>}
            <td className={direction(stock.change_pct)}>{percent(stock.change_pct)}</td>
            {columns !== 'change' && (
              <td
                title={nf(foreign ? stock.net_foreign : stock.value)}
                className={foreign ? direction(stock.net_foreign) : 'mut'}
              >
                {foreign ? signed(stock.net_foreign, short) : short(stock.value)}
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
export function MoversPane() {
  const { data, filters, filter, ticker } = useTerminal();
  const foreign = filters.movValue !== 'VALUE';
  const date = foreign ? data.health.prices : data.summary.date;
  const quotes = new Map(data.stocks.map((stock) => [stock.ticker, stock]));
  const stocks = data.summary.stocks.flatMap((stock) => {
    const quote = quotes.get(stock.ticker),
      window = stock.windows[filters.period];
    return quote && window.value !== null
      ? [{ ...quote, value: window.value, change_pct: window.change_pct }]
      : [];
  });
  const changeStocks = [...stocks].sort((a, b) => {
    const av = a.change_pct,
      bv = b.change_pct;
    return av === null ? 1 : bv === null ? -1 : (av - bv) * (filters.mov === 'GAIN' ? -1 : 1);
  });
  const valueStocks = (foreign ? [...data.stocks] : [...stocks]).sort((a, b) => {
    const av = foreign ? a.net_foreign : a.value;
    const bv = foreign ? b.net_foreign : b.value;
    return (av - bv) * (filters.movValue === 'F SELL' ? 1 : -1);
  });
  const asOf = (day: string | null | undefined) =>
    day ? `As of ${dateText(day)}` : 'Date unavailable';
  return (
    <>
      <div
        className="sub mover-controls"
        title={foreign ? 'Foreign estimates are available for one session only' : undefined}
      >
        <Segments
          label="Mover period"
          values={['1d', '3d', '5d']}
          value={foreign ? '1d' : filters.period}
          disabled={foreign ? ['3d', '5d'] : []}
          onChange={(value) => filter('period', value)}
        />
      </div>
      <div className="publication">{asOf(data.summary.date)}</div>
      <div className="movers">
        <section className="mover-list" aria-label="Change movers">
          <div className="sub">
            <Segments
              label="Movers"
              values={['GAIN', 'LOSE']}
              value={filters.mov}
              onChange={(value) => filter('mov', value)}
            />
          </div>
          <Scroll reset={`${filters.mov}:${filters.period}`}>
            <QuoteTable stocks={changeStocks.slice(0, 100)} selected={ticker} columns="change" />
          </Scroll>
        </section>
        <section className="mover-list" aria-label="Value movers">
          <div className="sub">
            <Segments
              label="Value movers"
              values={['VALUE', 'F BUY', 'F SELL']}
              value={filters.movValue}
              onChange={(value) => {
                filter('movValue', value);
                if (value !== 'VALUE') filter('period', '1d');
              }}
            />
          </div>
          {date !== data.summary.date && <div className="publication">{asOf(date)}</div>}
          <Scroll reset={`${filters.movValue}:${filters.period}`}>
            <QuoteTable
              stocks={valueStocks.slice(0, 100)}
              selected={ticker}
              columns="value"
              foreign={foreign}
            />
          </Scroll>
        </section>
      </div>
    </>
  );
}
const signalNames = {
  ara: 'ARA',
  volume_spike: 'VOL',
  foreign_streak: 'FGN',
  green_on_red: 'RS',
  five_pct_change: '5%',
};
const signalOrder: Record<SignalFeed[number]['kind'], number> = {
  ara: 0,
  volume_spike: 1,
  foreign_streak: 2,
  green_on_red: 3,
  five_pct_change: 4,
};
function SignalDetail({ row }: { row: SignalFeed[number] }) {
  switch (row.kind) {
    case 'ara':
      return (
        <span className="up">
          {percent(row.numbers.change_pct)} at {nf(row.numbers.close)}
        </span>
      );
    case 'volume_spike':
      return <>{nf(row.numbers.multiple, 1)}× avg volume</>;
    case 'foreign_streak':
      return (
        <>
          {row.numbers.streak_days}d{' '}
          <span className={direction(row.numbers.net_foreign)}>
            {signed(row.numbers.net_foreign, short)} IDR est.
          </span>
        </>
      );
    case 'green_on_red':
      return (
        <>
          {percent(row.numbers.change_pct)} IHSG {percent(row.numbers.market_change_pct)}
        </>
      );
    case 'five_pct_change':
      return (
        <>
          {row.numbers.investor} {nf(row.numbers.pct_before, 2)}% →{' '}
          {row.numbers.pct_after === null ? 'Below 5%' : `${nf(row.numbers.pct_after, 2)}%`}
        </>
      );
  }
}
export function SignalsPane() {
  const { data, filters, filter, ticker, setTicker } = useTerminal();
  const rows = data.feed
    .filter(
      (row) =>
        (filters.sig === 'ALL' || signalNames[row.kind] === filters.sig) &&
        (row.kind !== 'five_pct_change' ||
          row.numbers.pct_after === null ||
          nf(row.numbers.pct_before, 2) !== nf(row.numbers.pct_after, 2)),
    )
    .sort((a, b) => b.date.localeCompare(a.date) || signalOrder[a.kind] - signalOrder[b.kind]);
  const days = new Map<string, SignalFeed>();
  for (const row of rows) {
    const day = days.get(row.date);
    if (day) day.push(row);
    else days.set(row.date, [row]);
  }
  return (
    <>
      <div className="sub">
        <Segments
          label="Signals"
          values={['ALL', 'ARA', 'VOL', 'FGN', 'RS', '5%']}
          value={filters.sig}
          onChange={(value) => filter('sig', value)}
        />
      </div>
      <Scroll reset={filters.sig}>
        {rows.length ? (
          <table>
            {[...days].map(([date, signals]) => (
              <tbody key={date} aria-label={`${dateText(date)} signals`}>
                <tr>
                  <th className="signal-day" scope="rowgroup" colSpan={3}>
                    {dateText(date)}
                  </th>
                </tr>
                {signals.map((row, i) => (
                  <tr
                    key={`${row.ticker}:${row.kind}:${row.date}:${i}`}
                    className={`ticker-row${row.ticker === ticker ? ' on' : ''}`}
                    onClick={(event) => selectRow(event, row.ticker, setTicker)}
                  >
                    <td className="quote-ticker">
                      <PinButton ticker={row.ticker} />
                      <TickerLink ticker={row.ticker} />
                    </td>
                    <td className="accent">{signalNames[row.kind]}</td>
                    <td className="l">
                      <SignalDetail row={row} />
                    </td>
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        ) : (
          <Empty>No signals</Empty>
        )}
      </Scroll>
    </>
  );
}
function heatColour(change: number) {
  const strength = Math.min(1, Math.abs(change) / 4) ** 0.8;
  const end = change >= 0 ? [20, 122, 117] : [170, 62, 44];
  return `rgb(${[43, 48, 46].map((n, i) => Math.round(n + ((end[i] ?? 0) - n) * strength)).join(',')})`;
}
export function HeatmapPane() {
  const { data, ticker, setTicker } = useTerminal();
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const host = ref.current;
    if (!host) return;
    const observer = new ResizeObserver(() =>
      setSize({ width: host.clientWidth, height: host.clientHeight }),
    );
    observer.observe(host);
    return () => observer.disconnect();
  }, []);
  const stocks = [...data.stocks]
    .filter((s) => s.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 60);
  return (
    <>
      <div className="heat-scale" aria-label="Daily price change colour scale">
        <span className="mut">CHG</span>
        {[-4, -2, 0, 2, 4].map((change) => (
          <span key={change} style={{ background: heatColour(change) }}>
            {change === -4 ? '≤−4%' : change === 4 ? '≥+4%' : `${signed(change, nf)}%`}
          </span>
        ))}
      </div>
      <div ref={ref} className="heat">
        {treemap(stocks, size.width, size.height).map((tile) => {
          return (
            <button
              key={tile.item.ticker}
              className={`tile${ticker === tile.item.ticker ? ' on' : ''}`}
              aria-label={`${tile.item.ticker} ${tile.item.name}, change ${percent(tile.item.change_pct)}, last ${nf(tile.item.close)} IDR, traded value ${nf(tile.item.value)} IDR`}
              title={`${tile.item.name}\n${nf(tile.item.close)} IDR\n${nf(tile.item.value)} IDR value`}
              onClick={() => setTicker(tile.item.ticker)}
              style={{
                left: tile.x + 1,
                top: tile.y + 1,
                width: Math.max(0, tile.w - 2),
                height: Math.max(0, tile.h - 2),
                background: heatColour(tile.item.change_pct ?? 0),
              }}
            >
              {tile.w > 34 && tile.h > 18 && <b>{tile.item.ticker}</b>}
              {tile.w > 46 && tile.h > 34 && <span>{percent(tile.item.change_pct)}</span>}
            </button>
          );
        })}
      </div>
    </>
  );
}
