import { describe, expect, it } from 'vite-plus/test';
import { corporateActions, fetchCorporateActions } from './idx-calendar';
import { activeSuspensions, fetchRisk, notations } from './risk';

const stocks = new Set(['BMAS', 'TAPG', 'AGRS', 'ALTO', 'ARMY', 'AKKU', 'INPS', 'SQMI', 'WSBP']);
const row = (title: string, description: string, start: string, extra = {}) => ({
  title,
  description,
  start: start + 'T00:00:00',
  Jenis: '',
  TglWaktuRups: '1911-01-01T00:00:00',
  ...extra,
});

describe('corporate actions', () => {
  it('groups dated steps into one action and keeps meetings with their time', () => {
    const actions = corporateActions(
      [
        row('BMAS', 'tanggal ex HMETD PT Bank Kasikorn Indonesia Tbk', '2026-11-24'),
        row('BMAS', 'tanggal cum HMETD PT Bank Kasikorn Indonesia Tbk', '2026-11-23'),
        row('BMAS', 'tanggal awal perdagangan hmetd PT Bank Kasikorn Indonesia Tbk', '2026-11-27'),
        row(
          'TAPG',
          'tanggal Pembayaran Dividen Tunai Interim PT Triputra Agro Persada Tbk.',
          '2026-11-27',
        ),
        row('AGRS', 'Pemberitahuan RUPS Rencana  PT Bank IBK Indonesia Tbk.', '2026-11-30', {
          Jenis: 'Rencana',
          TglWaktuRups: '2026-11-30T13:30:00',
        }),
        row('DJPU', 'Pencatatan obligasi seri SPN', '2026-11-06', { Jenis: 'pencatatanAwal' }),
        row('BMAS', 'Laporan Pembelian Kembali Saham (Buyback)', '2026-11-20'),
      ],
      stocks,
      '2026-11-01',
    );
    expect(actions).toEqual([
      {
        ticker: 'BMAS',
        kind: 'RIGHTS',
        label: 'Rights issue',
        steps: [
          { step: 'cum', date: '2026-11-23' },
          { step: 'ex', date: '2026-11-24' },
          { step: 'trade_start', date: '2026-11-27' },
        ],
      },
      {
        ticker: 'TAPG',
        kind: 'DIV',
        label: 'Interim dividend',
        steps: [{ step: 'pay', date: '2026-11-27' }],
      },
      {
        ticker: 'AGRS',
        kind: 'RUPS',
        label: 'Shareholder meeting',
        steps: [{ step: 'meeting', date: '2026-11-30T13:30' }],
      },
    ]);
  });

  it('drops actions whose last step is before the window', () => {
    const rows = [
      row('TAPG', 'tanggal cum Dividen Tunai PT Triputra Agro Persada Tbk.', '2026-10-01'),
    ];
    expect(corporateActions(rows, stocks, '2026-11-01')).toEqual([]);
  });
});

describe('suspension notices', () => {
  it('takes multi-stock codes from the published notices and lists the ones not read yet', async () => {
    const list = (Results: object[]) =>
      new TextEncoder().encode(JSON.stringify({ ResultCount: Results.length, Results }));
    const suspension = (Kode: string, Data_Download: string, Date: string) => ({
      Judul: 'Suspensi',
      Kode,
      Date,
      Info_Type: 'SPT',
      Data_Download,
    });
    const download = async (input: string) =>
      input.includes('GetSpecialNotation')
        ? list([])
        : input.includes('GetUma')
          ? list([])
          : list([
              suspension('WSBP', '/single.pdf', '2026-11-02T08:00:00'),
              suspension('>1 Kode', '/read.pdf', '2026-11-03T08:00:00'),
              suspension('>1 Kode', '/new.pdf', '2026-11-04T08:00:00'),
            ]);
    const { risk, errors } = await fetchRisk(
      stocks,
      {
        '/read.pdf': { codes: ['ALTO', 'GONE'], reason: 'Late financial statements' },
      },
      download,
    );
    expect(Object.keys(risk).sort()).toEqual(['ALTO', 'WSBP']);
    expect(risk.ALTO?.susp).toMatchObject({ reason: 'Late financial statements' });
    expect(errors).toEqual(['1 multi-stock suspension notice not read yet (2026-11-04)']);
  });

  it('keeps a stock suspended until a later resume notice names it', () => {
    const n = (date: string, type: 'SPT' | 'UPT', codes: string[]) => ({
      date,
      type,
      reason: null,
      url: 'https://www.idx.co.id/' + date,
      codes,
    });
    const active = activeSuspensions([
      n('2026-11-04T06:10', 'SPT', ['ALTO', 'ARMY']),
      n('2026-09-01T08:00', 'SPT', ['SQMI']),
      n('2026-11-05T08:00', 'UPT', ['ARMY']),
    ]);
    expect([...active.keys()].sort()).toEqual(['ALTO', 'SQMI']);
  });
});

it('splits special notation descriptions by code', () => {
  expect(
    notations(
      'E : Laporan keuangan terakhir menunjukkan ekuitas negatif| X : Perusahaan Tercatat dicatatkan di Papan Pemantauan Khusus ',
    ),
  ).toEqual([
    { code: 'E', text: 'Laporan keuangan terakhir menunjukkan ekuitas negatif' },
    { code: 'X', text: 'Perusahaan Tercatat dicatatkan di Papan Pemantauan Khusus' },
  ]);
});

it('fetches adjacent calendar months across a year boundary and rejects incomplete pages', async () => {
  const urls: string[] = [];
  const download = async (url: string) => {
    urls.push(url);
    return new TextEncoder().encode(JSON.stringify({ ResultCount: 0, Results: [] }));
  };
  expect(
    await fetchCorporateActions(stocks, download, new Date('2026-01-01T00:30:00+07:00')),
  ).toEqual([]);
  expect(urls.map((u) => new URL(u, 'https://www.idx.id').searchParams.get('date'))).toEqual([
    '20251201',
    '20260101',
    '20260201',
  ]);
  await expect(
    fetchCorporateActions(stocks, async () =>
      new TextEncoder().encode(JSON.stringify({ ResultCount: 1, Results: [] })),
    ),
  ).rejects.toThrow('Incomplete IDX calendar');
});

it.each(['GetSpecialNotation', 'GetSuspension', 'GetUma'])(
  'rejects an incomplete %s risk list',
  async (endpoint) => {
    await expect(
      fetchRisk(stocks, {}, async (url) =>
        new TextEncoder().encode(
          JSON.stringify({ ResultCount: url.includes(endpoint) ? 1 : 0, Results: [] }),
        ),
      ),
    ).rejects.toThrow('Incomplete IDX');
  },
);

it('publishes only flagged stocks and keeps the latest UMA and resume state', async () => {
  const result = await fetchRisk(stocks, {}, async (url) => {
    const Results = url.includes('GetSpecialNotation')
      ? [
          { EmitenCode: 'BMAS', Notation: '', Date: '2026-11-01', Description: '' },
          {
            EmitenCode: 'ALTO',
            Notation: 'E',
            Date: '2026-11-01',
            Description: 'E : Negative equity',
          },
        ]
      : url.includes('GetUma')
        ? ['2026-11-03', '2026-11-01'].map((UMADate) => ({
            CompanyID: 'ALTO',
            UMADate,
            Attachment: '/uma.pdf',
            Judul: '',
          }))
        : [
            {
              Kode: 'ALTO',
              Date: '2026-11-01',
              Info_Type: 'SPT',
              Data_Download: '/susp.pdf',
              Judul: '',
            },
            {
              Kode: 'ALTO',
              Date: '2026-11-02',
              Info_Type: 'UPT',
              Data_Download: '/resume.pdf',
              Judul: '',
            },
          ];
    return new TextEncoder().encode(JSON.stringify({ ResultCount: Results.length, Results }));
  });
  expect(result).toEqual({
    errors: [],
    risk: {
      ALTO: {
        notes: [{ code: 'E', text: 'Negative equity' }],
        susp: null,
        uma: { date: '2026-11-03', url: 'https://www.idx.co.id/uma.pdf' },
      },
    },
  });
});
