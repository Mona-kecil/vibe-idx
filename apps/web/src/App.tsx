import './styles.css';
import './terminal/terminal.css';
import { lazy, Suspense, useEffect, useState, useSyncExternalStore } from 'react';
import { LocaleProvider, useLocale, type Locale } from './locale';
import { LoginPage } from './BrokerPanel';
import { TickerPage } from './ticker/TickerPage';
import { Home } from './Home';
import { MarketPage } from './MarketPage';
import { TerminalBoot, useTerminalBoot } from './terminal/TerminalBoot';

const Terminal = lazy(() => import('./terminal/Terminal').then((m) => ({ default: m.Terminal })));

export function App({
  initialUrl,
  initialLocale,
}: { initialUrl?: string; initialLocale?: Locale } = {}) {
  return (
    <LocaleProvider initialLocale={initialLocale}>
      <AppRoute initialUrl={initialUrl} />
    </LocaleProvider>
  );
}
function AppRoute({ initialUrl }: { initialUrl?: string }) {
  const { t } = useLocale();
  const [path, setPath] = useState(
    () => initialUrl ?? (typeof window === 'undefined' ? '/' : window.location.pathname),
  );
  useEffect(() => {
    const navigate = () => setPath(window.location.pathname);
    window.addEventListener('popstate', navigate);
    return () => window.removeEventListener('popstate', navigate);
  }, []);
  if (path === '/login') return <LoginPage />;
  if (path === '/callback') return <p role="status">{t('Signing you in…')}</p>;
  if (path === '/terminal') return <TerminalAvailability />;
  if (path === '/market') return <MarketPage />;
  const ticker = /^\/t\/([A-Z0-9-]{1,12})\/?$/i.exec(path)?.[1]?.toUpperCase();
  return ticker ? <TickerPage key={ticker} ticker={ticker} /> : <Home />;
}

const desktop = '(min-width: 901px)';
function TerminalAvailability() {
  const { t } = useLocale();
  const wide = useSyncExternalStore(
    (change) => {
      const query = window.matchMedia(desktop);
      query.addEventListener('change', change);
      return () => query.removeEventListener('change', change);
    },
    () => window.matchMedia(desktop).matches,
    () => true,
  );
  return wide ? (
    <TerminalRoute />
  ) : (
    <main className="home-page terminal-unavailable">
      <p>{t('The terminal is not available on mobile yet.')}</p>
      <a href="/">{t('Back to home')}</a>
    </main>
  );
}

function TerminalRoute() {
  const { phase, reducedMotion, settle } = useTerminalBoot();
  const booting = phase !== 'gone';
  return (
    <>
      <div inert={booting}>
        <Suspense fallback={<div className="terminal-page" />}>
          <Terminal onSettled={settle} booting={booting} />
        </Suspense>
      </div>
      {booting && <TerminalBoot phase={phase} reducedMotion={reducedMotion} />}
    </>
  );
}
