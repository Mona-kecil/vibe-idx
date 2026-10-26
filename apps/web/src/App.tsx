import './styles.css';
import { useEffect, useState } from 'react';
import { LocaleProvider, useLocale, type Locale } from './locale';
import { LoginPage } from './BrokerPanel';
import { TickerPage } from './ticker/TickerPage';
import { Home } from './Home';
import { MarketPage } from './MarketPage';

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
  if (path === '/market') return <MarketPage />;
  const ticker = /^\/t\/([A-Z0-9-]{1,12})\/?$/i.exec(path)?.[1]?.toUpperCase();
  return ticker ? <TickerPage key={ticker} ticker={ticker} /> : <Home />;
}
