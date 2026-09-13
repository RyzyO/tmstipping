import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Moves the heavy part of admin-dark's "Save Results" flow (recalculating every
// comp's leaderboard, then one comp's streak) off the admin's browser and onto
// Supabase's own network — previously this ran as dozens of round-trip queries
// from whatever connection the admin happened to be on, hanging the tab for the
// whole recalculation. See admin-dark-script.js's saveResults/calculateAndSaveLeaderboard/
// calculateAndSaveStreak for the client-side logic this mirrors.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

// ---- Pure scoring helpers (mirrors scoring.js — duplicated here since edge
// functions bundle only their own directory) ----

// deno-lint-ignore no-explicit-any
function resolveScoredHorseId(race: any, tippedHorseId: string | null) {
  if (race?.horses && tippedHorseId && race.horses[tippedHorseId]?.scratched) {
    const sub = Object.entries(race.horses).find(([, h]: [string, any]) => h?.substitute)
    if (sub) return sub[0]
  }
  return tippedHorseId
}

// deno-lint-ignore no-explicit-any
function calculateTipPoints(race: any, result: any, horseId: string | null, jokerUsed: boolean) {
  if (!result || !horseId) return 0
  const scoredHorseId = resolveScoredHorseId(race, horseId)

  let points = 0
  const winnerPoints = Number(result.points ?? result.winner?.points ?? 0) || 0
  const place1Points = Number(result.place1_points ?? result.place1?.points ?? 0) || 0
  const place2Points = Number(result.place2_points ?? result.place2?.points ?? 0) || 0

  if (scoredHorseId === (result.winning_horse_id ?? result.winner?.idx)) {
    points += winnerPoints
  } else if (scoredHorseId === (result.place1_horse_id ?? result.place1?.idx)) {
    points += place1Points
  } else if (scoredHorseId === (result.place2_horse_id ?? result.place2?.idx)) {
    points += place2Points
  }

  if (jokerUsed && points > 0) points *= 2
  return points
}

function getWeekKey(dateStr: string) {
  const d = new Date(dateStr)
  const day = d.getUTCDay()
  const diffToMonday = day === 0 ? -6 : 1 - day
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + diffToMonday))
  return monday.toISOString().slice(0, 10)
}

// ---- Pagination: PostgREST caps a single select at 1000 rows with no error,
// so any table that can grow past that (tips especially — one row per user per
// race) needs paging or rows silently go missing. ----
// deno-lint-ignore no-explicit-any
async function fetchAllRows<T>(build: (from: number, to: number) => any): Promise<T[]> {
  const pageSize = 1000
  let from = 0
  let rows: T[] = []
  while (true) {
    const { data, error } = await build(from, from + pageSize - 1)
    if (error) throw error
    rows = rows.concat(data || [])
    if (!data || data.length < pageSize) break
    from += pageSize
  }
  return rows
}

// A race belongs to exactly one comp, so only that comp's standings can possibly
// change — no need to touch (or even fetch) every other comp that's ever run.
// The one-row-per-request `.update()` loop this replaced was the real cost: for
// this project's data that was hundreds of sequential round-trips on every save,
// dwarfing the DB-vs-browser latency difference the edge function move bought.
// deno-lint-ignore no-explicit-any
async function calculateAndSaveLeaderboard(supabase: any, compId: string) {
  const races = await fetchAllRows<any>((from, to) => supabase.from('races').select('*').eq('comp_id', compId).range(from, to))
  const raceById: Record<string, any> = {}
  races.forEach((r) => { raceById[r.id] = r })
  const raceIds = races.map((r) => r.id)
  if (raceIds.length === 0) return { compId, usersUpdated: 0 }

  const results = await fetchAllRows<any>((from, to) => supabase.from('results').select('*').in('race_id', raceIds).range(from, to))
  if (results.length === 0) return { compId, usersUpdated: 0 }

  const tips = await fetchAllRows<any>((from, to) => supabase.from('tips').select('*').eq('comp_id', compId).in('race_id', raceIds).range(from, to))
  const tipsByRaceId: Record<string, any[]> = {}
  tips.forEach((t) => {
    if (!tipsByRaceId[t.race_id]) tipsByRaceId[t.race_id] = []
    tipsByRaceId[t.race_id].push(t)
  })

  // Only existing joinings are ever written — a stray tip with no corresponding
  // user_comp_joinings row (never joined/paid) must not turn into a phantom one
  // via upsert, so this doubles as both the "does this row exist" set and the
  // batch target list.
  const existingJoinings = await fetchAllRows<any>((from, to) => supabase.from('user_comp_joinings').select('user_id').eq('comp_id', compId).range(from, to))
  const existingUserIds = new Set(existingJoinings.map((j) => j.user_id))

  const userPoints: Record<string, { user_id: string; points: number; wins: number }> = {}

  for (const result of results) {
    const raceId = result.race_id || result.id
    const winnerHorseId = result.winning_horse_id || result.winner?.idx || null
    const place1HorseId = result.place1_horse_id || result.place1?.idx || null
    const place2HorseId = result.place2_horse_id || result.place2?.idx || null
    const winnerPoints = Number(result.points ?? result.winner?.points ?? 0) || 0
    const place1Points = Number(result.place1_points ?? result.place1?.points ?? 0) || 0
    const place2Points = Number(result.place2_points ?? result.place2?.points ?? 0) || 0

    for (const tip of (tipsByRaceId[raceId] || [])) {
      const userId = tip.user_id
      if (!userId || !existingUserIds.has(userId)) continue

      if (!userPoints[userId]) userPoints[userId] = { user_id: userId, points: 0, wins: 0 }

      const scoredHorseId = resolveScoredHorseId(raceById[raceId], tip.horse_id)

      let pts = 0
      let wasWin = false
      if (winnerHorseId && scoredHorseId == winnerHorseId) { pts += winnerPoints; wasWin = true }
      else if (place1HorseId && scoredHorseId == place1HorseId) pts += place1Points
      else if (place2HorseId && scoredHorseId == place2HorseId) pts += place2Points
      if (pts > 0 && tip.joker === true) pts *= 2

      userPoints[userId].points += pts
      if (wasWin) userPoints[userId].wins += 1
    }
  }

  const entries = Object.values(userPoints).sort((a, b) =>
    b.points !== a.points ? b.points - a.points : b.wins - a.wins
  )

  let lastPoints: number | null = null
  let lastWins: number | null = null
  let lastRank = 0
  const now = new Date().toISOString()
  const upsertRows = entries.map((entry, idx) => {
    const rank = (entry.points === lastPoints && entry.wins === lastWins) ? lastRank : idx + 1
    lastPoints = entry.points; lastWins = entry.wins; lastRank = rank
    return {
      id: `${entry.user_id}_${compId}`,
      user_id: entry.user_id,
      comp_id: compId,
      points: entry.points,
      wins: entry.wins,
      rank,
      updated_at: now,
    }
  })

  // One batched request instead of one per user — every row here is confirmed
  // above to already exist, so this can only ever update, never insert.
  const BATCH_SIZE = 500
  for (let i = 0; i < upsertRows.length; i += BATCH_SIZE) {
    const { error } = await supabase.from('user_comp_joinings')
      .upsert(upsertRows.slice(i, i + BATCH_SIZE), { onConflict: 'user_id,comp_id' })
    if (error) throw error
  }

  return { compId, usersUpdated: upsertRows.length }
}

// deno-lint-ignore no-explicit-any
async function calculateAndSaveStreak(supabase: any, compId: string) {
  const { data: comp } = await supabase.from('comps').select('id,streak_start_date,streak_locked_at').eq('id', compId).maybeSingle()
  if (!comp?.streak_start_date) return { skipped: 'streak not started' }

  const entriesOpen = !comp.streak_locked_at
  if (entriesOpen) {
    const { data: joinings } = await supabase.from('user_comp_joinings').select('user_id').eq('comp_id', compId).eq('payment_status', 'completed')
    const { data: existingRows } = await supabase.from('streak_status').select('user_id').eq('comp_id', compId)
    const existingIds = new Set((existingRows || []).map((r: any) => r.user_id))
    const newRows = (joinings || [])
      .filter((j: any) => !existingIds.has(j.user_id))
      .map((j: any) => ({ id: `${j.user_id}_${compId}`, user_id: j.user_id, comp_id: compId, status: 'alive', eliminated_week: null, updated_at: new Date().toISOString() }))
    if (newRows.length > 0) {
      await supabase.from('streak_status').upsert(newRows, { onConflict: 'user_id,comp_id' })
    }
  }

  const streakRows = await fetchAllRows<any>((from, to) => supabase.from('streak_status').select('*').eq('comp_id', compId).range(from, to))
  if (streakRows.length === 0) return { skipped: 'no entrants' }

  // Status is recomputed from scratch every time, not layered onto whatever's
  // already stored — otherwise a bad calculation permanently eliminates someone
  // even after the underlying bug is fixed, since the loop below only ever
  // eliminates, never revives.
  const statusMap: Record<string, { status: string; eliminated_week: string | null }> = {}
  streakRows.forEach((row: any) => { statusMap[row.user_id] = { status: 'alive', eliminated_week: null } })

  const races = (await fetchAllRows<any>((from, to) => supabase.from('races').select('*').eq('comp_id', compId).range(from, to)))
    .filter((r) => r.date && new Date(r.date) >= new Date(comp.streak_start_date))
  if (races.length === 0) return { skipped: 'no races yet' }

  const raceById: Record<string, any> = {}
  races.forEach((r) => { raceById[r.id] = r })
  const raceIds = races.map((r) => r.id)

  const results = await fetchAllRows<any>((from, to) => supabase.from('results').select('*').in('race_id', raceIds).range(from, to))
  const resultByRaceId: Record<string, any> = {}
  results.forEach((r) => { resultByRaceId[r.race_id || r.id] = r })

  const tips = await fetchAllRows<any>((from, to) => supabase.from('tips').select('*').eq('comp_id', compId).in('race_id', raceIds).range(from, to))

  const weekAllRaces: Record<string, string[]> = {}
  races.forEach((race) => {
    const week = getWeekKey(race.date)
    if (!weekAllRaces[week]) weekAllRaces[week] = []
    weekAllRaces[week].push(race.id)
  })

  // Only evaluate a week once every race scheduled that week has a result —
  // otherwise a user could be eliminated off an early race before a later
  // race that same week (their chance to survive) has even been run.
  const weekMap: Record<string, string[]> = {}
  Object.entries(weekAllRaces).forEach(([week, raceIdsThisWeek]) => {
    if (raceIdsThisWeek.every((id) => resultByRaceId[id])) weekMap[week] = raceIdsThisWeek
  })
  const weeks = Object.keys(weekMap).sort()

  for (const week of weeks) {
    const aliveUserIds = Object.keys(statusMap).filter((uid) => statusMap[uid].status === 'alive')
    if (aliveUserIds.length <= 1) break

    const raceIdsThisWeek = new Set(weekMap[week])
    const scoredThisWeek = new Set<string>()
    for (const tip of tips) {
      if (!raceIdsThisWeek.has(tip.race_id)) continue
      if (statusMap[tip.user_id]?.status !== 'alive') continue
      const race = raceById[tip.race_id]
      const result = resultByRaceId[tip.race_id]
      const pts = calculateTipPoints(race, result, tip.horse_id, tip.joker === true)
      if (pts > 0) scoredThisWeek.add(tip.user_id)
    }

    if (scoredThisWeek.size > 0) {
      aliveUserIds.forEach((uid) => {
        if (!scoredThisWeek.has(uid)) statusMap[uid] = { status: 'eliminated', eliminated_week: week }
      })
    }
    // else: wipeout week, everyone alive carries over

    const stillAlive = Object.keys(statusMap).filter((uid) => statusMap[uid].status === 'alive')
    if (stillAlive.length === 1) {
      statusMap[stillAlive[0]] = { status: 'winner', eliminated_week: null }
      break
    }
  }

  const now = new Date().toISOString()
  const upsertRows = Object.entries(statusMap).map(([userId, s]) => ({
    id: `${userId}_${compId}`,
    user_id: userId,
    comp_id: compId,
    status: s.status,
    eliminated_week: s.eliminated_week,
    updated_at: now,
  }))
  await supabase.from('streak_status').upsert(upsertRows, { onConflict: 'user_id,comp_id' })

  // The first race that gets a result closes the entry list for good.
  if (entriesOpen && weeks.length > 0) {
    await supabase.from('comps').update({ streak_locked_at: now }).eq('id', compId)
  }

  const alive = Object.values(statusMap).filter((s) => s.status === 'alive').length
  return { alive, weeksEvaluated: weeks.length }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const admin = createClient(supabaseUrl, serviceRoleKey)

  // Callers hit this with their own session JWT (supabase-js's functions.invoke
  // attaches it automatically) — verify it and require the admin flag, since this
  // writes results/leaderboard/streak data for every entrant in the competition.
  const authHeader = req.headers.get('Authorization') || ''
  const jwt = authHeader.replace(/^Bearer\s+/i, '')
  if (!jwt) return json({ error: 'Missing Authorization header' }, 401)

  const { data: userData, error: authError } = await admin.auth.getUser(jwt)
  if (authError || !userData?.user) return json({ error: 'Invalid session' }, 401)

  const { data: callerRow } = await admin.from('users').select('admin').eq('id', userData.user.id).maybeSingle()
  if (!callerRow?.admin) return json({ error: 'Admin access required' }, 403)

  let body: any
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }

  const { raceId, winnerHorseId, place1HorseId, place2HorseId, winnerPoints, place1Points, place2Points } = body || {}
  if (!raceId) return json({ error: 'raceId is required' }, 400)

  try {
    const { data: race, error: raceError } = await admin.from('races').select('*').eq('id', raceId).maybeSingle()
    if (raceError) throw raceError
    if (!race) return json({ error: 'Race not found' }, 404)

    const resolvedWinnerPoints = parseFloat(winnerPoints) || 10
    const resolvedPlace1Points = parseFloat(place1Points) || 5
    const resolvedPlace2Points = parseFloat(place2Points) || 2

    const result = {
      id: raceId,
      race_id: raceId,
      race_name: race.name,
      winner: winnerHorseId ? { idx: winnerHorseId, name: race.horses?.[winnerHorseId]?.name, points: resolvedWinnerPoints } : null,
      place1: place1HorseId ? { idx: place1HorseId, name: race.horses?.[place1HorseId]?.name, points: resolvedPlace1Points } : null,
      place2: place2HorseId ? { idx: place2HorseId, name: race.horses?.[place2HorseId]?.name, points: resolvedPlace2Points } : null,
      winning_horse_id: winnerHorseId || null,
      place1_horse_id: place1HorseId || null,
      place2_horse_id: place2HorseId || null,
      points: resolvedWinnerPoints,
      place1_points: resolvedPlace1Points,
      place2_points: resolvedPlace2Points,
      comp_id: race.comp_id || null,
      created_at: new Date().toISOString(),
    }

    const { error: resultError } = await admin.from('results').upsert(result)
    if (resultError) throw resultError

    const leaderboardOutcome = race.comp_id ? await calculateAndSaveLeaderboard(admin, race.comp_id) : { skipped: 'race has no comp_id' }
    const streakOutcome = race.comp_id ? await calculateAndSaveStreak(admin, race.comp_id) : { skipped: 'race has no comp_id' }

    return json({ success: true, leaderboard: leaderboardOutcome, streak: streakOutcome })
  } catch (error) {
    console.error('save-race-results error:', error)
    return json({ error: (error as Error).message || 'Unknown error' }, 500)
  }
})
