import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { ConvexProvider, ConvexReactClient } from 'convex/react';

import { App } from './App';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Root element #root was not found.');
}

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL);

createRoot(rootElement).render(
  <StrictMode>
    <ConvexProvider client={convex}>
      <App />
    </ConvexProvider>
  </StrictMode>,
);
