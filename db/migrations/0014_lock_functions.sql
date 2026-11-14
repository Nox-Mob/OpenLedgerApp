-- Security review round 2 (2026-11-14): this repo's schemas through core 0018's tuning, which now
-- also takes the run right off every function for visitors who aren't signed in (only the
-- invitation page and the waitlist are for them). Signed-in and server access stay as they were.
select public._tune_schema('ledger');
