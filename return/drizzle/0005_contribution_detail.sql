-- FR-C1 / FR-C3 / FR-C4 — a contribution carries several kinds of material, and
-- each kind is asked its own questions.
--
-- `details` holds `[{kind, values}]` keyed by the field declarations in
-- `lib/community/contribution.ts`, so the form, the review step, the curator case,
-- and validation all read the same source. `description` is still written as prose
-- alongside it, because every existing curator surface renders that column.
ALTER TABLE `submissions` ADD `details` text DEFAULT '[]' NOT NULL;
--> statement-breakpoint
ALTER TABLE `submissions` ADD `asset_ids` text DEFAULT '[]' NOT NULL;
