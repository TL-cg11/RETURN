-- FR-X1 — the consent ladder drops `research_only`.
-- No code path distinguished it from `private`: both were withheld from public
-- output, from public label quotation, and from agent tool bodies. Existing rows
-- move to `private`, which is the nearest surviving level.
UPDATE `evidence` SET `consent` = 'private' WHERE `consent` = 'research_only';
--> statement-breakpoint
UPDATE `submissions` SET `consent` = 'private' WHERE `consent` = 'research_only';
--> statement-breakpoint

-- SQLite cannot alter a CHECK constraint in place, so the narrowed constraint
-- reaches existing databases only by table rebuild. The old constraint is wider
-- than the new one and still admits every value the application now writes, so
-- the rebuild is deferred rather than forced on a live workspace. New databases
-- are created with the three-level constraint by `db/setup.ts`.

-- `approvals.args_snapshot` is deliberately untouched. It is hashed into
-- `snapshot_hash` for tamper detection, and `propose_label_update` evaluates with
-- `publicOutput`, so a non-public consent can never have entered a stored snapshot.
