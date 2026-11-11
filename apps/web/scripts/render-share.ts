import { mkdir, writeFile } from 'node:fs/promises';
import { renderCard } from '../api/og.ts';
import { loadTickerCard } from '../api/_share-data.ts';
import { brokerTickerSchema } from '../src/brokers.ts';

const directory = '/tmp/vibe-og';
await mkdir(directory, { recursive: true });
await writeFile(`${directory}/brand.png`, await renderCard(null));
for (const input of process.argv.slice(2)) {
  const ticker = brokerTickerSchema.parse(input.toUpperCase());
  const card = await loadTickerCard(ticker);
  if (!card) throw new Error(`No price data for ${ticker}`);
  await writeFile(`${directory}/${ticker}.png`, await renderCard(card));
  console.log(`${directory}/${ticker}.png`, card.name, card.date, card.close, card.changePct);
}
