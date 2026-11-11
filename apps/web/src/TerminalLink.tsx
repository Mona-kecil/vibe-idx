import { useState, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { Corruption } from './Corruption';

const spreadMs = 400;

function openTerminal() {
  window.history.pushState(null, '', '/terminal');
  window.scrollTo(0, 0);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function TerminalLink() {
  const [swallowing, setSwallowing] = useState(false);
  function enter(event: MouseEvent<HTMLAnchorElement>) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
      return;
    if (!window.matchMedia('(min-width: 901px)').matches) return;
    event.preventDefault();
    if (swallowing) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return openTerminal();
    setSwallowing(true);
    window.setTimeout(openTerminal, spreadMs);
  }
  return (
    <>
      <a className="terminal-link" href="/terminal" onClick={enter}>
        Terminal
        <span className="cursor" aria-hidden="true" />
      </a>
      {swallowing &&
        createPortal(
          <div className="terminal-veil">
            <Corruption mode="spread" durationMs={spreadMs} />
          </div>,
          document.body,
        )}
    </>
  );
}
