import { describe, expect, it } from 'vite-plus/test';
import { tickerTagger, wordCodes } from './tagging';

const tickers = [
  { ticker: 'BBCA', name: 'Bank Central Asia Tbk' },
  { ticker: 'BBRI', name: 'PT Bank Rakyat Indonesia (Persero) Tbk' },
  { ticker: 'BMRI', name: 'Bank Mandiri (Persero) Tbk' },
  { ticker: 'TLKM', name: 'Telkom Indonesia (Persero) Tbk' },
  { ticker: 'ASII', name: 'Astra International Tbk' },
  { ticker: 'AUTO', name: 'Astra Otoparts Tbk' },
  { ticker: 'AALI', name: 'Astra Agro Lestari Tbk' },
  { ticker: 'ADRO', name: 'Alamtri Resources Indonesia Tbk' },
  { ticker: 'AADI', name: 'Adaro Andalan Indonesia Tbk' },
  { ticker: 'PBRX', name: 'Pan Brothers Tbk' },
  { ticker: 'PTRO', name: 'Petrosea Tbk' },
  { ticker: 'TINS', name: 'PT TIMAH (Persero) Tbk' },
  { ticker: 'INDF', name: 'Indofood Sukses Makmur Tbk' },
  { ticker: 'ICBP', name: 'Indofood CBP Sukses Makmur Tbk' },
  { ticker: 'BUMI', name: 'Bumi Resources Tbk' },
  { ticker: 'DATA', name: 'Remala Abadi Tbk' },
  { ticker: 'DART', name: 'Duta Anggada Realty Tbk' },
  { ticker: 'VIVA', name: 'Visi Media Asia Tbk' },
  { ticker: 'NASA', name: 'Ayana Land International Tbk' },
  { ticker: 'GOTO', name: 'GoTo Gojek Tokopedia Tbk' },
  { ticker: 'GOTOM', name: 'GoTo Gojek Tokopedia Tbk Seri M' },
  { ticker: 'MEGA', name: 'Bank Mega Tbk' },
];
const tag = tickerTagger(tickers);

describe('company names', () => {
  it.each([
    ['Bank Central Asia menguji produk', ['BBCA']],
    ['PT Bank Rakyat Indonesia (Persero) Tbk menguji produk', ['BBRI']],
    ['Alamtri Resources Indonesia merilis laporan', ['ADRO']],
    ['Adaro Andalan Indonesia merilis laporan', ['AADI']],
    ['Indofood CBP Sukses Makmur menguji produk', ['ICBP']],
    ['Bank Mandiri menyampaikan laporan', ['BMRI']],
    ['PT Petrosea membahas rencana rekaan', ['PTRO']],
    ['PT TIMAH (Persero) Tbk membahas rencana rekaan', ['TINS']],
    ['Telkom Indonesia Tebar Dividen Interim', ['TLKM']],
    ['Astra Otoparts dan Astra International Cetak Laba', ['ASII', 'AUTO']],
    ['Bank Central Asiana berbeda dari bank lokal', []],
    ['Hasil timah meningkat di pelabuhan', []],
    ['Ekonomi mandiri tumbuh, grup Adaro bertemu', []],
    ['Astra Honda Motor Luncurkan Model Baru', []],
    ['Bank Mega Syariah Buka Cabang Baru', ['MEGA']],
  ])('%s', (text, expected) => expect(tag(text)).toEqual(expected));
});

describe('codes with a stock marker', () => {
  it.each([
    ['Saham BBCA menguat; emiten BBRI naik', ['BBCA', 'BBRI']],
    ['Saham AUTO dan emiten DATA menguat', ['AUTO', 'DATA']],
    ['SAHAM DATA HARI INI', ['DATA']],
    ['Rekomendasi Saham Hari Ini: DART Layak Dikoleksi?', []],
    ['Analis Pilih Saham (DART) untuk Akhir Pekan', ['DART']],
    ['Kode saham: BUMI', ['BUMI']],
    ['Duta Anggada Realty Tbk (DART) Bagi Dividen', ['DART']],
    ['Rights issue MEGA Tbk dibuka', ['MEGA']],
    ['Fitch Naikkan Peringkat Pan Brothers (PBRX) Jadi B', ['PBRX']],
    ['Penjelasan Manajemen Indofood (INDF) Soal Harga Mi', ['INDF']],
    ['Duta Anggada (DART) Rilis Obligasi', ['DART']],
    ['Saham GOTOM dan GOTO Dilepas Investor Asing', ['GOTO', 'GOTOM']],
  ])('%s', (text, expected) => expect(tag(text)).toEqual(expected));

  it('chains a stock list from its first marked code', () => {
    expect(tag('Saham BBCA, BBRI dan BMRI Kompak Menguat')).toEqual(['BBCA', 'BBRI', 'BMRI']);
    expect(tag('Emiten ASII & DATA & DART Rilis Laporan')).toEqual(['ASII', 'DART', 'DATA']);
    expect(tag('Saham BBCA turun, DATA center Bekasi dibuka')).toEqual(['BBCA']);
  });
});

describe('bare codes', () => {
  it.each([
    ['BBCA Cetak Laba Rp 50 T, BBRI Menyusul', ['BBCA', 'BBRI']],
    ['Prediksi IHSG Hari Ini, BMRI dan TLKM Jadi Penggerak', ['BMRI', 'TLKM']],
    ['Investor Asing Borong ASII Pekan Ini', ['ASII']],
    ['IHSG, OJK, BUMN dan UMKM Jadi Sorotan', []],
    ['BBCA BBRI DATA AUTO meluncur', ['BBCA', 'BBRI']],
    ['Mengapa DATA dan AUTO Dipilih Pengelola Dana', []],
    ['Pasar saham berbasis DATA dan kendaraan AUTO', []],
    ['DATA inflasi dan rasio CASA membaik', []],
    ['Bumi Makin Panas, BUMI Bukan Penyebabnya', []],
    ['Pesawat NASA dan misi NATO Jadi Berita', []],
    ['VIVA.co.id Laporkan Pergerakan Rupiah', []],
    ['META Rilis Chip AI Baru', []],
    ['IHSG Anjlok, BBCA BBRI TLKM BMRI IKUT TERSERET', ['BBCA', 'BBRI', 'BMRI', 'TLKM']],
    ['IHSG ANJLOK, BBCA BBRI TURUN', []],
    ['Harga $BBCA Menguat', ['BBCA']],
    ['bbca tidak dikenali dalam huruf kecil', []],
    ['BBCAX bukan kode', []],
  ])('%s', (text, expected) => expect(tag(text)).toEqual(expected));

  it('keeps every word-like code out of the bare rule', () => {
    for (const code of ['DATA', 'AUTO', 'DART', 'VIVA', 'NASA', 'BUMI', 'MEGA'])
      expect(wordCodes.has(code)).toBe(true);
    for (const code of ['BBCA', 'BBRI', 'BMRI', 'TLKM', 'ASII', 'ADRO', 'GOTO', 'PBRX'])
      expect(wordCodes.has(code)).toBe(false);
  });
});
