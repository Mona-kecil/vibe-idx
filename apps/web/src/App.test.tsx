import { describe, expect, it } from 'vite-plus/test';
import { renderToStaticMarkup } from 'react-dom/server';

import { App, renderAppTitle } from './App';

describe('App', () => {
  it('renders the Vibe IDX title', () => {
    expect(renderAppTitle()).toBe('Vibe IDX');
  });

  it('renders the primary market data surfaces', () => {
    const markup = renderToStaticMarkup(<App />);

    expect(markup).toContain('Daily Prices');
    expect(markup).toContain('5% Ownership');
    expect(markup).toContain('1% Ownership');
    expect(markup).toContain('Insider Transactions');
  });
});
