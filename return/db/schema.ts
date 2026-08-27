import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const museums = sqliteTable('museums', { id:text('id').primaryKey(), name:text('name').notNull(), createdAt:integer('created_at').notNull() });
export const submissions = sqliteTable('submissions', {
  id:text('id').primaryKey(), museumId:text('museum_id').notNull(), objectId:text('object_id').notNull(), kind:text('kind').notNull(), title:text('title').notNull(),
  description:text('description').notNull(), source:text('source').notNull(), consent:text('consent').notNull(), requestedOutcome:text('requested_outcome').notNull(),
  contributorName:text('contributor_name'), contributorRole:text('contributor_role'), evidenceRefs:text('evidence_refs').notNull().default('[]'),
  status:text('status').notNull().default('received'), createdAt:integer('created_at').notNull(), updatedAt:integer('updated_at').notNull().default(0),
}, (table) => [index('idx_submissions_museum_status').on(table.museumId, table.status)]);
export const approvals = sqliteTable('approvals', {
  id:text('id').primaryKey(), museumId:text('museum_id').notNull(), objectId:text('object_id').notNull(), risk:text('risk').notNull(), snapshot:text('snapshot').notNull(),
  tool:text('tool').notNull().default('propose_label_update'), argsSnapshot:text('args_snapshot').notNull().default('{}'),
  snapshotHash:text('snapshot_hash').notNull(), objectVersion:integer('object_version').notNull(), justification:text('justification').notNull().default(''),
  refsAuthority:text('refs_authority').notNull().default('[]'), refsConsent:text('refs_consent').notNull().default('[]'),
  status:text('status').notNull().default('pending'), resolution:text('resolution'), verdict:text('verdict'), editedBody:text('edited_body'), editReason:text('edit_reason'),
  createdAt:integer('created_at').notNull(), expiresAt:integer('expires_at').notNull().default(0), resolvedAt:integer('resolved_at'),
}, (table) => [index('idx_approvals_museum_status').on(table.museumId, table.status)]);
export const activity = sqliteTable('activity', {
  id:text('id').primaryKey(), museumId:text('museum_id').notNull(), actor:text('actor').notNull(), action:text('action').notNull(), detail:text('detail').notNull(), createdAt:integer('created_at').notNull(),
  actorRole:text('actor_role').notNull().default('system'), actorType:text('actor_type').notNull().default('system'), tool:text('tool').notNull().default('system'),
  target:text('target').notNull().default(''), risk:text('risk').notNull().default('LOW'), policyDecision:text('policy_decision').notNull().default('applied'), result:text('result').notNull().default('recorded'),
}, (table) => [index('idx_activity_museum_created').on(table.museumId, table.createdAt)]);

export const escalations = sqliteTable('escalations', {
  id:text('id').primaryKey(), museumId:text('museum_id').notNull(), objectId:text('object_id'), tool:text('tool').notNull(), args:text('args').notNull().default('{}'),
  policy:text('policy').notNull(), sourceRefs:text('source_refs').notNull().default('[]'), status:text('status').notNull().default('open'),
  createdAt:integer('created_at').notNull(), resolvedAt:integer('resolved_at'),
}, (table) => [index('idx_escalations_museum_status_created').on(table.museumId, table.status, table.createdAt)]);

export const objects = sqliteTable('objects', {
  id: text('id').notNull(), museumId: text('museum_id').notNull(), accessionNumber: text('accession_number').notNull(), title: text('title').notNull(),
  description: text('description').notNull(), origin: text('origin').notNull(), period: text('period').notNull(), objectType: text('object_type').notNull(),
  material: text('material').notNull(), acquisitionDate: text('acquisition_date'), currentLabelId: text('current_label_id'), visibility: text('visibility').notNull().default('public'),
  provenanceCompleteness: integer('provenance_completeness').notNull().default(0), provenanceGap: text('provenance_gap'), recordStatus: text('record_status').notNull(),
  displayTone: text('display_tone').notNull(), questions: text('questions').notNull().default('[]'), version: integer('version').notNull().default(1),
  createdAt: integer('created_at').notNull(), updatedAt: integer('updated_at').notNull(),
}, (table) => [
  primaryKey({ columns: [table.museumId, table.id] }),
  uniqueIndex('uq_objects_museum_accession').on(table.museumId, table.accessionNumber),
  index('idx_objects_museum_visibility').on(table.museumId, table.visibility),
]);

export const evidence = sqliteTable('evidence', {
  id: text('id').notNull(), museumId: text('museum_id').notNull(), objectId: text('object_id').notNull(), type: text('type').notNull(), title: text('title').notNull(),
  body: text('body').notNull(), sourceName: text('source_name').notNull(), sourceRelationship: text('source_relationship').notNull(), dateOrPeriod: text('date_or_period').notNull(),
  place: text('place').notNull(), authority: text('authority').notNull(), consent: text('consent').notNull(), visibility: text('visibility').notNull().default('public'),
  submittedBy: text('submitted_by').notNull(), verifiedBy: text('verified_by'), verifiedAt: integer('verified_at'), createdAt: integer('created_at').notNull(), updatedAt: integer('updated_at').notNull(),
}, (table) => [primaryKey({ columns: [table.museumId, table.id] }), index('idx_evidence_museum_object').on(table.museumId, table.objectId, table.visibility)]);

export const provenanceEvents = sqliteTable('provenance_events', {
  id: text('id').notNull(), museumId: text('museum_id').notNull(), objectId: text('object_id').notNull(), startDate: text('start_date').notNull(), endDate: text('end_date'),
  title: text('title').notNull(), detail: text('detail').notNull(), custodian: text('custodian'), location: text('location'), status: text('status').notNull(),
  authority: text('authority').notNull(), evidenceRefs: text('evidence_refs').notNull().default('[]'), isGap: integer('is_gap', { mode: 'boolean' }).notNull().default(false),
  sortOrder: integer('sort_order').notNull(), createdAt: integer('created_at').notNull(), updatedAt: integer('updated_at').notNull(),
}, (table) => [primaryKey({ columns: [table.museumId, table.id] }), index('idx_provenance_museum_object').on(table.museumId, table.objectId, table.sortOrder)]);

export const labelPublications = sqliteTable('label_publications', {
  id: text('id').notNull(), museumId: text('museum_id').notNull(), objectId: text('object_id').notNull(), title: text('title').notNull(), body: text('body').notNull(),
  assertions: text('assertions').notNull().default('[]'), evidenceRefs: text('evidence_refs').notNull().default('[]'), revisionNumber: integer('revision_number').notNull(),
  approvedBy: text('approved_by').notNull(), publishedAt: integer('published_at').notNull(), supersededAt: integer('superseded_at'),
}, (table) => [
  primaryKey({ columns: [table.museumId, table.id] }),
  uniqueIndex('uq_labels_museum_object_revision').on(table.museumId, table.objectId, table.revisionNumber),
  index('idx_labels_museum_object_revision').on(table.museumId, table.objectId, table.revisionNumber),
]);
