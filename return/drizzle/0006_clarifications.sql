-- FR2-K1 — a curator's follow-up question, where the contributor can read it.
--
-- It used to exist only inside an activity log detail string, so the person being asked
-- never saw what was asked. A list rather than a single column because a review can need
-- more than one question, and replacing the previous one would erase what was already
-- asked from the only screen a curator can see it on.
ALTER TABLE `submissions` ADD `clarifications` text DEFAULT '[]' NOT NULL;
