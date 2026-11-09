import { createContext, useContext, useEffect, useState } from 'react';
import type { Ticker } from '../data';
import type { BrokerDay, BrokerBoard } from '../brokers';
import type { Selection } from '../ticker/logic';
import type { Period } from '../ticker/PriceChart';
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
  DES: 'Description',
  BRK: 'Broker summary',
  BFL: 'Broker flow',
  HDS: '5% holders and changes',
  DISC: 'IDX disclosures',
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
export type Layout = 'grid' | 'focus' | 'live';
export const isLayout = (value: string | null): value is Layout =>
  value === 'grid' || value === 'focus' || value === 'live';
export type BrokerFilters = {
  board: BrokerBoard | 'all';
  type: 'ALL' | 'FOREIGN' | 'LOCAL' | 'GOV';
  mode: 'NET' | 'GROSS';
  unit: 'VALUE' | 'LOT';
  period: '1D' | '5D' | '20D';
  flow: '1W' | '1M' | '3M' | 'YTD';
};
export type Filters = {
  news: 'ID' | 'WORLD' | 'TICKER';
  open: 'READER' | 'NEW TAB';
  cal: 'ALL' | 'HIGH' | 'ID';
  ca: 'ALL' | 'DIV' | 'RIGHTS' | 'RUPS' | 'TICKER';
  risk: 'ALL' | 'SUSP' | 'UMA' | 'FCA' | 'NOTES';
  sig: 'ALL' | 'ARA' | 'VOL' | 'FGN' | 'RS' | '5%';
  mov: 'GAIN' | 'LOSE' | 'VALUE' | 'F BUY' | 'F SELL';
  period: '1d' | '3d' | '5d';
};
export const initialFilters: Filters = {
  news: 'ID',
  open: 'READER',
  cal: 'ALL',
  ca: 'ALL',
  risk: 'ALL',
  sig: 'ALL',
  mov: 'GAIN',
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
  selection: Selection;
  select: (selection: Selection) => void;
  range: Period;
  setRange: (range: Period) => void;
  filters: Filters;
  filter: <K extends keyof Filters>(key: K, value: Filters[K]) => void;
  broker: BrokerFilters;
  setBroker: <K extends keyof BrokerFilters>(key: K, value: BrokerFilters[K]) => void;
  brokers: Resource<BrokerDay[]>;
  brokerError: string;
  signedIn: boolean;
  signIn: () => void;
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
