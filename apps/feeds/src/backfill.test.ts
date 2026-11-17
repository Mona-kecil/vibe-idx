import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vite-plus/test';
import { archiveKey, tickerKey } from './archive';
import {
  backfill,
  collectTicker,
  lookback,
  parts,
  parseGoogle,
  politeGoogle,
  queryFor,
  retag,
} from './backfill';
import { memoryBucket } from './memory-bucket';
import { archiveSchema, tickerNewsSchema } from './contracts';
import { cover, type Progress } from './progress';
import { tickerTagger } from './tagging';

const settledFiles = (files: Map<string, { text: string }>) =>
  [...files].map(([key, { text }]) => [key, text.replace(/"as_of":"[^"]*"/, '')]);

const fixture = (name: string) =>
  readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8');
const bbca = { ticker: 'BBCA', name: 'PT Bank Central Asia Tbk.' };
const tickers = [bbca, { ticker: 'DATA', name: 'Remala Abadi Tbk' }];
const tag = tickerTagger(tickers);

const now = new Date('2026-11-17T05:00:00Z');

describe('Google News pages', () => {
  it('drops the publisher suffix and the headlines no ticker names', () => {
    const { articles } = parseGoogle(fixture('google-news.xml'), tag);
    expect(articles.map((a) => [a.title, a.src, a.tags, a.source_id])).toEqual([
      ['Saham BBCA Menguat Jelang Rilis Laba', 'Kontan.co.id', ['BBCA'], 'google-news'],
      ['Bank Central Asia Siapkan Dividen', 'Bisnis.com', ['BBCA'], 'google-news'],
    ]);
    expect(articles[0]?.link).toBe('https://news.google.test/rss/articles/AAA111?oc=5');
  });
  it('reads a page without items as empty', () => {
    expect(parseGoogle(fixture('google-empty.xml'), tag)).toEqual({ articles: [] });
  });
  it('asks for the ticker, its code with saham, and its company, one day wider on each side', () => {
    expect(queryFor(bbca, { from: '2026-10-01', to: '2026-10-31' })).toBe(
      '("saham BBCA" OR "BBCA saham" OR "Bank Central Asia") after:2026-09-30 before:2026-11-02',
    );
  });
});

describe('windows', () => {
  it('cuts a window into fixed parts that cover every day once', () => {
    expect(parts({ from: '2026-10-01', to: '2026-10-31' }, 10)).toEqual([
      { from: '2026-10-01', to: '2026-10-10' },
      { from: '2026-10-11', to: '2026-10-20' },
      { from: '2026-10-21', to: '2026-10-30' },
      { from: '2026-10-31', to: '2026-10-31' },
    ]);
    expect(parts({ from: '2026-10-01', to: '2026-10-01' }, 30)).toHaveLength(1);
  });
  it('asks once per part', async () => {
    const queries: string[] = [];
    await collectTicker(
      bbca,
      { from: '2026-09-01', to: '2026-11-17' },
      30,
      async (q) => {
        queries.push(q);
        return fixture('google-empty.xml');
      },
      tag,
    );
    expect(queries).toHaveLength(3);
    expect(queries[0]).toContain('after:2026-08-31');
  });
  it('looks back a number of Jakarta months', () => {
    expect(lookback(new Date('2026-11-17T20:00:00Z'), 12)).toEqual({
      from: '2025-11-18',
      to: '2026-11-18',
    });
  });
});

describe('polite requests', () => {
  it('spaces requests and backs off on 429 using Retry-After', async () => {
    const pauses: number[] = [];
    const answers = [
      new Response(null, { status: 429, headers: { 'Retry-After': '120' } }),
      new Response('<rss/>'),
      new Response('<rss/>'),
    ];
    const get = vi.fn<typeof fetch>(async () => answers.shift()!);
    const fetchPage = politeGoogle({ get, delay: 1000, sleep: async (ms) => void pauses.push(ms) });
    expect(await fetchPage('a')).toBe('<rss/>');
    expect(await fetchPage('b')).toBe('<rss/>');
    expect(get).toHaveBeenCalledTimes(3);
    expect(pauses).toContain(120000);
    expect(pauses.filter((ms) => ms < 1300 && ms >= 1000).length).toBeGreaterThanOrEqual(1);
  });
  it('gives up after repeated refusals and on other errors', async () => {
    const refuse = politeGoogle({
      get: async () => new Response(null, { status: 503 }),
      sleep: async () => {},
      attempts: 3,
    });
    await expect(refuse('a')).rejects.toThrow('Google News HTTP 503');
    const missing = politeGoogle({
      get: async () => new Response(null, { status: 404 }),
      sleep: async () => {},
    });
    await expect(missing('a')).rejects.toThrow('Google News HTTP 404');
  });
});

describe('backfilling the archive', () => {
  const window = { from: '2026-10-01', to: '2026-11-17' };
  const fetchPage = async () => fixture('google-news.xml');
  it('writes through the shared merge and writes nothing the second time', async () => {
    const { bucket, files, text } = memoryBucket();
    const finished: Progress[] = [];
    const first = await backfill({
      bucket,
      tickers,
      window,
      fetchPage,
      tag,
      now,
      finished: async (done) => void finished.push(done),
    });
    expect(first).toEqual({ tickers: 2, articles: 2 });
    expect(finished).toEqual([{ BBCA: [window], DATA: [window] }]);
    expect(
      archiveSchema.parse(JSON.parse(text(archiveKey('2026-11')) ?? '')).articles,
    ).toHaveLength(2);
    expect(
      tickerNewsSchema.parse(JSON.parse(text(tickerKey('BBCA', '2026-11')) ?? '')).news,
    ).toHaveLength(2);
    const before = new Map(files);
    const again = await backfill({ bucket, tickers, window, fetchPage, tag, now });
    expect(again).toEqual({ tickers: 2, articles: 0 });
    expect(settledFiles(files)).toEqual(settledFiles(before));
  });
  it('skips tickers already done and keeps only articles inside the window', async () => {
    const { bucket } = memoryBucket();
    const asked: string[] = [];
    const totals = await backfill({
      bucket,
      tickers,
      window: { from: '2026-11-04', to: '2026-11-04' },
      fetchPage: async (q) => (asked.push(q), fixture('google-news.xml')),
      tag,
      now,
      covered: { BBCA: [{ from: '2026-11-04', to: '2026-11-04' }] },
    });
    expect(asked).toHaveLength(1);
    expect(asked[0]).toContain('Remala Abadi');
    expect(totals).toEqual({ tickers: 1, articles: 1 });
  });
  it('resumes against the window asked for: a longer window adds only the older dates', async () => {
    const { bucket } = memoryBucket();
    const covered: Progress = {};
    const asked: string[] = [];
    const run = (from: string, to: string) =>
      backfill({
        bucket,
        tickers: [bbca],
        window: { from, to },
        fetchPage: async (q) => (asked.push(q), fixture('google-news.xml')),
        tag,
        now,
        covered,
        finished: async (done) => {
          for (const [code, windows] of Object.entries(done))
            covered[code] = windows.reduce(cover, covered[code] ?? []);
        },
      });
    await run('2026-10-18', '2026-11-17');
    expect(asked).toHaveLength(2);
    asked.length = 0;
    await run('2026-10-18', '2026-11-17');
    expect(asked).toEqual([]);
    await run('2025-11-17', '2026-11-17');
    expect(asked).toHaveLength(Math.ceil(335 / 30));
    expect(asked.every((q) => q.slice(-10) <= '2026-10-19')).toBe(true);
    expect(covered.BBCA).toEqual([{ from: '2025-11-17', to: '2026-11-17' }]);
    asked.length = 0;
    await run('2026-11-10', '2026-11-18');
    expect(asked).toHaveLength(1);
    expect(asked[0]).toContain('after:2026-11-17');
  });
  it('retags Google articles fully and feed articles only upward', async () => {
    const { bucket, text, set } = memoryBucket();
    const article = (source_id: string, link: string, tags: string[]) => ({
      ts: '2026-11-04T03:00:00.000Z',
      src: 'Kontan',
      title: 'Saham BBCA Menguat',
      link,
      tags,
      source_id,
    });
    set(
      archiveKey('2026-11'),
      JSON.stringify({
        month: '2026-11',
        as_of: now.toISOString(),
        articles: [
          article('google-news', 'https://news.google.test/a', ['DATA']),
          article('kontan', 'https://kontan.example.test/b', ['DATA']),
        ],
      }),
    );
    expect(await retag(bucket, ['2026-11'], tag, now)).toBe(2);
    const stored = archiveSchema.parse(JSON.parse(text(archiveKey('2026-11')) ?? '')).articles;
    expect(Object.fromEntries(stored.map((a) => [a.source_id, a.tags]))).toEqual({
      'google-news': ['BBCA'],
      kontan: ['BBCA', 'DATA'],
    });
    expect(await retag(bucket, ['2026-11'], tag, now)).toBe(0);
  });
});
