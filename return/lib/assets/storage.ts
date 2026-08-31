import { env } from 'cloudflare:workers';

/**
 * R2 access for contribution and record assets.
 *
 * The key carries the workspace, so a tenancy mistake in a query cannot reach
 * another museum's bytes by object key alone. Nothing here decides who may read
 * an asset — that is `assetAccess` in `./access.ts`, which every caller runs
 * against the database row before asking for the body.
 */
function bucket(): R2Bucket {
  const media = (env as unknown as { MEDIA?: R2Bucket }).MEDIA;
  if (!media) throw new Error('R2 binding MEDIA is unavailable');
  return media;
}

export function storageKeyFor(museumId: string, assetId: string, fileName: string) {
  const extension = fileName.includes('.') ? fileName.split('.').pop()!.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8) : '';
  return `${museumId}/${assetId}${extension ? `.${extension}` : ''}`;
}

export async function putAsset(key: string, body: ArrayBuffer, contentType: string) {
  await bucket().put(key, body, { httpMetadata: { contentType } });
}

export async function getAsset(key: string) {
  return await bucket().get(key);
}

export async function deleteAsset(key: string) {
  await bucket().delete(key);
}
