import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { collect, type Bucket } from './src/collector';
import { calendarSchema, newsSchema, tickerSchema } from './src/contracts';
import { request } from './src/sources';

const [keyFile, output] = process.argv.slice(2);
if (!keyFile || !output)
  throw new Error('Usage: pnpm verify:live <BPS key file> <scratch directory outside repo>');
const directory = resolve(output);
if (!directory.startsWith('/tmp/'))
  throw new Error('Live output must be in /tmp/; never commit publisher text');
await mkdir(directory, { recursive: true });
const tickers = tickerSchema.parse(
  await (await request('https://pub-7982bfb066694e6e8615750132283eba.r2.dev/tickers.json')).json(),
);
const memory = new Map<string, string>([['tickers.json', JSON.stringify(tickers)]]);
const bucket: Bucket = {
  async get(key) {
    const value = memory.get(key);
    return value ? { json: async (): Promise<unknown> => JSON.parse(value) } : null;
  },
  async put(key, value) {
    memory.set(key, value);
    await writeFile(resolve(directory, key), value);
  },
};
const failures: string[] = [],
  requests: { url: string; status: number }[] = [];
const key = (await readFile(keyFile, 'utf8')).trim();
await collect({
  bucket,
  bpsKey: key,
  report: async (source) => {
    failures.push(source);
  },
  get: async (url, init) => {
    const safeURL = url.includes('/key/') ? 'BPS WebAPI (key redacted)' : url;
    try {
      const response = await request(url, init);
      requests.push({ url: safeURL, status: response.status });
      return response;
    } catch {
      requests.push({ url: safeURL, status: 0 });
      throw new Error('Source request failed');
    }
  },
});
const news = newsSchema.parse(JSON.parse(memory.get('news.json') ?? 'null'));
const calendar = calendarSchema.parse(JSON.parse(memory.get('calendar.json') ?? 'null'));
const month = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Jakarta',
  year: 'numeric',
  month: '2-digit',
}).format(new Date());
const report = {
  at: news.as_of,
  requests,
  failures,
  news: news.sources,
  tagged: news.news.filter((n) => n.tags.length).length,
  samples: news.news
    .filter((n) => n.tags.length)
    .slice(0, 15)
    .map((n) => ({ title: n.title, tags: n.tags, link: n.link })),
  calendar: calendar.sources,
  calendarThisMonth: Object.fromEntries(
    Object.keys(calendar.sources).map((source) => [
      source,
      calendar.cal.filter(
        (e) =>
          e.source_id === source &&
          new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Asia/Jakarta',
            year: 'numeric',
            month: '2-digit',
          }).format(new Date(e.ts)) === month,
      ).length,
    ]),
  ),
};
await writeFile(resolve(directory, 'verification.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (failures.length) process.exitCode = 1;
