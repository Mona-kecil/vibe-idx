import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import type { BrowserContext, Route } from 'playwright-core';
import { createBrokerHandler } from '../api/_brokers';

type Entry = { file: string; status: number; contentType: string };
type Index = Record<string, Entry>;

const publicData = 'https://pub-7982bfb066694e6e8615750132283eba.r2.dev';
const liveApi = 'https://vibe-idx.vercel.app';

async function brokerHandler(privateSite: string) {
  const clientId = 'client_hillclimb';
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwks = { keys: [{ ...(await exportJWK(publicKey)), alg: 'RS256', kid: 'hillclimb' }] };
  const token = await new SignJWT({ sid: 'hillclimb' })
    .setProtectedHeader({ alg: 'RS256', kid: 'hillclimb' })
    .setIssuer(`https://api.workos.com/user_management/${clientId}`)
    .setSubject('hillclimb')
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(privateKey);
  const handle = createBrokerHandler({
    env: { WORKOS_CLIENT_ID: clientId },
    fetcher: async () => Response.json(jwks),
    store: (key) =>
      readFile(join(privateSite, key)).then(
        (bytes) => new Response(bytes),
        () => new Response(null, { status: 404 }),
      ),
    reportFailure: async (route, failure) => console.error(route, failure),
  });
  return (url: URL) => handle(new Request(url, { headers: { Authorization: `Bearer ${token}` } }));
}

async function upstream(route: Route, url: URL, brokers: (url: URL) => Promise<Response>) {
  if (url.pathname === '/api/brokers') {
    const response = await brokers(url);
    const body = Buffer.from(await response.arrayBuffer());
    const gzip = response.headers.get('content-encoding') === 'gzip';
    return {
      status: response.status,
      contentType: response.headers.get('content-type') ?? 'application/json',
      body: gzip
        ? Buffer.from(
            await new Response(
              new Blob([body]).stream().pipeThrough(new DecompressionStream('gzip')),
            ).arrayBuffer(),
          )
        : body,
    };
  }
  const target = url.pathname.startsWith('/data/')
    ? `${publicData}${url.pathname.slice('/data'.length)}${url.search}`
    : url.pathname.startsWith('/api/')
      ? `${liveApi}${url.pathname}${url.search}`
      : url.href;
  const response = await route.fetch({ url: target });
  return {
    status: response.status(),
    contentType: response.headers()['content-type'] ?? 'application/octet-stream',
    body: await response.body(),
  };
}

/**
 * Serves every non-local request, plus /data and /api, from a frozen store.
 * With record set, misses are fetched (public data and fonts live, broker data from a local copy
 * of the private bucket) and saved, so later runs see identical bytes.
 */
export async function frozenStore({
  store,
  record,
  privateSite,
}: {
  store: string;
  record: boolean;
  privateSite: string;
}) {
  const responses = join(store, 'responses');
  await mkdir(responses, { recursive: true });
  const indexPath = join(store, 'index.json');
  const index: Index = JSON.parse(await readFile(indexPath, 'utf8').catch(() => '{}'));
  const brokers = record ? await brokerHandler(privateSite) : null;
  const misses = new Set<string>();

  const attach = (context: BrowserContext) =>
    context.route(
      (url) => url.hostname !== 'localhost' || /^\/(data|api)\//.test(url.pathname),
      async (route) => {
        const url = new URL(route.request().url());
        const key = url.hostname === 'localhost' ? `${url.pathname}${url.search}` : url.href;
        let entry = index[key];
        if (!entry && brokers) {
          const response = await upstream(route, url, brokers);
          const file = createHash('sha1').update(key).digest('hex');
          await writeFile(join(responses, file), response.body);
          entry = index[key] = { file, status: response.status, contentType: response.contentType };
        }
        if (!entry) {
          misses.add(key);
          return route.fulfill({ status: 404, body: '' });
        }
        return route.fulfill({
          status: entry.status,
          contentType: entry.contentType,
          body: await readFile(join(responses, entry.file)),
        });
      },
    );
  return { attach, misses, save: () => writeFile(indexPath, JSON.stringify(index, null, 1)) };
}
