// @vitest-environment happy-dom
import { describe, expect, it } from 'vite-plus/test';
import { commandSuggestions } from './CommandBar';

// Real names and 9 Nov traded values for the codes that used to lose to another row.
const tickers = [
  { ticker: 'BBCA', name: 'PT Bank Central Asia Tbk.', value: 598398085000 },
  { ticker: 'MARK', name: 'PT Mark Dynamics Indonesia Tbk.', value: 6010663500 },
  { ticker: 'LIVE', name: 'PT Homeco Victoria Makmur Tbk', value: 158687900 },
  { ticker: 'BANK', name: 'PT Bank Aladin Syariah Tbk', value: 113400600 },
  { ticker: 'NICE', name: 'PT Adhi Kartiko Pratama Tbk', value: 62368600 },
  { ticker: 'CASA', name: 'PT Capital Financial Indonesia Tbk', value: 61874500 },
  { ticker: 'ADHI', name: 'PT Adhi Karya (Persero) Tbk.', value: 0 },
];

describe('command ranking', () => {
  it('puts each exact ticker code ahead of functions, prefixes and company name matches', () => {
    for (const stock of tickers) {
      expect(commandSuggestions(tickers, stock.ticker)[0]?.code).toBe(stock.ticker);
    }
    expect(commandSuggestions(tickers, 'CA')[0]).toEqual({
      code: 'CA',
      label: 'Corporate actions',
    });
    expect(commandSuggestions(tickers, 'LIVE')[0]?.code).toBe('LIVE');
  });
  it('keeps code prefixes before name words and traded value order within each tier', () => {
    const stocks = [
      { ticker: 'OTHER', name: 'ABC Industries', value: 300 },
      { ticker: 'ABCZ', name: 'Low value', value: 100 },
      { ticker: 'ABCA', name: 'High value', value: 200 },
    ];
    expect(commandSuggestions(stocks, 'ABC').map((item) => item.code)).toEqual([
      'ABCA',
      'ABCZ',
      'OTHER',
    ]);
  });
});
