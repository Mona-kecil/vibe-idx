import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate } from 'node:timers';
import { setTimeout as sleep } from 'node:timers/promises';
import { gunzipSync } from 'node:zlib';
import { DuckDBInstance } from '@duckdb/node-api';
import { afterEach, beforeEach, expect, it, vi } from 'vite-plus/test';
import type { R2 } from './brokers';
import { brokers } from './brokers';
import { collectTicks } from './ticks';
import { doneDetailSql, parseBook, parseTradePage } from './ticks-data';
import { progressSchema, TickStore, tradeLanes } from './ticks-store';
import { nextPreOpen, tradingSessions } from './lib/idx-calendar';

vi.mock('./lib/sentry', () => ({ reportError: vi.fn(), startSentry: vi.fn() }));
vi.mock('node:timers/promises', () => ({
  setTimeout: vi.fn(),
}));
const roots: string[] = [];
const day = '2026-11-09';
const report = vi.fn(async (_error: unknown, _tags?: Record<string, string>) => {});
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-10T02:00:00Z'));
  report.mockClear();
  vi.mocked(sleep).mockImplementation(async (ms = 0) => {
    vi.setSystemTime(Date.now() + ms);
  });
});
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(roots.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});
async function sql(text: string) {
  const instance = await DuckDBInstance.create(':memory:');
  const db = await instance.connect();
  try {
    return (await db.runAndReadAll(text)).getRowObjectsJson();
  } finally {
    db.closeSync();
    instance.closeSync();
  }
}
async function fixture({
  objects = new Map<string, Buffer>(),
  dates = [day],
  tickers = ['SINI', 'ZERO'],
} = {}) {
  const data = await mkdtemp(join(tmpdir(), 'ticks-'));
  roots.push(data);
  await mkdir(join(data, 'parquet', 'prices'), { recursive: true });
  const values = dates.flatMap((d) => tickers.map((t) => `(DATE '${d}','${t}',1,1)`));
  await sql(
    `COPY (SELECT * FROM (VALUES ${values.join(',')}) p(date,ticker,volume,frequency)) TO '${data}/parquet/prices/2026.parquet' (FORMAT PARQUET)`,
  );
  const puts: { key: string; condition: unknown }[] = [];
  const hooks: { afterPut?: (key: string) => void } = {};
  const r2: R2 = {
    async get(key) {
      const bytes = objects.get(key);
      return bytes ? { bytes: Buffer.from(bytes), etag: 'fake' } : undefined;
    },
    async put(key, bytes, condition) {
      if (condition && 'ifNoneMatch' in condition && objects.has(key))
        throw new Error('create-once conflict');
      puts.push({ key, condition });
      objects.set(key, Buffer.from(bytes));
      hooks.afterPut?.(key);
      return 'fake';
    },
    async delete(key) {
      objects.delete(key);
    },
  };
  return { data, r2, objects, puts, hooks, deadline: Date.now() + 3600000, report };
}
function trade(n: number, code = 'SINI', time = '10:00:00') {
  return {
    id: String(5000000000 + n),
    time,
    action: 'buy',
    code,
    price: '7,675',
    lot: '1',
    buyer: 'XL [D]',
    seller: 'YP [F]',
    trade_number: String(n),
    buyer_type: 'BROKER_TYPE_LOCAL',
    seller_type: 'BROKER_TYPE_FOREIGN',
    market_board: 'RG',
    buy_order_number: String(10000 + n),
    sell_order_number: '1',
    group_order_number: '1',
    value: { raw: 767500 },
  };
}
const page = (numbers: number[]) =>
  Response.json({ data: { running_trade: numbers.map((n) => trade(n)) } });
const sequence = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i);
async function book(ticker = 'SINI') {
  const raw = JSON.parse(
    await readFile(new URL('./fixtures/closing-book.json', import.meta.url), 'utf8'),
  );
  raw.data.symbol = ticker;
  return raw;
}
async function rows(f: Awaited<ReturnType<typeof fixture>>, dataset: string, suffix = day) {
  // Published objects are materialized locally by the real store as well as captured by fake R2.
  return sql(`SELECT * FROM read_parquet('${f.data}/ticks/${dataset}/${suffix}.parquet')`);
}
it('parses the supplied fixtures without losing broker domicile, shares, or levels', async () => {
  const raw: unknown = JSON.parse(
    await readFile(new URL('./fixtures/running-trade.json', import.meta.url), 'utf8'),
  );
  const trades = parseTradePage(raw, day);
  expect(trades[0]).toMatchObject({
    price: 7675,
    shares: 100,
    trade_number: 1199303,
    buyer: 'XL',
    buyer_domicile: 'D',
    seller: 'YP',
    seller_domicile: 'D',
    seller_type: 'BROKER_TYPE_FOREIGN',
    session: 'continuous',
  });
  const levels = parseBook(await book(), 'SINI', day, '2026-11-09T10:00:00Z');
  expect(levels[0]).toMatchObject({
    record_type: 'snapshot',
    date_source: 'idx_price_session',
    close: 7675,
  });
  expect(levels[1]).toMatchObject({ side: 'bid', level: 1, price: 7650, orders: 2, shares: 6000 });
  expect(levels.filter((r) => r.side === 'bid')).toHaveLength(21);
  expect(() =>
    parseTradePage({ data: { running_trade: [{ ...trade(1), price: '7,67' }] } }, day),
  ).toThrow();
  expect(() =>
    parseTradePage({ data: { running_trade: [{ ...trade(1), buyer: 'XL' }] } }, day),
  ).toThrow();
});
it('derives continuous blocks from the aggressor order and auction histories from both sides', async () => {
  const f = await fixture();
  const store = await TickStore.open(f.data, f.r2);
  try {
    const r = [
      trade(1),
      { ...trade(2), buy_order_number: '10001', group_order_number: '999' },
      trade(3, 'SINI', '08:59:59'),
      trade(4, 'SINI', '16:00:00'),
    ];
    await store.checkpoint(
      {
        dataset: 'running_trade',
        date: day,
        tickers: ['SINI'],
        chunks: [],
        expected: 4,
        phase: 'bulk',
        lanes: tradeLanes(4, 4),
        repairs: 0,
      },
      parseTradePage({ data: { running_trade: r } }, day),
      0,
      4,
    );
    const blocks = await store.query(
      `SELECT session,side,order_number::INTEGER order_number,count(*)::INTEGER n FROM (${doneDetailSql}) GROUP BY ALL ORDER BY session,side,order_number`,
    );
    expect(blocks).toEqual([
      { session: 'auction', side: 'buy', order_number: 10003, n: 1 },
      { session: 'auction', side: 'buy', order_number: 10004, n: 1 },
      { session: 'auction', side: 'sell', order_number: 1, n: 2 },
      { session: 'continuous', side: 'buy', order_number: 10001, n: 2 },
    ]);
  } finally {
    store.close();
  }
});
it('deduplicates non-monotonic market pages and re-reads skipped seconds before create-once publication', async () => {
  const f = await fixture();
  const calls: URL[] = [];
  const starts: number[] = [];
  let throttled = true;
  let firstPass = true;
  const result = await collectTicks({
    ...f,
    request: async (input) => {
      const u = new URL(input);
      calls.push(u);
      starts.push(Date.now());
      expect(u.searchParams.get('order_by')).toBe('RUNNING_TRADE_ORDER_BY_TIME');
      expect(u.searchParams.get('limit')).toBe('100');
      expect(u.searchParams.has('symbols')).toBe(false);
      if (throttled) {
        throttled = false;
        return new Response('', { status: 429 });
      }
      if (u.searchParams.get('sort') === 'DESC') return page([205]);
      const cursor = Number(u.searchParams.get('trade_number') ?? 0);
      if (cursor === 0 && firstPass) {
        firstPass = false;
        return page([...sequence(1, 99), 105]);
      }
      if (cursor === 0) return page(sequence(5, 104));
      if (cursor === 105 || cursor === 51) return page([...sequence(106, 204), 50]);
      if (cursor === 50) return page([205]);
      return page(sequence(cursor + 1, Math.min(cursor + 100, 205)));
    },
  });
  expect(result.published).toEqual([`running_trade/${day}`]);
  expect(starts.every((s, i) => !i || s - starts[i - 1] >= 250)).toBe(true);
  expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(1000);
  expect(await rows(f, 'running_trade')).toHaveLength(205);
  expect([...f.objects.keys()].filter((k) => k.startsWith('staging/'))).toEqual([]);
  expect(f.puts.find((p) => p.key === `ticks/running_trade/${day}.parquet`)?.condition).toEqual({
    ifNoneMatch: '*',
  });
  expect(
    await sql(
      `SELECT ticker,row_count::INTEGER n,status FROM read_parquet('${f.data}/ticks/ledger.parquet') WHERE dataset='running_trade' ORDER BY ticker`,
    ),
  ).toEqual([
    { ticker: 'SINI', n: 205, status: 'complete' },
    { ticker: 'ZERO', n: 0, status: 'no_trades' },
  ]);
  expect([...f.objects.keys()].every((k) => /^(ticks|staging\/ticks|site\/ticks)\//.test(k))).toBe(
    true,
  );
  const site = JSON.parse(
    gunzipSync(f.objects.get(`site/ticks/SINI/${day}.trades.json.gz`)!).toString(),
  );
  expect(site).toMatchObject({ date: day, ticker: 'SINI' });
  expect(site.time).toHaveLength(205);
  expect(site.shares[0]).toBe(100);
  expect(site.buyer_foreign[0]).toBe(false);
  expect(site.seller_foreign[0]).toBe(true);
});
it('resumes a budgeted market crawl on a fresh runner without refreshing its closing sequence', async () => {
  const f = await fixture();
  const calls: string[] = [];
  const request = async (input: string) => {
    const u = new URL(input);
    calls.push(u.searchParams.get('sort') + ':' + (u.searchParams.get('trade_number') ?? '0'));
    return u.searchParams.get('sort') === 'DESC'
      ? page([205])
      : page(
          sequence(
            Number(u.searchParams.get('trade_number') ?? 0) + 1,
            Math.min(Number(u.searchParams.get('trade_number') ?? 0) + 100, 205),
          ),
        );
  };
  const first = await collectTicks({ ...f, deadline: Date.now() + 1200, request });
  expect(first.stopped).toBe('Tick time budget reached');
  expect(f.objects.has(`ticks/running_trade/${day}.parquet`)).toBe(false);
  const progress = JSON.parse(
    f.objects.get(`staging/ticks/running_trade/${day}/progress.json`)!.toString(),
  );
  expect(progress.lanes).toHaveLength(4);
  expect(progress.lanes.some((lane: { done: boolean }) => !lane.done)).toBe(true);
  expect(progress.chunks).toHaveLength(1);
  const resumed = await fixture({ objects: f.objects });
  calls.length = 0;
  expect((await collectTicks({ ...resumed, request })).published).toEqual([`running_trade/${day}`]);
  expect(calls.length).toBeGreaterThan(0);
  expect(calls.every((call) => call.startsWith('ASC:'))).toBe(true);
  expect(await rows(resumed, 'running_trade')).toHaveLength(205);
});
it('converts old cursor progress into lanes and resumes the complete day', async () => {
  const f = await fixture();
  const legacy = {
    dataset: 'running_trade',
    date: day,
    tickers: ['SINI', 'ZERO'],
    chunks: [],
    expected: 805,
    phase: 'bulk',
    cursor: 200,
    seen: [0, 100],
    repairs: 0,
  };
  const converted = progressSchema.parse(legacy);
  expect(converted).not.toHaveProperty('cursor');
  expect(converted).toMatchObject({ lanes: tradeLanes(805, 200) });
  const store = await TickStore.open(f.data, f.r2);
  try {
    await store.checkpoint(
      converted,
      parseTradePage(
        {
          data: {
            running_trade: sequence(1, 100).map((n) => trade(n)),
          },
        },
        day,
      ),
      1,
      100,
    );
    await store.checkpoint(
      converted,
      parseTradePage({ data: { running_trade: sequence(101, 200).map((n) => trade(n)) } }, day),
      101,
      200,
    );
  } finally {
    store.close();
  }
  const key = `staging/ticks/running_trade/${day}/progress.json`;
  const saved = JSON.parse(f.objects.get(key)!.toString());
  f.objects.set(key, Buffer.from(JSON.stringify({ ...legacy, chunks: saved.chunks })));
  const resumed = await fixture({ objects: f.objects });
  const starts: number[] = [];
  const result = await collectTicks({
    ...resumed,
    request: async (input) => {
      const u = new URL(input);
      expect(u.searchParams.get('sort')).toBe('ASC');
      const cursor = Number(u.searchParams.get('trade_number') ?? 0);
      starts.push(cursor);
      return page(sequence(cursor + 1, Math.min(cursor + 100, 805)));
    },
  });
  expect(starts).toEqual(expect.arrayContaining([200, 351, 502, 653]));
  expect(result.published).toEqual([`running_trade/${day}`]);
  expect(await rows(resumed, 'running_trade')).toHaveLength(805);
});
async function clocked<T>(run: () => Promise<T>) {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout'] });
  vi.mocked(sleep).mockImplementation(
    (ms = 0) =>
      new Promise((resolve) => {
        globalThis.setTimeout(resolve, ms);
      }),
  );
  let finished = false;
  const result = run()
    .then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    )
    .finally(() => {
      finished = true;
    });
  while (!finished) {
    await new Promise<void>((resolve) => setImmediate(resolve));
    await vi.advanceTimersToNextTimerAsync();
  }
  const outcome = await result;
  if ('error' in outcome) throw outcome.error;
  return outcome.value;
}
it.each([800, 4000])('paces concurrent one-second requests for %i trades', async (total) => {
  const f = await fixture();
  const starts: number[] = [];
  const before = Date.now();
  let active = 0;
  let peak = 0;
  const result = await clocked(() =>
    collectTicks({
      ...f,
      request: async (input) => {
        starts.push(Date.now());
        peak = Math.max(peak, ++active);
        await sleep(1000);
        active--;
        const u = new URL(input);
        if (u.searchParams.get('sort') === 'DESC') return page([total]);
        const cursor = Number(u.searchParams.get('trade_number') ?? 0);
        return page(sequence(cursor + 1, Math.min(cursor + 100, total)));
      },
    }),
  );
  expect(result.published).toEqual([`running_trade/${day}`]);
  // Four pages per second, plus the initial DESC, lane startup, and final empty page.
  expect(Date.now() - before).toBeLessThanOrEqual((total / 100) * 250 + 2750);
  expect(starts).toHaveLength(total / 100 + 2);
  expect(peak).toBe(4);
  expect(active).toBe(0);
  expect(starts.every((s, i) => !i || s - starts[i - 1] >= 250)).toBe(true);
  expect(await rows(f, 'running_trade')).toHaveLength(total);
});
it('backs off an empty lane start to a served trade number', async () => {
  const f = await fixture();
  const cursors: number[] = [];
  const result = await collectTicks({
    ...f,
    request: async (input) => {
      const u = new URL(input);
      if (u.searchParams.get('sort') === 'DESC') return page([800]);
      const cursor = Number(u.searchParams.get('trade_number') ?? 0);
      cursors.push(cursor);
      if (cursor === 400) return page([]);
      return page(sequence(cursor + 1, Math.min(cursor + 100, 800)));
    },
  });
  expect(cursors).toContain(399);
  expect(result.published).toEqual([`running_trade/${day}`]);
  expect(await rows(f, 'running_trade')).toHaveLength(800);
});
it('shares a closing-sequence refresh between concurrent lanes', async () => {
  const f = await fixture();
  f.objects.set(
    `staging/ticks/running_trade/${day}/progress.json`,
    Buffer.from(
      JSON.stringify({
        dataset: 'running_trade',
        date: day,
        tickers: ['SINI', 'ZERO'],
        chunks: [],
        expected: 4,
        phase: 'bulk',
        lanes: tradeLanes(4),
        repairs: 0,
      }),
    ),
  );
  let refreshes = 0;
  const result = await clocked(() =>
    collectTicks({
      ...f,
      request: async (input) => {
        await sleep(1000);
        const u = new URL(input);
        if (u.searchParams.get('sort') === 'DESC') {
          refreshes++;
          return page([8]);
        }
        const cursor = Number(u.searchParams.get('trade_number') ?? 0);
        return page(sequence(cursor + 1, 8));
      },
    }),
  );
  expect(refreshes).toBe(1);
  expect(result.published).toEqual([`running_trade/${day}`]);
  expect(await rows(f, 'running_trade')).toHaveLength(8);
});
it.each(['http', 'parse'])(
  'settles other lanes and flushes accepted rows after a %s failure',
  async (failure) => {
    const f = await fixture();
    const starts: number[] = [];
    let failedAt = Infinity;
    const run = () =>
      collectTicks({
        ...f,
        request: async (input) => {
          starts.push(Date.now());
          await sleep(1000);
          const u = new URL(input);
          if (u.searchParams.get('sort') === 'DESC') return page([2000]);
          const cursor = Number(u.searchParams.get('trade_number') ?? 0);
          if (cursor === 100) {
            failedAt = Date.now();
            return failure === 'http'
              ? new Response('', { status: 401 })
              : Response.json({ invalid: true });
          }
          return page(sequence(cursor + 1, Math.min(cursor + 100, 2000)));
        },
      });
    if (failure === 'http') expect((await clocked(run)).stopped).toContain('HTTP 401');
    else await expect(clocked(run)).rejects.toThrow();
    expect(starts.every((start) => start < failedAt)).toBe(true);
    const progress = progressSchema.parse(
      JSON.parse(f.objects.get(`staging/ticks/running_trade/${day}/progress.json`)!.toString()),
    );
    expect(progress.chunks.length).toBeGreaterThan(0);
    expect(progress).toMatchObject({
      phase: 'bulk',
      lanes: [
        expect.objectContaining({ cursor: 100 }),
        expect.anything(),
        expect.anything(),
        expect.anything(),
      ],
    });
    const resumed = await fixture({ objects: f.objects });
    const result = await clocked(() =>
      collectTicks({
        ...resumed,
        request: async (input) => {
          const cursor = Number(new URL(input).searchParams.get('trade_number') ?? 0);
          return page(sequence(cursor + 1, Math.min(cursor + 100, 2000)));
        },
      }),
    );
    expect(result.published).toEqual([`running_trade/${day}`]);
    expect(await rows(resumed, 'running_trade')).toHaveLength(2000);
  },
);
it('resumes a checkpoint interrupted while other lanes are advancing', async () => {
  const f = await fixture();
  const key = `staging/ticks/running_trade/${day}/progress.json`;
  f.hooks.afterPut = (name) => {
    if (name === key) throw new Error('checkpoint interrupted');
  };
  const request = async (input: string) => {
    const u = new URL(input);
    if (u.searchParams.get('sort') === 'DESC') return page([40000]);
    const cursor = Number(u.searchParams.get('trade_number') ?? 0);
    return page(sequence(cursor + 1, Math.min(cursor + 100, 40000)));
  };
  await expect(collectTicks({ ...f, request })).rejects.toThrow('checkpoint interrupted');
  const progress = progressSchema.parse(JSON.parse(f.objects.get(key)!.toString()));
  expect(progress.chunks).toHaveLength(1);
  const chunk = progress.chunks[0];
  const [bounds] = await sql(`SELECT min(trade_number)::INTEGER lo, max(trade_number)::INTEGER hi
    FROM read_parquet('${f.data}/staging/ticks/running_trade/${day}/${chunk}')`);
  expect(chunk).toBe(`chunk-0-${Number(bounds.lo)}-${Number(bounds.hi)}.parquet`);
  const resumed = await fixture({ objects: f.objects });
  expect((await collectTicks({ ...resumed, request })).published).toEqual([`running_trade/${day}`]);
  expect(await rows(resumed, 'running_trade')).toHaveLength(40000);
});
it('takes the closing sequence from the highest number in the final second, not its first row', async () => {
  const f = await fixture();
  const request = async (input: string) => {
    const u = new URL(input);
    if (u.searchParams.get('sort') === 'DESC') return page([203, 205, 204]);
    const cursor = Number(u.searchParams.get('trade_number') ?? 0);
    return page(sequence(cursor + 1, Math.min(cursor + 100, 205)));
  };
  expect((await collectTicks({ ...f, request })).published).toEqual([`running_trade/${day}`]);
  expect(await rows(f, 'running_trade')).toHaveLength(205);
});
it('raises a saved closing sequence that a later page proves too low', async () => {
  const f = await fixture();
  let closing = 200;
  const request = async (input: string) => {
    const u = new URL(input);
    if (u.searchParams.get('sort') === 'DESC') return page([closing]);
    const cursor = Number(u.searchParams.get('trade_number') ?? 0);
    return page(sequence(cursor + 1, Math.min(cursor + 100, 205)));
  };
  const first = await collectTicks({ ...f, deadline: Date.now() + 1200, request });
  expect(first.stopped).toBe('Tick time budget reached');
  closing = 205;
  const resumed = await fixture({ objects: f.objects });
  expect((await collectTicks({ ...resumed, request })).published).toEqual([`running_trade/${day}`]);
  expect(await rows(resumed, 'running_trade')).toHaveLength(205);
});
it('recovers a successful daily upload when its response was lost, without overwriting it', async () => {
  const f = await fixture();
  let once = true;
  f.hooks.afterPut = (key) => {
    if (once && key === `ticks/running_trade/${day}.parquet`) {
      once = false;
      throw new Error('lost response');
    }
  };
  await expect(collectTicks({ ...f, request: async () => page([1]) })).rejects.toThrow(
    'lost response',
  );
  const resumed = await fixture({ objects: f.objects });
  const request = vi.fn(async () => page([1]));
  await collectTicks({ ...resumed, request });
  expect(request).not.toHaveBeenCalled();
  expect([...f.objects.keys()].some((k) => k.startsWith('staging/'))).toBe(false);
  expect(resumed.puts.some((p) => p.key === `ticks/running_trade/${day}.parquet`)).toBe(false);
});
it('never publishes an empty history response or a crawl with far more gaps than cancellations explain', async () => {
  const f = await fixture();
  await collectTicks({ ...f, request: async () => page([]) });
  expect(f.objects.has(`ticks/running_trade/${day}.parquet`)).toBe(false);
  const g = await fixture();
  await collectTicks({ ...g, request: async () => page([1000]) });
  expect(g.objects.has(`ticks/running_trade/${day}.parquet`)).toBe(false);
  expect(report.mock.calls.some(([e]) => String(e).includes('999 running trades missing'))).toBe(
    true,
  );
  const progress = JSON.parse(
    g.objects.get(`staging/ticks/running_trade/${day}/progress.json`)!.toString(),
  );
  expect(progress).toMatchObject({ phase: 'bulk', lanes: tradeLanes(1000), repairs: 0 });
});
it('publishes a day whose few missing trade numbers Stockbit never serves, and records them', async () => {
  const f = await fixture();
  const request = vi.fn(async (input: string) => {
    const u = new URL(input);
    if (u.searchParams.get('sort') === 'DESC') return page([5]);
    return Number(u.searchParams.get('trade_number') ?? 0) === 0 ? page([1, 2, 4, 5]) : page([]);
  });
  expect((await collectTicks({ ...f, request })).published).toEqual([`running_trade/${day}`]);
  expect(request).toHaveBeenCalledTimes(1 + 10 + 2 * 2);
  expect(
    await sql(
      `SELECT decode(key) AS key, decode(value) AS value FROM parquet_kv_metadata('${f.data}/ticks/running_trade/${day}.parquet') ORDER BY 1`,
    ),
  ).toEqual([
    { key: 'expected', value: '5' },
    { key: 'missing', value: '3' },
  ]);
});
it('captures every book level first, preserves an empty book header, and then backfills newest first', async () => {
  vi.setSystemTime(new Date(`${day}T09:20:00Z`));
  const dates = ['2025-12-31', '2026-01-02', '2026-01-05', day];
  const f = await fixture({ dates });
  const calls: string[] = [];
  await collectTicks({
    ...f,
    request: async (input) => {
      const u = new URL(input);
      calls.push(
        u.pathname.includes('orderbook')
          ? u.pathname.split('/').at(-1)!
          : u.searchParams.get('date')!,
      );
      if (u.pathname.includes('orderbook')) {
        const raw = await book(u.pathname.split('/').at(-1));
        if (raw.data.symbol === 'ZERO') {
          raw.data.bid = [];
          raw.data.offer = [];
        }
        return Response.json(raw);
      }
      return page([1]);
    },
  });
  expect(calls.slice(0, 2)).toEqual(['SINI', 'ZERO']);
  expect([...new Set(calls.slice(2))]).toEqual(['2026-01-05', '2026-01-02']);
  const levels = await rows(f, 'closing_book');
  expect(levels.filter((r) => r.ticker === 'ZERO')).toHaveLength(1);
  expect(levels.filter((r) => r.ticker === 'ZERO')[0].record_type).toBe('snapshot');
  expect(levels.find((r) => r.side === 'bid' && Number(r.level) === 1)?.shares).toBe('6000');
  const published = JSON.parse(
    gunzipSync(f.objects.get(`site/ticks/SINI/${day}.book.json.gz`)!).toString(),
  );
  expect(published.bid[0]).toEqual([7650, 2, 6000]);
  expect(
    JSON.parse(gunzipSync(f.objects.get(`site/ticks/ZERO/${day}.book.json.gz`)!).toString()),
  ).toMatchObject({ bid: [], offer: [] });
});
it('waits until 16:30 WIB for the latest running trade, then visits older missing sessions newest first', async () => {
  vi.setSystemTime(new Date(`${day}T10:00:00Z`));
  const f = await fixture({ dates: ['2026-01-02', '2026-01-05', day], tickers: ['SINI'] });
  const calls: string[] = [];
  await collectTicks({
    ...f,
    request: async (input) => {
      const u = new URL(input);
      if (u.pathname.includes('orderbook')) return Response.json(await book());
      calls.push(u.searchParams.get('date')!);
      return page([1]);
    },
  });
  expect([...new Set(calls)]).toEqual([day, '2026-01-05', '2026-01-02']);
});
it('does not publish a book whose date mismatches or whose capture crosses the next pre-open', async () => {
  vi.setSystemTime(new Date('2026-11-10T01:44:59.900Z'));
  const f = await fixture({ tickers: ['SINI'] });
  await collectTicks({
    ...f,
    deadline: Date.now() + 500,
    request: async (input) => {
      if (input.includes('orderbook')) {
        vi.setSystemTime(new Date('2026-11-10T01:45:00Z'));
        return Response.json(await book());
      }
      return page([1]);
    },
  });
  expect(f.objects.has(`ticks/closing_book/${day}.parquet`)).toBe(false);
  expect(report.mock.calls.some(([e]) => String(e).includes('Missed closing book'))).toBe(true);
  vi.setSystemTime(new Date(`${day}T10:00:00Z`));
  const g = await fixture({ tickers: ['SINI'] });
  const raw = await book();
  raw.data.date = '2026-11-06';
  await expect(collectTicks({ ...g, request: async () => Response.json(raw) })).rejects.toThrow(
    'target mismatch',
  );
  expect(g.objects.has(`ticks/closing_book/${day}.parquet`)).toBe(false);
});
it('alerts once per dataset and date at the next pre-open and never attempts book backfill', async () => {
  const f = await fixture();
  const request = vi.fn(async (_url: string, _until: number) => page([]));
  await collectTicks({ ...f, request });
  expect(report).toHaveBeenCalledTimes(2);
  const resumed = await fixture({ objects: f.objects });
  await collectTicks({ ...resumed, request });
  expect(report).toHaveBeenCalledTimes(2);
  expect(request.mock.calls.every(([url]) => !url.includes('orderbook'))).toBe(true);
});
it('uses observed IDX sessions for holidays and excludes dates outside 2026', () => {
  expect(tradingSessions(['2025-12-31', '2026-01-02', '2026-01-02', '2027-01-04'])).toEqual([
    '2026-01-02',
  ]);
  expect(nextPreOpen('2026-03-18', ['2026-03-18', '2026-03-25'])).toBe(
    Date.parse('2026-03-25T01:45:00Z'),
  );
  expect(nextPreOpen('2026-11-06', [])).toBe(Date.parse('2026-11-09T01:45:00Z'));
});
it('shares a single broker authentication with running trades and books', async () => {
  vi.setSystemTime(new Date(`${day}T10:00:00Z`));
  const f = await fixture({ tickers: ['SINI'] });
  f.objects.set('auth/stockbit.json', Buffer.from('{"refresh":"synthetic-refresh"}'));
  let refreshes = 0;
  let ticks = 0;
  const result = await brokers({
    ...f,
    accountId: 'fake',
    token: join(f.data, 'token.json'),
    out: join(f.data, 'out'),
    fetcher: async (input, init) => {
      const u = new URL(input instanceof Request ? input.url : input);
      if (u.pathname === '/login/refresh') {
        refreshes++;
        return Response.json({
          data: { access: { token: 'synthetic-access' }, refresh: { token: 'synthetic-next' } },
        });
      }
      const headers = new Headers(init?.headers);
      expect(headers.get('Authorization')).toBe('Bearer synthetic-access');
      expect(headers.get('User-Agent')).toContain('Chrome');
      if (u.pathname.includes('running-trade') || u.pathname.includes('orderbook')) {
        ticks++;
        expect(headers.get('x-platform')).toBe('web');
        return u.pathname.includes('orderbook') ? Response.json(await book()) : page([1]);
      }
      if (u.pathname.endsWith('/top'))
        return Response.json({
          data: {
            date: { from: u.searchParams.get('from'), to: u.searchParams.get('to') },
            list: [],
          },
        });
      return Response.json({
        data: {
          from: day,
          to: day,
          bandar_detector: { total_buyer: 0, total_seller: 0 },
          broker_summary: { symbol: 'SINI', brokers_buy: [], brokers_sell: [] },
        },
      });
    },
  });
  expect(refreshes).toBe(1);
  expect(ticks).toBe(6);
  expect(result.ticks?.published).toEqual([`closing_book/${day}`, `running_trade/${day}`]);
});

it('stores negotiated fractional lots as exact shares', () => {
  const [negotiated] = parseTradePage(
    { data: { running_trade: [{ ...trade(1), market_board: 'NG', lot: '664,646.65' }] } },
    day,
  );
  expect(negotiated?.shares).toBe(66464665);
});
