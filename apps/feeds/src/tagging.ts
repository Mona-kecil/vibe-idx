import type { Ticker } from './contracts';

const normalize = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
const companyName = (s: string) =>
  normalize(
    s
      .replace(/^PT\.?\s+/i, '')
      .replace(/\s*\(Persero\)/gi, '')
      .replace(/[,\s]+Tbk\.?$/i, ''),
  );
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function tickerTagger(tickers: Ticker[]) {
  const names = tickers
    .map(({ ticker, name }) => ({ ticker, name: companyName(name) }))
    .filter(({ name }) => name.length >= 2)
    .sort((a, b) => b.name.length - a.name.length);
  const codes = new Set(tickers.map((t) => t.ticker));
  return (text: string): string[] => {
    let remaining = ` ${normalize(text)} `;
    const tags = new Set<string>();
    for (const { ticker, name } of names) {
      const pattern = name.includes(' ')
        ? new RegExp(` ${escape(name)} `, 'g')
        : new RegExp(` (?:pt ${escape(name)}|${escape(name)} (?:persero )?tbk) `, 'g');
      if (pattern.test(remaining)) {
        tags.add(ticker);
        remaining = remaining.replace(pattern, ' ');
      }
    }
    for (const match of text.matchAll(/\b[A-Z]{4}\b/g)) {
      const code = match[0];
      if (!codes.has(code)) continue;
      const before = text.slice(Math.max(0, match.index - 45), match.index);
      const after = text.slice(match.index + 4, match.index + 45);
      if (
        /\b(?:saham|emiten|ticker|kode saham)\s+(?:berkode\s+)?[(:]?\s*$/iu.test(before) ||
        /^\s*[):,]?\s+Tbk\b/i.test(after)
      )
        tags.add(code);
    }
    return [...tags].sort();
  };
}
