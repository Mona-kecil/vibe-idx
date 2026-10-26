import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type Locale = 'en' | 'id';
const indonesian: Record<string, string> = {
  'Sign in': 'Masuk',
  'Sign out': 'Keluar akun',
  'Signing you in…': 'Memproses masuk…',
  'Could not sign in. Try again.': 'Gagal masuk. Coba lagi.',
};
const LocaleContext = createContext<Locale>('en');

export function LocaleProvider({
  children,
  initialLocale,
}: {
  children: ReactNode;
  initialLocale?: Locale;
}) {
  const [locale] = useState<Locale>(() => {
    if (initialLocale) return initialLocale;
    try {
      return window.localStorage.getItem('vibe-idx-language') === 'id' ? 'id' : 'en';
    } catch {
      return 'en';
    }
  });
  useEffect(() => {
    document.documentElement.lang = locale;
    try {
      window.localStorage.setItem('vibe-idx-language', locale);
    } catch {
      /* Storage may be blocked. */
    }
  }, [locale]);
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}
export function useLocale() {
  const locale = useContext(LocaleContext);
  return { t: (text: string) => (locale === 'id' ? (indonesian[text] ?? text) : text) };
}
