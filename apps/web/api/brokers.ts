import { AwsClient } from 'aws4fetch';
import { createRemoteJWKSet, customFetch, errors, jwtVerify } from 'jose';
import { z } from 'zod';
import { accumulationSchema, brokerDaySchema, brokerTickerSchema } from '../src/brokers.js';

const clientIdSchema = z.string().regex(/^client_[a-zA-Z0-9]+$/);
const storageConfigSchema = z.object({
  R2_ACCOUNT_ID: z.string().regex(/^[a-f0-9]{32}$/),
  R2_ACCESS_KEY_ID: z.string().min(1),
  R2_SECRET_ACCESS_KEY: z.string().min(1),
});
const sourceSchema = z.array(brokerDaySchema);

function json(body: unknown, status: number, headers?: Record<string, string>) {
  return Response.json(body, {
    status,
    headers: {
      'Cache-Control': 'private, no-store',
      Vary: 'Authorization',
      ...headers,
    },
  });
}

export function createBrokerHandler({
  env = process.env,
  fetcher = fetch,
}: {
  env?: NodeJS.ProcessEnv;
  fetcher?: typeof fetch;
} = {}) {
  const clientId = clientIdSchema.safeParse(env.WORKOS_CLIENT_ID);
  const jwks = clientId.success
    ? createRemoteJWKSet(new URL(`https://api.workos.com/sso/jwks/${clientId.data}`), {
        [customFetch]: fetcher,
      })
    : null;

  return async function handle(request: Request): Promise<Response> {
    if (request.method !== 'GET') {
      return json({ error: 'method_not_allowed' }, 405, { Allow: 'GET' });
    }

    const params = new URL(request.url).searchParams;
    const isMarket = params.getAll('view').length === 1 && params.get('view') === 'market';
    const tickers = params.getAll('ticker');
    const ticker = brokerTickerSchema.safeParse(tickers.length === 1 ? tickers[0] : undefined);
    const target = isMarket ? 'market' : ticker.success ? { ticker: ticker.data } : null;
    if (!target) return json({ error: 'invalid_ticker' }, 400);

    const bearer = /^Bearer (\S+)$/i.exec(request.headers.get('Authorization') ?? '');
    if (!bearer?.[1]) return json({ error: 'unauthorized' }, 401);
    if (!jwks) return json({ error: 'unavailable' }, 503);

    try {
      const { payload } = await jwtVerify(bearer[1], jwks, {
        algorithms: ['RS256'],
        issuer: `https://api.workos.com/user_management/${clientId.data}`,
        requiredClaims: ['sub', 'sid', 'exp', 'iat'],
      });
      if (
        typeof payload.sub !== 'string' ||
        !payload.sub.trim() ||
        typeof payload.sid !== 'string' ||
        !payload.sid.trim()
      ) {
        return json({ error: 'unauthorized' }, 401);
      }
    } catch (error) {
      if (
        error instanceof errors.JWTClaimValidationFailed ||
        error instanceof errors.JWTExpired ||
        error instanceof errors.JWTInvalid ||
        error instanceof errors.JWSInvalid ||
        error instanceof errors.JWSSignatureVerificationFailed ||
        error instanceof errors.JOSEAlgNotAllowed ||
        error instanceof errors.JWKSNoMatchingKey
      ) {
        return json({ error: 'unauthorized' }, 401);
      }
      return json({ error: 'unavailable' }, 503);
    }

    const storage = storageConfigSchema.safeParse(env);
    if (!storage.success) return json({ error: 'unavailable' }, 503);
    const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = storage.data;
    try {
      const aws = new AwsClient({
        accessKeyId: R2_ACCESS_KEY_ID,
        secretAccessKey: R2_SECRET_ACCESS_KEY,
        service: 's3',
        region: 'auto',
      });
      const key =
        target === 'market' ? 'site/market-accumulation.json' : `site/broker/${target.ticker}.json`;
      const signed = await aws.sign(
        `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com/vibe-idx-private/${key}`,
        { method: 'GET', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(10000) },
      );
      const response = await fetcher(signed);
      if (response.status === 404) return json({ error: 'not_found' }, 404);
      if (!response.ok) return json({ error: 'unavailable' }, 503);
      const body: unknown = await response.json();
      if (target === 'market') return json(accumulationSchema.parse(body), 200);
      const days = sourceSchema.parse(body);
      days.sort((a, b) => b.date.localeCompare(a.date));
      return json({ ticker: target.ticker, days }, 200);
    } catch {
      return json({ error: 'unavailable' }, 503);
    }
  };
}

export default { fetch: createBrokerHandler() };
