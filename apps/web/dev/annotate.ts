/**
 * What `pnpm shots` decides about its images, kept apart from the browser so tests can check it: where two shots
 * differ, where note badges go, and what changed in the accessibility outline. Pixels are RGBA, row by row.
 */
import { plural } from '../../pipeline/dev/cli.js';

export type Rect = { x: number; y: number; width: number; height: number };
export type Region = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  pixels: number;
  /** How many distinct rows and columns its changed pixels fall in, which tells a line from a filled shape. */
  rows: number;
  columns: number;
};

/** Changed pixels are counted in square cells of this size, and cells within two of each other form one region. */
export const cell = 8;

const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/**
 * Compares two shots of the same size. A pixel counts as changed unless it could be an anti-aliased edge of what the
 * other shot shows there, which text on a busy machine renders a little differently from run to run: within 32
 * levels, and in each channel within 12 levels of the range its 3 by 3 neighbourhood spans on the other side, both
 * ways round. A recoloured or replaced shape steps further or leaves that range. Those pixels are counted as faint.
 */
export function diffPixels(
  before: Uint8ClampedArray,
  after: Uint8ClampedArray,
  width: number,
  height: number,
) {
  const columns = Math.ceil(width / cell);
  const rows = Math.ceil(height / cell);
  const counts = new Uint32Array(columns * rows);
  const changed = new Uint8Array(width * height);
  const faintPixels = new Uint8Array(width * height);
  const edge = (a: Uint8ClampedArray, b: Uint8ClampedArray, x: number, y: number) => {
    const at = (y * width + x) * 4;
    for (let c = 0; c < 3; c++) {
      if (Math.abs(a[at + c]! - b[at + c]!) > 32) return false;
      let low = 255,
        high = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx,
            ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const value = b[(ny * width + nx) * 4 + c]!;
          low = Math.min(low, value);
          high = Math.max(high, value);
        }
      if (a[at + c]! < low - 12 || a[at + c]! > high + 12) return false;
    }
    return true;
  };
  let faint = 0;
  for (let i = 0; i < before.length; i += 4) {
    if (before[i] === after[i] && before[i + 1] === after[i + 1] && before[i + 2] === after[i + 2])
      continue;
    const x = (i / 4) % width,
      y = Math.floor(i / 4 / width);
    if (edge(before, after, x, y) && edge(after, before, x, y)) {
      faint++;
      faintPixels[i / 4] = 1;
    } else {
      counts[Math.floor(y / cell) * columns + Math.floor(x / cell)]!++;
      changed[i / 4] = 1;
    }
  }

  // Cells with changes, joined with their neighbours up to two cells away.
  const seen = new Uint8Array(columns * rows);
  const owner = new Int32Array(columns * rows).fill(-1);
  const regions: Region[] = [];
  for (let start = 0; start < counts.length; start++) {
    if (!counts[start] || seen[start]) continue;
    const stack = [start];
    seen[start] = 1;
    const region = {
      left: Infinity,
      top: Infinity,
      right: -1,
      bottom: -1,
      pixels: 0,
      rows: 0,
      columns: 0,
    };
    while (stack.length) {
      const at = stack.pop()!;
      owner[at] = regions.length;
      const cx = at % columns,
        cy = Math.floor(at / columns);
      region.pixels += counts[at]!;
      region.left = Math.min(region.left, cx * cell);
      region.top = Math.min(region.top, cy * cell);
      region.right = Math.min(width - 1, Math.max(region.right, cx * cell + cell - 1));
      region.bottom = Math.min(height - 1, Math.max(region.bottom, cy * cell + cell - 1));
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++) {
          const nx = cx + dx,
            ny = cy + dy;
          const next = ny * columns + nx;
          if (nx < 0 || ny < 0 || nx >= columns || ny >= rows || seen[next] || !counts[next])
            continue;
          seen[next] = 1;
          stack.push(next);
        }
    }
    regions.push(region);
  }
  const rowsSeen = regions.map(() => new Set<number>());
  const columnsSeen = regions.map(() => new Set<number>());
  for (let at = 0; at < changed.length; at++) {
    if (!changed[at]) continue;
    const x = at % width,
      y = Math.floor(at / width);
    const index = owner[Math.floor(y / cell) * columns + Math.floor(x / cell)]!;
    rowsSeen[index]!.add(y);
    columnsSeen[index]!.add(x);
  }
  regions.forEach((region, i) => {
    region.rows = rowsSeen[i]!.size;
    region.columns = columnsSeen[i]!.size;
  });
  regions.sort((a, b) => a.top - b.top || a.left - b.left);

  // The after shot faded, with changed pixels in magenta, drawn 3px wide so a one-pixel line shows, and faint ones
  // in light orange.
  const mask = new Uint8ClampedArray(after.length);
  for (let i = 0; i < after.length; i += 4) {
    const faded = 255 - (255 - (after[i]! + after[i + 1]! + after[i + 2]!) / 3) / 4;
    mask.set(faintPixels[i / 4] ? [255, 190, 120, 255] : [faded, faded, faded, 255], i);
  }
  for (let at = 0; at < changed.length; at++) {
    if (!changed[at]) continue;
    const x = at % width,
      y = Math.floor(at / width);
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++)
        if (x + dx >= 0 && x + dx < width && y + dy >= 0 && y + dy < height)
          mask.set([255, 0, 200, 255], ((y + dy) * width + x + dx) * 4);
  }
  // Changed cells shaded blue on a clear layer, to lay over the after shot.
  const shade = new Uint8ClampedArray(after.length);
  counts.forEach((count, at) => {
    if (!count) return;
    const left = (at % columns) * cell,
      top = Math.floor(at / columns) * cell;
    for (let y = top; y < Math.min(height, top + cell); y++)
      for (let x = left; x < Math.min(width, left + cell); x++)
        shade.set([31, 111, 255, 115], (y * width + x) * 4);
  });
  return { regions, faint, mask, shade };
}

export const letter = (i: number) => String.fromCharCode(65 + (i % 26));

/** What changed between two shots, as notes.md and the terminal say it. */
export function changeSummary(
  change: { sizes: [string, string] } | { regions: Region[]; faint: number },
) {
  if ('sizes' in change)
    return [
      `the shots differ in size, before ${change.sizes[0]} and after ${change.sizes[1]}, so the panel itself changed size; compare them by eye`,
    ];
  const lines = !change.regions.length
    ? ['no visible change']
    : [
        `${plural(change.regions.length, 'changed region')}, shaded in blue on the after shot:`,
        ...change.regions.map((r, i) => {
          const width = r.right - r.left + 1,
            height = r.bottom - r.top + 1;
          // A line up to 3px thick has about as many pixels as the rows and columns it spans; text has many more.
          const thin = Math.max(r.rows, r.columns) >= 24 && r.pixels <= 3 * (r.rows + r.columns);
          return `   ${letter(i)}. ${width} by ${height} px at ${r.left},${r.top}, ${plural(r.pixels, 'pixel')} changed${thin ? ', thinly spread, such as a line or border' : ''}`;
        }),
      ];
  if (change.faint)
    lines.push(
      `${plural(change.faint, 'pixel')} differ slightly, as anti-aliased edges vary between runs; not counted, and light orange in the diff image`,
    );
  return lines;
}

/**
 * Where an element shows within the panel: whole when it fits, cut to the panel when it runs past it, such as a
 * table that scrolls, and undefined when it lies outside. A pixel of slack allows for fractional boxes.
 */
export function withinPanel(box: Rect, panel: Rect): { box: Rect; cut: boolean } | undefined {
  if (
    box.x >= panel.x - 1 &&
    box.y >= panel.y - 1 &&
    box.x + box.width <= panel.x + panel.width + 1 &&
    box.y + box.height <= panel.y + panel.height + 1
  )
    return { box, cut: false };
  const left = Math.max(box.x, panel.x),
    top = Math.max(box.y, panel.y);
  const right = Math.min(box.x + box.width, panel.x + panel.width),
    bottom = Math.min(box.y + box.height, panel.y + panel.height);
  if (right - left < 2 || bottom - top < 2) return undefined;
  return { box: { x: left, y: top, width: right - left, height: bottom - top }, cut: true };
}

/** The column for badges: in the blank margin left of the panel, else right of it, if either has room. */
export function gutterFor(area: { clip: Rect; content: Rect } | undefined) {
  if (!area) return undefined;
  const { clip, content } = area;
  if (content.x - clip.x >= 26) return content.x - 25;
  if (clip.x + clip.width - (content.x + content.width) >= 26) return content.x + content.width + 3;
  return undefined;
}

export type Badge = { spot: Rect; line?: { x1: number; y1: number; x2: number; y2: number } };

/**
 * Where each note's numbered badge goes so it covers nothing it shouldn't. With a gutter, a badge sits in it level
 * with its frame, or at the nearest free place above or below, with a line to the frame. Without one, it takes the
 * first corner outside its frame that is clear of other frames and badges.
 */
export function placeBadges(frames: Rect[], gutter: number | undefined, bounds: Rect): Badge[] {
  const size = 22;
  const badges: Badge[] = [];
  frames.forEach((frame, i) => {
    if (gutter !== undefined) {
      const top = bounds.y;
      const bottom = bounds.y + bounds.height - size;
      const level = Math.min(bottom, Math.max(top, frame.y + frame.height / 2 - size / 2));
      let spot = { x: gutter, y: level, width: size, height: size };
      for (let step = 1; badges.some((b) => overlaps(spot, b.spot)) && step <= 200; step++) {
        const y = level + Math.ceil(step / 2) * (size + 2) * (step % 2 ? -1 : 1);
        if (y >= top && y <= bottom) spot = { ...spot, y };
      }
      const middle = spot.y + size / 2;
      const toLeft = gutter < frame.x;
      badges.push({
        spot,
        line: {
          x1: toLeft ? spot.x + size : spot.x,
          y1: middle,
          x2: toLeft ? frame.x : frame.x + frame.width,
          y2: Math.min(frame.y + frame.height - 4, Math.max(frame.y + 4, middle)),
        },
      });
      return;
    }
    const spots = [
      [frame.x - 20, frame.y - 20],
      [frame.x + frame.width - 2, frame.y - 20],
      [frame.x - 20, frame.y + frame.height - 2],
      [frame.x + frame.width - 2, frame.y + frame.height - 2],
    ].map(([x, y]) => ({ x: Math.max(0, x!), y: Math.max(0, y!), width: size, height: size }));
    const spot =
      spots.find(
        (s) =>
          !badges.some((b) => overlaps(s, b.spot)) &&
          !frames.some((f, j) => j !== i && overlaps(s, f)),
      ) ?? spots[0]!;
    badges.push({ spot });
  });
  return badges;
}

/** Outline lines only one side has, in the order each side shows them. */
export function outlineChanges(before: string[], after: string[]) {
  const count = (lines: string[]) => {
    const counts = new Map<string, number>();
    for (const line of lines) counts.set(line, (counts.get(line) ?? 0) + 1);
    return counts;
  };
  const only = (lines: string[], other: Map<string, number>, sign: string) =>
    lines.flatMap((line) => {
      const left = other.get(line) ?? 0;
      if (left) {
        other.set(line, left - 1);
        return [];
      }
      return [`${sign} ${line.trim()}`];
    });
  return [...only(before, count(after), '-'), ...only(after, count(before), '+')];
}

/**
 * The named elements of an outline as selectors a note can use as they are. Data rows are left out: they are named
 * by their figures, which change and are private.
 */
export function outlineSelectors(outline: string[]) {
  return [
    ...new Set(
      outline.flatMap((line) => {
        const match = /^\s*- (\w+) "([^"]{1,40})"/.exec(line);
        if (!match || ['text', 'cell', 'img'].includes(match[1]!)) return [];
        if (match[1] === 'row' && /\d/.test(match[2]!)) return [];
        return [`role=${match[1]}[name="${match[2]}"]`];
      }),
    ),
  ];
}
