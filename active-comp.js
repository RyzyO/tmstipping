// Shared "which competition am I looking at" resolution.
// Admin sets one comp as the default (comps.is_default); users can override
// via the footer switcher, which is remembered in localStorage.
// v2: an earlier version of this file cached auto-resolved comps as if they were
// explicit user choices. Renaming the key invalidates those stale values app-wide
// without requiring every browser to manually clear localStorage.
const STORAGE_KEY = 'tms:activeCompId:v2';

export function getStoredCompId() {
  try { return localStorage.getItem(STORAGE_KEY) || null; } catch { return null; }
}

export function setStoredCompId(id) {
  try {
    if (id) localStorage.setItem(STORAGE_KEY, id);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {}
}

export async function fetchDefaultCompId(supabase) {
  const { data: def } = await supabase
    .from('comps').select('id').eq('is_default', true).eq('status', 'active')
    .limit(1).maybeSingle();
  if (def?.id) return def.id;

  const { data: fallback } = await supabase
    .from('comps').select('id').eq('status', 'active')
    .order('start_date', { ascending: false }).limit(1).maybeSingle();
  return fallback?.id || null;
}

// Resolves which comp should currently be shown: explicit ?compId= in the URL
// wins for this page view, then whatever the user last picked in the footer
// switcher, then the admin-set default. Only the footer switcher writes to
// storage — automatic resolution never caches a value, so it always reflects
// the current admin default until a person actually overrides it.
export async function resolveActiveCompId(supabase, { useQueryParam = true } = {}) {
  if (useQueryParam) {
    const fromUrl = new URLSearchParams(window.location.search).get('compId');
    if (fromUrl) return fromUrl;
  }

  const stored = getStoredCompId();
  if (stored) return stored;

  return fetchDefaultCompId(supabase);
}

// Renders a small, understated "Competition: [switcher]" control into mountEl.
// Stays empty (no clutter) when there's only one live comp to choose from.
export async function mountCompFooterSwitcher(supabase, mountEl, { onChange } = {}) {
  if (!mountEl) return;

  const { data: comps } = await supabase
    .from('comps')
    .select('id, name, status')
    .neq('status', 'deleted')
    .eq('is_hidden', false)
    .order('start_date', { ascending: false });

  const list = comps || [];
  if (list.length < 2) return;

  const current = await resolveActiveCompId(supabase, { useQueryParam: false });

  mountEl.innerHTML = `
    <div class="flex items-center gap-2 text-xs text-gray-500">
      <label for="footer-comp-switch" class="whitespace-nowrap">Competition</label>
      <select id="footer-comp-switch" class="bg-gray-900 border border-gray-800 text-gray-400 text-xs rounded-md pl-2 pr-6 py-1 focus:outline-none focus:border-yellow-500/50 hover:text-gray-300 transition cursor-pointer">
        ${list.map(c => `<option value="${c.id}" ${c.id === current ? 'selected' : ''}>${c.name}</option>`).join('')}
      </select>
    </div>
  `;

  const select = mountEl.querySelector('#footer-comp-switch');
  select.addEventListener('change', () => {
    setStoredCompId(select.value);
    if (onChange) onChange(select.value);
    else window.location.reload();
  });
}
