import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { BPS_SERIES, bpsDate, parsePublicHolidays } from '../src/bps';
import { calendarSchema } from '../src/contracts';

const [releasesPath, holidaysPath, arcPath] = process.argv.slice(2);
if (!releasesPath || !holidaysPath || !arcPath)
  throw new Error('Usage: tsx scripts/bps-backtest.ts releases.jsonl id.ics cal.json');
const releaseSchema = z.object({
  y: z.number(),
  m: z.number(),
  date: z.iso.date(),
  title: z.string(),
});
const releases = readFileSync(releasesPath, 'utf8')
  .trim()
  .split('\n')
  .map((line) => releaseSchema.parse(JSON.parse(line)))
  .filter((release) => release.y >= 2021);
const holidays = parsePublicHolidays(readFileSync(holidaysPath, 'utf8'));
const arc = calendarSchema
  .parse(JSON.parse(readFileSync(arcPath, 'utf8')))
  .cal.filter((event) => event.source_id === 'bps')
  .map((event) => ({
    ev: event.ev,
    date: new Date(Date.parse(event.ts) + 7 * 3600e3).toISOString().slice(0, 10),
  }))
  .filter((event) => event.date.startsWith('2026-'));
const score = (dates: string[], series: (typeof BPS_SERIES)[number]) => {
  const unique = [...new Set(dates)];
  const hits = unique.filter((date) => {
    const year = Number(date.slice(0, 4)),
      month = Number(date.slice(5, 7));
    return (
      series.rule.months.includes(month) && bpsDate(year, month, series.rule, holidays) === date
    );
  }).length;
  return `${hits}/${unique.length}`;
};
for (const series of BPS_SERIES) {
  const matched = releases.filter((release) => series.match.test(release.title.toLowerCase()));
  console.log(
    `${series.ev} | ${series.match} | matches ${matched.length} | API ${score(
      matched.map((release) => release.date),
      series,
    )} | ARC ${score(
      arc.filter((event) => event.ev === series.ev).map((event) => event.date),
      series,
    )}`,
  );
  if (series.ev === 'Perkembangan Ekspor dan Impor')
    console.log(
      `  API since Jun 2025 ${score(
        matched.filter((release) => release.date >= '2025-06-01').map((release) => release.date),
        series,
      )}`,
    );
  for (const release of matched)
    console.log(`  ${release.date} ${release.title.replace(/\s+/g, ' ')}`);
}
