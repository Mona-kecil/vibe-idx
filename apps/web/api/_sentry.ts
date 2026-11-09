import * as Sentry from '@sentry/node';
import { SENTRY_DSN } from '../src/sentry.js';

Sentry.init({
  dsn: process.env.VERCEL_ENV ? SENTRY_DSN : undefined,
  environment: process.env.VERCEL_ENV,
  release: process.env.VERCEL_GIT_COMMIT_SHA,
});

export async function reportFailure(route: string, failure: unknown) {
  if (failure instanceof Error) Sentry.captureException(failure, { tags: { route } });
  else Sentry.captureMessage(`${route}: ${String(failure)}`, { level: 'error', tags: { route } });
  await Sentry.flush(2000);
}
