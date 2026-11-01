// Whether the signed-in user may see the sweep (server-side rule: public.is_sweep_viewer()).
// Reads the session the page's own Supabase client stored, like nav-avatar.js.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './supabase-config.js';

export async function hasSweepAccess() {
  try {
    const ref = new URL(SUPABASE_URL).hostname.split('.')[0];
    const session = JSON.parse(localStorage.getItem(`sb-${ref}-auth-token`));
    if (!session?.access_token) return false;
    const res = await fetch(`${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/rpc/is_sweep_viewer`, {
      method: 'POST',
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
      body: '{}'
    });
    return res.ok && (await res.json()) === true;
  } catch { return false; }
}

// Whether the signed-in user has already entered any sweep (own rows only).
export async function hasEnteredSweep() {
  try {
    const ref = new URL(SUPABASE_URL).hostname.split('.')[0];
    const session = JSON.parse(localStorage.getItem(`sb-${ref}-auth-token`));
    const uid = session?.user?.id;
    if (!session?.access_token || !uid) return false;
    const res = await fetch(`${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/sweep_entries?select=sweep_id&user_id=eq.${encodeURIComponent(uid)}&limit=1`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${session.access_token}` }
    });
    return res.ok && (await res.json()).length > 0;
  } catch { return false; }
}

// Reveals nav links marked data-sweep-nav for users with access.
export async function revealSweepNav() {
  const links = document.querySelectorAll('[data-sweep-nav]');
  if (!links.length || !(await hasSweepAccess())) return;
  links.forEach(el => { el.style.display = ''; });
}
