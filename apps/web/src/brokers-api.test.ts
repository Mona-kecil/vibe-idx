import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import ts from 'typescript';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vite-plus/test';
import type { JWTPayload } from 'jose';
import api, { createBrokerHandler } from '../api/brokers';
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
  investor_type: 'D',
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
  it('loads emitted broker and news APIs in native Node ESM without missing shared modules', () => {
    const webRoot = fileURLToPath(new URL('..', import.meta.url));
    const output = mkdtempSync(join(tmpdir(), 'vibe-idx-api-esm-'));
    try {
      const program = ts.createProgram(
        [join(webRoot, 'api/brokers.ts'), join(webRoot, 'api/news.ts')],
        {
          rootDir: webRoot,
          outDir: output,
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.ESNext,
          moduleResolution: ts.ModuleResolutionKind.Bundler,
        },
      );
      expect(program.emit().emitSkipped).toBe(false);
      writeFileSync(join(output, 'package.json'), '{"type":"module"}');
      symlinkSync(join(webRoot, 'node_modules'), join(output, 'node_modules'), 'dir');
      execFileSync(
        process.execPath,
        [
          '--input-type=module',
          '--eval',
          `
            import assert from 'node:assert/strict';
            globalThis.fetch = () => { throw new Error('Unexpected upstream request'); };
            const { default: brokers } = await import('./api/brokers.js');
            const { default: news } = await import('./api/news.js');
            const brokerResponse = await brokers.fetch(new Request('https://vibe.test/api/brokers?ticker=BBCA'));
            assert.equal(brokerResponse.status, 401);
            assert.deepEqual(await brokerResponse.json(), { error: 'unauthorized' });
            const accumulationResponse = await brokers.fetch(new Request('https://vibe.test/api/brokers?view=market'));
            assert.equal(accumulationResponse.status, 401);
            const newsResponse = await news.fetch(new Request('https://vibe.test/api/news?ticker=../auth/stockbit'));
            assert.equal(newsResponse.status, 400);
            assert.deepEqual(await newsResponse.json(), { error: 'invalid_ticker' });
          `,
        ],
        { cwd: output, env: {} },
      );
    } finally {
      rmSync(output, { recursive: true, force: true });
    }
  });

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
    for (const method of ['POST', 'PUT', 'DELETE', 'OPTIONS', 'HEAD']) {
      const response = await api.fetch(request({ method }));
      expect(response.status).toBe(405);
      expect(response.headers.get('Allow')).toBe('GET');
      expectPrivate(response);
    }
    const handle = createBrokerHandler({ env, fetcher });
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
    const handle = createBrokerHandler({ env, fetcher });
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
