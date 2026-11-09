import { staleSources } from './data';
import type { Health } from './data';
import { dateText } from './ticker/format';

export function Stale({ health }: { health: Health }) {
  return staleSources(health).map(({ label, since }) => (
    <span className="stale" role="status" key={label ?? 'all'}>
      {label ? `${label} not updated` : 'Not updated'}
      {since && ` since ${dateText(since)}`}
    </span>
  ));
}
