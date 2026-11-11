import { useState, type CSSProperties, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';

const creepMs = 250;

export function TerminalLink() {
  const [origin, setOrigin] = useState<CSSProperties | null>(null);
  function enter(event: MouseEvent<HTMLAnchorElement>) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
      return;
    if (!window.matchMedia('(min-width: 901px)').matches) return;
    event.preventDefault();
    if (origin) return;
    const box = event.currentTarget.getBoundingClientRect();
    setOrigin({
      '--top': `${box.top}px`,
      '--right': `${window.innerWidth - box.right}px`,
      '--bottom': `${window.innerHeight - box.bottom}px`,
      '--left': `${box.left}px`,
    } as CSSProperties);
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.setTimeout(
      () => {
        window.history.pushState(null, '', '/terminal');
        window.scrollTo(0, 0);
        window.dispatchEvent(new PopStateEvent('popstate'));
      },
      still ? 0 : creepMs,
    );
  }
  return (
    <>
      <a className="terminal-link" href="/terminal" onClick={enter}>
        Terminal
        <span className="cursor" aria-hidden="true" />
      </a>
      {origin &&
        createPortal(
          <div className="terminal-veil" style={origin} aria-hidden="true" />,
          document.body,
        )}
    </>
  );
}
