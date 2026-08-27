import { collection, moonbird, officialEvidence, type Authority } from './demo-data';

export type TimelineEvent = { year: string; title: string; detail: string; authority: Authority; gap?: boolean };
export type ObjectRecord = (typeof collection)[number] & {
  version: number; label: string; questions: string[]; timeline: TimelineEvent[];
};

export function findObject(id: string) {
  return collection.find((item) => item.id === id) ?? null;
}

/**
 * The public record for one object. The Moonbird Mask is the fully documented
 * demo record; the rest are derived from their catalogue fields so every object
 * in the collection has a readable record rather than a dead route.
 */
export function objectRecord(id: string): ObjectRecord | null {
  const item = findObject(id);
  if (!item) return null;
  if (item.id === moonbird.id) return moonbird as ObjectRecord;

  const [gapStart, gapEnd] = (item.gap ?? '').split('–');
  const timeline: TimelineEvent[] = [
    { year: item.date, title: 'Object made', detail: `Catalogued as ${item.material.toLowerCase()}.`, authority: 'verified' },
    ...(item.gap ? [{ year: item.gap, title: 'Movement unknown', detail: `No verified custody record covers ${gapStart} to ${gapEnd}.`, authority: 'submitted' as Authority, gap: true }] : []),
    { year: item.accession.split('.')[1], title: 'Museum acquisition', detail: `Entered the collection as ${item.accession}.`, authority: 'verified' },
    { year: '2026', title: item.gap ? 'Joint research opened' : 'Record reviewed', detail: item.gap ? 'Community and curatorial review is in progress.' : 'The documented chain of custody is complete.', authority: 'verified' },
  ];

  return {
    ...item,
    version: 1,
    label: `${item.title}, ${item.date}. ${item.material}. Recorded region: ${item.region}.${item.gap ? ` Custody between ${item.gap} is not documented in the official record.` : ' The documented chain of custody is complete.'}`,
    questions: item.gap
      ? [`Who held ${item.title} between ${item.gap}?`, `Which communities used ${item.title}, and how should the record describe that use?`]
      : [`Is the recorded region for ${item.title} the name its community uses?`],
    timeline,
  };
}

/** Verified and submitted evidence attached to an object. Only the demo record carries a source pair. */
export function evidenceFor(objectId: string) {
  return objectId === moonbird.id ? officialEvidence : [];
}

export function searchCollection(query = '') {
  const q = query.trim().toLowerCase();
  if (!q) return collection;
  return collection.filter((item) =>
    [item.title, item.material, item.region, item.date, item.status, item.gap ?? ''].join(' ').toLowerCase().includes(q));
}
