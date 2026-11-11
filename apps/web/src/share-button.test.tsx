// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { ShareButton } from './ticker/ShareButton';

let host: HTMLDivElement, root: Root;
const share = vi.fn<(data: ShareData) => Promise<void>>(async () => {});
const writeText = vi.fn<(text: string) => Promise<void>>(async () => {});

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('navigator', { share, clipboard: { writeText } });
  share.mockReset().mockResolvedValue(undefined);
  writeText.mockReset().mockResolvedValue(undefined);
  vi.useFakeTimers();
  host = document.createElement('div');
  root = createRoot(host);
  await act(async () => root.render(<ShareButton ticker="BBCA" name="Bank Central Asia" />));
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function clickShare() {
  const button = host.querySelector('button[aria-label="Share BBCA"]');
  if (!(button instanceof HTMLButtonElement)) throw new Error('Share button missing');
  await act(async () => button.click());
}

describe('ticker sharing', () => {
  it('opens native sharing with the ticker title and a clean ticker URL', async () => {
    await clickShare();
    expect(share).toHaveBeenCalledWith({
      title: 'BBCA Bank Central Asia',
      url: `${window.location.origin}/t/BBCA`,
    });
    expect(writeText).not.toHaveBeenCalled();
  });

  it('copies the link when native sharing is unavailable and briefly announces it', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    await clickShare();
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/t/BBCA`);
    expect(host.querySelector('[aria-live="polite"]')?.textContent).toBe('Link copied');
    await act(async () => vi.advanceTimersByTime(2500));
    expect(host.textContent).toBe('');
  });

  it('leaves a cancelled native share alone', async () => {
    share.mockRejectedValue(new DOMException('Cancelled', 'AbortError'));
    await clickShare();
    expect(writeText).not.toHaveBeenCalled();
    expect(host.textContent).toBe('');
  });

  it('falls back to copying after a native share failure', async () => {
    share.mockRejectedValue(new Error('Unavailable'));
    await clickShare();
    expect(writeText).toHaveBeenCalledOnce();
    expect(host.textContent).toBe('Link copied');
  });

  it('announces a clipboard failure without claiming the link was copied', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    writeText.mockRejectedValue(new Error('Permission denied'));
    await clickShare();
    expect(host.querySelector('[aria-live="polite"]')?.textContent).toBe(
      'Could not copy link. Try again.',
    );
  });
});
