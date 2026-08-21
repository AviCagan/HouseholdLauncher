# Backend setup

The app runs **without any of this** — it falls back to on-device storage and
shows a "not syncing yet" banner. Do this when you want Avi's and Jackie's
phones to share the same lists.

Roughly 15 minutes, once.

---

## 1. Create the Supabase project

1. Sign up at [supabase.com](https://supabase.com) (free tier is plenty).
2. New project → pick any name and a strong database password → wait ~2 min.
3. Collect two values:

   - **Project URL** — read it off your browser's address bar. The dashboard
     sits at `supabase.com/dashboard/project/<ref>`, and your URL is
     `https://<ref>.supabase.co`. Also shown under **Settings → Data API**.
   - **Publishable key** — **Settings → API Keys**, the `sb_publishable_…`
     value. This is the browser-safe key and the modern replacement for what
     older docs call the "anon public" key; if your dashboard still shows a
     **Legacy anon** tab instead, that key works identically.

> The `sb_secret_…` key on that same page must never go into the app — it
> bypasses row-level security entirely. It's only needed for the optional
> notification sender in the last section.

## 2. Run the SQL

Open **SQL Editor**, paste in **`setup.sql`**, and hit Run. That's everything
in one go, and it's safe to re-run.

<details>
<summary>Or run the four files individually</summary>

`setup.sql` is just these concatenated; they're kept separate for readability.

| File | What it does |
|---|---|
| `001_schema.sql` | Tables, the `compute_next_due` trigger, indexes |
| `002_rls.sql` | Locks the database to authenticated sessions only |
| `003_realtime.sql` | Turns on live sync (and the `REPLICA IDENTITY FULL` that makes deletes sync) |
| `004_seed.sql` | Creates the Avi and Jackie profiles |

</details>

> **Already ran `setup.sql` before?** It's kept current, so re-running it is the
> simplest way to catch up. If you'd rather apply only what's new, the
> numbered add-ons each stand alone and are safe to run twice:
>
> | File | Adds |
> |---|---|
> | `006_avatars.sql` | Profile photos |
> | `007_list_settings.sql` | Auto-clearing finished items, custom repeat quick picks, yearly chores |
> | `008_calendar.sql` | Google Calendar sync |
> | `009_weekday_recurrence.sql` | Chores that repeat on specific days of the week |
>
> Without `007`, setting a chore to repeat *yearly* fails; without `009`,
> picking specific weekdays fails; without `006`, changing a profile photo
> does.

## 3. Create the household account

This is what the PIN unlocks. Go to **Authentication → Users** — or straight to
`https://supabase.com/dashboard/project/<ref>/auth/users`, which is quicker than
hunting for it — then **Add user → Create new user**:

- Email: `household@things.local`
- Password: `things-household-0926`
- Tick **Auto Confirm User**

> If you only see Policies, Sessions, Rate Limits and so on, you're in
> Authentication's *Configuration* submenu. Use the back arrow at the top of
> that panel; Users sits a level above it.

The password is your PIN `0926` with a fixed prefix, because Supabase requires
at least 6 characters. You type only the four digits; the app adds the rest. If
you ever change the PIN in the app, change this password to match.

### Then close the door behind you

**Authentication → Sign In / Providers →** click into **Email → turn OFF "Allow
new users to sign up"**, then save. (Older dashboards word this as "Enable email
signups" — same switch.)

> **Leave the Email provider itself Enabled.** On the providers list, Email
> shows a green *Enabled* badge — do not turn that off. That badge controls
> whether email/password login works at all, which is exactly how both phones
> sign in; switching it off would stop the PIN working and break syncing.
> The setting you want is inside the Email panel, one level down.

Don't skip this. The anon key is public — it ships inside the JavaScript that
GitHub Pages serves to anyone. With signups enabled, someone could use that key
to create their own account, and that account would then pass the
`authenticated` check and walk straight past your PIN. Turning signups off is
what actually makes the PIN mean something.

While you're there, **Authentication → Rate Limits** — lowering the sign-in
limit directly slows down anyone trying to guess a 4-digit code.

## 4. Connect the app to the project

**Already done** — the project URL and publishable key are committed in
[`src/lib/env.ts`](../src/lib/env.ts), so a fresh clone builds and connects with
no configuration at all.

That is a deliberate choice, not an oversight. Both values are inlined into the
client bundle by definition, so they were already readable by anyone who opened
the deployed site and viewed source. Keeping them in Actions secrets bought
obscurity in git history and nothing else, while making every build depend on
someone having configured the repository first.

What actually protects the data is step 3 above: RLS grants `authenticated`
only, the anon role has no policy on any table, and email signups are off so
the key cannot mint an account that would satisfy it.

**To point a build at a different project** — or to rotate after the key has
been revoked in the dashboard — set these as repository secrets and they win
over the committed defaults:

| Secret | Value |
|---|---|
| `VITE_SUPABASE_URL` | Project URL, e.g. `https://abcdefgh.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | the `sb_publishable_…` key (or `VITE_SUPABASE_PUBLISHABLE_KEY`) |
| `VITE_HOUSEHOLD_EMAIL` | only if it isn't `household@things.local` |

> Revoking the key is done in the Supabase dashboard under **Settings → API
> Keys**. Editing `env.ts` alone changes nothing — the old key keeps working
> until the project itself stops accepting it.

For local work against the on-device store instead of the real household:

```bash
VITE_LOCAL_ONLY=1 npm run dev
```

Then **Settings → Pages → Source: GitHub Actions**. Push to the branch and the
site deploys itself.

> These are not really secrets. `VITE_`-prefixed values get compiled into the
> public JavaScript bundle. Using Actions secrets keeps them out of the git
> history, nothing more — the database is protected by step 3, not by hiding
> this key.

## 5. Install on the phones

- **Jackie (iPhone):** open the Pages URL in Safari → Share → **Add to Home
  Screen** → open it from that icon. Enter `0926` once.
- **Avi (Android):** run the **Build Android APK** workflow (Actions → Run
  workflow), download the artifact, install it. Enter `0926` once.

Each device asks for the PIN exactly once, ever. After that it's tap-your-name.

---

## 6. Turn on the launcher

Everything above is the Things backend, and the launcher runs on top of it.

### Run the migration

SQL editor → paste **`015_launcher.sql`** → Run. Safe to re-run.

> **Until this runs, the launcher's own features have nowhere to store
> anything.** The app notices and says so in **Settings → About** rather than
> failing to start — Things keeps working throughout, and Owe & Owed, People
> and notifications simply stay empty until the migration lands. It adds member
roles and codes, per-app access, notifications and the Owe list, and rewrites
row-level security to ask who the session actually belongs to.

Nothing breaks when you run it: the old shared PIN keeps working, on purpose.
See *the bootstrap* below.

### Deploy the household function

This is what turns a typed code into a session. It holds the service-role key,
so none of its decisions can be made in the browser.

```bash
# A long random string. It's mixed into every code hash, so a stolen
# credentials table can't be run through a wordlist offline.
supabase secrets set HOUSEHOLD_CODE_PEPPER="$(openssl rand -hex 32)"

supabase functions deploy household --no-verify-jwt
```

> `--no-verify-jwt` is required, not a shortcut. The `redeem` action is called
> by someone who has no session yet — that is the entire point of it. Every
> other action authenticates the caller itself before doing anything.

Save the pepper as a GitHub secret `HOUSEHOLD_CODE_PEPPER` too, so CI
redeploys don't reset it. **Changing the pepper invalidates every existing
code**, which is a fine emergency reset and a bad accident.

### The bootstrap

Handing out the first code needs an owner session, and getting an owner session
needs a code that only that call can create. The old PIN is the bridge:

1. Open the app and sign in with the old four-digit PIN, as usual.
2. **Settings → General → Your household code** → pick one, or generate one.
3. **Settings → People** → tap Jackie → **New code** → give it to her.
4. Once you've both signed in with your own codes:
   **Settings → General → Stop accepting the old PIN.**

Step 4 is the one that makes per-app access mean anything. Until it runs,
anyone holding the old PIN reaches every table regardless of what their grants
say — and the app refuses to run it while no owner has a code yet, so it can't
lock you out.

### Adding people

**Settings → People → Add someone.** Pick a role, tick the apps they get, and
either type a code or let one be generated. The code is shown once and never
again — only its hash is stored, so it can be replaced but never looked up.

- **Owner** — everything, including People. For whoever lives here.
- **Member** / **Guest** — only the apps explicitly ticked. Both are enforced in
  the database, not just hidden in the UI.

Removing someone deactivates them and revokes their sessions immediately; their
name stays on the entries they're part of.

---

## Notifications (optional)

Everything above works without this. Add it when you want alerts.

### Web Push keys (Jackie)

```bash
npx web-push generate-vapid-keys
```

Add the **public** key as a GitHub secret `VITE_VAPID_PUBLIC_KEY`, and keep the
private key for the next step.

### FCM (Avi)

1. Create a free project at [console.firebase.google.com](https://console.firebase.google.com).
2. Add an **Android** app with package name `com.avicagan.household`.

   > **If you already did this for Things, redo it.** The launcher's package id
   > is `com.avicagan.household`, and a `google-services.json` is bound to the
   > package it was generated for — the old one makes the build fail outright
   > rather than quietly falling back. Add a second Android app in the same
   > Firebase project and download a fresh file; the old Things entry can stay.
3. Download `google-services.json` → paste its contents into a GitHub secret
   named `GOOGLE_SERVICES_JSON`.
4. **Project settings → Service accounts → Generate new private key** — that
   JSON goes into the Edge Function below.

### Deploy the sender

```bash
npm i -g supabase
supabase login
supabase link --project-ref <your-project-ref>

supabase secrets set \
  VAPID_PUBLIC_KEY='<public key>' \
  VAPID_PRIVATE_KEY='<private key>' \
  VAPID_SUBJECT='mailto:you@example.com' \
  FCM_SERVICE_ACCOUNT="$(cat path/to/service-account.json)"

supabase functions deploy notify --no-verify-jwt
```

Finally, edit `005_notifications.sql` — replace `<PROJECT_REF>` and
`<SERVICE_ROLE_KEY>` (Settings → API → `service_role`, this one **is** a real
secret) — and run it in the SQL editor.

Then in the app: **Settings → Notifications → Turn on notifications**, on each
phone.

### What to expect

- **Avi's APK** gets real push, arriving with the app fully closed. Chore
  cooldown reminders are scheduled on-device, so they work offline and fire at
  the exact minute.
- **Jackie's iPhone** gets Web Push, which is real but conditional: it only
  works from the Home Screen icon, stops if that icon is deleted, and Apple
  throttles delivery for apps left unused for long stretches. Fine for daily
  use, but it is not the guarantee a text message would be. If it disappoints,
  the `phone_e164` column and the sender's structure are already in place to
  add SMS as a second channel.

---

## Google Calendar (optional)

Puts recurring chores on a calendar you already look at. No Google account
linking, no OAuth — the app publishes a private calendar feed and Google
subscribes to the URL.

```bash
supabase functions deploy calendar --no-verify-jwt
```

`--no-verify-jwt` is not optional. Google fetches the feed with no headers you
control, so a function that demanded an `Authorization` header would reject
every refresh. What protects the feed instead is a random token in the URL,
stored in `household_settings.calendar_token`. Run `008_calendar.sql` first if
you haven't.

Then in the app: **Settings → Calendar → Sync recurring chores**, and tap **Add
to Google Calendar**. On an iPhone, *Open on this phone* hands the same feed to
the built-in Calendar app instead, which is the shorter route there.

### What to expect

- The feed is **read-only** and only ever contains chore names and times.
  Anyone with the link can see them and change nothing. *Regenerate the link*
  in Settings kills the old URL immediately.
- **Google refreshes subscribed calendars on its own schedule** — commonly a
  few hours, sometimes closer to a day, and nothing in the feed can hurry it
  along. This is a Google behaviour, not a bug in the app.
- Because of that delay, each repeating chore also has a **calendar button**
  on the Chores tab that drops that one chore onto your calendar right now,
  recurrence included.
- **Remind me before it's due** adds an alarm to every event in the feed, so
  the reminder comes from your calendar rather than from the app.

---

## Costs

Free. Supabase's free tier covers this easily, Firebase push is free at any
household volume, and the maps stack uses no paid API.

One quirk worth knowing: **Supabase pauses free projects after ~7 days of
inactivity.** Daily use never trips it, but come back from a two-week holiday
and the first launch may need an unpause from the dashboard.
