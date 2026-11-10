import { z } from 'zod';
import { collect } from './collector';
import { report } from './sentry';
import { r2Bucket } from './storage';

// Only GitHub Actions reports to Sentry, so local runs and tests never page anyone.
const configSchema = z
  .object({
    R2_ACCOUNT_ID: z.string().regex(/^[a-f0-9]{32}$/),
    R2_ACCESS_KEY_ID: z.string().min(1),
    R2_SECRET_ACCESS_KEY: z.string().min(1),
    BPS_KEY: z.string().min(1),
    GITHUB_ACTIONS: z.string().optional(),
    SENTRY_DSN: z.url().optional(),
  })
  .refine((config) => config.GITHUB_ACTIONS !== 'true' || config.SENTRY_DSN, {
    path: ['SENTRY_DSN'],
  });

export async function run(env: NodeJS.ProcessEnv = process.env): Promise<number> {
  const config = configSchema.safeParse(env);
  if (!config.success) {
    console.error(
      `Missing or invalid configuration: ${config.error.issues.map((issue) => issue.path.join('.')).join(', ')}`,
    );
    return 1;
  }
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, BPS_KEY, GITHUB_ACTIONS } =
    config.data;
  const sentryDsn = GITHUB_ACTIONS === 'true' ? config.data.SENTRY_DSN : undefined;
  let failed = false;
  const reportFailure = async (source: string, failure: unknown) => {
    failed = true;
    await report(sentryDsn, source, failure);
  };
  try {
    await collect({
      bucket: r2Bucket({
        accountId: R2_ACCOUNT_ID,
        accessKeyId: R2_ACCESS_KEY_ID,
        secretAccessKey: R2_SECRET_ACCESS_KEY,
      }),
      bpsKey: BPS_KEY,
      report: reportFailure,
    });
  } catch (failure) {
    await reportFailure('collector', failure);
  }
  return failed ? 1 : 0;
}
