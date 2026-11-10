import { useEffect, useRef, useState } from 'react';
import {
  functions,
  isFunction,
  isLayout,
  type FunctionId,
  type Layout,
  useTerminal,
} from './state';
import './command.css';

export function CommandBar({
  layout,
  setLayout,
  openFunction,
  maximize,
}: {
  layout: Layout;
  setLayout: (layout: Layout) => void;
  openFunction: (id: FunctionId, layout: Layout) => void;
  maximize: () => void;
}) {
  const { data, setTicker, pins, ticker, select, selection, filter } = useTerminal();
  const input = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(''),
    [active, setActive] = useState(0),
    [focused, setFocused] = useState(false),
    [help, setHelp] = useState(false),
    [error, setError] = useState('');
  const last = text.trim().toUpperCase().split(/\s+/).at(-1) ?? '';
  const suggestions = last
    ? [
        ...Object.entries(functions).map(([code, label]) => ({ code, label })),
        ...['GRID', 'FOCUS', 'FLOW', 'HELP'].map((code) => ({ code, label: '' })),
        ...[...data.stocks]
          .sort((a, b) => b.value - a.value)
          .map((stock) => ({ code: stock.ticker, label: stock.name })),
      ]
        .filter(
          (item) =>
            item.code.startsWith(last) ||
            (last.length >= 3 &&
              item.label
                .toUpperCase()
                .split(/\s+/)
                .some((word) => word.startsWith(last))),
        )
        .slice(0, 8)
    : [];
  function run(command: string) {
    setError('');
    const tokens = command.toUpperCase().trim().split(/\s+/);
    if (
      tokens.includes('NEWS') &&
      tokens.some((token) => data.stocks.some((stock) => stock.ticker === token))
    )
      filter('news', 'TICKER');
    let targetLayout = layout;
    let targetFunction: FunctionId | null = null;
    for (const token of tokens) {
      if (data.stocks.some((stock) => stock.ticker === token)) setTicker(token);
      else if (isFunction(token)) targetFunction = token;
      else if (isLayout(token.toLowerCase())) {
        const next = token.toLowerCase();
        if (isLayout(next)) {
          targetLayout = next;
          setLayout(next);
        }
      } else if (token === 'HELP' || token === '?') setHelp(true);
      else if (token) setError(`Unknown command: ${token}`);
    }
    if (targetFunction) openFunction(targetFunction, targetLayout);
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
    else if (document.querySelector('.reader'))
      document.querySelector<HTMLButtonElement>('[aria-label="Close reader"]')?.click();
    else maximize();
  }
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
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
      const next =
        event.key === '1'
          ? 'grid'
          : event.key === '2'
            ? 'focus'
            : event.key === '3'
              ? 'flow'
              : null;
      if (isLayout(next)) {
        setLayout(next);
        return;
      }
      if (event.key === '?') {
        setHelp((value) => !value);
        return;
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const reader = document.querySelector<HTMLButtonElement>(
          `[aria-label="${event.key === 'ArrowDown' ? 'Next' : 'Previous'} article"]`,
        );
        if (reader) reader.click();
        else move(event.key === 'ArrowDown' ? 1 : -1);
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
        <span className="prompt" aria-hidden="true">
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
            } else if (!text && ['1', '2', '3'].includes(event.key)) {
              const next = ['grid', 'focus', 'flow'][Number(event.key) - 1];
              if (next && isLayout(next)) {
                event.preventDefault();
                setLayout(next);
              }
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
              <b>{item.code}</b>
              <span>{item.label}</span>
            </div>
          ))}
        </div>
        <nav className="lay" aria-label="Layout">
          {(['grid', 'focus', 'flow'] as const).map((value, index) => (
            <button key={value} aria-pressed={layout === value} onClick={() => setLayout(value)}>
              <kbd>{index + 1}</kbd>
              {value.toUpperCase()}
            </button>
          ))}
        </nav>
        <button className="helpbtn" aria-label="Keyboard reference" onClick={() => setHelp(!help)}>
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
            if (event.key === 'Escape') setHelp(false);
          }}
        >
          <div>
            <button
              className="close-help"
              autoFocus
              aria-label="Close keyboard reference"
              onClick={() => setHelp(false)}
            >
              ×
            </button>
            <h2>KEYS</h2>
            <dl>
              <dt>A to Z</dt>
              <dd>Start a command</dd>
              <dt>/</dt>
              <dd>Focus command line</dd>
              <dt>Enter</dt>
              <dd>Run ticker or function, e.g. BREN BRK</dd>
              <dt>Tab</dt>
              <dd>Complete suggestion</dd>
              <dt>Up Down</dt>
              <dd>Move through suggestions, watchlist or articles</dd>
              <dt>1 2 3</dt>
              <dd>GRID FOCUS FLOW</dd>
              <dt>Esc</dt>
              <dd>Clear selection, close reader or restore pane</dd>
              <dt>Drag borders</dt>
              <dd>Resize panes. Double-click to reset.</dd>
              <dt>Double-click header</dt>
              <dd>Maximize pane</dd>
              <dt>Shift-drag chart</dt>
              <dd>Select dates for broker and ownership panes. Drag the date axis also selects.</dd>
            </dl>
            <h2>FUNCTIONS</h2>
            <dl>
              {Object.entries(functions).map(([code, name]) => (
                <div key={code}>
                  <dt>{code}</dt>
                  <dd>{name}</dd>
                </div>
              ))}
            </dl>
            <a href="https://www.tradingview.com/" target="_blank" rel="noreferrer">
              TradingView Lightweight Charts™ Copyright (с) 2025 TradingView, Inc.
            </a>
            <a href="/licenses/lightweight-charts.txt" target="_blank" rel="noreferrer">
              Apache-2.0 license
            </a>
          </div>
        </div>
      )}
    </>
  );
}
