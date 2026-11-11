import { useEffect, useRef, useState } from 'react';

export function ShareButton({ ticker, name }: { ticker: string; name: string }) {
  const [message, setMessage] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  async function share() {
    clearTimeout(timer.current);
    setMessage('');
    const url = new URL(`/t/${ticker}`, window.location.origin).href;
    if (navigator.share) {
      try {
        await navigator.share({ title: `${ticker} ${name}`, url });
        return;
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setMessage('Link copied');
      timer.current = setTimeout(() => setMessage(''), 2500);
    } catch {
      setMessage('Could not copy link. Try again.');
    }
  }

  return (
    <div className="ticker-share">
      <button
        type="button"
        className="share-button"
        aria-label={`Share ${ticker}`}
        onClick={() => void share()}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M12 16V3m-4 4 4-4 4 4M7 10H5v11h14V10h-2" />
        </svg>
      </button>
      <span className="share-status" aria-live="polite">
        {message}
      </span>
    </div>
  );
}
