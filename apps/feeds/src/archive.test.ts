import { describe, expect, it } from 'vite-plus/test';
import {
  GOOGLE_SOURCE,
  archiveKey,
  canonicalLink,
  mergeMonth,
  monthOf,
  publishArchive,
  tickerKey,
} from './archive';
import type { Bucket } from './collector';
import { archiveSchema, tickerNewsSchema, type ArchiveArticle } from './contracts';

const article = (
  n: number,
  fields: Partial<ArchiveArticle> = {},
  day = String(n).padStart(2, '0'),
): ArchiveArticle => ({
  ts: `2026-11-${day}T03:00:00.000Z`,
  src: 'CNBC Indonesia',
  title: `Berita rekaan ${n}`,
  link: `https://news.example.test/market/${n}`,
  tags: [],
  source_id: 'cnbc-id',
  ...fields,
});

function memoryBucket(failOn?: (key: string) => boolean) {
  const files = new Map<string, string>();
  const puts: string[] = [];
  const bucket: Bucket = {
    async get(key) {
      const text = files.get(key);
      return text ? { json: async (): Promise<unknown> => JSON.parse(text) } : null;
    },
    async put(key, value) {
      if (failOn?.(key)) throw new Error('R2 write HTTP 503');
      puts.push(key);
      files.set(key, value);
    },
  };
  return { bucket, files, puts };
}
const now = new Date('2026-11-20T00:00:00Z');
const archived = (files: Map<string, string>, month: string) =>
  archiveSchema.parse(JSON.parse(files.get(archiveKey(month)) ?? 'null')).articles;
const indexed = (files: Map<string, string>, ticker: string) =>
  tickerNewsSchema.parse(JSON.parse(files.get(tickerKey(ticker)) ?? 'null')).news;

describe('article identity', () => {
  it('treats spellings of one link as one article', () => {
    const forms = [
      'https://www.example.test/market/1',
      'http://example.test/market/1/',
      'https://EXAMPLE.test/market/1?utm_source=rss&utm_medium=feed',
      'https://example.test/market/1#komentar',
      'https://example.test/market/1?fbclid=abc',
    ];
    expect(new Set(forms.map(canonicalLink)).size).toBe(1);
    expect(canonicalLink('https://example.test/read?id=1')).not.toBe(
      canonicalLink('https://example.test/read?id=2'),
    );
  });
  it('files an article under its Jakarta month', () => {
    expect(monthOf('2026-10-31T16:59:59.000Z')).toBe('2026-10');
    expect(monthOf('2026-10-31T17:00:00.000Z')).toBe('2026-11');
  });
});

describe('merging a month', () => {
  it('keeps one record per link, newest first, and reports only real changes', () => {
    const first = mergeMonth(
      [],
      [article(1), article(2), article(1, { link: 'http://www.news.example.test/market/1/' })],
    );
    expect(first.articles.map((a) => a.title)).toEqual(['Berita rekaan 2', 'Berita rekaan 1']);
    expect(first.changes).toHaveLength(2);
    const again = mergeMonth(first.articles, [article(2), article(1)]);
    expect(again.changes).toEqual([]);
    expect(again.articles).toEqual(first.articles);
  });
  it('retags an archived article and reports both tag sets', () => {
    const { articles } = mergeMonth([], [article(1, { tags: ['BBCA'] })]);
    const retagged = mergeMonth(articles, [article(1, { tags: ['BBCA', 'BBRI'] })]);
    expect(retagged.articles[0]?.tags).toEqual(['BBCA', 'BBRI']);
    expect(retagged.changes).toMatchObject([{ before: ['BBCA'], after: ['BBCA', 'BBRI'] }]);
  });
  it('drops a Google article that a feed already carries under its own link', () => {
    const feed = article(1, { title: 'BBCA Cetak Laba Rp 50 T', tags: ['BBCA'] });
    const google = article(
      2,
      {
        title: 'BBCA cetak laba Rp 50 T',
        link: 'https://news.google.test/rss/articles/abc',
        source_id: GOOGLE_SOURCE,
        tags: ['BBCA'],
      },
      '01',
    );
    expect(mergeMonth([feed], [google]).articles).toEqual([feed]);
    expect(mergeMonth([], [google, feed]).articles).toEqual([feed]);
    const late = mergeMonth([google], [feed]);
    expect(late.articles).toEqual([feed]);
    expect(late.changes).toContainEqual({ article: google, before: ['BBCA'], after: [] });
  });
});

describe('publishing the archive', () => {
  const tagged = [
    article(1, { tags: ['BBCA'] }),
    article(2, { tags: ['BBCA', 'BBRI'] }),
    article(3),
    article(4, { ts: '2026-10-31T17:30:00.000Z', tags: ['BBRI'] }, '31'),
  ];
  it('writes the months and each ticker index it touched, and nothing on a repeat', async () => {
    const { bucket, files, puts } = memoryBucket();
    expect(await publishArchive(bucket, tagged, now)).toEqual({
      articles: 4,
      months: 1,
      tickers: 2,
    });
    expect(archived(files, '2026-11').map((a) => a.title)).toEqual([
      'Berita rekaan 3',
      'Berita rekaan 2',
      'Berita rekaan 1',
      'Berita rekaan 4',
    ]);
    expect(indexed(files, 'BBCA').map((row) => row.title)).toEqual([
      'Berita rekaan 2',
      'Berita rekaan 1',
    ]);
    expect(indexed(files, 'BBRI').map((row) => row.title)).toEqual([
      'Berita rekaan 2',
      'Berita rekaan 4',
    ]);
    expect(indexed(files, 'BBCA')[0]).toEqual({
      title: 'Berita rekaan 2',
      url: 'https://news.example.test/market/2',
      published_at: '2026-11-02T03:00:00.000Z',
      source: 'CNBC Indonesia',
    });
    puts.length = 0;
    expect(
      await publishArchive(bucket, [...tagged].reverse(), new Date('2026-11-21T00:00:00Z')),
    ).toEqual({
      articles: 0,
      months: 0,
      tickers: 0,
    });
    expect(puts).toEqual([]);
  });
  it('merges into what an earlier run left, in either order of arrival', async () => {
    const whole = memoryBucket();
    await publishArchive(whole.bucket, tagged, now);
    const split = memoryBucket();
    await publishArchive(split.bucket, tagged.slice(2), now);
    await publishArchive(split.bucket, tagged.slice(0, 2), now);
    expect(archived(split.files, '2026-11')).toEqual(archived(whole.files, '2026-11'));
    expect(indexed(split.files, 'BBCA')).toEqual(indexed(whole.files, 'BBCA'));
    expect(indexed(split.files, 'BBRI')).toEqual(indexed(whole.files, 'BBRI'));
  });
  it('converges after a run dies between the index and the archive writes', async () => {
    const clean = memoryBucket();
    await publishArchive(clean.bucket, tagged, now);
    const broken = memoryBucket((key) => key.startsWith('news/archive/'));
    await expect(publishArchive(broken.bucket, tagged, now)).rejects.toThrow('R2 write HTTP 503');
    expect(broken.files.has(tickerKey('BBCA'))).toBe(true);
    expect(broken.files.has(archiveKey('2026-11'))).toBe(false);
    const retry = memoryBucket();
    for (const [key, value] of broken.files) retry.files.set(key, value);
    await publishArchive(retry.bucket, tagged, now);
    expect(archived(retry.files, '2026-11')).toEqual(archived(clean.files, '2026-11'));
    expect(indexed(retry.files, 'BBCA')).toEqual(indexed(clean.files, 'BBCA'));
    expect(indexed(retry.files, 'BBRI')).toEqual(indexed(clean.files, 'BBRI'));
  });
  it('moves an article between ticker indexes when its tags change', async () => {
    const { bucket, files } = memoryBucket();
    await publishArchive(bucket, tagged, now);
    await publishArchive(bucket, [article(2, { tags: ['BBRI'] })], now);
    expect(indexed(files, 'BBCA').map((row) => row.title)).toEqual(['Berita rekaan 1']);
    expect(indexed(files, 'BBRI').map((row) => row.title)).toEqual([
      'Berita rekaan 2',
      'Berita rekaan 4',
    ]);
  });
  it('splits months by Jakarta date', async () => {
    const { bucket, files } = memoryBucket();
    await publishArchive(bucket, [article(1, { ts: '2026-10-31T17:30:00.000Z' }), article(2)], now);
    expect(archived(files, '2026-11')).toHaveLength(2);
    await publishArchive(bucket, [article(3, { ts: '2026-10-31T16:30:00.000Z' })], now);
    expect(archived(files, '2026-10').map((a) => a.title)).toEqual(['Berita rekaan 3']);
  });
  it('refuses to overwrite an archive it cannot read', async () => {
    const { bucket, files, puts } = memoryBucket();
    files.set(archiveKey('2026-11'), '{"month":"2026-11"}');
    await expect(publishArchive(bucket, tagged, now)).rejects.toThrow();
    expect(puts).toEqual([]);
  });
});
