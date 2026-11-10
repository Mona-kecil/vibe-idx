// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthKitProvider, useAuth } from '@workos-inc/authkit-react';
import { expect, it, vi } from 'vite-plus/test';

it('starts the real AuthKit provider with loading true and no user', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.useFakeTimers();
  const host = document.createElement('div');
  const root = createRoot(host);
  function Session() {
    const { isLoading, user } = useAuth();
    return <output>{JSON.stringify({ isLoading, user })}</output>;
  }
  try {
    await act(async () =>
      root.render(
        <AuthKitProvider clientId="client_test" devMode>
          <Session />
        </AuthKitProvider>,
      ),
    );
    expect(host.textContent).toBe('{"isLoading":true,"user":null}');
  } finally {
    await act(async () => root.unmount());
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});
