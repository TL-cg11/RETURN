import { env } from 'cloudflare:workers';
import { DEMO_MUSEUM } from '@/lib/session';
import { buildSeedDataset, proposedDraft } from './seed-data';

export { proposedDraft } from './seed-data';

export const APPROVAL_TTL_MS = 24 * 60 * 60 * 1000;

type ColumnDefinition = { name: string; sql: string };

const LEGACY_COLUMNS: Record<'submissions' | 'approvals' | 'activity', ColumnDefinition[]> = {
  submissions: [
    { name: 'contributor_name', sql: 'contributor_name TEXT' },
    { name: 'contributor_role', sql: 'contributor_role TEXT' },
    { name: 'evidence_refs', sql: "evidence_refs TEXT NOT NULL DEFAULT '[]'" },
    { name: 'updated_at', sql: 'updated_at INTEGER NOT NULL DEFAULT 0' },
  ],
  approvals: [
    { name: 'tool', sql: "tool TEXT NOT NULL DEFAULT 'propose_label_update'" },
    { name: 'args_snapshot', sql: "args_snapshot TEXT NOT NULL DEFAULT '{}'" },
    { name: 'justification', sql: "justification TEXT NOT NULL DEFAULT ''" },
    { name: 'refs_authority', sql: "refs_authority TEXT NOT NULL DEFAULT '[]'" },
    { name: 'refs_consent', sql: "refs_consent TEXT NOT NULL DEFAULT '[]'" },
    { name: 'verdict', sql: 'verdict TEXT' },
    { name: 'edited_body', sql: 'edited_body TEXT' },
    { name: 'edit_reason', sql: 'edit_reason TEXT' },
    { name: 'expires_at', sql: 'expires_at INTEGER NOT NULL DEFAULT 0' },
  ],
  activity: [
    { name: 'actor_role', sql: "actor_role TEXT NOT NULL DEFAULT 'system'" },
    { name: 'actor_type', sql: "actor_type TEXT NOT NULL DEFAULT 'system'" },
    { name: 'tool', sql: "tool TEXT NOT NULL DEFAULT 'system'" },
    { name: 'target', sql: "target TEXT NOT NULL DEFAULT ''" },
    { name: 'risk', sql: "risk TEXT NOT NULL DEFAULT 'LOW'" },
    { name: 'policy_decision', sql: "policy_decision TEXT NOT NULL DEFAULT 'applied'" },
    { name: 'result', sql: "result TEXT NOT NULL DEFAULT 'recorded'" },
  ],
};

export async function sha256(value: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function createTables(d1: D1Database) {
  await d1.batch([
    d1.prepare('CREATE TABLE IF NOT EXISTS museums (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at INTEGER NOT NULL)'),
    d1.prepare("CREATE TABLE IF NOT EXISTS submissions (id TEXT PRIMARY KEY, museum_id TEXT NOT NULL, object_id TEXT NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL, source TEXT NOT NULL, consent TEXT NOT NULL, requested_outcome TEXT NOT NULL, contributor_name TEXT, contributor_role TEXT, evidence_refs TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'received', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL DEFAULT 0)"),
    d1.prepare("CREATE TABLE IF NOT EXISTS approvals (id TEXT PRIMARY KEY, museum_id TEXT NOT NULL, object_id TEXT NOT NULL, risk TEXT NOT NULL, snapshot TEXT NOT NULL, tool TEXT NOT NULL DEFAULT 'propose_label_update', args_snapshot TEXT NOT NULL DEFAULT '{}', snapshot_hash TEXT NOT NULL, object_version INTEGER NOT NULL, justification TEXT NOT NULL DEFAULT '', refs_authority TEXT NOT NULL DEFAULT '[]', refs_consent TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'pending', resolution TEXT, verdict TEXT, edited_body TEXT, edit_reason TEXT, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL DEFAULT 0, resolved_at INTEGER)"),
    d1.prepare("CREATE TABLE IF NOT EXISTS activity (id TEXT PRIMARY KEY, museum_id TEXT NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL, detail TEXT NOT NULL, created_at INTEGER NOT NULL, actor_role TEXT NOT NULL DEFAULT 'system', actor_type TEXT NOT NULL DEFAULT 'system', tool TEXT NOT NULL DEFAULT 'system', target TEXT NOT NULL DEFAULT '', risk TEXT NOT NULL DEFAULT 'LOW', policy_decision TEXT NOT NULL DEFAULT 'applied', result TEXT NOT NULL DEFAULT 'recorded')"),
    d1.prepare("CREATE TABLE IF NOT EXISTS escalations (id TEXT PRIMARY KEY, museum_id TEXT NOT NULL, object_id TEXT, tool TEXT NOT NULL, args TEXT NOT NULL DEFAULT '{}', policy TEXT NOT NULL, source_refs TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'open', created_at INTEGER NOT NULL, resolved_at INTEGER)"),
    d1.prepare("CREATE TABLE IF NOT EXISTS objects (id TEXT NOT NULL, museum_id TEXT NOT NULL, accession_number TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL, origin TEXT NOT NULL, period TEXT NOT NULL, object_type TEXT NOT NULL, material TEXT NOT NULL, acquisition_date TEXT, current_label_id TEXT, visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public','restricted','sealed')), provenance_completeness INTEGER NOT NULL DEFAULT 0, provenance_gap TEXT, record_status TEXT NOT NULL, display_tone TEXT NOT NULL, questions TEXT NOT NULL DEFAULT '[]', version INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (museum_id,id))"),
    d1.prepare("CREATE TABLE IF NOT EXISTS evidence (id TEXT NOT NULL, museum_id TEXT NOT NULL, object_id TEXT NOT NULL, type TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, source_name TEXT NOT NULL, source_relationship TEXT NOT NULL, date_or_period TEXT NOT NULL, place TEXT NOT NULL, authority TEXT NOT NULL CHECK (authority IN ('submitted','verified')), consent TEXT NOT NULL CHECK (consent IN ('private','research_only','public_anonymous','public_attributed')), visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public','restricted','sealed')), submitted_by TEXT NOT NULL, verified_by TEXT, verified_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (museum_id,id))"),
    d1.prepare("CREATE TABLE IF NOT EXISTS provenance_events (id TEXT NOT NULL, museum_id TEXT NOT NULL, object_id TEXT NOT NULL, start_date TEXT NOT NULL, end_date TEXT, title TEXT NOT NULL, detail TEXT NOT NULL, custodian TEXT, location TEXT, status TEXT NOT NULL CHECK (status IN ('claimed','verified','disputed','gap')), authority TEXT NOT NULL CHECK (authority IN ('submitted','verified')), evidence_refs TEXT NOT NULL DEFAULT '[]', is_gap INTEGER NOT NULL DEFAULT 0, sort_order INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (museum_id,id))"),
    d1.prepare("CREATE TABLE IF NOT EXISTS label_publications (id TEXT NOT NULL, museum_id TEXT NOT NULL, object_id TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, assertions TEXT NOT NULL DEFAULT '[]', evidence_refs TEXT NOT NULL DEFAULT '[]', revision_number INTEGER NOT NULL, approved_by TEXT NOT NULL, published_at INTEGER NOT NULL, superseded_at INTEGER, PRIMARY KEY (museum_id,id), UNIQUE (museum_id,object_id,revision_number))"),
    d1.prepare('CREATE INDEX IF NOT EXISTS idx_submissions_museum_status ON submissions(museum_id, status)'),
    d1.prepare('CREATE INDEX IF NOT EXISTS idx_approvals_museum_status ON approvals(museum_id, status)'),
    d1.prepare('CREATE INDEX IF NOT EXISTS idx_activity_museum_created ON activity(museum_id, created_at)'),
    d1.prepare('CREATE INDEX IF NOT EXISTS idx_objects_museum_visibility ON objects(museum_id, visibility)'),
    d1.prepare('CREATE INDEX IF NOT EXISTS idx_evidence_museum_object ON evidence(museum_id, object_id, visibility)'),
    d1.prepare('CREATE INDEX IF NOT EXISTS idx_provenance_museum_object ON provenance_events(museum_id, object_id, sort_order)'),
    d1.prepare('CREATE INDEX IF NOT EXISTS idx_labels_museum_object_revision ON label_publications(museum_id, object_id, revision_number)'),
    d1.prepare('CREATE UNIQUE INDEX IF NOT EXISTS uq_objects_museum_accession ON objects(museum_id, accession_number)'),
    d1.prepare('CREATE INDEX IF NOT EXISTS idx_escalations_museum_status_created ON escalations(museum_id, status, created_at)'),
  ]);
}

async function ensureLegacyColumns(d1: D1Database) {
  for (const [table, definitions] of Object.entries(LEGACY_COLUMNS)) {
    const info = await d1.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
    const existing = new Set((info.results ?? []).map((column) => column.name));
    for (const definition of definitions) {
      if (existing.has(definition.name)) continue;
      try {
        await d1.prepare(`ALTER TABLE ${table} ADD COLUMN ${definition.sql}`).run();
      } catch (error) {
        const refreshed = await d1.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
        if (!(refreshed.results ?? []).some((column) => column.name === definition.name)) throw error;
      }
    }
  }

  await d1.batch([
    d1.prepare("UPDATE submissions SET contributor_name=source, contributor_role='community', updated_at=created_at WHERE updated_at=0"),
    d1.prepare("UPDATE approvals SET args_snapshot=json_object('draft',snapshot,'object_id',object_id,'object_version',object_version), expires_at=created_at+? WHERE expires_at=0").bind(APPROVAL_TTL_MS),
  ]);
}

let schemaReady: Promise<void> | undefined;

async function ensureSchema(d1: D1Database) {
  schemaReady ??= (async () => {
    await createTables(d1);
    await ensureLegacyColumns(d1);
  })().catch((error) => {
    schemaReady = undefined;
    throw error;
  });
  return schemaReady;
}

/** Idempotently populate one tenant with the complete fictional demo dataset. */
export async function seedWorkspace(d1: D1Database, museumId: string) {
  const seed = buildSeedDataset(museumId);
  const statements: D1PreparedStatement[] = [
    d1.prepare('INSERT OR IGNORE INTO museums (id,name,created_at) VALUES (?,?,?)').bind(seed.museum.id, seed.museum.name, seed.museum.createdAt),
  ];

  for (const object of seed.objects) {
    statements.push(d1.prepare('INSERT OR IGNORE INTO objects (id,museum_id,accession_number,title,description,origin,period,object_type,material,acquisition_date,current_label_id,visibility,provenance_completeness,provenance_gap,record_status,display_tone,questions,version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .bind(object.id, museumId, object.accession, object.title, object.description, object.region, object.date, object.objectType, object.material, object.acquisitionDate, object.currentLabelId, object.visibility, object.completeness, object.gap, object.status, object.tone, JSON.stringify(object.questions), object.version, object.createdAt, object.updatedAt));
  }
  for (const item of seed.evidence) {
    statements.push(d1.prepare('INSERT OR IGNORE INTO evidence (id,museum_id,object_id,type,title,body,source_name,source_relationship,date_or_period,place,authority,consent,visibility,submitted_by,verified_by,verified_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .bind(item.id, museumId, item.objectId, item.type, item.title, item.body, item.sourceName, item.sourceRelationship, item.date, item.place, item.authority, item.consent, item.visibility, item.submittedBy, item.verifiedBy ?? null, item.verifiedAt, item.createdAt, item.updatedAt));
  }
  for (const event of seed.timeline) {
    statements.push(d1.prepare('INSERT OR IGNORE INTO provenance_events (id,museum_id,object_id,start_date,end_date,title,detail,custodian,location,status,authority,evidence_refs,is_gap,sort_order,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .bind(event.id, museumId, event.objectId, event.startDate, event.endDate, event.title, event.detail, event.custodian, event.location, event.status, event.authority, JSON.stringify(event.refs), event.gap ? 1 : 0, event.order, seed.museum.createdAt, seed.museum.createdAt));
  }
  for (const publication of seed.publications) {
    statements.push(d1.prepare('INSERT OR IGNORE INTO label_publications (id,museum_id,object_id,title,body,assertions,evidence_refs,revision_number,approved_by,published_at,superseded_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .bind(publication.id, museumId, publication.objectId, publication.title, publication.body, JSON.stringify(publication.assertions), JSON.stringify(publication.evidenceRefs), publication.revision, publication.approvedBy, publication.publishedAt, null));
  }
  for (const submission of seed.submissions) {
    statements.push(d1.prepare('INSERT OR IGNORE INTO submissions (id,museum_id,object_id,kind,title,description,source,consent,requested_outcome,contributor_name,contributor_role,evidence_refs,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .bind(submission.id, museumId, submission.objectId, submission.kind, submission.title, submission.description, submission.source, submission.consent, submission.requested, submission.source, 'community', '[]', submission.status, submission.createdAt, submission.createdAt));
  }
  for (const entry of seed.activities) {
    statements.push(d1.prepare('INSERT OR IGNORE INTO activity (id,museum_id,actor,action,detail,created_at,actor_role,actor_type,tool,target,risk,policy_decision,result) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .bind(entry.id, museumId, entry.actor, entry.action, entry.detail, entry.createdAt, entry.actorRole, entry.actorType, entry.tool, entry.target, entry.risk, entry.policyDecision, entry.result));
  }
  const argsSnapshot = JSON.stringify({ draft: proposedDraft, object_id: seed.approval.objectId, object_version: 3, assertions: [], evidence_refs: ['EV-068'] });
  statements.push(d1.prepare('INSERT OR IGNORE INTO approvals (id,museum_id,object_id,risk,snapshot,tool,args_snapshot,snapshot_hash,object_version,justification,refs_authority,refs_consent,status,resolution,verdict,edited_body,edit_reason,created_at,expires_at,resolved_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .bind(seed.approval.id, museumId, seed.approval.objectId, 'HIGH', proposedDraft, 'propose_label_update', argsSnapshot, await sha256(argsSnapshot), 3, 'Seeded label revision for human review', '["verified"]', '["public_attributed"]', 'pending', null, null, null, null, seed.approval.createdAt, seed.approval.createdAt + APPROVAL_TTL_MS, null));

  await d1.batch(statements);
}

export async function ensureDatabase(museumId: string = DEMO_MUSEUM) {
  const d1 = env.DB;
  if (!d1) throw new Error('D1 binding DB is unavailable');
  await ensureSchema(d1);
  const seeded = await d1.prepare('SELECT id FROM objects WHERE museum_id=? LIMIT 1').bind(museumId).first();
  if (!seeded) await seedWorkspace(d1, museumId);
  return d1;
}
