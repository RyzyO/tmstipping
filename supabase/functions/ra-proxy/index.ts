import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'

// Server-side fetch for racing sites so the admin page can read their raw HTML.
//
// Why this exists: silk IDs only appear in the *raw* HTML of racingaustralia.horse
// pages. The public CORS proxies we used before either mangle it (r.jina.ai renders
// to markdown and silently drops the <img> for a meaningful share of horse pages) or
// choke on the ~1.3 MB meeting form page (allorigins 408s / 522s). Fetching from an
// edge function has no CORS problem, no third-party rate limit, and returns bytes
// exactly as the origin sent them — which is what makes silk scraping deterministic.
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Only proxy the racing sites we scrape — this must never become an open relay.
const ALLOWED_HOSTS = [
  'racingaustralia.horse',
  'www.racingaustralia.horse',
  'racing.racingnsw.com.au',
  'www.racing.racingnsw.com.au',
]

const UPSTREAM_TIMEOUT_MS = 45000

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const target = new URL(req.url).searchParams.get('url')
  if (!target) {
    return new Response('Missing ?url=', { status: 400, headers: corsHeaders })
  }

  let parsed: URL
  try {
    parsed = new URL(target)
  } catch {
    return new Response('Invalid url', { status: 400, headers: corsHeaders })
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return new Response('Unsupported protocol', { status: 400, headers: corsHeaders })
  }
  if (!ALLOWED_HOSTS.includes(parsed.hostname.toLowerCase())) {
    return new Response(`Host not allowed: ${parsed.hostname}`, { status: 403, headers: corsHeaders })
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS)
  try {
    // RA serves a trimmed page to obvious bots, so present as a normal browser.
    const upstream = await fetch(parsed.toString(), {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-AU,en;q=0.9',
      },
    })

    const body = await upstream.text()
    return new Response(body, {
      status: upstream.status,
      headers: {
        ...corsHeaders,
        'Content-Type': upstream.headers.get('content-type') || 'text/html; charset=utf-8',
        'Cache-Control': 'public, max-age=120',
      },
    })
  } catch (err) {
    const msg = (err as Error)?.name === 'AbortError'
      ? `Upstream timed out after ${UPSTREAM_TIMEOUT_MS / 1000}s`
      : (err as Error)?.message || 'Upstream fetch failed'
    return new Response(msg, { status: 502, headers: corsHeaders })
  } finally {
    clearTimeout(timer)
  }
})
