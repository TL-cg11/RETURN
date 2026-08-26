CREATE TABLE IF NOT EXISTS museums (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS submissions (
  id TEXT PRIMARY KEY,
  museum_id TEXT NOT NULL,
  object_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  source TEXT NOT NULL,
  consent TEXT NOT NULL,
  requested_outcome TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'received',
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY,
  museum_id TEXT NOT NULL,
  object_id TEXT NOT NULL,
  risk TEXT NOT NULL,
  snapshot TEXT NOT NULL,
  snapshot_hash TEXT NOT NULL,
  object_version INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  resolution TEXT,
  created_at INTEGER NOT NULL,
  resolved_at INTEGER
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS activity (
  id TEXT PRIMARY KEY,
  museum_id TEXT NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  detail TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_submissions_museum_status ON submissions(museum_id, status);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_approvals_museum_status ON approvals(museum_id, status);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_activity_museum_created ON activity(museum_id, created_at);
--> statement-breakpoint
PRAGMA optimize;
