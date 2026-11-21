import { createServer } from 'node:http';
import { once } from 'node:events';
import { gzipSync } from 'node:zlib';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vite-plus/test';
import type { JWTPayload } from 'jose';
import { createBrokerHandler } from '../api/_brokers';
import { brokerHistorySchema } from './brokers';
import type { BrokerDay, BrokerRow } from './brokers';

const clientId = 'client_TEST';
const accountId = 'a'.repeat(32);
const env = {
  WORKOS_CLIENT_ID: clientId,
  R2_ACCOUNT_ID: accountId,
  R2_ACCESS_KEY_ID: 'fixture-access-key',
  R2_SECRET_ACCESS_KEY: 'fixture-secret-key',
};
const row: BrokerRow = {
  broker: 'YP',
  investor: 'domestic',
  broker_type: 'local',
  shares: 1250000,
  value: 1234567890,
  avg_price: 987,
  freq: 42,
};
const day: BrokerDay = { date: '2026-10-23', board: 'regular', buy: [row], sell: [] };

let keys: Awaited<ReturnType<typeof generateKeyPair>>;
let otherClientKeys: Awaited<ReturnType<typeof generateKeyPair>>;
let jwksBody: unknown;
let jwksStatus: number;
let storageStatus: number;
let storageBody: string;
let origin: string;
const outboundUrls: string[] = [];
const jwksPaths: string[] = [];
const storageReads: { path: string; authorization: string }[] = [];

const server = createServer((request, response) => {
  if (request.url?.startsWith('/sso/jwks/')) {
    jwksPaths.push(request.url);
    response.writeHead(jwksStatus, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(jwksBody));
    return;
  }
  storageReads.push({
    path: request.url ?? '',
    authorization: request.headers.authorization ?? '',
  });
  response.writeHead(storageStatus, { 'Content-Type': 'application/json' });
  response.end(request.url?.endsWith('.gz') ? gzipSync(storageBody) : storageBody);
});

const fetcher: typeof fetch = (input, init) => {
  const request = new Request(input, init);
  const url = new URL(request.url);
  outboundUrls.push(url.href);
  if (
    url.hostname !== 'api.workos.com' &&
    url.hostname !== `${accountId}.r2.cloudflarestorage.com`
  ) {
    throw new Error('Unexpected upstream host');
  }
  return fetch(new URL(url.pathname, origin), request);
};

function request({
  token,
  query = 'ticker=BBCA',
  method = 'GET',
}: { token?: string; query?: string; method?: string } = {}) {
  return new Request(`http://localhost/api/brokers?${query}`, {
    method,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

function token(claims: JWTPayload = {}, signingKey = keys.privateKey) {
  return new SignJWT({
    sub: 'user_test',
    sid: 'session_test',
    iat: Math.floor(Date.now() / 1000),
    iss: `https://api.workos.com/user_management/${clientId}`,
    exp: Math.floor(Date.now() / 1000) + 300,
    ...claims,
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'workos-test-key' })
    .sign(signingKey);
}

function expectPrivate(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  expect(response.headers.get('Vary')).toBe('Authorization');
  expect(response.headers.has('Access-Control-Allow-Origin')).toBe(false);
}

beforeAll(async () => {
  [keys, otherClientKeys] = await Promise.all([generateKeyPair('RS256'), generateKeyPair('RS256')]);
  const publicKey = await exportJWK(keys.publicKey);
  jwksBody = { keys: [{ ...publicKey, alg: 'RS256', use: 'sig', kid: 'workos-test-key' }] };
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected a TCP fixture server');
  origin = `http://127.0.0.1:${address.port}`;
});

beforeEach(() => {
  outboundUrls.length = 0;
  jwksPaths.length = 0;
  storageReads.length = 0;
  jwksStatus = 200;
  storageStatus = 200;
  storageBody = JSON.stringify([day]);
});

afterAll(async () => {
  const closed = once(server, 'close');
  server.close();
  server.closeAllConnections();
  await closed;
});

describe('private broker API', () => {
  it('rejects missing, forged, wrong-client, wrong-issuer, expired, and incomplete JWTs before R2 reads', async () => {
    const handle = createBrokerHandler({ env, fetcher });
    const hmac = await new SignJWT({ sub: 'user_test', exp: 9999999999 })
      .setProtectedHeader({ alg: 'HS256' })
      .sign(new Uint8Array(32));
    for (const invalid of [
      undefined,
      'not-a-jwt',
      await token({}, otherClientKeys.privateKey),
      await token({ iss: 'https://attacker.example/' }),
      await token({ iss: 'https://api.workos.com/' }),
      await token({ iss: 'https://api.workos.com' }),
      await token({ iss: 'https://api.workos.com/user_management/client_OTHER' }),
      await token({ iss: `https://api.workos.com/user_management/${clientId}/` }),
      await token({ exp: Math.floor(Date.now() / 1000) - 1 }),
      await token({ exp: undefined }),
      await token({ sub: undefined }),
      await token({ sub: '' }),
      await token({ sub: ' ' }),
      await token({ sid: undefined }),
      await token({ sid: '' }),
      await token({ iat: undefined }),
      hmac,
    ]) {
      const response = await handle(request({ token: invalid }));
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: 'unauthorized' });
      expectPrivate(response);
    }
    const malformedBearer = request();
    malformedBearer.headers.set('Authorization', 'Basic secret');
    expect((await handle(malformedBearer)).status).toBe(401);
    expect(storageReads).toEqual([]);
    expect(jwksPaths).toEqual([`/sso/jwks/${clientId}`]);
    const success = await handle(request({ token: await token() }));
    expect(success.status).toBe(200);
    expect(storageReads).toHaveLength(1);
  });

  it('passes a session tick file through gzipped and rejects malformed tick targets', async () => {
    const keys: string[] = [];
    const stored = gzipSync(JSON.stringify({ date: '2026-11-10', ticker: 'BBCA' }));
    const handle = createBrokerHandler({
      env: { WORKOS_CLIENT_ID: clientId },
      fetcher,
      store: async (key) => {
        keys.push(key);
        return key.endsWith('.book.json.gz')
          ? new Response(stored)
          : new Response('', { status: 404 });
      },
    });
    const auth = await token();
    const book = await handle(
      request({ token: auth, query: 'view=ticks&ticker=BBCA&date=2026-11-10&kind=book' }),
    );
    expect(book.status).toBe(200);
    expect(book.headers.get('Content-Encoding')).toBe('gzip');
    expect(Buffer.from(await book.arrayBuffer()).equals(stored)).toBe(true);
    const trades = await handle(
      request({ token: auth, query: 'view=ticks&ticker=BBCA&date=2026-11-10&kind=trades' }),
    );
    expect(trades.status).toBe(404);
    expect(keys.filter((key) => key !== 'site/bars/sessions.json')).toEqual([
      'site/ticks/BBCA/2026-11-10.book.json.gz',
      'site/ticks/BBCA/2026-11-10.trades.json.gz',
    ]);
    for (const query of [
      'view=ticks&ticker=BBCA&date=2026-11-10',
      'view=ticks&ticker=BBCA&date=11-10-2026&kind=book',
      'view=ticks&ticker=BBCA&date=2026-11-10&kind=../broker',
      'view=other&ticker=BBCA',
    ])
      expect((await handle(request({ token: auth, query }))).status).toBe(400);
  });

  describe('caching a session in the browser', () => {
    const stored = gzipSync(JSON.stringify({ date: '2026-11-10', ticker: 'BBCA' }));
    let published: string | null;
    const handle = createBrokerHandler({
      env: { WORKOS_CLIENT_ID: clientId },
      fetcher,
      store: async (key) => {
        if (key === 'site/bars/sessions.json')
          return published === null ? new Response('', { status: 404 }) : new Response(published);
        return key.startsWith('site/ticks/BBCA/2026-11-1')
          ? new Response(stored)
          : new Response('', { status: 404 });
      },
    });
    const sessions = (...days: string[]) => JSON.stringify({ sessions: days });
    async function ticks(date: string, kind = 'trades') {
      return handle(
        request({
          token: await token(),
          query: `view=ticks&ticker=BBCA&date=${date}&kind=${kind}`,
        }),
      );
    }

    it('keeps a session before the latest one in a private, token-specific browser cache', async () => {
      published = sessions('2026-11-09', '2026-11-10', '2026-11-11');
      for (const kind of ['trades', 'book']) {
        const response = await ticks('2026-11-10', kind);
        expect(response.status).toBe(200);
        expect(response.headers.get('Cache-Control')).toBe('private, max-age=31536000, immutable');
        expect(response.headers.get('Vary')).toBe('Authorization');
        expect(response.headers.has('Access-Control-Allow-Origin')).toBe(false);
        expect(Buffer.from(await response.arrayBuffer()).equals(stored)).toBe(true);
      }
    });

    it('never keeps the latest session, a newer one, or any session when the list is unknown', async () => {
      published = sessions('2026-11-09', '2026-11-10');
      expectPrivate(await ticks('2026-11-10'));
      expectPrivate(await ticks('2026-11-11'));
      for (const unknown of [
        null,
        'not json',
        JSON.stringify({ sessions: ['10 Nov'] }),
        sessions(),
      ]) {
        published = unknown;
        const response = await ticks('2026-11-10');
        expect(response.status).toBe(200);
        expectPrivate(response);
      }
    });

    it('never keeps a session that is not published, a failed read, or a bar file', async () => {
      published = sessions('2026-11-09', '2026-11-15');
      expectPrivate(await ticks('2026-11-08'));
      const degraded = createBrokerHandler({
        env: { WORKOS_CLIENT_ID: clientId },
        fetcher,
        store: async (key) =>
          key === 'site/bars/sessions.json'
            ? new Response(published)
            : key === 'site/bars/BBCA.json.gz'
              ? new Response(stored)
              : new Response('', { status: 503 }),
      });
      const auth = await token();
      const response = await degraded(request({ token: auth, query: 'view=bars&ticker=BBCA' }));
      expect(response.status).toBe(200);
      expectPrivate(response);
      const failed = await degraded(
        request({ token: auth, query: 'view=ticks&ticker=BBCA&date=2026-11-09&kind=book' }),
      );
      expect(failed.status).toBe(503);
      expectPrivate(failed);
    });
  });

  it("passes a ticker's bar file through gzipped, behind the same sign-in", async () => {
    const keys: string[] = [];
    const stored = gzipSync(JSON.stringify({ ticker: 'BBCA', time: [] }));
    const handle = createBrokerHandler({
      env: { WORKOS_CLIENT_ID: clientId },
      fetcher,
      store: async (key) => {
        keys.push(key);
        return key === 'site/bars/BBCA.json.gz'
          ? new Response(stored)
          : new Response('', { status: 404 });
      },
    });
    const query = 'view=bars&ticker=BBCA';
    expect((await handle(request({ query }))).status).toBe(401);
    expect(keys).toEqual([]);
    const auth = await token();
    const bars = await handle(request({ token: auth, query }));
    expect(bars.status).toBe(200);
    expect(bars.headers.get('Content-Encoding')).toBe('gzip');
    expectPrivate(bars);
    expect(Buffer.from(await bars.arrayBuffer()).equals(stored)).toBe(true);
    expect((await handle(request({ token: auth, query: 'view=bars&ticker=TLKM' }))).status).toBe(
      404,
    );
    expect((await handle(request({ token: auth, query: 'view=bars' }))).status).toBe(400);
    expect(keys).toEqual(['site/bars/BBCA.json.gz', 'site/bars/TLKM.json.gz']);
  });

  it('passes one broker across tickers and its session through gzipped and rejects bad codes', async () => {
    const keys: string[] = [];
    const ledger = {
      broker: 'HP',
      days: [
        {
          date: '2026-11-10',
          board: 'regular',
          ticker: ['BBCA', 'SINI'],
          buy_value: [10, 20],
          buy_shares: [1, 2],
          sell_value: [0, 5],
          sell_shares: [0, 1],
        },
      ],
    };
    const year = gzipSync(JSON.stringify(ledger));
    const session = gzipSync(JSON.stringify({ date: '2026-11-10', broker: 'HP' }));
    const handle = createBrokerHandler({
      env: { WORKOS_CLIENT_ID: clientId },
      fetcher,
      store: async (key) => {
        keys.push(key);
        return new Response(key.includes('broker-ticks') ? session : year);
      },
    });
    const auth = await token();
    const range = await handle(request({ token: auth, query: 'view=broker&broker=HP' }));
    expect(range.status).toBe(200);
    expectPrivate(range);
    expect(range.headers.get('Content-Encoding')).toBe('gzip');
    expect(Buffer.from(await range.arrayBuffer()).equals(year)).toBe(true);
    const day = await handle(
      request({ token: auth, query: 'view=broker&broker=HP&date=2026-11-10' }),
    );
    expect(day.headers.get('Content-Encoding')).toBe('gzip');
    expect(Buffer.from(await day.arrayBuffer()).equals(session)).toBe(true);
    expect(keys).toEqual([
      'site/broker-ledger/HP.json.gz',
      'site/broker-ticks/HP/2026-11-10.json.gz',
    ]);
    for (const query of [
      'view=broker',
      'view=broker&broker=../HP',
      'view=broker&broker=hp',
      'view=broker&broker=HP&date=2026-13',
    ])
      expect((await handle(request({ token: auth, query }))).status).toBe(400);
    expect(keys).toHaveLength(2);
  });

  it('reads broker history from an injected store without R2 credentials', async () => {
    const keys: string[] = [];
    const handle = createBrokerHandler({
      env: { WORKOS_CLIENT_ID: clientId },
      fetcher,
      store: async (key) => {
        keys.push(key);
        return new Response(gzipSync(JSON.stringify([day])));
      },
    });
    expect((await handle(request())).status).toBe(401);
    const response = await handle(request({ token: await token() }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ticker: 'BBCA', days: [day] });
    expect(keys).toEqual(['site/broker/BBCA.json.gz']);
    expect(storageReads).toEqual([]);
  });

  it('protects market accumulation with the same JWT checks and reads only the private summary key', async () => {
    const handle = createBrokerHandler({ env, fetcher });
    for (const invalid of [
      undefined,
      'not-a-jwt',
      await token({ exp: 1 }),
      await token({}, otherClientKeys.privateKey),
    ]) {
      const response = await handle(request({ query: 'view=market', token: invalid }));
      expect(response.status).toBe(401);
      expectPrivate(response);
    }
    expect(storageReads).toEqual([]);
    const body = {
      date: '2026-10-23',
      stocks: [
        { ticker: 'BBCA', windows: { '1d': { pct: 0.2, broker: 'YP' }, '3d': null, '5d': null } },
      ],
    };
    storageBody = JSON.stringify(body);
    const response = await handle(request({ query: 'view=market', token: await token() }));
    expect(response.status).toBe(200);
    expectPrivate(response);
    expect(await response.json()).toEqual({
      ...body,
      stocks: [
        {
          ticker: 'BBCA',
          windows: {
            '1d': {
              pct: 0.2,
              broker: 'YP',
              size: null,
              broker_avg: null,
              stock_avg: null,
              buy_trades: null,
              trades: null,
            },
            '3d': null,
            '5d': null,
          },
        },
      ],
    });
    expect(storageReads[0]?.path).toBe('/vibe-idx-private/site/market-accumulation.json');
  });

  it('blocks unsupported methods and unsafe ticker paths without touching WorkOS or R2', async () => {
    const handle = createBrokerHandler({ env, fetcher });
    for (const method of ['POST', 'PUT', 'DELETE', 'OPTIONS', 'HEAD']) {
      const response = await handle(request({ method }));
      expect(response.status).toBe(405);
      expect(response.headers.get('Allow')).toBe('GET');
      expectPrivate(response);
    }
    for (const ticker of [
      '',
      'bbca',
      '../auth/token',
      'BBCA/../BBRI',
      'A'.repeat(13),
      'BBCA\n',
      '%2e%2e',
    ]) {
      const response = await handle(request({ query: new URLSearchParams({ ticker }).toString() }));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: 'invalid_ticker' });
      expectPrivate(response);
    }
    for (const query of ['', 'ticker=BBCA&ticker=BBRI', 'path=site/broker/BBCA.json']) {
      expect((await handle(request({ query }))).status).toBe(400);
    }
    expect(outboundUrls).toEqual([]);
    expect(jwksPaths).toEqual([]);
    expect(storageReads).toEqual([]);
  });

  it('keeps January broker history beyond 90 source days with signed private reads and no cached data', async () => {
    const days = Array.from({ length: 95 }, (_, index) => ({
      ...day,
      date: new Date(Date.UTC(2026, 0, index + 2)).toISOString().slice(0, 10),
      sell: [{ ...row, broker: 'CC' }],
      internal: 'must not escape the schema',
    }));
    storageBody = JSON.stringify(days);
    const handle = createBrokerHandler({ env, fetcher });
    const auth = await token();
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await handle(
        request({ token: auth, query: 'ticker=BBCA-W2&path=auth/token.json' }),
      );
      expect(response.status).toBe(200);
      expectPrivate(response);
      const body: unknown = await response.json();
      const history = brokerHistorySchema.parse(body);
      expect(history.days).toHaveLength(95);
      expect(body).toEqual(history);
      expect(history).toEqual({
        ticker: 'BBCA-W2',
        days: days
          .slice()
          .reverse()
          .map(({ date, board, buy, sell }) => ({ date, board, buy, sell })),
      });
      expect(JSON.stringify(body)).not.toContain('cloudflarestorage');
    }
    expect(jwksPaths).toEqual([`/sso/jwks/${clientId}`]);
    expect(storageReads).toHaveLength(2);
    for (const read of storageReads) {
      expect(read.path).toBe('/vibe-idx-private/site/broker/BBCA-W2.json.gz');
      expect(read.authorization).toMatch(
        /^AWS4-HMAC-SHA256 Credential=fixture-access-key\/\d{8}\/auto\/s3\/aws4_request, SignedHeaders=.+, Signature=[a-f0-9]{64}$/,
      );
    }
    expect(outboundUrls).toEqual([
      `https://api.workos.com/sso/jwks/${clientId}`,
      `https://${accountId}.r2.cloudflarestorage.com/vibe-idx-private/site/broker/BBCA-W2.json.gz`,
      `https://${accountId}.r2.cloudflarestorage.com/vibe-idx-private/site/broker/BBCA-W2.json.gz`,
    ]);
  });

  it('maps missing objects to 404 and storage failures or malformed broker days to 503', async () => {
    const reports: unknown[] = [];
    const handle = createBrokerHandler({
      env,
      fetcher,
      reportFailure: async (_route, failure) => void reports.push(failure),
    });
    const auth = await token();
    for (const status of [404, 403, 429, 500, 503]) {
      storageStatus = status;
      storageBody = 'private upstream diagnostic';
      const response = await handle(request({ token: auth }));
      expect(response.status).toBe(status === 404 ? 404 : 503);
      expect(await response.json()).toEqual({
        error: status === 404 ? 'not_found' : 'unavailable',
      });
      expectPrivate(response);
    }
    expect(reports).toEqual([403, 429, 500, 503].map((status) => `R2 BBCA HTTP ${status}`));
    storageStatus = 200;
    for (const body of [
      'invalid JSON',
      JSON.stringify({ ticker: 'BBCA', days: [day] }),
      JSON.stringify([{ ...day, date: '2026-02-30' }]),
      JSON.stringify([{ ...day, buy: [{ ...row, shares: '100' }] }]),
      JSON.stringify([{ ...day, sell: null }]),
      JSON.stringify([{ ...day, board: 'all' }]),
    ]) {
      storageBody = body;
      const response = await handle(request({ token: auth }));
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: 'unavailable' });
      expectPrivate(response);
    }
    expect(reports.slice(4)).toHaveLength(6);
    expect(reports.slice(4).every((failure) => failure instanceof Error)).toBe(true);
    storageBody = '[]';
    const empty = await handle(request({ token: auth }));
    expect(empty.status).toBe(200);
    expect(await empty.json()).toEqual({ ticker: 'BBCA', days: [] });
  });

  it('returns 503 for missing configuration or JWKS and storage transport failures without leaking upstream errors', async () => {
    const auth = await token();
    for (const name of Object.keys(env)) {
      const config: NodeJS.ProcessEnv = { ...env };
      delete config[name];
      const handle = createBrokerHandler({ env: config, fetcher });
      expect((await handle(request())).status).toBe(401);
      const response = await handle(request({ token: auth }));
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: 'unavailable' });
      expectPrivate(response);
    }
    jwksStatus = 500;
    const jwksDown = await createBrokerHandler({ env, fetcher })(request({ token: auth }));
    expect(jwksDown.status).toBe(503);
    expect(storageReads).toEqual([]);
    jwksStatus = 200;
    const storageDown = createBrokerHandler({
      env,
      fetcher: (input, init) => {
        if (new Request(input, init).url.includes('cloudflarestorage.com')) {
          return Promise.reject(new TypeError('secret storage diagnostic'));
        }
        return fetcher(input, init);
      },
    });
    const response = await storageDown(request({ token: auth }));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'unavailable' });
    expectPrivate(response);
  });
});
