import type { SimSnapshot } from '../hooks/useSimulation';
import { buildTeachingNarrative, explainCdiLeftRight } from '../teaching';

type Props = {
  snapshot: SimSnapshot;
};

export function TeachingPanel({ snapshot }: Props) {
  const lines = buildTeachingNarrative(snapshot);
  const shortTips = lines.slice(0, 2);

  return (
    <aside className="card teaching teaching-compact" aria-live="polite">
      <h3>Hints</h3>
      <p className="cdi-line">{explainCdiLeftRight(snapshot)}</p>
      <ul className="teach-list">
        {shortTips.map((line, i) => (
          <li key={i} dangerouslySetInnerHTML={{ __html: formatLine(line) }} />
        ))}
      </ul>
    </aside>
  );
}

function formatLine(s: string): string {
  return s.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
}
