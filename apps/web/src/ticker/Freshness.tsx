import { useEffect, useRef, useState, type ReactNode } from 'react';

export function Freshness({ label, children }: { label: string; children: ReactNode }) {
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
  return (
    <details className="freshness" ref={box} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>{label}</summary>
      <dl className="freshness-panel">{children}</dl>
    </details>
  );
}
