import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { collect } from './collector';
import { run } from './run';

vi.mock('./collector', () => ({ collect: vi.fn() }));
vi.mock('./storage', () => ({ r2Bucket: vi.fn() }));
afterEach(() => vi.restoreAllMocks());
const env = {
  R2_ACCOUNT_ID: 'a'.repeat(32),
  R2_ACCESS_KEY_ID: 'access',
  R2_SECRET_ACCESS_KEY: 'secret',
  BPS_KEY: 'private-bps-key',
  SENTRY_DSN: 'https://public@sentry.test/123',
};

describe('proxy configuration boundary', () => {
  it.each([
    {},
    { BPS_PROXY_URL: '', BPS_PROXY_TOKEN: '' },
    { BPS_PROXY_URL: 'https://proxy.test', BPS_PROXY_TOKEN: 'private-proxy-token' },
  ])('accepts both settings or neither', async (settings) => {
    expect(await run({ ...env, ...settings })).toBe(0);
    expect(collect).toHaveBeenLastCalledWith(
      expect.objectContaining({
        bpsProxy: settings.BPS_PROXY_URL
          ? { url: settings.BPS_PROXY_URL, token: settings.BPS_PROXY_TOKEN }
          : undefined,
      }),
    );
  });
  it.each([
    { BPS_PROXY_URL: 'https://proxy.test' },
    { BPS_PROXY_TOKEN: 'private-proxy-token' },
    { BPS_PROXY_URL: 'not-a-url', BPS_PROXY_TOKEN: 'private-proxy-token' },
    { BPS_PROXY_URL: 'ftp://proxy.test', BPS_PROXY_TOKEN: 'private-proxy-token' },
  ])('rejects incomplete or invalid configuration without leaking secrets', async (settings) => {
    vi.mocked(collect).mockClear();
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await run({ ...env, ...settings })).toBe(1);
    expect(collect).not.toHaveBeenCalled();
    expect(log.mock.calls.flat().join()).not.toContain('private-proxy-token');
    expect(log.mock.calls.flat().join()).not.toContain(env.BPS_KEY);
  });
});
