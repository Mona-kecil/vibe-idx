import { readFile } from 'node:fs/promises';
import { expect, it } from 'vite-plus/test';
import { parseFivePct } from './fivePct';

it('keeps fractional account shares from the June XLSX', async () => {
  const parsed = parseFivePct(
    await readFile(new URL('../fixtures/ownership-5pct-2026-06-05.xlsx', import.meta.url)),
  );
  expect(parsed.asOf).toBe('2026-06-05');
  const group = parsed.groups.find(
    (g) => g.holding.ticker === 'ABMM' && g.holding.investorName === 'DRS LO KHENG HONG',
  );
  expect(group?.accounts).toContainEqual({
    holderName: 'PT OCBC SEKURITAS INDONESIA',
    accountName: 'DRS. LO KHENG HONG',
    previousShares: 441.4,
    currentShares: 441.4,
  });
});
