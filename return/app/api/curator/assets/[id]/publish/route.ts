import { getAsset, recordActivity, setAssetVisibility } from '@/db/queries';
import type { Consent } from '@/lib/domain/types';
import { evaluatePolicy } from '@/lib/policy/evaluate';
import { guardedWrite, readJsonBody, refused } from '@/lib/http/input';

/**
 * Opens one asset to public display, or withdraws it again.
 *
 * FR-D1 made every upload arrive `restricted`, which left no way for anything to
 * ever become public. This is that act, and it is a curator's alone.
 *
 * The gateway judges it like any other consequential action. The asset is offered
 * with the visibility being *requested*, so only its consent decides — asking
 * whether restricted material may be shown publicly would always answer no and the
 * question could never be put.
 */
export const POST = guardedWrite(async (request: Request, session, { params }: { params: Promise<{ id: string }> }) => {
  const { role, museumId } = session;
  if (role !== 'curator') return Response.json({ outcome: 'denied', risk: 'LOW', reason: 'Curator role required.', recovery: 'Switch to the curator workspace.' }, { status: 403 });

  const { id } = await params;
  const parsed = await readJsonBody(request);
  if (refused(parsed)) return parsed.refusal;
  if (parsed.publish !== undefined && typeof parsed.publish !== 'boolean') {
    return Response.json({ outcome: 'invalid', field: 'publish', reason: 'Publish must be true or false.', recovery: 'Send { "publish": false } to withdraw, or no body to publish.' }, { status: 400 });
  }
  const publish = parsed.publish !== false;

  const asset = await getAsset(museumId, id);
  // A sealed asset answers as absent here too, so this route cannot be used to
  // discover that one exists.
  if (!asset || asset.visibility === 'sealed') return Response.json({ outcome: 'invalid', field: 'asset_id', reason: 'No asset with that id is available in this workspace.', recovery: 'Call list_object_assets to see what is available.' }, { status: 404 });

  const policy = evaluatePolicy({
    actor: 'curator_ui', action: 'publish_asset', museumMatch: asset.museum_id === museumId,
    publicOutput: publish,
    refs: [{ authority: 'submitted', consent: asset.consent as Consent, visibility: 'public' }],
  });
  if (policy.outcome !== 'applied') {
    await recordActivity(museumId, 'Policy Gateway', 'refused to publish an asset', `${asset.file_name} · ${policy.reason}`, {
      actorRole: 'curator_ui', actorType: 'human', tool: 'publish_asset', target: id,
      risk: policy.risk, policyDecision: policy.outcome, result: policy.policy ?? 'denied',
    });
    return Response.json({ ...policy, asset_id: id }, { status: 403 });
  }

  const changed = await setAssetVisibility(museumId, id, publish ? 'public' : 'restricted');
  if (!changed) return Response.json({ outcome: 'invalid', field: 'asset_id', reason: 'No asset with that id is available in this workspace.', recovery: 'Call list_object_assets to see what is available.' }, { status: 404 });
  await recordActivity(museumId, 'Mina, Curator', publish ? 'published an asset to the public record' : 'withdrew an asset from public display', asset.file_name, {
    actorRole: 'curator_ui', actorType: 'human', tool: 'publish_asset', target: id,
    risk: policy.risk, policyDecision: 'applied', result: publish ? 'public' : 'restricted',
  });
  return Response.json({ ...policy, asset_id: id, visibility: publish ? 'public' : 'restricted' });
});
