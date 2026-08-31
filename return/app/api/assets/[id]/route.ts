import { getAsset as getAssetRow } from '@/db/queries';
import { assetAccess } from '@/lib/assets/access';
import { getAsset } from '@/lib/assets/storage';
import { sessionFromRequest } from '@/lib/session';
import { isQuotable, type Consent, type Visibility } from '@/lib/domain/types';

export const dynamic = 'force-dynamic';

/**
 * The only path that returns asset bytes. `assetAccess` decides, and its three
 * answers map onto three different responses on purpose: `absent` must not reveal
 * that the asset exists, so a sealed or foreign asset 404s exactly like a typo.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await sessionFromRequest(request);
  // `?download=1` asks for the file rather than a view of it (FR2-D2). It changes only
  // the disposition — the access decision below is identical either way, so a download
  // link can never reach material the inline view would refuse.
  const asDownload = new URL(request.url).searchParams.get('download') === '1';
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

  // The one branch of `assetAccess` that does not consult the role: these bytes are the
  // same answer for every caller, so a cache holding them cannot answer for the wrong one.
  const servedToAnyone = row.visibility === 'public' && isQuotable(row.consent as Consent);

  return new Response(object.body, {
    headers: {
      'content-type': row.content_type,
      'content-length': String(row.byte_size),
      // A photograph is shown inline so the gallery can draw it. Everything else is handed
      // over, because an uploaded document renders in its own context rather than this
      // origin's — and `?download=1` asks for that treatment for a photograph too.
      'content-disposition': row.kind === 'image' && !asDownload
        ? 'inline'
        : `attachment; filename="${row.file_name.replaceAll('"', '')}"`,
      'content-security-policy': "default-src 'none'; sandbox",
      'x-content-type-options': 'nosniff',
      /**
       * Only material anyone may see is worth storing (V10-2).
       *
       * `private, max-age=300` on every asset was wrong for the ones a role decides.
       * `private` excludes shared caches; it does not exclude the viewer's own, and the
       * role that decided this response lives in a cookie the cache never looked at. A
       * curator who read a restricted file and switched to the community view could read
       * it again from that cache for five minutes without the server being asked.
       *
       * A publicly-served asset is the same bytes for everyone, so it keeps the window.
       * Anything reached on the strength of a role is not stored at all, and `Vary` says
       * why for whatever cache does look.
       */
      'cache-control': servedToAnyone ? 'private, max-age=300' : 'no-store',
      vary: 'Cookie',
    },
  });
}
