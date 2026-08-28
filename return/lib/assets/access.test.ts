import assert from 'node:assert/strict';
import test from 'node:test';
import { ASSET_KINDS, assetAccess, isAllowedUpload, MAX_ASSET_BYTES, MAX_ASSETS_PER_CONTRIBUTION } from './access.ts';
import type { AssetLike } from './access.ts';
import { isQuotable } from '../domain/types.ts';

const asset = (over: Partial<AssetLike> = {}): AssetLike =>
  ({ museumId: 'museum_demo_01', visibility: 'public', consent: 'public_attributed', ...over });

/* Serving. The rule is one sentence: an asset is public only when its visibility
   is public and its consent permits public display. Everything else is curator-only,
   and `sealed` denies its own existence. */
test('a public, publicly-consented asset is served to anyone', () => {
  assert.equal(assetAccess(asset(), { role: 'community', museumId: 'museum_demo_01' }), 'serve');
  assert.equal(assetAccess(asset(), { role: 'curator', museumId: 'museum_demo_01' }), 'serve');
});
test('public_anonymous is also publicly displayable', () => {
  assert.equal(assetAccess(asset({ consent: 'public_anonymous' }), { role: 'community', museumId: 'museum_demo_01' }), 'serve');
});
test('private consent blocks public display even when visibility is public', () => {
  assert.equal(assetAccess(asset({ consent: 'private' }), { role: 'community', museumId: 'museum_demo_01' }), 'deny');
  assert.equal(assetAccess(asset({ consent: 'private' }), { role: 'curator', museumId: 'museum_demo_01' }), 'serve');
});
test('restricted visibility is curator-only', () => {
  assert.equal(assetAccess(asset({ visibility: 'restricted' }), { role: 'community', museumId: 'museum_demo_01' }), 'deny');
  assert.equal(assetAccess(asset({ visibility: 'restricted' }), { role: 'curator', museumId: 'museum_demo_01' }), 'serve');
});
test('sealed hides its own existence from the community', () => {
  assert.equal(assetAccess(asset({ visibility: 'sealed' }), { role: 'community', museumId: 'museum_demo_01' }), 'absent');
});
test('sealed is not served to a curator over the web path either', () => {
  assert.equal(assetAccess(asset({ visibility: 'sealed' }), { role: 'curator', museumId: 'museum_demo_01' }), 'absent');
});
test('another workspace cannot read an asset at any role', () => {
  for (const role of ['community', 'curator'] as const) {
    assert.equal(assetAccess(asset(), { role, museumId: 'museum_other_02' }), 'absent');
    assert.equal(assetAccess(asset({ visibility: 'restricted' }), { role, museumId: 'museum_other_02' }), 'absent');
  }
});
test('tenancy is judged before visibility, so a foreign curator learns nothing', () => {
  assert.equal(assetAccess(asset({ visibility: 'restricted', consent: 'private' }), { role: 'curator', museumId: 'museum_other_02' }), 'absent');
});

/* Upload validation. */
test('the image and document types the contribution flow offers are accepted', () => {
  assert.equal(isAllowedUpload('image/jpeg', 1024)?.kind, 'image');
  assert.equal(isAllowedUpload('image/png', 1024)?.kind, 'image');
  assert.equal(isAllowedUpload('image/webp', 1024)?.kind, 'image');
  assert.equal(isAllowedUpload('application/pdf', 1024)?.kind, 'document');
  assert.equal(isAllowedUpload('audio/mpeg', 1024)?.kind, 'audio');
});
test('an executable disguised by extension is refused on its media type', () => {
  assert.equal(isAllowedUpload('application/x-msdownload', 1024), null);
  assert.equal(isAllowedUpload('text/html', 1024), null);
  assert.equal(isAllowedUpload('image/svg+xml', 1024), null, 'svg carries script and must not be served inline');
});
test('an oversized file is refused', () => {
  assert.equal(isAllowedUpload('image/jpeg', MAX_ASSET_BYTES + 1), null);
  assert.notEqual(isAllowedUpload('image/jpeg', MAX_ASSET_BYTES), null);
});
test('an empty file is refused', () => {
  assert.equal(isAllowedUpload('image/jpeg', 0), null);
});
test('the per-contribution count cap is a positive number', () => {
  assert.ok(MAX_ASSETS_PER_CONTRIBUTION > 1);
});
test('every allowed media type maps to a declared asset kind', () => {
  for (const type of ['image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'audio/mpeg']) {
    const allowed = isAllowedUpload(type, 10);
    assert.ok(allowed && ASSET_KINDS.includes(allowed.kind));
  }
});

/* MCP-E2 — consent is a permission that must be present, not the absence of `private`.
   A value this system never defined (a typo, a level from a schema that has not shipped,
   a string an agent invented and an unvalidated write stored) used to satisfy
   `consent !== 'private'` and open the file to the public. */
test('an unrecognised consent level is not served publicly', () => {
  const rogue = asset({ consent: 'community_only' as AssetLike['consent'] });
  assert.equal(assetAccess(rogue, { role: 'community', museumId: 'museum_demo_01' }), 'deny');
  assert.equal(assetAccess(rogue, { role: 'curator', museumId: 'museum_demo_01' }), 'serve',
    'a curator may still study it; only public display is withheld');
});
test('isQuotable names the two levels that permit publication', () => {
  assert.equal(isQuotable('public_attributed'), true);
  assert.equal(isQuotable('public_anonymous'), true);
  assert.equal(isQuotable('private'), false);
  for (const value of ['community_only', 'research_only', '', undefined, null, 'PUBLIC_ATTRIBUTED']) {
    assert.equal(isQuotable(value), false, `${String(value)} is not a consent level this system granted`);
  }
});
