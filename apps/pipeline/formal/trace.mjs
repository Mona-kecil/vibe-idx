// Render a TLC counterexample from a check.sh log as a self-contained HTML page.
// Usage: node trace.mjs <tlc.log> <out.html>
import { readFileSync, writeFileSync } from 'node:fs';

const [, , input, output] = process.argv;
if (!input || !output) throw new Error('Usage: node trace.mjs <tlc.log> <out.html>');
const log = readFileSync(input, 'utf8');
const violated = log.match(/Invariant (\w+) is violated/)?.[1];
if (!violated) throw new Error(`No invariant violation in ${input}`);

function parse(text) {
  const tokens = text.match(/"(?:[^"\\]|\\.)*"|<<|>>|\|->|[[\]{},]|[\w.]+/g) ?? [];
  let i = 0;
  const value = () => {
    const t = tokens[i++];
    if (t.startsWith('"')) return JSON.parse(t);
    if (t === 'TRUE' || t === 'FALSE') return t === 'TRUE';
    if (/^\d+$/.test(t)) return Number(t);
    if (t === '<<' || t === '{') {
      const end = t === '<<' ? '>>' : '}';
      const items = [];
      while (tokens[i] !== end) {
        items.push(value());
        if (tokens[i] === ',') i++;
      }
      i++;
      return items;
    }
    if (t === '[') {
      const record = {};
      while (tokens[i] !== ']') {
        const key = tokens[i];
        i += 2;
        record[key] = value();
        if (tokens[i] === ',') i++;
      }
      i++;
      return record;
    }
    throw new Error(`Unexpected TLC token: ${t}`);
  };
  return value();
}

const states = [];
const body = log.slice(log.indexOf('State 1:'));
for (const block of body.split(/\n(?=State \d+:)/)) {
  const head = block.match(/^State (\d+): <(\w+)/);
  if (!head) continue;
  const vars = {};
  const lines = block
    .split('\n')
    .slice(1)
    .join('\n')
    .split(/^\/\\ /m);
  for (const part of lines) {
    const eq = part.indexOf(' = ');
    if (eq < 0) continue;
    vars[part.slice(0, eq).trim()] = parse(part.slice(eq + 3).split(/\n\n/)[0]);
  }
  if (!vars.run) continue;
  const keep = (o, keys) => Object.fromEntries(keys.map((k) => [k, o[k]]));
  vars.run = vars.run.map((r) =>
    keep(r, [
      'pc',
      'restored',
      'rows',
      'coverage',
      'pair',
      'bytes',
      'token',
      'held',
      'failure',
      'year',
      'changed',
      'final',
    ]),
  );
  states.push({
    n: Number(head[1]),
    action: head[2],
    vars: keep(vars, [
      'marker',
      'cloudToken',
      'validRefresh',
      'cloudRaw',
      'cloudRows',
      'cloudCoverage',
      'run',
    ]),
  });
}
if (!states.length) throw new Error(`No trace states in ${input}`);

const page = readFileSync(new URL('./trace.html', import.meta.url), 'utf8')
  .replaceAll('__INVARIANT__', violated)
  .replace('__TRACE__', JSON.stringify(states).replaceAll('<', '\\u003c'));
writeFileSync(output, page);
console.log(`Trace: ${output}`);
