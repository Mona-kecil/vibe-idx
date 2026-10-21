import { z } from 'zod';
import { date } from './rows';
export function idxUrl(value: string): string {
  const url = new URL(value, 'https://www.idx.id');
  if (!['www.idx.id', 'www.idx.co.id', 'idx.co.id'].includes(url.hostname))
    throw new Error(`Unexpected IDX host: ${url.hostname}`);
  url.hostname = 'www.idx.id';
  url.protocol = 'https:';
  return url.toString();
}
export function parseOwnershipList(input: unknown) {
  return z
    .object({
      items: z.array(
        z.object({ Description: z.string(), Prospectus: z.string(), ListingDate: z.string() }),
      ),
    })
    .parse(input)
    .items.flatMap((r) => {
      const url = idxUrl(r.Prospectus);
      const source: 'fivePct' | 'onePct' | undefined = url.endsWith('-lima-persen.xlsx')
        ? 'fivePct'
        : url.endsWith('-satu-persen.xlsx')
          ? 'onePct'
          : undefined;
      return source ? [{ source, url, date: date(r.ListingDate) }] : [];
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.url.localeCompare(b.url));
}
