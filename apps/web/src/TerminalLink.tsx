import { useState, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';

const fadeMs = 350;

export function TerminalLink() {
  const [leaving, setLeaving] = useState(false);
  function enter(event: MouseEvent<HTMLAnchorElement>) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
      return;
    if (!window.matchMedia('(min-width: 901px)').matches) return;
    event.preventDefault();
    if (leaving) return;
    setLeaving(true);
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.setTimeout(
      () => {
        window.history.pushState(null, '', '/terminal');
        window.scrollTo(0, 0);
        window.dispatchEvent(new PopStateEvent('popstate'));
      },
      still ? 0 : fadeMs,
    );
  }
  return (
    <>
      <a className="terminal-link" href="/terminal" onClick={enter}>
        Terminal
        <span className="cursor" aria-hidden="true" />
      </a>
      {leaving && createPortal(<div className="terminal-veil" aria-hidden="true" />, document.body)}
    </>
  );
}
