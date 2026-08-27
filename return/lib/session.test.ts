import test from 'node:test';
import assert from 'node:assert/strict';
import { sessionCookieHeaders, signSession, verifySession } from './session-cookie.ts';

const SECRET = 'unit-test-session-secret-that-is-at-least-32-characters';

test('a signed role and museum pair round-trips', async () => {
  const signed = await signSession({ role: 'curator', museumId: 'museum_test_a' }, SECRET);
  assert.deepEqual(await verifySession(signed.role, signed.museumId, SECRET), {
    role: 'curator', museumId: 'museum_test_a',
  });
});

test('editing a signed role invalidates the whole session', async () => {
  const signed = await signSession({ role: 'community', museumId: 'museum_test_a' }, SECRET);
  const forgedRole = signed.role.replace(/^Y29tbXVuaXR5/, 'Y3VyYXRvcg');
  assert.equal(await verifySession(forgedRole, signed.museumId, SECRET), null);
});

test('mixing signed fields from two workspaces is rejected', async () => {
  const first = await signSession({ role: 'curator', museumId: 'museum_test_a' }, SECRET);
  const second = await signSession({ role: 'curator', museumId: 'museum_test_b' }, SECRET);
  assert.equal(await verifySession(first.role, second.museumId, SECRET), null);
});

test('plaintext curator cookies cannot be verified', async () => {
  assert.equal(await verifySession('curator', 'museum_attacker', SECRET), null);
});

test('session cookies are HttpOnly and become Secure over HTTPS', async () => {
  const values = await sessionCookieHeaders({ role: 'community', museumId: 'museum_test_a' }, 'https://return.example', SECRET);
  assert.equal(values.length, 2);
  for (const value of values) {
    assert.match(value, /HttpOnly/);
    assert.match(value, /SameSite=Lax/);
    assert.match(value, /; Secure$/);
  }
});
