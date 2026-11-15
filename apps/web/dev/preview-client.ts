/**
 * Runs in the page before the app. It pins the browser clock to the fixture session and adds the
 * preview panel. It is serialised with `toString`, so it must not reference anything outside itself.
 */
export function previewClient(asOf: string) {
  const cookies = new Map(
    document.cookie
      .split('; ')
      .filter(Boolean)
      .map((pair) => pair.split('=') as [string, string]),
  );
  const clock = cookies.get('preview-clock') ?? 'close';
  const minutes = (text: string) => Number(text.slice(0, 2)) * 60 + Number(text.slice(3, 5));
  // Jakarta is UTC+7 all year. After the close shows the evening, once broker data is in.
  const start =
    Date.parse(`${asOf}T00:00:00Z`) +
    ((clock === 'close' ? 19 * 60 : minutes(clock)) - 420) * 60000;
  const real = Date;
  const began = performance.now();
  const now = () => start + (performance.now() - began);
  class PinnedDate extends real {
    constructor(...args: ConstructorParameters<DateConstructor> | []) {
      if (args.length) super(...(args as ConstructorParameters<DateConstructor>));
      else super(now());
    }
    static override now() {
      return now();
    }
  }
  globalThis.Date = PinnedDate as DateConstructor;

  const set = (name: string, value: string) => {
    document.cookie = `${name}=${value}; path=/; max-age=31536000; samesite=lax`;
    location.reload();
  };
  const signedIn = cookies.get('preview-signed-out') !== '1';
  const times = ['close'];
  for (let m = 9 * 60; m <= 16 * 60; m += 15)
    times.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);

  addEventListener('DOMContentLoaded', () => {
    const host = document.createElement('div');
    host.id = 'preview-panel';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>
      :host { position: fixed; left: 8px; bottom: 8px; z-index: 2147483647; font: 12px/1.4 ui-monospace, monospace; }
      details { background: #111; color: #ddd; border: 1px solid #444; border-radius: 6px; padding: 4px 8px; }
      summary { cursor: pointer; color: #f0b429; }
      label { display: flex; gap: 8px; align-items: center; justify-content: space-between; margin-top: 6px; }
      select, input { font: inherit; }
    </style>
    <details>
      <summary>Preview ${asOf} ${clock === 'close' ? 'after close' : clock}${signedIn ? '' : ', signed out'}</summary>
      <label>Clock <select name="clock">${times
        .map(
          (t) =>
            `<option value="${t}"${t === clock ? ' selected' : ''}>${t === 'close' ? 'after close' : t}</option>`,
        )
        .join('')}</select></label>
      <label>Signed in <input name="signed-in" type="checkbox"${signedIn ? ' checked' : ''}></label>
    </details>`;
    root.querySelector('select[name=clock]')!.addEventListener('change', (event) => {
      set('preview-clock', (event.target as HTMLSelectElement).value);
    });
    root.querySelector('input[name=signed-in]')!.addEventListener('change', (event) => {
      set('preview-signed-out', (event.target as HTMLInputElement).checked ? '0' : '1');
    });
    document.body.append(host);
  });
}
