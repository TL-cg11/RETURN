ALTER TABLE `submissions` ADD `contributor_name` text;
--> statement-breakpoint
ALTER TABLE `submissions` ADD `contributor_role` text;
--> statement-breakpoint
ALTER TABLE `submissions` ADD `evidence_refs` text DEFAULT '[]' NOT NULL;
--> statement-breakpoint
ALTER TABLE `submissions` ADD `updated_at` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
UPDATE `submissions`
SET `contributor_name` = `source`,
    `contributor_role` = 'community',
    `updated_at` = `created_at`
WHERE `updated_at` = 0;
--> statement-breakpoint

ALTER TABLE `approvals` ADD `tool` text DEFAULT 'propose_label_update' NOT NULL;
--> statement-breakpoint
ALTER TABLE `approvals` ADD `args_snapshot` text DEFAULT '{}' NOT NULL;
--> statement-breakpoint
ALTER TABLE `approvals` ADD `justification` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `approvals` ADD `refs_authority` text DEFAULT '[]' NOT NULL;
--> statement-breakpoint
ALTER TABLE `approvals` ADD `refs_consent` text DEFAULT '[]' NOT NULL;
--> statement-breakpoint
ALTER TABLE `approvals` ADD `verdict` text;
--> statement-breakpoint
ALTER TABLE `approvals` ADD `edited_body` text;
--> statement-breakpoint
ALTER TABLE `approvals` ADD `edit_reason` text;
--> statement-breakpoint
ALTER TABLE `approvals` ADD `expires_at` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
UPDATE `approvals`
SET `args_snapshot` = json_object('draft', `snapshot`, 'object_id', `object_id`, 'object_version', `object_version`),
    `expires_at` = `created_at` + 86400000
WHERE `expires_at` = 0;
--> statement-breakpoint

ALTER TABLE `activity` ADD `actor_role` text DEFAULT 'system' NOT NULL;
--> statement-breakpoint
ALTER TABLE `activity` ADD `actor_type` text DEFAULT 'system' NOT NULL;
--> statement-breakpoint
ALTER TABLE `activity` ADD `tool` text DEFAULT 'system' NOT NULL;
--> statement-breakpoint
ALTER TABLE `activity` ADD `target` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `activity` ADD `risk` text DEFAULT 'LOW' NOT NULL;
--> statement-breakpoint
ALTER TABLE `activity` ADD `policy_decision` text DEFAULT 'applied' NOT NULL;
--> statement-breakpoint
ALTER TABLE `activity` ADD `result` text DEFAULT 'recorded' NOT NULL;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `escalations` (
	`id` text PRIMARY KEY NOT NULL,
	`museum_id` text NOT NULL,
	`object_id` text,
	`tool` text NOT NULL,
	`args` text DEFAULT '{}' NOT NULL,
	`policy` text NOT NULL,
	`source_refs` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` integer NOT NULL,
	`resolved_at` integer
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_escalations_museum_status_created` ON `escalations` (`museum_id`,`status`,`created_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `uq_objects_museum_accession` ON `objects` (`museum_id`,`accession_number`);
--> statement-breakpoint
PRAGMA optimize;
