import type { EvidenceRecord } from '@/lib/domain/types';

export type MatrixSource = {
  id: string;
  label: string;
  authority: 'submitted' | 'verified';
  consent: string;
  date: string;
  place: string;
  origin: string;
  note: string;
};

export function sourceFromEvidence(item: EvidenceRecord): MatrixSource {
  return {
    id: item.id, label: item.title, authority: item.authority, consent: item.consent,
    date: item.date || '—', place: item.place || '—',
    origin: item.sourceName || '—', note: item.detail || item.sourceRelationship || '—',
  };
}

/** Rows where two sources can genuinely contradict each other about the object. */
const CONTESTABLE = new Set(['Date', 'Place']);

const ROWS = [
  ['Authority', (source: MatrixSource) => source.authority],
  ['Date', (source: MatrixSource) => source.date],
  ['Place', (source: MatrixSource) => source.place],
  ['Source', (source: MatrixSource) => source.origin],
  ['Permission', (source: MatrixSource) => source.consent.replaceAll('_', ' ')],
  ['Note', (source: MatrixSource) => source.note],
] as const;

/**
 * FR-K3 — comparison once there are more than two sources.
 *
 * The two-source layout puts the records side by side with the unresolved period
 * between them, which is the point of the demo and is kept for two. It does not
 * survive a third: three or more columns of prose become unreadable at any width.
 *
 * So beyond two, the axis flips. Attributes become rows and sources become columns,
 * which is how a curator actually compares — reading one attribute across every
 * source rather than reading each source end to end. Disagreements land in a line.
 */
export function SourceMatrix({ sources, gap }: { sources: MatrixSource[]; gap: string | null }) {
  return (
    <div className="source-matrix">
      <div className="matrix-scroll">
        <table>
          <caption className="visually-hidden">Sources on this record compared attribute by attribute</caption>
          <thead>
            <tr>
              <th scope="col">Attribute</th>
              {sources.map((source) => (
                <th scope="col" key={source.id}>
                  <span className={source.authority === 'verified' ? 'verified-badge' : 'submitted-badge'}>{source.authority}</span>
                  <strong>{source.label}</strong>
                  <small>{source.id}</small>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROWS.map(([name, read]) => {
              const values = sources.map(read);
              // Only the rows where sources make competing claims about the object are
              // worth flagging. Authority, permission, and provenance of the source
              // itself differ by definition — marking those marks everything, which
              // marks nothing.
              const disagrees = CONTESTABLE.has(name)
                && new Set(values.filter((value) => value !== '—').map((value) => value.toLowerCase())).size > 1;
              return (
                <tr key={name} className={disagrees ? 'disagrees' : ''}>
                  <th scope="row">{name}{disagrees && <em title="The sources do not agree on this"> ≠</em>}</th>
                  {values.map((value, index) => <td key={sources[index].id}>{value}</td>)}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="matrix-note">
        {gap
          ? `Custody across ${gap} is undocumented. A row marked ≠ means the sources give different answers about the object, not that either is wrong.`
          : 'A row marked ≠ means the sources give different answers about the object, not that either is wrong.'}
      </p>
    </div>
  );
}
