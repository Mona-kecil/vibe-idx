import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type Locale = 'en' | 'id';

const indonesian: Record<string, string> = {
  'No records in this view.': 'Tidak ada catatan dalam tampilan ini.',
  'Net foreign · est.': 'Net asing · estimasi',
  Value: 'Nilai',
  'Volume / 20D average': 'Volume / rata-rata 20H',
  'Not enough history': 'Riwayat belum cukup',
  'Reported holdings': 'Kepemilikan yang dilaporkan',
  'Δ shares': 'Δ saham',
  'Dated disclosed holdings only. Names are kept as reported; missing values remain unknown.':
    'Hanya kepemilikan yang dilaporkan dengan tanggal. Nama sesuai laporan; nilai kosong tetap tidak diketahui.',
  Prices: 'Harga',
  '5% ownership': 'Kepemilikan 5%',
  '1% ownership': 'Kepemilikan 1%',
  Issuers: 'Emiten',
  Stocks: 'Saham',
  'Loading data…': 'Memuat data…',
  'Could not load data. Reload to try again.': 'Data gagal dimuat. Muat ulang untuk mencoba lagi.',
  'Volume spikes': 'Lonjakan volume',
  'ARA moves': 'Kenaikan ARA',
  'Foreign buying streaks': 'Pembelian asing beruntun',
  'Green on red': 'Hijau saat pasar merah',
  '5% ownership changes': 'Perubahan kepemilikan 5%',
  up: 'naik',
  down: 'turun',
  'No signals.': 'Tidak ada sinyal.',
  shares: 'saham',
  average: 'rata-rata',
  over: 'selama',
  days: 'hari',
  threshold: 'ambang',
  'trading days': 'hari bursa',
  Stock: 'Saham',
  Change: 'Perubahan',
  'Net shares': 'Net saham',
  'Filter stocks': 'Cari saham',
  'Ticker or company name': 'Kode saham atau nama perusahaan',
  stocks: 'saham',
  'Recent trading days': 'Hari bursa terakhir',
  'Current 5% holders': 'Pemegang saham 5% terakhir',
  '5% changes': 'Perubahan 5%',
  'No 5% changes in this period.': 'Tidak ada perubahan 5% pada periode ini.',
  Ticker: 'Kode',
  Company: 'Perusahaan',
  Close: 'Penutupan',
  Volume: 'Volume',
  Date: 'Tanggal',
  Investor: 'Investor',
  Shares: 'Saham',
  Holding: 'Kepemilikan',
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
  'Missing broker dates': 'Tanggal broker belum terkumpul',
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
  'No recent news.': 'Belum ada berita terbaru.',
  'News matches the stock code and may include unrelated articles.':
    'Berita dicocokkan dengan kode saham dan dapat memuat artikel yang tidak terkait.',
  'Your workspace.': 'Ruang kerja Anda.',
  'Module picker': 'Pemilih modul',
  'Add a module': 'Tambah modul',
  Add: 'Tambah',
  module: 'modul',
  added: 'ditambahkan',
  panel: 'panel',
  'panel actions': 'aksi panel',
  ticker: 'kode saham',
  'Market summary': 'Ringkasan pasar',
  Ownership: 'Kepemilikan',
  'Company profile': 'Profil perusahaan',
  'Price & volume': 'Harga & volume',
  '5% report': 'Laporan 5%',
  'Market radar': 'Radar pasar',
  Sources: 'Sumber',
  'Collapse module sidebar': 'Tutup bilah modul',
  'Expand module sidebar': 'Buka bilah modul',
  'Tickers linked': 'Kode saham tertaut',
  'Independent tickers': 'Kode saham mandiri',
  'Linking adopts the active panel ticker. Dates and controls stay independent.':
    'Penautan memakai kode saham panel aktif. Tanggal dan kontrol tetap terpisah.',
  Drag: 'Seret',
  Focus: 'Fokus',
  'Show all panels': 'Tampilkan semua panel',
  Duplicate: 'Duplikat',
  'Move earlier': 'Pindah ke depan',
  'Move later': 'Pindah ke belakang',
  'One-third width': 'Lebar sepertiga',
  'Half width': 'Lebar setengah',
  'Full width': 'Lebar penuh',
  'Compact height': 'Tinggi ringkas',
  'Tall height': 'Tinggi besar',
  Remove: 'Hapus',
  Resize: 'Ubah ukuran',
  'Drag to resize. Arrow keys also resize.':
    'Seret untuk mengubah ukuran. Tombol panah juga mengubah ukuran.',
  'Panel moved.': 'Panel dipindahkan.',
  'Panel resized.': 'Ukuran panel diubah.',
  'Ticker data is not available.': 'Data saham belum tersedia.',
  'Close source': 'Tutup sumber',
  'Open the source': 'Buka sumber',
  'Custodian bank': 'Bank kustodian',
  'Close · IDR': 'Penutupan · IDR',
  'Volume · shares': 'Volume · saham',
  'Value · IDR': 'Nilai · IDR',
  'Net foreign · est. IDR': 'Net asing · estimasi IDR',
  'All signals': 'Semua sinyal',
  Observation: 'Pengamatan',
  'All tickers': 'Semua kode saham',
  'Filter report ticker': 'Filter kode saham laporan',
  'Ticker / investor': 'Kode saham / investor',
  'Report date': 'Tanggal laporan',
  'Before shares': 'Saham sebelum',
  'After shares': 'Saham sesudah',
  'Session change': 'Perubahan sesi',
  'Daily close': 'Penutupan harian',
  'Daily volume': 'Volume harian',
  'Compare IHSG returns': 'Bandingkan imbal hasil IHSG',
  'Range start': 'Awal rentang',
  'Range end': 'Akhir rentang',
  records: 'catatan',
  'Coverage is shown in the Broksum module after sign-in.':
    'Cakupan ditampilkan dalam modul Broksum setelah masuk.',
  'Net inventory': 'Inventaris net',
  'Broker measure': 'Ukuran broker',
  'Select brokers': 'Pilih broker',
  'Search broker codes and names': 'Cari kode dan nama broker',
  'Code or broker name': 'Kode atau nama broker',
  Clear: 'Bersihkan',
  'Select brokers to plot.': 'Pilih broker untuk grafik.',
  'Change since': 'Perubahan sejak',
  'Opening holdings are unknown.': 'Kepemilikan awal tidak diketahui.',
  'Daily gross summaries. All boards and investor types. Inventory is cumulative buy minus sell since the chosen start date.':
    'Ringkasan bruto harian. Semua papan dan jenis investor. Inventaris adalah akumulasi beli dikurangi jual sejak tanggal awal pilihan.',
  'Range summary': 'Ringkasan rentang',
  'Broker flow': 'Aliran broker',
  Net: 'Net',
  Gross: 'Bruto',
  'Net Buy': 'Beli net',
  'Net Sell': 'Jual net',
  'Daily activity': 'Aktivitas harian',
  'No activity.': 'Tidak ada aktivitas.',
  'Inventory after a missing session is unknown; daily changes remain available.':
    'Inventaris setelah sesi yang hilang tidak diketahui; perubahan harian tetap tersedia.',
  'No dated observations.': 'Tidak ada pengamatan bertanggal.',
  Series: 'Seri',
  'Day Δ': 'Δ harian',
  'by date. Arrow keys inspect reported dates.':
    'menurut tanggal. Tombol panah memeriksa tanggal laporan.',
  'Net foreign value is estimated as net foreign shares times close.':
    'Nilai net asing diperkirakan dari saham net asing dikali harga penutupan.',
  'Production market signals and reported ownership changes.':
    'Sinyal pasar produksi dan perubahan kepemilikan yang dilaporkan.',
  'Disclosed holdings. The public export has no account-level breakdown.':
    'Kepemilikan yang dilaporkan. Ekspor publik tidak memiliki rincian per rekening.',
  'A missing exact-name match does not prove a sale. Null after-values remain unknown.':
    'Nama yang tidak cocok tidak membuktikan penjualan. Nilai sesudah yang kosong tetap tidak diketahui.',
  'Company evidence from the production ticker export.':
    'Bukti perusahaan dari ekspor kode saham produksi.',
  'Closing prices only; OHLC candles are absent. Net foreign value is estimated as net foreign shares times close.':
    'Hanya harga penutupan; lilin OHLC tidak tersedia. Nilai net asing diperkirakan dari saham net asing dikali harga penutupan.',
  'Production index history and market breadth.': 'Riwayat indeks produksi dan cakupan pasar.',
  'Use each source’s reporting date. This is not the full shareholder base.':
    'Gunakan tanggal laporan setiap sumber. Ini bukan seluruh pemegang saham.',
  'Latest registry snapshot only.': 'Hanya laporan registrasi terakhir.',
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
    const compactNumber = new Intl.NumberFormat(locale === 'id' ? 'id-ID' : 'en-US', {
      maximumFractionDigits: 2,
    });
    return {
      c: (value: number) => {
        const scale =
          Math.abs(value) >= 1e9
            ? 1e9
            : Math.abs(value) >= 1e6
              ? 1e6
              : Math.abs(value) >= 1e3
                ? 1e3
                : 1;
        return (
          compactNumber.format(value / scale) +
          (scale === 1e9 ? 'B' : scale === 1e6 ? 'M' : scale === 1e3 ? 'K' : '')
        );
      },
      d: (value: string) =>
        new Date(value.slice(0, 10) + 'T12:00:00Z').toLocaleDateString(
          locale === 'id' ? 'id-ID' : 'en-GB',
          { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' },
        ),
      locale,
      setLocale,
      t: (text: string) => (locale === 'id' ? (indonesian[text] ?? text) : text),
      n: (value: number | null | undefined) => (value == null ? '-' : number.format(value)),
      p: (value: number | null | undefined) => (value == null ? '-' : `${percent.format(value)}%`),
    };
  }, [locale, setLocale]);
}
