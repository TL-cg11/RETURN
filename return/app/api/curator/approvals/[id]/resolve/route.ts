import { getApproval, getEvidenceByIds } from '@/db/queries';
import { ensureDatabase, sha256 } from '@/db/setup';
import type { Authority, Consent, Visibility } from '@/lib/domain/types';
import { evaluatePolicy } from '@/lib/policy/evaluate';
import { sessionFromRequest } from '@/lib/session';

type ApprovalSnapshot = {
  tool?: unknown;
  object_id?: unknown;
  object_version?: unknown;
  draft?: unknown;
  assertions?: unknown;
  evidence_refs?: unknown;
};

type PublicationTarget = {
  id: string;
  title: string;
  version: number;
  current_label_id: string | null;
  current_revision: number | null;
};

function parseArray(value: string) {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function invalid(reason: string, recovery: string, status = 400) {
  return Response.json({ outcome: 'invalid', reason, recovery, next: recovery }, { status });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { role, museumId } = sessionFromRequest(request);
  if (role !== 'curator') return Response.json({ error: 'Curator role required' }, { status: 403 });

  const { id } = await params;
  const body = await request.json().catch(() => ({})) as { action?: string; draft?: unknown; editReason?: unknown };
  if (!['approved', 'approve_with_edit', 'rejected'].includes(body.action ?? '')) {
    return invalid('Invalid resolution.', 'Choose approved, approve_with_edit, or rejected.');
  }

  const approval = await getApproval(museumId, id).catch(() => null);
  if (!approval) return Response.json({ error: 'Approval not found' }, { status: 404 });
  if (approval.status !== 'pending') {
    return Response.json({ outcome: 'denied', policy: 'approval_already_resolved', reason: `This approval was already ${approval.status}.`, recovery: 'Create a new approval request for the current draft.', next: 'Create a new approval request for the current draft.' }, { status: 409 });
  }

  const immutableHash = await sha256(approval.args_snapshot);
  const legacyHash = await sha256(approval.snapshot);
  if (approval.snapshot_hash !== immutableHash && approval.snapshot_hash !== legacyHash) {
    return Response.json({ outcome: 'denied', policy: 'approval_snapshot_mismatch', reason: 'The approval snapshot changed after review was requested.', recovery: 'Create a new approval request for the current draft.', next: 'Create a new approval request for the current draft.' }, { status: 409 });
  }

  let snapshot: ApprovalSnapshot;
  try {
    snapshot = JSON.parse(approval.args_snapshot) as ApprovalSnapshot;
  } catch {
    return invalid('The approval snapshot is not valid JSON.', 'Create a new approval request from the current draft.', 409);
  }
  if (snapshot.object_id !== undefined && snapshot.object_id !== approval.object_id) {
    return invalid('The approval target does not match its immutable snapshot.', 'Create a new approval request from the current object.', 409);
  }
  if (snapshot.object_version !== undefined && snapshot.object_version !== approval.object_version) {
    return invalid('The approval version does not match its immutable snapshot.', 'Create a new approval request from the current object version.', 409);
  }

  const db = await ensureDatabase(museumId);
  const target = await db.prepare(`SELECT o.id,o.title,o.version,o.current_label_id,lp.revision_number AS current_revision
    FROM objects o LEFT JOIN label_publications lp ON lp.museum_id=o.museum_id AND lp.id=o.current_label_id
    WHERE o.museum_id=? AND o.id=? LIMIT 1`)
    .bind(museumId, approval.object_id).first<PublicationTarget>();
  if (!target) return invalid('The approval target no longer exists.', 'Open the current collection and create a new proposal.', 404);

  if (body.action === 'rejected') {
    const now = Date.now();
    const [decision] = await db.batch([
      db.prepare("UPDATE approvals SET status='rejected', resolution='rejected', verdict='rejected', edited_body=NULL, edit_reason=?, resolved_at=? WHERE museum_id=? AND id=? AND status='pending'")
        .bind(typeof body.editReason === 'string' && body.editReason.trim() ? body.editReason.trim() : null, now, museumId, id),
      db.prepare(`INSERT INTO activity (id,museum_id,actor,action,detail,created_at,actor_role,actor_type,tool,target,risk,policy_decision,result)
        SELECT ?,?,'Mina, Curator','rejected label revision',?,?,'curator_ui','human',?,?,'HIGH','denied','rejected'
        WHERE EXISTS (SELECT 1 FROM approvals WHERE museum_id=? AND id=? AND status='rejected' AND resolved_at=?)`)
        .bind(crypto.randomUUID(), museumId, `${target.title} · revision ${approval.object_version + 1}`, now,
          approval.tool, approval.object_id, museumId, id, now),
    ]);
    if ((decision.meta?.changes ?? 0) !== 1) {
      return Response.json({ outcome: 'denied', policy: 'approval_already_resolved', reason: 'This approval was resolved by another request.', recovery: 'Refresh the approval queue.', next: 'Refresh the approval queue.' }, { status: 409 });
    }
    return Response.json({ outcome: 'applied', id, status: 'rejected', resolution: 'rejected', edited: false, published: false, persisted: true });
  }

  const draft = typeof body.draft === 'string' ? body.draft.trim() : approval.snapshot.trim();
  if (!draft) return invalid('An approved label cannot be empty.', 'Enter public label text or reject the proposal.');
  if (target.version !== approval.object_version || target.current_revision !== approval.object_version || !target.current_label_id) {
    return Response.json({ outcome: 'denied', policy: 'object_version_mismatch', reason: 'The public object changed after this approval was requested.', recovery: 'Create a new approval request from the current label.', next: 'Create a new approval request from the current label.' }, { status: 409 });
  }

  const evidenceIds = Array.isArray(snapshot.evidence_refs) ? snapshot.evidence_refs.map(String) : [];
  const evidence = await getEvidenceByIds(museumId, evidenceIds, 'curator');
  const storedAuthorities = parseArray(approval.refs_authority);
  const storedConsents = parseArray(approval.refs_consent);
  const refs = evidenceIds.length
    ? evidenceIds.map((evidenceId) => {
        const item = evidence.find((candidate) => candidate.id === evidenceId && candidate.objectId === approval.object_id);
        return {
          authority: (item?.authority ?? 'submitted') as Authority,
          consent: (item?.consent ?? 'private') as Consent,
          visibility: (item?.visibility ?? 'sealed') as Visibility,
        };
      })
    : storedAuthorities.map((authority, index) => ({
        authority: authority as Authority,
        consent: (storedConsents[index] ?? 'private') as Consent,
        visibility: 'public' as Visibility,
      }));
  const policy = evaluatePolicy({ actor: 'curator_ui', action: 'publish_label', museumMatch: true, refs, publicOutput: true });
  if (policy.outcome !== 'pending_approval') {
    const next = policy.recovery ?? 'Create a new proposal that satisfies publication policy.';
    return Response.json({ ...policy, policy: 'publication_policy_recheck', next, published: false }, { status: 409 });
  }

  const edited = body.action === 'approve_with_edit' || draft !== approval.snapshot.trim();
  const resolution = edited ? 'approved_with_edit' : 'approved';
  const editReason = edited
    ? (typeof body.editReason === 'string' && body.editReason.trim() ? body.editReason.trim() : 'Curator edited the proposed label during approval.')
    : null;
  const revision = approval.object_version + 1;
  const publicationId = `LBL-${approval.object_id}-R${revision}`;
  const assertions = Array.isArray(snapshot.assertions) ? snapshot.assertions : [];
  const now = Date.now();
  const previousLabelId = target.current_label_id;

  const results = await db.batch([
    db.prepare(`INSERT INTO label_publications (id,museum_id,object_id,title,body,assertions,evidence_refs,revision_number,approved_by,published_at,superseded_at)
      SELECT ?,?,?,?,?,?,?,?,?,?,NULL FROM objects o
      JOIN label_publications lp ON lp.museum_id=o.museum_id AND lp.id=o.current_label_id
      WHERE o.museum_id=? AND o.id=? AND o.version=? AND o.current_label_id=? AND lp.superseded_at IS NULL`)
      .bind(publicationId, museumId, approval.object_id, target.title, draft, JSON.stringify(assertions), JSON.stringify(evidenceIds), revision,
        'Mina, Curator', now, museumId, approval.object_id, approval.object_version, previousLabelId),
    db.prepare(`UPDATE label_publications SET superseded_at=? WHERE museum_id=? AND id=? AND superseded_at IS NULL
      AND EXISTS (SELECT 1 FROM label_publications WHERE museum_id=? AND id=?)`)
      .bind(now, museumId, previousLabelId, museumId, publicationId),
    db.prepare(`UPDATE objects SET current_label_id=?,version=?,updated_at=? WHERE museum_id=? AND id=? AND version=? AND current_label_id=?
      AND EXISTS (SELECT 1 FROM label_publications WHERE museum_id=? AND id=?)`)
      .bind(publicationId, revision, now, museumId, approval.object_id, approval.object_version, previousLabelId, museumId, publicationId),
    db.prepare(`UPDATE approvals SET status=?,resolution=?,verdict='approved',edited_body=?,edit_reason=?,resolved_at=?
      WHERE museum_id=? AND id=? AND status='pending'
      AND EXISTS (SELECT 1 FROM objects WHERE museum_id=? AND id=? AND version=? AND current_label_id=?)`)
      .bind(resolution, resolution, edited ? draft : null, editReason, now, museumId, id, museumId, approval.object_id, revision, publicationId),
    db.prepare(`INSERT INTO activity (id,museum_id,actor,action,detail,created_at,actor_role,actor_type,tool,target,risk,policy_decision,result)
      SELECT ?,?,'Mina, Curator',?,?,?,'curator_ui','human',?,?,'HIGH','applied',?
      WHERE EXISTS (SELECT 1 FROM approvals WHERE museum_id=? AND id=? AND status=? AND resolved_at=?)`)
      .bind(crypto.randomUUID(), museumId, edited ? 'edited and approved label revision' : 'approved label revision', `${target.title} · revision ${revision}`,
        now, approval.tool, approval.object_id, resolution, museumId, id, resolution, now),
    db.prepare(`INSERT INTO activity (id,museum_id,actor,action,detail,created_at,actor_role,actor_type,tool,target,risk,policy_decision,result)
      SELECT ?,?,'System','published label revision',?,?,'system','system',?,?,'HIGH','applied',?
      WHERE EXISTS (SELECT 1 FROM approvals WHERE museum_id=? AND id=? AND status=? AND resolved_at=?)`)
      .bind(crypto.randomUUID(), museumId, `${target.title} · revision ${revision}`, now, approval.tool, approval.object_id, publicationId,
        museumId, id, resolution, now),
  ]);

  if ((results[0].meta?.changes ?? 0) !== 1 || (results[2].meta?.changes ?? 0) !== 1 || (results[3].meta?.changes ?? 0) !== 1) {
    return Response.json({ outcome: 'denied', policy: 'publication_conflict', reason: 'The public label changed while this approval was being resolved.', recovery: 'Refresh the object and create a new proposal.', next: 'Refresh the object and create a new proposal.' }, { status: 409 });
  }

  return Response.json({
    outcome: 'applied', risk: policy.risk, id, status: resolution, resolution, edited, persisted: true, published: true,
    object_id: approval.object_id, revision, publication_id: publicationId, previous_label_id: previousLabelId,
  });
}
