import * as Sentry from '@sentry/node';
import { afterEach, expect, it, vi } from 'vite-plus/test';
import { SENTRY_DSN } from './sentry';

afterEach(async () => {
  await Sentry.getClient()?.close();
  Sentry.getCurrentScope().setClient(undefined);
  vi.unstubAllEnvs();
  vi.resetModules();
});

it('keeps Sentry off outside Vercel even when SENTRY_DSN is exported', async () => {
  vi.stubEnv('VERCEL_ENV', undefined);
  vi.stubEnv('SENTRY_DSN', 'https://key@o1.ingest.us.sentry.io/1');
  await import('../api/_sentry');
  expect(Sentry.getClient()).toBeUndefined();
});

it('reports to the web project from Vercel', async () => {
  vi.stubEnv('VERCEL_ENV', 'production');
  vi.stubEnv('SENTRY_DSN', 'https://key@o1.ingest.us.sentry.io/1');
  await import('../api/_sentry');
  expect(Sentry.getClient()?.getOptions()).toMatchObject({
    dsn: SENTRY_DSN,
    environment: 'production',
  });
});
