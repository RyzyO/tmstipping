import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import UPNG from 'https://esm.sh/upng-js@2.1.0'

// Extracts a single dominant colour from a Racing Australia jockey silk so the
// frontend can theme result/leaderboard entries without touching the image's
// pixels itself. Those silks come from a third-party host with no CORS headers
// (see ra-proxy's header for the same host-restriction rationale), so a browser
// canvas read on them throws a SecurityError — decoding server-side sidesteps
// that entirely and lets the client just fetch a small JSON colour value.
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const SILK_URL = (id: string) => `https://www.racingaustralia.horse/JockeySilks/${id}.png`
const UPSTREAM_TIMEOUT_MS = 15000

// Warm edge function instances can serve many requests, and a silk's colour
// never changes once it's been drawn — cache across invocations in-memory.
const cache = new Map<string, string>()
const MAX_CACHE_ENTRIES = 2000

// Racing silks are almost always described by their vivid colour(s) — black and
// white typically appear only as trim/outline, not as "the colour of the silk".
// A plain frequency count picks whichever has more pixels, which on a checked
// silk (thin anti-aliased edges between big black/gold squares) often hands the
// win to black — a chequered gold-and-black silk should read as gold, not grey.
// So: bucket everything, but only let saturated pixels vote unless the silk
// truly has no colour to offer (a genuinely black/white/grey silk).
function saturation(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  if (max === 0) return 0
  return (max - min) / max
}

function pickDominantBucket(
  rgba: Uint8Array,
  width: number,
  height: number,
  minSaturation: number,
): { count: number; r: number; g: number; b: number } | null {
  const buckets = new Map<string, { count: number; r: number; g: number; b: number }>()

  for (let i = 0; i < width * height; i++) {
    const o = i * 4
    if (rgba[o + 3] < 128) continue // skip transparent background

    const r = rgba[o], g = rgba[o + 1], b = rgba[o + 2]
    if (saturation(r, g, b) < minSaturation) continue

    const key = `${r >> 5}_${g >> 5}_${b >> 5}` // 8x8x8 buckets

    const bucket = buckets.get(key)
    if (bucket) {
      bucket.count++
      bucket.r += r
      bucket.g += g
      bucket.b += b
    } else {
      buckets.set(key, { count: 1, r, g, b })
    }
  }

  let best: { count: number; r: number; g: number; b: number } | null = null
  for (const bucket of buckets.values()) {
    if (!best || bucket.count > best.count) best = bucket
  }
  return best
}

function quantizedDominantColor(rgba: Uint8Array, width: number, height: number): string | null {
  // Try saturated pixels first (the silk's actual colour); fall back to
  // everything only if the image has nothing but black/white/grey to offer.
  const best = pickDominantBucket(rgba, width, height, 0.35) || pickDominantBucket(rgba, width, height, 0)
  if (!best) return null

  const r = Math.round(best.r / best.count)
  const g = Math.round(best.g / best.count)
  const b = Math.round(best.b / best.count)
  return `#${[r, g, b].map(n => n.toString(16).padStart(2, '0')).join('')}`
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const id = new URL(req.url).searchParams.get('id')
  if (!id || !/^\d+$/.test(id)) {
    return new Response(JSON.stringify({ error: 'Missing or invalid ?id=' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const cached = cache.get(id)
  if (cached) {
    return new Response(JSON.stringify({ id, color: cached }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=86400' },
    })
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS)
  try {
    const upstream = await fetch(SILK_URL(id), {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    })

    if (!upstream.ok) {
      return new Response(JSON.stringify({ error: `Silk not found (${upstream.status})` }), {
        status: upstream.status === 404 ? 404 : 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const buf = await upstream.arrayBuffer()
    const img = UPNG.decode(buf)
    const rgba = new Uint8Array(UPNG.toRGBA8(img)[0])
    const color = quantizedDominantColor(rgba, img.width, img.height) || '#808080'

    if (cache.size >= MAX_CACHE_ENTRIES) cache.clear()
    cache.set(id, color)

    return new Response(JSON.stringify({ id, color }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=86400' },
    })
  } catch (err) {
    const msg = (err as Error)?.name === 'AbortError'
      ? `Upstream timed out after ${UPSTREAM_TIMEOUT_MS / 1000}s`
      : (err as Error)?.message || 'Failed to extract colour'
    return new Response(JSON.stringify({ error: msg }), {
      status: 502,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } finally {
    clearTimeout(timer)
  }
})
