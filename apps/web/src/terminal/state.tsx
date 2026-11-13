import { createContext, useContext, useEffect, useState } from 'react';
import type { Ticker } from '../data';
import type { BrokerDay, BrokerBoard, InvestorFilter } from '../brokers';
import type { Selection } from '../ticker/logic';
import type { BlockSelection } from '../ticks';
import {
  fetchHeadlines,
  fetchCalendar,
  fetchActions,
  fetchRisk,
  type TerminalData,
  type Resource,
  type Headline,
} from './sources';

export const functions = {
  WL: 'Watchlist',
  GP: 'Price history',
  KEY: 'Key figures',
  BRK: 'Broker summary',
  BFL: 'Broker flow',
  FF: 'Foreign flow',
  OB: 'Closing order book',
  RT: 'Running trade',
  DD: 'Done detail',
  TB: 'Trade book',
  HDS: 'Holders and changes',
  DISC: 'IDX disclosures',
  FEED: 'Company feed',
  SIG: 'Signals feed',
  HEAT: 'Heatmap by value',
  MOV: 'Market movers',
  NEWS: 'News',
  CAL: 'Economic calendar',
  CA: 'Corporate actions',
  RISK: 'Risk flags',
};
export type FunctionId = keyof typeof functions;
export const isFunction = (value: string): value is FunctionId => Object.hasOwn(functions, value);
export type Layout = 'grid' | 'focus' | 'flow';
export const isLayout = (value: string | null): value is Layout =>
  value === 'grid' || value === 'focus' || value === 'flow';
export const parseLayout = (value: string | null): Layout | null =>
  value === 'live' ? 'flow' : isLayout(value) ? value : null;
export type Timeframe = 'W' | 'D' | '4H' | '1H' | '15M';
export type Session = 'checking' | 'signed-in' | 'signed-out';
export type BrokerFilters = {
  board: BrokerBoard | 'all';
  type: InvestorFilter;
  mode: 'NET' | 'GROSS';
  unit: 'VALUE' | 'LOT';
  period: '1D' | '5D' | '20D';
  flow: '1W' | '1M' | '3M' | 'YTD';
};
export type Filters = {
  news: 'ID' | 'WORLD' | 'TICKER';
  cal: 'ALL' | 'HIGH' | 'ID';
  ca: 'ALL' | 'DIV' | 'RIGHTS' | 'RUPS' | 'TICKER';
  risk: 'ALL' | 'SUSP' | 'UMA' | 'FCA' | 'NOTES';
  sig: 'ALL' | 'ARA' | 'VOL' | 'FGN' | 'RS' | '5%';
  mov: 'GAIN' | 'LOSE';
  movValue: 'VALUE' | 'F BUY' | 'F SELL';
  period: '1d' | '3d' | '5d';
};
export const initialFilters: Filters = {
  news: 'ID',
  cal: 'ALL',
  ca: 'ALL',
  risk: 'ALL',
  sig: 'ALL',
  mov: 'GAIN',
  movValue: 'VALUE',
  period: '1d',
};
export const initialBrokerFilters: BrokerFilters = {
  board: 'regular',
  type: 'ALL',
  mode: 'NET',
  unit: 'VALUE',
  period: '1D',
  flow: '1M',
};
export function useResource<T>(read: (signal: AbortSignal) => Promise<Resource<T>>) {
  const [state, setState] = useState<Resource<T>>({ kind: 'loading' });
  useEffect(() => {
    const controller = new AbortController();
    void read(controller.signal).then((value) => {
      if (!controller.signal.aborted) setState(value);
    });
    return () => controller.abort();
  }, [read]);
  return state;
}
export function usePublications() {
  return {
    news: useResource(fetchHeadlines),
    calendar: useResource(fetchCalendar),
    actions: useResource(fetchActions),
    risks: useResource(fetchRisk),
  };
}
type TerminalContextValue = {
  data: TerminalData;
  detail: Resource<Ticker>;
  ticker: string;
  setTicker: (ticker: string) => void;
  pins: string[];
  togglePin: (ticker: string) => void;
  selection: Selection;
  select: (selection: Selection) => void;
  timeframe: Timeframe;
  setTimeframe: (timeframe: Timeframe) => void;
  filters: Filters;
  filter: <K extends keyof Filters>(key: K, value: Filters[K]) => void;
  broker: BrokerFilters;
  setBroker: <K extends keyof BrokerFilters>(key: K, value: BrokerFilters[K]) => void;
  brokers: Resource<BrokerDay[]>;
  brokerError: string;
  session: Session;
  signIn: () => void;
  getToken: () => Promise<string | undefined>;
  tickDate: string | null;
  setTickDate: (date: string | null) => void;
  tickBlock: BlockSelection | null;
  selectTickBlock: (block: BlockSelection | null) => void;
  retryBrokers: () => void;
  publications: ReturnType<typeof usePublications>;
  tickerNews: Resource<Headline[]>;
  flowPins: string[];
  setFlowPins: (pins: string[]) => void;
  flowHidden: string[];
  setFlowHidden: (hidden: string[]) => void;
};
export const TerminalContext = createContext<TerminalContextValue | null>(null);
export function useTerminal() {
  const context = useContext(TerminalContext);
  if (!context) throw new Error('Missing terminal context');
  return context;
}
