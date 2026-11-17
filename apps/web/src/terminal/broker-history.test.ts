import { afterEach, beforeEach, expect, it, vi } from 'vite-plus/test';
import type { BrokerDay } from '../brokers';
import { brokerRow } from '../test-builders';
import { clearBrokerHistory, loadBrokerHistory } from './broker-history';

const fetchBrokers = vi.hoisted(() =>
  vi.fn<(ticker: string, token: string) => Promise<BrokerDay[]>>(),
);
vi.mock('./sources', () => ({ fetchBrokers }));

const days: BrokerDay[] = [
  { date: '2026-11-09', board: 'regular', buy: [brokerRow('AA', 1000, 100000)], sell: [] },
];
const getToken = async () => 'token';
const load = (ticker: string) => loadBrokerHistory(ticker, getToken);

beforeEach(() => {
  clearBrokerHistory();
  fetchBrokers.mockReset();
  fetchBrokers.mockImplementation(async () => days);
});
afterEach(() => vi.useRealTimers());

it('shares one request between a ticker asked for twice while it loads and after it loaded', async () => {
  const [first, second] = await Promise.all([load('BBCA'), load('BBCA')]);
  expect(first).toBe(days);
  expect(second).toBe(days);
  await load('BBCA');
  expect(fetchBrokers).toHaveBeenCalledTimes(1);
  expect(fetchBrokers).toHaveBeenCalledWith('BBCA', 'token');
});

it('asks again once the history is ten minutes old', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  await load('BBCA');
  vi.advanceTimersByTime(9 * 60 * 1000);
  await load('BBCA');
  expect(fetchBrokers).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(61 * 1000);
  await load('BBCA');
  expect(fetchBrokers).toHaveBeenCalledTimes(2);
});

it('keeps the last three tickers, counting a return as use', async () => {
  for (const ticker of ['AAAA', 'BBBB', 'CCCC', 'AAAA', 'DDDD']) await load(ticker);
  expect(fetchBrokers).toHaveBeenCalledTimes(4);
  for (const ticker of ['AAAA', 'CCCC', 'DDDD']) await load(ticker);
  expect(fetchBrokers).toHaveBeenCalledTimes(4);
  await load('BBBB');
  expect(fetchBrokers).toHaveBeenCalledTimes(5);
});

it('asks again after a failure, an expired sign-in or a ticker without broker data', async () => {
  fetchBrokers.mockRejectedValueOnce(
    new Error('Broker data is unavailable. Retry to load summaries.'),
  );
  await expect(load('BBCA')).rejects.toThrow('unavailable');
  await expect(loadBrokerHistory('BBCA', async () => undefined)).rejects.toThrow('sign-in expired');
  expect(fetchBrokers).toHaveBeenCalledTimes(1);
  fetchBrokers.mockResolvedValueOnce([]);
  expect(await load('BBCA')).toEqual([]);
  expect(await load('BBCA')).toBe(days);
  expect(await load('BBCA')).toBe(days);
  expect(fetchBrokers).toHaveBeenCalledTimes(3);
});

it('forgets every history on request', async () => {
  await load('BBCA');
  clearBrokerHistory();
  await load('BBCA');
  expect(fetchBrokers).toHaveBeenCalledTimes(2);
});
