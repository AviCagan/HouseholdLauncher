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
