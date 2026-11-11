import { useEffect, useRef } from 'react';

export type CorruptionMode = 'spread' | 'hold' | 'retreat' | 'still';

const rootSize = 96;
const coverCell = 24;
const maxBuds = 2;
const growUnits = 3.2;
const nubGrowUnits = 1.6;
const unitMs = 79;
const liftShare = 0.3;
const sparkCount = 90;
const pulseGap = 300;
const pulseSpeed = 0.15;
const layoutSeed = Math.floor(Math.random() * 2 ** 32);
let origin = { x: 0.5, y: 0.5 };

export function aimCorruption(x: number, y: number) {
  origin = { x, y };
}

type Point = [number, number];
type Block = {
  x: number;
  y: number;
  size: number;
  anchor: Point;
  birth: number;
  grows: number;
  depth: number;
  layer: number;
  pulse: number;
  traces: Point[][];
};
type Spark = { x: number; y: number; speed: number; size: number; phase: number };

const spots: Point[] = [
  [0, 0],
  [1, 0],
  [0, 1],
  [1, 1],
  [0.5, 0],
  [0.5, 1],
  [0, 0.5],
  [1, 0.5],
];

const ease = (p: number) => 1 - (1 - p) ** 2;
const clamp = (p: number) => Math.min(Math.max(p, 0), 1);

function random(seed: number) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(items: readonly T[], next: () => number) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index--) {
    const pick = Math.floor(next() * (index + 1));
    [copy[index], copy[pick]] = [copy[pick] as T, copy[index] as T];
  }
  return copy;
}

function trace(next: () => number): Point[] {
  const lane = () => (1 + Math.floor(next() * 3)) / 4;
  const enter = lane(),
    turn = lane(),
    leave = lane();
  const across: Point[] = [
    [0, enter],
    [turn, enter],
    [turn, leave],
    [1, leave],
  ];
  return next() < 0.5 ? across : across.map(([x, y]) => [y, x]);
}

function growBlocks(width: number, height: number, ox: number, oy: number) {
  const next = random(layoutSeed);
  const cols = Math.ceil(width / coverCell),
    rows = Math.ceil(height / coverCell);
  const covered = new Uint8Array(cols * rows);
  const blocks: Block[] = [];
  const near = (x: number, y: number) =>
    clamp(Math.hypot(x - width / 2, y - height / 2) / Math.hypot(width / 2, height / 2));
  const sizeAt = (x: number, y: number) =>
    (next() < 0.6 ? 120 + next() * 50 : 200 + next() * 100) * (0.8 + 0.4 * near(x, y));
  const cells = (x: number, y: number, size: number) => {
    const found: number[] = [];
    for (
      let row = Math.max(Math.floor(y / coverCell), 0);
      row < Math.min(Math.ceil((y + size) / coverCell), rows);
      row++
    )
      for (
        let col = Math.max(Math.floor(x / coverCell), 0);
        col < Math.min(Math.ceil((x + size) / coverCell), cols);
        col++
      )
        found.push(row * cols + col);
    return found;
  };
  const open = (x: number, y: number, size: number) => {
    const inside = cells(x, y, size);
    return inside.length ? inside.filter((index) => !covered[index]).length / inside.length : 0;
  };
  const add = (x: number, y: number, size: number, anchor: Point, birth: number) => {
    const block: Block = {
      x,
      y,
      size,
      anchor,
      birth,
      grows: growUnits,
      depth: size / (0.8 * width),
      layer: near(x + size / 2, y + size / 2),
      pulse: next() * Math.PI * 2,
      traces: Array.from({ length: size > 280 ? 2 : size >= 200 ? 1 : 0 }, () => trace(next)),
    };
    blocks.push(block);
    for (const index of cells(x + coverCell, y + coverCell, size - 2 * coverCell))
      covered[index] = 1;
    return block;
  };

  const queue = [add(ox - rootSize / 2, oy - rootSize / 2, rootSize, [ox, oy], 0)];
  for (let parent = queue.shift(); parent; parent = queue.shift()) {
    let buds = 0;
    for (const [u, v] of shuffled(spots, next)) {
      if (buds >= maxBuds) break;
      const px = parent.x + u * parent.size,
        py = parent.y + v * parent.size;
      const size = sizeAt(px, py);
      const x = px + (u - 0.5) * size * 0.8 - size / 2,
        y = py + (v - 0.5) * size * 0.8 - size / 2;
      if (open(x, y, size) < 0.4) continue;
      const birth = parent.birth + 0.8 + buds * 0.9 + next() * 0.3;
      queue.push(add(x, y, size, [px, py], birth));
      buds++;
    }
  }

  covered.forEach((done, index) => {
    if (done) return;
    const cx = ((index % cols) + 0.5) * coverCell,
      cy = (Math.floor(index / cols) + 0.5) * coverCell;
    let nearest = blocks[0],
      gap = Infinity;
    for (const block of blocks) {
      const dx = Math.max(block.x - cx, 0, cx - block.x - block.size),
        dy = Math.max(block.y - cy, 0, cy - block.y - block.size);
      if (Math.hypot(dx, dy) < gap) {
        gap = Math.hypot(dx, dy);
        nearest = block;
      }
    }
    if (!nearest) return;
    const size = Math.max(coverCell * 4, sizeAt(cx, cy), gap * 2 + coverCell * 2);
    const anchor: Point = [
      Math.min(Math.max(cx, nearest.x), nearest.x + nearest.size),
      Math.min(Math.max(cy, nearest.y), nearest.y + nearest.size),
    ];
    add(cx - size / 2, cy - size / 2, size, anchor, nearest.birth + 0.6 + next() * 0.4);
  });

  for (const parent of [...blocks]) {
    const nubs = Math.floor(next() * (parent.size > 200 ? 4 : 3));
    for (const [u, v] of shuffled(spots, next).slice(0, nubs)) {
      const size = next() < 0.6 ? 28 + next() * 32 : 70 + next() * 40;
      const cx = parent.x + u * parent.size,
        cy = parent.y + v * parent.size;
      blocks.push({
        x: cx - size / 2,
        y: cy - size / 2,
        size,
        anchor: [cx, cy],
        birth: parent.birth + growUnits * 0.6 + next() * 0.4,
        grows: nubGrowUnits,
        depth: size / (0.8 * width),
        layer: parent.layer + 0.0001,
        pulse: next() * Math.PI * 2,
        traces: [],
      });
    }
  }
  return blocks.sort((a, b) => a.layer - b.layer);
}

export function arrivalMs() {
  const blocks = growBlocks(
    window.innerWidth,
    window.innerHeight,
    origin.x * window.innerWidth,
    origin.y * window.innerHeight,
  );
  return Math.round(finish(blocks) * unitMs);
}

function finish(blocks: Block[]) {
  return Math.max(...blocks.map((block) => block.birth + block.grows));
}

function layoutSparks(width: number, height: number): Spark[] {
  const next = random(layoutSeed ^ 0x51ed270b);
  return Array.from({ length: sparkCount }, () => ({
    x: next() * width,
    y: next() * height,
    speed: 20 + next() * 50,
    size: 1 + next() * 1.6,
    phase: next() * Math.PI * 2,
  }));
}

export function Corruption({
  mode,
  durationMs = 0,
}: {
  mode: CorruptionMode;
  durationMs?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    const liftMs = durationMs * liftShare;
    let width = 0,
      height = 0,
      vanish: Point = [0, 0],
      blocks: Block[] = [],
      sparks: Spark[] = [],
      lastBirth = 1,
      sheen: CanvasGradient | string = '#070708',
      frame = 0,
      start = performance.now();

    function stage(block: Block, t: number) {
      if (mode === 'spread') {
        const grow = ease(clamp((t - block.birth * unitMs) / (block.grows * unitMs)));
        return { grow, lift: 0, alpha: grow > 0 ? 1 : 0 };
      }
      if (mode === 'retreat') {
        const at = (block.birth / lastBirth) * (durationMs - liftMs);
        const lift = clamp((t - at) / liftMs);
        return { grow: 1, lift, alpha: 1 - clamp(lift * 2 - 1) };
      }
      return { grow: 1, lift: 0, alpha: 1 };
    }

    function strokeNeon(path: Path2D, glow: number) {
      if (!context) return;
      for (const [color, lineWidth] of [
        [`rgba(255, 30, 30, ${0.22 * glow})`, 4],
        [`rgba(255, 60, 50, ${glow})`, 1.4],
        [`rgba(255, 190, 180, ${0.8 * glow})`, 0.6],
      ] as const) {
        context.strokeStyle = color;
        context.lineWidth = lineWidth;
        context.stroke(path);
      }
    }

    function drawBlock(block: Block, grow: number, lift: number, t: number) {
      if (!context) return;
      const [vx, vy] = vanish;
      const [ax, ay] = block.anchor;
      const toward = 1 + lift ** 2 * 1.2;
      const front = (x: number, y: number): Point => {
        const gx = ax + (x - ax) * grow,
          gy = ay + (y - ay) * grow;
        return [vx + (gx - vx) * toward, vy + (gy - vy) * toward];
      };
      const back = ([x, y]: Point): Point => [
        vx + (x - vx) / (1 + block.depth * grow),
        vy + (y - vy) / (1 + block.depth * grow),
      ];
      const corners = [
        front(block.x, block.y),
        front(block.x + block.size, block.y),
        front(block.x + block.size, block.y + block.size),
        front(block.x, block.y + block.size),
      ] as const;
      const behind = corners.map(back);
      const quad = (points: Point[]) => {
        const path = new Path2D();
        points.forEach(([x, y], index) => (index === 0 ? path.moveTo(x, y) : path.lineTo(x, y)));
        path.closePath();
        return path;
      };
      const light = 0.12 + 0.88 * Math.min(block.layer, 1) ** 1.6;
      const fog = `rgba(0, 0, 0, ${0.65 * (1 - light)})`;
      const [[left, top], [right], [, bottom]] = corners;
      const walls: [number, number, string, boolean][] = [
        [0, 1, 'rgb(60, 8, 10)', top > vy],
        [1, 2, 'rgb(32, 4, 6)', right < vx],
        [2, 3, 'rgb(22, 3, 4)', bottom < vy],
        [3, 0, 'rgb(42, 5, 7)', left > vx],
      ];
      for (const [from, to, fill, facing] of walls) {
        if (!facing) continue;
        const a = corners[from],
          b = corners[to],
          c = behind[to],
          d = behind[from];
        if (!a || !b || !c || !d) continue;
        const wall = quad([a, b, c, d]);
        context.fillStyle = fill;
        context.fill(wall);
        context.fillStyle = fog;
        context.fill(wall);
        strokeNeon(wall, 0.9 * light);
      }
      const face = quad([...corners]);
      context.fillStyle = sheen;
      context.fill(face);
      context.fillStyle = fog;
      context.fill(face);
      strokeNeon(face, 0.9 * light);

      const [x0, y0] = corners[0];
      const size = corners[1][0] - x0;
      const glow = mode === 'hold' ? 0.7 + 0.3 * Math.cos(t / 300 + block.pulse) : 1;
      const traces = new Path2D();
      for (const points of block.traces)
        points.forEach(([u, v], index) => {
          const x = x0 + u * size,
            y = y0 + v * size;
          if (index === 0) traces.moveTo(x, y);
          else traces.lineTo(x, y);
        });
      strokeNeon(traces, glow * (0.2 + 0.8 * light));
      if (mode !== 'hold' || !block.traces.length) return;
      context.save();
      context.setLineDash([16, pulseGap]);
      context.lineDashOffset = -((t * pulseSpeed + block.pulse * 100) % (16 + pulseGap));
      context.lineCap = 'round';
      for (const [color, lineWidth] of [
        [`rgba(255, 60, 40, ${0.35 * light})`, 6],
        [`rgba(255, 215, 205, ${light})`, 1.8],
      ] as const) {
        context.strokeStyle = color;
        context.lineWidth = lineWidth;
        context.stroke(traces);
      }
      context.restore();
    }

    function drawSparks(t: number, alpha: number) {
      if (!context || alpha <= 0) return;
      const wrap = height + 20;
      for (const spark of sparks) {
        const y = ((((spark.y - (spark.speed * t) / 1000) % wrap) + wrap) % wrap) - 10;
        const x = spark.x + Math.sin(t / 400 + spark.phase) * 6;
        context.fillStyle = `rgba(255, 90, 70, ${alpha * (0.5 + 0.5 * Math.sin(t / 90 + spark.phase))})`;
        context.fillRect(x, y, spark.size, spark.size);
      }
    }

    function draw(now: number) {
      if (!canvas || !context) return;
      const t = mode === 'still' ? 0 : now - start;
      context.clearRect(0, 0, width, height);
      for (const block of blocks) {
        const { grow, lift, alpha } = stage(block, t);
        if (alpha <= 0.01 || grow <= 0) continue;
        context.globalAlpha = alpha;
        drawBlock(block, grow, lift, t);
      }
      context.globalAlpha = 1;
      const span = mode === 'spread' ? finish(blocks) * unitMs : durationMs;
      const progress = span ? t / span : 1;
      drawSparks(
        t,
        mode === 'spread' ? clamp(progress * 2 - 1) : mode === 'retreat' ? 1 - clamp(progress) : 1,
      );
    }

    function resize() {
      if (!canvas || !context) return;
      const ratio = window.devicePixelRatio || 1;
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      vanish = [width / 2, height / 2];
      blocks = growBlocks(width, height, origin.x * width, origin.y * height);
      lastBirth = Math.max(...blocks.map((block) => block.birth), 1);
      sparks = layoutSparks(width, height);
      const gradient = context.createLinearGradient(0, 0, width, height);
      gradient.addColorStop(0, '#050506');
      gradient.addColorStop(0.42, '#0b0b0e');
      gradient.addColorStop(0.5, '#141418');
      gradient.addColorStop(0.58, '#0b0b0e');
      gradient.addColorStop(1, '#040405');
      sheen = gradient;
      start = performance.now();
      draw(start);
    }

    function animate(now: number) {
      draw(now);
      frame = window.requestAnimationFrame(animate);
    }
    resize();
    if (mode !== 'still') frame = window.requestAnimationFrame(animate);
    window.addEventListener('resize', resize);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', resize);
    };
  }, [mode, durationMs]);
  return <canvas className="corruption" ref={canvasRef} aria-hidden="true" />;
}
