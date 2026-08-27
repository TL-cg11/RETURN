import { collection } from '@/lib/demo-data';
import { ensureDatabase } from './setup';

export type SubmissionRow = {
  id: string; museum_id: string; object_id: string; kind: string; title: string;
  description: string; source: string; consent: string; requested_outcome: string;
  status: string; created_at: number;
};
export type ActivityRow = { id: string; actor: string; action: string; detail: string; created_at: number };
export type ApprovalRow = {
  id: string; object_id: string; risk: string; snapshot: string; snapshot_hash: string;
  object_version: number; status: string; resolution: string | null; created_at: number; resolved_at: number | null;
};

export const SUBMISSION_STATUSES = ['received', 'needs information', 'under review', 'reflected in label', 'closed'] as const;

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
  const result = await db.prepare('UPDATE submissions SET status=? WHERE museum_id=? AND id=?').bind(status, museumId, id).run();
  return (result.meta?.changes ?? 0) > 0;
}

export async function countByStatus(museumId: string) {
  const rows = await listSubmissions(museumId);
  const counts: Record<string, number> = { all: rows.length };
  for (const status of SUBMISSION_STATUSES) counts[status] = rows.filter((r) => r.status === status).length;
  return counts;
}

export async function listActivity(museumId: string, limit = 20) {
  const db = await ensureDatabase(museumId);
  const result = await db.prepare('SELECT id,actor,action,detail,created_at FROM activity WHERE museum_id=? ORDER BY created_at DESC LIMIT ?').bind(museumId, limit).all<ActivityRow>();
  return result.results ?? [];
}

export async function recordActivity(museumId: string, actor: string, action: string, detail: string) {
  const db = await ensureDatabase(museumId);
  await db.prepare('INSERT INTO activity (id,museum_id,actor,action,detail,created_at) VALUES (?,?,?,?,?,?)')
    .bind(crypto.randomUUID(), museumId, actor, action, detail, Date.now()).run();
}

export async function listApprovals(museumId: string, status?: string) {
  const db = await ensureDatabase(museumId);
  const sql = status
    ? 'SELECT * FROM approvals WHERE museum_id=? AND status=? ORDER BY created_at DESC'
    : 'SELECT * FROM approvals WHERE museum_id=? ORDER BY created_at DESC';
  const values = status ? [museumId, status] : [museumId];
  const result = await db.prepare(sql).bind(...values).all<ApprovalRow>();
  return result.results ?? [];
}

export async function getApproval(museumId: string, id: string) {
  const db = await ensureDatabase(museumId);
  return db.prepare('SELECT * FROM approvals WHERE museum_id=? AND id=?').bind(museumId, id).first<ApprovalRow>();
}

/** Counts behind the curator dashboard and get_collection_summary. */
export async function workspaceSummary(museumId: string) {
  const [submissions, approvals] = await Promise.all([listSubmissions(museumId), listApprovals(museumId, 'pending')]);
  return {
    objects: collection.length,
    open_gaps: collection.filter((o) => o.gap).length,
    new_submissions: submissions.filter((s) => s.status === 'received').length,
    total_submissions: submissions.length,
    pending_approvals: approvals.length,
    consent_alerts: submissions.filter((s) => s.consent === 'research_only' || s.consent === 'private').length,
  };
}
