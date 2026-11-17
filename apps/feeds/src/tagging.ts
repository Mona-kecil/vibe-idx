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
 * Codes that are also an Indonesian or English word, or an organisation's abbreviation, so a bare uppercase
 * occurrence proves nothing. They tag only with a company name, a stock marker or a `Name (CODE)` pair.
 */
export const wordCodes = new Set(
  `ABBA ACES ACRO AGAR AGRO AIMS AKSI ALTO AMAN AMAR AMIN AMOR ANDI APEX AREA ARGO ARMY ARTA ARTI ARTO ASRI
   ATAP AUTO AVIA AWAN AYAM BABY BACA BACH BAIK BAJA BALI BANK BAPA BATA BAUT BAYU BEEF BEER BELI BELL BEST
   BIKE BIMA BINA BIRD BLOG BLUE BOAT BOBA BOLA BOLT BOSS BUAH BUDI BUKA BULL BUMI CAMP CARE CARS CASA CASH
   CBRE CENT CHEM CHIP CITY CLAY COAL COIN CRAB CUAN CYBR DADA DART DATA DAYA DEAL DEFI DEPO DEWA DEWI DIGI
   DIVA EAST EDGE ELIT EMAS ENAK EURO FAST FILM FIRE FISH FOLK FOOD FORE FUJI GAMA GEMA GEMS GLOB GOLD GOLF
   GOOD GULA GUNA HAJJ HALO HEAL HERO HILL HITS HOKI HOME HOPE IATA ICON IDEA IKAN INDO INET INOV IPTV JATI
   JAWA JAYA KAYU KEEN KEJU KING KIOS KOIN KOPI KOTA KRYA KUAS LABA LABS LAJU LAND LEAD LIFE LINK LION LIVE
   LUCK LUCY MAHA MAIN MARI MARK MAXI MAYA MDRN MEGA MEJA MERK META MICE MIDI MINE NAIK NANO NASA NASI NATO
   NEST NICE NICK NINE NUSA OBAT OILS PACK PADA PADI PALM PART PIPA PLAN POLA POLI POLL POLY POOL PORT POWR
   PRAY PRIM PSSI PURA PURE PURI RAJA RANS RATU REAL RELI RIGS RISE ROCK RODA ROTI RUNS SAFE SAGE SAME SATU
   SHIP SILO SINI SMAR SOFA SOHO SOLA SOUL STAR SUPR SURE SWAT TAMA TAMU TAXI TECH TOOL TOPS TOTO TRAM TRIM
   TRIO TRON TRUE TRUK TUGU TYRE UANG UNIC UNIQ URBN VAST VICI VISI VIVA WIFI WINE WINS WOOD WOWS ZINC ZONE`.split(
    /\s+/,
  ),
);

const marker = /\b(?:saham|emiten|ticker|kode(?: saham)?|sandi)[\s:(]+(?:berkode[\s:(]+)?$/iu;
const listJoin = /^\s*(?:,\s*dan|,|&|\/|dan|serta|atau)\s*(?:saham\s+)?$/iu;
const listEnd = /^(?:\s*$|\s*[,.;:!?)&/]|\s+(?:dan|serta|atau)\s)/iu;

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
    // An all-capitals headline shouts ordinary words, so a bare code in it proves nothing.
    const shouting = !/\p{Ll}/u.test(text);
    let previousEnd = -1;
    for (const match of text.matchAll(/(?<![\p{L}\p{N}])[A-Z]{4,5}(?![\p{L}\p{N}])/gu)) {
      const code = match[0];
      if (!codes.has(code)) continue;
      const end = match.index + code.length;
      const before = text.slice(Math.max(0, match.index - 45), match.index);
      const after = text.slice(end, end + 45);
      const marked = marker.test(before) || /^\s*[):,]?\s+Tbk\b/i.test(after);
      const named = /\p{Lu}[\p{L}.]*\s*\($/u.test(before) && after.startsWith(')');
      const bare = !wordCodes.has(code) && !shouting;
      // A word-like code tags inside a list of codes, where it is followed by the list's next separator or end.
      const listed =
        previousEnd >= 0 &&
        listJoin.test(text.slice(previousEnd, match.index)) &&
        listEnd.test(after);
      if (marked || named || bare || listed) {
        tags.add(code);
        previousEnd = end;
      }
    }
    return [...tags].sort();
  };
}
