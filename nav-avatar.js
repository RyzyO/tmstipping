// Shows the user's silk in a circle on the Profile row of the mobile nav drawer.
// Reads the session the page's own Supabase client already stored, so it does not
// create a second auth client that could race the token refresh.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './supabase-config.js';

const CHAMPIONS_SILK_KEY = 'champions';
const CHAMPIONS_SILK_IMAGE = 'static/silks/champion.png';
const CACHE_KEY = 'tms_nav_silk';

function readSession() {
  try {
    const ref = new URL(SUPABASE_URL).hostname.split('.')[0];
    return JSON.parse(localStorage.getItem(`sb-${ref}-auth-token`));
  } catch { return null; }
}

function silkSrc(silk) {
  return String(silk) === CHAMPIONS_SILK_KEY ? CHAMPIONS_SILK_IMAGE : `static/silks/${silk || 1}.png`;
}

function readCache(uid) {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY));
    return c && c.uid === uid ? c.silk : null;
  } catch { return null; }
}

function render(row, silk) {
  let img = row.querySelector('.nav-item-silk');
  if (!img) {
    img = document.createElement('img');
    img.className = 'nav-item-silk';
    img.alt = '';
    row.querySelector('i, svg')?.remove();
    row.prepend(img);
  }
  img.onerror = () => { img.onerror = null; img.src = silkSrc(1); };
  img.src = silkSrc(silk);
}

async function init() {
  const session = readSession();
  const uid = session?.user?.id;
  const row = document.querySelector('#navDrawer .nav-item[data-href="profiledark.html"]');
  if (!uid || !row) return;

  const style = document.createElement('style');
  style.textContent = `
    .nav-item .nav-item-silk { width: 24px; height: 24px; border-radius: 50%; object-fit: cover; flex-shrink: 0;
      background: #1f2937; border: 1.5px solid #fbbf24; }`;
  document.head.appendChild(style);

  const cached = readCache(uid);
  render(row, cached ?? 1);

  try {
    const res = await fetch(`${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/users?id=eq.${encodeURIComponent(uid)}&select=silk`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${session.access_token}` }
    });
    if (!res.ok) return;
    const [data] = await res.json();
    const silk = data?.silk || 1;
    if (String(silk) !== String(cached)) render(row, silk);
    localStorage.setItem(CACHE_KEY, JSON.stringify({ uid, silk }));
  } catch { /* keep the cached or default silk */ }
}

init();
