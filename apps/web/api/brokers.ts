import { createBrokerHandler } from './_brokers.js';
import { reportFailure } from './_sentry.js';

export default { fetch: createBrokerHandler({ reportFailure }) };
