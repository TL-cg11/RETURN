import { getAsset as getAssetRow } from '@/db/queries';
import { assetAccess } from '@/lib/assets/access';
import { getAsset } from '@/lib/assets/storage';
import { sessionFromRequest } from '@/lib/session';
import type { Consent, Visibility } from '@/lib/domain/types';

export const dynamic = 'force-dynamic';

/**
 * The only path that returns asset bytes. `assetAccess` decides, and its three
 * answers map onto three different responses on purpose: `absent` must not reveal
 * that the asset exists, so a sealed or foreign asset 404s exactly like a typo.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await sessionFromRequest(request);
  const row = await getAssetRow(session.museumId, id);
  if (!row) return new Response('Not found', { status: 404 });

  const access = assetAccess(
    { museumId: row.museum_id, visibility: row.visibility as Visibility, consent: row.consent as Consent },
    session,
  );
  if (access === 'absent') return new Response('Not found', { status: 404 });
  if (access === 'deny') return new Response('This material is not available for public display.', { status: 403 });

  const object = await getAsset(row.storage_key);
  if (!object) return new Response('Not found', { status: 404 });

  return new Response(object.body, {
    headers: {
      'content-type': row.content_type,
      'content-length': String(row.byte_size),
      // Never inline: an uploaded document renders in its own context, not this origin's.
      'content-disposition': row.kind === 'image' ? 'inline' : `attachment; filename="${row.file_name.replaceAll('"', '')}"`,
      'content-security-policy': "default-src 'none'; sandbox",
      'x-content-type-options': 'nosniff',
      // Access depends on the session role, so a shared cache must not answer for another.
      'cache-control': 'private, max-age=300',
    },
  });
}
