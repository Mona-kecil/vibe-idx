import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vite-plus/test';
import { multiStockNotices, noticeCodes, noticeReason, readNotice } from './suspensions';

const numbered = `ANNOUNCEMENT
Temporary Suspension of Securities Trading
Sanctions for the Submission of Interim Financial Statement as of 30 June 2026
For Listed Companies on the Main Board and Development Board
No. Peng-S-00036/BEI.PLP/11-2026
Based on our monitoring, there are 3 (three) Listed Companies
1. ALTO PT Tri Banyan Tirta Tbk Suspension in Regular and Cash Markets
2. ARMY PT Armidian Karyatama Tbk Suspension in All Markets
3. GONE PT Delisted Since Tbk Suspension in All Markets
`;

describe('suspension notices', () => {
  it('keeps only notices that list several stocks and rejects a truncated list', () => {
    const list = {
      ResultCount: 2,
      Results: [
        { Kode: 'MKNT', Data_Download: '/single.pdf' },
        { Kode: '>1 Kode', Data_Download: '/multi.pdf' },
      ],
    };
    expect(multiStockNotices(list)).toEqual(['/multi.pdf']);
    expect(() => multiStockNotices({ ...list, ResultCount: 3 })).toThrow('Incomplete');
  });

  it('reads numbered lists, checks the stated count, and keeps every code', () => {
    expect(noticeCodes(numbered)).toEqual(['ALTO', 'ARMY', 'GONE']);
    expect(noticeReason(numbered)).toBe(
      'Sanctions for the Submission of Interim Financial Statement as of 30 June 2026',
    );
    expect(() => noticeCodes(numbered.replace('3 (three)', '4 (four)'))).toThrow('lists 3 of 4');
  });

  it('reads unnumbered tables and prose notices', () => {
    expect(
      noticeCodes(
        'Kode Perusahaan Tercatat Papan Pencatatan Sesi\nAKKU PT Anugerah Kagum Karya Utama Tbk Pemantauan Khusus\nINPS PT Indah Prakasa Sentosa Tbk Pemantauan Khusus\n',
      ),
    ).toEqual(['AKKU', 'INPS']);
    expect(
      noticeCodes(
        'kewajiban PT Wilton Makmur Indonesia Tbk (“SQMI”) yang menjadi penyebab\nmaka Bursa mencabut Suspensi Efek SQMI di Pasar Reguler',
      ),
    ).toEqual(['SQMI']);
    expect(() => noticeCodes('Pengumuman tanpa kode')).toThrow('names no securities');
  });

  it('reads every stock and the reason from a real IDX notice PDF', async () => {
    const notice = await readNotice(
      readFileSync(new URL('../fixtures/suspension-notice-2026-annual.pdf', import.meta.url)),
    );
    expect(notice.codes).toHaveLength(71);
    expect(notice.codes.slice(0, 4)).toEqual(['AIMS', 'ALTO', 'ARKA', 'ARMY']);
    expect(notice.reason).toBe(
      'Sanksi Penyampaian Laporan Keuangan Auditan Tahunan per 31 Desember 2025 Untuk Perusahaan Tercatat di Papan Utama dan Papan Pengembangan',
    );
  }, 30000);
});
