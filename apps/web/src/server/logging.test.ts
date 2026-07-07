import { describe, expect, it } from 'vite-plus/test';

import { createHttpRequestEvent, sanitizeError } from './logging';

describe('server logging', () => {
  it('creates one structured request event with duration and outcome context', () => {
    const event = createHttpRequestEvent({
      durationMs: 42,
      method: 'GET',
      path: '/trpc/meta.latestDates',
      requestId: 'req_test',
      statusCode: 200,
    });

    expect(event).toEqual(
      expect.objectContaining({
        duration_ms: 42,
        event: 'http_request',
        method: 'GET',
        outcome: 'success',
        path: '/trpc/meta.latestDates',
        request_id: 'req_test',
        service: 'vibe-idx-web',
        status_code: 200,
      }),
    );
    expect(typeof event.timestamp).toBe('string');
  });

  it('sanitizes errors without logging full request bodies or secrets', () => {
    const error = Object.assign(new Error('token=secret failed'), {
      code: 'SQLITE_BUSY',
      stack: 'stack should not be logged',
    });

    expect(sanitizeError(error)).toEqual({
      code: 'SQLITE_BUSY',
      message: '[redacted]',
      type: 'Error',
    });
  });
});
