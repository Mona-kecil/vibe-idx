import './styles.css';
import { useEffect, useReducer, useRef, useState, type PointerEvent } from 'react';
import { LocaleProvider, useLocale, type Locale } from './locale';
import { AccountControls, LoginPage } from './BrokerPanel';
import { load, type Stock, type Health } from './data';
import { TickerPage } from './ticker/TickerPage';
import { ModuleView } from './Modules';
import { Tooltip } from './Tooltip';
import {
  layoutKey,
  moduleSchema,
  modules,
  restoreWorkspace,
  tickerFromPath,
  workspaceReducer,
  type Panel,
} from './workspace';

const paths: Record<string, string> = {
  sidebar: 'M4 4h16v16H4zM9 4v16M14 9l-3 3 3 3',
  broker: 'M4 7h15m-4-4 4 4-4 4M20 17H5m4-4-4 4 4 4',
  market: 'M4 19h16M6 15V9m6 6V4m6 11V7',
  ownership: 'M12 3v9h9A9 9 0 1 1 12 3zM16 3.8a9 9 0 0 1 4.2 4.2H16z',
  profile: 'M5 21V3h11v18M3 21h18M9 7h3m-3 4h3m-3 4h3m5-8h3v14',
  price: 'M4 4v16h16M7 15l4-5 4 2 5-7',
  report: 'M6 3h9l4 4v14H6zM14 3v5h5M9 12h7m-7 4h7',
  news: 'M5 4h15v16H5zM2 8v12h3M8 8h8m-8 4h3v4H8zm6 0h3m-3 4h3',
  radar: 'M21 12a9 9 0 1 1-9-9v9l7-7M17 12a5 5 0 1 1-5-5',
  sources: 'M12 3 3 7l9 4 9-4zM3 12l9 4 9-4M3 17l9 4 9-4',
  link: 'm10 13 4-4M8 15l-1 1a3 3 0 0 1-4-4l4-4a3 3 0 0 1 4 0m2 1 1-1a3 3 0 0 1 4 4l-4 4a3 3 0 0 1-4 0',
  unlink:
    'm3 3 18 18M8 15l-1 1a3 3 0 0 1-4-4l2-2m8-1 1-1a3 3 0 0 1 4 4l-1 1M8 3v2m11 12h2M3 8h2m12 11v2',
  grip: 'M9 4v2m6-2v2M9 11v2m6-2v2M9 18v2m6-2v2',
  close: 'm6 6 12 12M6 18 18 6',
  more: 'M4 12h1m7 0h1m6 0h1',
  focus: 'M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5',
  plus: 'M12 5v14M5 12h14',
};
function Icon({ name }: { name: string }) {
  return (
    <svg className="ui-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d={paths[name]} />
    </svg>
  );
}
export function App({
  initialUrl,
  initialLocale,
}: { initialUrl?: string; initialLocale?: Locale } = {}) {
  return (
    <LocaleProvider initialLocale={initialLocale}>
      <AppRoute initialUrl={initialUrl} />
    </LocaleProvider>
  );
}
function AppRoute({ initialUrl }: { initialUrl?: string }) {
  const [path, setPath] = useState(
    () => initialUrl ?? (typeof window === 'undefined' ? '/' : window.location.pathname),
  );
  useEffect(() => {
    const navigate = () => setPath(window.location.pathname);
    window.addEventListener('popstate', navigate);
    return () => window.removeEventListener('popstate', navigate);
  }, []);
  const ticker = tickerFromPath(path);
  return ticker ? <TickerPage key={ticker} ticker={ticker} /> : <Workspace initialUrl={path} />;
}
function Workspace({ initialUrl }: { initialUrl?: string }) {
  const { t, locale, setLocale } = useLocale();
  const [path, setPath] = useState(
    () => initialUrl ?? (typeof window === 'undefined' ? '/' : window.location.pathname),
  );
  const [state, dispatch] = useReducer(workspaceReducer, undefined, () => {
    const navigation =
      typeof window === 'undefined' ? undefined : performance.getEntriesByType('navigation')[0];
    const reloading = Boolean(navigation && 'type' in navigation && navigation.type === 'reload');
    return restoreWorkspace(
      typeof window === 'undefined' ? null : window.localStorage.getItem(layoutKey),
      tickerFromPath(path),
      reloading,
    );
  });
  const [stocks, setStocks] = useState<Stock[]>([]);
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState(false);
  const [announcement, announce] = useState('');
  const drag = useRef<string | null>(null);
  const resize = useRef<{
    id: string;
    x: number;
    y: number;
    span: number;
    height: number;
    width: number;
  } | null>(null);
  const grid = useRef<HTMLDivElement>(null);
  useEffect(() => {
    window.localStorage.setItem(layoutKey, JSON.stringify(state));
  }, [state]);
  useEffect(() => {
    let active = true;
    void Promise.all([load('tickers.json'), load('health.json')]).then(
      ([rows, dates]) => {
        if (active) {
          setStocks(rows);
          setHealth(dates);
        }
      },
      () => {
        if (active) setError(true);
      },
    );
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    const navigate = () => {
      setPath(window.location.pathname);
      const ticker = tickerFromPath(window.location.pathname);
      if (ticker) {
        const panel = state.panels.find((panel) => modules[panel.type].ticker);
        if (panel) dispatch({ type: 'ticker', id: panel.id, ticker });
        else dispatch({ type: 'add', module: 'price', ticker });
      }
    };
    window.addEventListener('popstate', navigate);
    return () => window.removeEventListener('popstate', navigate);
  }, [state.panels]);
  function beginResize(event: PointerEvent<HTMLButtonElement>, panel: Panel) {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    resize.current = {
      id: panel.id,
      x: event.clientX,
      y: event.clientY,
      span: panel.span,
      height: panel.height,
      width: grid.current?.clientWidth ?? 1,
    };
  }
  const visible = state.focusId
    ? state.panels.filter((panel) => panel.id === state.focusId)
    : state.panels;
  return (
    <>
      <main className={`desk ${state.collapsed ? 'collapsed' : ''}`}>
        <aside className="desk-sidebar" aria-label={t('Module picker')}>
          <div className="rail-top">
            <span className="rail-brand">Vibe IDX</span>
            <button
              className="icon-button"
              onClick={() => dispatch({ type: 'sidebar' })}
              aria-label={t(state.collapsed ? 'Expand module sidebar' : 'Collapse module sidebar')}
              aria-expanded={!state.collapsed}
            >
              <Icon name="sidebar" />
            </button>
          </div>
          <p className="rail-label">{t('Add a module')}</p>
          <nav className="module-picker">
            {Object.entries(modules).map(([type, module]) => (
              <button
                key={type}
                className="module-add"
                aria-label={`${t('Add')} ${t(module.name)} ${t('module')}`}
                title={`${t('Add')} ${t(module.name)}`}
                onClick={() => {
                  dispatch({ type: 'add', module: moduleSchema.parse(type) });
                  announce(`${t(module.name)} ${t('added')}`);
                }}
              >
                <Icon name={module.icon} />
                <span className="module-name">{t(module.name)}</span>
                {state.panels.some((panel) => panel.type === type) && (
                  <span className="module-count">
                    {state.panels.filter((panel) => panel.type === type).length}
                  </span>
                )}
              </button>
            ))}
          </nav>
        </aside>
        <section className="desk-main">
          <header className="desk-header">
            <h1>{t('Your workspace.')}</h1>
            <div className="workspace-tools">
              <label>
                <span className="visually-hidden">Language / Bahasa</span>
                <select
                  value={locale}
                  onChange={(event) => setLocale(event.target.value === 'id' ? 'id' : 'en')}
                >
                  <option value="en">English</option>
                  <option value="id">Bahasa Indonesia</option>
                </select>
              </label>
              <button
                className="link-toggle"
                onClick={() => dispatch({ type: 'link' })}
                aria-pressed={state.linked}
                title={t(
                  'Linking adopts the active panel ticker. Dates and controls stay independent.',
                )}
              >
                <Icon name={state.linked ? 'link' : 'unlink'} />
                <span>{t(state.linked ? 'Tickers linked' : 'Independent tickers')}</span>
              </button>
            </div>
          </header>
          <div className="desk-status">
            {health && (
              <>
                <span>
                  {t('Prices')} <strong>{health.prices ?? t('Not reported')}</strong>
                </span>
                <span>
                  {t('5% ownership')} <strong>{health.five_pct ?? t('Not reported')}</strong>
                </span>
                <span>
                  {t('1% ownership')} <strong>{health.one_pct ?? t('Not reported')}</strong>
                </span>
              </>
            )}
            {error && <p role="alert">{t('Could not load data. Reload to try again.')}</p>}
          </div>
          {path === '/login' ? (
            <LoginPage />
          ) : path === '/callback' ? (
            <p role="status">{t('Signing you in…')}</p>
          ) : (
            <div ref={grid} className={`panel-grid ${state.focusId ? 'focused' : ''}`}>
              {visible.map((panel) => {
                const module = modules[panel.type];
                const index = state.panels.indexOf(panel);
                return (
                  <article
                    key={panel.id}
                    data-panel-id={panel.id}
                    className={`module-panel ${state.activeId === panel.id ? 'active' : ''}`}
                    aria-label={`${t(module.name)} ${t('panel')}`}
                    style={{ gridColumn: `span ${panel.span}`, height: panel.height }}
                    onFocus={() => dispatch({ type: 'active', id: panel.id })}
                    onPointerDown={() => dispatch({ type: 'active', id: panel.id })}
                    onDragOver={(event) => {
                      if (drag.current && drag.current !== panel.id) {
                        event.preventDefault();
                        event.currentTarget.classList.add('drop-target');
                      }
                    }}
                    onDragLeave={(event) => event.currentTarget.classList.remove('drop-target')}
                    onDrop={(event) => {
                      event.preventDefault();
                      event.currentTarget.classList.remove('drop-target');
                      if (drag.current)
                        dispatch({ type: 'move', id: drag.current, before: panel.id });
                      drag.current = null;
                      announce(t('Panel moved.'));
                    }}
                  >
                    <header className="panel-head">
                      <button
                        className="icon-button panel-grip"
                        draggable
                        aria-label={`${t('Drag')} ${t(module.name)} ${t('panel')}`}
                        onDragStart={(event) => {
                          drag.current = panel.id;
                          event.dataTransfer.effectAllowed = 'move';
                          event.dataTransfer.setData('text/plain', panel.id);
                        }}
                        onDragEnd={() => {
                          drag.current = null;
                          grid.current
                            ?.querySelectorAll('.drop-target')
                            .forEach((el) => el.classList.remove('drop-target'));
                        }}
                      >
                        <Icon name="grip" />
                      </button>
                      <Icon name={module.icon} />
                      <h2>{t(module.name)}</h2>
                      {module.ticker && (
                        <select
                          className="panel-ticker"
                          value={panel.state.ticker}
                          aria-label={`${t(module.name)} ${t('ticker')}`}
                          onChange={(event) =>
                            dispatch({ type: 'ticker', id: panel.id, ticker: event.target.value })
                          }
                        >
                          {!stocks.some((stock) => stock.ticker === panel.state.ticker) && (
                            <option>{panel.state.ticker}</option>
                          )}
                          {stocks.map((stock) => (
                            <option key={stock.ticker} value={stock.ticker}>
                              {stock.ticker}
                            </option>
                          ))}
                        </select>
                      )}
                      <div className="panel-tools">
                        <button
                          className="icon-button"
                          aria-label={
                            t(state.focusId === panel.id ? 'Show all panels' : 'Focus') +
                            ' ' +
                            t(module.name)
                          }
                          onClick={() => dispatch({ type: 'focus', id: panel.id })}
                        >
                          <Icon name="focus" />
                        </button>
                        <details className="panel-menu">
                          <summary
                            className="icon-button"
                            aria-label={`${t(module.name)} ${t('panel actions')}`}
                          >
                            <Icon name="more" />
                          </summary>
                          <div
                            className="panel-menu-list"
                            onClick={(event) => {
                              if (event.target instanceof HTMLButtonElement)
                                event.currentTarget.closest('details')?.removeAttribute('open');
                            }}
                          >
                            <button onClick={() => dispatch({ type: 'duplicate', id: panel.id })}>
                              {t('Duplicate')}
                            </button>
                            <button
                              disabled={index === 0}
                              onClick={() =>
                                dispatch({
                                  type: 'move',
                                  id: panel.id,
                                  before: state.panels[index - 1]?.id ?? null,
                                })
                              }
                            >
                              {t('Move earlier')}
                            </button>
                            <button
                              disabled={index === state.panels.length - 1}
                              onClick={() =>
                                dispatch({
                                  type: 'move',
                                  id: panel.id,
                                  before: state.panels[index + 2]?.id ?? null,
                                })
                              }
                            >
                              {t('Move later')}
                            </button>
                            <hr />
                            {[
                              [4, 'One-third width'],
                              [6, 'Half width'],
                              [12, 'Full width'],
                            ].map(([span, label]) => (
                              <button
                                key={span}
                                onClick={() =>
                                  dispatch({
                                    type: 'resize',
                                    id: panel.id,
                                    span: Number(span),
                                    height: panel.height,
                                  })
                                }
                              >
                                {t(String(label))}
                              </button>
                            ))}
                            <hr />
                            <button
                              onClick={() =>
                                dispatch({
                                  type: 'resize',
                                  id: panel.id,
                                  span: panel.span,
                                  height: 360,
                                })
                              }
                            >
                              {t('Compact height')}
                            </button>
                            <button
                              onClick={() =>
                                dispatch({
                                  type: 'resize',
                                  id: panel.id,
                                  span: panel.span,
                                  height: 680,
                                })
                              }
                            >
                              {t('Tall height')}
                            </button>
                          </div>
                        </details>
                        <button
                          className="icon-button"
                          aria-label={`${t('Remove')} ${t(module.name)} ${t('panel')}`}
                          onClick={() => dispatch({ type: 'remove', id: panel.id })}
                        >
                          <Icon name="close" />
                        </button>
                      </div>
                    </header>
                    <div className="panel-body">
                      <ModuleView
                        panel={panel}
                        stocks={stocks}
                        health={health}
                        update={(patch) => dispatch({ type: 'controls', id: panel.id, patch })}
                        selectTicker={(ticker) => {
                          const target = module.ticker
                            ? panel
                            : (state.panels.find(
                                (candidate) =>
                                  candidate.id === state.activeId && modules[candidate.type].ticker,
                              ) ??
                              state.panels.find((candidate) => modules[candidate.type].ticker));
                          if (target) dispatch({ type: 'ticker', id: target.id, ticker });
                          else dispatch({ type: 'add', module: 'price', ticker });
                        }}
                      />
                    </div>
                    <button
                      className="panel-resize"
                      aria-label={`${t('Resize')} ${t(module.name)} ${t('panel')}`}
                      title={t('Drag to resize. Arrow keys also resize.')}
                      onPointerDown={(event) => beginResize(event, panel)}
                      onPointerMove={(event) => {
                        const op = resize.current;
                        if (!op || op.id !== panel.id) return;
                        dispatch({
                          type: 'resize',
                          id: panel.id,
                          height: op.height + event.clientY - op.y,
                          span:
                            window.innerWidth > 1000 && !state.focusId
                              ? Math.round(op.span + (event.clientX - op.x) / (op.width / 12))
                              : op.span,
                        });
                      }}
                      onPointerUp={() => {
                        resize.current = null;
                        announce(t('Panel resized.'));
                      }}
                      onPointerCancel={() => {
                        resize.current = null;
                      }}
                      onKeyDown={(event) => {
                        if (
                          !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)
                        )
                          return;
                        event.preventDefault();
                        dispatch({
                          type: 'resize',
                          id: panel.id,
                          span:
                            panel.span +
                            (event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0),
                          height:
                            panel.height +
                            (event.key === 'ArrowDown' ? 40 : event.key === 'ArrowUp' ? -40 : 0),
                        });
                      }}
                    />
                  </article>
                );
              })}
              {!state.panels.length && (
                <div className="workspace-empty">
                  <Icon name="plus" />
                  <h2>{t('Add a module')}</h2>
                  <button
                    className="small-button"
                    onClick={() => dispatch({ type: 'add', module: 'market' })}
                  >
                    {t('Market summary')}
                  </button>
                </div>
              )}
            </div>
          )}
          <footer className="desk-footer">
            <span>Vibe IDX</span>
            <div className="account-controls">
              <AccountControls />
            </div>
          </footer>
        </section>
      </main>
      <div className="visually-hidden" role="status" aria-live="polite">
        {announcement}
      </div>
      <Tooltip />
    </>
  );
}
