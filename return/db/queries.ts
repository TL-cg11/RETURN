import type { Authority, CollectionObject, Consent, EvidenceRecord, LabelAssertion, TimelineEvent, Visibility } from '@/lib/domain/types';
import { ensureDatabase } from './setup';

export type SubmissionRow = {
  id: string; museum_id: string; object_id: string; kind: string; title: string;
  description: string; source: string; consent: string; requested_outcome: string;
  contributor_name: string | null; contributor_role: string | null; evidence_refs: string;
  status: string; details: string; asset_ids: string; clarifications: string; created_at: number; updated_at: number;
};
export type ActivityRow = {
  id: string; actor: string; action: string; detail: string; created_at: number;
  actor_role: string; actor_type: string; tool: string; target: string;
  risk: string; policy_decision: string; result: string;
};
export type ApprovalRow = {
  id: string; museum_id: string; object_id: string; risk: string; snapshot: string; tool: string; args_snapshot: string; snapshot_hash: string;
  object_version: number; justification: string; refs_authority: string; refs_consent: string;
  status: string; resolution: string | null; verdict: string | null; edited_body: string | null; edit_reason: string | null;
  created_at: number; expires_at: number; resolved_at: number | null;
};

export type LabelPublicationRow = {
  id: string; museum_id: string; object_id: string; title: string; body: string;
  assertions: string; evidence_refs: string; revision_number: number; approved_by: string;
  published_at: number; superseded_at: number | null;
};

export type EscalationRow = {
  id: string; museum_id: string; object_id: string | null; tool: string; args: string; policy: string;
  source_refs: string; status: string; created_at: number; resolved_at: number | null;
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
  questions: string; current_label: string | null; label_revision: number | null;
  label_assertions: string | null; label_published_at: number | null;
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

/** Assertions are stored as JSON on the publication row. Unreadable rows read as none. */
function parseAssertions(value: string | null): LabelAssertion[] {
  try {
    const parsed: unknown = JSON.parse(value ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry) => {
      const item = entry as Partial<LabelAssertion>;
      return item && typeof item.mode === 'string'
        ? [{ mode: item.mode as LabelAssertion['mode'], text: String(item.text ?? ''), refs: Array.isArray(item.refs) ? item.refs.map(String) : [] }]
        : [];
    });
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
    labelRevision: row.label_revision ?? row.version, labelAssertions: parseAssertions(row.label_assertions),
    labelPublishedAt: row.label_published_at,
  };
}

function objectVisibility(access: ObjectAccess) {
  if (access === 'public') return "o.visibility='public'";
  if (access === 'agent') return "o.visibility<>'sealed'";
  return '1=1';
}

const OBJECT_SELECT = `SELECT o.id,o.accession_number,o.title,o.description,o.period,o.material,o.origin,
  o.acquisition_date,o.provenance_gap,o.record_status,o.display_tone,o.visibility,
  o.provenance_completeness,o.version,o.questions,lp.body AS current_label,
  lp.revision_number AS label_revision,lp.assertions AS label_assertions,lp.published_at AS label_published_at
  FROM objects o LEFT JOIN label_publications lp
  ON lp.museum_id=o.museum_id AND lp.id=o.current_label_id`;

export async function listObjects(museumId: string, access: ObjectAccess = 'public') {
  const db = await ensureDatabase(museumId);
  const result = await db.prepare(`${OBJECT_SELECT} WHERE o.museum_id=? AND ${objectVisibility(access)} ORDER BY o.accession_number`)
    .bind(museumId).all<ObjectRow>();
  return (result.results ?? []).map(mapObject);
}

/**
 * Search the collection.
 *
 * The match runs in JavaScript rather than in SQL, which is the opposite of how this
 * file treats every other filter — and deliberately so. D1 caps the length of a `LIKE`
 * pattern far below SQLite's own limit, so `LIKE '%' || query || '%'` threw for any
 * query of about fifty characters and the tool answered with a bare 500 (EA-1). It is
 * the same defect FR2-X1 removed from the approval query; this was the last `LIKE` left.
 *
 * Moving the match out of SQL is safe here because **search is not a safety filter**.
 * Visibility still runs in SQL, so this can only ever narrow a set the database already
 * judged the caller may see; a bug in the matching below can hide a record from a search,
 * never reveal one. A collection is small and already bounded per workspace.
 */
export async function searchObjects(museumId: string, query = '', access: ObjectAccess = 'public') {
  const db = await ensureDatabase(museumId);
  const result = await db.prepare(`${OBJECT_SELECT} WHERE o.museum_id=? AND ${objectVisibility(access)} ORDER BY o.accession_number`)
    .bind(museumId).all<ObjectRow>();
  const rows = (result.results ?? []).map(mapObject);
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return rows;
  const haystack = (row: ReturnType<typeof mapObject>) =>
    [row.title, row.material, row.region, row.date, row.status, row.gap ?? ''].join(' ').toLowerCase();
  return rows.filter((row) => haystack(row).includes(trimmed));
}

/**
 * The record already using an accession number, if any.
 *
 * `createObject` has always refused a clash, and the registration form asks first. The
 * agent tool did not, so a proposal carrying a taken accession reached the curator queue
 * and failed only when a human tried to act on it (EA-3).
 */
export async function objectWithAccession(museumId: string, accession: string) {
  const db = await ensureDatabase(museumId);
  return db.prepare('SELECT id,title FROM objects WHERE museum_id=? AND accession_number=? LIMIT 1')
    .bind(museumId, accession).first<{ id: string; title: string }>();
}

export async function getObject(museumId: string, id: string, access: ObjectAccess = 'public') {
  const db = await ensureDatabase(museumId);
  const row = await db.prepare(`${OBJECT_SELECT} WHERE o.museum_id=? AND o.id=? AND ${objectVisibility(access)} LIMIT 1`)
    .bind(museumId, id).first<ObjectRow>();
  return row ? mapObject(row) : null;
}

/** Official publication history for the public revision comparison. */
export async function listLabelPublications(museumId: string, objectId: string) {
  const db = await ensureDatabase(museumId);
  const result = await db.prepare('SELECT * FROM label_publications WHERE museum_id=? AND object_id=? ORDER BY revision_number DESC')
    .bind(museumId, objectId).all<LabelPublicationRow>();
  return result.results ?? [];
}

/** Evidence ids explicitly attached to a contribution, including legacy audit links. */
export async function listSubmissionEvidenceIds(museumId: string, submissionId: string) {
  const db = await ensureDatabase(museumId);
  const submission = await getSubmission(museumId, submissionId);
  if (!submission) return [];
  // Seeded contributions carry a per-workspace suffix (`SUB-1042-${museumId}`) while the
  // seeded activity row holds the bare id. That is an exact string relation, so it is
  // written as one. It used to be a LIKE pattern built from the `result` column, which
  // D1 rejects outright once the pattern grows past its limit — and it always does on a
  // workspace whose id is a UUID, which is every workspace except the original demo one.
  const activity = await db.prepare("SELECT target FROM activity WHERE museum_id=? AND (result=? OR ?=result || '-' || ?) AND target<>''")
    .bind(museumId, submissionId, submissionId, museumId).all<{ target: string }>();
  return [...new Set([...parseArray(submission.evidence_refs), ...(activity.results ?? []).map((row) => row.target)])];
}

/** The exact published revision that cites evidence connected to one contribution. */
export async function getSubmissionPublicationOutcome(museumId: string, submissionId: string) {
  const submission = await getSubmission(museumId, submissionId);
  if (!submission) return null;
  const [evidenceIds, publications] = await Promise.all([
    listSubmissionEvidenceIds(museumId, submissionId),
    listLabelPublications(museumId, submission.object_id),
  ]);
  const linked = new Set(evidenceIds);
  const publication = publications.find((item) => parseArray(item.evidence_refs).some((id) => linked.has(id)));
  if (!publication) return null;
  return {
    publication,
    previous: publications.find((item) => item.revision_number === publication.revision_number - 1) ?? null,
  };
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
  const withheld = access !== 'curator' && (row.visibility !== 'public' || row.consent === 'private');
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

/**
 * Contributions in a workspace, newest first.
 *
 * Bounded, because every caller of this reads whole rows: the console counted them by
 * fetching them, and one contribution with a very long title made the inbox a megabyte
 * (F6-7). The ceiling is far above any real review queue and finite, which is the
 * property that matters.
 */
export const MAX_SUBMISSION_ROWS = 500;

export async function listSubmissions(museumId: string, filter: { status?: string; objectId?: string } = {}) {
  const db = await ensureDatabase(museumId);
  const where = ['museum_id=?'];
  const values: unknown[] = [museumId];
  if (filter.status) { where.push('status=?'); values.push(filter.status); }
  if (filter.objectId) { where.push('object_id=?'); values.push(filter.objectId); }
  const result = await db.prepare(`SELECT * FROM submissions WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT ${MAX_SUBMISSION_ROWS}`).bind(...values).all<SubmissionRow>();
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

/**
 * How many contributions sit in each status.
 *
 * Counted in SQL. This used to read every row — including bodies — to take their length,
 * and it runs on every curator page load (F6-7).
 */
export async function countByStatus(museumId: string) {
  const db = await ensureDatabase(museumId);
  const result = await db.prepare('SELECT status, COUNT(*) AS n FROM submissions WHERE museum_id=? GROUP BY status')
    .bind(museumId).all<{ status: string; n: number }>();
  const rows = result.results ?? [];
  const counts: Record<string, number> = { all: rows.reduce((total, row) => total + row.n, 0) };
  for (const status of SUBMISSION_STATUSES) counts[status] = rows.find((row) => row.status === status)?.n ?? 0;
  return counts;
}

export async function listActivity(museumId: string, limit = 20, offset = 0) {
  const db = await ensureDatabase(museumId);
  const result = await db.prepare('SELECT id,actor,action,detail,created_at,actor_role,actor_type,tool,target,risk,policy_decision,result FROM activity WHERE museum_id=? ORDER BY created_at DESC LIMIT ? OFFSET ?').bind(museumId, limit, offset).all<ActivityRow>();
  return result.results ?? [];
}

export async function countActivity(museumId: string) {
  const db = await ensureDatabase(museumId);
  const row = await db.prepare('SELECT COUNT(*) AS total FROM activity WHERE museum_id=?').bind(museumId).first<{ total: number }>();
  return row?.total ?? 0;
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

/**
 * Records a refusal that a curator should look at. A denial is not a dead end:
 * the agent gets an id back and moves on, and the work reappears as a human queue.
 */
export async function createEscalation(museumId: string, entry: {
  objectId?: string | null; tool: string; args: unknown; policy: string; sourceRefs?: string[];
}) {
  const db = await ensureDatabase(museumId);
  const id = `ESC-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  await db.prepare('INSERT INTO escalations (id,museum_id,object_id,tool,args,policy,source_refs,status,created_at,resolved_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .bind(id, museumId, entry.objectId ?? null, entry.tool, JSON.stringify(entry.args ?? {}), entry.policy,
      JSON.stringify(entry.sourceRefs ?? []), 'open', Date.now(), null).run();
  return id;
}

export async function listEscalations(museumId: string, status = 'open', limit = 20) {
  const db = await ensureDatabase(museumId);
  const result = await db.prepare('SELECT id,museum_id,object_id,tool,args,policy,source_refs,status,created_at,resolved_at FROM escalations WHERE museum_id=? AND status=? ORDER BY created_at DESC LIMIT ?')
    .bind(museumId, status, limit).all<EscalationRow>();
  return result.results ?? [];
}

/**
 * A cheap change token for one workspace.
 *
 * Every consequential action already writes an activity row — contributions,
 * policy refusals, escalations, and published revisions alike — so the activity
 * table is the one signal that covers all of them. Submissions are counted too,
 * so a write that somehow skips the log still moves the token.
 */
export async function workspaceRevision(museumId: string) {
  const db = await ensureDatabase(museumId);
  const [activityRow, submissionRow, latest] = await Promise.all([
    db.prepare('SELECT COUNT(*) AS n, COALESCE(MAX(created_at),0) AS at FROM activity WHERE museum_id=?').bind(museumId).first<{ n: number; at: number }>(),
    db.prepare('SELECT COUNT(*) AS n FROM submissions WHERE museum_id=?').bind(museumId).first<{ n: number }>(),
    db.prepare('SELECT actor,action,target,policy_decision FROM activity WHERE museum_id=? ORDER BY created_at DESC LIMIT 1').bind(museumId).first<{ actor: string; action: string; target: string; policy_decision: string }>(),
  ]);
  return {
    revision: `${activityRow?.n ?? 0}.${submissionRow?.n ?? 0}.${activityRow?.at ?? 0}`,
    latest: latest ? { actor: latest.actor, action: latest.action, target: latest.target, decision: latest.policy_decision } : null,
  };
}

export async function getEscalation(museumId: string, id: string) {
  const db = await ensureDatabase(museumId);
  return db.prepare('SELECT id,museum_id,object_id,tool,args,policy,source_refs,status,created_at,resolved_at FROM escalations WHERE museum_id=? AND id=?')
    .bind(museumId, id).first<EscalationRow>();
}

/**
 * Closes a referral. `reviewed` means the curator took it forward, `dismissed`
 * means they judged there was nothing to act on — the audit trail keeps the
 * difference, because who decided what is the point of this record.
 */
export async function resolveEscalation(museumId: string, id: string, status: 'reviewed' | 'dismissed') {
  const db = await ensureDatabase(museumId);
  await db.prepare('UPDATE escalations SET status=?, resolved_at=? WHERE museum_id=? AND id=?')
    .bind(status, Date.now(), museumId, id).run();
}

/** The true total, so a capped list never lets the interface understate the queue. */
export async function countEscalations(museumId: string, status = 'open') {
  const db = await ensureDatabase(museumId);
  const row = await db.prepare('SELECT COUNT(*) AS total FROM escalations WHERE museum_id=? AND status=?').bind(museumId, status).first<{ total: number }>();
  return row?.total ?? 0;
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
    consent_alerts: submissions.filter((row) => row.consent === 'private').length,
  };
}

export type AssetRow = {
  id: string; museum_id: string; object_id: string | null; submission_id: string | null; evidence_id: string | null;
  kind: string; content_type: string; storage_key: string; file_name: string; alt_text: string; caption: string;
  visibility: string; consent: string; byte_size: number; width: number | null; height: number | null;
  sort_order: number; uploaded_by: string; created_at: number; updated_at: number;
};

const ASSET_COLUMNS = 'id,museum_id,object_id,submission_id,evidence_id,kind,content_type,storage_key,file_name,alt_text,caption,visibility,consent,byte_size,width,height,sort_order,uploaded_by,created_at,updated_at';

export async function insertAsset(museumId: string, asset: Omit<AssetRow, 'museum_id'>) {
  const db = await ensureDatabase(museumId);
  await db.prepare(`INSERT INTO assets (${ASSET_COLUMNS}) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(asset.id, museumId, asset.object_id, asset.submission_id, asset.evidence_id, asset.kind, asset.content_type,
      asset.storage_key, asset.file_name, asset.alt_text, asset.caption, asset.visibility, asset.consent,
      asset.byte_size, asset.width, asset.height, asset.sort_order, asset.uploaded_by, asset.created_at, asset.updated_at).run();
}

/** Reads the row unfiltered. Every caller must run `assetAccess` before serving it. */
export async function getAsset(museumId: string, id: string) {
  const db = await ensureDatabase(museumId);
  return db.prepare(`SELECT ${ASSET_COLUMNS} FROM assets WHERE museum_id=? AND id=? LIMIT 1`).bind(museumId, id).first<AssetRow>();
}

export async function listObjectAssets(museumId: string, objectId: string) {
  const db = await ensureDatabase(museumId);
  const result = await db.prepare(`SELECT ${ASSET_COLUMNS} FROM assets WHERE museum_id=? AND object_id=? ORDER BY sort_order, created_at`).bind(museumId, objectId).all<AssetRow>();
  return result.results ?? [];
}

export async function listSubmissionAssets(museumId: string, submissionId: string) {
  const db = await ensureDatabase(museumId);
  const result = await db.prepare(`SELECT ${ASSET_COLUMNS} FROM assets WHERE museum_id=? AND submission_id=? ORDER BY sort_order, created_at`).bind(museumId, submissionId).all<AssetRow>();
  return result.results ?? [];
}

export async function countSubmissionAssets(museumId: string, submissionId: string) {
  const db = await ensureDatabase(museumId);
  const row = await db.prepare('SELECT COUNT(*) AS total FROM assets WHERE museum_id=? AND submission_id=?').bind(museumId, submissionId).first<{ total: number }>();
  return row?.total ?? 0;
}

/**
 * Attaches already-uploaded assets to a contribution.
 *
 * The asset inherits the contribution's consent and the object it is about. Without
 * the object id an attached file would never appear in `list_object_assets`, not even
 * after a curator published it, because that query keys on `object_id`. Visibility is
 * untouched and stays `restricted`, so the file sits on the object's record as pending
 * material a curator can see and the public cannot.
 *
 * Only unattached assets in this workspace move, so an id belonging to someone else's
 * contribution simply does not match and the returned count is lower than the ids given.
 */
export async function attachAssetsToSubmission(museumId: string, submissionId: string, assetIds: string[], consent: string, objectId?: string, altText?: Record<string, string>) {
  if (assetIds.length === 0) return 0;
  const db = await ensureDatabase(museumId);
  const now = Date.now();
  const holes = assetIds.map(() => '?').join(',');
  const result = await db.prepare(`UPDATE assets SET submission_id=?, consent=?, object_id=COALESCE(?,object_id), updated_at=? WHERE museum_id=? AND id IN (${holes}) AND submission_id IS NULL`)
    .bind(submissionId, consent, objectId ?? null, now, museumId, ...assetIds).run();
  // Alt text is per asset, so it cannot ride the single UPDATE above. Only assets this
  // call just claimed are touched, so a stray id cannot relabel someone else's file.
  const described = Object.entries(altText ?? {}).filter(([id, text]) => assetIds.includes(id) && text.trim());
  if (described.length > 0) {
    await db.batch(described.map(([id, text]) => db.prepare('UPDATE assets SET alt_text=?, updated_at=? WHERE museum_id=? AND id=? AND submission_id=?')
      .bind(text.trim().slice(0, 300), now, museumId, id, submissionId)));
  }
  return result.meta?.changes ?? 0;
}

/** Opens or withdraws one asset from public display. Consent is judged by the caller. */
export async function setAssetVisibility(museumId: string, id: string, visibility: 'public' | 'restricted') {
  const db = await ensureDatabase(museumId);
  const result = await db.prepare("UPDATE assets SET visibility=?, updated_at=? WHERE museum_id=? AND id=? AND visibility<>'sealed'")
    .bind(visibility, Date.now(), museumId, id).run();
  return (result.meta?.changes ?? 0) > 0;
}

/**
 * Contributions about one object that consent permits showing publicly (FR-O2).
 *
 * `private` material is excluded in SQL rather than filtered afterwards, so a
 * rendering mistake downstream cannot put it on a public page. Attribution is the
 * caller's decision: `public_anonymous` permits the content but not the name.
 */
export async function listPublicContributions(museumId: string, objectId: string) {
  const db = await ensureDatabase(museumId);
  const result = await db.prepare("SELECT * FROM submissions WHERE museum_id=? AND object_id=? AND consent IN ('public_attributed','public_anonymous') ORDER BY created_at DESC")
    .bind(museumId, objectId).all<SubmissionRow>();
  return result.results ?? [];
}

export type NewObjectInput = {
  id: string; accession: string; title: string; description: string; period: string;
  objectType: string; material: string; origin: string; acquisitionDate: string | null;
  recordStatus: string; tone: string; questions: string[]; label: string;
};

/**
 * Creates one object with its first published label (FR-K5).
 *
 * The label is a real revision 1 rather than a column on the object, so a new record
 * enters the same publication history every other object has and `labelRevision`
 * counts from the same place.
 */
export async function createObject(museumId: string, input: NewObjectInput, approvedBy: string) {
  const db = await ensureDatabase(museumId);
  const now = Date.now();
  const labelId = `LBL-${input.id}-R1`;
  const clash = await db.prepare('SELECT id FROM objects WHERE museum_id=? AND (id=? OR accession_number=?) LIMIT 1')
    .bind(museumId, input.id, input.accession).first<{ id: string }>();
  if (clash) return { created: false as const, clash: clash.id };
  await db.batch([
    db.prepare('INSERT INTO objects (id,museum_id,accession_number,title,description,origin,period,object_type,material,acquisition_date,current_label_id,visibility,provenance_completeness,provenance_gap,record_status,display_tone,questions,version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .bind(input.id, museumId, input.accession, input.title, input.description, input.origin, input.period,
        input.objectType, input.material, input.acquisitionDate, labelId, 'public', 0, null,
        input.recordStatus, input.tone, JSON.stringify(input.questions), 1, now, now),
    db.prepare('INSERT INTO label_publications (id,museum_id,object_id,title,body,assertions,evidence_refs,revision_number,approved_by,published_at,superseded_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .bind(labelId, museumId, input.id, input.title, input.label, '[]', '[]', 1, approvedBy, now, null),
    db.prepare('INSERT INTO provenance_events (id,museum_id,object_id,start_date,end_date,title,detail,custodian,location,status,authority,evidence_refs,is_gap,sort_order,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .bind(`PE-${input.id}-ACQ`, museumId, input.id, input.acquisitionDate ?? input.period, null, 'Museum acquisition',
        `Entered the collection as ${input.accession}.`, 'The Halcyon Museum of Material Memory', null,
        'verified', 'verified', '[]', 0, 10, now, now),
  ]);
  return { created: true as const, labelId };
}

export type Clarification = { question: string; askedAt: number; askedBy: string };

/** Reads the curator's questions on one contribution, newest last. */
export function parseClarifications(raw: string): Clarification[] {
  try {
    const parsed: unknown = JSON.parse(raw || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry) => {
      const item = entry as Partial<Clarification>;
      return typeof item?.question === 'string' && item.question.trim()
        ? [{ question: item.question, askedAt: Number(item.askedAt) || 0, askedBy: String(item.askedBy ?? 'Curator') }]
        : [];
    });
  } catch {
    return [];
  }
}

/**
 * Adds one curator question to a contribution and returns the whole history.
 *
 * A list rather than a single column because a review can need more than one question,
 * and because replacing the previous one would erase what was already asked — the case
 * screen is the only place a curator can see it.
 */
export async function appendClarification(museumId: string, submissionId: string, question: string, askedBy = 'Mina, Curator') {
  const db = await ensureDatabase(museumId);
  const row = await getSubmission(museumId, submissionId);
  if (!row) return [];
  const history = [...parseClarifications(row.clarifications), { question: question.trim().slice(0, 1000), askedAt: Date.now(), askedBy }];
  await db.prepare('UPDATE submissions SET clarifications=?, updated_at=? WHERE museum_id=? AND id=?')
    .bind(JSON.stringify(history), Date.now(), museumId, submissionId).run();
  return history;
}
