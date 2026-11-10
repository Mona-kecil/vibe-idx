import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DuckDBInstance } from '@duckdb/node-api';
import { afterEach, expect, it, vi } from 'vite-plus/test';
import type { R2 } from './brokers';
import { checkRescales } from './rescale-check';
import type { RescaleReport } from './rescale-check';

const roots: string[] = [];
afterEach(() => Promise.all(roots.splice(0).map((p) => rm(p, { recursive: true, force: true }))));

const sessions = Array.from({ length: 22 }, (_, i) => new Date(Date.UTC(2026, 10, 3 + i)))
  .filter((d) => d.getUTCDay() % 6)
  .map((d) => d.toISOString().slice(0, 10));
const stored = [
  { side: 'buy', broker: 'XL', investor: 'domestic', shares: 30000, value: 30000 * 500 },
  { side: 'buy', broker: 'XL', investor: 'foreign', shares: 10000, value: 10000 * 500 },
  { side: 'sell', broker: 'YP', investor: 'domestic', shares: 40000, value: 40000 * 500 },
];

async function fixture({ ex = '2026-11-06', kind = 'BONUS' } = {}) {
  const data = await mkdtemp(join(tmpdir(), 'rescale-check-'));
  roots.push(data);
  for (const dir of ['corporate_actions', 'prices', 'broker_activity'])
    await mkdir(join(data, 'parquet', dir), { recursive: true });
  const instance = await DuckDBInstance.create(':memory:');
  const db = await instance.connect();
  const out = (file: string) => `'${join(data, 'parquet', file)}' (FORMAT PARQUET)`;
  const payload = JSON.stringify([
    { ticker: 'PSSI', kind, label: kind, amount: null, steps: [{ step: 'ex', date: ex }] },
    {
      ticker: 'BBRI',
      kind: 'DIV',
      label: 'Dividend',
      amount: null,
      steps: [{ step: 'ex', date: ex }],
    },
  ]);
  await db.run(`
    COPY (SELECT DATE '2026-11-04' date, '${payload}'::JSON payload) TO ${out('corporate_actions/2026.parquet')};
    COPY (SELECT unnest([${sessions.map((d) => `DATE '${d}'`).join(', ')}]) date, 'PSSI' ticker, 1000 volume, 10 frequency)
      TO ${out('prices/2026.parquet')};
    COPY (SELECT DATE '2026-11-05' date, 'PSSI' ticker, 'regular' board, side, broker, investor, shares, value, 1 freq
      FROM (VALUES ${stored.map((r) => `('${r.side}','${r.broker}','${r.investor}',${r.shares},${r.value})`).join(', ')})
        t(side, broker, investor, shares, value)) TO ${out('broker_activity/2026.parquet')};
    COPY (SELECT DATE '2026-11-05' date, 'regular' board, NULL::VARCHAR broker, NULL::VARCHAR investor, true listed, NULL::BOOLEAN complete
      UNION ALL SELECT DATE '2026-11-05', 'regular', broker, investor, NULL, true
      FROM (VALUES ('XL'), ('YP')) b(broker) CROSS JOIN (VALUES ('domestic'), ('foreign')) i(investor))
      TO ${out('broker-activity-coverage.parquet')};`);
  db.closeSync();
  instance.closeSync();

  const objects = new Map<string, Buffer>();
  const r2: R2 = {
    async get(key) {
      const bytes = objects.get(key);
      return bytes && { bytes, etag: String(bytes.length) };
    },
    async put(key, bytes) {
      objects.set(key, bytes);
      return String(bytes.length);
    },
    async delete(key) {
      objects.delete(key);
    },
  };
  let stockbit: { buy: [string, number, number][]; sell: [string, number, number][] } | Error = {
    buy: [['XL', 40000, 40000 * 500]],
    sell: [['YP', 40000, 40000 * 500]],
  };
  const fetcher = vi.fn(async (url: URL) => {
    expect(url.href).toContain('/marketdetectors/PSSI?from=2026-11-05&to=2026-11-05');
    if (stockbit instanceof Error) throw stockbit;
    const { buy, sell } = stockbit;
    return Response.json({
      data: {
        from: '2026-11-05',
        to: '2026-11-05',
        bandar_detector: { total_buyer: buy.length, total_seller: sell.length },
        broker_summary: {
          symbol: 'PSSI',
          brokers_buy: buy.map(([code, shares, value]) => ({
            netbs_broker_code: code,
            blotv: `${shares}`,
            bval: `${value}`,
          })),
          brokers_sell: sell.map(([code, shares, value]) => ({
            netbs_broker_code: code,
            slotv: `${shares}`,
            sval: `${value}`,
          })),
        },
      },
    });
  });
  const reports: RescaleReport[] = [];
  const run = (now: string) =>
    checkRescales({
      data,
      r2,
      access: async () => 'token',
      fetcher: fetcher as typeof fetch,
      now: new Date(now),
      report: async (event) => (reports.push(event), true),
    });
  return {
    run,
    fetcher,
    reports,
    stockbit: (next: typeof stockbit) => (stockbit = next),
  };
}

it('probes the last complete session before ex once a day and stays quiet while Stockbit agrees', async () => {
  const f = await fixture();
  expect(await f.run('2026-11-10T10:00:00Z')).toEqual([]);
  expect(await f.run('2026-11-10T16:00:00Z')).toEqual([]);
  expect(f.fetcher).toHaveBeenCalledTimes(1);
  await f.run('2026-11-11T10:00:00Z');
  expect(f.fetcher).toHaveBeenCalledTimes(2);
});

it('reports a rescale with its factor once, then stops probing the event', async () => {
  const f = await fixture();
  const factor = 0.967773;
  f.stockbit({
    buy: [['XL', 40000 * factor, 40000 * 500]],
    sell: [['YP', 40000 * factor, 40000 * 500]],
  });
  await f.run('2026-11-10T10:00:00Z');
  expect(f.reports).toEqual([
    {
      ticker: 'PSSI',
      kind: 'BONUS',
      ex: '2026-11-06',
      probe: '2026-11-05',
      factor: expect.closeTo(factor, 9),
      mismatched: [],
    },
  ]);
  await f.run('2026-11-11T10:00:00Z');
  expect(f.fetcher).toHaveBeenCalledTimes(1);
  expect(f.reports).toHaveLength(1);
});

it('reports brokers whose value or presence differs from what we stored', async () => {
  const f = await fixture();
  f.stockbit({
    buy: [['XL', 40000, 1]],
    sell: [
      ['YP', 40000, 40000 * 500],
      ['CC', 5, 5],
    ],
  });
  await f.run('2026-11-10T10:00:00Z');
  expect(f.reports.map((r) => r.mismatched)).toEqual([['buy:XL', 'sell:CC']]);
});

it('keeps a failed probe for the next day without throwing', async () => {
  const f = await fixture();
  f.stockbit(new Error('socket hang up'));
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  expect(await f.run('2026-11-10T10:00:00Z')).toEqual([]);
  await f.run('2026-11-10T11:00:00Z');
  expect(f.fetcher).toHaveBeenCalledTimes(1);
  expect(log).toHaveBeenCalledWith(expect.stringContaining('socket hang up'));
  log.mockRestore();
});

it('ignores dividends and events outside ten sessions after ex', async () => {
  const late = await fixture();
  await late.run('2026-11-25T10:00:00Z');
  const dividend = await fixture({ kind: 'DIV' });
  await dividend.run('2026-11-10T10:00:00Z');
  expect(late.fetcher).not.toHaveBeenCalled();
  expect(dividend.fetcher).not.toHaveBeenCalled();
});
