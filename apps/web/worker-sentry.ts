// The Node Sentry SDK does not run on Workers, so this posts envelopes directly.
const DSN = new URL(
  'https://03fc55665713ed6fef277fe74ebe5ada@o4507632166961152.ingest.us.sentry.io/4512400217735168',
);

export async function report(failure: unknown, tags: Record<string, string>) {
  const event_id = crypto.randomUUID().replaceAll('-', '');
  const error = failure instanceof Error ? failure : null;
  const event = {
    event_id,
    timestamp: Date.now() / 1000,
    platform: 'javascript',
    level: 'error',
    environment: 'preview',
    logger: 'vibe-idx-preview',
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
      'X-Sentry-Auth': `Sentry sentry_version=7, sentry_key=${DSN.username}, sentry_client=vibe-idx-preview/1.0`,
    },
    body: [{ event_id, sent_at: new Date().toISOString() }, { type: 'event' }, event]
      .map((line) => JSON.stringify(line))
      .join('\n'),
  }).catch(() => null);
  if (!response?.ok) console.error(`Sentry report failed: ${response?.status ?? 'network'}`);
}
