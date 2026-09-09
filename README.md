# Household

A launcher for the apps we build for ourselves. One icon on the phone, one
sign-in, and everything lives inside it.

No email, no accounts, no password resets. You type a household code and you're
in — and the code is what decides which apps you get, so a friend can have the
Owe list without the shopping list.

One codebase ships two ways: an APK to sideload on Android, and a PWA to install
from Safari on iPhone.

---

## The apps

| | |
|---|---|
| **Things** | To-dos, chores, shopping and wishlist. Recurring chores rest after each time and come back on their own; shopping groups by store and plans the driving order. |
| **Owe & Owed** | Two lists — who owes us, and who we owe. Adds up a person listed more than once, and settling is a deliberate zipper-swipe, not a tap. |
| **Meals** | Dishes with what they cost and what's in them, meals built from templates — Shabbat, every holiday, a weeknight — that add up cost and nutrition per plate, and a recipe importer that reads a link or an Instagram caption. The one app that's allowed to look like a sticker book. |
| **Bluetooth** | One switch per paired device, so the car can be dropped without four taps into system settings. Android only — see below. |

Adding another is one entry in [`src/launcher/registry.ts`](src/launcher/registry.ts)
plus a screen component. Access control, badges, notification preferences and
the settings rows all derive from that entry.

---

## Running it

```bash
npm install
npm run dev
```

It connects to the household's Supabase project out of the box — the URL and
publishable key are committed in [`src/lib/env.ts`](src/lib/env.ts), which is
safe for the reasons set out there. `VITE_LOCAL_ONLY=1 npm run dev` works
entirely on-device instead, against no real data.

Household codes and the Owe list also need the SQL migration and one Edge
Function deployed — see [`supabase/README.md`](supabase/README.md) §6. Until
then the app still runs, Things still works, and **Settings → About** says what
is missing.

```bash
npm test              # unit tests
npm run typecheck
npm run build:web     # production build for Pages
npm run build:native  # build + sync the Android project
```

The APK is built by CI, not locally — see `.github/workflows/release-apk.yml`.
Every push to the working branch leaves a downloadable APK artifact on the run.

**Signing.** The build needs one repository secret, `ANDROID_KEYSTORE_B64`: a
base64 copy of the signing keystore. Without it CI still produces an APK, but a
debug-signed one that Android will not install over an existing copy — the run
warns about exactly that. With it, every build shares a signature and updates
install in place. The key file is deliberately not committed, since this
repository is public; the alias and password are constants in
`android/app/build.gradle`, which protect nothing without the key file itself.

```bash
# Making a fresh one, if the secret is ever lost. Note that a new key means one
# final uninstall on each phone: to Android it is a different app author.
keytool -genkeypair -v -keystore household.keystore -alias household \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -storepass householdlauncher -keypass householdlauncher \
  -dname "CN=Household Launcher, OU=Household, O=Household, C=US"
base64 -w0 household.keystore    # paste this as ANDROID_KEYSTORE_B64
```

---

## How sign-in works

Each person gets their own household code. Typing it calls an Edge Function
holding the service-role key, which looks the code up by its peppered hash and
mints a session for *that member's* auth user. From then on the database answers
every read from the member row the session belongs to.

That last part is the point. Things had two people, so "who am I" could be a tap
on a name and the database only ever saw one shared account behind one shared
PIN. Once guests exist, a client-side "you may not see this" is a suggestion
that survives until someone opens DevTools — so per-app access is enforced in
row-level security instead. A guest without the Owe grant cannot read a single
debt row, whatever the app shows them.

**Setup has a bootstrap problem, and there's a deliberate bridge for it.**
Handing out the first code needs an owner session; getting an owner session
needs a code that only that call can create. So the old shared PIN keeps working
until Settings → General → *Stop accepting the old PIN* turns it off. That
switch is the real hardening step, and it refuses to run while no owner has a
code yet.

---

## How it's put together

**Local-first.** Every write lands in the local store and fires its haptic
immediately, then goes to the network. The app is fully usable before Supabase
exists at all, which also means the offline path is the normal path rather than
an afterthought bolted on at the end.

**Sync.** One Supabase realtime channel covers every table. Row IDs are minted
client-side so an optimistic row and its echo are the same row, making
reconciliation a plain upsert. Because Supabase doesn't replay events missed
while disconnected, every reconnect triggers a full refetch — at this data size
that's cheaper than reconciling and it's the only thing that actually guarantees
the phones converge.

**Notifications route through the launcher, not the OS.** Every event writes a
row per recipient, which is what the notification centre lists and what the home
grid's badges are counted from. Push is a *separate* decision from that row —
"badge me but don't buzz me at work" is the setting people actually want, and
one boolean can't say it. A push can be swiped away or never permitted at all;
the row is the record either way.

**Claiming is a race,** so it's never read-then-write. The database arbitrates
with a conditional update, and losing simply shows "Jackie got there first."

**A claim can be stolen, and stealing is counted.** First-come-first-served is
the right rule for two phones tapping at once and the wrong one for the far
commoner case: you claimed the shopping, they're the one driving past the shop.
So a held claim can be taken — after a confirmation, because quietly overriding
someone's "I'll do it" on a mis-tap gets noticed long before anyone thinks to
check the app. The theft lands in the activity log as its own event with both
people named, so the scoreboard can show *stolen* and *robbed* without a second
source of truth. Both counts stay hidden until the first one happens.

**Cooldowns are derived, not pushed.** When a recurring chore's rest period
expires, *nothing in the database changes* — so Postgres emits no event and no
push can announce it. The client works it out from a ticker that also recomputes
on wake, because mobile OSes freeze timers in the background.

**Settling a debt is harder than ticking off a chore, on purpose.** The swipe
row used everywhere else fires at 40% of its width, which is right for a to-do
and wrong for money: the undo for an accidental one is a conversation with a
person. So the Owe list uses a small handle at the end of the row that has to be
pulled the whole way, with a detent fired per frame crossed so it feels like a
zipper rather than a slider.

**Haptics** dispatch to Capacitor natively, `navigator.vibrate` on Android web,
and a visual pulse plus optional synthesised audio on iOS — which has no
vibration API in any browser. Strength, per-event toggles, accent colour, theme
and text size are all per person.

---

## Things that genuinely don't work, and why

Worth knowing up front rather than discovering later:

- **The Bluetooth app cannot exist on iPhone.** iOS gives a web app no
  visibility into the phone's pairings, let alone control of them. The tile says
  so rather than opening a screen that can't work.
- **On Android it uses hidden framework methods.** `connect` and `disconnect` on
  the A2DP and Headset profiles are `@hide` — present and unchanged since API 11,
  and what the Settings app itself calls, but absent from the public SDK, so they
  are reached by reflection. If a future Android removes them the app reports a
  normal failure rather than crashing.
- **Turning a device off doesn't stop it reconnecting later.** Android offers an
  app no such block. What the switch does is disconnect it *now*, which is what
  the moment in the driveway actually calls for. The pairing is never touched, so
  switching back on is instant.
- **iOS can't do haptics from a web app.** No API, no polyfill, no workaround.
  Jackie's phone gets a visual pulse and optional sound instead.
- **iOS Web Push is real but conditional** — Home Screen install required, and
  Apple throttles apps left unused.
- **A household code can't be looked up, only replaced.** Only its peppered hash
  reaches the database, which is exactly why a stolen table is not a list of
  codes. Write a new one down when it's shown; there is no recovery screen.
- **Android push needs a Firebase project, and this build has none.** Web Push
  is a browser standard; Android's equivalent is Firebase Cloud Messaging, and
  there is no way around it for a Capacitor app — a WebView has no Push API.
  Without it the Android app still shows badges and fills its notification
  centre whenever it's open; it just can't be woken while closed. Settings →
  Alerts says so on the phone, and asking for notifications is disabled rather
  than offered, because tapping it used to kill the app outright: Capacitor
  rethrows anything a plugin method throws as an uncaught RuntimeException, and
  `PushNotifications.register()` throws when the APK was built with no
  credentials. See **Turning Android push on** below.
- **Instagram sometimes refuses to show a post to anyone not logged in.** A
  public post usually serves its caption in the page's own metadata, and that
  is enough for the importer. When Instagram serves a login wall instead there
  is nothing a server can do about it, so the import sheet turns into a box to
  paste the caption into — same parser, text you copied yourself.
- **The Supabase key in the bundle is public.** That's why every table is gated
  behind an authenticated session and per-app RLS, and why turning off email
  signups in the dashboard actually matters.

---

## Turning Android push on

Two repository secrets, both from one free Firebase project. Jackie's iPhone
does not need any of this — iOS Web Push is a browser standard and already
works.

1. Create a project at <https://console.firebase.google.com>. Analytics is not
   needed.
2. Add an **Android** app to it. The package name must be exactly
   `com.avicagan.household` — Firebase rejects a token whose package doesn't
   match. Download the `google-services.json` it offers.
3. Project settings → **Service accounts** → *Generate new private key*. That
   downloads a second JSON. This one is a real credential: it can send a
   notification to any device in the project, so it goes in a secret and
   nowhere else.
4. In this repository, Settings → Secrets and variables → Actions, add both
   files as secrets, pasting each file's entire contents:

   | Secret | File |
   | --- | --- |
   | `GOOGLE_SERVICES_JSON` | `google-services.json` from step 2 |
   | `FCM_SERVICE_ACCOUNT` | the private key from step 3 |

5. Re-run **Build Android APK** and **Deploy Supabase functions** from the
   Actions tab, then install the new APK and tap *Turn on notifications* in
   Settings → Alerts.

Until step 4 is done the APK build logs a warning saying push is off, rather
than producing a build that looks complete and fails silently on the phone.

---

## Layout

```
src/
  launcher/     the shell — registry, home grid, notification centre, settings
  apps/
    things/     to-dos, chores, shopping, wishlist
    owe/        the two money lists
    bluetooth/  device switches + the Capacitor plugin binding
  data/         adapters (local + Supabase), types, offline outbox
  store/        zustand state — data, member/access, navigation
  lib/          haptics, sound, notifications, household codes, platform
  components/   primitives (swipe rows, sheets, icons) and shared shell
android/        Capacitor project, including the Bluetooth control plugin
supabase/       SQL migrations, Edge Functions, setup guide
```
