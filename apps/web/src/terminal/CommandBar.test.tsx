// @vitest-environment happy-dom
import { describe, expect, it } from 'vite-plus/test';
import { commandSuggestions } from './CommandBar';
import tickers from './fixtures/tickers.json';

describe('command ranking', () => {
  it('puts every published ticker ahead of code prefixes and company name matches', () => {
    for (const stock of tickers) {
      expect(commandSuggestions(tickers, stock.ticker)[0]?.code, stock.ticker).toBe(stock.ticker);
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
