import { useEffect, useRef, useState } from 'react';
import type { Feed, Stock } from '../data';
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
    <Scroll reset="watchlist">
      {stocks.length ? (
        <QuoteTable stocks={stocks} selected={ticker} />
      ) : (
        <Empty>
          No pinned stocks. Pin stocks from <a href="/">the watchlist</a>.
        </Empty>
      )}
    </Scroll>
  );
}
function QuoteTable({
  stocks,
  selected,
  foreign = false,
}: {
  stocks: Stock[];
  selected: string;
  foreign?: boolean;
}) {
  return (
    <table>
      <thead>
        <tr>
          <th>TICKER</th>
          <th>LAST IDR</th>
          <th>CHG</th>
          <th>{foreign ? 'F NET EST. IDR' : 'VALUE IDR'}</th>
        </tr>
      </thead>
      <tbody>
        {stocks.map((stock) => (
          <tr key={stock.ticker} className={stock.ticker === selected ? 'on' : ''}>
            <td>
              <TickerLink ticker={stock.ticker} />
            </td>
            <td>{nf(stock.close)}</td>
            <td className={direction(stock.change_pct)}>{percent(stock.change_pct)}</td>
            <td
              title={nf(foreign ? stock.net_foreign : stock.value)}
              className={foreign ? direction(stock.net_foreign) : 'mut'}
            >
              {foreign ? signed(stock.net_foreign, short) : short(stock.value)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
export function MoversPane() {
  const { data, filters, filter, ticker } = useTerminal();
  const foreign = filters.mov === 'F BUY' || filters.mov === 'F SELL';
  const quotes = new Map(data.stocks.map((stock) => [stock.ticker, stock]));
  const stocks = foreign
    ? [...data.stocks]
    : data.summary.stocks.flatMap((stock) => {
        const quote = quotes.get(stock.ticker),
          window = stock.windows[filters.period];
        return quote && window.value !== null
          ? [{ ...quote, value: window.value, change_pct: window.change_pct }]
          : [];
      });
  const amount = (stock: Stock) =>
    foreign ? stock.net_foreign : filters.mov === 'VALUE' ? stock.value : stock.change_pct;
  const descending = filters.mov !== 'LOSE' && filters.mov !== 'F SELL';
  stocks.sort((a, b) => {
    const av = amount(a),
      bv = amount(b);
    return av === null ? 1 : bv === null ? -1 : (av - bv) * (descending ? -1 : 1);
  });
  return (
    <>
      <div className="sub">
        <Segments
          label="Movers"
          values={['GAIN', 'LOSE', 'VALUE', 'F BUY', 'F SELL']}
          value={filters.mov}
          onChange={(value) => filter('mov', value)}
        />
        <Segments
          label="Mover period"
          values={['1d', '3d', '5d']}
          value={filters.period}
          onChange={(value) => filter('period', value)}
        />
      </div>
      <Scroll reset={`${filters.mov}:${filters.period}`}>
        {foreign && filters.period !== '1d' && (
          <Empty>Foreign flow is available for 1D only.</Empty>
        )}
        <div className="publication">{foreign ? data.health.prices : data.summary.date}</div>
        <QuoteTable stocks={stocks.slice(0, 30)} selected={ticker} foreign={foreign} />
      </Scroll>
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
function SignalDetail({ row }: { row: Feed[number] }) {
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
  const { data, filters, filter, ticker } = useTerminal();
  const rows = data.feed.filter(
    (row) => filters.sig === 'ALL' || signalNames[row.kind] === filters.sig,
  );
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
            <tbody>
              {rows.map((row, i) => (
                <tr
                  key={`${row.ticker}:${row.kind}:${row.date}:${i}`}
                  className={row.ticker === ticker ? 'on' : ''}
                >
                  <td className="mut">{dateText(row.date, false)}</td>
                  <td>
                    <TickerLink ticker={row.ticker} />
                  </td>
                  <td className="accent">{signalNames[row.kind]}</td>
                  <td className="l">
                    <SignalDetail row={row} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Empty>No signals</Empty>
        )}
      </Scroll>
    </>
  );
}
type Tile = { stock: Stock; x: number; y: number; w: number; h: number };
function treemap(stocks: Stock[], width: number, height: number): Tile[] {
  const total = stocks.reduce((sum, stock) => sum + stock.value, 0);
  if (!total || !width || !height) return [];
  const remaining = stocks.map((stock) => ({
    stock,
    area: (stock.value / total) * width * height,
  }));
  const out: Tile[] = [];
  let x = 0,
    y = 0,
    w = width,
    h = height;
  type Node = (typeof remaining)[number];
  let row: Node[] = [];
  const worst = (nodes: Node[], edge: number) => {
    if (!nodes.length) return Infinity;
    const sum = nodes.reduce((n, node) => n + node.area, 0);
    return Math.max(
      (edge ** 2 * Math.max(...nodes.map((node) => node.area))) / sum ** 2,
      sum ** 2 / (edge ** 2 * Math.min(...nodes.map((node) => node.area))),
    );
  };
  function place(nodes: Node[]) {
    const sum = nodes.reduce((n, node) => n + node.area, 0);
    if (w >= h) {
      const rw = sum / h;
      let yy = y;
      for (const node of nodes) {
        const rh = node.area / rw;
        out.push({ stock: node.stock, x, y: yy, w: rw, h: rh });
        yy += rh;
      }
      x += rw;
      w -= rw;
    } else {
      const rh = sum / w;
      let xx = x;
      for (const node of nodes) {
        const rw = node.area / rh;
        out.push({ stock: node.stock, x: xx, y, w: rw, h: rh });
        xx += rw;
      }
      y += rh;
      h -= rh;
    }
  }
  for (const node of remaining) {
    if (worst([...row, node], Math.min(w, h)) > worst(row, Math.min(w, h))) {
      place(row);
      row = [];
    }
    row.push(node);
  }
  if (row.length) place(row);
  return out;
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
    <div ref={ref} className="heat">
      {treemap(stocks, size.width, size.height).map((tile) => {
        const change = tile.stock.change_pct ?? 0;
        const strength = Math.min(1, Math.abs(change) / 4) ** 0.8;
        const end = change >= 0 ? [20, 122, 117] : [170, 62, 44];
        const background = `rgb(${[43, 48, 46].map((n, i) => Math.round(n + ((end[i] ?? 0) - n) * strength)).join(',')})`;
        return (
          <button
            key={tile.stock.ticker}
            className={`tile${ticker === tile.stock.ticker ? ' on' : ''}`}
            aria-label={`${tile.stock.ticker} ${percent(tile.stock.change_pct)}`}
            title={`${tile.stock.name}\n${nf(tile.stock.close)} IDR\n${nf(tile.stock.value)} IDR value`}
            onClick={() => setTicker(tile.stock.ticker)}
            style={{
              left: tile.x + 1,
              top: tile.y + 1,
              width: Math.max(0, tile.w - 2),
              height: Math.max(0, tile.h - 2),
              background,
            }}
          >
            {tile.w > 34 && tile.h > 18 && <b>{tile.stock.ticker}</b>}
            {tile.w > 46 && tile.h > 34 && <span>{percent(tile.stock.change_pct)}</span>}
          </button>
        );
      })}
    </div>
  );
}
