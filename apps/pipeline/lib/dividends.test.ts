import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vite-plus/test';
import { corporateActionSchema } from '../../web/src/data';
import fixtures from '../fixtures/dividends.json';
import { dividendAmounts, readDividend } from './dividends';

const fixture = (name: string) => readFile(new URL(`../fixtures/${name}`, import.meta.url));
const action = (ticker = 'EAST') =>
  corporateActionSchema.parse({
    ticker,
    kind: 'DIV',
    label: 'Interim dividend',
    steps: [{ step: 'pay', date: '2026-11-30' }],
  });
const disclosure = (extra = {}) => ({
  ticker: 'EAST',
  title: 'Jadwal Dividen Tunai Interim',
  published_at: '2026-11-09T08:29:38',
  attachments: [{ name: 'announcement.pdf', url: 'https://www.idx.id/east.pdf', label: null }],
  ...extra,
});

describe('dividend announcements', () => {
  it.each(fixtures)(
    'reads $ticker per-share amount and regular-market dates from its real IDX PDF',
    async (f) => {
      const parsed = await readDividend(await fixture(f.file));
      expect(parsed.amount).toEqual(f.amount);
      expect(parsed.steps.sort((a, b) => a.date.localeCompare(b.date))).toEqual(f.steps);
    },
  );

  it('leaves unsupported document content null instead of treating other values as dividends', async () => {
    expect(await readDividend(await fixture('suspension-notice-2026-annual.pdf'))).toEqual({
      amount: null,
      steps: [],
    });
  });

  it('matches ticker and schedule, fills missing dates, and rejects a different cycle or a stock dividend', async () => {
    const actions = [
      action(),
      action('OTHER'),
      { ...action(), steps: [{ step: 'pay' as const, date: '2026-12-30' }] },
      { ...action(), label: 'Stock dividend' },
    ];
    const { actions: result, errors } = await dividendAmounts(actions, [disclosure()], async () =>
      fixture('dividend-EAST-2026-11-09.pdf'),
    );
    expect(errors).toEqual([]);
    expect(result.map((a) => a.amount)).toEqual([
      { value: 1.6, currency: 'IDR' },
      null,
      null,
      null,
    ]);
    expect(result[0]?.steps).toEqual(fixtures[1]?.steps);
  });

  it('rejects a conflicting shared date even when the payment date agrees', async () => {
    const a = action();
    a.steps.push({ step: 'cum', date: '2026-11-16' });
    const result = await dividendAmounts([a], [disclosure()], async () =>
      fixture('dividend-EAST-2026-11-09.pdf'),
    );
    expect(result.actions[0]?.amount).toBeNull();
  });

  it('uses the newest matching correction and skips other cycles and advertisement proofs', async () => {
    const urls: string[] = [];
    const result = await dividendAmounts(
      [action()],
      [
        disclosure({
          published_at: '2026-11-01T08:00:00',
          attachments: [{ name: 'old.pdf', url: 'https://www.idx.id/old.pdf', label: null }],
        }),
        disclosure({ title: 'Jadwal Dividen Tunai Interim (KOREKSI)' }),
        disclosure({
          published_at: '2026-11-10T08:00:00',
          title: 'Penyampaian Bukti Iklan Jadwal Pembagian Dividen',
        }),
      ],
      async (url) => {
        urls.push(url);
        return fixture('dividend-EAST-2026-11-09.pdf');
      },
    );
    expect(urls).toEqual(['https://www.idx.id/east.pdf']);
    expect(result.actions[0]?.amount).toEqual({ value: 1.6, currency: 'IDR' });
  });

  it('retains actions with a null amount and reports a structural reader failure', async () => {
    const result = await dividendAmounts([action()], [disclosure()], async () =>
      new TextEncoder().encode('invalid PDF'),
    );
    expect(result.actions[0]?.amount).toBeNull();
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.message).toContain('https://www.idx.id/east.pdf');
    expect(result.errors[0]?.cause).toBeInstanceOf(Error);
  });
});
