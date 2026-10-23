import { strFromU8, unzipSync } from 'fflate';
function decode(text: string): string {
  return text.replace(
    /&#(x[\da-f]+|\d+);|&(amp|lt|gt|quot|apos);/gi,
    (_, code: string | undefined, name: string | undefined) => {
      if (code)
        return String.fromCodePoint(
          code.startsWith('x') ? Number.parseInt(code.slice(1), 16) : Number(code),
        );
      switch (name) {
        case 'amp':
          return '&';
        case 'lt':
          return '<';
        case 'gt':
          return '>';
        case 'quot':
          return '"';
        case 'apos':
          return "'";
        default:
          throw new Error('Invalid XML entity');
      }
    },
  );
}
function texts(xml: string): string {
  return Array.from(xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g), (m) =>
    decode(m[1] ?? ''),
  ).join('');
}
export function readSheet(bytes: Uint8Array): string[][] {
  const files = unzipSync(bytes, {
    filter: (f) => ['xl/sharedStrings.xml', 'xl/worksheets/sheet1.xml'].includes(f.name),
  });
  const sheet = files['xl/worksheets/sheet1.xml'];
  if (!sheet) throw new Error('Missing sheet1');
  const strings = Array.from(
    strFromU8(files['xl/sharedStrings.xml'] ?? new Uint8Array()).matchAll(
      /<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g,
    ),
    (m) => texts(m[1] ?? ''),
  );
  return Array.from(strFromU8(sheet).matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g), (row) => {
    const cells: string[] = [];
    for (const c of (row[1] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1] ?? '';
      const body = c[2] ?? '';
      const ref = /\br="([A-Z]+)\d+"/.exec(attrs)?.[1];
      if (!ref) throw new Error('Missing cell reference');
      let col = 0;
      for (const char of ref) col = col * 26 + char.charCodeAt(0) - 64;
      const raw = /<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? '';
      cells[col - 1] = /\bt="s"/.test(attrs)
        ? (strings[Number(raw)] ?? '')
        : /\bt="inlineStr"/.test(attrs)
          ? texts(body)
          : decode(raw);
    }
    return cells;
  });
}
