import * as Sentry from '@sentry/node';
import { afterEach, expect, it, vi } from 'vite-plus/test';
import { startSentry } from './sentry';

const dsn = 'https://key@o1.ingest.us.sentry.io/1';

afterEach(async () => {
  await Sentry.getClient()?.close();
  Sentry.getCurrentScope().setClient(undefined);
  vi.unstubAllEnvs();
});

it('keeps Sentry off outside GitHub Actions even when SENTRY_DSN is exported', () => {
  vi.stubEnv('GITHUB_ACTIONS', undefined);
  vi.stubEnv('VIBE_IDX_SENTRY_HOST', undefined);
  vi.stubEnv('SENTRY_DSN', dsn);
  startSentry();
  expect(Sentry.getClient()).toBeUndefined();
});

it('reports production errors from GitHub Actions', () => {
  vi.stubEnv('GITHUB_ACTIONS', 'true');
  vi.stubEnv('SENTRY_DSN', dsn);
  startSentry();
  expect(Sentry.getClient()?.getOptions()).toMatchObject({ dsn, environment: 'production' });
});

it('reports from a collector host that opted in, tagged with the host', () => {
  vi.stubEnv('GITHUB_ACTIONS', undefined);
  vi.stubEnv('VIBE_IDX_SENTRY_HOST', 'laptop');
  vi.stubEnv('SENTRY_DSN', dsn);
  startSentry();
  expect(Sentry.getClient()?.getOptions()).toMatchObject({ dsn, environment: 'production' });
  expect(Sentry.getCurrentScope().getScopeData().tags).toMatchObject({ host: 'laptop' });
});
