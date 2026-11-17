/**
 * What a `pnpm shots` scenarios file default-exports: an array of Scenario. The file can live anywhere; import these
 * types with `import type`, which leaves nothing to resolve when it runs.
 */
import type { Visit } from './browser.js';

export type Note = {
  /** A Playwright selector: CSS, or `role=tab[name="BRK"]`, `text=...`. */
  at: string;
  text: string;
  /** Which shot gets the box. Changed or new things go on after, removed things on before. */
  on?: 'before' | 'after' | 'both';
};

export type Scenario = Visit & {
  /** Names the image files. `within` names the panel to shoot; the whole window when left out. */
  name: string;
  notes?: Note[];
  /** Keeps the preview panel in the shot; it is hidden otherwise. */
  panel?: boolean;
};
