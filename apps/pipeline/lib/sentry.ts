import * as Sentry from '@sentry/node';

export function startSentry() {
  const env = process.env;
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.GITHUB_ACTIONS ? 'production' : 'local',
    release: env.GITHUB_SHA,
    initialScope: {
      tags: {
        workflow: env.GITHUB_WORKFLOW,
        run_url:
          env.GITHUB_RUN_ID &&
          `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`,
      },
    },
  });
}

export async function reportError(error: unknown, tags?: Record<string, string>) {
  Sentry.captureException(error, { tags });
  await Sentry.flush(5000);
}
