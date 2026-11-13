import { useState, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { Void, aimVoid, arrivalMs } from './Void';
import { startGlitch } from './glitch';

const glitchLeadMs = 300;

function openTerminal() {
  window.history.pushState(null, '', '/terminal');
  window.scrollTo(0, 0);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function TerminalLink() {
  const [stage, setStage] = useState<'idle' | 'glitching' | 'swallowing'>('idle');
  function enter(event: MouseEvent<HTMLAnchorElement>) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
      return;
    if (!window.matchMedia('(min-width: 901px)').matches) return;
    event.preventDefault();
    if (stage !== 'idle') return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return openTerminal();
    const button = event.currentTarget.getBoundingClientRect();
    aimVoid(
      (button.left + button.width / 2) / window.innerWidth,
      (button.top + button.height / 2) / window.innerHeight,
    );
    setStage('glitching');
    const swallowMs = glitchLeadMs + arrivalMs();
    startGlitch(swallowMs);
    window.setTimeout(() => setStage('swallowing'), glitchLeadMs);
    window.setTimeout(openTerminal, swallowMs);
  }
  return (
    <>
      <a className="terminal-link" href="/terminal" onClick={enter}>
        Terminal
        <span className="cursor" aria-hidden="true" />
      </a>
      {stage === 'swallowing' &&
        createPortal(
          <div className="terminal-veil">
            <Void mode="spread" />
          </div>,
          document.body,
        )}
    </>
  );
}
