import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const ONESIGNAL_APP_ID = '6521b586-f3af-4422-b488-449a78cb8a44'

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
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    )

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders })
    }

    const body = await req.json()
    const title = String(body?.title || '').trim()
    const message = String(body?.body || '').trim()
    const audienceType = body?.audienceType || 'self'
    const compId = body?.compId || null
    const targetUserId = body?.userId || null

    if (!title || !message) {
      return new Response(JSON.stringify({ error: 'title and body are required' }), { status: 400, headers: corsHeaders })
    }

    let onesignalPayload: Record<string, unknown>
    let targetUserIds: string[] = []

    if (audienceType === 'self') {
      targetUserIds = [user.id]
    } else if (audienceType === 'user') {
      // Only admins may target an arbitrary user; everyone may target themselves.
      if (targetUserId && targetUserId !== user.id) {
        const { data: adminRow } = await supabase.from('users').select('admin').eq('id', user.id).single()
        if (!adminRow?.admin) {
          return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: corsHeaders })
        }
      }
      targetUserIds = [targetUserId || user.id]
    } else if (audienceType === 'competition') {
      const { data: adminRow } = await supabase.from('users').select('admin').eq('id', user.id).single()
      if (!adminRow?.admin) {
        return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: corsHeaders })
      }
      if (!compId) {
        return new Response(JSON.stringify({ error: 'compId required' }), { status: 400, headers: corsHeaders })
      }
      const { data: joinings } = await supabase
        .from('user_comp_joinings')
        .select('user_id')
        .eq('comp_id', compId)
        .eq('payment_status', 'completed')
      targetUserIds = [...new Set((joinings || []).map((j: { user_id: string }) => j.user_id).filter(Boolean))]
    } else if (audienceType === 'all') {
      const { data: adminRow } = await supabase.from('users').select('admin').eq('id', user.id).single()
      if (!adminRow?.admin) {
        return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: corsHeaders })
      }
    } else {
      return new Response(JSON.stringify({ error: 'Invalid audienceType' }), { status: 400, headers: corsHeaders })
    }

    if (audienceType === 'all') {
      onesignalPayload = {
        included_segments: ['Subscribed Users'],
        headings: { en: title },
        contents: { en: message },
      }
    } else {
      if (!targetUserIds.length) {
        return new Response(JSON.stringify({ success: true, targetUsers: 0, note: 'No recipients found' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      onesignalPayload = {
        include_external_user_ids: targetUserIds,
        channel_for_external_user_ids: 'push',
        headings: { en: title },
        contents: { en: message },
      }
    }

    const result = await sendOneSignalPush(onesignalPayload)
    const recipientCount = audienceType === 'all' ? (result?.recipients ?? 0) : targetUserIds.length

    return new Response(JSON.stringify({ success: true, targetUsers: recipientCount, oneSignalId: result?.id }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('send-onesignal error:', err)
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
