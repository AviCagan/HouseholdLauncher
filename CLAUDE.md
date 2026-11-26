# Notes for agents working on HouseholdLauncher

## The Supabase project is shared with one other app

The household's Supabase project ("Things", ref `rixslpsozkfytcdeprma`) also holds the cloud saves of
**Beaker Buddies**, a separate study game (https://github.com/AviCagan/LetThemCook). Avi approved this
on 2026-10-30 because the free plan allows only two active projects.

Beaker Buddies owns exactly these objects, all prefixed `bb_`:

| Object | What it is |
|---|---|
| `public.bb_saves` | One row per player, keyed by a SHA-256 hash of a secret sync code. RLS is on with **no policies, on purpose**. |
| `public.bb_get_save(text)` and `public.bb_put_save(text, jsonb, bigint, text)` | The only way in. `SECURITY DEFINER` and **executable by anon, on purpose**. |
| `public.bb_key_hash(text)` | Internal helper. Not callable by anon or authenticated. |

It also has two entries in the migration history, both from 2026-10-30: `beaker_buddies_cloud_save`
and `beaker_buddies_cloud_save_cap_and_notes`. They are not in `supabase/` here because they are not
part of this app. The SQL lives in LetThemCook at `supabase/migrations/*_beaker_buddies_cloud_save.sql`.
Every `bb_` object also carries a database comment saying the same.

What this means for you:

- **Leave `bb_*` alone.** Don't drop or rename them, add RLS policies, revoke their grants, or fold
  them into household schema rewrites. Any of those breaks the game's sync.
- **Expect these Supabase advisor warnings and don't "fix" them:** "Public Can Execute SECURITY
  DEFINER Function" and "Signed-In Users Can Execute SECURITY DEFINER Function" for `bb_get_save` and
  `bb_put_save`, and "RLS Enabled No Policy" for `bb_saves`. They describe the intended design.
- **The household's security model is unchanged.** The publishable key on its own still reads
  nothing from any household table. The `bb_` functions read and write only `bb_saves`, and only
  the row whose sync code the caller supplies. `bb_saves` is capped at 20 rows of at most 2 MB, so
  it cannot fill the database.
- **If the database is ever rebuilt from `setup.sql`**, re-apply LetThemCook's cloud-save migration
  afterwards, or tell Avi, or Beaker Buddies loses its saves.
- **Changes to `bb_*` belong in the LetThemCook repo**, applied here as a new migration whose name
  starts with `beaker_buddies_`. Keep household migrations free of `bb_` objects.

## Med School 2028 has a coordination doc

Avi's claude.ai chat and Claude Code coordinate on the Med School 2028 app in a Google Doc called
**"Claude ↔ Claude Code"**, in Avi's Google Drive under *Avi's Stuff › Claude memory*. Read it before
working on `src/apps/medschool` or the `ms_*` tables, and reply there. Nothing from that doc or from
Avi's plan goes into this public repo.

## Nano reaches the data as a member, under row-level security

Nano (the household's assistant) signs in with a household code like everyone else, as the one
profile with role `agent`. She never gets the service role. Her whole contract is
`supabase/029_nano.sql`:

- **Every app table needs Nano rules.** A new app table goes in `nano_tables()` (in a new
  migration) and in its app's `nano` section in `src/launcher/registry.ts`.
  `src/launcher/registry-nano.test.ts` fails if the two disagree.
- **Member checks leave her out on purpose.** `current_profile_id()`, `has_app()` and
  `legacy_session_ok()` exclude role `agent`. Her reach comes only from the `nano_*` policies.
  Don't "fix" that by granting her apps.
- **Expect these advisor warnings and don't "fix" them:** "Signed-In Users Can Execute SECURITY
  DEFINER Function" for the `nano_*` functions, `profile_has_app` and `watch_row_id` (they are RLS
  helpers or check their caller themselves), and "RLS Enabled No Policy" for
  `nano_authenticator`.
- **Nothing from the Calendar (`mk_*`) is logged:** no `nano_changes` trigger and no request rows.
  Keep it that way.
