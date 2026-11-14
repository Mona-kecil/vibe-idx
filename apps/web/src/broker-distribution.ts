import type { BrokerBoard, BrokerDay, BrokerRow } from './brokers';
import { boardCodes, type TickTrades } from './ticks.js';

export type BrokerType = BrokerRow['broker_type'];
export const others = 'Others';
type Node = { code: string; amount: number };
export type Distribution = {
  buyers: Node[];
  sellers: Node[];
  links: { buyer: string; seller: string; amount: number }[];
  total: number;
};

/**
 * Who bought from whom across the sessions' fills on one board. The `top` buyers and sellers keep
 * their own node and the rest share one Others node per side.
 */
export function distribution(
  sessions: TickTrades[],
  board: BrokerBoard | 'all',
  unit: 'VALUE' | 'LOT',
  top = 8,
): Distribution {
  const pairs = new Map<string, number>(),
    bought = new Map<string, number>(),
    sold = new Map<string, number>();
  let total = 0;
  for (const trades of sessions)
    trades.time.forEach((_, i) => {
      if (board !== 'all' && trades.board[i] !== boardCodes[board]) return;
      const amount =
        unit === 'LOT' ? trades.shares[i]! / 100 : trades.shares[i]! * trades.price[i]!;
      const buyer = trades.buyer[i]!,
        seller = trades.seller[i]!;
      const pair = `${buyer} ${seller}`;
      pairs.set(pair, (pairs.get(pair) ?? 0) + amount);
      bought.set(buyer, (bought.get(buyer) ?? 0) + amount);
      sold.set(seller, (sold.get(seller) ?? 0) + amount);
      total += amount;
    });
  const rank = (side: Map<string, number>) => {
    const sorted = [...side]
      .map(([code, amount]) => ({ code, amount }))
      .sort((a, b) => b.amount - a.amount);
    const rest = sorted.slice(top).reduce((sum, node) => sum + node.amount, 0);
    const nodes = sorted.slice(0, top);
    return {
      nodes: rest > 0 ? [...nodes, { code: others, amount: rest }] : nodes,
      kept: new Set(nodes.map((node) => node.code)),
    };
  };
  const buyers = rank(bought),
    sellers = rank(sold);
  const links = new Map<string, { buyer: string; seller: string; amount: number }>();
  for (const [pair, amount] of pairs) {
    const [b, s] = pair.split(' ') as [string, string];
    const buyer = buyers.kept.has(b) ? b : others,
      seller = sellers.kept.has(s) ? s : others;
    const key = `${buyer} ${seller}`;
    const link = links.get(key) ?? { buyer, seller, amount: 0 };
    link.amount += amount;
    links.set(key, link);
  }
  return { buyers: buyers.nodes, sellers: sellers.nodes, links: [...links.values()], total };
}

type Box = { y: number; h: number };
/**
 * Stacks each side's nodes top to bottom, every node at least `min` tall so its label fits, and
 * splits each node's height among its links in the other side's order so bands cross as little as
 * possible.
 */
export function distributionLayout(data: Distribution, height: number, gap = 6, min = 22) {
  const column = (nodes: Node[]) => {
    const spare = Math.max(0, height - gap * (nodes.length - 1) - min * nodes.length);
    let y = 0;
    return new Map(
      nodes.map((node) => {
        const box = { y, h: min + (data.total ? (spare * node.amount) / data.total : 0) };
        y += box.h + gap;
        return [node.code, box];
      }),
    );
  };
  const left = column(data.buyers),
    right = column(data.sellers);
  const index = (nodes: Node[]) => new Map(nodes.map((node, i) => [node.code, i]));
  const buyerIndex = index(data.buyers),
    sellerIndex = index(data.sellers);
  const slices = (
    boxes: Map<string, Box>,
    nodes: Node[],
    own: 'buyer' | 'seller',
    order: Map<string, number>,
  ) => {
    const result = new Map<(typeof data.links)[number], Box>();
    for (const node of nodes) {
      const box = boxes.get(node.code)!;
      let y = box.y;
      data.links
        .filter((link) => link[own] === node.code)
        .sort(
          (a, b) =>
            order.get(a[own === 'buyer' ? 'seller' : 'buyer'])! -
            order.get(b[own === 'buyer' ? 'seller' : 'buyer'])!,
        )
        .forEach((link) => {
          const h = (box.h * link.amount) / node.amount;
          result.set(link, { y, h });
          y += h;
        });
    }
    return result;
  };
  const from = slices(left, data.buyers, 'buyer', sellerIndex),
    to = slices(right, data.sellers, 'seller', buyerIndex);
  return {
    left,
    right,
    bands: data.links.map((link) => ({ ...link, from: from.get(link)!, to: to.get(link)! })),
  };
}

export function brokerTypes(days: BrokerDay[]) {
  const types = new Map<string, BrokerType>();
  for (const day of days)
    for (const row of [...day.buy, ...day.sell]) types.set(row.broker, row.broker_type);
  return types;
}
