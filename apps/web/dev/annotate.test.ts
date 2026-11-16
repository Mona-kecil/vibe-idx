import { describe, expect, it } from 'vite-plus/test';
import {
  changeSummary,
  diffPixels,
  gutterFor,
  outlineChanges,
  outlineSelectors,
  placeBadges,
  withinPanel,
  type Rect,
} from './annotate';

/** A grey image, `paint` setting a pixel's grey level by its position. */
function image(width: number, height: number, paint: (x: number, y: number) => number = () => 16) {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const grey = paint(x, y);
      pixels.set([grey, grey, grey, 255], (y * width + x) * 4);
    }
  return pixels;
}
const square = (left: number, top: number, side: number, inside: number, outside = 16) => {
  return (x: number, y: number) =>
    x >= left && x < left + side && y >= top && y < top + side ? inside : outside;
};

describe('diffPixels', () => {
  it('finds nothing between identical shots', () => {
    const shot = image(40, 40);
    expect(diffPixels(shot, shot, 40, 40)).toMatchObject({ regions: [], faint: 0 });
  });

  it('reports a recoloured block as one region of its pixels', () => {
    const { regions, faint } = diffPixels(
      image(40, 40),
      image(40, 40, square(8, 8, 4, 240)),
      40,
      40,
    );
    expect(faint).toBe(0);
    expect(regions).toEqual([
      { left: 8, top: 8, right: 15, bottom: 15, pixels: 16, rows: 4, columns: 4 },
    ]);
  });

  it('counts an anti-aliased edge that shades differently as faint, not a change', () => {
    // A dark field meeting a light one, with one in-between pixel per row whose shade drifts between runs.
    const edge = (middle: number) => (x: number) => (x < 5 ? 16 : x === 5 ? middle : 140);
    const { regions, faint } = diffPixels(image(12, 12, edge(60)), image(12, 12, edge(40)), 12, 12);
    expect(regions).toEqual([]);
    expect(faint).toBe(12);
  });

  it('still counts a one-pixel line that changes colour', () => {
    const line = (grey: number) => (_x: number, y: number) => (y === 20 ? grey : 16);
    const { regions } = diffPixels(image(64, 40, line(50)), image(64, 40, line(160)), 64, 40);
    expect(regions).toHaveLength(1);
    expect(changeSummary({ regions, faint: 0 })[1]).toMatch(/thinly spread/);
  });

  it('does not call changed text a line', () => {
    // Glyph-like strokes: every other pixel across a 40 by 12 block.
    const text = (x: number, y: number) => (x < 40 && y < 12 && (x + y) % 2 ? 200 : 16);
    const { regions } = diffPixels(image(64, 40), image(64, 40, text), 64, 40);
    expect(changeSummary({ regions, faint: 0 })[1]).not.toMatch(/thinly spread/);
  });

  it('keeps changes far apart as separate regions, top first', () => {
    const both = (x: number, y: number) =>
      square(40, 4, 4, 240)(x, y) === 240 || square(4, 60, 4, 240)(x, y) === 240 ? 240 : 16;
    const { regions } = diffPixels(image(80, 80), image(80, 80, both), 80, 80);
    expect(regions.map((r) => [r.left, r.top])).toEqual([
      [40, 0],
      [0, 56],
    ]);
  });

  it('joins changes within 16px into one region', () => {
    const near = (x: number, y: number) =>
      square(8, 8, 2, 240)(x, y) === 240 || square(20, 8, 2, 240)(x, y) === 240 ? 240 : 16;
    expect(diffPixels(image(40, 40), image(40, 40, near), 40, 40).regions).toHaveLength(1);
  });
});

describe('changeSummary', () => {
  it('says when the panel changed size', () => {
    expect(changeSummary({ sizes: ['10 by 10 px', '10 by 12 px'] })[0]).toMatch(
      /differ in size, before 10 by 10 px and after 10 by 12 px/,
    );
  });

  it('says no visible change, and counts faint pixels apart', () => {
    expect(changeSummary({ regions: [], faint: 3 })).toEqual([
      'no visible change',
      '3 pixels differ slightly, as anti-aliased edges vary between runs; not counted, and light orange in the diff image',
    ]);
  });
});

describe('withinPanel', () => {
  const panel: Rect = { x: 100, y: 100, width: 200, height: 200 };

  it('keeps a box inside the panel whole', () => {
    const box = { x: 120, y: 120, width: 50, height: 20 };
    expect(withinPanel(box, panel)).toEqual({ box, cut: false });
  });

  it('cuts a box that runs past the panel, such as a scrolling table', () => {
    expect(withinPanel({ x: 120, y: 250, width: 50, height: 300 }, panel)).toEqual({
      box: { x: 120, y: 250, width: 50, height: 50 },
      cut: true,
    });
  });

  it('rejects a box outside the panel', () => {
    expect(withinPanel({ x: 400, y: 120, width: 50, height: 20 }, panel)).toBeUndefined();
  });
});

describe('gutterFor', () => {
  const content: Rect = { x: 100, y: 100, width: 200, height: 200 };

  it('puts badges in the left margin when it has room', () => {
    expect(gutterFor({ clip: { x: 70, y: 70, width: 260, height: 260 }, content })).toBe(75);
  });

  it('uses the right margin when the panel touches the left edge', () => {
    expect(gutterFor({ clip: { x: 100, y: 70, width: 230, height: 260 }, content: content })).toBe(
      303,
    );
  });

  it('has no gutter without a margin', () => {
    expect(gutterFor({ clip: content, content })).toBeUndefined();
    expect(gutterFor(undefined)).toBeUndefined();
  });
});

describe('placeBadges', () => {
  const bounds: Rect = { x: 0, y: 0, width: 400, height: 400 };
  const overlap = (a: Rect, b: Rect) =>
    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

  it('sets a badge in the gutter level with its frame, with a line to it', () => {
    const [badge] = placeBadges([{ x: 100, y: 100, width: 80, height: 40 }], 70, bounds);
    expect(badge!.spot).toEqual({ x: 70, y: 109, width: 22, height: 22 });
    expect(badge!.line).toEqual({ x1: 92, y1: 120, x2: 100, y2: 120 });
  });

  it('moves a badge that would overlap another to the nearest free place', () => {
    const row = [
      { x: 100, y: 100, width: 40, height: 20 },
      { x: 200, y: 100, width: 40, height: 20 },
    ];
    const [first, second] = placeBadges(row, 70, bounds);
    expect(overlap(first!.spot, second!.spot)).toBe(false);
    expect(Math.abs(second!.spot.y - first!.spot.y)).toBe(24);
  });

  it('without a gutter, picks a corner clear of other frames', () => {
    const frames = [
      { x: 100, y: 100, width: 40, height: 20 },
      // Covers the first frame's top-left corner spot.
      { x: 70, y: 70, width: 30, height: 30 },
    ];
    const [badge] = placeBadges(frames, undefined, bounds);
    expect(overlap(badge!.spot, frames[1]!)).toBe(false);
    expect(overlap(badge!.spot, frames[0]!)).toBe(true);
    expect(badge!.line).toBeUndefined();
  });
});

describe('outlineChanges', () => {
  it('lists a renamed label as removed then added', () => {
    expect(
      outlineChanges(
        ['- tabpanel "BRK":', '  - group "Market board":', '    - button "regular"'],
        ['- tabpanel "BRK":', '  - group "Board":', '    - button "regular"'],
      ),
    ).toEqual(['- - group "Market board":', '+ - group "Board":']);
  });

  it('counts repeated lines, so one more of them shows', () => {
    expect(outlineChanges(['- cell', '- cell'], ['- cell', '- cell', '- cell'])).toEqual([
      '+ - cell',
    ]);
  });
});

describe('outlineSelectors', () => {
  it('turns named elements into selectors, leaving out text, cells and data rows', () => {
    expect(
      outlineSelectors([
        '- tabpanel "BRK":',
        '  - group "Board":',
        '  - button "regular"',
        '  - button "regular"',
        '  - text "Broker data 13 Nov"',
        '  - cell "185.2B"',
        '  - row "NET BUY VALUE IDR LOT":',
        '  - row "KZ 185.2B 334.9K":',
      ]),
    ).toEqual([
      'role=tabpanel[name="BRK"]',
      'role=group[name="Board"]',
      'role=button[name="regular"]',
      'role=row[name="NET BUY VALUE IDR LOT"]',
    ]);
  });
});
