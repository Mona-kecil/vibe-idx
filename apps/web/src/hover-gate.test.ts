import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vite-plus/test';

const sheets = ['site.css', 'today.css', 'market.css', 'ticker/ticker.css'];
const gate = /@media[^{]*\(hover:\s*hover\)/;

function ungatedHover(css: string) {
  const open: string[] = [];
  const found: string[] = [];
  let prelude = '';
  for (const char of css.replace(/\/\*[\s\S]*?\*\//g, '')) {
    if (char === '{') {
      if (prelude.includes(':hover') && !open.some((p) => gate.test(p))) found.push(prelude.trim());
      open.push(prelude);
      prelude = '';
    } else if (char === '}') {
      open.pop();
      prelude = '';
    } else if (char === ';') prelude = '';
    else prelude += char;
  }
  return found;
}

describe('public stylesheets', () => {
  it.each(sheets)('%s keeps every :hover behind a hover-capable media query', (sheet) => {
    const css = readFileSync(new URL(sheet, import.meta.url), 'utf8');
    expect(ungatedHover(css)).toEqual([]);
  });
  it('flags a hover rule outside the media query', () => {
    expect(ungatedHover('.a:hover { color: red; }')).toEqual(['.a:hover']);
    expect(
      ungatedHover('@media (hover: hover) and (pointer: fine) { .a:hover { color: red; } }'),
    ).toEqual([]);
  });
});
