import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import Stripe from 'https://esm.sh/stripe@13.10.0?target=deno'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

serve(async (req) => {
  const signature = req.headers.get('stripe-signature')
  if (!signature) {
    return new Response('Missing stripe-signature', { status: 400 })
  }

  const body = await req.text()

  const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
    apiVersion: '2023-10-16',
    httpClient: Stripe.createFetchHttpClient(),
  })

  let event: Stripe.Event
  try {
    event = await stripe.webhooks.constructEventAsync(
      body,
      signature,
      Deno.env.get('STRIPE_WEBHOOK_SECRET')!
    )
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message)
    return new Response(`Webhook Error: ${err.message}`, { status: 400 })
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session
    const { user_id, comp_id } = session.metadata ?? {}

    if (!user_id || !comp_id) {
      console.error('Missing metadata in session', session.id)
      return new Response('Missing metadata', { status: 400 })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const [{ data: comp }, { data: existing }] = await Promise.all([
      supabase.from('comps').select('joker_allowance, participant_count').eq('id', comp_id).single(),
      supabase.from('user_comp_joinings').select('*').eq('user_id', user_id).eq('comp_id', comp_id).single(),
    ])

    const wasCompleted = existing?.payment_status === 'completed'

    const { error: upsertError } = await supabase.from('user_comp_joinings').upsert({
      id: `${user_id}_${comp_id}`,
      user_id,
      comp_id,
      payment_status: 'completed',
      rank: existing?.rank ?? null,
      points: existing?.points ?? 0,
      wins: existing?.wins ?? 0,
      jokers_remaining: existing?.jokers_remaining ?? (comp?.joker_allowance ?? 3),
    }, { onConflict: 'user_id,comp_id' })

    if (upsertError) {
      console.error('Failed to upsert joining:', upsertError)
      return new Response('DB error', { status: 500 })
    }

    if (!wasCompleted) {
      await supabase.from('comps').update({
        participant_count: (comp?.participant_count || 0) + 1,
      }).eq('id', comp_id)
    }

    console.log(`Payment confirmed: user=${user_id} comp=${comp_id}`)
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
