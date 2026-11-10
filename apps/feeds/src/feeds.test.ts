import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vite-plus/test';
import { cleanHTML, parseRSS, parseForexFactory, parseBI, parseBPSReleases } from './parsers';
import { tickerTagger } from './tagging';
import { collect, refresh, type Bucket, type Source } from './collector';
import { newsSources, request } from './sources';
import { report as sentryReport } from './sentry';
import { newsSchema } from './contracts';

const fixture = (name: string) =>
  readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8');
const tickers = [
  { ticker: 'BBCA', name: 'Bank Central Asia Tbk' },
  { ticker: 'BBRI', name: 'PT Bank Rakyat Indonesia (Persero) Tbk' },
  { ticker: 'DATA', name: 'Remala Abadi Tbk' },
  { ticker: 'AUTO', name: 'Astra Otoparts Tbk' },
  { ticker: 'ADRO', name: 'Alamtri Resources Indonesia Tbk' },
  { ticker: 'AADI', name: 'Adaro Andalan Indonesia Tbk' },
  { ticker: 'BMRI', name: 'Bank Mandiri (Persero) Tbk' },
  { ticker: 'PTRO', name: 'Petrosea Tbk' },
  { ticker: 'TINS', name: 'PT TIMAH (Persero) Tbk' },
  { ticker: 'INDF', name: 'Indofood Sukses Makmur Tbk' },
  { ticker: 'ICBP', name: 'Indofood CBP Sukses Makmur Tbk' },
];
const tag = tickerTagger(tickers);
describe('company tagging', () => {
  it.each([
    ['Bank Central Asia menguji produk', ['BBCA']],
    ['PT Bank Rakyat Indonesia (Persero) Tbk menguji produk', ['BBRI']],
    ['Saham BBCA menguat; emiten BBRI naik', ['BBCA', 'BBRI']],
    ['BBCA BBRI DATA AUTO meluncur', []],
    ['DATA inflasi dan rasio CASA membaik', []],
    ['DATA SAHAM HARI INI', []],
    ['AUTO pilot digunakan dan mandiri dalam bekerja', []],
    ['Ekonomi mandiri tumbuh, grup Adaro bertemu', []],
    ['Alamtri Resources Indonesia merilis laporan', ['ADRO']],
    ['Adaro Andalan Indonesia merilis laporan', ['AADI']],
    ['Indofood CBP Sukses Makmur menguji produk', ['ICBP']],
    ['Saham AUTO dan emiten DATA menguat', ['AUTO', 'DATA']],
    ['Bank Central Asiana berbeda dari bank lokal', []],
    ['Pasar saham berbasis DATA dan kendaraan AUTO', []],
    ['PT Petrosea membahas rencana rekaan', ['PTRO']],
    ['PT TIMAH (Persero) Tbk membahas rencana rekaan', ['TINS']],
    ['Hasil timah meningkat di pelabuhan', []],
    ['Bank Mandiri menyampaikan laporan', ['BMRI']],
  ])('%s', (text, expected) => expect(tag(text)).toEqual(expected));
});
describe('source parsers', () => {
  it('cleans only RSS summaries and never uses content:encoded', () => {
    const rows = parseRSS(fixture('rss.xml'), { id: 'example', src: 'Example', region: 'ID' }, tag);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      sum: 'Ringkasan rekaan & informasi.',
      tags: ['BBCA'],
      ts: '2026-11-09T03:00:00.000Z',
    });
    expect(rows[1]?.sum).toBe('');
    expect(JSON.stringify(rows)).not.toContain('invented body');
  });
  it('decodes entities, strips scripts, and keeps full publisher summary', () => {
    expect(cleanHTML('<p>A&nbsp;B</p><style>bad</style><p>C &lt; D</p>')).toBe('A B C < D');
    const long = 'Summary '.repeat(100);
    expect(
      parseRSS(
        fixture('rss.xml').replace(
          'Ringkasan <b>rekaan</b> &amp; informasi.<script>bad()</script>',
          long,
        ),
        { id: 'world', src: 'Example', region: 'WORLD' },
        tag,
      )[0]?.sum,
    ).toBe(long.trim());
  });
  it.each(['<html>blocked</html>', '<rss><channel></channel></rss>', '<rss>'])(
    'rejects broken or empty feeds',
    (xml) => {
      expect(() => parseRSS(xml, { id: 'x', src: 'x', region: 'ID' }, tag)).toThrow();
    },
  );
  it('filters FF impact and preserves timezone and values', () => {
    const events = parseForexFactory(JSON.parse(fixture('ff.json')));
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      ts: '2026-11-09T13:30:00.000Z',
      c: 'US',
      imp: 3,
      f: '3%',
      p: '2%',
    });
    expect(() => parseForexFactory([])).toThrow();
  });
  it('reads every BI RDG decision day and makes unknown times explicit', () => {
    const events = parseBI(fixture('bi.html'), 2026);
    expect(events).toHaveLength(12);
    expect(events[10]).toMatchObject({ ts: '2026-11-17T17:00:00.000Z', ev: 'BI rate decision' });
    expect(events.every((e) => e.est?.includes('Date only'))).toBe(true);
    expect(() => parseBI(fixture('bi.html'), 2027)).toThrow();
    expect(() => parseBI(fixture('bi.html').replace('17-18', 'missing'), 2026)).toThrow();
  });
  it('parses BPS WebAPI public metadata', () => {
    const result = parseBPSReleases(JSON.parse(fixture('bps-releases.json')));
    expect(result.pages).toBe(2);
    expect(result.events).toHaveLength(2);
    expect(() => parseBPSReleases({ status: 'Error', data: [] })).toThrow();
  });
});
const now = new Date('2026-11-09T06:00:00Z');
const row = (source_id: string, value: number) => ({ source_id, ts: now.toISOString(), value });
describe('publication failure isolation', () => {
  it('retains only the failed source part and its last good timestamp, then recovers', async () => {
    const calls: string[] = [],
      report = async (id: string) => {
        calls.push(id);
      };
    const first = await refresh(
      ['a', 'b'].map((id) => ({ id, interval: 0, load: async () => [row(id, 1)] })),
      null,
      now,
      report,
    );
    const later = new Date(now.getTime() + 600e3);
    const sources: Source<ReturnType<typeof row>>[] = [
      {
        id: 'a',
        interval: 0,
        load: async () => {
          throw new Error('unavailable');
        },
      },
      { id: 'b', interval: 0, load: async () => [row('b', 2)] },
    ];
    const second = await refresh(sources, first, later, report);
    expect(second?.items.map((r) => [r.source_id, r.value])).toEqual([
      ['a', 1],
      ['b', 2],
    ]);
    expect(second?.sources.a).toMatchObject({
      status: 'stale',
      as_of: now.toISOString(),
      attempted_at: later.toISOString(),
    });
    expect(second?.sources.b?.as_of).toBe(later.toISOString());
    expect(calls).toEqual(['a']);
    const recovered = await refresh(
      [{ id: 'a', interval: 0, load: async () => [row('a', 3)] }],
      second,
      later,
      report,
    );
    expect(recovered?.sources.a?.status).toBe('ready');
  });
  it('does not publish an empty document when every source fails on bootstrap', async () => {
    expect(
      await refresh(
        [
          {
            id: 'a',
            interval: 0,
            load: async () => {
              throw new Error();
            },
          },
        ],
        null,
        now,
        async () => {},
      ),
    ).toBeNull();
  });
  it('keeps aggregate and per-source as_of when every source fails', async () => {
    const first = await refresh(
      [{ id: 'a', interval: 0, load: async () => [row('a', 1)] }],
      null,
      now,
      async () => {},
    );
    const later = new Date(now.getTime() + 600e3);
    const failed = await refresh(
      [
        {
          id: 'a',
          interval: 0,
          load: async () => {
            throw new Error();
          },
        },
      ],
      first,
      later,
      async () => {},
    );
    expect(failed?.as_of).toBe(first?.as_of);
    expect(failed?.items).toEqual(first?.items);
  });
  it('does not refetch a fresh calendar source', async () => {
    let calls = 0;
    const sources = [
      {
        id: 'a',
        interval: 3600e3,
        load: async () => {
          calls++;
          return [row('a', 1)];
        },
      },
    ];
    const first = await refresh(sources, null, now, async () => {});
    await refresh(sources, first, new Date(now.getTime() + 600e3), async () => {});
    expect(calls).toBe(1);
  });
  it('refreshes world feeds when ticker lookup fails', async () => {
    const sources = newsSources(
      async () => {
        throw new Error('no tickers');
      },
      async () => new Response(fixture('rss.xml')),
    );
    const result = await refresh(sources, null, now, async () => {});
    expect(Object.values(result?.sources ?? {}).filter((s) => s.status === 'ready')).toHaveLength(
      4,
    );
    expect(result?.sources.antara?.status).toBe('unavailable');
  });
  it('runs the collector with the real parsers, writes public shapes, and isolates calendar failure', async () => {
    const memory = new Map<string, string>([['tickers.json', JSON.stringify(tickers)]]);
    const bucket: Bucket = {
      async get(key) {
        const s = memory.get(key);
        return s ? { json: async (): Promise<unknown> => JSON.parse(s) } : null;
      },
      async put(key, value) {
        memory.set(key, value);
      },
    };
    const failures: string[] = [];
    await collect({
      bucket,
      bpsKey: '',
      now,
      report: async (source) => {
        failures.push(source);
      },
      get: async (url) => {
        if (url.includes('bi.go.id')) return new Response(fixture('bi.html'));
        if (url.includes('faireconomy')) return Response.json(JSON.parse(fixture('ff.json')));
        return new Response(fixture('rss.xml'));
      },
    });
    expect(newsSchema.parse(JSON.parse(memory.get('news.json') ?? 'null')).news).toHaveLength(12);
    expect(memory.has('calendar.json')).toBe(true);
    expect(failures).toEqual(['bps']);
  });
});

describe('credential-safe diagnostics', () => {
  it('removes credential-bearing fetch errors and response bodies', async () => {
    const mock = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('https://webapi.bps.go.id/key/private-test-token/'));
    try {
      await expect(request('https://webapi.bps.go.id/key/private-test-token/')).rejects.toThrow(
        'Network request failed',
      );
      mock.mockResolvedValue(new Response('private-test-token', { status: 403 }));
      await expect(request('https://webapi.bps.go.id/key/private-test-token/')).rejects.toThrow(
        'HTTP 403 webapi.bps.go.id GET',
      );
    } finally {
      mock.mockRestore();
    }
  });
  it('sends a Sentry envelope without arbitrary error text', async () => {
    const mock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 200 }));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await sentryReport(
        'https://public-test-key@sentry.example/123',
        'bps',
        new Error('private-test-token'),
      );
      expect(mock).toHaveBeenCalledOnce();
      const body = mock.mock.calls[0]?.[1]?.body;
      expect(typeof body).toBe('string');
      expect(body).toContain('"source":"bps"');
      expect(body).not.toContain('private-test-token');
      expect(log.mock.calls.flat().join()).not.toContain('private-test-token');
    } finally {
      mock.mockRestore();
      log.mockRestore();
    }
  });
});
