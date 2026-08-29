#!/usr/bin/env node
/**
 * Seeds KFC BBL|16 fixtures (bbl16.json) into Supabase as races.
 *
 * This app's schema is horse-racing shaped — a race has a `horses` map of
 * runners. There's no separate "team sport fixture" table, so each BBL match
 * is stored as one race with two horses: the home team as runner #1, the
 * away team as runner #2. Tipping, results entry, scoring and the
 * leaderboard all work completely unmodified — tipping "#1" just means
 * tipping the home team to win. No schema changes needed.
 *
 * This seeds fixtures only. bbl16.json has no results yet (all matches are
 * future), and results are recorded later through the normal admin flow
 * (admin-dark-script.js) once each match finishes — this script doesn't
 * touch the `results` table.
 *
 * Usage:
 *   Put your service role key in key.json (same folder as this script):
 *     { "SUPABASE_SERVICE_ROLE_KEY": "xxxx" }
 *   then run:
 *     node seed-bbl.js
 *     BBL_COMP_ID=<existing-comp-id> node seed-bbl.js
 *
 *   Or skip the file and pass it as an env var instead:
 *     SUPABASE_SERVICE_ROLE_KEY=xxxx node seed-bbl.js
 *
 * Why the service role key: races/comps inserts are blocked for the anon
 * key by RLS (see the RLS test in tests/smoke.js) — this needs to run as an
 * admin. Get the service role key from the Supabase dashboard →
 * Settings → API → service_role.
 *
 * NEVER commit key.json or this key, put it in a browser-facing file, or
 * reuse it anywhere outside a trusted server-side script — it bypasses all
 * RLS. key.json is listed in .gitignore, but double check it never shows up
 * in `git status` before committing anything.
 *
 * Re-running this script is safe: fixtures are matched by the source feed's
 * stable MatchNumber (embedded in the distance field, see matchToRace)
 * within the target comp, and updated in place rather than duplicated. This
 * matters because BBL finals fixtures start as placeholder "To be announced
 * v To be announced" matches until the ladder settles — matching by name
 * would treat the later real-team update as a brand new race and leave the
 * placeholder behind as an orphan.
 */

import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL } from './supabase-config.js';

async function resolveServiceRoleKey() {
  try {
    const raw = await readFile(new URL('./key.json', import.meta.url), 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed.SUPABASE_SERVICE_ROLE_KEY) return parsed.SUPABASE_SERVICE_ROLE_KEY;
  } catch (err) {
    if (err.code !== 'ENOENT') throw new Error(`Could not read key.json: ${err.message}`);
  }
  return process.env.SUPABASE_SERVICE_ROLE_KEY || null;
}

const SERVICE_ROLE_KEY = await resolveServiceRoleKey();
if (!SERVICE_ROLE_KEY) {
  console.error(
    'Missing service role key.\n' +
    'Get it from the Supabase dashboard → Settings → API → service_role, then either:\n' +
    '  - create key.json next to this script: { "SUPABASE_SERVICE_ROLE_KEY": "xxxx" }\n' +
    '  - or run: SUPABASE_SERVICE_ROLE_KEY=xxxx node seed-bbl.js'
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const FIXTURE_FILE = new URL('./bbl16.json', import.meta.url);
const COMP_NAME = 'KFC BBL|16';

// "2026-12-12 09:10:00Z" (UTC) -> Sydney-local { date: '2026-12-12', time: '20:10' }.
// The app treats race date/time as already being in Australia/Sydney local
// time (see tipdark.html's DateTime.fromISO(date+"T"+time, { zone: "Australia/Sydney" })),
// so UTC fixture times must be converted here, not passed through as-is.
function toSydney(dateUtc) {
  const d = new Date(dateUtc.replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) throw new Error(`Bad DateUtc value: ${dateUtc}`);

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Australia/Sydney',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false
  }).formatToParts(d).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});

  const hour = parts.hour === '24' ? '00' : parts.hour; // midnight ICU quirk safety net
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${hour}:${parts.minute}` };
}

async function resolveCompId() {
  if (process.env.BBL_COMP_ID) return process.env.BBL_COMP_ID;

  const { data: existing, error: findErr } = await supabase
    .from('comps').select('id').eq('name', COMP_NAME).maybeSingle();
  if (findErr) throw findErr;
  if (existing) return existing.id;

  const id = randomUUID();
  const now = new Date();
  const { error: insertErr } = await supabase.from('comps').insert({
    id,
    name: COMP_NAME,
    // Starts closed so it isn't visible/joinable on comps.html until you
    // deliberately flip it to Active in admin-dark.html when ready.
    status: 'closed',
    entry_fee: 0,
    prize_pool: 0,
    start_date: now.toISOString(),
    end_date: new Date(Date.UTC(now.getUTCFullYear() + 1, 0, 31)).toISOString(),
    description: 'KFC BBL|16 head-to-head tipping.',
    max_participants: 1000,
    joker_allowance: 3,
    participant_count: 0,
    created_at: now.toISOString(),
    updated_at: now.toISOString()
  });
  if (insertErr) throw insertErr;
  console.log(`Created comp "${COMP_NAME}" (${id}) as CLOSED — flip it to Active in admin-dark.html when you're ready to launch it. Pass BBL_COMP_ID=${id} next time to reuse it explicitly.`);
  return id;
}

// Stable per-match id from the source feed, embedded at the front of the
// distance field so re-runs can find the right row even after the name
// changes (finals placeholders -> real teams). See extractMatchNumber.
function matchToRace(match, compId) {
  const { date, time } = toSydney(match.DateUtc);
  return {
    comp_id: compId,
    name: `${match.HomeTeam} v ${match.AwayTeam}`,
    date,
    time,
    // No dedicated "match id/venue/round" columns on races — reusing the
    // free-text distance field, since it's just displayed info, not validated.
    distance: `M${match.MatchNumber} · BBL Round ${match.RoundNumber} · ${match.Location}`,
    preview: '',
    horses: {
      0: { number: 1, name: match.HomeTeam, trainer: '', jockey: '', barrier: '', weight: '', silksId: '', amt: 0 },
      1: { number: 2, name: match.AwayTeam, trainer: '', jockey: '', barrier: '', weight: '', silksId: '', amt: 0 }
    }
  };
}

function extractMatchNumber(distance) {
  const m = /^M(\d+)/.exec(distance || '');
  return m ? m[1] : null;
}

async function main() {
  const raw = await readFile(FIXTURE_FILE, 'utf8');
  const matches = JSON.parse(raw);
  console.log(`Loaded ${matches.length} BBL fixtures from bbl16.json`);

  const compId = await resolveCompId();

  const { data: existingRaces, error: fetchErr } = await supabase
    .from('races').select('id, name, date, time, distance').eq('comp_id', compId);
  if (fetchErr) throw fetchErr;

  // Primary key: MatchNumber embedded in distance (survives a name change,
  // e.g. finals placeholder -> real teams). Fallback key: the old
  // name|date|time match, purely to migrate rows seeded before this field
  // existed — once updated they'll carry the M-number and use the primary
  // key on every run after this one.
  const existingByMatchNumber = new Map();
  const existingByLegacyKey = new Map();
  for (const r of existingRaces || []) {
    const num = extractMatchNumber(r.distance);
    if (num) existingByMatchNumber.set(num, r.id);
    else existingByLegacyKey.set(`${r.name}|${r.date}|${r.time}`, r.id);
  }

  let created = 0, updated = 0, failed = 0;

  for (const match of matches) {
    const race = matchToRace(match, compId);
    const existingId = existingByMatchNumber.get(String(match.MatchNumber))
      ?? existingByLegacyKey.get(`${race.name}|${race.date}|${race.time}`);

    try {
      if (existingId) {
        const { error } = await supabase.from('races').update(race).eq('id', existingId);
        if (error) throw error;
        updated++;
      } else {
        const { error } = await supabase.from('races').insert({ id: randomUUID(), ...race });
        if (error) throw error;
        created++;
      }
    } catch (err) {
      failed++;
      console.error(`Match #${match.MatchNumber} (${race.name}) failed: ${err.message}`);
    }
  }

  console.log(`\nDone. ${created} created, ${updated} updated, ${failed} failed. Comp: ${compId}`);
  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error('Seeder failed:', err.message);
  process.exit(1);
});
