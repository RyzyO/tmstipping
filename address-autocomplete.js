// Free, API-key-less address autocomplete backed by OpenStreetMap Nominatim.
// Usage policy: https://operations.osmfoundation.org/policies/nominatim/
// Max ~1 request/second, so input is debounced well above that.
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const DEBOUNCE_MS = 500;
const MIN_QUERY_LENGTH = 5;

const STATE_NAME_TO_ABBR = {
  'new south wales': 'NSW',
  'queensland': 'QLD',
  'victoria': 'VIC',
  'australian capital territory': 'ACT',
  'south australia': 'SA',
  'western australia': 'WA',
  'tasmania': 'TAS',
  'northern territory': 'NT'
};

function parseSuggestion(result) {
  const addr = result.address || {};
  const streetParts = [addr.house_number, addr.road].filter(Boolean);
  const street = streetParts.join(' ') || result.display_name.split(',')[0];
  const suburb = addr.suburb || addr.city_district || addr.town || addr.city || addr.village || '';
  const postcode = addr.postcode || '';
  const stateAbbr = STATE_NAME_TO_ABBR[(addr.state || '').toLowerCase()] || '';

  return {
    label: result.display_name,
    street,
    suburb,
    postcode,
    state: stateAbbr
  };
}

async function fetchSuggestions(query) {
  const params = new URLSearchParams({
    format: 'json',
    addressdetails: '1',
    countrycodes: 'au',
    limit: '5',
    q: query
  });

  const response = await fetch(`${NOMINATIM_URL}?${params.toString()}`, {
    headers: { 'Accept': 'application/json' }
  });
  if (!response.ok) return [];
  const results = await response.json();
  return results.map(parseSuggestion);
}

// Wires a text input to a floating suggestion dropdown. Selecting a suggestion
// invokes onSelect({ street, suburb, postcode, state }).
export function attachAddressAutocomplete(inputEl, { onSelect } = {}) {
  if (!inputEl) return;

  const dropdown = document.createElement('div');
  dropdown.className = 'address-autocomplete-dropdown';
  dropdown.style.cssText = `
    position: absolute;
    z-index: 60;
    left: 0;
    right: 0;
    margin-top: 4px;
    background: #1f2937;
    border: 1px solid rgba(75, 85, 99, 0.6);
    border-radius: 8px;
    max-height: 220px;
    overflow-y: auto;
    box-shadow: 0 10px 25px rgba(0,0,0,0.4);
    display: none;
  `;

  const wrapper = inputEl.parentElement;
  if (getComputedStyle(wrapper).position === 'static') {
    wrapper.style.position = 'relative';
  }
  wrapper.appendChild(dropdown);

  let debounceTimer = null;
  let currentSuggestions = [];
  let activeRequestId = 0;

  function hideDropdown() {
    dropdown.style.display = 'none';
    dropdown.innerHTML = '';
  }

  function renderDropdown(suggestions) {
    currentSuggestions = suggestions;
    if (!suggestions.length) {
      hideDropdown();
      return;
    }
    dropdown.innerHTML = suggestions.map((s, i) => `
      <div class="address-autocomplete-item" data-index="${i}" style="
        padding: 10px 12px;
        cursor: pointer;
        color: #e5e7eb;
        font-size: 0.875rem;
        border-bottom: 1px solid rgba(75, 85, 99, 0.3);
      ">${s.label}</div>
    `).join('');
    dropdown.style.display = 'block';

    dropdown.querySelectorAll('.address-autocomplete-item').forEach(item => {
      item.addEventListener('mouseenter', () => { item.style.background = 'rgba(251, 191, 36, 0.12)'; });
      item.addEventListener('mouseleave', () => { item.style.background = 'transparent'; });
      item.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const idx = Number(item.getAttribute('data-index'));
        const selected = currentSuggestions[idx];
        if (!selected) return;
        inputEl.value = selected.street;
        hideDropdown();
        if (onSelect) onSelect(selected);
      });
    });
  }

  inputEl.addEventListener('input', () => {
    const query = inputEl.value.trim();
    if (debounceTimer) clearTimeout(debounceTimer);

    if (query.length < MIN_QUERY_LENGTH) {
      hideDropdown();
      return;
    }

    debounceTimer = setTimeout(async () => {
      const requestId = ++activeRequestId;
      try {
        const suggestions = await fetchSuggestions(query);
        if (requestId !== activeRequestId) return; // stale response
        renderDropdown(suggestions);
      } catch {
        if (requestId === activeRequestId) hideDropdown();
      }
    }, DEBOUNCE_MS);
  });

  inputEl.addEventListener('blur', () => {
    // Delay so a mousedown on a suggestion registers before the dropdown is hidden.
    setTimeout(hideDropdown, 150);
  });

  document.addEventListener('click', (e) => {
    if (e.target !== inputEl && !dropdown.contains(e.target)) hideDropdown();
  });
}
