import { recordActivity } from '@/db/queries';
import { ensureDatabase } from '@/db/setup';
import { evaluatePolicy } from '@/lib/policy/evaluate';
import { findObject } from '@/lib/records';
import { sessionFromRequest } from '@/lib/session';

export async function POST(request: Request) {
  const { role, museumId } = sessionFromRequest(request);
  if (role === 'curator') return Response.json({ error: 'Community role required' }, { status: 403 });

  const body = await request.json() as Record<string, string>;
  const requestedObject = body.objectId ? await findObject(museumId, body.objectId) : null;
  const fallbackObject = requestedObject ?? await findObject(museumId, 'moonbird-mask');
  if (!fallbackObject) return Response.json({ error: 'No public object is available' }, { status: 404 });
  const objectId = fallbackObject.id;
  const title = (body.title ?? '').trim();
  if (!title) return Response.json({ outcome: 'invalid', field: 'title', reason: 'A contribution needs a short title.', recovery: 'Add a title describing the material.' }, { status: 400 });

  const policy = evaluatePolicy({ actor: 'community', action: 'submit_evidence', museumMatch: true });
  const id = `SUB-${Math.floor(1100 + Math.random() * 8000)}`;
  try {
    const db = await ensureDatabase(museumId);
    const now = Date.now();
    await db.prepare('INSERT INTO submissions (id,museum_id,object_id,kind,title,description,source,consent,requested_outcome,contributor_name,contributor_role,evidence_refs,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .bind(id, museumId, objectId, body.kind ?? 'Evidence', title, body.description ?? '', body.source ?? '', body.consent ?? 'research_only', body.requestedOutcome ?? 'Add context', body.source ?? '', 'community', '[]', 'received', now, now).run();
    await recordActivity(museumId, 'Community Agent', 'submitted new evidence', title, {
      tool: 'submit_evidence', target: id, risk: 'MEDIUM', policyDecision: 'applied', result: id,
    });
  } catch {
    return Response.json({ id, ...policy, object_id: objectId, persisted: false });
  }
  return Response.json({ id, ...policy, object_id: objectId, persisted: true });
}
