# KFC BBL|16 Tipping — Launch Checklist

Scope: this covers what's left to take the BBL head-to-head tipping feature
built this session (seeded fixtures + `v3tip.html`) from "working prototype"
to "ready for real users and real money." It does not re-cover the general
platform tech debt already documented in `BRITTLENESS_AUDIT.md` and
`LEGACY_BAGGAGE_AUDIT.md` — those still stand and are worth a separate pass.

Current state as of this session:
- ✅ 44 BBL fixtures seeded into Supabase as races (`seed-bbl.js`), each
  match modelled as a race with the home team as horse `#1` and away team
  as horse `#2` — no schema changes needed.
- ✅ `KFC BBL|16` comp created, **status: closed** (not visible/joinable).
- ✅ `v3tip.html` — a standalone prototype page that reads real fixtures,
  writes real tips via the `save_tip` RPC, and tracks real joker counts.
- ❓ Whether RLS lets a logged-in (but not-yet-joined) user even *see* a
  closed comp's races has not been confirmed — see "Must verify" below.

---

## 1. Must do before this can go live

### 1.1 Decide where BBL tipping actually lives in the product
`v3tip.html` is a standalone prototype — it isn't linked from any nav in
the real app (`dark.html`, `tipdark.html`, etc.), and the real `tipdark.html`
only knows how to render horse-racing fixtures (jockey/trainer/barrier
fields, a full-field radio list). Two real options, pick one:

- **(a) Extend `tipdark.html` to detect head-to-head races** (e.g. exactly
  two horses, no jockey/trainer/barrier data) and render a two-side picker
  like `v3tip.html`'s, instead of the horse-racing form list. This keeps
  one tipping page for the whole product.
- **(b) Keep BBL on its own page** and link it from the main nav
  (`dark.html`, `tipdark.html`, etc.) so users can actually find it.

Right now neither is done — a real user has no way to reach BBL tipping
except by knowing the `v3tip.html` URL directly.

### 1.2 Same problem on the home dashboard
`dark.html`'s "Upcoming Races" grid (`renderRacesGrid`) also assumes
horse-racing fields (silks, venue photo lookup by track name, "Barrier"
labels) and will render awkwardly for a BBL fixture if the BBL comp
becomes the active/joined comp for a user. Needs the same detection-and-
branch treatment as 1.1, or BBL needs to be deliberately excluded from
that grid.

### 1.3 Results entry doesn't fit head-to-head matches yet
The admin race-result form (`admin-dark.html` / `admin-dark-script.js`)
is built around winner + place1 + place2, each with their own point value
— correct for horse racing, meaningless for a two-team match (there's no
"2nd place" in a game with one winner and one loser). Before the first
BBL match finishes, decide:
- Does a correct tip just get a flat point value (e.g. 10), with the
  losing side/no-pick getting 0? If so, the admin form should let you set
  a winner and a single point value, and skip place1/place2 for these
  races entirely (they can stay null — `calculateTipPoints` already
  handles missing place data safely, so this is mostly a UI question of
  not confusing admins with irrelevant fields).
- Or does BBL scoring need something richer (e.g. bonus points for margin)?
  If so, that's new logic in `scoring.js`, not just a UI change.

### 1.4 Payment, if this is a paid comp
The comp was seeded with `entry_fee: 0`. If BBL tipping should cost money:
- Set a real `entry_fee` / `prize_pool` on the comp (via `admin-dark.html`
  once it exists, or by re-running `seed-bbl.js` after editing the values
  in `resolveCompId()`).
- Confirm the Stripe checkout flow in `comps.html` is actually wired up
  and not still a placeholder — `IMPLEMENTATION_STATUS.md` describes it as
  unfinished as of an earlier (pre-Supabase-migration) pass, and that
  status has not been re-verified since. Do not assume it works without
  checking the current `comps.html` payment code directly.

### 1.5 The four "To be announced" finals fixtures
Matches 41–44 in `bbl16.json` are placeholders (`To be announced v To be
announced`) until the group stage ladder settles. `seed-bbl.js` is built
to update these in place once the real finalists are known (matched by
the stable `MatchNumber`, not by name — see the comment in
`matchToRace`/`extractMatchNumber`), but that only works if:
- You get an updated `bbl16.json` with the real team names before finals,
  **and**
- You re-run `node seed-bbl.js` after replacing it.
Put this on a calendar reminder for whenever the BBL regular season ends
— it's not automatic.

---

## 2. Must verify (unknowns from this session)

### 2.1 Can a logged-in user actually read a `closed` comp's races?
Confirmed: the anon Supabase key cannot read `comps`/`races` at all
(tested directly, zero rows, no error — RLS blocks unauthenticated reads
outright). What's **not** confirmed is whether RLS additionally filters
reads to `status = 'active'` comps for authenticated-but-not-joined users.
If it does, `v3tip.html` (and any real page) will show "No BBL competition
found" for every user until the comp is flipped to Active — which also
makes it publicly joinable. Test this with a real login before assuming
either page works end-to-end. If RLS does block closed comps, you'll need
either a policy exception for testing, or to just accept that "closed"
effectively means "invisible even to admins browsing the normal UI" and
test via the Supabase table editor / service-role scripts instead.

### 2.2 Streak eliminations during BBL's dense schedule
The streak system (`calculateAndSaveStreak` in `admin-dark-script.js`)
groups races into ISO weeks and only evaluates a week once **every** race
in it has a result (fixed earlier this session specifically to avoid
premature eliminations on multi-race weeks). BBL runs matches close
together — most weeks will have 2–4 matches. This means a whole week's
streak status won't update until the admin has entered results for every
match in it. If results lag behind fixtures, streak status will look
stale. Not a bug, but worth setting expectations with whoever enters
results: don't expect same-day streak updates on multi-match weeks unless
every match that week is scored promptly.

### 2.3 Team colours are approximations, not verified brand hex
`TEAM_COLORS` in `v3tip.html` uses commonly-recognized approximate club
colours, not values pulled from an official brand guide. Fine for a
prototype; worth a real design pass (and possibly real crest/logo assets
instead of plain colour dots) before this is customer-facing.

---

## 3. Nice to have (not blocking, but worth doing)

- **Push notifications**: `scheduleRaceReminderNotifications()` is a
  no-op stub in `dark.html` and presumably wherever else it's referenced
  — this is a pre-existing gap on the whole platform, not new to BBL, but
  BBL's tighter match schedule makes "no reminder before tips close" more
  costly than it is for weekly horse racing.
- **FAQ / rules copy**: `faqdark.html` and the terms/privacy pages don't
  mention BBL or head-to-head tipping rules at all yet. If jokers, scoring,
  or entry terms differ from the spring racing comp, that needs writing.
- **Admin UX**: there's no "sport type" flag anywhere in the schema —
  admins creating/editing the BBL comp or its races will see the same
  horse-racing-labelled form fields (Barrier, Jockey, Trainer) as every
  other comp, even though none of them apply. Not broken, just confusing
  for whoever runs results day-to-day. A simple visual cue (or a genuine
  "sport" field on `comps`/`races`) would help long-term.
- **Test coverage**: `tests/scoring.test.js` covers racing-shaped data;
  there's no explicit test asserting `calculateTipPoints` behaves
  correctly for a plain two-runner head-to-head race (it should, since
  the logic is generic, but an explicit test would catch a future
  regression specific to this use case).
- **Mobile app**: the `mobile/` React Native app wasn't touched this
  session — if it also needs to surface BBL tipping, that's a separate,
  unscoped body of work.

---

## 4. Recap: how to (re-)run the pieces already built

```bash
# Re-seed / update fixtures (safe to re-run any time; matches by MatchNumber)
node seed-bbl.js

# With key.json present (SUPABASE_SERVICE_ROLE_KEY), no env var needed.
# To seed into a specific existing comp instead of the auto-created one:
BBL_COMP_ID=<comp-id> node seed-bbl.js
```

Flip the comp live in `admin-dark.html` (find "KFC BBL|16", switch status
Closed → Active) once 1.1–1.4 above are actually resolved — not before.
