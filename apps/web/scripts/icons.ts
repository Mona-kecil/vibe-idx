import { mkdir, writeFile } from 'node:fs/promises';
import { Resvg } from '@resvg/resvg-js';
import { markSvg } from '../api/_mark.ts';

const publicDir = new URL('../public/', import.meta.url);
await mkdir(publicDir, { recursive: true });
await writeFile(new URL('favicon.svg', publicDir), markSvg + '\n');
const touchSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180" viewBox="0 0 180 180"><rect width="180" height="180" fill="#f8f7f3"/><svg x="22" y="22" width="136" height="136">${markSvg}</svg></svg>`;
await writeFile(new URL('apple-touch-icon.png', publicDir), new Resvg(touchSvg).render().asPng());
