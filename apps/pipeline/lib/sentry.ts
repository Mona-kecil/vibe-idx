import * as Sentry from '@sentry/node';

export function startSentry() {
  const env = process.env;
  const github = env.GITHUB_ACTIONS === 'true';
  const host = env.VIBE_IDX_SENTRY_HOST;
  // Sentry.init reads SENTRY_DSN from the environment on its own, so runs that did not opt in must skip it.
  if (!github && !host) return;
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: 'production',
    release: env.GITHUB_SHA,
    initialScope: {
      tags: github
        ? {
            workflow: env.GITHUB_WORKFLOW,
            run_url:
              env.GITHUB_RUN_ID &&
              `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`,
          }
        : { host },
    },
  });
}

export async function reportError(error: unknown, tags?: Record<string, string>) {
  Sentry.captureException(error, { tags });
  await Sentry.flush(5000);
}
