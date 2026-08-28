import { getApproval, getEvidenceByIds } from '@/db/queries';
import { ensureDatabase, sha256 } from '@/db/setup';
import {
  canonicalJson, isDraftHashLegacyApprovalSnapshot, isLabelApprovalSnapshot, isLegacyLabelApprovalSnapshot,
  validateLabelApprovalIntegrity, type ApprovalEvidenceSnapshot,
} from '@/lib/approval-snapshot';
import type { Authority, Consent, Visibility } from '@/lib/domain/types';
import { evaluatePolicy } from '@/lib/policy/evaluate';
import { sessionFromRequest } from '@/lib/session';
import { guarded } from '@/lib/http/input';

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

function mismatch(reason = 'The approval snapshot or its source records changed after review was requested.') {
  const next = 'Create a new approval request from the current object and evidence.';
  return Response.json({ outcome: 'denied', policy: 'approval_snapshot_mismatch', reason, recovery: next, next }, { status: 409 });
}

function unavailable(status: string) {
  const expired = status === 'expired';
  const next = 'Create a new approval request for the current draft.';
  return Response.json({
    outcome: 'denied',
    policy: expired ? 'approval_expired' : 'approval_already_resolved',
    reason: expired ? 'This approval expired before it was resolved.' : `This approval was already ${status}.`,
    recovery: next,
    next,
  }, { status: 409 });
}

function linkedSubmissionUpdate(
  db: Awaited<ReturnType<typeof ensureDatabase>>,
  museumId: string,
  objectId: string,
  evidenceIds: string[],
  status: 'reflected in label' | 'closed',
  now: number,
  approvalId: string,
  approvalStatus: string,
) {
  if (evidenceIds.length === 0) return null;
  const holes = evidenceIds.map(() => '?').join(',');
  return db.prepare(`UPDATE submissions SET status=?,updated_at=?
    WHERE museum_id=? AND object_id=? AND status NOT IN ('reflected in label','closed')
    AND EXISTS (SELECT 1 FROM approvals WHERE museum_id=? AND id=? AND status=? AND resolved_at=?)
    AND (
      EXISTS (SELECT 1 FROM json_each(CASE WHEN json_valid(submissions.evidence_refs) THEN submissions.evidence_refs ELSE '[]' END) ref WHERE ref.value IN (${holes}))
      OR EXISTS (SELECT 1 FROM activity a WHERE a.museum_id=submissions.museum_id
        AND (a.result=submissions.id OR submissions.id=a.result || '-' || submissions.museum_id) AND a.target IN (${holes}))
    )`)
    .bind(status, now, museumId, objectId, museumId, approvalId, approvalStatus, now, ...evidenceIds, ...evidenceIds);
}

export const POST = guarded(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { role, museumId } = await sessionFromRequest(request);
  if (role !== 'curator') return Response.json({ outcome: 'denied', risk: 'LOW', reason: 'Curator role required.', recovery: 'Switch to the curator workspace.' }, { status: 403 });

  const { id } = await params;
  const body = await request.json().catch(() => ({})) as { action?: string; draft?: unknown; editReason?: unknown };
  if (!['approved', 'approve_with_edit', 'rejected'].includes(body.action ?? '')) {
    return invalid('Invalid resolution.', 'Choose approved, approve_with_edit, or rejected.');
  }

  const approval = await getApproval(museumId, id).catch(() => null);
  if (!approval) return Response.json({ outcome: 'invalid', field: 'approval_id', reason: 'No approval with that id exists in this workspace.', recovery: 'Call list_pending_approvals to see what is waiting.' }, { status: 404 });
  if (approval.status !== 'pending') return unavailable(approval.status);

  let rawSnapshot: unknown;

  try {
    rawSnapshot = JSON.parse(approval.args_snapshot);
  } catch {
    return mismatch('The approval snapshot is not valid JSON.');
  }
  const currentSnapshot = isLabelApprovalSnapshot(rawSnapshot) ? rawSnapshot : null;
  const legacySnapshot = currentSnapshot ? null : isLegacyLabelApprovalSnapshot(rawSnapshot) ? rawSnapshot : null;
  if (!currentSnapshot && !legacySnapshot) return mismatch('The approval snapshot does not match a recognized immutable contract.');

  const immutableHash = await sha256(approval.args_snapshot);
  // Old demo workspaces used the draft hash. Accept that only for the narrowly
  // recognized legacy shape; current A4 snapshots always hash canonical JSON.
  const legacyHash = isDraftHashLegacyApprovalSnapshot(rawSnapshot) ? await sha256(approval.snapshot) : '';
  const hashMatches = approval.snapshot_hash === immutableHash
    || (!!legacyHash && approval.snapshot_hash === legacyHash);
  if (!hashMatches || (currentSnapshot && canonicalJson(currentSnapshot) !== approval.args_snapshot)) {
    return mismatch('The approval snapshot hash changed after review was requested.');
  }

  const snapshotObjectId = currentSnapshot?.target.object_id ?? legacySnapshot!.object_id;
  const snapshotObjectVersion = currentSnapshot?.target.version ?? legacySnapshot!.object_version;
  const snapshotDraft = currentSnapshot?.draft ?? legacySnapshot!.draft;
  const evidenceIds = currentSnapshot
    ? currentSnapshot.evidence_refs.map((ref) => ref.id)
    : Array.isArray(legacySnapshot?.evidence_refs) ? legacySnapshot.evidence_refs.map(String) : [];
  if (snapshotObjectId !== approval.object_id || snapshotObjectVersion !== approval.object_version || snapshotDraft !== approval.snapshot) {
    return mismatch('The approval target, version, or draft no longer matches its immutable snapshot.');
  }

  const db = await ensureDatabase(museumId);
  const target = await db.prepare(`SELECT o.id,o.title,o.version,o.current_label_id,lp.revision_number AS current_revision
    FROM objects o LEFT JOIN label_publications lp ON lp.museum_id=o.museum_id AND lp.id=o.current_label_id
    WHERE o.museum_id=? AND o.id=? LIMIT 1`)
    .bind(museumId, approval.object_id).first<PublicationTarget>();
  if (!target) return mismatch('The approval target no longer exists in this workspace.');

  if (body.action === 'rejected') {
    const now = Date.now();
    const linked = linkedSubmissionUpdate(db, museumId, approval.object_id, evidenceIds, 'closed', now, id, 'rejected');
    const [decision] = await db.batch([
      db.prepare("UPDATE approvals SET status='rejected', resolution='rejected', verdict='rejected', edited_body=NULL, edit_reason=?, resolved_at=? WHERE museum_id=? AND id=? AND status='pending' AND expires_at>?")
        .bind(typeof body.editReason === 'string' && body.editReason.trim() ? body.editReason.trim() : null, now, museumId, id, now),
      ...(linked ? [linked] : []),
      db.prepare(`INSERT INTO activity (id,museum_id,actor,action,detail,created_at,actor_role,actor_type,tool,target,risk,policy_decision,result)
        SELECT ?,?,'Mina, Curator','rejected label revision',?,?,'curator_ui','human',?,?,'HIGH','denied','rejected'
        WHERE EXISTS (SELECT 1 FROM approvals WHERE museum_id=? AND id=? AND status='rejected' AND resolved_at=?)`)
        .bind(crypto.randomUUID(), museumId, `${target.title} · revision ${approval.object_version + 1}`, now,
          approval.tool, approval.object_id, museumId, id, now),
    ]);
    if ((decision.meta?.changes ?? 0) !== 1) {
      const latest = await getApproval(museumId, id);
      return unavailable(latest?.status ?? 'resolved by another request');
    }
    return Response.json({ outcome: 'applied', id, status: 'rejected', resolution: 'rejected', edited: false, published: false, persisted: true });
  }

  const draft = typeof body.draft === 'string' ? body.draft.trim() : approval.snapshot.trim();
  if (!draft) return invalid('An approved label cannot be empty.', 'Enter public label text or reject the proposal.');
  if (target.version !== approval.object_version || target.current_revision !== approval.object_version || !target.current_label_id) {
    return mismatch('The public object version or current label changed after this approval was requested.');
  }

  const evidence = await getEvidenceByIds(museumId, evidenceIds, 'curator');
  const storedAuthorities = parseArray(approval.refs_authority);
  const storedConsents = parseArray(approval.refs_consent);
  if (currentSnapshot) {
    const currentEvidence: ApprovalEvidenceSnapshot[] = currentSnapshot.evidence_refs.flatMap((expected) => {
      const item = evidence.find((candidate) => candidate.id === expected.id && candidate.objectId === approval.object_id);
      return item ? [{ id: item.id, authority: item.authority, consent: item.consent, visibility: item.visibility }] : [];
    });
    const integrityFailure = validateLabelApprovalIntegrity({
      snapshot: currentSnapshot,
      stored: {
        tool: approval.tool,
        objectId: approval.object_id,
        objectVersion: approval.object_version,
        draft: approval.snapshot,
        justification: approval.justification,
        refsAuthority: storedAuthorities,
        refsConsent: storedConsents,
      },
      currentEvidence,
    });
    if (integrityFailure) return mismatch(integrityFailure === 'evidence_snapshot_mismatch'
      ? 'Evidence authority, consent, visibility, ownership, or availability changed while approval was pending.'
      : 'Stored approval fields no longer match the immutable snapshot.');
  } else if (legacySnapshot) {
    // Legacy rows did not capture visibility. Still compare every field they did
    // capture so the compatibility path cannot bypass tampering detection.
    if (legacySnapshot.tool !== undefined && legacySnapshot.tool !== approval.tool) return mismatch();
    if (evidenceIds.length !== storedAuthorities.length || evidenceIds.length !== storedConsents.length) return mismatch();
    for (let index = 0; index < evidenceIds.length; index++) {
      const item = evidence.find((candidate) => candidate.id === evidenceIds[index] && candidate.objectId === approval.object_id);
      if (!item || item.authority !== storedAuthorities[index] || item.consent !== storedConsents[index]) return mismatch();
    }
  }
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
  const museumMatch = approval.museum_id === museumId
    && target.id === snapshotObjectId
    && evidenceIds.every((evidenceId) => evidence.some((item) => item.id === evidenceId && item.objectId === approval.object_id));
  const policy = evaluatePolicy({ actor: 'curator_ui', action: 'publish_label', museumMatch, refs, publicOutput: true });
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
  const assertions = currentSnapshot?.assertions ?? (Array.isArray(legacySnapshot?.assertions) ? legacySnapshot.assertions : []);
  const now = Date.now();
  const previousLabelId = target.current_label_id;
  const linked = linkedSubmissionUpdate(db, museumId, approval.object_id, evidenceIds, 'reflected in label', now, id, resolution);

  const results = await db.batch([
    db.prepare(`INSERT INTO label_publications (id,museum_id,object_id,title,body,assertions,evidence_refs,revision_number,approved_by,published_at,superseded_at)
      SELECT ?,?,?,?,?,?,?,?,?,?,NULL FROM objects o
      JOIN label_publications lp ON lp.museum_id=o.museum_id AND lp.id=o.current_label_id
      JOIN approvals a ON a.museum_id=o.museum_id AND a.object_id=o.id
      WHERE o.museum_id=? AND o.id=? AND o.version=? AND o.current_label_id=? AND lp.superseded_at IS NULL
      AND a.id=? AND a.status='pending' AND a.expires_at>?`)
      .bind(publicationId, museumId, approval.object_id, target.title, draft, JSON.stringify(assertions), JSON.stringify(evidenceIds), revision,
        'Mina, Curator', now, museumId, approval.object_id, approval.object_version, previousLabelId, id, now),
    db.prepare(`UPDATE label_publications SET superseded_at=? WHERE museum_id=? AND id=? AND superseded_at IS NULL
      AND EXISTS (SELECT 1 FROM label_publications WHERE museum_id=? AND id=?)`)
      .bind(now, museumId, previousLabelId, museumId, publicationId),
    db.prepare(`UPDATE objects SET current_label_id=?,version=?,updated_at=? WHERE museum_id=? AND id=? AND version=? AND current_label_id=?
      AND EXISTS (SELECT 1 FROM label_publications WHERE museum_id=? AND id=?)`)
      .bind(publicationId, revision, now, museumId, approval.object_id, approval.object_version, previousLabelId, museumId, publicationId),
    db.prepare(`UPDATE approvals SET status=?,resolution=?,verdict='approved',edited_body=?,edit_reason=?,resolved_at=?
      WHERE museum_id=? AND id=? AND status='pending' AND expires_at>?
      AND EXISTS (SELECT 1 FROM objects WHERE museum_id=? AND id=? AND version=? AND current_label_id=?)`)
      .bind(resolution, resolution, edited ? draft : null, editReason, now, museumId, id, now, museumId, approval.object_id, revision, publicationId),
    ...(linked ? [linked] : []),
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
    const latest = await getApproval(museumId, id);
    if (latest?.status !== 'pending') return unavailable(latest?.status ?? 'resolved by another request');
    return Response.json({ outcome: 'denied', policy: 'publication_conflict', reason: 'The public label changed while this approval was being resolved.', recovery: 'Refresh the object and create a new proposal.', next: 'Refresh the object and create a new proposal.' }, { status: 409 });
  }

  return Response.json({
    outcome: 'applied', risk: policy.risk, id, status: resolution, resolution, edited, persisted: true, published: true,
    object_id: approval.object_id, revision, publication_id: publicationId, previous_label_id: previousLabelId,
  });
});
