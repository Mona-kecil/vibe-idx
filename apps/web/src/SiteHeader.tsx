import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AccountControls } from './BrokerPanel';
import { TerminalLink } from './TerminalLink';
import './site.css';

type Page = 'home' | 'market' | 'ticker';
type Listing = { ticker: string; name: string };

export function SiteHeader({
  page,
  stocks,
  pin,
}: {
  page: Page;
  stocks: Listing[];
  pin?: (ticker: string) => ReactNode;
}) {
  const [query, setQuery] = useState(''),
    [open, setOpen] = useState(false),
    [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null),
    box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        if (e.target instanceof Node && box.current?.contains(e.target)) input.current?.focus();
      }
      if (
        e.key === '/' &&
        !(e.target instanceof HTMLElement && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName))
      ) {
        e.preventDefault();
        input.current?.focus();
      }
    };
    const outside = (e: MouseEvent) => {
      if (e.target instanceof Node && !box.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('keydown', key);
    document.addEventListener('click', outside);
    return () => {
      document.removeEventListener('keydown', key);
      document.removeEventListener('click', outside);
    };
  }, []);
  const q = query.trim().toLowerCase();
  const matches = stocks
    .filter((s) => s.ticker.toLowerCase().includes(q) || s.name.toLowerCase().includes(q))
    .sort(
      (a, b) =>
        Number(b.ticker.toLowerCase() === q) - Number(a.ticker.toLowerCase() === q) ||
        a.ticker.localeCompare(b.ticker),
    )
    .slice(0, 12);
  const link = (target: Page, href: string, label: string) => (
    <a href={href} aria-current={page === target ? 'page' : undefined}>
      {label}
    </a>
  );
  return (
    <header className="site-header">
      <div className="wrap site-bar">
        <a className="wordmark" href="/" aria-label="Vibe IDX home">
          Vibe <span>IDX</span>
        </a>
        <nav className="site-nav" aria-label="Main">
          {link('home', '/', 'Today')}
          {link('market', '/market', 'Market')}
          <TerminalLink />
        </nav>
        <div className="site-search" ref={box}>
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            aria-hidden="true"
          >
            <circle cx="10.5" cy="10.5" r="6.5" />
            <path d="m16 16 4.5 4.5" />
          </svg>
          <input
            ref={input}
            type="search"
            placeholder="Search tickers"
            aria-label="Search tickers or companies"
            autoComplete="off"
            aria-controls="search-results"
            aria-expanded={open && !!q}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && q && matches[active]) {
                e.preventDefault();
                window.location.assign(`/t/${matches[active].ticker}`);
              }
              if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && matches.length) {
                e.preventDefault();
                const next =
                  (active + (e.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length;
                setActive(next);
                setOpen(true);
                box.current
                  ?.querySelectorAll('.search-option')
                  [next]?.scrollIntoView({ block: 'nearest' });
              }
            }}
          />
          <kbd>/</kbd>
          {open && q && (
            <div className="search-results" id="search-results">
              {matches.length ? (
                matches.map((s, i) => (
                  <div className={`search-option${i === active ? ' active' : ''}`} key={s.ticker}>
                    <a href={`/t/${s.ticker}`} aria-label={`Open ${s.ticker}, ${s.name}`}>
                      <b>{s.ticker}</b>
                      <small>{s.name}</small>
                    </a>
                    {pin?.(s.ticker)}
                  </div>
                ))
              ) : (
                <div className="search-empty">No stocks found</div>
              )}
            </div>
          )}
        </div>
        <div className="site-account">
          <AccountControls />
        </div>
      </div>
    </header>
  );
}

export function PinButton({
  ticker,
  pinned,
  toggle,
}: {
  ticker: string;
  pinned: boolean;
  toggle: (button: HTMLButtonElement) => void;
}) {
  return (
    <button
      className="pin"
      type="button"
      aria-label={`${pinned ? 'Unpin' : 'Pin'} ${ticker}`}
      aria-pressed={pinned}
      onClick={(e) => toggle(e.currentTarget)}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M7 3h10v18l-5-3-5 3z" />
      </svg>
    </button>
  );
}
