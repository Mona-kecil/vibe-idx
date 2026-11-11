import { useCallback, useEffect, useReducer, useRef, useSyncExternalStore } from 'react';

type BootState =
  | { phase: 'raining'; minimumElapsed: boolean; settled: boolean }
  | { phase: 'leaving' }
  | { phase: 'gone' };
type BootEvent =
  | { type: 'minimum' | 'settled' | 'motion'; reducedMotion: boolean }
  | { type: 'faded' };

function bootReducer(state: BootState, event: BootEvent): BootState {
  if (state.phase === 'gone') return state;
  if (event.type === 'faded') return state.phase === 'leaving' ? { phase: 'gone' } : state;
  if (state.phase === 'leaving') return event.reducedMotion ? { phase: 'gone' } : state;
  const minimumElapsed = state.minimumElapsed || event.type === 'minimum' || event.reducedMotion;
  const settled = state.settled || event.type === 'settled';
  return minimumElapsed && settled
    ? { phase: event.reducedMotion ? 'gone' : 'leaving' }
    : { phase: 'raining', minimumElapsed, settled };
}

const motionQuery = '(prefers-reduced-motion: reduce)';
function subscribeMotion(change: () => void) {
  const query = window.matchMedia(motionQuery);
  query.addEventListener('change', change);
  return () => query.removeEventListener('change', change);
}

export function useTerminalBoot() {
  const reducedMotion = useSyncExternalStore(
    subscribeMotion,
    () => window.matchMedia(motionQuery).matches,
    () => false,
  );
  const [state, dispatch] = useReducer(bootReducer, {
    phase: 'raining',
    minimumElapsed: false,
    settled: false,
  });
  useEffect(() => {
    dispatch({ type: 'motion', reducedMotion });
    if (reducedMotion) return;
    const timer = window.setTimeout(() => dispatch({ type: 'minimum', reducedMotion }), 1400);
    return () => window.clearTimeout(timer);
  }, [reducedMotion]);
  useEffect(() => {
    if (state.phase !== 'leaving') return;
    const timer = window.setTimeout(() => dispatch({ type: 'faded' }), 450);
    return () => window.clearTimeout(timer);
  }, [state.phase]);
  const settle = useCallback(() => dispatch({ type: 'settled', reducedMotion }), [reducedMotion]);
  return { phase: state.phase, reducedMotion, settle };
}

const tickers = [
  'BBCA',
  'BBRI',
  'BMRI',
  'BBNI',
  'TLKM',
  'ASII',
  'GOTO',
  'ANTM',
  'ADRO',
  'UNVR',
  'ICBP',
  'INDF',
  'PGAS',
  'PTBA',
  'MDKA',
  'AMMN',
];
const moves = ['+2.41%', '-0.85%', '+1.73%', '+0.62%', '-1.24%', '+3.08%', '-2.16%'];
const pick = (values: string[]) => values[Math.floor(Math.random() * values.length)] ?? '';
type Stream = {
  x: number;
  head: number;
  speed: number;
  length: number;
  text: string;
  phase: number;
  red: boolean;
};

export function BootRain({
  phase,
  reducedMotion,
}: {
  phase: 'raining' | 'leaving';
  reducedMotion: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    const rowHeight = 22;
    let width = 0,
      height = 0,
      streams: Stream[] = [],
      frame = 0,
      lastTime = 0;

    function draw(elapsed: number) {
      if (!context) return;
      context.shadowBlur = 0;
      context.fillStyle = `rgba(10, 12, 11, ${1 - Math.exp(-elapsed / 95)})`;
      context.fillRect(0, 0, width, height);
      for (const stream of streams) {
        stream.head += (stream.speed * elapsed) / 1000;
        if ((stream.head - stream.length) * rowHeight > height) {
          const move = pick(moves);
          stream.head = -Math.random() * 12;
          stream.text = `${pick(tickers)} ${move} `;
          stream.phase = Math.floor(Math.random() * stream.text.length);
          stream.red = move.startsWith('-') && Math.random() < 0.3;
        }
        const head = Math.floor(stream.head);
        for (let trail = stream.length; trail >= 0; trail--) {
          const row = head - trail;
          const y = row * rowHeight;
          if (y < 0 || y > height + rowHeight) continue;
          const glyph =
            stream.text[
              (((row + stream.phase) % stream.text.length) + stream.text.length) %
                stream.text.length
            ];
          const strength = 1 - trail / stream.length;
          context.fillStyle =
            trail === 0
              ? '#d6ffe6'
              : stream.red
                ? `rgba(228, 87, 63, ${strength * 0.65})`
                : `rgba(63, 214, 143, ${strength * 0.8})`;
          context.shadowColor = stream.red ? '#e4573f' : '#3fd68f';
          context.shadowBlur = trail < 2 ? 9 : 0;
          context.fillText(glyph ?? '', stream.x, y);
        }
      }
    }

    function resize() {
      if (!canvas || !context) return;
      width = window.innerWidth;
      height = window.innerHeight;
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.font = '14px "JetBrains Mono", ui-monospace, monospace';
      context.textAlign = 'center';
      context.fillStyle = '#0a0c0b';
      context.fillRect(0, 0, width, height);
      streams = Array.from({ length: Math.ceil(width / 28) }, (_, index) => {
        const move = pick(moves);
        const text = `${pick(tickers)} ${move} `;
        return {
          x: index * 28 + 14,
          head: (Math.random() * height) / rowHeight,
          speed: 10 + Math.random() * 15,
          length: 12 + Math.floor(Math.random() * 22),
          text,
          phase: Math.floor(Math.random() * text.length),
          red: move.startsWith('-') && Math.random() < 0.3,
        };
      });
      draw(0);
    }

    function animate(time: number) {
      draw(lastTime ? Math.min(time - lastTime, 50) : 16);
      lastTime = time;
      frame = window.requestAnimationFrame(animate);
    }
    resize();
    if (!reducedMotion) frame = window.requestAnimationFrame(animate);
    window.addEventListener('resize', resize);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', resize);
    };
  }, [reducedMotion]);

  return (
    <div className={`terminal-boot terminal-boot--${phase}`}>
      <canvas ref={canvasRef} aria-hidden="true" />
      <span className="terminal-boot-status" role="status">
        Loading terminal…
      </span>
    </div>
  );
}
