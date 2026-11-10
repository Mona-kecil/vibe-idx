import { describe, expect, it } from 'vite-plus/test';
import { collectBPS, type Request } from './sources';
import { BPS_HOLIDAYS_URL, parsePublicHolidays } from './bps';
import { calendarEventSchema } from './contracts';

const ics = `BEGIN:VCALENDAR
BEGIN:VEVENT
DTSTART;VALUE=DATE:20260501
DESCRIPTION:Public holiday
END:VEVENT
BEGIN:VEVENT
DTSTART;VALUE=DATE:20260601
DESCRIPTION:Public holiday Joint Holiday
END:VEVENT
BEGIN:VEVENT
DTSTART;VALUE=DATE:20260602
DESCRIPTION:Observance
END:VEVENT
BEGIN:VEVENT
DTSTART;VALUE=DATE:20270101
DESCRIPTION:Public holiday
END:VEVENT
END:VCALENDAR`;
function api(rows: { title: string; rl_date: string; brs_id: number }[] = [], page = 1, pages = 1) {
  return Response.json({
    status: 'OK',
    'data-availability': 'available',
    data: [{ page, pages }, rows],
  });
}
function mockGet(release: () => Response = () => api()): Request {
  return async (url) => {
    if (url === BPS_HOLIDAYS_URL) return new Response(ics);
    expect(new URL(url).hostname).toBe('webapi.bps.go.id');
    return release();
  };
}
describe('BPS expected releases', () => {
  it('uses holidays and weekends for this and next Jakarta month, retaining observances as workdays', async () => {
    const events = await collectBPS(mockGet(), 'test', new Date('2026-04-30T18:00:00Z'));
    const cpi = events.filter((event) => event.ev === 'Perkembangan Indeks Harga Konsumen');
    expect(cpi.map((event) => event.ts)).toEqual([
      '2026-05-03T17:00:00.000Z',
      '2026-06-01T17:00:00.000Z',
    ]);
    expect(events.find((event) => event.ev === 'Pertumbuhan Ekonomi')?.ts).toBe(
      '2026-05-04T17:00:00.000Z',
    );
    for (const event of events) expect(calendarEventSchema.safeParse(event).success).toBe(true);
    expect(cpi[0]?.est).toContain('Expected');
  });
  it('keeps actual releases and removes only their matching expectations, including later API pages', async () => {
    let page = 0;
    const events = await collectBPS(
      mockGet(() =>
        api(
          ++page === 2
            ? [
                {
                  title: 'Inflasi April 2026 sebesar 0,28 persen',
                  rl_date: '2026-05-04',
                  brs_id: 1,
                },
              ]
            : [],
          page,
          2,
        ),
      ),
      'test',
      new Date('2026-05-04'),
    );
    expect(page).toBe(2);
    expect(
      events
        .filter((event) => event.ev === 'Perkembangan Indeks Harga Konsumen')
        .map((event) => event.ts),
    ).toEqual(['2026-06-01T17:00:00.000Z']);
    expect(events.some((event) => event.ev.startsWith('Inflasi April'))).toBe(true);
    expect(
      events.some(
        (event) => event.ev === 'Perkembangan Ekspor dan Impor' && event.ts.startsWith('2026-05'),
      ),
    ).toBe(true);
  });
  it('replaces within the same month or seven days across a month boundary', async () => {
    const events = await collectBPS(
      mockGet(() =>
        api([
          { title: 'Inflasi April 2026', rl_date: '2026-05-20', brs_id: 1 },
          { title: 'Nilai Tukar Petani Mei 2026', rl_date: '2026-05-31', brs_id: 2 },
        ]),
      ),
      'test',
      new Date('2026-05-01'),
    );
    expect(
      events
        .filter((event) => event.ev === 'Perkembangan Indeks Harga Konsumen')
        .map((event) => event.ts),
    ).toEqual(['2026-06-01T17:00:00.000Z']);
    expect(events.some((event) => event.ev === 'Perkembangan Nilai Tukar Petani')).toBe(false);
    expect(events.some((event) => event.ev === 'Indeks Harga Perdagangan Besar')).toBe(true);
  });
  it('expires unmatched expectations only after seven days', async () => {
    const before = await collectBPS(mockGet(), 'test', new Date('2026-05-10T17:00:00Z'));
    const after = await collectBPS(mockGet(), 'test', new Date('2026-05-10T17:00:00.001Z'));
    expect(
      before.some(
        (event) => event.ev === 'Perkembangan Transportasi' && event.ts.startsWith('2026-05'),
      ),
    ).toBe(true);
    expect(
      after.some(
        (event) => event.ev === 'Perkembangan Transportasi' && event.ts.startsWith('2026-05'),
      ),
    ).toBe(false);
    expect(after.some((event) => event.ts.startsWith('2026-06'))).toBe(true);
  });
  it('accepts an API month with no published releases', async () => {
    const events = await collectBPS(
      mockGet(() => Response.json({ status: 'OK', 'data-availability': 'not-available' })),
      'test',
      new Date('2026-05-01'),
    );
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((event) => event.est?.startsWith('Expected'))).toBe(true);
  });
  it('fails the source when the holiday fetch or parsing fails', async () => {
    await expect(
      collectBPS(
        async () => {
          throw new Error('offline');
        },
        'test',
        new Date('2026-05-01'),
      ),
    ).rejects.toThrow('offline');
    await expect(
      collectBPS(async () => new Response('<html>blocked</html>'), 'test', new Date('2026-05-01')),
    ).rejects.toThrow();
    for (const invalid of [
      ics.replace('20260501', '20260230'),
      ics.replace('END:VEVENT', ''),
      ics.replaceAll('Public holiday', 'Observance'),
    ])
      expect(() => parsePublicHolidays(invalid)).toThrow();
  });
  it('rolls next month into the next year', async () => {
    const events = await collectBPS(mockGet(), 'test', new Date('2026-12-01'));
    expect(
      events.find(
        (event) => event.ev === 'Perkembangan Indeks Harga Konsumen' && event.ts.startsWith('2027'),
      )?.ts,
    ).toBe('2027-01-03T17:00:00.000Z');
  });
});
