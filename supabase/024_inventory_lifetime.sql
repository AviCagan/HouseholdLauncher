-- Household Launcher — Inventory: lifetime warranties
--
-- Safe to run more than once. Run it after 023_inventory.sql.
--
-- Some things are covered for as long as you own them — a lifetime warranty
-- on a tool, a cooler, a backpack. A date can't say that honestly (9999-12-31
-- would print as a date and sort as one), so it is its own flag. When it is
-- set the item is covered and `warranty_until` is ignored.
alter table inventory_items add column if not exists warranty_lifetime boolean not null default false;
