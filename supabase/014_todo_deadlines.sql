-- Things — deadlines on to-dos
--
-- Run once in the SQL Editor if your database predates this. Safe to run more
-- than once.

-- ---------------------------------------------------------------------------
-- When a to-do is actually due. Null means no deadline, which stays the normal
-- case — most things on the list are "sometime", and forcing a date on them
-- would make the list read as a wall of obligations.
--
-- Deliberately NOT reusing the chores machinery: next_due_at there is derived
-- by a trigger from a recurrence rule and is not something a person sets. This
-- is the opposite — a date someone chose, that nothing recomputes.
-- ---------------------------------------------------------------------------
alter table todos add column if not exists due_at timestamptz;

-- Sorting and "what's overdue" both scan this, and only rows that have one
-- matter, so the index skips the majority that don't.
create index if not exists todos_due_idx on todos (due_at) where due_at is not null;
