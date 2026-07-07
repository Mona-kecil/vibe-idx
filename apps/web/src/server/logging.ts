type ErrorLike = {
  code?: unknown;
  message?: unknown;
  name?: unknown;
};

export type LogEvent = Record<string, unknown> & {
  event: string;
  outcome?: 'error' | 'success';
  service: string;
  timestamp: string;
};

export function createHttpRequestEvent({
  durationMs,
  error,
  method,
  path,
  requestId,
  statusCode,
}: {
  durationMs: number;
  error?: unknown;
  method: string;
  path: string;
  requestId: string;
  statusCode: number;
}): LogEvent {
  const outcome = statusCode >= 500 || error ? 'error' : 'success';
  return omitUndefined({
    duration_ms: durationMs,
    error: error ? sanitizeError(error) : undefined,
    event: 'http_request',
    method,
    outcome,
    path,
    request_id: requestId,
    service: 'vibe-idx-web',
    status_code: statusCode,
    timestamp: new Date().toISOString(),
  });
}

export function createLifecycleEvent(
  event: string,
  fields: Record<string, unknown> = {},
): LogEvent {
  return omitUndefined({
    ...fields,
    event,
    service: 'vibe-idx-web',
    timestamp: new Date().toISOString(),
  });
}

export function sanitizeError(error: unknown) {
  const errorLike = error as ErrorLike;
  const rawMessage =
    typeof errorLike?.message === 'string'
      ? errorLike.message
      : error instanceof Error
        ? error.message
        : 'Unknown error';
  const rawCode = errorLike?.code;

  return omitUndefined({
    code: typeof rawCode === 'string' || typeof rawCode === 'number' ? rawCode : undefined,
    message: containsSecret(rawMessage) ? '[redacted]' : rawMessage,
    type: typeof errorLike?.name === 'string' ? errorLike.name : 'Error',
  });
}

export function writeLogEvent(event: LogEvent, sink: (line: string) => void = console.log) {
  sink(JSON.stringify(event));
}

function containsSecret(value: string) {
  return /(token|secret|password|authorization|cookie)=/i.test(value);
}

function omitUndefined<T extends Record<string, unknown>>(event: T) {
  return Object.fromEntries(Object.entries(event).filter(([, value]) => value !== undefined)) as T;
}
