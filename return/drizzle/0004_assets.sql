-- FR-D1 / FR-D2 — contribution and record assets.
-- Bytes live in R2 under `storage_key`; this row is the only thing that decides
-- who may read them. Defaults are the closed ones: a new upload is `restricted`
-- and `private` until a curator opens it.
CREATE TABLE IF NOT EXISTS `assets` (
	`id` text NOT NULL,
	`museum_id` text NOT NULL,
	`object_id` text,
	`submission_id` text,
	`evidence_id` text,
	`kind` text NOT NULL CHECK (`kind` IN ('image','document','audio')),
	`content_type` text NOT NULL,
	`storage_key` text NOT NULL,
	`file_name` text NOT NULL,
	`alt_text` text DEFAULT '' NOT NULL,
	`caption` text DEFAULT '' NOT NULL,
	`visibility` text DEFAULT 'restricted' NOT NULL CHECK (`visibility` IN ('public','restricted','sealed')),
	`consent` text DEFAULT 'private' NOT NULL CHECK (`consent` IN ('private','public_anonymous','public_attributed')),
	`byte_size` integer NOT NULL,
	`width` integer,
	`height` integer,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`uploaded_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY (`museum_id`, `id`)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_assets_museum_object` ON `assets` (`museum_id`, `object_id`, `sort_order`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_assets_museum_submission` ON `assets` (`museum_id`, `submission_id`);
