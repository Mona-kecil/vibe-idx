import { useCallback, useEffect, useReducer, useSyncExternalStore } from 'react';
import { Corruption } from '../Corruption';

type BootState =
  | { phase: 'holding'; minimumElapsed: boolean; settled: boolean }
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
    const timer = window.setTimeout(() => dispatch({ type: 'faded' }), 450);
    return () => window.clearTimeout(timer);
  }, [state.phase]);
  const settle = useCallback(() => dispatch({ type: 'settled', reducedMotion }), [reducedMotion]);
  return { phase: state.phase, reducedMotion, settle };
}

export function TerminalBoot({
  phase,
  reducedMotion,
}: {
  phase: 'holding' | 'leaving';
  reducedMotion: boolean;
}) {
  return (
    <div className={`terminal-boot terminal-boot--${phase}`}>
      <Corruption still={reducedMotion} />
      <span className="terminal-boot-status" role="status">
        Loading terminal…
      </span>
    </div>
  );
}
