import { useState, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { Corruption } from './Corruption';

const spreadMs = 300;

function openTerminal() {
  window.history.pushState(null, '', '/terminal');
  window.scrollTo(0, 0);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function TerminalLink() {
  const [seed, setSeed] = useState<{ x: number; y: number } | null>(null);
  function enter(event: MouseEvent<HTMLAnchorElement>) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
      return;
    if (!window.matchMedia('(min-width: 901px)').matches) return;
    event.preventDefault();
    if (seed) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return openTerminal();
    const box = event.currentTarget.getBoundingClientRect();
    setSeed({ x: box.left + box.width / 2, y: box.top + box.height / 2 });
    window.setTimeout(openTerminal, spreadMs);
  }
  return (
    <>
      <a className="terminal-link" href="/terminal" onClick={enter}>
        Terminal
        <span className="cursor" aria-hidden="true" />
      </a>
      {seed &&
        createPortal(
          <div className="terminal-veil">
            <Corruption seed={seed} spreadMs={spreadMs} />
          </div>,
          document.body,
        )}
    </>
  );
}
