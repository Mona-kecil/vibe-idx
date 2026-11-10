import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import type { Plugin } from 'vite-plus';
import { createBrokerHandler } from '../api/_brokers';

const clientId = 'client_fixtures';
const issuer = `https://api.workos.com/user_management/${clientId}`;

/**
 * Serves `/api/brokers` from `dir`, a local copy of the private bucket's `site/` files, and signs every visitor in.
 * The real handler still verifies the session, against a key pair made at startup instead of WorkOS.
 */
export function fixtures(dir: string): Plugin {
  const keys = generateKeyPair('RS256');
  const token = keys.then(({ privateKey }) =>
    new SignJWT({ sid: 'fixtures' })
      .setProtectedHeader({ alg: 'RS256', kid: 'fixtures' })
      .setIssuer(issuer)
      .setSubject('fixtures')
      .setIssuedAt()
      .setExpirationTime('30d')
      .sign(privateKey),
  );
  const handle = keys.then(async ({ publicKey }) => {
    const jwks = { keys: [{ ...(await exportJWK(publicKey)), alg: 'RS256', kid: 'fixtures' }] };
    return createBrokerHandler({
      env: { WORKOS_CLIENT_ID: clientId },
      fetcher: async () => Response.json(jwks),
      store: (key) =>
        readFile(join(dir, key)).then(
          (bytes) => new Response(bytes),
          () => new Response(null, { status: 404 }),
        ),
      reportFailure: async (route, failure) => console.error(route, failure),
    });
  });

  return {
    name: 'vibe-idx-fixtures',
    apply: 'serve',
    async config() {
      return {
        define: {
          'import.meta.env.VITE_FIXTURE_TOKEN': JSON.stringify(await token),
          'import.meta.env.VITE_WORKOS_CLIENT_ID': JSON.stringify(clientId),
        },
        resolve: {
          alias: {
            '@workos-inc/authkit-react': fileURLToPath(new URL('./authkit.tsx', import.meta.url)),
          },
        },
      };
    },
    configureServer(server) {
      server.middlewares.use('/api/brokers', (req, res) => {
        const request = new Request(new URL(req.url ?? '/', 'http://localhost/api/brokers'), {
          headers: { Authorization: req.headers.authorization ?? '' },
        });
        void handle
          .then((serve) => serve(request))
          .then(async (response) => {
            res.writeHead(response.status, Object.fromEntries(response.headers));
            res.end(Buffer.from(await response.arrayBuffer()));
          });
      });
    },
  };
}
