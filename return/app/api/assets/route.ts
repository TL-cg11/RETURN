import { countSubmissionAssets, insertAsset, recordActivity } from '@/db/queries';
import { isAllowedUpload, MAX_ASSET_BYTES, MAX_ASSETS_PER_CONTRIBUTION } from '@/lib/assets/access';
import { putAsset, storageKeyFor } from '@/lib/assets/storage';
import { sessionFromRequest } from '@/lib/session';

export const dynamic = 'force-dynamic';

/**
 * Upload one asset and get an id back. The contribution form calls this before the
 * contribution exists, so an upload starts unattached and is bound to a submission
 * later (`attachAssetsToSubmission`).
 *
 * Assets are stored `restricted`/`private` regardless of what the caller asks for.
 * Nothing an uploader sends can make its own material public: that takes a curator.
 * `RETURN_PLAN.md` §15.1 keeps binaries off the tool surface, so this route is the
 * only way bytes enter the system.
 */
export async function POST(request: Request) {
  const { museumId, role } = await sessionFromRequest(request);

  const form = await request.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) {
    return Response.json({ outcome: 'invalid', field: 'file', reason: 'Attach a file to upload.', recovery: 'Choose a photograph, document, or recording.' }, { status: 400 });
  }

  const allowed = isAllowedUpload(file.type, file.size);
  if (!allowed) {
    return Response.json({
      outcome: 'invalid', field: 'file',
      reason: file.size > MAX_ASSET_BYTES
        ? `Files must be ${Math.floor(MAX_ASSET_BYTES / (1024 * 1024))} MB or smaller.`
        : 'That file type cannot be accepted.',
      recovery: 'Upload a JPEG, PNG, WebP, GIF, PDF, or audio recording.',
    }, { status: 400 });
  }

  const submissionId = typeof form?.get('submission_id') === 'string' ? String(form.get('submission_id')).trim() : '';
  if (submissionId && await countSubmissionAssets(museumId, submissionId) >= MAX_ASSETS_PER_CONTRIBUTION) {
    return Response.json({ outcome: 'invalid', field: 'file', reason: `A contribution may carry at most ${MAX_ASSETS_PER_CONTRIBUTION} files.`, recovery: 'Remove an attachment before adding another.' }, { status: 400 });
  }

  const id = `AST-${crypto.randomUUID().slice(0, 12).toUpperCase()}`;
  const fileName = (file.name || 'upload').slice(0, 120);
  const storageKey = storageKeyFor(museumId, id, fileName);
  const now = Date.now();

  try {
    await putAsset(storageKey, await file.arrayBuffer(), file.type);
    await insertAsset(museumId, {
      id, object_id: null, submission_id: submissionId || null, evidence_id: null,
      kind: allowed.kind, content_type: file.type, storage_key: storageKey, file_name: fileName,
      alt_text: typeof form?.get('alt_text') === 'string' ? String(form.get('alt_text')).slice(0, 300) : '',
      caption: typeof form?.get('caption') === 'string' ? String(form.get('caption')).slice(0, 300) : '',
      visibility: 'restricted', consent: 'private',
      byte_size: file.size, width: null, height: null, sort_order: now,
      uploaded_by: role === 'curator' ? 'Curator' : 'Community contributor',
      created_at: now, updated_at: now,
    });
  } catch {
    return Response.json({ outcome: 'invalid', field: 'file', reason: 'The file could not be stored.', recovery: 'Try the upload again.' }, { status: 500 });
  }

  await recordActivity(museumId, role === 'curator' ? 'Mina, Curator' : 'Community contributor', 'uploaded an asset', fileName, {
    tool: 'upload_asset', target: id, risk: 'MEDIUM', policyDecision: 'applied', result: id,
  });

  return Response.json({ outcome: 'applied', id, kind: allowed.kind, file_name: fileName, byte_size: file.size, url: `/api/assets/${id}` });
}
