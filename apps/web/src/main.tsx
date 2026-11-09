import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthKitProvider } from '@workos-inc/authkit-react';
import * as Sentry from '@sentry/react';

import { App } from './App';
import { SENTRY_DSN } from './sentry';

Sentry.init({
  dsn: import.meta.env.PROD ? SENTRY_DSN : undefined,
  environment: window.location.hostname,
});

const rootElement = document.getElementById('root');
const clientId = import.meta.env.VITE_WORKOS_CLIENT_ID;

if (!rootElement) {
  throw new Error('Root element #root was not found.');
}
if (!clientId) throw new Error('Set VITE_WORKOS_CLIENT_ID before starting the app.');

createRoot(rootElement, {
  onUncaughtError: Sentry.reactErrorHandler(),
  onCaughtError: Sentry.reactErrorHandler(),
  onRecoverableError: Sentry.reactErrorHandler(),
}).render(
  <StrictMode>
    <AuthKitProvider
      clientId={clientId}
      devMode
      redirectUri={`${window.location.origin}/callback`}
      onRedirectCallback={() => {
        const saved = window.sessionStorage.getItem('vibe-idx-return-to') ?? '/';
        const path =
          /^(?:\/|\/stocks|\/market|\/t\/[A-Z0-9-]+|\/terminal(?:\?[A-Za-z0-9_=%&-]*)?)$/.test(
            saved,
          )
            ? saved
            : '/';
        window.sessionStorage.removeItem('vibe-idx-return-to');
        window.history.replaceState(null, '', path);
        window.dispatchEvent(new PopStateEvent('popstate'));
      }}
    >
      <App />
    </AuthKitProvider>
  </StrictMode>,
);
