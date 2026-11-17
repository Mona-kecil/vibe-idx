import { english, indonesian } from './common-words';
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

/**
 * Words and phrases of the market, not of any ticker, so a new listing needs no entry. A bare code beside one is
 * likely a ticker.
 */
const stockCues: ReadonlySet<string> = new Set([
  ...'saham sahamnya emiten ihsg bei bursa dividen rups rupst rupslb ipo obligasi buyback tbk rekomendasi kapitalisasi direksi dirut komisaris akuisisi caplok kuartal investor analis prospek laba rugi bisnis produksi pertumbuhan ekspansi pendapatan kinerja pengendali investasi sekuritas msci ytd rights tender margin rebalancing shareholder'.split(
    ' ',
  ),
  'rights issue',
  'free float',
  'private placement',
  'target harga',
  'anak usaha',
]);

const wordSet = (words: string) => new Set(words.split(' '));

export type Vocabulary = {
  /** Ordinary words: a code that is one is never a ticker by being bare. */
  english: ReadonlySet<string>;
  indonesian: ReadonlySet<string>;
  /** What makes a bare code a ticker. `null` asks for nothing. */
  cues: ReadonlySet<string> | null;
};
const vocabulary: Vocabulary = {
  english: wordSet(english),
  indonesian: wordSet(indonesian),
  cues: stockCues,
};

const marker = /\b(?:saham|emiten|ticker|kode(?: saham)?|sandi)[\s:(]+(?:berkode[\s:(]+)?$/iu;
const listJoin = /^\s*(?:,\s*dan|,|&|\/|dan|serta|atau)\s*(?:saham\s+)?$/iu;
const sideBySide = /^\s*(?:,\s*dan|,|&|\/|dan|serta|atau)?\s*$/iu;
const listEnd = /^(?:\s*$|\s*[,.;:!?)&/]|\s+(?:dan|serta|atau)\s)/iu;

/**
 * Tags a text with the tickers it is about, from four kinds of evidence:
 * - a company name, as `tickers.json` gives it;
 * - a stock marker or `$` before the code, `Tbk` after it, or a capitalised name before its parenthesised code;
 * - a list: a code that follows an accepted one after `,` `dan` `&`. A code that is also an English word needs the
 *   list to end there, since `DATA center` is not a stock;
 * - a bare code in a text that is not all capitals. It tags only with a second sign: a distinctive word of its
 *   company's name, or, for a code that is not an ordinary word, a market word in the text. Two such codes side by
 *   side vouch for each other.
 */
export function tickerTagger(tickers: Ticker[], words: Vocabulary = vocabulary) {
  const patterns = new Map<string, { ticker: string; tokens: string[]; rank: number }[]>();
  const names = tickers
    .map(({ ticker, name }) => ({ ticker, name: companyName(name) }))
    .filter(({ name }) => name.length >= 2);
  [...names]
    .sort((a, b) => b.name.length - a.name.length)
    .forEach(({ ticker, name }, rank) => {
      const parts = name.split(' ');
      const forms =
        parts.length > 1
          ? [parts]
          : [
              ['pt', name],
              [name, 'tbk'],
              [name, 'persero', 'tbk'],
            ];
      for (const tokens of forms)
        patterns.set(tokens[0]!, [...(patterns.get(tokens[0]!) ?? []), { ticker, tokens, rank }]);
    });
  // A word of a company's name vouches for its code unless many companies share it ("bank", "indonesia").
  const holders = new Map<string, number>();
  for (const { name } of names)
    for (const token of new Set(name.split(' '))) holders.set(token, (holders.get(token) ?? 0) + 1);
  const distinctive = new Map(
    names.map(({ ticker, name }) => [
      ticker,
      name
        .split(' ')
        .filter((t) => t.length >= 4 && t !== ticker.toLowerCase() && (holders.get(t) ?? 0) <= 3),
    ]),
  );
  const codes = new Set(tickers.map((t) => t.ticker));
  const isWord = (code: string) => {
    const word = code.toLowerCase();
    return words.english.has(word) || words.indonesian.has(word);
  };
  return (text: string): string[] => {
    const tokens = normalize(text).split(' ');
    const found = tokens.flatMap((word, at) =>
      (patterns.get(word) ?? [])
        .filter(({ tokens: want }) => want.every((token, i) => tokens[at + i] === token))
        .map((pattern) => ({ ...pattern, at })),
    );
    const used = new Set<number>();
    const tags = new Set<string>();
    for (const { ticker, tokens: span, at } of found.sort(
      (a, b) => a.rank - b.rank || a.at - b.at,
    )) {
      const cover = span.map((_, i) => at + i);
      if (cover.some((i) => used.has(i))) continue;
      tags.add(ticker);
      for (const i of cover) used.add(i);
    }

    // An all-capitals headline shouts ordinary words, so a bare code in it proves nothing.
    const shouting = !/\p{Ll}/u.test(text);
    const marketWord =
      words.cues === null ||
      tokens.some(
        (token, i) =>
          words.cues?.has(token) === true || words.cues?.has(`${token} ${tokens[i + 1]}`) === true,
      );
    const hits = [...text.matchAll(/(?<![\p{L}\p{N}])[A-Z]{4,5}(?![\p{L}\p{N}])/gu)]
      .filter((match) => codes.has(match[0]))
      .map((match) => {
        const code = match[0];
        const end = match.index + code.length;
        const before = text.slice(Math.max(0, match.index - 45), match.index);
        const after = text.slice(end, end + 45);
        const word = isWord(code);
        const named = distinctive.get(code)?.some((t) => tokens.includes(t)) ?? false;
        return {
          code,
          start: match.index,
          end,
          after,
          word,
          vouched:
            marker.test(before) ||
            (before.endsWith('$') && !word) ||
            /^\s*[):,]?\s+Tbk\b/i.test(after) ||
            (/\p{Lu}[\p{L}.]*\s*\($/u.test(before) && after.startsWith(')') && (!word || named)) ||
            (!shouting && (named || (!word && marketWord))),
        };
      });
    const accepted = hits.map((hit) => hit.vouched);
    const between = (i: number) => text.slice(hits[i - 1]!.end, hits[i]!.start);
    if (!shouting)
      for (let i = 1; i < hits.length; i++)
        if (!hits[i]!.word && !hits[i - 1]!.word && sideBySide.test(between(i)))
          accepted[i] = accepted[i - 1] = true;
    for (let i = 1; i < hits.length; i++) {
      const { after, word } = hits[i]!;
      if (!accepted[i - 1] || !listJoin.test(between(i))) continue;
      const next = normalize(after).split(' ')[0] ?? '';
      if (listEnd.test(after) || !word || !words.english.has(next)) accepted[i] = true;
    }
    hits.forEach(({ code }, i) => accepted[i] && tags.add(code));
    return [...tags].sort();
  };
}
