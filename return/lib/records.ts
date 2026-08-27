import {
  getObject, listEvidence, listObjects, listProvenanceEvents, searchObjects,
  type EvidenceAccess, type ObjectAccess,
} from '@/db/queries';

export const findObject = getObject;
export const searchCollection = searchObjects;

export async function objectRecord(museumId: string, id: string, access: ObjectAccess = 'public') {
  const object = await getObject(museumId, id, access);
  if (!object) return null;
  const timeline = await listProvenanceEvents(museumId, id, access);
  return { ...object, timeline };
}

export function evidenceFor(museumId: string, objectId: string, access: EvidenceAccess = 'public') {
  return listEvidence(museumId, objectId, access);
}

export function collectionFor(museumId: string, access: ObjectAccess = 'public') {
  return listObjects(museumId, access);
}
