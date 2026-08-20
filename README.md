# Things

A household app for two people. Four lists, shared live between Avi's Android
phone and Jackie's iPhone, with no accounts and no sign-in — you tap your name
and you're in.

| | |
|---|---|
| **To-do** | Quick-add, urgency, either of you can claim an item |
| **Chores** | Same, plus recurring chores that rest after each time and come back on their own — and sync to Google Calendar |
| **Shopping** | Grouped by store, with a trip planner that works out the driving order |
| **Wishlist** | Things you want for yourselves, ranked by how badly |

One codebase ships two ways: a PWA Jackie installs from Safari, and an APK Avi
sideloads.

---

## Running it

```bash
npm install
npm run dev
```

It works immediately with no backend — everything lives in on-device storage and
a banner says it isn't syncing yet. To make the two phones share lists, follow
[`supabase/README.md`](supabase/README.md) (about 15 minutes, all free tier).

```bash
npm test              # unit tests — solver, distance maths, deep links
npm run verify:route  # live check against the real geocoder and router
npm run build:web     # production build for Pages
npm run build:native  # build + sync the Android project
```

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
both phones converge.

**Claiming is a race,** so it's never read-then-write. The database arbitrates
with a conditional update, and losing simply shows "Jackie got there first."

**Cooldowns are derived, not pushed.** When a recurring chore's rest period
expires, *nothing in the database changes* — so Postgres emits no event and no
push can announce it. The client works it out from a ticker that also recomputes
on wake, because mobile OSes freeze timers in the background.

**Trip planning** uses no API keys: Photon for geocoding, OSRM for the driving
matrix, and an exact solver (brute force below 8 stops — 5040 permutations is
under a millisecond). Coordinates cache onto the store row, so a settled trip
makes zero network calls. On a real 4-store Brooklyn run it cut 34 minutes to 26.

**Haptics** dispatch to Capacitor natively, `navigator.vibrate` on Android web,
and a visual pulse plus optional synthesised audio on iOS — which has no
vibration API in any browser. Strength, per-event toggles, accent colour, theme,
text size and preferred maps app are all per person.

---

## Things that genuinely don't work, and why

Worth knowing up front rather than discovering later:

- **iOS can't do haptics from a web app.** No API, no polyfill, no workaround.
  Jackie's phone gets a visual pulse and optional sound instead. There's an
  experimental toggle that uses Apple's native switch control to coax a real
  buzz out of the completion checkbox on iOS 17.4+, but it's a rendering side
  effect Apple could remove, so it's off by default.
- **Waze has no multi-stop URLs.** It navigates to exactly one destination, so
  Jackie's trips are handed over stop by stop. That flow is built as a proper
  experience rather than a consolation prize; Avi's Google Maps link carries the
  whole route at once.
- **iOS Web Push is real but conditional** — Home Screen install required, and
  Apple throttles apps left unused. Fine for daily use, not the guarantee SMS
  would be.
- **The routing services are free and unpromised.** OSRM's demo server has no
  SLA, so there's a haversine fallback that labels its estimates as estimates.
- **Google refreshes a subscribed calendar when it feels like it** — often a
  few hours, sometimes a day, and no header in the feed can hurry it. So each
  repeating chore also carries a button that puts that one chore on the
  calendar immediately.
- **The Supabase key in the bundle is public.** That's why the database is
  gated behind a one-time PIN and an authenticated session, and why turning off
  email signups in the dashboard actually matters.

---

## Layout

```
src/
  data/       adapters (local + Supabase), types, offline outbox
  store/      zustand state and every mutation
  lib/        haptics, sound, notifications, platform, ticker
  routing/    geocoding, OSRM, solver, maps deep links
  features/   the four tabs plus settings
  components/ primitives (swipe row, urgency wheel, sheets) and shell
supabase/     SQL migrations, the notify/unfurl/calendar Edge Functions, setup guide
```
