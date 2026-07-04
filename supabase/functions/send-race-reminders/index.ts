import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { DateTime } from 'https://esm.sh/luxon@3.4.4'

const ONESIGNAL_APP_ID = '6521b586-f3af-4422-b488-449a78cb8a44'
const TZ = 'Australia/Sydney'

async function sendOneSignalPush(payload: Record<string, unknown>) {
  const res = await fetch('https://onesignal.com/api/v1/notifications', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Authorization': `Basic ${Deno.env.get('ONESIGNAL_REST_API_KEY')}`,
    },
    body: JSON.stringify({ app_id: ONESIGNAL_APP_ID, ...payload }),
  })
  const json = await res.json()
  if (!res.ok) {
    throw new Error(json?.errors?.join?.(', ') || JSON.stringify(json))
  }
  return json
}

serve(async (req) => {
  // Triggered by pg_cron every minute — authenticated with a shared secret,
  // not a user JWT, since there's no logged-in user in this context.
  const cronSecret = req.headers.get('x-cron-secret')
  if (!cronSecret || cronSecret !== Deno.env.get('CRON_SECRET')) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  try {
    const now = DateTime.now().setZone(TZ)
    const startWindow = now.plus({ minutes: 4 })
    const endWindow = now.plus({ minutes: 6 })

    const dateKeys = [...new Set([startWindow.toFormat('yyyy-MM-dd'), endWindow.toFormat('yyyy-MM-dd')])]

    const { data: races, error: racesError } = await supabase
      .from('races')
      .select('id, name, date, time, comp_id')
      .in('date', dateKeys)
    if (racesError) throw racesError

    const results = []

    for (const race of races || []) {
      const timeStr = String(race.time || '').trim().substring(0, 5)
      if (!race.date || !timeStr) continue

      const jump = DateTime.fromFormat(`${race.date} ${timeStr}`, 'yyyy-MM-dd HH:mm', { zone: TZ })
      if (!jump.isValid || jump < startWindow || jump >= endWindow) continue

      // Dedupe: skip if we've already sent a reminder for this exact race/date/time
      const { data: existingMarker } = await supabase
        .from('race_reminder_sends')
        .select('race_id')
        .eq('race_id', race.id)
        .eq('race_date', race.date)
        .eq('race_time', timeStr)
        .maybeSingle()
      if (existingMarker) continue

      let targetUserIds: string[] = []
      if (race.comp_id) {
        const { data: joinings } = await supabase
          .from('user_comp_joinings')
          .select('user_id')
          .eq('comp_id', race.comp_id)
          .eq('payment_status', 'completed')
        targetUserIds = [...new Set((joinings || []).map((j: { user_id: string }) => j.user_id).filter(Boolean))]
      }

      if (targetUserIds.length) {
        const title = 'Race starts in 5 minutes'
        const body = `${race.name || 'Upcoming race'} jumps at ${timeStr} (Sydney)`

        await sendOneSignalPush({
          include_external_user_ids: targetUserIds,
          channel_for_external_user_ids: 'push',
          headings: { en: title },
          contents: { en: body },
        })

        await supabase.from('notifications').insert({
          id: crypto.randomUUID(),
          data: {
            title,
            body,
            category: 'race-reminder',
            audienceType: 'competition',
            compId: race.comp_id,
            createdAt: new Date().toISOString(),
          },
        })
      }

      await supabase.from('race_reminder_sends').insert({
        race_id: race.id,
        race_date: race.date,
        race_time: timeStr,
        target_users: targetUserIds.length,
      })

      results.push({ raceId: race.id, targetUsers: targetUserIds.length })
    }

    return new Response(JSON.stringify({ success: true, processed: results.length, results }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('send-race-reminders error:', err)
    return new Response(JSON.stringify({ error: err.message }), { status: 500 })
  }
})
