import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import Stripe from 'https://esm.sh/stripe@13.10.0?target=deno'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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

    const { comp_id } = await req.json()
    if (!comp_id) {
      return new Response(JSON.stringify({ error: 'comp_id required' }), { status: 400, headers: corsHeaders })
    }

    const { data: comp } = await supabase.from('comps').select('*').eq('id', comp_id).single()
    if (!comp) {
      return new Response(JSON.stringify({ error: 'Competition not found' }), { status: 404, headers: corsHeaders })
    }
    if (comp.status !== 'active') {
      return new Response(JSON.stringify({ error: 'Competition is not active' }), { status: 400, headers: corsHeaders })
    }

    const { data: existing } = await supabase.from('user_comp_joinings')
      .select('payment_status').eq('user_id', user.id).eq('comp_id', comp_id).single()
    if (existing?.payment_status === 'completed') {
      return new Response(JSON.stringify({ error: 'Already joined' }), { status: 400, headers: corsHeaders })
    }

    const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
      apiVersion: '2023-10-16',
      httpClient: Stripe.createFetchHttpClient(),
    })

    const origin = req.headers.get('origin') || 'https://tmstipping.web.app'

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'aud',
          product_data: {
            name: comp.name,
            description: comp.description || `Entry fee for ${comp.name}`,
          },
          unit_amount: Math.round((comp.entry_fee || 0) * 100),
        },
        quantity: 1,
      }],
      mode: 'payment',
      success_url: `${origin}/comps.html?payment=success&session_id={CHECKOUT_SESSION_ID}&comp_id=${comp_id}`,
      cancel_url: `${origin}/comps.html?payment=cancelled`,
      metadata: { user_id: user.id, comp_id },
      customer_email: user.email ?? undefined,
    })

    return new Response(JSON.stringify({ url: session.url }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('create-checkout error:', err)
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
