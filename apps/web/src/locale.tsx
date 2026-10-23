import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type Locale = 'en' | 'id';

const indonesian: Record<string, string> = {
  'IDX anomaly radar': 'Radar anomali saham IDX',
  Prices: 'Harga',
  '5% ownership': 'Kepemilikan 5%',
  '1% ownership': 'Kepemilikan 1%',
  Issuers: 'Emiten',
  Stocks: 'Saham',
  'Daily signals across the market.': 'Sinyal harian di seluruh pasar.',
  'Prices, volume and foreign flows.': 'Harga, volume, dan aliran dana asing.',
  'Data surfaces': 'Halaman data',
  'Latest available data dates': 'Tanggal data terakhir',
  'Loading data…': 'Memuat data…',
  'Could not load data. Reload to try again.': 'Data gagal dimuat. Muat ulang untuk mencoba lagi.',
  'Unknown route': 'Alamat tidak dikenal',
  'Page not found': 'Halaman tidak ditemukan',
  'The requested Vibe IDX page does not exist.': 'Halaman Vibe IDX yang diminta tidak ada.',
  'Volume spikes': 'Lonjakan volume',
  'ARA moves': 'Kenaikan ARA',
  'Foreign buying streaks': 'Pembelian asing beruntun',
  'Green on red': 'Hijau saat pasar merah',
  '5% ownership changes': 'Perubahan kepemilikan 5%',
  'Volume is at least 5× the prior 20-day average, with at least Rp 5 billion traded.':
    'Volume setidaknya 5× rata-rata 20 hari sebelumnya, dengan nilai transaksi minimal Rp 5 miliar.',
  'Price rose at least 34% below Rp 200, 24% below Rp 5,000, or 19% above, based on the previous close.':
    'Harga naik minimal 34% di bawah Rp 200, 24% di bawah Rp 5.000, atau 19% di atasnya, berdasarkan harga penutupan sebelumnya.',
  'Foreign investors bought more than they sold for at least 5 trading days in a row.':
    'Pembelian asing melebihi penjualan selama minimal 5 hari bursa berturut-turut.',
  'The stock rose while IHSG fell at least 2%, with at least Rp 1 billion traded.':
    'Saham naik saat IHSG turun minimal 2%, dengan nilai transaksi minimal Rp 1 miliar.',
  'An investor changed shares or left the 5% list. An exit means a holding fell below 5%.':
    'Investor mengubah kepemilikan atau keluar dari daftar 5%. Keluar berarti kepemilikannya turun di bawah 5%.',
  up: 'naik',
  down: 'turun',
  'Index date': 'Tanggal indeks',
  'No signals.': 'Tidak ada sinyal.',
  shares: 'saham',
  average: 'rata-rata',
  over: 'selama',
  days: 'hari',
  threshold: 'ambang',
  'trading days': 'hari bursa',
  'Net foreign Rp': 'Net asing Rp',
  Stock: 'Saham',
  Since: 'Sejak',
  'below 5%': 'di bawah 5%',
  Exit: 'Keluar',
  Entry: 'Masuk',
  Change: 'Perubahan',
  'Net shares': 'Net saham',
  'All stocks on the latest trading date.': 'Seluruh saham pada hari bursa terakhir.',
  'Filter stocks': 'Cari saham',
  'Ticker or company name': 'Kode saham atau nama perusahaan',
  stocks: 'saham',
  'Click a column to sort.': 'Klik kolom untuk mengurutkan.',
  'Recent trading days': 'Hari bursa terakhir',
  'Current 5% holders': 'Pemegang saham 5% terakhir',
  'Ownership as of': 'Kepemilikan per',
  '5% changes': 'Perubahan 5%',
  'Last 90 days': '90 hari terakhir',
  'Ownership through': 'Kepemilikan sampai',
  'Each change uses its own reporting date.':
    'Setiap perubahan memakai tanggal laporannya sendiri.',
  'No 5% changes in this period.': 'Tidak ada perubahan 5% pada periode ini.',
  'No price history.': 'Belum ada riwayat harga.',
  'Close range': 'Rentang penutupan',
  'No rows for the current filters.': 'Tidak ada baris yang sesuai filter.',
  Ticker: 'Kode',
  Company: 'Perusahaan',
  Close: 'Penutupan',
  Volume: 'Volume',
  'Value (Rp)': 'Nilai (Rp)',
  'Net foreign (Rp)': 'Net asing (Rp)',
  Date: 'Tanggal',
  Investor: 'Investor',
  Shares: 'Saham',
  Holding: 'Kepemilikan',
  'Broker summary': 'Ringkasan broker',
  'Sign in': 'Masuk',
  'Sign out': 'Keluar akun',
  'Sign in to view broker summary': 'Masuk untuk melihat ringkasan broker',
  'Use the one-time code sent to your email.':
    'Gunakan kode sekali pakai yang dikirim ke email Anda.',
  'Signing you in…': 'Memproses masuk…',
  'Could not sign in. Try again.': 'Gagal masuk. Coba lagi.',
  'Broker data is not available yet.': 'Data broker belum tersedia.',
  'Could not load broker data.': 'Data broker gagal dimuat.',
  Retry: 'Coba lagi',
  From: 'Dari',
  Through: 'Sampai',
  Buy: 'Beli',
  Sell: 'Jual',
  Broker: 'Broker',
  'Investor type': 'Jenis investor',
  'Average price': 'Harga rata-rata',
  Frequency: 'Frekuensi',
  'Net value (Rp)': 'Nilai net (Rp)',
  'Buy shares': 'Saham beli',
  'Sell shares': 'Saham jual',
  'Buy value (Rp)': 'Nilai beli (Rp)',
  'Sell value (Rp)': 'Nilai jual (Rp)',
  'Buy average': 'Rata-rata beli',
  'Sell average': 'Rata-rata jual',
  'Buy frequency': 'Frekuensi beli',
  'Sell frequency': 'Frekuensi jual',
  'Missing broker dates': 'Tanggal broker belum terkumpul',
  'No broker data in this date range.': 'Tidak ada data broker pada rentang tanggal ini.',
  'Collected trading days': 'Hari bursa terkumpul',
  'Broker flow is not the broker’s current inventory.':
    'Aliran broker bukan posisi persediaan broker saat ini.',
  'Current 1% holders': 'Pemegang saham 1% terakhir',
  Classification: 'Klasifikasi',
  'Local / foreign': 'Lokal / asing',
  'Disclosures and reports': 'Keterbukaan informasi dan laporan',
  'No disclosures in this period.': 'Tidak ada keterbukaan informasi pada periode ini.',
  'Insider share changes': 'Perubahan saham insider',
  Reporter: 'Pelapor',
  Before: 'Sebelum',
  After: 'Sesudah',
  Source: 'Sumber',
  'Registry report': 'Laporan registrasi',
  'Reported free float': 'Free float yang dilaporkan',
  'Total shares': 'Jumlah saham',
  'SID count': 'Jumlah SID',
  'Not reported': 'Tidak dilaporkan',
  News: 'Berita',
  'Could not load news.': 'Berita gagal dimuat.',
  'No recent news.': 'Belum ada berita terbaru.',
  'News matches the stock code and may include unrelated articles.':
    'Berita dicocokkan dengan kode saham dan dapat memuat artikel yang tidak terkait.',
};

const LocaleContext = createContext<{ locale: Locale; setLocale: (locale: Locale) => void }>({
  locale: 'en',
  setLocale: (_locale: Locale) => {},
});

export function LocaleProvider({
  children,
  initialLocale,
}: {
  children: ReactNode;
  initialLocale?: Locale;
}) {
  const [locale, setLocale] = useState<Locale>(() => {
    if (initialLocale) return initialLocale;
    if (typeof window === 'undefined') return 'en';
    return window.localStorage.getItem('vibe-idx-language') === 'id' ? 'id' : 'en';
  });
  useEffect(() => {
    document.documentElement.lang = locale;
    window.localStorage.setItem('vibe-idx-language', locale);
  }, [locale]);
  return <LocaleContext.Provider value={{ locale, setLocale }}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  const { locale, setLocale } = useContext(LocaleContext);
  return useMemo(() => {
    const number = new Intl.NumberFormat(locale === 'id' ? 'id-ID' : 'en-US');
    const percent = new Intl.NumberFormat(locale === 'id' ? 'id-ID' : 'en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    return {
      locale,
      setLocale,
      t: (text: string) => (locale === 'id' ? (indonesian[text] ?? text) : text),
      n: (value: number | null | undefined) => (value == null ? '-' : number.format(value)),
      p: (value: number | null | undefined) => (value == null ? '-' : `${percent.format(value)}%`),
    };
  }, [locale, setLocale]);
}
