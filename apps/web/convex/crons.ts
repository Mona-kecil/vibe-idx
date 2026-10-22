import { cronJobs } from 'convex/server';
import { internal } from './_generated/api';
const crons = cronJobs();
// Read at deploy time: set DISABLE_CRONS=1 on a deployment, then push, to stop its ingest.
if (!process.env.DISABLE_CRONS) {
  crons.cron('issuers', '0 10 * * *', internal.ingest.dailyIssuers);
  crons.cron('market close', '30 10 * * 1-5', internal.ingest.dailyMarket);
  crons.cron('market late', '0 13 * * 1-5', internal.ingest.dailyMarket);
  crons.cron('ownership', '0 11,14 * * 1-5', internal.ingest.discoverOwnership);
  crons.interval('worker', { minutes: 3 }, internal.ingest.worker);
}
export default crons;
