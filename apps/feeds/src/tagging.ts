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
export function tickerTagger(tickers: Ticker[]) {
  const patterns = new Map<string, { ticker: string; tokens: string[]; rank: number }[]>();
  tickers
    .map(({ ticker, name }) => ({ ticker, name: companyName(name) }))
    .filter(({ name }) => name.length >= 2)
    .sort((a, b) => b.name.length - a.name.length)
    .forEach(({ ticker, name }, rank) => {
      const words = name.split(' ');
      const forms =
        words.length > 1
          ? [words]
          : [
              ['pt', name],
              [name, 'tbk'],
              [name, 'persero', 'tbk'],
            ];
      for (const tokens of forms)
        patterns.set(tokens[0]!, [...(patterns.get(tokens[0]!) ?? []), { ticker, tokens, rank }]);
    });
  const codes = new Set(tickers.map((t) => t.ticker));
  return (text: string): string[] => {
    const words = normalize(text).split(' ');
    const found = words.flatMap((word, at) =>
      (patterns.get(word) ?? [])
        .filter(({ tokens }) => tokens.every((token, i) => words[at + i] === token))
        .map((pattern) => ({ ...pattern, at })),
    );
    const used = new Set<number>();
    const tags = new Set<string>();
    for (const { ticker, tokens, at } of found.sort((a, b) => a.rank - b.rank || a.at - b.at)) {
      const span = tokens.map((_, i) => at + i);
      if (span.some((i) => used.has(i))) continue;
      tags.add(ticker);
      for (const i of span) used.add(i);
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
