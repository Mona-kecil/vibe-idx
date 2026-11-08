const workflows = 'https://api.github.com/repos/Mona-kecil/vibe-idx/actions/workflows';
const health = 'https://pub-7982bfb066694e6e8615750132283eba.r2.dev/health.json';
const HOUR = 3600e3;

async function report(env, message, tags) {
  if (!env.SENTRY_DSN) return;
  const dsn = new URL(env.SENTRY_DSN);
  const event_id = crypto.randomUUID().replaceAll('-', '');
  const event = {
    event_id,
    timestamp: Date.now() / 1000,
    platform: 'javascript',
    level: 'error',
    environment: 'production',
    logger: 'vibe-idx-dispatch',
    message: { formatted: message },
    tags,
    fingerprint: ['vibe-idx-dispatch', ...Object.values(tags)],
  };
  const response = await fetch(`${dsn.origin}/api${dsn.pathname}/envelope/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-sentry-envelope',
      'X-Sentry-Auth': `Sentry sentry_version=7, sentry_key=${dsn.username}, sentry_client=vibe-idx-dispatch/1.0`,
    },
    body: [{ event_id, sent_at: new Date().toISOString() }, { type: 'event' }, event]
      .map((line) => JSON.stringify(line))
      .join('\n'),
  });
  if (!response.ok) console.error(`Sentry HTTP ${response.status}`);
}

async function dispatch(env, workflow) {
  const headers = {
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'vibe-idx-dispatch',
  };
  if (workflow === 'brokers.yml') {
    const response = await fetch(`${workflows}/brokers.yml/runs?per_page=10`, { headers });
    if (!response.ok) throw new Error(`GitHub workflow runs HTTP ${response.status}`);
    const { workflow_runs } = await response.json();
    if (
      workflow_runs.some((run) =>
        ['queued', 'in_progress', 'waiting', 'requested', 'pending'].includes(run.status),
      )
    )
      return;
  }
  const response = await fetch(`${workflows}/${workflow}/dispatches`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ref: 'master' }),
  });
  if (!response.ok) throw new Error(`GitHub dispatch ${workflow} HTTP ${response.status}`);
}

// The daily batch publishes health.json around 10:30 UTC; this runs after it should have.
async function checkFreshness(env, now) {
  const response = await fetch(`${health}?t=${now}`);
  if (!response.ok) throw new Error(`health.json HTTP ${response.status}`);
  const status = await response.json();
  const published = new Date(`${status.run_at.slice(0, 19).replace(' ', 'T')}Z`);
  if (!(now - published < 6 * HOUR))
    await report(env, `Daily IDX batch has not published since ${status.run_at}`, {
      check: 'published',
    });
  for (const source of ['prices', 'indices'])
    if (!(now - new Date(`${status[source]}T00:00:00Z`) < 4 * 24 * HOUR))
      await report(env, `IDX ${source} are stale: last trading day ${status[source]}`, {
        check: source,
      });
}

export default {
  fetch() {
    return new Response(null, { status: 404 });
  },
  async scheduled(controller, env) {
    const job =
      controller.cron === '0 12 * * *'
        ? 'freshness'
        : controller.cron === '17 10 * * *'
          ? 'ingest.yml'
          : 'brokers.yml';
    try {
      if (job === 'freshness') await checkFreshness(env, controller.scheduledTime);
      else await dispatch(env, job);
    } catch (error) {
      await report(
        env,
        `${job === 'freshness' ? 'Freshness check' : `Dispatch ${job}`} failed: ${error.message}`,
        {
          check: job,
        },
      );
      throw error;
    }
  },
};
