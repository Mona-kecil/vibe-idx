import { collect } from './collector';
import { report } from './sentry';

type Env = { PUBLIC: R2Bucket; BPS_KEY: string; SENTRY_DSN: string };
export default {
  fetch() {
    return new Response(null, { status: 404 });
  },
  async scheduled(controller: ScheduledController, env: Env) {
    await collect({
      bucket: env.PUBLIC,
      bpsKey: env.BPS_KEY,
      now: new Date(controller.scheduledTime),
      report: (source, failure) => report(env.SENTRY_DSN, source, failure),
    });
  },
} satisfies ExportedHandler<Env>;
