import { env } from 'cloudflare:workers';
import { activities, moonbird, seedSubmissions } from '@/lib/demo-data';
import { DEMO_MUSEUM } from '@/lib/session';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** Offsets that give the seeded workspace a plausible recent history. */
const submissionAge = [18 * MINUTE, 26 * HOUR, 50 * HOUR];
const activityAge = [18 * MINUTE, 14 * MINUTE, 11 * MINUTE, 8 * MINUTE, 3 * MINUTE];

export const PENDING_APPROVAL_ID = 'APR-004';

export const proposedDraft =
  'The mask appears in a 1959 community photograph from Aru village. Its movement and acquisition circumstances from 1959 to 1968 remain under joint research.';

export async function sha256(value: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function createTables(d1: D1Database) {
  await d1.batch([
    d1.prepare('CREATE TABLE IF NOT EXISTS museums (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at INTEGER NOT NULL)'),
    d1.prepare("CREATE TABLE IF NOT EXISTS submissions (id TEXT PRIMARY KEY, museum_id TEXT NOT NULL, object_id TEXT NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL, source TEXT NOT NULL, consent TEXT NOT NULL, requested_outcome TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'received', created_at INTEGER NOT NULL)"),
    d1.prepare("CREATE TABLE IF NOT EXISTS approvals (id TEXT PRIMARY KEY, museum_id TEXT NOT NULL, object_id TEXT NOT NULL, risk TEXT NOT NULL, snapshot TEXT NOT NULL, snapshot_hash TEXT NOT NULL, object_version INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending', resolution TEXT, created_at INTEGER NOT NULL, resolved_at INTEGER)"),
    d1.prepare('CREATE TABLE IF NOT EXISTS activity (id TEXT PRIMARY KEY, museum_id TEXT NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL, detail TEXT NOT NULL, created_at INTEGER NOT NULL)'),
    d1.prepare('CREATE INDEX IF NOT EXISTS idx_submissions_museum_status ON submissions(museum_id, status)'),
    d1.prepare('CREATE INDEX IF NOT EXISTS idx_approvals_museum_status ON approvals(museum_id, status)'),
    d1.prepare('CREATE INDEX IF NOT EXISTS idx_activity_museum_created ON activity(museum_id, created_at)'),
  ]);
}

/** Populate a workspace with the fictional starting record. Runs once per museum id. */
export async function seedWorkspace(d1: D1Database, museumId: string) {
  const now = Date.now();
  const statements = [
    d1.prepare('INSERT OR IGNORE INTO museums (id,name,created_at) VALUES (?,?,?)').bind(museumId, 'The Halcyon Museum of Material Memory', now),
    ...seedSubmissions.map((s, i) =>
      d1.prepare('INSERT OR IGNORE INTO submissions (id,museum_id,object_id,kind,title,description,source,consent,requested_outcome,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
        .bind(s.id, museumId, s.objectId, s.kind, s.title, s.note, s.contributor, s.consent, s.requested, s.status, now - (submissionAge[i] ?? HOUR))),
    ...activities.map((a, i) =>
      d1.prepare('INSERT OR IGNORE INTO activity (id,museum_id,actor,action,detail,created_at) VALUES (?,?,?,?,?,?)')
        .bind(`${museumId}-seed-${i}`, museumId, a.actor, a.action, a.detail, now - (activityAge[i] ?? MINUTE))),
    d1.prepare('INSERT OR IGNORE INTO approvals (id,museum_id,object_id,risk,snapshot,snapshot_hash,object_version,status,resolution,created_at,resolved_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .bind(PENDING_APPROVAL_ID, museumId, 'moonbird-mask', 'HIGH', proposedDraft, await sha256(proposedDraft), moonbird.version, 'pending', null, now - 3 * MINUTE, null),
  ];
  await d1.batch(statements);
}

export async function ensureDatabase(museumId: string = DEMO_MUSEUM) {
  const d1 = env.DB;
  if (!d1) throw new Error('D1 binding DB is unavailable');
  await createTables(d1);
  const existing = await d1.prepare('SELECT id FROM museums WHERE id=?').bind(museumId).first();
  if (!existing) await seedWorkspace(d1, museumId);
  return d1;
}
