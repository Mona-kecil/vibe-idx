import { useEffect, useRef } from 'react';

const size = 40;
const flashMs = 700;
export type Seed = { x: number; y: number };
export type CorruptionMode = 'spread' | 'hold' | 'retreat' | 'still';
type Flash = { x: number; y: number; w: number; h: number; at: number };

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
      start = performance.now();

    function draw(now: number) {
      if (!canvas || !context) return;
      const t = now - start;
      const present = (index: number) => {
        const born = at[index] ?? 0;
        if (mode === 'spread') return born <= t;
        if (mode === 'retreat') return t < durationMs - born;
        return true;
      };
      context.clearRect(0, 0, canvas.width, canvas.height);
      const edges = new Path2D();
      const side = (x1: number, y1: number, x2: number, y2: number) => {
        edges.moveTo(x1, y1);
        edges.lineTo(x2, y2);
      };
      const done = (x: number, y: number) =>
        x < 0 || y < 0 || x >= cols || y >= rows || present(y * cols + x);
      context.fillStyle = '#050505';
      context.strokeStyle = 'rgba(255, 40, 40, 0.07)';
      context.lineWidth = 1;
      for (let y = 0; y < rows; y++)
        for (let x = 0; x < cols; x++) {
          if (!present(y * cols + x)) continue;
          const px = x * size,
            py = y * size;
          context.fillRect(px, py, size, size);
          context.strokeRect(px + 0.5, py + 0.5, size - 1, size - 1);
          if (!done(x, y - 1)) side(px, py, px + size, py);
          if (!done(x + 1, y)) side(px + size, py, px + size, py + size);
          if (!done(x, y + 1)) side(px, py + size, px + size, py + size);
          if (!done(x - 1, y)) side(px, py, px, py + size);
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
          const block = new Path2D();
          block.rect(flash.x * size, flash.y * size, flash.w * size, flash.h * size);
          neon(context, block, 0.8 * (1 - (now - flash.at) / flashMs));
        }
      }
      neon(context, edges, 1);
    }

    function resize() {
      if (!canvas || !context) return;
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.round(window.innerWidth * ratio);
      canvas.height = Math.round(window.innerHeight * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
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
