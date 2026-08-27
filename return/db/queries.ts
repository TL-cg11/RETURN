import type { Authority, CollectionObject, Consent, EvidenceRecord, TimelineEvent, Visibility } from '@/lib/domain/types';
import { ensureDatabase } from './setup';

export type SubmissionRow = {
  id: string; museum_id: string; object_id: string; kind: string; title: string;
  description: string; source: string; consent: string; requested_outcome: string;
  contributor_name: string | null; contributor_role: string | null; evidence_refs: string;
  status: string; created_at: number; updated_at: number;
};
export type ActivityRow = {
  id: string; actor: string; action: string; detail: string; created_at: number;
  actor_role: string; actor_type: string; tool: string; target: string;
  risk: string; policy_decision: string; result: string;
};
export type ApprovalRow = {
  id: string; object_id: string; risk: string; snapshot: string; tool: string; args_snapshot: string; snapshot_hash: string;
  object_version: number; justification: string; refs_authority: string; refs_consent: string;
  status: string; resolution: string | null; verdict: string | null; edited_body: string | null; edit_reason: string | null;
  created_at: number; expires_at: number; resolved_at: number | null;
};

export type ActivityMetadata = {
  actorRole?: 'community' | 'curator' | 'curator_ui' | 'system';
  actorType?: 'agent' | 'human' | 'system';
  tool?: string;
  target?: string;
  risk?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  policyDecision?: 'applied' | 'pending_approval' | 'denied' | 'invalid';
  result?: string;
};

type ObjectRow = {
  id: string; accession_number: string; title: string; description: string; period: string; material: string;
  origin: string; acquisition_date: string | null; provenance_gap: string | null; record_status: string;
  display_tone: string; visibility: string; provenance_completeness: number; version: number;
  questions: string; current_label: string | null;
};

type EvidenceRow = {
  id: string; object_id: string; type: string; title: string; body: string; source_name: string;
  source_relationship: string; date_or_period: string; place: string; authority: string; consent: string;
  visibility: string; submitted_by: string; verified_by: string | null; verified_at: number | null;
};

type ProvenanceRow = {
  id: string; start_date: string; end_date: string | null; title: string; detail: string;
  status: string; authority: string; evidence_refs: string; is_gap: number;
};

export type ObjectAccess = 'public' | 'agent' | 'curator';
export type EvidenceAccess = 'public' | 'agent' | 'curator';

export const SUBMISSION_STATUSES = ['received', 'needs information', 'under review', 'reflected in label', 'closed'] as const;

function parseArray(value: string) {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function mapObject(row: ObjectRow): CollectionObject {
  return {
    id: row.id, accession: row.accession_number, title: row.title, description: row.description,
    date: row.period, material: row.material, region: row.origin, acquisitionDate: row.acquisition_date,
    gap: row.provenance_gap, status: row.record_status, tone: row.display_tone,
    visibility: row.visibility as Visibility, provenanceCompleteness: row.provenance_completeness,
    version: row.version, questions: parseArray(row.questions), label: row.current_label ?? '',
  };
}

function objectVisibility(access: ObjectAccess) {
  if (access === 'public') return "o.visibility='public'";
  if (access === 'agent') return "o.visibility<>'sealed'";
  return '1=1';
}

const OBJECT_SELECT = `SELECT o.id,o.accession_number,o.title,o.description,o.period,o.material,o.origin,
  o.acquisition_date,o.provenance_gap,o.record_status,o.display_tone,o.visibility,
  o.provenance_completeness,o.version,o.questions,lp.body AS current_label
  FROM objects o LEFT JOIN label_publications lp
  ON lp.museum_id=o.museum_id AND lp.id=o.current_label_id`;

export async function listObjects(museumId: string, access: ObjectAccess = 'public') {
  const db = await ensureDatabase(museumId);
  const result = await db.prepare(`${OBJECT_SELECT} WHERE o.museum_id=? AND ${objectVisibility(access)} ORDER BY o.accession_number`)
    .bind(museumId).all<ObjectRow>();
  return (result.results ?? []).map(mapObject);
}

export async function searchObjects(museumId: string, query = '', access: ObjectAccess = 'public') {
  const db = await ensureDatabase(museumId);
  const trimmed = query.trim().toLowerCase();
  const searchable = "lower(o.title || ' ' || o.material || ' ' || o.origin || ' ' || o.period || ' ' || o.record_status || ' ' || coalesce(o.provenance_gap,'')) LIKE ?";
  const sql = `${OBJECT_SELECT} WHERE o.museum_id=? AND ${objectVisibility(access)}${trimmed ? ` AND ${searchable}` : ''} ORDER BY o.accession_number`;
  const values = trimmed ? [museumId, `%${trimmed}%`] : [museumId];
  const result = await db.prepare(sql).bind(...values).all<ObjectRow>();
  return (result.results ?? []).map(mapObject);
}

export async function getObject(museumId: string, id: string, access: ObjectAccess = 'public') {
  const db = await ensureDatabase(museumId);
  const row = await db.prepare(`${OBJECT_SELECT} WHERE o.museum_id=? AND o.id=? AND ${objectVisibility(access)} LIMIT 1`)
    .bind(museumId, id).first<ObjectRow>();
  return row ? mapObject(row) : null;
}

export async function listProvenanceEvents(museumId: string, objectId: string, access: EvidenceAccess = 'public') {
  const db = await ensureDatabase(museumId);
  const result = await db.prepare('SELECT id,start_date,end_date,title,detail,status,authority,evidence_refs,is_gap FROM provenance_events WHERE museum_id=? AND object_id=? ORDER BY sort_order')
    .bind(museumId, objectId).all<ProvenanceRow>();
  const events = (result.results ?? []).map((row): TimelineEvent => ({
    id: row.id, year: row.end_date ? `${row.start_date}–${row.end_date}` : row.start_date,
    title: row.title, detail: row.detail, status: row.status as TimelineEvent['status'],
    authority: row.authority as Authority, evidenceRefs: parseArray(row.evidence_refs),
    ...(row.is_gap ? { gap: true } : {}),
  }));
  if (access === 'curator') return events;
  // Fail closed: only surface evidence refs the caller may see at this access level, so a
  // restricted/sealed evidence id linked to an event never leaks through public/agent timelines.
  const refs = [...new Set(events.flatMap((event) => event.evidenceRefs))];
  if (!refs.length) return events;
  const placeholders = refs.map(() => '?').join(',');
  const visible = await db.prepare(`SELECT id FROM evidence WHERE museum_id=? AND id IN (${placeholders}) AND ${evidenceVisibility(access)}`)
    .bind(museumId, ...refs).all<{ id: string }>();
  const allowed = new Set((visible.results ?? []).map((row) => row.id));
  return events.map((event) => ({ ...event, evidenceRefs: event.evidenceRefs.filter((id) => allowed.has(id)) }));
}

function evidenceVisibility(access: EvidenceAccess) {
  if (access === 'public') return "visibility='public' AND consent IN ('public_anonymous','public_attributed')";
  if (access === 'agent') return "visibility<>'sealed'";
  return '1=1';
}

function mapEvidence(row: EvidenceRow, access: EvidenceAccess): EvidenceRecord {
  const withheld = access !== 'curator' && (row.visibility !== 'public' || row.consent === 'private' || row.consent === 'research_only');
  const anonymous = access !== 'curator' && row.consent === 'public_anonymous';
  return {
    id: row.id, objectId: row.object_id, type: row.type, title: row.title,
    body: withheld ? null : row.body,
    sourceName: withheld ? 'Withheld' : anonymous ? 'Anonymous contributor' : row.source_name,
    sourceRelationship: row.source_relationship,
    date: row.date_or_period, place: row.place, detail: withheld ? 'Withheld by consent or visibility policy' : row.body,
    authority: row.authority as Authority, consent: row.consent as Consent, visibility: row.visibility as Visibility,
    submittedBy: withheld ? 'Withheld' : anonymous ? 'Anonymous contributor' : row.submitted_by,
    verifiedBy: row.verified_by, verifiedAt: row.verified_at,
  };
}

export async function listEvidence(museumId: string, objectId: string, access: EvidenceAccess = 'public') {
  const db = await ensureDatabase(museumId);
  const result = await db.prepare(`SELECT id,object_id,type,title,body,source_name,source_relationship,date_or_period,place,authority,consent,visibility,submitted_by,verified_by,verified_at FROM evidence WHERE museum_id=? AND object_id=? AND ${evidenceVisibility(access)} ORDER BY date_or_period`)
    .bind(museumId, objectId).all<EvidenceRow>();
  return (result.results ?? []).map((row) => mapEvidence(row, access));
}

export async function getEvidenceByIds(museumId: string, ids: string[], access: EvidenceAccess = 'agent') {
  if (!ids.length) return [];
  const db = await ensureDatabase(museumId);
  const placeholders = ids.map(() => '?').join(',');
  const result = await db.prepare(`SELECT id,object_id,type,title,body,source_name,source_relationship,date_or_period,place,authority,consent,visibility,submitted_by,verified_by,verified_at FROM evidence WHERE museum_id=? AND id IN (${placeholders}) AND ${evidenceVisibility(access)}`)
    .bind(museumId, ...ids).all<EvidenceRow>();
  return (result.results ?? []).map((row) => mapEvidence(row, access));
}

export async function listSubmissions(museumId: string, filter: { status?: string; objectId?: string } = {}) {
  const db = await ensureDatabase(museumId);
  const where = ['museum_id=?'];
  const values: unknown[] = [museumId];
  if (filter.status) { where.push('status=?'); values.push(filter.status); }
  if (filter.objectId) { where.push('object_id=?'); values.push(filter.objectId); }
  const result = await db.prepare(`SELECT * FROM submissions WHERE ${where.join(' AND ')} ORDER BY created_at DESC`).bind(...values).all<SubmissionRow>();
  return result.results ?? [];
}

export async function getSubmission(museumId: string, id: string) {
  const db = await ensureDatabase(museumId);
  return db.prepare('SELECT * FROM submissions WHERE museum_id=? AND id=?').bind(museumId, id).first<SubmissionRow>();
}

export async function setSubmissionStatus(museumId: string, id: string, status: string) {
  const db = await ensureDatabase(museumId);
  const result = await db.prepare('UPDATE submissions SET status=?, updated_at=? WHERE museum_id=? AND id=?').bind(status, Date.now(), museumId, id).run();
  return (result.meta?.changes ?? 0) > 0;
}

export async function countByStatus(museumId: string) {
  const rows = await listSubmissions(museumId);
  const counts: Record<string, number> = { all: rows.length };
  for (const status of SUBMISSION_STATUSES) counts[status] = rows.filter((row) => row.status === status).length;
  return counts;
}

export async function listActivity(museumId: string, limit = 20) {
  const db = await ensureDatabase(museumId);
  const result = await db.prepare('SELECT id,actor,action,detail,created_at,actor_role,actor_type,tool,target,risk,policy_decision,result FROM activity WHERE museum_id=? ORDER BY created_at DESC LIMIT ?').bind(museumId, limit).all<ActivityRow>();
  return result.results ?? [];
}

function actorDefaults(actor: string): Required<Pick<ActivityMetadata, 'actorRole' | 'actorType'>> {
  if (actor === 'Community Agent') return { actorRole: 'community', actorType: 'agent' };
  if (actor === 'Curator Agent') return { actorRole: 'curator', actorType: 'agent' };
  if (actor.includes('Curator')) return { actorRole: 'curator_ui', actorType: 'human' };
  return { actorRole: 'system', actorType: 'system' };
}

export async function recordActivity(museumId: string, actor: string, action: string, detail: string, metadata: ActivityMetadata = {}) {
  const db = await ensureDatabase(museumId);
  const defaults = actorDefaults(actor);
  await db.prepare('INSERT INTO activity (id,museum_id,actor,action,detail,created_at,actor_role,actor_type,tool,target,risk,policy_decision,result) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .bind(crypto.randomUUID(), museumId, actor, action, detail, Date.now(), metadata.actorRole ?? defaults.actorRole,
      metadata.actorType ?? defaults.actorType, metadata.tool ?? 'system', metadata.target ?? '', metadata.risk ?? 'LOW',
      metadata.policyDecision ?? 'applied', metadata.result ?? 'recorded').run();
}

export async function listApprovals(museumId: string, status?: string) {
  const db = await ensureDatabase(museumId);
  await db.prepare("UPDATE approvals SET status='expired', resolution='expired', verdict='expired', resolved_at=expires_at WHERE museum_id=? AND status='pending' AND expires_at<=?")
    .bind(museumId, Date.now()).run();
  const sql = status
    ? 'SELECT * FROM approvals WHERE museum_id=? AND status=? ORDER BY created_at DESC'
    : 'SELECT * FROM approvals WHERE museum_id=? ORDER BY created_at DESC';
  const values = status ? [museumId, status] : [museumId];
  const result = await db.prepare(sql).bind(...values).all<ApprovalRow>();
  return result.results ?? [];
}

export async function getApproval(museumId: string, id: string) {
  const db = await ensureDatabase(museumId);
  await db.prepare("UPDATE approvals SET status='expired', resolution='expired', verdict='expired', resolved_at=expires_at WHERE museum_id=? AND id=? AND status='pending' AND expires_at<=?")
    .bind(museumId, id, Date.now()).run();
  return db.prepare('SELECT * FROM approvals WHERE museum_id=? AND id=?').bind(museumId, id).first<ApprovalRow>();
}

/** Counts behind the curator dashboard and get_collection_summary. */
export async function workspaceSummary(museumId: string) {
  const [objects, submissions, approvals] = await Promise.all([
    listObjects(museumId, 'curator'), listSubmissions(museumId), listApprovals(museumId, 'pending'),
  ]);
  return {
    objects: objects.length,
    open_gaps: objects.filter((object) => object.gap).length,
    new_submissions: submissions.filter((row) => row.status === 'received').length,
    total_submissions: submissions.length,
    pending_approvals: approvals.length,
    consent_alerts: submissions.filter((row) => row.consent === 'research_only' || row.consent === 'private').length,
  };
}
