import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { initWasm, Resvg } from '@resvg/resvg-wasm';
import { markSvg } from '../api/_mark.js';

await initWasm(
  await readFile(createRequire(import.meta.url).resolve('@resvg/resvg-wasm/index_bg.wasm')),
);
const publicDir = new URL('../public/', import.meta.url);
await mkdir(publicDir, { recursive: true });
await writeFile(new URL('favicon.svg', publicDir), markSvg + '\n');
const touchSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180" viewBox="0 0 180 180"><rect width="180" height="180" fill="#0a0c0b"/><svg x="22" y="22" width="136" height="136">${markSvg}</svg></svg>`;
await writeFile(new URL('apple-touch-icon.png', publicDir), new Resvg(touchSvg).render().asPng());
