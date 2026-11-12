import { useEffect, useRef, useState } from 'react';
import { usePublished } from './publicData';
import type { Risk } from './terminal/sources';
import { dateText } from './ticker/format';

const noteCode = (code: string) => (code === 'X' ? 'FCA' : code);

export function useRiskFor(ticker: string): Risk | undefined {
  const risk = usePublished('risk');
  return risk.kind === 'ready' ? risk.data.risk[ticker] : undefined;
}

export function RiskBadge({ risk }: { risk: Risk | undefined }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = () => box.current?.removeAttribute('open');
    const away = (e: MouseEvent) => {
      if (e.target instanceof Node && !box.current?.contains(e.target)) close();
    };
    const escape = (e: KeyboardEvent) => e.key === 'Escape' && close();
    document.addEventListener('click', away);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('click', away);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);
  if (!risk || (!risk.susp && !risk.uma && !risk.notes.length)) return null;
  return (
    <details className="risk" ref={box} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>
        {risk.susp && <span className="risk-chip susp">SUSP</span>}
        {risk.uma && <span className="risk-chip uma">UMA</span>}
        {risk.notes.map((note) => (
          <span className="risk-chip" key={note.code}>
            {noteCode(note.code)}
          </span>
        ))}
      </summary>
      <div className="risk-panel">
        {risk.susp && (
          <p>
            <b>Suspended since {dateText(risk.susp.since)}</b>
            {risk.susp.reason && ` ${risk.susp.reason}`}{' '}
            <a href={risk.susp.url} target="_blank" rel="noreferrer">
              IDX
            </a>
          </p>
        )}
        {risk.uma && (
          <p>
            <b>Unusual market activity {dateText(risk.uma.date)}</b>{' '}
            <a href={risk.uma.url} target="_blank" rel="noreferrer">
              IDX
            </a>
          </p>
        )}
        {risk.notes.map((note) => (
          <p key={note.code}>
            <b>{noteCode(note.code)}</b> {note.text}
          </p>
        ))}
      </div>
    </details>
  );
}
