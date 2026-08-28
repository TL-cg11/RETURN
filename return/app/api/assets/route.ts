import { countSubmissionAssets, insertAsset, recordActivity } from '@/db/queries';
import { isAllowedUpload, MAX_ASSET_BYTES, MAX_ASSETS_PER_CONTRIBUTION } from '@/lib/assets/access';
import { putAsset, storageKeyFor } from '@/lib/assets/storage';
import { readImageDimensions } from '@/lib/assets/image-dimensions';
import type { ImageDimensions } from '@/lib/assets/image-dimensions';
import { sessionFromRequest } from '@/lib/session';
import { MAX_TEXT } from '@/lib/domain/types';
import { guarded, refuse, refused, takeText } from '@/lib/http/input';

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
export const POST = guarded(async (request: Request) => {
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

  const submissionId$ = takeText(form?.get('submission_id'), 'submission_id', { max: MAX_TEXT.id, label: 'A contribution id' });
  if (refused(submissionId$)) return submissionId$.refusal;
  const submissionId = submissionId$;
  if (submissionId && await countSubmissionAssets(museumId, submissionId) >= MAX_ASSETS_PER_CONTRIBUTION) {
    return Response.json({ outcome: 'invalid', field: 'file', reason: `A contribution may carry at most ${MAX_ASSETS_PER_CONTRIBUTION} files.`, recovery: 'Remove an attachment before adding another.' }, { status: 400 });
  }

  /**
   * The name, the description, and the caption, refused rather than cut (V7-4).
   *
   * All three were sliced silently: a two-hundred-character file name was stored at a
   * hundred and twenty, and alt text written for a screen reader arrived three hundred
   * characters long however much had been typed. SCHEMA §30 says a ceiling refuses and
   * does not truncate, and these were the last three places that still did.
   */
  const rawName = file.name || 'upload';
  if (rawName.length > MAX_TEXT.fileName) {
    return refuse('file', `A file name is at most ${MAX_TEXT.fileName} characters, and this one is ${rawName.length}.`,
      'Rename the file and upload it again.').refusal;
  }
  const altText = takeText(form?.get('alt_text'), 'alt_text', { max: MAX_TEXT.altText, label: 'Alternative text' });
  if (refused(altText)) return altText.refusal;
  const caption = takeText(form?.get('caption'), 'caption', { max: MAX_TEXT.caption, label: 'A caption' });
  if (refused(caption)) return caption.refusal;

  const id = `AST-${crypto.randomUUID().slice(0, 12).toUpperCase()}`;
  const fileName = rawName;
  const storageKey = storageKeyFor(museumId, id, fileName);
  const now = Date.now();
  let dimensions: ImageDimensions | null = null;

  try {
    const bytes = await file.arrayBuffer();
    dimensions = allowed.kind === 'image' ? readImageDimensions(bytes, file.type) : null;
    await putAsset(storageKey, bytes, file.type);
    await insertAsset(museumId, {
      id, object_id: null, submission_id: submissionId || null, evidence_id: null,
      kind: allowed.kind, content_type: file.type, storage_key: storageKey, file_name: fileName,
      alt_text: altText,
      caption,
      visibility: 'restricted', consent: 'private',
      byte_size: file.size, width: dimensions?.width ?? null, height: dimensions?.height ?? null, sort_order: now,
      uploaded_by: role === 'curator' ? 'Curator' : 'Community contributor',
      created_at: now, updated_at: now,
    });
  } catch {
    return Response.json({ outcome: 'invalid', field: 'file', reason: 'The file could not be stored.', recovery: 'Try the upload again.' }, { status: 500 });
  }

  await recordActivity(museumId, role === 'curator' ? 'Mina, Curator' : 'Community contributor', 'uploaded an asset', fileName, {
    tool: 'upload_asset', target: id, risk: 'MEDIUM', policyDecision: 'applied', result: id,
  });

  return Response.json({ outcome: 'applied', id, kind: allowed.kind, file_name: fileName, byte_size: file.size,
    width: dimensions?.width ?? null, height: dimensions?.height ?? null, url: `/api/assets/${id}` });
});
