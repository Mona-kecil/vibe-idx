import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@workos-inc/authkit-react';
import type { Ticker } from '../data';
import type { BrokerDay } from '../brokers';
import type { Selection } from '../ticker/logic';
import type { Period } from '../ticker/PriceChart';
import { initialPins, writeStorage } from '../watchlist';
import {
  fetchBrokers,
  fetchDetail,
  fetchTickerNews,
  type Headline,
  terminalData,
  type Resource,
  type TerminalData,
} from './sources';
import {
  TerminalContext,
  functions,
  initialFilters,
  initialBrokerFilters,
  parseLayout,
  usePublications,
  useTerminal,
  type Filters,
  type BrokerFilters,
  type FunctionId,
  type Layout,
} from './state';
import { CommandBar } from './CommandBar';
import { SplitLayout, layouts } from './Layout';
import { Empty, RiskFlags, StatusBar } from './ui';
import { PricePane } from './PricePane';
import { BrokerSummaryPane, BrokerFlowPane, ForeignFlowPane } from './BrokerPanes';
import {
  DoneDetailPane,
  IntradayPane,
  OrderBookPane,
  RunningTradePane,
  TradeBookPane,
} from './TickPanes';
import { WatchlistPane, MoversPane, SignalsPane, HeatmapPane } from './MarketPanes';
import { DescriptionPane, HoldersPane, DisclosuresPane } from './TickerPanes';
import { NewsPane, CalendarPane, ActionsPane, RiskPane } from './PublicationPanes';
import './terminal.css';

export function Terminal() {
  const [state, setState] = useState<Resource<TerminalData>>({ kind: 'loading' });
  const [attempt, retry] = useState(0);
  useEffect(() => {
    let active = true;
    document.title = 'Terminal  Vibe IDX';
    void terminalData().then(
      (data) => {
        if (active) setState({ kind: 'ready', data });
      },
      () => {
        if (active) setState({ kind: 'unavailable' });
      },
    );
    return () => {
      active = false;
      document.title = 'Vibe IDX';
    };
  }, [attempt]);
  return (
    <div className="terminal-page">
      {state.kind === 'ready' ? (
        <TerminalWorkspace data={state.data} />
      ) : (
        <Empty>
          {state.kind === 'loading' ? (
            'Loading terminal…'
          ) : (
            <>
              Terminal data unavailable{' '}
              <button
                onClick={() => {
                  setState({ kind: 'loading' });
                  retry(attempt + 1);
                }}
              >
                Retry
              </button>
            </>
          )}
        </Empty>
      )}
    </div>
  );
}
function TerminalWorkspace({ data }: { data: TerminalData }) {
  const auth = useAuth(),
    authRef = useRef(auth);
  authRef.current = auth;
  const query = new URLSearchParams(window.location.search);
  const [ticker, changeTicker] = useState(() => {
    const target = query.get('t');
    return (
      data.stocks.find((stock) => stock.ticker === target)?.ticker ??
      data.stocks.find((stock) => stock.ticker === 'BREN')?.ticker ??
      data.stocks[0]?.ticker ??
      ''
    );
  });
  const [layout, changeLayout] = useState<Layout>(() => {
    return parseLayout(query.get('l')) ?? 'grid';
  });
  const [selection, select] = useState<Selection>(null),
    [range, setRange] = useState<Period>('3M');
  const [filters, setFilters] = useState(initialFilters),
    [broker, changeBroker] = useState(initialBrokerFilters);
  const [detail, setDetail] = useState<Resource<Ticker>>({ kind: 'loading' });
  const [brokers, setBrokers] = useState<Resource<BrokerDay[]>>({ kind: 'loading' }),
    [brokerError, setBrokerError] = useState(''),
    [attempt, retry] = useState(0);
  const [tickDate, setTickDate] = useState<string | null>(null);
  const getToken = useCallback(() => authRef.current.getAccessToken(), []);
  const [flowPins, setFlowPins] = useState<string[]>([]),
    [flowHidden, setFlowHidden] = useState<string[]>([]);
  const [tickerNews, setTickerNews] = useState<Resource<Headline[]>>({ kind: 'loading' });
  useEffect(() => {
    if (filters.news !== 'TICKER') return;
    let current = true;
    setTickerNews({ kind: 'loading' });
    void fetchTickerNews(ticker).then((value) => {
      if (current) setTickerNews(value);
    });
    return () => {
      current = false;
    };
  }, [ticker, filters.news]);
  const [max, setMax] = useState<string | null>(null),
    [focused, setFocused] = useState('b');
  const [slots, setSlots] = useState<Record<Layout, Record<string, FunctionId[]>>>(() => ({
    grid: layouts.grid.slots,
    focus: layouts.focus.slots,
    flow: layouts.flow.slots,
  }));
  const [active, setActive] = useState<Record<string, FunctionId>>({});
  const publications = usePublications();
  const [pins, setPins] = useState(() =>
    initialPins().filter((pin) => data.stocks.some((stock) => stock.ticker === pin)),
  );
  useEffect(() => {
    const update = () =>
      setPins(initialPins().filter((pin) => data.stocks.some((stock) => stock.ticker === pin)));
    window.addEventListener('storage', update);
    return () => window.removeEventListener('storage', update);
  }, []);
  const togglePin = useCallback((value: string) => {
    setPins((previous) => {
      const next = previous.includes(value)
        ? previous.filter((pin) => pin !== value)
        : [...previous, value];
      writeStorage('vibe-idx:watchlist', JSON.stringify(next));
      return next;
    });
  }, []);
  const setTicker = useCallback(
    (value: string) => {
      if (data.stocks.some((stock) => stock.ticker === value)) {
        changeTicker(value);
        select(null);
      }
    },
    [data],
  );
  const setLayout = useCallback((value: Layout) => {
    changeLayout(value);
    setMax(null);
    setFocused('b');
  }, []);
  const filter = <K extends keyof Filters>(key: K, value: Filters[K]) =>
    setFilters((previous) => ({ ...previous, [key]: value }));
  const setBroker = <K extends keyof BrokerFilters>(key: K, value: BrokerFilters[K]) =>
    changeBroker((previous) => ({ ...previous, [key]: value }));
  const historyTicker = useRef(ticker);
  useEffect(() => {
    const url = new URL(window.location.href);
    const push = historyTicker.current !== ticker && url.searchParams.get('t') !== ticker;
    url.searchParams.set('t', ticker);
    url.searchParams.set('l', layout);
    if (push) window.history.pushState(null, '', url);
    else window.history.replaceState(null, '', url);
    historyTicker.current = ticker;
  }, [ticker, layout]);
  useEffect(() => {
    const pop = () => {
      const params = new URLSearchParams(window.location.search),
        value = parseLayout(params.get('l'));
      const target = params.get('t');
      if (target) setTicker(target);
      if (value) setLayout(value);
    };
    window.addEventListener('popstate', pop);
    return () => window.removeEventListener('popstate', pop);
  }, [setTicker, setLayout]);
  useEffect(() => {
    let current = true;
    setDetail({ kind: 'loading' });
    void fetchDetail(ticker).then(
      (value) => {
        if (current) setDetail(value ? { kind: 'ready', data: value } : { kind: 'unavailable' });
      },
      () => {
        if (current) setDetail({ kind: 'unavailable' });
      },
    );
    return () => {
      current = false;
    };
  }, [ticker]);
  const userId = auth.user?.id;
  const needsBrokers = Object.entries(slots[layout]).some(([slot, ids]) => {
    const id = active[`${layout}:${slot}`] ?? ids[0];
    return id === 'BRK' || id === 'BFL' || id === 'FF';
  });
  useEffect(() => {
    if (!userId || !needsBrokers) return;
    const controller = new AbortController();
    setBrokers({ kind: 'loading' });
    setBrokerError('');
    void (async () => {
      const token = await authRef.current.getAccessToken();
      if (!token) throw new Error('Your session expired. Sign in again.');
      const days = await fetchBrokers(ticker, token, controller.signal);
      if (!controller.signal.aborted) setBrokers({ kind: 'ready', data: days });
    })().catch((error) => {
      if (!controller.signal.aborted) {
        setBrokers({ kind: 'unavailable' });
        setBrokerError(error instanceof Error ? error.message : 'Broker summaries unavailable');
      }
    });
    return () => controller.abort();
  }, [ticker, userId, needsBrokers, attempt]);
  function signIn() {
    window.sessionStorage.setItem(
      'vibe-idx-return-to',
      window.location.pathname + window.location.search,
    );
    void auth.signIn().catch(() => setBrokerError('Could not sign in. Retry.'));
  }
  function openFunction(id: FunctionId, targetLayout: Layout) {
    const entries = Object.entries(slots[targetLayout]);
    const slot =
      entries.find(([, ids]) => ids.includes(id))?.[0] ??
      (slots[targetLayout][focused] ? focused : 'b');
    if (!slots[targetLayout][slot]?.includes(id))
      setSlots((previous) => ({
        ...previous,
        [targetLayout]: {
          ...previous[targetLayout],
          [slot]: [id, ...(previous[targetLayout][slot] ?? [])],
        },
      }));
    if (max && max !== slot) setMax(null);
    setActive((previous) => ({ ...previous, [`${targetLayout}:${slot}`]: id }));
    setFocused(slot);
  }
  function pane(slot: string) {
    const ids = slots[layout][slot] ?? [],
      id = active[`${layout}:${slot}`] ?? ids[0];
    if (!id) return null;
    return (
      <section
        className={`pane${slot === 'b' ? ' wide' : ''}${max === slot ? ' max' : ''}${focused === slot ? ' focus' : ''}`}
        data-slot={slot}
        aria-label={functions[id]}
        onPointerDown={() => setFocused(slot)}
      >
        <header
          className="ph"
          onDoubleClick={(event) => {
            if (!(event.target instanceof Element && event.target.closest('button,a')))
              setMax(max === slot ? null : slot);
          }}
        >
          <div className="tabs" role="tablist" aria-label={`Pane ${slot}`}>
            {ids.map((fn) => (
              <button
                key={fn}
                role="tab"
                title={functions[fn]}
                id={`tab-${layout}-${slot}-${fn}`}
                aria-controls={`panel-${layout}-${slot}`}
                aria-selected={fn === id}
                tabIndex={fn === id ? 0 : -1}
                onKeyDown={(event) => {
                  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                  event.preventDefault();
                  const tabs = Array.from(
                    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
                      '[role="tab"]',
                    ) ?? [],
                  );
                  const index = tabs.indexOf(event.currentTarget);
                  const next =
                    event.key === 'Home'
                      ? 0
                      : event.key === 'End'
                        ? tabs.length - 1
                        : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) %
                          tabs.length;
                  tabs[next]?.click();
                  tabs[next]?.focus();
                }}
                onClick={() =>
                  setActive((previous) => ({ ...previous, [`${layout}:${slot}`]: fn }))
                }
              >
                {fn}
              </button>
            ))}
          </div>
          <PaneContext id={id} />
          <button
            className="maxb"
            aria-label={max === slot ? 'Restore pane' : 'Maximize pane'}
            onClick={() => setMax(max === slot ? null : slot)}
          >
            {max === slot ? '↙' : '□'}
          </button>
        </header>
        <div
          className="pane-view"
          role="tabpanel"
          id={`panel-${layout}-${slot}`}
          aria-labelledby={`tab-${layout}-${slot}-${id}`}
          key={id}
        >
          <PaneView id={id} />
        </div>
      </section>
    );
  }
  return (
    <TerminalContext
      value={{
        data,
        ticker,
        setTicker,
        detail,
        pins,
        togglePin,
        selection,
        select,
        range,
        setRange,
        filters,
        filter,
        broker,
        setBroker,
        brokers,
        brokerError,
        session: auth.isLoading ? 'checking' : auth.user ? 'signed-in' : 'signed-out',
        signIn,
        getToken,
        tickDate,
        setTickDate,
        retryBrokers: () => retry(attempt + 1),
        publications,
        tickerNews,
        flowPins,
        setFlowPins,
        flowHidden,
        setFlowHidden,
      }}
    >
      <div className="term">
        <CommandBar
          layout={layout}
          setLayout={setLayout}
          openFunction={openFunction}
          maximize={() => setMax(null)}
        />
        <main className={`ws${max ? ' has-max' : ''}`}>
          <SplitLayout key={layout} node={layouts[layout].tree} path={layout} pane={pane} />
        </main>
        <StatusBar />
      </div>
    </TerminalContext>
  );
}
function PaneContext({ id }: { id: FunctionId }) {
  const { ticker, publications } = useTerminal();
  if (!['GP', 'KEY', 'BRK', 'BFL', 'FF', 'OB', 'RT', 'DD', 'TB', 'ID', 'HDS', 'DISC'].includes(id))
    return <span className="ctx" />;
  return (
    <div className="ctx">
      <b>{ticker}</b>
      <RiskFlags
        risk={
          publications.risks.kind === 'ready' ? publications.risks.data.risk[ticker] : undefined
        }
      />
    </div>
  );
}
function PaneView({ id }: { id: FunctionId }) {
  switch (id) {
    case 'WL':
      return <WatchlistPane />;
    case 'GP':
      return <PricePane />;
    case 'KEY':
      return <DescriptionPane />;
    case 'BRK':
      return <BrokerSummaryPane />;
    case 'BFL':
      return <BrokerFlowPane />;
    case 'FF':
      return <ForeignFlowPane />;
    case 'OB':
      return <OrderBookPane />;
    case 'RT':
      return <RunningTradePane />;
    case 'DD':
      return <DoneDetailPane />;
    case 'TB':
      return <TradeBookPane />;
    case 'ID':
      return <IntradayPane />;
    case 'HDS':
      return <HoldersPane />;
    case 'DISC':
      return <DisclosuresPane />;
    case 'SIG':
      return <SignalsPane />;
    case 'MOV':
      return <MoversPane />;
    case 'HEAT':
      return <HeatmapPane />;
    case 'NEWS':
      return <NewsPane />;
    case 'CAL':
      return <CalendarPane />;
    case 'CA':
      return <ActionsPane />;
    case 'RISK':
      return <RiskPane />;
  }
}
