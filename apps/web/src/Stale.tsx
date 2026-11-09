import { staleSince } from './data';
import type { Health } from './data';
import { dateText } from './ticker/format';

export function Stale({ health }: { health: Health }) {
  const since = staleSince(health);
  return since ? (
    <span className="stale" role="status">
      Not updated since {dateText(since)}
    </span>
  ) : null;
}
