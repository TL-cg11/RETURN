import type { Consent, Visibility } from '../domain/types.ts';
import { isQuotable } from '../domain/types.ts';
import type { Role } from '../session-cookie';

export const ASSET_KINDS = ['image', 'document', 'audio'] as const;
export type AssetKind = typeof ASSET_KINDS[number];

/** One asset is at most 8 MB. The demo stores photographs and scans, not masters. */
export const MAX_ASSET_BYTES = 8 * 1024 * 1024;
export const MAX_ASSETS_PER_CONTRIBUTION = 8;

/**
 * Media types the upload route accepts, and the kind each becomes.
 * `image/svg+xml` is absent on purpose: SVG is script-bearing markup, and this
 * pipeline serves uploads from the application origin.
 */
const ALLOWED: Record<string, AssetKind> = {
  'image/jpeg': 'image',
  'image/png': 'image',
  'image/webp': 'image',
  'image/gif': 'image',
  'application/pdf': 'document',
  'audio/mpeg': 'audio',
  'audio/wav': 'audio',
  'audio/mp4': 'audio',
};

export function isAllowedUpload(contentType: string, byteSize: number) {
  const kind = ALLOWED[contentType.split(';')[0].trim().toLowerCase()];
  if (!kind || byteSize <= 0 || byteSize > MAX_ASSET_BYTES) return null;
  return { kind };
}

export type AssetLike = { museumId: string; visibility: Visibility; consent: Consent };
export type AssetAccess = 'serve' | 'deny' | 'absent';

/**
 * The single gate every asset path goes through.
 *
 * `absent` means the caller must not learn the asset exists — a 404, never a 403.
 * It covers another workspace's assets and every `sealed` asset, which
 * `RETURN_PLAN.md` §5.3 keeps out of agent and web output without a human process.
 *
 * Tenancy is judged first, so a curator of another museum learns nothing about
 * this one's restricted material. Consent is judged alongside visibility because
 * §5.2 makes public display conditional on consent: non-public material may be
 * studied internally but never displayed, even if the record itself is public.
 *
 * Consent is read as a permission that has to be present, not as an absence of
 * `private` (MCP-E2). Serving on `consent !== 'private'` meant any value this system
 * did not define — a typo, a level from a future schema, a string an agent invented —
 * opened the file to the public. The two levels that permit publication are named.
 */
export function assetAccess(asset: AssetLike, session: { role: Role; museumId: string }): AssetAccess {
  if (asset.museumId !== session.museumId) return 'absent';
  if (asset.visibility === 'sealed') return 'absent';
  if (asset.visibility === 'public' && isQuotable(asset.consent)) return 'serve';
  return session.role === 'curator' ? 'serve' : 'deny';
}
