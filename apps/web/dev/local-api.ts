import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { z } from 'zod';
import { createBrokerHandler } from '../api/_brokers.js';

export const fixturesRoot =
  process.env.VIBE_IDX_FIXTURES ?? join(homedir(), '.cache/vibe-idx/local');

const stateSchema = z.object({ asOf: z.iso.date(), sessions: z.array(z.iso.date()) });
export async function fixtureState() {
  const file = join(fixturesRoot, 'fixtures.json');
  const text = await readFile(file, 'utf8').catch(() => {
    throw new Error(`No fixtures in ${fixturesRoot}. Run \`pnpm fixtures\` first.`);
  });
  return stateSchema.parse(JSON.parse(text));
}

/** The production broker API, signed in as a local user and reading the fixtures in place of the private bucket. */
export async function localBrokerApi() {
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
