import { useEffect, useRef } from 'react';

export type CorruptionMode = 'spread' | 'hold' | 'retreat' | 'still';

const cell = 64;
const depthStep = 0.05;
const riseShare = 0.2;
const stepShare = 0.12;
const liftShare = 0.3;
const leadMs = 160;
const sparkCount = 90;
const layoutSeed = Math.floor(Math.random() * 2 ** 32);
let origin = { x: 0.5, y: 0.5 };

export function aimCorruption(x: number, y: number) {
  origin = { x, y };
}

type Point = [number, number];
type Block = {
  col: number;
  row: number;
  level: number;
  order: number;
  pulse: number;
  traces: Point[][];
};
type Spark = { x: number; y: number; speed: number; size: number; phase: number };

function random(seed: number) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function outward(fromOrigin: number, jitter: number) {
  return Math.min(fromOrigin, 1) * 0.72 + jitter * 0.28;
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

function layoutBlocks(cols: number, rows: number, reach: (x: number, y: number) => number) {
  const next = random(layoutSeed);
  const patches = Array.from({ length: Math.ceil(cols / 3) + 1 }, () =>
    Array.from({ length: Math.ceil(rows / 3) + 1 }, next),
  );
  const blocks: Block[] = [];
  for (let row = 0; row < rows; row++)
    for (let col = 0; col < cols; col++) {
      const terrace = patches[Math.floor(col / 3)]?.[Math.floor(row / 3)] ?? 0;
      blocks.push({
        col,
        row,
        level: Math.min(1 + Math.floor(terrace * 2.2 + next() * 0.8), 3),
        order: outward(reach((col + 0.5) * cell, (row + 0.5) * cell), terrace * 0.6 + next() * 0.4),
        pulse: next() * Math.PI * 2,
        traces: next() < 0.35 ? [] : [trace(next)],
      });
    }
  return blocks;
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

const ease = (p: number) => 1 - (1 - p) ** 3;
const clamp = (p: number) => Math.min(Math.max(p, 0), 1);

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
    const riseMs = durationMs * riseShare,
      stepMs = durationMs * stepShare,
      liftMs = durationMs * liftShare;
    let cols = 0,
      rows = 0,
      width = 0,
      height = 0,
      vanish: Point = [0, 0],
      blocks: Block[] = [],
      sparks: Spark[] = [],
      heights = new Float64Array(0),
      sheen: CanvasGradient | string = '#070708',
      frame = 0,
      start = performance.now();

    function grow(block: Block, t: number) {
      if (mode === 'spread') {
        const at = block.order * (durationMs - riseMs - 2 * stepMs);
        let h = 0;
        for (let level = 0; level < block.level; level++)
          h += ease(clamp((t - at - level * stepMs) / riseMs));
        return { h, alpha: clamp(h * 5), glow: clamp(1 - (at - t) / leadMs) };
      }
      if (mode === 'retreat') {
        const lift = clamp((t - block.order * (durationMs - liftMs)) / liftMs);
        return { h: block.level + lift ** 2 * 5, alpha: 1 - clamp(lift * 2 - 1), glow: 0 };
      }
      return { h: block.level, alpha: 1, glow: 0 };
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

    function drawBlock(block: Block, h: number, t: number) {
      if (!context) return;
      const k = 1 + h * depthStep;
      const [vx, vy] = vanish;
      const project = (x: number, y: number): Point => [vx + (x - vx) * k, vy + (y - vy) * k];
      const x0 = block.col * cell,
        y0 = block.row * cell,
        x1 = x0 + cell,
        y1 = y0 + cell;
      const [fx0, fy0] = project(x0, y0);
      const [fx1, fy1] = project(x1, y1);
      const lower = (col: number, row: number) =>
        col >= 0 &&
        row >= 0 &&
        col < cols &&
        row < rows &&
        (heights[row * cols + col] ?? 0) < h - 0.01;
      const side = (points: Point[], fill: string) => {
        const path = new Path2D();
        points.forEach(([x, y], index) => (index === 0 ? path.moveTo(x, y) : path.lineTo(x, y)));
        path.closePath();
        context.fillStyle = fill;
        context.fill(path);
      };
      if (x0 > vx && lower(block.col - 1, block.row))
        side(
          [
            [x0, y0],
            [x0, y1],
            [fx0, fy1],
            [fx0, fy0],
          ],
          'rgb(58, 7, 9)',
        );
      if (x1 < vx && lower(block.col + 1, block.row))
        side(
          [
            [x1, y0],
            [x1, y1],
            [fx1, fy1],
            [fx1, fy0],
          ],
          'rgb(44, 5, 7)',
        );
      if (y0 > vy && lower(block.col, block.row - 1))
        side(
          [
            [x0, y0],
            [x1, y0],
            [fx1, fy0],
            [fx0, fy0],
          ],
          'rgb(84, 10, 12)',
        );
      if (y1 < vy && lower(block.col, block.row + 1))
        side(
          [
            [x0, y1],
            [x1, y1],
            [fx1, fy1],
            [fx0, fy1],
          ],
          'rgb(30, 4, 5)',
        );

      const size = fx1 - fx0;
      context.fillStyle = sheen;
      context.fillRect(fx0, fy0, size, size);
      context.strokeStyle = 'rgba(255, 50, 45, 0.18)';
      context.lineWidth = 1;
      context.strokeRect(fx0, fy0, size, size);
      const edge = new Path2D();
      const rim = (col: number, row: number, from: Point, to: Point) => {
        if (!lower(col, row)) return;
        edge.moveTo(...from);
        edge.lineTo(...to);
      };
      rim(block.col - 1, block.row, [fx0, fy0], [fx0, fy1]);
      rim(block.col + 1, block.row, [fx1, fy0], [fx1, fy1]);
      rim(block.col, block.row - 1, [fx0, fy0], [fx1, fy0]);
      rim(block.col, block.row + 1, [fx0, fy1], [fx1, fy1]);
      strokeNeon(edge, 0.9);

      const glow = mode === 'hold' ? 0.7 + 0.3 * Math.cos(t / 300 + block.pulse) : 1;
      const traces = new Path2D();
      for (const points of block.traces)
        points.forEach(([u, v], index) => {
          const x = fx0 + u * size,
            y = fy0 + v * size;
          if (index === 0) traces.moveTo(x, y);
          else traces.lineTo(x, y);
        });
      strokeNeon(traces, glow);
      context.fillStyle = `rgba(255, 150, 140, ${glow})`;
      for (const points of block.traces) {
        const [u, v] = points[points.length - 1] ?? [0.5, 0.5];
        context.fillRect(fx0 + u * size - 1.5, fy0 + v * size - 1.5, 3, 3);
      }
    }

    function drawSparks(t: number) {
      if (!context) return;
      const wrap = height + 20;
      for (const spark of sparks) {
        const y = ((((spark.y - (spark.speed * t) / 1000) % wrap) + wrap) % wrap) - 10;
        const x = spark.x + Math.sin(t / 400 + spark.phase) * 6;
        const under = heights[Math.floor(y / cell) * cols + Math.floor(x / cell)] ?? 0;
        if (under < 0.5) continue;
        context.fillStyle = `rgba(255, 90, 70, ${0.5 + 0.5 * Math.sin(t / 90 + spark.phase)})`;
        context.fillRect(x, y, spark.size, spark.size);
      }
    }

    function draw(now: number) {
      if (!canvas || !context) return;
      const t = mode === 'still' ? 0 : now - start;
      context.clearRect(0, 0, width, height);
      const grown = blocks.map((block) => ({ block, ...grow(block, t) }));
      grown.forEach(({ block, h, alpha }) => {
        heights[block.row * cols + block.col] = alpha > 0.01 ? h : 0;
      });
      for (const { block, h, glow } of grown) {
        if (h > 0 || glow <= 0) continue;
        context.fillStyle = `rgba(255, 36, 24, ${0.3 * glow})`;
        context.fillRect(block.col * cell, block.row * cell, cell, cell);
      }
      const visible = grown.filter(({ alpha }) => alpha > 0.01).sort((a, b) => a.h - b.h);
      for (const { block, h, alpha } of visible) {
        context.globalAlpha = alpha;
        drawBlock(block, h, t);
      }
      context.globalAlpha = 1;
      drawSparks(t);
    }

    function resize() {
      if (!canvas || !context) return;
      const ratio = window.devicePixelRatio || 1;
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      cols = Math.ceil(width / cell);
      rows = Math.ceil(height / cell);
      const ox = origin.x * width,
        oy = origin.y * height;
      vanish = [ox, oy];
      const longest = Math.max(
        Math.hypot(ox, oy),
        Math.hypot(width - ox, height - oy),
        Math.hypot(ox, height - oy),
        Math.hypot(width - ox, oy),
      );
      blocks = layoutBlocks(cols, rows, (x, y) => Math.hypot(x - ox, y - oy) / longest);
      sparks = layoutSparks(width, height);
      heights = new Float64Array(cols * rows);
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
