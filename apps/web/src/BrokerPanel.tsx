import { useEffect, useState } from 'react';
import { LoginRequiredError, useAuth } from '@workos-inc/authkit-react';
import { z } from 'zod';
import { brokerHistorySchema } from './brokers';
import { useLocale } from './locale';

type History = z.infer<typeof brokerHistorySchema>;

function SignInButton() {
  const { signIn, isLoading } = useAuth();
  const { t } = useLocale();
  const [failed, setFailed] = useState(false);
  return (
    <>
      <button
        type="button"
        disabled={isLoading}
        onClick={() => {
          const path = window.location.pathname;
          if (/^(?:\/|\/stocks|\/t\/[A-Z0-9-]+)$/.test(path))
            window.sessionStorage.setItem('vibe-idx-return-to', path);
          void signIn().catch(() => setFailed(true));
        }}
      >
        {t('Sign in')}
      </button>
      {failed ? <p role="alert">{t('Could not sign in. Try again.')}</p> : null}
    </>
  );
}

export function AccountControls() {
  const { user, signOut } = useAuth();
  const { t } = useLocale();
  return user ? (
    <>
      <span>{user.email}</span>
      <button type="button" onClick={() => signOut({ returnTo: window.location.origin })}>
        {t('Sign out')}
      </button>
    </>
  ) : (
    <SignInButton />
  );
}

export function LoginPage() {
  const { signIn, isLoading } = useAuth();
  const { t } = useLocale();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!isLoading) void signIn().catch(() => setFailed(true));
  }, [isLoading, signIn]);
  return failed ? (
    <div role="alert">
      {t('Could not sign in. Try again.')} <SignInButton />
    </div>
  ) : (
    <p role="status">{t('Signing you in…')}</p>
  );
}

export function BrokerPanel({ ticker, tradingDates }: { ticker: string; tradingDates: string[] }) {
  const { user, isLoading } = useAuth();
  const { t } = useLocale();
  return (
    <section className="broker-panel" aria-label={t('Broker summary')}>
      <h3>{t('Broker summary')}</h3>
      {isLoading ? (
        <p role="status">{t('Loading data…')}</p>
      ) : user ? (
        <BrokerData key={`${user.id}:${ticker}`} ticker={ticker} tradingDates={tradingDates} />
      ) : (
        <div className="query-state">
          <p>{t('Sign in to view broker summary')}</p>
          <p>{t('Use the one-time code sent to your email.')}</p>
          <SignInButton />
        </div>
      )}
    </section>
  );
}

function BrokerData({ ticker, tradingDates }: { ticker: string; tradingDates: string[] }) {
  const { getAccessToken } = useAuth();
  const { t, n } = useLocale();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<
    | { status: 'loading' }
    | { status: 'error' }
    | { status: 'unauthorized' }
    | { status: 'missing' }
    | { status: 'ready'; data: History }
  >({ status: 'loading' });
  const [from, setFrom] = useState('');
  const [through, setThrough] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    setState({ status: 'loading' });
    async function read() {
      const token = await getAccessToken();
      const response = await fetch(`/api/brokers?ticker=${encodeURIComponent(ticker)}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      if (response.status === 401) return setState({ status: 'unauthorized' });
      if (response.status === 404) return setState({ status: 'missing' });
      if (!response.ok) throw new Error('Broker request failed');
      const data = brokerHistorySchema.parse(await response.json());
      if (data.ticker !== ticker) throw new Error('Broker ticker mismatch');
      if (!controller.signal.aborted) setState({ status: 'ready', data });
    }
    void read().catch((error: unknown) => {
      if (!controller.signal.aborted)
        setState({ status: error instanceof LoginRequiredError ? 'unauthorized' : 'error' });
    });
    return () => controller.abort();
  }, [ticker, getAccessToken, attempt]);
  if (state.status === 'loading') return <p role="status">{t('Loading data…')}</p>;
  if (state.status === 'unauthorized') return <SignInButton />;
  if (state.status === 'missing') return <p>{t('Broker data is not available yet.')}</p>;
  if (state.status === 'error')
    return (
      <p role="alert">
        {t('Could not load broker data.')}{' '}
        <button type="button" onClick={() => setAttempt(attempt + 1)}>
          {t('Retry')}
        </button>
      </p>
    );
  const end = through || state.data.days[0]?.date || '';
  const start = from || end;
  const days = state.data.days.filter((day) => day.date >= start && day.date <= end);
  const missingDates = tradingDates.filter(
    (date) => date >= start && date <= end && !days.some((day) => day.date === date),
  );
  const totals = new Map<
    string,
    {
      broker: string;
      investorType: string;
      buyShares: number;
      sellShares: number;
      buyValue: number;
      sellValue: number;
      buyFreq: number;
      sellFreq: number;
    }
  >();
  for (const day of days)
    for (const side of ['buy', 'sell'] as const)
      for (const row of day[side]) {
        const total = totals.get(row.broker) ?? {
          broker: row.broker,
          investorType: row.investor_type,
          buyShares: 0,
          sellShares: 0,
          buyValue: 0,
          sellValue: 0,
          buyFreq: 0,
          sellFreq: 0,
        };
        if (side === 'buy') {
          total.buyShares += row.shares;
          total.buyValue += row.value;
          total.buyFreq += row.freq;
        } else {
          total.sellShares += row.shares;
          total.sellValue += row.value;
          total.sellFreq += row.freq;
        }
        totals.set(row.broker, total);
      }
  const rows = [...totals.values()].sort(
    (a, b) =>
      b.buyValue - b.sellValue - (a.buyValue - a.sellValue) || a.broker.localeCompare(b.broker),
  );
  return (
    <>
      <div className="toolbar broker-toolbar">
        <label className="field">
          {t('From')}
          <input
            type="date"
            value={start}
            max={end}
            onChange={(event) => setFrom(event.target.value)}
          />
        </label>
        <label className="field">
          {t('Through')}
          <input
            type="date"
            value={end}
            min={start}
            max={state.data.days[0]?.date}
            onChange={(event) => setThrough(event.target.value)}
          />
        </label>
        <span>
          {t('Collected trading days')}: {n(days.length)}
        </span>
      </div>
      {missingDates.length ? (
        <p role="status">
          {t('Missing broker dates')}: {missingDates.join(', ')}
        </p>
      ) : null}
      <p className="rule">{t('Broker flow is not the broker’s current inventory.')}</p>
      {rows.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {[
                  'Broker',
                  'Investor type',
                  'Buy shares',
                  'Sell shares',
                  'Net shares',
                  'Buy value (Rp)',
                  'Sell value (Rp)',
                  'Net value (Rp)',
                  'Buy average',
                  'Sell average',
                  'Buy frequency',
                  'Sell frequency',
                ].map((label) => (
                  <th key={label}>{t(label)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.broker}>
                  <td>{row.broker}</td>
                  <td>{row.investorType}</td>
                  {[
                    row.buyShares,
                    row.sellShares,
                    row.buyShares - row.sellShares,
                    row.buyValue,
                    row.sellValue,
                    row.buyValue - row.sellValue,
                    row.buyShares ? row.buyValue / row.buyShares : null,
                    row.sellShares ? row.sellValue / row.sellShares : null,
                    row.buyFreq,
                    row.sellFreq,
                  ].map((value, index) => (
                    <td className="numeric" key={index}>
                      {n(value)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p>{t('No broker data in this date range.')}</p>
      )}
    </>
  );
}
