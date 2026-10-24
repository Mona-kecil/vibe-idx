import { useEffect, useState } from 'react';
import { LoginRequiredError, useAuth } from '@workos-inc/authkit-react';
import { z } from 'zod';
import { brokerHistorySchema, type BrokerDay } from './brokers';
import { aggregateBrokers, defaultBrokerCodes, inventorySeries, brokerName } from './broker-data';
import { Chart } from './Chart';
import { useRef } from 'react';
import type { Controls } from './workspace';
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

export function BrokerBadge({ code }: { code: string }) {
  return (
    <span className="broker-code" tabIndex={0} data-tip={brokerName(code)}>
      {code}
    </span>
  );
}
export function BrokerPanel({
  ticker,
  tradingDates,
  controls,
  update,
}: {
  ticker: string;
  tradingDates: string[];
  controls: Controls;
  update: (patch: Partial<Controls>) => void;
}) {
  const { user, isLoading } = useAuth();
  const { t } = useLocale();
  if (isLoading) return <p role="status">{t('Loading data…')}</p>;
  return user ? (
    <BrokerData
      key={`${user.id}:${ticker}`}
      ticker={ticker}
      tradingDates={tradingDates}
      controls={controls}
      update={update}
    />
  ) : (
    <div className="query-state">
      <p>{t('Sign in to view broker summary')}</p>
      <p>{t('Use the one-time code sent to your email.')}</p>
      <SignInButton />
    </div>
  );
}
function BrokerData({
  ticker,
  tradingDates,
  controls,
  update,
}: {
  ticker: string;
  tradingDates: string[];
  controls: Controls;
  update: (patch: Partial<Controls>) => void;
}) {
  const { getAccessToken } = useAuth();
  const { t } = useLocale();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<
    | { status: 'loading' | 'error' | 'unauthorized' | 'missing' }
    | { status: 'ready'; data: History }
  >({ status: 'loading' });
  useEffect(() => {
    const controller = new AbortController();
    setState({ status: 'loading' });
    async function read() {
      const token = await getAccessToken();
      if (controller.signal.aborted) return;
      if (!token) return setState({ status: 'unauthorized' });
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
        <button onClick={() => setAttempt(attempt + 1)}>{t('Retry')}</button>
      </p>
    );
  if (state.status !== 'ready') return null;
  return (
    <BrokerView
      days={state.data.days}
      tradingDates={tradingDates}
      controls={controls}
      update={update}
    />
  );
}
function BrokerPicker({
  codes,
  selected,
  change,
}: {
  codes: string[];
  selected: string[];
  change: (codes: string[]) => void;
}) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    const position = () => {
      if (!popup.current || !trigger.current) return;
      const box = trigger.current.getBoundingClientRect(),
        width = Math.min(370, window.innerWidth - 24),
        height = Math.min(360, Math.max(210, window.innerHeight - 32));
      Object.assign(popup.current.style, {
        width: `${width}px`,
        maxHeight: `${height}px`,
        left: `${Math.max(12, Math.min(window.innerWidth - width - 12, box.left))}px`,
        top: `${window.innerHeight - box.bottom - 12 >= Math.min(300, height) ? box.bottom + 6 : Math.max(12, box.top - Math.min(height, popup.current.scrollHeight) - 6)}px`,
      });
    };
    const outside = (event: globalThis.PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    position();
    window.addEventListener('resize', position);
    document.addEventListener('scroll', position, true);
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('resize', position);
      document.removeEventListener('scroll', position, true);
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', key);
    };
  }, [open]);
  return (
    <div className="broker-select" ref={root}>
      <button
        ref={trigger}
        className="broker-select-trigger"
        aria-label={t('Select brokers')}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span>
          {selected.length
            ? selected.slice(0, 3).join(', ') +
              (selected.length > 3 ? ` +${selected.length - 3}` : '')
            : t('Select brokers')}
        </span>
        <span aria-hidden="true">⌄</span>
      </button>
      {open && (
        <div ref={popup} className="broker-popover" role="group" aria-label={t('Select brokers')}>
          <input
            ref={input}
            className="broker-search"
            aria-label={t('Search broker codes and names')}
            placeholder={t('Code or broker name')}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <div className="broker-options">
            {codes
              .filter((code) =>
                `${code} ${brokerName(code)}`.toLowerCase().includes(search.toLowerCase()),
              )
              .map((code) => (
                <label key={code} className="broker-option">
                  <input
                    type="checkbox"
                    checked={selected.includes(code)}
                    onChange={(event) =>
                      change(
                        event.target.checked
                          ? [...selected, code]
                          : selected.filter((item) => item !== code),
                      )
                    }
                  />
                  <span className="broker-code" data-tip={brokerName(code)}>
                    {code}
                  </span>
                  <span>{brokerName(code)}</span>
                </label>
              ))}
          </div>
          <div className="broker-option-footer">
            <button className="text-link" onClick={() => change([])}>
              {t('Clear')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
export function BrokerView({
  days,
  tradingDates,
  controls,
  update,
}: {
  days: BrokerDay[];
  tradingDates: string[];
  controls: Controls;
  update: (patch: Partial<Controls>) => void;
}) {
  const { t, n, c, d } = useLocale();
  const available = days.map((day) => day.date).sort();
  const first = available[0] ?? '',
    last = available.at(-1) ?? '';
  const from = controls.from || first,
    through = controls.through || last;
  const range = days.filter((day) => day.date >= from && day.date <= through);
  const dates = [...new Set([...tradingDates, ...available])]
    .filter((date) => date >= from && date <= through)
    .sort();
  const missing = dates.filter((date) => !range.some((day) => day.date === date));
  const totals = aggregateBrokers(range);
  const selected = controls.brokerCodes ?? defaultBrokerCodes(range);
  const codes = totals.map((row) => row.code).sort();
  const day =
    controls.brokerDay && dates.includes(controls.brokerDay) ? controls.brokerDay : dates.at(-1);
  const toggle = (code: string) =>
    update({
      brokerCodes: selected.includes(code)
        ? selected.filter((item) => item !== code)
        : [...selected, code],
    });
  const sides = (rows: ReturnType<typeof aggregateBrokers>) => (
    <div className="broker-sides">
      {(['buy', 'sell'] as const).map((side) => {
        const amount = (row: (typeof rows)[number]) => {
          const buy = controls.brokerUnit === 'shares' ? row.buy : row.buyValue,
            sell = controls.brokerUnit === 'shares' ? row.sell : row.sellValue;
          return controls.brokerFlow === 'net'
            ? side === 'buy'
              ? buy - sell
              : sell - buy
            : side === 'buy'
              ? buy
              : sell;
        };
        const sorted = rows
          .filter((row) => amount(row) > 0)
          .sort((a, b) => amount(b) - amount(a) || a.code.localeCompare(b.code));
        return (
          <section className={`broker-side ${side}`} key={side}>
            <h4>
              {controls.brokerFlow === 'net'
                ? t(side === 'buy' ? 'Net Buy' : 'Net Sell')
                : t(side === 'buy' ? 'Buy' : 'Sell')}
            </h4>
            <div className="side-table">
              <table>
                <thead>
                  <tr>
                    <th>{t('Broker')}</th>
                    <th className="numeric">
                      {t(controls.brokerUnit === 'shares' ? 'Shares' : 'Value · IDR')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((row) => (
                    <tr key={row.code}>
                      <td>
                        <button
                          className="broker-check"
                          aria-pressed={selected.includes(row.code)}
                          data-tip={brokerName(row.code)}
                          onClick={() => toggle(row.code)}
                        >
                          {selected.includes(row.code) ? '☑' : '☐'}{' '}
                          <span className="broker-code">{row.code}</span>
                        </button>
                      </td>
                      <td className="numeric" data-amount={amount(row)}>
                        {controls.brokerUnit === 'value' ? c(amount(row)) : n(amount(row))}
                      </td>
                    </tr>
                  ))}
                  {!sorted.length && (
                    <tr>
                      <td colSpan={2} className="empty">
                        {t('No activity.')}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </div>
  );
  return (
    <>
      <div className="range-toolbar">
        <div className="date-fields">
          <label>
            {t('From')}{' '}
            <input
              type="date"
              aria-label={t('Range start')}
              value={from}
              max={through}
              onChange={(event) => {
                if (event.target.value && event.target.checkValidity())
                  update({ from: event.target.value, brokerDay: null });
              }}
            />
          </label>
          <label>
            {t('Through')}{' '}
            <input
              type="date"
              aria-label={t('Range end')}
              value={through}
              min={from}
              max={last}
              onChange={(event) => {
                if (event.target.value && event.target.checkValidity())
                  update({ through: event.target.value, brokerDay: null });
              }}
            />
          </label>
        </div>
      </div>
      {missing.length > 0 && (
        <p className="hint" role="status">
          {t('Missing broker dates')}: {missing.join(', ')}.{' '}
          {t('Inventory after a missing session is unknown; daily changes remain available.')}
        </p>
      )}
      <div className="stack">
        <section className="card">
          <div className="registry-chart-head">
            <h3>{t('Net inventory')}</h3>
            <select
              aria-label={t('Broker measure')}
              value={controls.brokerUnit}
              onChange={(event) =>
                update({ brokerUnit: event.target.value === 'value' ? 'value' : 'shares' })
              }
            >
              <option value="shares">{t('Shares')}</option>
              <option value="value">{t('Value · IDR')}</option>
            </select>
          </div>
          <div className="broker-selection-toolbar">
            <BrokerPicker
              codes={codes}
              selected={selected}
              change={(brokerCodes) => update({ brokerCodes })}
            />
          </div>
          {selected.length ? (
            <Chart
              series={inventorySeries(range, dates, selected, controls.brokerUnit)}
              inspectedDate={controls.brokerDay}
              label={t('Net inventory')}
              unit={controls.brokerUnit === 'shares' ? 'shares' : 'IDR'}
              height={245}
              minZero
              renderLabel={(code) => <BrokerBadge code={code} />}
              onInspect={(brokerDay) => update({ brokerDay })}
            />
          ) : (
            <p className="monthly-empty">{t('Select brokers to plot.')}</p>
          )}
          <p className="hint">
            {t('Change since')} {from}. {t('Opening holdings are unknown.')}
          </p>
          <div className="source-foot">
            <button
              data-tip={t(
                'Daily gross summaries. All boards and investor types. Inventory is cumulative buy minus sell since the chosen start date.',
              )}
            >
              {t('Source')}
            </button>
          </div>
        </section>
        <section className="card">
          <div className="registry-chart-head">
            <h3>{t('Range summary')}</h3>
            <select
              aria-label={t('Broker flow')}
              value={controls.brokerFlow}
              onChange={(event) =>
                update({ brokerFlow: event.target.value === 'gross' ? 'gross' : 'net' })
              }
            >
              <option value="net">{t('Net')}</option>
              <option value="gross">{t('Gross')}</option>
            </select>
          </div>
          {sides(totals)}
        </section>
        <section className="card">
          <div className="registry-chart-head">
            <h3>{t('Daily activity')}</h3>
            <span className="meta">{day ? d(day) : null}</span>
          </div>
          {day && !missing.includes(day) ? (
            sides(aggregateBrokers(range.filter((row) => row.date === day)))
          ) : (
            <p className="monthly-empty">{t('Not reported')}</p>
          )}
        </section>
      </div>
    </>
  );
}
