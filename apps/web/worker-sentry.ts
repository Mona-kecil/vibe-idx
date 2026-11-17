// The Node Sentry SDK does not run on Workers, so this posts envelopes directly.
// Without a DSN, as under `wrangler dev` where .dev.vars blanks it, the failure goes to the console.
export async function report(
  env: { DEPLOYMENT: string; SENTRY_DSN?: string },
  failure: unknown,
  tags: Record<string, string>,
) {
  if (!env.SENTRY_DSN) {
    console.error('Not reported to Sentry:', failure);
    return;
  }
  const DSN = new URL(env.SENTRY_DSN);
  const event_id = crypto.randomUUID().replaceAll('-', '');
  const error = failure instanceof Error ? failure : null;
  const event = {
    event_id,
    timestamp: Date.now() / 1000,
    platform: 'javascript',
    level: 'error',
    environment: env.DEPLOYMENT,
    logger: 'vibe-idx-worker',
    tags,
    ...(error
      ? {
          exception: { values: [{ type: error.name, value: error.message }] },
          extra: { stack: error.stack },
        }
      : { message: { formatted: String(failure) } }),
  };
  const response = await fetch(`${DSN.origin}/api${DSN.pathname}/envelope/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-sentry-envelope',
      'X-Sentry-Auth': `Sentry sentry_version=7, sentry_key=${DSN.username}, sentry_client=vibe-idx-worker/1.0`,
    },
    body: [{ event_id, sent_at: new Date().toISOString() }, { type: 'event' }, event]
      .map((line) => JSON.stringify(line))
      .join('\n'),
  }).catch(() => null);
  if (!response?.ok) console.error(`Sentry report failed: ${response?.status ?? 'network'}`);
}
