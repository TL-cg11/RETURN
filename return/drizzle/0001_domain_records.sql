CREATE TABLE `objects` (
	`id` text NOT NULL,
	`museum_id` text NOT NULL,
	`accession_number` text NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`origin` text NOT NULL,
	`period` text NOT NULL,
	`object_type` text NOT NULL,
	`material` text NOT NULL,
	`acquisition_date` text,
	`current_label_id` text,
	`visibility` text DEFAULT 'public' NOT NULL CHECK (`visibility` IN ('public','restricted','sealed')),
	`provenance_completeness` integer DEFAULT 0 NOT NULL,
	`provenance_gap` text,
	`record_status` text NOT NULL,
	`display_tone` text NOT NULL,
	`questions` text DEFAULT '[]' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`museum_id`, `id`)
);
--> statement-breakpoint
CREATE INDEX `idx_objects_museum_visibility` ON `objects` (`museum_id`,`visibility`);
--> statement-breakpoint
CREATE TABLE `evidence` (
	`id` text NOT NULL,
	`museum_id` text NOT NULL,
	`object_id` text NOT NULL,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`source_name` text NOT NULL,
	`source_relationship` text NOT NULL,
	`date_or_period` text NOT NULL,
	`place` text NOT NULL,
	`authority` text NOT NULL CHECK (`authority` IN ('submitted','verified')),
	`consent` text NOT NULL CHECK (`consent` IN ('private','research_only','public_anonymous','public_attributed')),
	`visibility` text DEFAULT 'public' NOT NULL CHECK (`visibility` IN ('public','restricted','sealed')),
	`submitted_by` text NOT NULL,
	`verified_by` text,
	`verified_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`museum_id`, `id`)
);
--> statement-breakpoint
CREATE INDEX `idx_evidence_museum_object` ON `evidence` (`museum_id`,`object_id`,`visibility`);
--> statement-breakpoint
CREATE TABLE `provenance_events` (
	`id` text NOT NULL,
	`museum_id` text NOT NULL,
	`object_id` text NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text,
	`title` text NOT NULL,
	`detail` text NOT NULL,
	`custodian` text,
	`location` text,
	`status` text NOT NULL CHECK (`status` IN ('claimed','verified','disputed','gap')),
	`authority` text NOT NULL CHECK (`authority` IN ('submitted','verified')),
	`evidence_refs` text DEFAULT '[]' NOT NULL,
	`is_gap` integer DEFAULT 0 NOT NULL,
	`sort_order` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`museum_id`, `id`)
);
--> statement-breakpoint
CREATE INDEX `idx_provenance_museum_object` ON `provenance_events` (`museum_id`,`object_id`,`sort_order`);
--> statement-breakpoint
CREATE TABLE `label_publications` (
	`id` text NOT NULL,
	`museum_id` text NOT NULL,
	`object_id` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`assertions` text DEFAULT '[]' NOT NULL,
	`evidence_refs` text DEFAULT '[]' NOT NULL,
	`revision_number` integer NOT NULL,
	`approved_by` text NOT NULL,
	`published_at` integer NOT NULL,
	`superseded_at` integer,
	PRIMARY KEY(`museum_id`, `id`),
	UNIQUE(`museum_id`,`object_id`,`revision_number`)
);
--> statement-breakpoint
CREATE INDEX `idx_labels_museum_object_revision` ON `label_publications` (`museum_id`,`object_id`,`revision_number`);
