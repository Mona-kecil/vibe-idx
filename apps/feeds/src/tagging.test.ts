import { describe, expect, it } from 'vite-plus/test';
import { tickerTagger } from './tagging';

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
  { ticker: 'ASLI', name: 'Asri Karya Lestari Tbk' },
  { ticker: 'MUTU', name: 'Mutuagung Lestari Tbk' },
  { ticker: 'KONI', name: 'Perdana Bangun Pusaka Tbk' },
  { ticker: 'CSIS', name: 'Cahayasakti Investindo Sukses Tbk' },
  { ticker: 'LAPD', name: 'Leyand International Tbk' },
  { ticker: 'META', name: 'Nusantara Infrastructure Tbk' },
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

  it('carries a stock list to its word-like codes', () => {
    expect(tag('Saham BBCA, BBRI dan BMRI Kompak Menguat')).toEqual(['BBCA', 'BBRI', 'BMRI']);
    expect(tag('Emiten ASII & DATA & DART, Rilis Laporan')).toEqual(['ASII', 'DART', 'DATA']);
    expect(tag('Rekomendasi Hari Ini: BBCA, VIVA, TLKM, dan MEGA')).toEqual([
      'BBCA',
      'MEGA',
      'TLKM',
      'VIVA',
    ]);
    expect(tag('Saham BBCA turun, DATA center Bekasi dibuka')).toEqual(['BBCA']);
    expect(tag('BBCA dan AUTO pilot Tesla')).toEqual([]);
    expect(tag('Saham BBCA, BUMI menguat')).toEqual(['BBCA', 'BUMI']);
    expect(tag('SAHAM BBCA, BBRI TURUN')).toEqual(['BBCA', 'BBRI']);
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

  it.each([
    ['Produk ASLI Indonesia memiliki MUTU tinggi', []],
    ['KONI Siapkan Atlet untuk Kompetisi Nasional', []],
    ['CSIS Bahas Hubungan Indonesia dan Amerika', []],
    ['LAPD Tangkap Pelaku Kejahatan di Los Angeles', []],
    ['Meta Platforms ($META) Rilis Laporan Keuangan', []],
    ['Meta Platforms (META) Rilis Laporan Keuangan', []],
    ['Nusantara Infrastructure (META) Rilis Laporan Keuangan', ['META']],
    ['Saham ASLI, MUTU, KONI, CSIS dan LAPD menguat', ['ASLI', 'CSIS', 'KONI', 'LAPD', 'MUTU']],
    ['Cahayasakti Investindo Sukses Perluas Usaha', ['CSIS']],
    ['MUTU (Mutuagung Lestari) Perluas Layanan', ['MUTU']],
  ])('%s', (text, expected) => expect(tag(text)).toEqual(expected));
});
