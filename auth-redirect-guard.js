// Breaks infinite redirect loops between auth-gated pages (dark.html) and the
// public landing page (landing.html). Those two pages each redirect the other
// way based on session state, so any bug or edge case that makes them disagree
// about whether a session is valid (stale token, race during refresh, etc.)
// turns into an infinite bounce. This caps it: once too many redirects happen
// in a short window, force a real sign-out and stop, instead of continuing to
// trust a session that's clearly not working.
const GUARD_KEY = 'tms_redirect_guard';
const MAX_REDIRECTS = 4;
const WINDOW_MS = 8000;

export function guardedRedirect(destination, supabase) {
  let guard;
  try {
    guard = JSON.parse(sessionStorage.getItem(GUARD_KEY) || 'null');
  } catch {
    guard = null;
  }

  const now = Date.now();
  if (!guard || now - guard.ts > WINDOW_MS) {
    guard = { count: 0, ts: now };
  }
  guard.count += 1;
  guard.ts = now;
  sessionStorage.setItem(GUARD_KEY, JSON.stringify(guard));

  if (guard.count > MAX_REDIRECTS) {
    console.error('[auth-redirect-guard] Redirect loop detected — signing out to break the cycle.');
    sessionStorage.removeItem(GUARD_KEY);
    const goToLanding = () => { window.location.href = 'landing.html?authError=1'; };
    if (supabase) {
      supabase.auth.signOut().finally(goToLanding);
    } else {
      goToLanding();
    }
    return;
  }

  window.location.href = destination;
}

// Call once a page reaches a stable, non-redirecting state so a later
// legitimate redirect (e.g. next login) starts the count fresh.
export function clearRedirectGuard() {
  sessionStorage.removeItem(GUARD_KEY);
}
