const workflows = 'https://api.github.com/repos/Mona-kecil/vibe-idx/actions/workflows';
const health = 'https://pub-7982bfb066694e6e8615750132283eba.r2.dev/health.json';
const HOUR = 3600e3;
const ACTIVE = ['queued', 'in_progress', 'waiting', 'requested', 'pending'];
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const jakartaDate = (time) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(time);

// GitHub and IDX fail for a minute at a time; retry server errors, 429, and network errors.
async function request(label, url, init) {
  let failure;
  for (const delay of [0, 15e3, 60e3]) {
    await sleep(delay);
    const response = await fetch(url, init).catch((error) => error);
    if (response instanceof Response) {
      if (response.ok) return response;
      failure = `HTTP ${response.status}`;
      if (response.status < 500 && response.status !== 429) break;
    } else failure = response.message;
  }
  throw new Error(`${label} ${failure}`);
}

async function report(env, message, tags) {
  console.error(message);
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

const github = (env) => ({
  Authorization: `Bearer ${env.GITHUB_TOKEN}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'vibe-idx-dispatch',
});

async function running(env, workflow) {
  const response = await request(
    'GitHub workflow runs',
    `${workflows}/${workflow}/runs?per_page=10`,
    {
      headers: github(env),
    },
  );
  const { workflow_runs } = await response.json();
  return workflow_runs.some((run) => ACTIVE.includes(run.status));
}

async function dispatch(env, workflow) {
  await request(`GitHub dispatch ${workflow}`, `${workflows}/${workflow}/dispatches`, {
    method: 'POST',
    headers: { ...github(env), 'Content-Type': 'application/json' },
    body: JSON.stringify({ ref: 'master' }),
  });
}

// Runs at 19:00 Jakarta, after the 17:17 batch should have published.
async function checkFreshness(env, now) {
  const status = await (await request('health.json', `${health}?t=${now}`)).json();
  const published = new Date(`${status.run_at.slice(0, 19).replace(' ', 'T')}Z`);
  if (!(now - published < 6 * HOUR)) {
    let outcome = 'a catch-up run is already running';
    try {
      if (!(await running(env, 'ingest.yml'))) {
        await dispatch(env, 'ingest.yml');
        outcome = 'started a catch-up run';
      }
    } catch (error) {
      outcome = `catch-up run failed to start: ${error.message}`;
    }
    await report(env, `Daily IDX batch has not published since ${status.run_at}; ${outcome}`, {
      check: 'published',
    });
  }
  // IDX has no summary on weekends and holidays, so only a day IDX published can be stale.
  const today = jakartaDate(now);
  for (const [source, path] of [
    ['prices', 'GetStockSummary'],
    ['indices', 'GetIndexSummary'],
  ]) {
    const response = await request(
      `IDX ${path}`,
      `https://www.idx.id/primary/TradingSummary/${path}?date=${today.replaceAll('-', '')}&start=0&length=1`,
      { headers: { 'User-Agent': UA } },
    );
    const { recordsTotal } = await response.json();
    if (recordsTotal > 0 && status[source] !== today)
      await report(
        env,
        `IDX published ${source} for ${today}, but the site has ${status[source]}`,
        {
          check: source,
        },
      );
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.slice('/bps'.length);
    if (
      !url.pathname.startsWith('/bps/') ||
      !/^(?:\/(?:id|en)\/arc|\/_next\/static\/.+)$/.test(path) ||
      !['GET', 'POST'].includes(request.method) ||
      !env.BPS_PROXY_TOKEN
    )
      return new Response(null, { status: 404 });
    const encode = (value) => new TextEncoder().encode(value);
    const key = await crypto.subtle.importKey(
      'raw',
      encode(env.BPS_PROXY_TOKEN),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign', 'verify'],
    );
    // Web Crypto verifies the MAC in constant time instead of comparing secret strings.
    const signature = await crypto.subtle.sign(
      'HMAC',
      key,
      encode(`Bearer ${env.BPS_PROXY_TOKEN}`),
    );
    if (
      !(await crypto.subtle.verify(
        'HMAC',
        key,
        signature,
        encode(request.headers.get('Authorization') ?? ''),
      ))
    )
      return new Response(null, { status: 404 });
    const headers = new Headers({ Origin: 'https://www.bps.go.id', 'User-Agent': UA });
    for (const name of ['Next-Action', 'Content-Type', 'Accept']) {
      const value = request.headers.get(name);
      if (value !== null) headers.set(name, value);
    }
    const response = await fetch(`https://www.bps.go.id${path}${url.search}`, {
      method: request.method,
      headers,
      body: request.method === 'POST' ? await request.arrayBuffer() : undefined,
      redirect: 'manual',
    });
    const responseHeaders = new Headers();
    const contentType = response.headers.get('Content-Type');
    if (contentType !== null) responseHeaders.set('Content-Type', contentType);
    return new Response(response.body, { status: response.status, headers: responseHeaders });
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
      else if (job === 'ingest.yml' || !(await running(env, job))) await dispatch(env, job);
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
