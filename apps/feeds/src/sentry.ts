export async function report(dsnValue: string, source: string, failure: unknown) {
  // Only our bounded error codes go out; upstream errors may embed credential-bearing URLs.
  const reason =
    failure instanceof Error &&
    /^(HTTP \d{3} [a-zA-Z0-9.-]+ (?:GET|POST)|BPS calendar copy (?:missing|stale|invalid)|BPS_KEY missing|Network request failed)$/.test(
      failure.message,
    )
      ? failure.message
      : 'Source parsing or publication failed';
  console.error(JSON.stringify({ source, reason }));
  try {
    const dsn = new URL(dsnValue),
      event_id = crypto.randomUUID().replaceAll('-', '');
    const event = {
      event_id,
      timestamp: Date.now() / 1000,
      platform: 'javascript',
      level: 'error',
      environment: 'production',
      logger: 'vibe-idx-feeds',
      message: { formatted: reason },
      tags: { source },
      fingerprint: ['vibe-idx-feeds', source],
    };
    const response = await fetch(`${dsn.origin}/api${dsn.pathname}/envelope/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-sentry-envelope',
        'X-Sentry-Auth': `Sentry sentry_version=7, sentry_key=${dsn.username}, sentry_client=vibe-idx-feeds/1.0`,
      },
      body: [{ event_id, sent_at: new Date().toISOString() }, { type: 'event' }, event]
        .map((line) => JSON.stringify(line))
        .join('\n'),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) console.error(`Sentry HTTP ${response.status}`);
  } catch {
    console.error('Sentry report failed');
  }
}
