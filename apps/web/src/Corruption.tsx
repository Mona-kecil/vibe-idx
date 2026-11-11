import { useEffect, useRef } from 'react';

export type CorruptionMode = 'spread' | 'hold' | 'retreat' | 'still';

const cell = 40;
const enterMs = 220;
const gridCols = 18;
const gridRows = 11;
const strays = 70;
const spill = 1.12;
const halfView = 1.0;
const far = 8;
const travel = 0.8;
const part = 2.4;
const layoutSeed = Math.floor(Math.random() * 2 ** 32);
let origin = { x: 0.5, y: 0.5 };

export function aimCorruption(x: number, y: number) {
  origin = { x, y };
}

type Vec = [number, number, number];
type Cube = {
  u: number;
  v: number;
  depth: number;
  size: number;
  yaw: number;
  pitch: number;
  pulse: number;
  jitter: number;
};
type Placed = { home: Vec; half: number; yaw: number; pitch: number; pulse: number; order: number };

const corners: Vec[] = Array.from({ length: 8 }, (_, i) => [
  i & 1 ? 1 : -1,
  i & 2 ? 1 : -1,
  i & 4 ? 1 : -1,
]);
const faces: { axis: Vec; points: number[] }[] = [
  { axis: [0, 0, 1], points: [4, 5, 7, 6] },
  { axis: [0, 0, -1], points: [0, 2, 3, 1] },
  { axis: [1, 0, 0], points: [1, 3, 7, 5] },
  { axis: [-1, 0, 0], points: [0, 4, 6, 2] },
  { axis: [0, 1, 0], points: [2, 6, 7, 3] },
  { axis: [0, -1, 0], points: [0, 1, 5, 4] },
];

function random(seed: number) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function layoutCubes(): Cube[] {
  const next = random(layoutSeed);
  const cube = (u: number, v: number): Cube => ({
    u,
    v,
    depth: next(),
    size: next() ** 1.6,
    yaw: (next() - 0.5) * 0.7,
    pitch: (next() - 0.5) * 0.6,
    pulse: next() * Math.PI * 2,
    jitter: next(),
  });
  const across = (index: number, count: number) => ((index + next()) / count) * 2 - 1;
  return [
    ...Array.from({ length: gridCols * gridRows }, (_, index) =>
      cube(
        across(index % gridCols, gridCols) * spill,
        across(Math.floor(index / gridCols), gridRows) * spill,
      ),
    ),
    ...Array.from({ length: strays }, () =>
      cube((next() * 2 - 1) * spill, (next() * 2 - 1) * spill),
    ),
  ];
}

function outward(fromOrigin: number, jitter: number) {
  return Math.min(fromOrigin, 1) * 0.72 + jitter * 0.28;
}

function layoutMask(cols: number, rows: number, reach: (x: number, y: number) => number) {
  const next = random(layoutSeed ^ 0x9e3779b9);
  const coarse = Array.from({ length: (cols >> 2) + 1 }, () =>
    Array.from({ length: (rows >> 2) + 1 }, next),
  );
  const order = new Float64Array(cols * rows);
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++) {
      order[y * cols + x] = outward(
        reach((x + 0.5) * cell, (y + 0.5) * cell),
        coarse[x >> 2]?.[y >> 2] ?? 0,
      );
    }
  return order;
}

function rotate([x, y, z]: Vec, yaw: number, pitch: number): Vec {
  const y1 = y * Math.cos(pitch) - z * Math.sin(pitch),
    z1 = y * Math.sin(pitch) + z * Math.cos(pitch);
  return [x * Math.cos(yaw) + z1 * Math.sin(yaw), y1, -x * Math.sin(yaw) + z1 * Math.cos(yaw)];
}

function neon(context: CanvasRenderingContext2D, path: Path2D, alpha: number) {
  for (const [color, width] of [
    [`rgba(255, 24, 24, ${0.22 * alpha})`, 9],
    [`rgba(255, 42, 42, ${alpha})`, 2.5],
    [`rgba(255, 176, 168, ${alpha})`, 1],
  ] as const) {
    context.strokeStyle = color;
    context.lineWidth = width;
    context.stroke(path);
  }
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
    const cubes = layoutCubes();
    const span = Math.max(durationMs - enterMs, 0);
    let cols = 0,
      rows = 0,
      mask = new Float64Array(0),
      placed: Placed[] = [],
      aim: Vec = [0, 0, -1],
      width = 0,
      height = 0,
      focal = 1,
      frame = 0,
      start = performance.now();

    function progress(order: number, t: number) {
      if (mode === 'spread') return ease(clamp((t - order * span) / enterMs));
      if (mode === 'retreat') return 1 - clamp((t - order * span) / enterMs) ** 2;
      return 1;
    }

    function drawMask(t: number) {
      if (!context) return;
      const present = (index: number) => {
        const at = (mask[index] ?? 0) * span;
        if (mode === 'spread') return at <= t;
        if (mode === 'retreat') return t < at;
        return true;
      };
      const solid = (x: number, y: number) =>
        x < 0 || y < 0 || x >= cols || y >= rows || present(y * cols + x);
      const edges = new Path2D();
      const side = (x1: number, y1: number, x2: number, y2: number) => {
        edges.moveTo(x1, y1);
        edges.lineTo(x2, y2);
      };
      context.fillStyle = '#050505';
      context.strokeStyle = 'rgba(255, 40, 40, 0.05)';
      context.lineWidth = 1;
      for (let y = 0; y < rows; y++)
        for (let x = 0; x < cols; x++) {
          if (!present(y * cols + x)) continue;
          const px = x * cell,
            py = y * cell;
          context.fillRect(px, py, cell, cell);
          context.strokeRect(px + 0.5, py + 0.5, cell - 1, cell - 1);
          if (!solid(x, y - 1)) side(px, py, px + cell, py);
          if (!solid(x + 1, y)) side(px + cell, py, px + cell, py + cell);
          if (!solid(x, y + 1)) side(px, py + cell, px + cell, py + cell);
          if (!solid(x - 1, y)) side(px, py, px, py + cell);
        }
      neon(context, edges, 0.55);
    }

    function place([x, y, z]: Vec, p: number): Vec {
      const [ax, ay, az] = aim;
      if (mode === 'spread') {
        const from = far * (1 - p);
        return [ax * from + x * p, ay * from + y * p, az * from + z * p];
      }
      if (mode === 'retreat') {
        const length = Math.hypot(ax, ay, az);
        const [dx, dy, dz] = [ax / length, ay / length, az / length];
        const along = x * dx + y * dy + z * dz;
        const [rx, ry, rz] = [x - dx * along, y - dy * along, z - dz * along];
        const side = (part * (1 - p)) / (Math.hypot(rx, ry, rz) || 1);
        const pass = travel * (1 - p);
        return [x + rx * side - dx * pass, y + ry * side - dy * pass, z + rz * side - dz * pass];
      }
      return [x, y, z];
    }

    function drawCube(cube: Placed, p: number, t: number) {
      const center = place(cube.home, p);
      const yaw = cube.yaw;
      const world = corners.map(([cx, cy, cz]) => {
        const [x, y, z] = rotate([cx * cube.half, cy * cube.half, cz * cube.half], yaw, cube.pitch);
        return [center[0] + x, center[1] + y, center[2] + z] as Vec;
      });
      if (world.some(([, , z]) => -z < 0.08)) return null;
      const screen = world.map(
        ([x, y, z]) => [width / 2 + (focal * x) / -z, height / 2 - (focal * y) / -z] as const,
      );
      const glow = mode === 'hold' ? 0.75 + 0.25 * Math.cos(t / 260 + cube.pulse) : 1;
      return {
        depth: Math.hypot(...center),
        render(context: CanvasRenderingContext2D) {
          context.globalAlpha = p;
          for (const face of faces) {
            const normal = rotate(face.axis, yaw, cube.pitch);
            let dot = 0;
            for (const index of face.points) {
              const point = world[index] ?? center;
              dot += normal[0] * point[0] + normal[1] * point[1] + normal[2] * point[2];
            }
            if (dot >= 0) continue;
            const path = new Path2D();
            face.points.forEach((index, order) => {
              const [x, y] = screen[index] ?? [0, 0];
              if (order === 0) path.moveTo(x, y);
              else path.lineTo(x, y);
            });
            path.closePath();
            if (face.axis[2] === 1) {
              context.fillStyle = '#060606';
              context.fill(path);
              neon(context, path, glow);
            } else {
              const light = Math.round(12 + 18 * Math.abs(normal[1]) + 8 * Math.abs(normal[0]));
              context.fillStyle = `rgb(${light}, 4, 5)`;
              context.fill(path);
              context.strokeStyle = `rgba(255, 40, 40, ${0.55 * glow})`;
              context.lineWidth = 1;
              context.stroke(path);
            }
          }
          context.globalAlpha = 1;
        },
      };
    }

    function draw(now: number) {
      if (!canvas || !context) return;
      const t = mode === 'still' ? 0 : now - start;
      context.clearRect(0, 0, canvas.width, canvas.height);
      drawMask(t);
      const drawn = [];
      for (const cube of placed) {
        const p = progress(cube.order, t);
        const item = p > 0 ? drawCube(cube, p, t) : null;
        if (item) drawn.push(item);
      }
      drawn.sort((a, b) => b.depth - a.depth);
      for (const item of drawn) item.render(context);
    }

    function resize() {
      if (!canvas || !context) return;
      const ratio = window.devicePixelRatio || 1;
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      focal = width / 2 / Math.tan(halfView);
      cols = Math.ceil(width / cell);
      rows = Math.ceil(height / cell);
      const ox = origin.x * width,
        oy = origin.y * height;
      aim = [(ox - width / 2) / focal, (height / 2 - oy) / focal, -1];
      const longest = Math.max(
        Math.hypot(ox, oy),
        Math.hypot(width - ox, height - oy),
        Math.hypot(ox, height - oy),
        Math.hypot(width - ox, oy),
      );
      const reach = (x: number, y: number) => Math.hypot(x - ox, y - oy) / longest;
      mask = layoutMask(cols, rows, reach);
      const angle = (x: number, y: number) => {
        const ray: Vec = [(x - width / 2) / focal, (height / 2 - y) / focal, -1];
        const cos =
          (ray[0] * aim[0] + ray[1] * aim[1] + ray[2] * aim[2]) /
          (Math.hypot(...ray) * Math.hypot(...aim));
        return Math.acos(Math.min(cos, 1));
      };
      const widest = Math.max(angle(0, 0), angle(width, 0), angle(0, height), angle(width, height));
      const slot = (spill * width) / gridCols;
      placed = cubes.map((cube) => {
        const x = width / 2 + (cube.u * width) / 2,
          y = height / 2 - (cube.v * height) / 2;
        const near = Math.min(angle(x, y) / widest, 1);
        const distance = 0.45 + (1 - near) ** 1.4 * 2.2 + cube.depth * 0.5;
        const rayX = (x - width / 2) / focal,
          rayY = (height / 2 - y) / focal;
        const pixels = slot * (0.45 + cube.size * 1.1) * (0.7 + 0.6 * near);
        return {
          home: [rayX * distance, rayY * distance, -distance],
          half: (distance * pixels) / 2 / focal,
          yaw: -Math.atan(rayX) + cube.yaw,
          pitch: cube.pitch,
          pulse: cube.pulse,
          order: outward(reach(x, y), cube.jitter),
        };
      });
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
