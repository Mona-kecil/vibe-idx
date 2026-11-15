import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { fixturePaths, fixturesWriter, fixtureStateSchema } from '../../pipeline/dev/local-r2.js';
import type { createBrokerHandler as BrokerHandler } from '../api/_brokers.js';

export const fixturesRoot = fixturePaths().root;

export async function fixtureState() {
  const writer = fixturesWriter();
  if (writer)
    throw new Error(
      `\`pnpm fixtures\` (pid ${writer}) is rewriting ${fixturesRoot}. Wait for it to finish.`,
    );
  const text = await readFile(fixturePaths().state, 'utf8').catch(() => {
    throw new Error(`No fixtures in ${fixturesRoot}. Run \`pnpm fixtures\` first.`);
  });
  return fixtureStateSchema.parse(JSON.parse(text));
}

/**
 * The production broker API, signed in as a local user and reading the fixtures in place of the private bucket.
 * `web` picks whose API code runs, so a before shot uses the base checkout's handler.
 */
export async function localBrokerApi(web = fileURLToPath(new URL('..', import.meta.url))) {
  const { createBrokerHandler } = (await import(
    pathToFileURL(join(web, 'api/_brokers.ts')).href
  )) as {
    createBrokerHandler: typeof BrokerHandler;
  };
  const clientId = 'client_local';
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwks = { keys: [{ ...(await exportJWK(publicKey)), alg: 'RS256', kid: 'local' }] };
  const token = await new SignJWT({ sid: 'local' })
    .setProtectedHeader({ alg: 'RS256', kid: 'local' })
    .setIssuer(`https://api.workos.com/user_management/${clientId}`)
    .setSubject('local')
    .setIssuedAt()
    .setExpirationTime('12h')
    .sign(privateKey);
  const handle = createBrokerHandler({
    env: { WORKOS_CLIENT_ID: clientId },
    fetcher: async () => Response.json(jwks),
    store: (key) =>
      readFile(join(fixturesRoot, 'bucket', key)).then(
        (bytes) => new Response(bytes),
        () => new Response(null, { status: 404 }),
      ),
    reportFailure: async (route, failure) => console.error(route, failure),
  });
  return {
    token,
    handle,
    /** The response body as JSON, inflating the gzip the handler passes through for browsers. */
    async json(search: string) {
      const response = await handle(
        new Request(`http://localhost/api/brokers?${search}`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      );
      if (response.status === 404) return undefined;
      if (!response.ok) throw new Error(`/api/brokers?${search} HTTP ${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      return JSON.parse(
        (response.headers.get('Content-Encoding') === 'gzip'
          ? gunzipSync(bytes)
          : bytes
        ).toString(),
      ) as unknown;
    },
  };
}
