import { diffLabelText } from '@/lib/label-diff';

export function LabelRevisionDiff({
  before,
  after,
  revision,
  compact = false,
}: {
  before: string;
  after: string;
  revision: number;
  compact?: boolean;
}) {
  const segments = diffLabelText(before, after);
  const changed = segments.some((segment) => segment.type !== 'equal');
  if (!changed) return null;

  return (
    <section className={`public-label-change${compact ? ' compact' : ''}`} aria-labelledby={`label-change-r${revision}`}>
      <div>
        <p className="eyebrow">Official label revision</p>
        <h2 id={`label-change-r${revision}`}>What changed in revision {revision}.</h2>
        <p className="context-note">This is a curator-approved change to the official label. Submitted community material remains identified separately below.</p>
      </div>
      <div className="label-diff public" aria-label={`Label changes in revision ${revision}`}>
        <article>
          <h3>Before <span>Revision {revision - 1}</span></h3>
          <p>{segments.map((segment, index) => segment.type === 'added' ? null : segment.type === 'removed'
            ? <del key={index}>{segment.text}</del>
            : <span key={index}>{segment.text}</span>)}</p>
        </article>
        <article>
          <h3>After <span>Revision {revision}</span></h3>
          <p>{segments.map((segment, index) => segment.type === 'removed' ? null : segment.type === 'added'
            ? <ins key={index}>{segment.text}</ins>
            : <span key={index}>{segment.text}</span>)}</p>
        </article>
      </div>
    </section>
  );
}
