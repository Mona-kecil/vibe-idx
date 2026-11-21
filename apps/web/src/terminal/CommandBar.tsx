import { useEffect, useRef, useState } from 'react';
import { functions, isFunction, signedInOnly, type FunctionId, useTerminal } from './state.js';
import type { Stock } from '../data';
import { PinIcon } from '../PinIcon.js';
import { Lock, RiskFlags } from './ui.js';
import './command.css';

export function commandSuggestions(
  stocks: readonly Pick<Stock, 'ticker' | 'name' | 'value'>[],
  query: string,
) {
  if (!query) return [];
  const rank = (item: { code: string; label: string }) =>
    item.code === query
      ? 0
      : item.code.startsWith(query)
        ? 1
        : query.length >= 3 &&
            item.label
              .toUpperCase()
              .split(/\s+/)
              .some((word) => word.startsWith(query))
          ? 2
          : 3;
  return [
    ...Object.entries(functions).map(([code, label]) => ({ code, label })),
    ...['HELP'].map((code) => ({ code, label: '' })),
    { code: 'PIN', label: 'Pin or unpin ticker' },
    ...[...stocks]
      .sort((a, b) => b.value - a.value)
      .map((stock) => ({ code: stock.ticker, label: stock.name })),
  ]
    .filter((item) => rank(item) < 3)
    .sort((a, b) => rank(a) - rank(b))
    .slice(0, 8);
}

export function CommandBar({
  openFunction,
  maximize,
}: {
  openFunction: (id: FunctionId) => void;
  maximize: () => void;
}) {
  const {
    data,
    setTicker,
    openTicker,
    pins,
    togglePin,
    ticker,
    select,
    selection,
    filter,
    authState,
  } = useTerminal();
  const input = useRef<HTMLInputElement>(null);
  const helpButton = useRef<HTMLButtonElement>(null);
  const [text, setText] = useState(''),
    [active, setActive] = useState(0),
    [focused, setFocused] = useState(false),
    [help, setHelp] = useState(false),
    [error, setError] = useState('');
  const last = text.trim().toUpperCase().split(/\s+/).at(-1) ?? '';
  const suggestions = commandSuggestions(data.stocks, last);
  const stockCodes = new Set(data.stocks.map((stock) => stock.ticker));
  function run(command: string) {
    setError('');
    const tokens = command.toUpperCase().trim().split(/\s+/);
    if (
      tokens.includes('NEWS') &&
      tokens.some((token) => data.stocks.some((stock) => stock.ticker === token))
    )
      filter('news', 'TICKER');
    const named = tokens.filter((token) => data.stocks.some((stock) => stock.ticker === token));
    if (tokens.includes('PIN')) for (const code of named.length ? named : [ticker]) togglePin(code);
    let targetFunction: FunctionId | null = null;
    for (const token of tokens) {
      if (named.includes(token)) (tokens.includes('PIN') ? setTicker : openTicker)(token);
      else if (isFunction(token)) targetFunction = token;
      else if (token === 'HELP' || token === '?') setHelp(true);
      else if (token === 'PIN') continue;
      else if (token) setError(`Unknown command: ${token}`);
    }
    if (targetFunction) openFunction(targetFunction);
    setText('');
    setActive(0);
  }
  function complete(code: string) {
    const tokens = text.trim().split(/\s+/);
    tokens[tokens.length - 1] = code;
    return tokens.join(' ');
  }
  function move(step: number) {
    if (!pins.length) return;
    const index = pins.indexOf(ticker);
    const next = pins[(index + step + pins.length) % pins.length];
    if (next) setTicker(next);
  }
  function dismiss() {
    setHelp(false);
    if (selection) select(null);
    else maximize();
  }
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (help) {
        if (event.key === 'Escape') setHelp(false);
        return;
      }
      if (
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        (event.target instanceof Element && event.target.closest('input,textarea,select'))
      )
        return;
      if (event.key === 'Escape') {
        dismiss();
        return;
      }
      if (event.key === '?') {
        setHelp((value) => !value);
        return;
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        move(event.key === 'ArrowDown' ? 1 : -1);
        return;
      }
      if (event.key === '/') {
        event.preventDefault();
        input.current?.focus();
        return;
      }
      if (/^[a-z]$/i.test(event.key)) {
        event.preventDefault();
        input.current?.focus();
        setText(event.key);
      }
    };
    document.addEventListener('keydown', keydown);
    return () => document.removeEventListener('keydown', keydown);
  });
  return (
    <>
      <header className="cmd">
        <a className="home-link" href="/" aria-label="Home">
          HOME
        </a>
        <TickerTitle />
        <span className="caret" aria-hidden="true">
          &gt;
        </span>
        <input
          ref={input}
          aria-label="Command"
          autoComplete="off"
          spellCheck={false}
          placeholder="Type a ticker or function"
          value={text}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onChange={(event) => {
            setText(event.target.value);
            setActive(0);
          }}
          role="combobox"
          aria-controls="terminal-suggestions"
          aria-expanded={focused && suggestions.length > 0}
          aria-activedescendant={
            focused && suggestions[active] ? `suggestion-${active}` : undefined
          }
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              if (suggestions.length)
                setActive(
                  (active + (event.key === 'ArrowDown' ? 1 : -1) + suggestions.length) %
                    suggestions.length,
                );
              else move(event.key === 'ArrowDown' ? 1 : -1);
            } else if (event.key === 'Tab' && suggestions[active]) {
              event.preventDefault();
              setText(complete(suggestions[active].code) + ' ');
            } else if (event.key === 'Enter') {
              event.preventDefault();
              run(suggestions[active] ? complete(suggestions[active].code) : text);
            } else if (event.key === 'Escape') {
              setText('');
              setError('');
              dismiss();
            }
          }}
        />
        <div
          id="terminal-suggestions"
          className={`ac${focused && suggestions.length ? ' open' : ''}`}
          role="listbox"
        >
          {suggestions.map((item, index) => (
            <div
              key={item.code}
              id={`suggestion-${index}`}
              role="option"
              aria-selected={index === active}
              className={index === active ? 'on' : ''}
              onMouseDown={(event) => {
                event.preventDefault();
                run(complete(item.code));
              }}
            >
              {isFunction(item.code) ? (
                <b
                  className="ac-function"
                  data-locked={
                    (authState === 'signed-out' && signedInOnly.has(item.code)) || undefined
                  }
                >
                  {authState === 'signed-out' && signedInOnly.has(item.code) && <Lock />}
                  {item.label}
                </b>
              ) : (
                <>
                  <b>{item.code}</b>
                  <span>{item.label}</span>
                </>
              )}
              {stockCodes.has(item.code) && (
                <button
                  className="pin-button"
                  tabIndex={-1}
                  aria-label={`${pins.includes(item.code) ? 'Unpin' : 'Pin'} ${item.code}`}
                  aria-pressed={pins.includes(item.code)}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    togglePin(item.code);
                  }}
                >
                  <PinIcon />
                </button>
              )}
            </div>
          ))}
        </div>
        <button
          ref={helpButton}
          className="helpbtn"
          aria-label="Keyboard reference"
          onClick={() => setHelp(!help)}
        >
          ?
        </button>
      </header>
      {error && (
        <div role="alert" className="command-error">
          {error}
          <button aria-label="Dismiss command error" onClick={() => setError('')}>
            ×
          </button>
        </div>
      )}
      {help && (
        <div
          className="help"
          role="dialog"
          aria-modal="true"
          aria-label="Keyboard reference"
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.stopPropagation();
              setHelp(false);
              helpButton.current?.focus();
            }
            if (event.key === 'Tab') {
              const targets = Array.from(
                event.currentTarget.querySelectorAll<HTMLElement>('button,a[href]'),
              );
              const first = targets[0],
                last = targets.at(-1);
              if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last?.focus();
              } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first?.focus();
              }
            }
          }}
        >
          <div>
            <button
              className="close-help"
              autoFocus
              aria-label="Close keyboard reference"
              onClick={() => {
                setHelp(false);
                helpButton.current?.focus();
              }}
            >
              ×
            </button>
            <div className="help-content">
              <div className="help-reference">
                <section aria-labelledby="terminal-help-keys">
                  <h2 id="terminal-help-keys">KEYS</h2>
                  <dl>
                    <dt>A to Z</dt>
                    <dd>Start a command</dd>
                    <dt>/</dt>
                    <dd>Focus command line</dd>
                    <dt>Enter</dt>
                    <dd>Run ticker or function, e.g. BREN BRK</dd>
                    <dt>PIN</dt>
                    <dd>Pin or unpin a ticker, e.g. BREN PIN</dd>
                    <dt>Tab</dt>
                    <dd>Complete suggestion</dd>
                    <dt>Up Down</dt>
                    <dd>Move through suggestions or watchlist</dd>
                    <dt>Esc</dt>
                    <dd>Clear selection or restore pane</dd>
                    <dt>Drag borders</dt>
                    <dd>Resize panes. Double-click to reset.</dd>
                    <dt>Double-click header</dt>
                    <dd>Maximize pane</dd>
                    <dt>Shift-drag chart</dt>
                    <dd>
                      Select dates for broker and ownership panes. Drag the date axis also selects.
                    </dd>
                  </dl>
                </section>
                <section aria-labelledby="terminal-help-functions">
                  <h2 id="terminal-help-functions">FUNCTIONS</h2>
                  <dl>
                    {Object.entries(functions).map(([code, name]) => (
                      <div key={code}>
                        <dt>{code}</dt>
                        <dd>{name}</dd>
                      </div>
                    ))}
                  </dl>
                </section>
              </div>
              <a href="https://www.tradingview.com/" target="_blank" rel="noreferrer">
                TradingView Lightweight Charts™ Copyright (с) 2025 TradingView, Inc.
              </a>
              <a href="/licenses/lightweight-charts.txt" target="_blank" rel="noreferrer">
                Apache-2.0 license
              </a>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/** The one place the Terminal names its ticker; every ticker pane follows it. */
function TickerTitle() {
  const { data, ticker, publications } = useTerminal();
  const name = data.stocks.find((stock) => stock.ticker === ticker)?.name;
  return (
    <div className="ticker-title">
      <b>{ticker}</b>
      {name && <span title={name}>{name}</span>}
      <RiskFlags
        risk={
          publications.risks.kind === 'ready' ? publications.risks.data.risk[ticker] : undefined
        }
      />
    </div>
  );
}
