import { useEffect, useRef } from 'react';

const size = 40;
const flashMs = 700;
export type Seed = { x: number; y: number };
export type CorruptionMode = 'spread' | 'hold' | 'retreat' | 'still';
type Flash = { x: number; y: number; w: number; h: number; at: number };
type Side = [number, number, number, number];
const depth = 0.08;

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

function noise(x: number, y: number, salt: number) {
  const value = Math.sin(x * 127.1 + y * 311.7 + salt) * 43758.5453;
  return value - Math.floor(value);
}

function schedule(cols: number, rows: number, seed: Seed, spreadMs: number) {
  const at = new Float64Array(cols * rows);
  const width = cols * size,
    height = rows * size;
  const reach = Math.max(
    Math.hypot(seed.x, seed.y),
    Math.hypot(width - seed.x, seed.y),
    Math.hypot(seed.x, height - seed.y),
    Math.hypot(width - seed.x, height - seed.y),
  );
  const salt = Math.random() * 1000;
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++) {
      const distance = Math.hypot((x + 0.5) * size - seed.x, (y + 0.5) * size - seed.y) / reach;
      let t =
        distance * 0.62 + noise(x >> 2, y >> 2, salt) * 0.26 + noise(x >> 1, y, salt + 7) * 0.12;
      if (noise(x, y, salt + 13) < 0.035) t *= 0.35;
      at[y * cols + x] = t * spreadMs;
    }
  return at;
}

export function Corruption({
  mode,
  seed,
  durationMs = 0,
}: {
  mode: CorruptionMode;
  seed: Seed;
  durationMs?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    let cols = 0,
      rows = 0,
      at = new Float64Array(0),
      flashes: Flash[] = [],
      frame = 0,
      start = performance.now(),
      vx = 0,
      vy = 0;
    const back = (x: number, y: number): [number, number] => [
      vx + (x - vx) * (1 - depth),
      vy + (y - vy) * (1 - depth),
    ];

    function draw(now: number) {
      if (!canvas || !context) return;
      const t = now - start;
      const present = (index: number) => {
        const born = at[index] ?? 0;
        if (mode === 'spread') return born <= t;
        if (mode === 'retreat') return t < durationMs - born;
        return true;
      };
      const done = (x: number, y: number) =>
        x < 0 || y < 0 || x >= cols || y >= rows || present(y * cols + x);
      context.clearRect(0, 0, canvas.width, canvas.height);
      const sides: Side[] = [];
      for (let y = 0; y < rows; y++)
        for (let x = 0; x < cols; x++) {
          if (!present(y * cols + x)) continue;
          const px = x * size,
            py = y * size;
          if (!done(x, y - 1)) sides.push([px, py, px + size, py]);
          if (!done(x + 1, y)) sides.push([px + size, py, px + size, py + size]);
          if (!done(x, y + 1)) sides.push([px, py + size, px + size, py + size]);
          if (!done(x - 1, y)) sides.push([px, py, px, py + size]);
        }

      const ends = new Map<string, number>();
      const end = (x: number, y: number, flat: boolean) => `${x},${y},${flat}`;
      for (const [x1, y1, x2, y2] of sides)
        for (const key of [end(x1, y1, y1 === y2), end(x2, y2, y1 === y2)])
          ends.set(key, (ends.get(key) ?? 0) + 1);
      const corner = (x: number, y: number, flat: boolean) => ends.get(end(x, y, flat)) === 1;
      const ridges = new Path2D();
      for (const [x1, y1, x2, y2] of sides) {
        const [bx1, by1] = back(x1, y1),
          [bx2, by2] = back(x2, y2);
        context.beginPath();
        context.moveTo(x1, y1);
        context.lineTo(x2, y2);
        context.lineTo(bx2, by2);
        context.lineTo(bx1, by1);
        context.closePath();
        context.fillStyle = y1 === y2 ? '#1c0606' : '#100303';
        context.fill();
        ridges.moveTo(bx1, by1);
        ridges.lineTo(bx2, by2);
        if (corner(x1, y1, y1 === y2)) {
          ridges.moveTo(x1, y1);
          ridges.lineTo(bx1, by1);
        }
        if (corner(x2, y2, y1 === y2)) {
          ridges.moveTo(x2, y2);
          ridges.lineTo(bx2, by2);
        }
      }
      context.strokeStyle = 'rgba(255, 40, 40, 0.45)';
      context.lineWidth = 1;
      context.stroke(ridges);

      context.fillStyle = '#050505';
      context.strokeStyle = 'rgba(255, 40, 40, 0.07)';
      for (let y = 0; y < rows; y++)
        for (let x = 0; x < cols; x++) {
          if (!present(y * cols + x)) continue;
          context.fillRect(x * size, y * size, size, size);
          context.strokeRect(x * size + 0.5, y * size + 0.5, size - 1, size - 1);
        }

      if (mode === 'hold') {
        flashes = flashes.filter((flash) => now - flash.at < flashMs);
        if (Math.random() < 0.08)
          flashes.push({
            x: Math.floor(Math.random() * cols),
            y: Math.floor(Math.random() * rows),
            w: 1 + Math.floor(Math.random() * 3),
            h: 1 + Math.floor(Math.random() * 3),
            at: now,
          });
        for (const flash of flashes) {
          const alpha = 1 - (now - flash.at) / flashMs;
          const left = flash.x * size,
            top = flash.y * size,
            right = left + flash.w * size,
            bottom = top + flash.h * size;
          const corners: [number, number][] = [
            [left, top],
            [right, top],
            [right, bottom],
            [left, bottom],
          ];
          const cube = new Path2D(),
            face = new Path2D();
          corners.forEach(([x, y], index) => {
            const [bx, by] = back(x, y);
            if (index === 0) cube.moveTo(bx, by);
            else cube.lineTo(bx, by);
          });
          cube.closePath();
          for (const [x, y] of corners) {
            cube.moveTo(x, y);
            cube.lineTo(...back(x, y));
          }
          face.rect(left, top, right - left, bottom - top);
          context.strokeStyle = `rgba(255, 40, 40, ${0.45 * alpha})`;
          context.lineWidth = 1;
          context.stroke(cube);
          neon(context, face, 0.8 * alpha);
        }
      }

      const edges = new Path2D();
      for (const [x1, y1, x2, y2] of sides) {
        edges.moveTo(x1, y1);
        edges.lineTo(x2, y2);
      }
      neon(context, edges, 1);
    }

    function resize() {
      if (!canvas || !context) return;
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.round(window.innerWidth * ratio);
      canvas.height = Math.round(window.innerHeight * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      vx = window.innerWidth / 2;
      vy = window.innerHeight / 2;
      cols = Math.ceil(window.innerWidth / size);
      rows = Math.ceil(window.innerHeight / size);
      at = schedule(cols, rows, seed, durationMs);
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
  }, [mode, seed, durationMs]);
  return <canvas className="corruption" ref={canvasRef} aria-hidden="true" />;
}
