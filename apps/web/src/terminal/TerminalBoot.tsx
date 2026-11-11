import { useCallback, useEffect, useReducer, useState, useSyncExternalStore } from 'react';
import { Corruption, type Seed } from '../Corruption';

const retreatMs = 450;

type BootState =
  | { phase: 'holding'; minimumElapsed: boolean; settled: boolean }
  | { phase: 'leaving' }
  | { phase: 'gone' };
type BootEvent =
  | { type: 'minimum' | 'settled' | 'motion'; reducedMotion: boolean }
  | { type: 'cleared' };

function bootReducer(state: BootState, event: BootEvent): BootState {
  if (state.phase === 'gone') return state;
  if (event.type === 'cleared') return state.phase === 'leaving' ? { phase: 'gone' } : state;
  if (state.phase === 'leaving') return event.reducedMotion ? { phase: 'gone' } : state;
  const minimumElapsed = state.minimumElapsed || event.type === 'minimum' || event.reducedMotion;
  const settled = state.settled || event.type === 'settled';
  return minimumElapsed && settled
    ? { phase: event.reducedMotion ? 'gone' : 'leaving' }
    : { phase: 'holding', minimumElapsed, settled };
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
    phase: 'holding',
    minimumElapsed: false,
    settled: false,
  });
  useEffect(() => {
    dispatch({ type: 'motion', reducedMotion });
    if (reducedMotion) return;
    const timer = window.setTimeout(() => dispatch({ type: 'minimum', reducedMotion }), 800);
    return () => window.clearTimeout(timer);
  }, [reducedMotion]);
  useEffect(() => {
    if (state.phase !== 'leaving') return;
    const timer = window.setTimeout(() => dispatch({ type: 'cleared' }), retreatMs);
    return () => window.clearTimeout(timer);
  }, [state.phase]);
  const settle = useCallback(() => dispatch({ type: 'settled', reducedMotion }), [reducedMotion]);
  return { phase: state.phase, reducedMotion, settle };
}

function arrivalSeed(): Seed {
  const state: unknown = window.history.state;
  const seed =
    state && typeof state === 'object' && 'voidSeed' in state ? state.voidSeed : undefined;
  if (
    seed &&
    typeof seed === 'object' &&
    'x' in seed &&
    'y' in seed &&
    typeof seed.x === 'number' &&
    typeof seed.y === 'number'
  )
    return { x: seed.x, y: seed.y };
  return { x: window.innerWidth / 2, y: 0 };
}

export function TerminalBoot({
  phase,
  reducedMotion,
}: {
  phase: 'holding' | 'leaving';
  reducedMotion: boolean;
}) {
  const [seed] = useState(arrivalSeed);
  return (
    <div className={`terminal-boot terminal-boot--${phase}`}>
      <Corruption
        mode={reducedMotion ? 'still' : phase === 'leaving' ? 'retreat' : 'hold'}
        seed={seed}
        durationMs={retreatMs}
      />
      <span className="terminal-boot-status" role="status">
        Loading terminal…
      </span>
    </div>
  );
}
