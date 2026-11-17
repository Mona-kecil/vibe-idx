import { describe, expect, it } from 'vite-plus/test';
import {
  GOOGLE_SOURCE,
  archiveKey,
  canonicalLink,
  mergeMonth,
  monthOf,
  publishArchive,
  recentMonths,
  tickerKey,
} from './archive';
import { memoryBucket } from './memory-bucket';
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
const google = (n: number, fields: Partial<ArchiveArticle> = {}) =>
  article(n, {
    link: `https://news.google.test/rss/articles/${n}`,
    source_id: GOOGLE_SOURCE,
    ...fields,
  });

const now = new Date('2026-11-20T00:00:00Z');
const archived = (text: (key: string) => string | undefined, month: string) =>
  archiveSchema.parse(JSON.parse(text(archiveKey(month)) ?? 'null')).articles;
const indexed = (text: (key: string) => string | undefined, ticker: string, month = '2026-11') =>
  tickerNewsSchema.parse(JSON.parse(text(tickerKey(ticker, month)) ?? 'null')).news;

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
  it('treats the AMP form of a page as the page', () => {
    const forms = [
      'https://example.test/market/story',
      'https://example.test/market/story/amp',
      'https://example.test/market/story/amp/',
      'https://example.test/market/story?amp=1',
      'https://example.test/market/story?outputType=amp',
      'https://amp.example.test/market/story',
      'https://www.example.test/amp/market/story',
    ];
    expect(new Set(forms.map(canonicalLink)).size).toBe(1);
    expect(canonicalLink('https://example.test/campaign/stamp')).not.toBe(
      canonicalLink('https://example.test/campaign'),
    );
  });
  it('files an article under its Jakarta month', () => {
    expect(monthOf('2026-10-31T16:59:59.000Z')).toBe('2026-10');
    expect(monthOf('2026-10-31T17:00:00.000Z')).toBe('2026-11');
  });
  it('looks at the month of a run and the month before', () => {
    expect(recentMonths(new Date('2026-11-17T12:00:00Z'))).toEqual(['2026-10', '2026-11']);
    expect(recentMonths(new Date('2027-01-31T20:00:00Z'))).toEqual(['2027-01', '2027-02']);
  });
});

describe('merging a month', () => {
  it('keeps one record per link, newest first, and reports only real changes', () => {
    const first = mergeMonth(
      [],
      [
        article(1),
        article(2),
        article(1, { link: 'http://www.news.example.test/market/1/' }),
        article(1, { link: 'https://news.example.test/market/1/amp' }),
      ],
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
  describe('a Google article and the feed article it copies', () => {
    const feed = article(1, { title: 'BBCA Cetak Laba Rp 50 T', tags: ['BBCA'] });
    const copy = google(2, {
      title: 'BBCA cetak laba Rp 50 T',
      ts: '2026-11-01T03:20:00.000Z',
      tags: ['BBCA'],
    });
    it('is one article whichever arrives first', () => {
      expect(mergeMonth([feed], [copy]).articles).toEqual([feed]);
      expect(mergeMonth([], [copy, feed]).articles).toEqual([feed]);
      const late = mergeMonth([copy], [feed]);
      expect(late.articles).toEqual([feed]);
      expect(late.changes).toContainEqual({ article: copy, before: ['BBCA'], after: [] });
    });
    it('is one article when Google names the publisher at greater length', () => {
      const antara = article(3, { src: 'Antara', title: 'IHSG ditutup menguat' });
      const named = google(4, { src: 'Antara News', title: 'IHSG ditutup menguat', ts: antara.ts });
      expect(mergeMonth([antara], [named]).articles).toEqual([antara]);
    });
    it('keeps a story of another publisher under the same headline', () => {
      const other = google(5, { ...copy, src: 'Bisnis.com' });
      expect(mergeMonth([feed], [other]).articles).toHaveLength(2);
      expect(mergeMonth([other], [feed]).articles).toHaveLength(2);
    });
    it('keeps a repeat of the headline a day later', () => {
      const later = google(6, { ...copy, ts: '2026-11-02T03:00:00.000Z' });
      expect(mergeMonth([feed], [later]).articles).toHaveLength(2);
      expect(mergeMonth([later], [feed]).articles).toHaveLength(2);
    });
  });
});

describe('publishing the archive', () => {
  const tagged = [
    article(1, { tags: ['BBCA'] }),
    article(2, { tags: ['BBCA', 'BBRI'] }),
    article(3),
    article(4, { ts: '2026-10-31T17:30:00.000Z', tags: ['BBRI'] }, '31'),
  ];
  it('writes the months and each ticker file it touched, and nothing on a repeat', async () => {
    const { bucket, text, puts } = memoryBucket();
    expect(await publishArchive(bucket, tagged, now)).toEqual({
      articles: 4,
      months: 1,
      tickers: 2,
    });
    expect(archived(text, '2026-11').map((a) => a.title)).toEqual([
      'Berita rekaan 3',
      'Berita rekaan 2',
      'Berita rekaan 1',
      'Berita rekaan 4',
    ]);
    expect(JSON.parse(text(archiveKey('2026-11')) ?? '').dirty).toBe(false);
    expect(indexed(text, 'BBCA').map((row) => row.title)).toEqual([
      'Berita rekaan 2',
      'Berita rekaan 1',
    ]);
    expect(indexed(text, 'BBRI').map((row) => row.title)).toEqual([
      'Berita rekaan 2',
      'Berita rekaan 4',
    ]);
    expect(indexed(text, 'BBCA')[0]).toEqual({
      title: 'Berita rekaan 2',
      url: 'https://news.example.test/market/2',
      published_at: '2026-11-02T03:00:00.000Z',
      source: 'CNBC Indonesia',
    });
    puts.length = 0;
    expect(
      await publishArchive(bucket, [...tagged].reverse(), new Date('2026-11-21T00:00:00Z'), [
        '2026-10',
        '2026-11',
      ]),
    ).toEqual({ articles: 0, months: 0, tickers: 0 });
    expect(puts).toEqual([]);
  });
  it('keeps a ticker file to one year', async () => {
    const { bucket, text } = memoryBucket();
    await publishArchive(
      bucket,
      [
        article(1, { tags: ['BBCA'] }),
        article(2, { ts: '2025-12-30T03:00:00.000Z', tags: ['BBCA'] }),
        article(3, { ts: '2025-03-01T03:00:00.000Z', tags: ['BBCA'] }),
      ],
      now,
    );
    expect(indexed(text, 'BBCA', '2026-11')).toHaveLength(1);
    expect(indexed(text, 'BBCA', '2025-12').map((row) => row.title)).toEqual([
      'Berita rekaan 2',
      'Berita rekaan 3',
    ]);
  });
  it('merges into what an earlier run left, in either order of arrival', async () => {
    const whole = memoryBucket();
    await publishArchive(whole.bucket, tagged, now);
    const split = memoryBucket();
    await publishArchive(split.bucket, tagged.slice(2), now);
    await publishArchive(split.bucket, tagged.slice(0, 2), now);
    expect(archived(split.text, '2026-11')).toEqual(archived(whole.text, '2026-11'));
    expect(indexed(split.text, 'BBCA')).toEqual(indexed(whole.text, 'BBCA'));
    expect(indexed(split.text, 'BBRI')).toEqual(indexed(whole.text, 'BBRI'));
  });
  it('moves an article between ticker files when its tags change', async () => {
    const { bucket, text } = memoryBucket();
    await publishArchive(bucket, tagged, now);
    await publishArchive(bucket, [article(2, { tags: ['BBRI'] })], now);
    expect(indexed(text, 'BBCA').map((row) => row.title)).toEqual(['Berita rekaan 1']);
    expect(indexed(text, 'BBRI').map((row) => row.title)).toEqual([
      'Berita rekaan 2',
      'Berita rekaan 4',
    ]);
  });
  it('splits months by Jakarta date', async () => {
    const { bucket, text } = memoryBucket();
    await publishArchive(bucket, [article(1, { ts: '2026-10-31T17:30:00.000Z' }), article(2)], now);
    expect(archived(text, '2026-11')).toHaveLength(2);
    await publishArchive(bucket, [article(3, { ts: '2026-10-31T16:30:00.000Z' })], now);
    expect(archived(text, '2026-10').map((a) => a.title)).toEqual(['Berita rekaan 3']);
  });
  it('refuses to overwrite an archive it cannot read', async () => {
    const { bucket, set, puts } = memoryBucket();
    set(archiveKey('2026-11'), '{"month":"2026-11"}');
    await expect(publishArchive(bucket, tagged, now)).rejects.toThrow();
    expect(puts).toEqual([]);
  });
});

/** Everything a bucket holds, without the times it was written. */
const settled = (files: Map<string, { text: string }>) =>
  Object.fromEntries(
    [...files].map(([key, { text }]) => {
      const { as_of: _, ...rest } = JSON.parse(text) as Record<string, unknown>;
      return [key, rest];
    }),
  );

/** Whether every ticker file holds exactly the rows of the archive, and no month is marked unfinished. */
function inAgreement(files: Map<string, { text: string }>) {
  const expected = new Map<string, string[]>();
  for (const [key, { text }] of files) {
    if (!key.startsWith('news/archive/')) continue;
    const archive = archiveSchema.parse(JSON.parse(text));
    if (archive.dirty) return `${archive.month} is dirty`;
    for (const a of archive.articles)
      for (const ticker of a.tags)
        expected.set(`${ticker}/${archive.month.slice(0, 4)}`, [
          ...(expected.get(`${ticker}/${archive.month.slice(0, 4)}`) ?? []),
          a.link,
        ]);
  }
  const found = new Map<string, string[]>();
  for (const [key, { text }] of files) {
    const match = /^news\/ticker\/(\w+)\/(\d{4})\.json$/.exec(key);
    if (match)
      found.set(
        `${match[1]}/${match[2]}`,
        tickerNewsSchema.parse(JSON.parse(text)).news.map((r) => r.url),
      );
  }
  for (const key of new Set([...expected.keys(), ...found.keys()]))
    if ([...(expected.get(key) ?? [])].sort().join() !== [...(found.get(key) ?? [])].sort().join())
      return `${key} disagrees with the archive`;
  return null;
}

const random = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const yieldsLike = (seed: number) => {
  const next = random(seed);
  return async () => {
    for (let i = Math.floor(next() * 8); i > 0; i--) await new Promise((r) => setImmediate(r));
  };
};

describe('writers at the same moment', () => {
  const novBBCA = (n: number) => article(n, { tags: ['BBCA'] });
  const scenarios: Record<string, [ArchiveArticle[], ArchiveArticle[]]> = {
    'one month, one ticker': [[novBBCA(1)], [novBBCA(2)]],
    'one month, two tickers': [[novBBCA(1)], [article(2, { tags: ['BBRI'] })]],
    'two months, one ticker': [
      [novBBCA(1)],
      [article(2, { ts: '2026-10-15T03:00:00.000Z', tags: ['BBCA'] })],
    ],
    'a feed article and its Google copy': [
      [novBBCA(1)],
      [google(2, { title: 'Berita rekaan 1', tags: ['BBCA'] })],
    ],
  };
  for (const [name, [first, second]] of Object.entries(scenarios))
    it(`lose nothing: ${name}`, async () => {
      const serial = memoryBucket();
      await publishArchive(serial.bucket, [...first, ...second], now);
      for (let seed = 0; seed < 40; seed++) {
        const wait = yieldsLike(seed);
        const run = memoryBucket(wait);
        await Promise.all([
          publishArchive(run.bucket, first, now),
          publishArchive(run.bucket, second, now),
        ]);
        expect(inAgreement(run.files), `seed ${seed}`).toBeNull();
        expect(settled(run.files), `seed ${seed}`).toEqual(settled(serial.files));
      }
    });
  it('lose nothing when one finishes while the other is about to read a ticker file', async () => {
    const run = memoryBucket();
    let reached!: () => void;
    const slow = new Promise<void>((resolve) => (reached = resolve));
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const held = {
      put: (...args: Parameters<typeof run.bucket.put>) => run.bucket.put(...args),
      async get(key: string) {
        if (key.startsWith('news/ticker/')) {
          reached();
          await gate;
        }
        return run.bucket.get(key);
      },
    };
    const first = publishArchive(held, [novBBCA(1)], now);
    await slow;
    await publishArchive(run.bucket, [novBBCA(2)], now);
    release();
    await first;
    expect(inAgreement(run.files)).toBeNull();
    expect(indexed(run.text, 'BBCA')).toHaveLength(2);
  });
  it('lose nothing when three run at once over many tickers', async () => {
    const batch = (from: number) =>
      Array.from({ length: 6 }, (_, i) =>
        article(from + i, {
          ts: `2026-${i % 2 ? '10' : '11'}-${String(10 + i).padStart(2, '0')}T03:00:00.000Z`,
          tags: [['BBCA', 'BBRI', 'TLKM'][(from + i) % 3]!, 'BMRI'],
        }),
      );
    const serial = memoryBucket();
    await publishArchive(serial.bucket, [...batch(0), ...batch(10), ...batch(20)], now);
    for (let seed = 0; seed < 25; seed++) {
      const run = memoryBucket(yieldsLike(seed));
      await Promise.all([0, 10, 20].map((from) => publishArchive(run.bucket, batch(from), now)));
      expect(inAgreement(run.files), `seed ${seed}`).toBeNull();
      expect(settled(run.files), `seed ${seed}`).toEqual(settled(serial.files));
    }
  });
});

describe('a run that dies at a write', () => {
  const before = [
    article(1, { tags: ['BBCA'] }),
    article(2, { tags: ['BBCA', 'BBRI'] }),
    article(4, { ts: '2026-10-20T03:00:00.000Z', tags: ['BBRI'] }),
    google(7, { title: 'Berita kembar', ts: '2026-11-07T03:00:00.000Z', tags: ['BBCA'] }),
  ];
  const next = [
    article(5, { tags: ['BBRI'] }),
    article(6, { ts: '2026-10-21T03:00:00.000Z', tags: ['BBCA'] }),
    article(2, { tags: ['BBRI'] }),
    article(7, { title: 'Berita kembar', ts: '2026-11-07T03:10:00.000Z', tags: ['BBCA'] }),
  ];
  const months = ['2026-10', '2026-11'];
  const complete = async () => {
    const run = memoryBucket();
    await publishArchive(run.bucket, before, now);
    run.puts.length = 0;
    await publishArchive(run.bucket, next, now);
    return { files: settled(run.files), writes: run.puts.length };
  };

  for (const mode of ['before the write lands', 'after the write lands'] as const)
    it(`converges from the archive alone, ${mode}`, async () => {
      const done = await complete();
      expect(done.writes).toBeGreaterThan(6);
      for (let dies = 0; dies < done.writes; dies++) {
        let count = 0;
        const crashing = memoryBucket();
        await publishArchive(crashing.bucket, before, now);
        let landed = false;
        const failing = {
          get: (key: string) => crashing.bucket.get(key),
          async put(...args: Parameters<typeof crashing.bucket.put>) {
            if (count++ !== dies) return crashing.bucket.put(...args);
            if (mode === 'after the write lands') await crashing.bucket.put(...args);
            landed = true;
            throw new Error('R2 write HTTP 503');
          },
        };
        await expect(publishArchive(failing, next, now, months)).rejects.toThrow(
          'R2 write HTTP 503',
        );
        expect(landed).toBe(true);

        // The next run finds no article to publish, and still leaves every committed archive state indexed.
        await publishArchive(crashing.bucket, [], new Date('2026-11-20T00:15:00Z'), months);
        expect(inAgreement(crashing.files), `dies at write ${dies}`).toBeNull();

        // Whatever never reached the archive is still in the feeds, and publishing it again finishes the job.
        await publishArchive(crashing.bucket, next, new Date('2026-11-20T00:30:00Z'), months);
        expect(settled(crashing.files), `dies at write ${dies}`).toEqual(done.files);
      }
    });

  it('needs no feed article once the archive holds it', async () => {
    const crashing = memoryBucket();
    await publishArchive(crashing.bucket, before, now);
    const failing = {
      get: (key: string) => crashing.bucket.get(key),
      async put(...args: Parameters<typeof crashing.bucket.put>) {
        if (args[0].startsWith('news/ticker/')) throw new Error('R2 write HTTP 503');
        return crashing.bucket.put(...args);
      },
    };
    await expect(publishArchive(failing, next, now, months)).rejects.toThrow('R2 write HTTP 503');
    expect(archived(crashing.text, '2026-11').map((a) => a.title)).toContain('Berita rekaan 5');
    expect(inAgreement(crashing.files)).toMatch(/dirty/);
    await publishArchive(crashing.bucket, [], now, months);
    expect(inAgreement(crashing.files)).toBeNull();
    expect(indexed(crashing.text, 'BBRI').map((row) => row.title)).toContain('Berita rekaan 5');
  });
});
