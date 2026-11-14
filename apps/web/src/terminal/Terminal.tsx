import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@workos-inc/authkit-react';
import type { Ticker } from '../data';
import type { BrokerDay } from '../brokers';
import type { Selection } from '../ticker/logic';
import type { BlockRef } from '../ticks';
import { initialPins, readStorage, writeStorage } from '../watchlist.js';
import {
  fetchDetail,
  fetchTickerNews,
  type NewsArticle,
  terminalData,
  type Resource,
  type TerminalData,
} from './sources.js';
import {
  TerminalContext,
  functions,
  initialFilters,
  initialBrokerFilters,
  signedInOnly,
  usePublications,
  type Filters,
  type BrokerFilters,
  type FunctionId,
  type Timeframe,
} from './state.js';
import { clearBrokerHistory, loadBrokerHistory } from './broker-history.js';
import { CommandBar } from './CommandBar.js';
import { SplitLayout, layout, layoutPath } from './Layout.js';
import { Empty, Lock, StatusBar } from './ui.js';
import { PricePane } from './PricePane.js';
import { BrokerSummaryPane, BrokerFlowPane, ForeignFlowPane } from './BrokerPanes.js';
import { BrokerDistributionPane } from './DistributionPane.js';
import { DoneDetailPane, OrderBookPane, RunningTradePane, TradeBookPane } from './TickPanes.js';
import { WatchlistPane, MoversPane, SignalsPane, HeatmapPane } from './MarketPanes.js';
import { KeyFiguresPane, HoldersAndChangesPane, DisclosuresPane } from './TickerPanes.js';
import { CompanyFeedPane } from './CompanyFeedPane.js';
import { NewsPane, CalendarPane, CorpActionsPane, RiskPane } from './PublicationPanes.js';
import { TerminalSkeleton } from './TerminalSkeleton.js';
import './terminal.css';

export function Terminal() {
  const [state, setState] = useState<Resource<TerminalData>>({
    kind: 'loading',
  });
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
        <LoadedTerminal data={state.data} />
      ) : state.kind === 'loading' ? (
        <TerminalSkeleton />
      ) : (
        <Empty>
          Terminal data unavailable{' '}
          <button
            onClick={() => {
              setState({ kind: 'loading' });
              retry(attempt + 1);
            }}
          >
            Retry
          </button>
        </Empty>
      )}
    </div>
  );
}
function LoadedTerminal({ data }: { data: TerminalData }) {
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
  const [selection, select] = useState<Selection>(null),
    [timeframe, setTimeframe] = useState<Timeframe>('D');
  const [filters, setFilters] = useState(initialFilters),
    [broker, changeBroker] = useState(initialBrokerFilters);
  const [detail, setDetail] = useState<Resource<Ticker>>({ kind: 'loading' });
  const [brokers, setBrokers] = useState<Resource<BrokerDay[]>>({
      kind: 'loading',
    }),
    [brokerError, setBrokerError] = useState(''),
    [attempt, retry] = useState(0);
  const [tickDate, changeTickDate] = useState<string | null>(null);
  const [pickedBlock, setPickedBlock] = useState<BlockRef | null>(null);
  function setTickDate(date: string | null) {
    if (date !== tickDate) setPickedBlock(null);
    changeTickDate(date);
  }
  useEffect(() => {
    if (!pickedBlock) return;
    const clear = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPickedBlock(null);
    };
    window.addEventListener('keydown', clear);
    return () => window.removeEventListener('keydown', clear);
  }, [pickedBlock]);
  const getToken = useCallback(() => authRef.current.getAccessToken(), []);
  const [flowPins, setFlowPins] = useState<string[]>([]),
    [flowHidden, setFlowHidden] = useState<string[]>([]);
  const [tickerNews, setTickerNews] = useState<Resource<NewsArticle[]>>({
    kind: 'loading',
  });
  useEffect(() => {
    let current = true;
    setTickerNews({ kind: 'loading' });
    void fetchTickerNews(ticker).then((value) => {
      if (current) setTickerNews(value);
    });
    return () => {
      current = false;
    };
  }, [ticker]);
  const [max, setMax] = useState<string | null>(null),
    [focused, setFocused] = useState('b');
  const [slots, setSlots] = useState(layout.slots);
  const [active, setActiveState] = useState<Record<string, FunctionId[]>>(() => {
    try {
      return JSON.parse(readStorage('terminal:shown') ?? '{}') as Record<string, FunctionId[]>;
    } catch {
      return {};
    }
  });
  const setActive = (
    update: (previous: Record<string, FunctionId[]>) => Record<string, FunctionId[]>,
  ) =>
    setActiveState((previous) => {
      const next = update(previous);
      writeStorage('terminal:shown', JSON.stringify(next));
      return next;
    });
  const shownIn = (slot: string, state = active, ids = slots[slot] ?? []): FunctionId[] => {
    const picked = (state[slot] ?? []).filter((id) => ids.includes(id));
    return picked.length ? picked : ids.slice(0, 1);
  };
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
        if (value !== ticker) setPickedBlock(null);
      }
    },
    [data, ticker],
  );
  function openTicker(value: string) {
    setTicker(value);
    // Picking a ticker while the heatmap covers the chart brings the chart back.
    const chart = Object.keys(slots).find((slot) => slots[slot]?.includes('GP'));
    if (chart && shownIn(chart).includes('HEAT') && !shownIn(chart).includes('GP'))
      openFunction('GP');
  }
  const filter = <K extends keyof Filters>(key: K, value: Filters[K]) =>
    setFilters((previous) => ({ ...previous, [key]: value }));
  const setBroker = <K extends keyof BrokerFilters>(key: K, value: BrokerFilters[K]) =>
    changeBroker((previous) => ({ ...previous, [key]: value }));
  const historyTicker = useRef(ticker);
  useEffect(() => {
    const url = new URL(window.location.href);
    const push = historyTicker.current !== ticker && url.searchParams.get('t') !== ticker;
    url.searchParams.set('t', ticker);
    if (push) window.history.pushState(null, '', url);
    else window.history.replaceState(null, '', url);
    historyTicker.current = ticker;
  }, [ticker]);
  useEffect(() => {
    const pop = () => {
      const target = new URLSearchParams(window.location.search).get('t');
      if (target) setTicker(target);
    };
    window.addEventListener('popstate', pop);
    return () => window.removeEventListener('popstate', pop);
  }, [setTicker]);
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
  const needsBrokers = Object.keys(slots).some((slot) =>
    shownIn(slot).some((id) => id === 'BRK' || id === 'BFL' || id === 'BD' || id === 'FF'),
  );
  useEffect(() => {
    if (!userId) {
      clearBrokerHistory();
      return;
    }
    if (!needsBrokers) return;
    let current = true;
    setBrokers({ kind: 'loading' });
    setBrokerError('');
    loadBrokerHistory(ticker, getToken).then(
      (days) => {
        if (current) setBrokers({ kind: 'ready', data: days });
      },
      (error: unknown) => {
        if (current) {
          setBrokers({ kind: 'unavailable' });
          setBrokerError(error instanceof Error ? error.message : 'Broker summaries unavailable');
        }
      },
    );
    return () => {
      current = false;
    };
  }, [ticker, userId, needsBrokers, attempt, getToken]);
  function signIn() {
    window.sessionStorage.setItem(
      'vibe-idx-return-to',
      window.location.pathname + window.location.search,
    );
    void auth.signIn().catch(() => setBrokerError('Could not sign in. Retry.'));
  }
  function openFunction(id: FunctionId) {
    const slot =
      Object.entries(slots).find(([, ids]) => ids.includes(id))?.[0] ??
      (slots[focused] ? focused : 'b');
    if (!slots[slot]?.includes(id))
      setSlots((previous) => ({ ...previous, [slot]: [id, ...(previous[slot] ?? [])] }));
    if (max && max !== slot) setMax(null);
    setActive((previous) =>
      shownIn(slot, previous, [...(slots[slot] ?? []), id]).includes(id)
        ? previous
        : { ...previous, [slot]: [id] },
    );
    setFocused(slot);
  }
  function pickBlock(block: BlockRef | null) {
    setPickedBlock(block);
    if (!block) return;
    openFunction('RT');
  }
  const locked = (fn: FunctionId) => !auth.isLoading && !auth.user && signedInOnly.has(fn);
  function pane(slot: string) {
    const ids = slots[slot] ?? [],
      shown = shownIn(slot),
      id = shown[0];
    if (!id) return null;
    function pick(fn: FunctionId, add: boolean) {
      setActive((previous) => {
        const current = shownIn(slot, previous);
        const next = !add
          ? [fn]
          : current.includes(fn)
            ? current.length > 1
              ? current.filter((x) => x !== fn)
              : current
            : ids.filter((x) => x === fn || current.includes(x));
        return { ...previous, [slot]: next };
      });
    }
    return (
      <section
        className={`pane${slot === 'b' ? ' wide' : ''}${max === slot ? ' max' : ''}${focused === slot ? ' focus' : ''}`}
        data-slot={slot}
        aria-label={shown.map((fn) => functions[fn]).join(' and ')}
        onPointerDown={() => setFocused(slot)}
      >
        <header
          className="ph"
          onDoubleClick={(event) => {
            if (!(event.target instanceof Element && event.target.closest('button,a')))
              setMax(max === slot ? null : slot);
          }}
        >
          <div
            className="tabs"
            role="tablist"
            aria-label={`Pane ${slot}`}
            aria-multiselectable="true"
          >
            {ids.map((fn) => (
              <button
                key={fn}
                role="tab"
                title="Shift-click to show beside"
                id={`tab-${slot}-${fn}`}
                aria-controls={`panel-${slot}-${fn}`}
                aria-selected={shown.includes(fn)}
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
                onClick={(event) => pick(fn, event.shiftKey)}
                data-locked={locked(fn) || undefined}
                aria-description={locked(fn) ? 'Needs sign-in' : undefined}
              >
                {locked(fn) && <Lock />}
                {functions[fn]}
              </button>
            ))}
          </div>
          <button
            className="maxb"
            aria-label={max === slot ? 'Restore pane' : 'Maximize pane'}
            onClick={() => setMax(max === slot ? null : slot)}
          >
            {max === slot ? '↙' : '□'}
          </button>
        </header>
        <div className={`pane-views${shown.length > 1 ? ' multi' : ''}`}>
          {shown.map((fn) => (
            <div
              key={fn}
              className="pane-view"
              role="tabpanel"
              id={`panel-${slot}-${fn}`}
              aria-labelledby={`tab-${slot}-${fn}`}
            >
              {shown.length > 1 && <div className="pane-view-code">{functions[fn]}</div>}
              <PaneView id={fn} />
            </div>
          ))}
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
        openTicker,
        detail,
        pins,
        togglePin,
        selection,
        select,
        timeframe,
        setTimeframe,
        filters,
        filter,
        broker,
        setBroker,
        brokers,
        brokerError,
        authState: auth.isLoading ? 'checking' : auth.user ? 'signed-in' : 'signed-out',
        signIn,
        getToken,
        tickDate,
        setTickDate,
        pickedBlock,
        pickBlock,
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
        <CommandBar openFunction={openFunction} maximize={() => setMax(null)} />
        <main className={`layout${max ? ' has-max' : ''}`}>
          <SplitLayout node={layout.tree} path={layoutPath} pane={pane} />
        </main>
        <StatusBar />
      </div>
    </TerminalContext>
  );
}
function PaneView({ id }: { id: FunctionId }) {
  switch (id) {
    case 'WL':
      return <WatchlistPane />;
    case 'GP':
      return <PricePane />;
    case 'KEY':
      return <KeyFiguresPane />;
    case 'BRK':
      return <BrokerSummaryPane />;
    case 'BFL':
      return <BrokerFlowPane />;
    case 'BD':
      return <BrokerDistributionPane />;
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
    case 'HDS':
      return <HoldersAndChangesPane />;
    case 'DISC':
      return <DisclosuresPane />;
    case 'FEED':
      return <CompanyFeedPane />;
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
      return <CorpActionsPane />;
    case 'RISK':
      return <RiskPane />;
  }
}
