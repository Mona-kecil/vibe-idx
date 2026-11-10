import { z } from 'zod';
import { collect } from './collector';
import { report } from './sentry';
import { r2Bucket } from './storage';

const optionalSetting = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema.optional());
const configSchema = z
  .object({
    R2_ACCOUNT_ID: z.string().regex(/^[a-f0-9]{32}$/),
    R2_ACCESS_KEY_ID: z.string().min(1),
    R2_SECRET_ACCESS_KEY: z.string().min(1),
    BPS_KEY: z.string().min(1),
    BPS_PROXY_URL: optionalSetting(z.url({ protocol: /^https?$/ })),
    BPS_PROXY_TOKEN: optionalSetting(z.string().min(1)),
    SENTRY_DSN: z.url(),
  })
  .refine((config) => Boolean(config.BPS_PROXY_URL) === Boolean(config.BPS_PROXY_TOKEN), {
    path: ['BPS_PROXY_URL', 'BPS_PROXY_TOKEN'],
    message: 'BPS proxy URL and token must be configured together',
  });

export async function run(env: NodeJS.ProcessEnv = process.env): Promise<number> {
  const config = configSchema.safeParse(env);
  if (!config.success) {
    console.error(
      `Missing or invalid configuration: ${config.error.issues.map((issue) => issue.path.join('.')).join(', ')}`,
    );
    return 1;
  }
  const {
    R2_ACCOUNT_ID,
    R2_ACCESS_KEY_ID,
    R2_SECRET_ACCESS_KEY,
    BPS_KEY,
    BPS_PROXY_URL,
    BPS_PROXY_TOKEN,
    SENTRY_DSN,
  } = config.data;
  let failed = false;
  const reportFailure = async (source: string, failure: unknown) => {
    failed = true;
    await report(SENTRY_DSN, source, failure);
  };
  try {
    await collect({
      bucket: r2Bucket({
        accountId: R2_ACCOUNT_ID,
        accessKeyId: R2_ACCESS_KEY_ID,
        secretAccessKey: R2_SECRET_ACCESS_KEY,
      }),
      bpsKey: BPS_KEY,
      bpsProxy:
        BPS_PROXY_URL && BPS_PROXY_TOKEN
          ? { url: BPS_PROXY_URL, token: BPS_PROXY_TOKEN }
          : undefined,
      report: reportFailure,
    });
  } catch (failure) {
    await reportFailure('collector', failure);
  }
  return failed ? 1 : 0;
}
