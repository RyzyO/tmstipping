import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './supabase-config.js';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Global State
let currentRaceId = null;
let allRaces = [];
let currentTab = 'details';
let racesByDateCache = {};
let sortedDatesCache = [];
let selectedAdminCompId = null;
let allComps = [];
let allCompsForManagement = [];
let currentAdminUser = null;
let notificationUsersCache = [];
let selectedNotificationUser = null;

const ADMIN_STATS_CACHE_KEY = 'tmstipping:adminStats';

// Initialize Feather Icons
feather.replace();

// Luxon DateTime
const { DateTime } = luxon;

// ============ AUTH & INITIALIZATION ============
supabase.auth.onAuthStateChange((event, session) => {
  const user = session?.user || null;
  if (!user) {
    alert("You must be logged in.");
    window.location.href = "login.html";
    return;
  }
  user.uid = user.id;
  setTimeout(async () => {
    const { data: userData } = await supabase.from('users').select('admin').eq('id', user.id).single();
    if (!userData?.admin) {
      alert("You are not authorized to access this page.");
      window.location.href = "login.html";
      return;
    }
    applyCachedAdminStats();
    currentAdminUser = user;
    await loadAllComps();
    await loadDashboardStats(selectedAdminCompId);
    await loadRacesList();
    await loadAdminNotifications();
    AOS.init();
  }, 0);
});

function applyCachedAdminStats() {
  try {
    const raw = localStorage.getItem(ADMIN_STATS_CACHE_KEY);
    if (!raw) return;
    const cached = JSON.parse(raw);
    if (!cached) return;

    if (cached.totalRaces !== undefined) {
      document.getElementById('total-races').textContent = cached.totalRaces;
    }
    if (cached.upcoming !== undefined) {
      document.getElementById('upcoming-races').textContent = cached.upcoming;
    }
    if (cached.fullyTipped !== undefined) {
      document.getElementById('fully-tipped').textContent = cached.fullyTipped;
    }
    if (cached.paidUsers !== undefined) {
      document.getElementById('paid-users').textContent = cached.paidUsers;
    }
    if (cached.pendingPayments !== undefined) {
      document.getElementById('pending-payments').textContent = cached.pendingPayments;
    }
  } catch (error) {
    localStorage.removeItem(ADMIN_STATS_CACHE_KEY);
  }
}

function saveAdminStatsToCache({ totalRaces, upcoming, fullyTipped, paidUsers, pendingPayments }) {
  localStorage.setItem(
    ADMIN_STATS_CACHE_KEY,
    JSON.stringify({ totalRaces, upcoming, fullyTipped, paidUsers, pendingPayments, updatedAt: Date.now() })
  );
}

// ============ DASHBOARD STATS ============
async function loadDashboardStats(compId = null) {
  try {
    let racesQuery = supabase.from('races').select('*');
    if (compId) racesQuery = racesQuery.eq('comp_id', compId);
    const { data: races } = await racesQuery;

    const now = DateTime.now().setZone('Australia/Sydney');
    const upcoming = (races || []).filter(r => {
      const raceTime = DateTime.fromFormat(`${r.date} ${r.time}`, 'yyyy-MM-dd HH:mm').setZone('Australia/Sydney');
      return raceTime > now;
    }).length;

    let fullyTipped = 0;
    for (const race of (races || [])) {
      if (race.horses && Object.keys(race.horses).length > 0) fullyTipped += 1;
    }

    let paidUsers = 0;
    let feesCollected = 0;
    let pendingPayments = 0;

    if (compId) {
      const { data: joinings } = await supabase.from('user_comp_joinings')
        .select('user_id,payment_status').eq('comp_id', compId);
      paidUsers = (joinings || []).filter(j => j.payment_status === 'completed').length;
      pendingPayments = (joinings || []).filter(j => j.payment_status !== 'completed').length;

      const { data: comp } = await supabase.from('comps').select('entry_fee').eq('id', compId).single();
      if (comp) feesCollected = paidUsers * (comp.entry_fee || 0);
    } else {
      const { data: joinings } = await supabase.from('user_comp_joinings').select('user_id,payment_status');
      paidUsers = new Set((joinings || []).filter(j => j.payment_status === 'completed').map(j => j.user_id)).size;
      pendingPayments = (joinings || []).filter(j => j.payment_status !== 'completed').length;
    }

    document.getElementById('total-races').textContent = (races || []).length;
    document.getElementById('upcoming-races').textContent = upcoming;
    document.getElementById('fully-tipped').textContent = fullyTipped;
    document.getElementById('paid-users').textContent = paidUsers;
    document.getElementById('fees-collected').textContent = feesCollected > 0 ? `$${feesCollected.toFixed(2)}` : '$0.00';
    document.getElementById('pending-payments').textContent = pendingPayments;

    saveAdminStatsToCache({ totalRaces: (races || []).length, upcoming, fullyTipped, paidUsers, pendingPayments });
  } catch (error) {
    console.error('Error loading dashboard stats:', error);
  }
  loadPushSubscriberCount();
}

async function loadPushSubscriberCount() {
  const el = document.getElementById('push-subscribers');
  if (!el) return;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) return;

    const response = await fetch(`${SUPABASE_URL}/functions/v1/send-onesignal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ action: 'app-stats' }),
    });
    const stats = await response.json();
    if (!response.ok) throw new Error(stats?.error || 'Failed to load subscriber count');
    el.textContent = stats.subscribers ?? 0;
  } catch (error) {
    console.error('Error loading push subscriber count:', error);
    el.textContent = '—';
  }
}

// ============ RACES LIST ============
async function loadRacesList() {
  try {
    const { data: racesData } = await supabase.from('races').select('*');
    allRaces = (racesData || []).map(r => ({ ...r, compId: r.comp_id })).sort((a, b) => {
      const aTime = new Date(`${a.date}T${a.time}`);
      const bTime = new Date(`${b.date}T${b.time}`);
      return aTime - bTime;
    });

    // Group races by date
    const racesByDate = {};
    allRaces.forEach(race => {
      if (!racesByDate[race.date]) {
        racesByDate[race.date] = [];
      }
      racesByDate[race.date].push(race);
    });

    // Sort dates
    const sortedDates = Object.keys(racesByDate).sort();

    racesByDateCache = racesByDate;
    sortedDatesCache = sortedDates;

    // Render desktop list only - mobile is rendered on demand
    renderRaceListByDate(racesByDate, sortedDates, 'race-list');

    if (currentRaceId) {
      updateRaceSelection();
    }
  } catch (error) {
    console.error('Error loading races:', error);
    showNotification('Error loading races', 'error', 'race-notifications');
  }
}

// Build one collapsible date group (header + race items). Reused for current-year
// dates (rendered directly) and past-year dates (nested inside a year group).
function createDateGroup(date, races, listId) {
  const dateGroup = document.createElement('div');
  dateGroup.className = 'date-group';

  const dt = DateTime.fromFormat(date, 'yyyy-MM-dd').setZone('Australia/Sydney');
  const formattedDate = dt.toFormat('EEE, LLL d');

  const dateHeader = document.createElement('div');
  dateHeader.className = 'date-header';
  dateHeader.innerHTML = `
    <span>${formattedDate}</span>
    <i data-feather="chevron-down" class="h-4 w-4 transition-transform"></i>
  `;

  const racesForDate = document.createElement('div');
  racesForDate.className = 'races-for-date';

  const sortedRaces = races.sort((a, b) => {
    const aTime = a.time || '00:00';
    const bTime = b.time || '00:00';
    return aTime.localeCompare(bTime);
  });

  sortedRaces.forEach(race => {
    const raceItem = document.createElement('div');
    raceItem.className = 'race-item';
    const raceTime = race.time ? race.time.substring(0, 5) : '';
    raceItem.innerHTML = `
      <div class="font-semibold">${race.name || 'Unnamed Race'}</div>
      <div class="text-xs text-gray-400 mt-1">${raceTime}</div>
    `;
    raceItem.onclick = () => {
      selectRace(race.id);
      if (listId === 'race-list-mobile') {
        toggleMobileSidebar();
      }
    };
    racesForDate.appendChild(raceItem);
  });

  dateHeader.onclick = () => {
    const isExpanded = racesForDate.classList.contains('show');
    racesForDate.classList.toggle('show');
    dateHeader.classList.toggle('expanded');
    const icon = dateHeader.querySelector('i');
    if (icon) icon.style.transform = isExpanded ? 'rotate(0deg)' : 'rotate(180deg)';
    feather.replace();
  };

  dateGroup.appendChild(dateHeader);
  dateGroup.appendChild(racesForDate);

  // Auto-expand if a race in this date is selected
  if (races.some(r => r.id === currentRaceId)) {
    racesForDate.classList.add('show');
    dateHeader.classList.add('expanded');
    const icon = dateHeader.querySelector('i');
    if (icon) icon.style.transform = 'rotate(180deg)';
  }

  return dateGroup;
}

function renderRaceListByDate(racesByDate, sortedDates, listId) {
  const raceList = document.getElementById(listId);
  if (!raceList) return;

  raceList.innerHTML = '';

  const currentYear = new Date().getFullYear();

  // Partition dates: current calendar year shown directly, others grouped by year
  const currentYearDates = [];
  const otherYearDates = {}; // year -> [dates]
  sortedDates.forEach(date => {
    const year = parseInt(date.slice(0, 4), 10);
    if (year === currentYear) {
      currentYearDates.push(date);
    } else {
      (otherYearDates[year] = otherYearDates[year] || []).push(date);
    }
  });

  // Current-year date groups render at the top level, as before
  currentYearDates.forEach(date => {
    raceList.appendChild(createDateGroup(date, racesByDate[date], listId));
  });

  // Each other year is wrapped in its own collapsible group (most recent first)
  Object.keys(otherYearDates)
    .map(Number)
    .sort((a, b) => b - a)
    .forEach(year => {
      const yearGroup = document.createElement('div');
      yearGroup.className = 'year-group';

      const yearHeader = document.createElement('div');
      yearHeader.className = 'year-header';
      yearHeader.innerHTML = `
        <span>${year}</span>
        <i data-feather="chevron-down" class="h-4 w-4 transition-transform"></i>
      `;

      const yearContent = document.createElement('div');
      yearContent.className = 'year-content';

      let hasSelected = false;
      otherYearDates[year].forEach(date => {
        if (racesByDate[date].some(r => r.id === currentRaceId)) hasSelected = true;
        yearContent.appendChild(createDateGroup(date, racesByDate[date], listId));
      });

      yearHeader.onclick = () => {
        const isExpanded = yearContent.classList.contains('show');
        yearContent.classList.toggle('show');
        yearHeader.classList.toggle('expanded');
        const icon = yearHeader.querySelector('i');
        if (icon) icon.style.transform = isExpanded ? 'rotate(0deg)' : 'rotate(180deg)';
        feather.replace();
      };

      yearGroup.appendChild(yearHeader);
      yearGroup.appendChild(yearContent);
      raceList.appendChild(yearGroup);

      // Expand the year group if it holds the currently selected race
      if (hasSelected) {
        yearContent.classList.add('show');
        yearHeader.classList.add('expanded');
        const icon = yearHeader.querySelector('i');
        if (icon) icon.style.transform = 'rotate(180deg)';
      }
    });

  feather.replace();
}

function updateRaceSelection() {
  const raceItems = document.querySelectorAll('.race-item');
  raceItems.forEach(item => item.classList.remove('selected'));

  const selectedItems = Array.from(raceItems).filter(item => {
    const raceName = item.querySelector('.font-semibold')?.textContent;
    return allRaces.find(r => r.name === raceName)?.id === currentRaceId;
  });
  
  selectedItems.forEach(item => {
    item.classList.add('selected');
    // Make sure the date group is expanded
    const racesForDate = item.closest('.races-for-date');
    if (racesForDate) {
      racesForDate.classList.add('show');
      const dateHeader = racesForDate.previousElementSibling;
      if (dateHeader && dateHeader.classList.contains('date-header')) {
        dateHeader.classList.add('expanded');
        const icon = dateHeader.querySelector('i');
        if (icon) {
          icon.style.transform = 'rotate(180deg)';
        }
      }
    }
    // If the race lives in a past-year group, expand that too
    const yearContent = item.closest('.year-content');
    if (yearContent) {
      yearContent.classList.add('show');
      const yearHeader = yearContent.previousElementSibling;
      if (yearHeader && yearHeader.classList.contains('year-header')) {
        yearHeader.classList.add('expanded');
        const icon = yearHeader.querySelector('i');
        if (icon) icon.style.transform = 'rotate(180deg)';
      }
    }
  });

  feather.replace();
}

async function selectRace(raceId) {
  currentRaceId = raceId;
  updateRaceSelection();

  const race = allRaces.find(r => r.id === raceId);
  if (!race) return;

  // Show details panel
  document.getElementById('no-selection').classList.add('hidden');
  document.getElementById('new-race-panel').classList.add('hidden');
  document.getElementById('comps-panel')?.classList.add('hidden');
  document.getElementById('notifications-panel')?.classList.add('hidden');
  document.getElementById('race-details-panel').classList.remove('hidden');

  // Populate fields
  document.getElementById('selected-race-title').textContent = race.name || 'Race';
  document.getElementById('edit-race-date').value = race.date || '';
  document.getElementById('edit-race-time').value = race.time || '';
  document.getElementById('edit-race-distance').value = race.distance || '';
  document.getElementById('edit-race-preview').value = race.preview || '';

  await populateMoveRaceCompSelect(race.compId || null);

  // Load horses
  await loadRaceHorses(race);

  // Load tips count
  await loadRaceTips(race);

  // Reset tab
  switchTab('details');
}

async function populateMoveRaceCompSelect(currentCompId = null) {
  const currentCompLabel = document.getElementById('current-race-comp');
  const moveSelect = document.getElementById('move-race-comp-select');
  if (!moveSelect) return;

  if (!allComps.length) {
    await loadAllComps();
  }

  moveSelect.innerHTML = '<option value="">Select target competition...</option>';
  allComps.forEach(comp => {
    const option = document.createElement('option');
    option.value = comp.id;
    option.textContent = `${comp.name}${comp.status === 'active' ? ' (Active)' : ''}`;
    moveSelect.appendChild(option);
  });

  if (currentCompLabel) {
    const currentComp = allComps.find(c => c.id === currentCompId);
    currentCompLabel.textContent = `Current competition: ${currentComp ? currentComp.name : (currentCompId || 'Unassigned')}`;
  }
}

async function moveRaceToComp() {
  if (!currentRaceId) {
    showNotification('Select a race first', 'error', 'race-notifications');
    return;
  }

  const race = allRaces.find(r => r.id === currentRaceId);
  if (!race) {
    showNotification('Race not found', 'error', 'race-notifications');
    return;
  }

  const targetSelect = document.getElementById('move-race-comp-select');
  const targetCompId = targetSelect?.value || null;

  if (!targetCompId) {
    showNotification('Select a target competition', 'error', 'race-notifications');
    return;
  }

  const currentCompId = race.compId || null;
  if (currentCompId === targetCompId) {
    showNotification('Race is already in that competition', 'error', 'race-notifications');
    return;
  }

  const targetComp = allComps.find(c => c.id === targetCompId);
  const confirmed = window.confirm(
    `Move "${race.name}" to ${targetComp?.name || targetCompId}? This will also move all tips for this race to the new competition.`
  );
  if (!confirmed) return;

  try {
    await supabase.from('races').update({ comp_id: targetCompId }).eq('id', currentRaceId);
    await supabase.from('tips').update({ comp_id: targetCompId }).eq('race_id', currentRaceId);

    allRaces = allRaces.map(r => r.id === currentRaceId ? { ...r, compId: targetCompId, comp_id: targetCompId } : r);

    await loadRacesList();
    await selectRace(currentRaceId);
    await loadDashboardStats(selectedAdminCompId);

    showNotification('Race moved successfully', 'success', 'race-notifications');
  } catch (error) {
    console.error('Error moving race to another comp:', error);
    showNotification('Error moving race: ' + error.message, 'error', 'race-notifications');
  }
}

// ============ RACE FORM ============
function showNewRaceForm() {
  currentRaceId = null;
  document.getElementById('no-selection').classList.add('hidden');
  document.getElementById('race-details-panel').classList.add('hidden');
  document.getElementById('new-race-panel').classList.remove('hidden');

  // Reset form
  document.getElementById('race-form').reset();
  document.getElementById('horses-list').innerHTML = '';
  document.getElementById('paste-table').value = '';
  const silksUrlInput = document.getElementById('race-silks-url');
  if (silksUrlInput) {
    silksUrlInput.value = '';
  }
  addManualHorse(); // Add one empty horse row
}

function cancelForm() {
  document.getElementById('no-selection').classList.remove('hidden');
  document.getElementById('race-details-panel').classList.add('hidden');
  document.getElementById('new-race-panel').classList.add('hidden');
}

// Single source of truth for a horse row's inner markup. Fields are wrapped in
// labelled .hr-field cells so the layout can be a compact aligned grid on desktop
// (labels hidden, shared header used) and a labelled card on mobile.
function buildHorseRowInner(h = {}) {
  const esc = (v) => escHtml(v == null ? '' : String(v));
  const field = (cls, label, inputHtml) =>
    `<div class="hr-field ${cls}"><label>${label}</label>${inputHtml}</div>`;
  return `
    ${field('hr-no',      'No',      `<input type="text"   class="horse-no"      placeholder="No"      value="${esc(h.number)}">`)}
    ${field('hr-name',    'Horse',   `<input type="text"   class="horse-name"    placeholder="Name"    value="${esc(h.name)}">`)}
    ${field('hr-trainer', 'Trainer', `<input type="text"   class="horse-trainer" placeholder="Trainer" value="${esc(h.trainer)}">`)}
    ${field('hr-jockey',  'Jockey',  `<input type="text"   class="horse-jockey"  placeholder="Jockey"  value="${esc(h.jockey)}">`)}
    ${field('hr-barrier', 'Barrier', `<input type="number" class="horse-barrier" placeholder="Bar"     value="${esc(h.barrier)}">`)}
    ${field('hr-weight',  'Weight',  `<input type="text"   class="horse-weight"  placeholder="Weight"  value="${esc(h.weight)}">`)}
    ${field('hr-silk',    'Silk ID', `<input type="text"   class="horse-silk-id" placeholder="Silk"    value="${esc(h.silksId || h.silkId || h.silk)}" readonly>`)}
    <button type="button" onclick="this.closest('.horse-row').remove()" class="hr-remove" aria-label="Remove horse"><i data-feather="trash-2"></i><span class="hr-remove-label">Remove</span></button>
  `;
}

function addManualHorse() {
  const horsesList = document.getElementById('horses-list');
  const horseRow = document.createElement('div');
  horseRow.className = 'horse-row';
  horseRow.innerHTML = buildHorseRowInner();
  horsesList.appendChild(horseRow);
  if (window.feather) feather.replace();
}

async function scrapeHorsesFromUrl() {
  const url = document.getElementById('race-fields-url').value;
  if (!url) {
    showNotification('Please enter a URL', 'error', 'form-notifications');
    return;
  }

  const btn = document.getElementById('scrape-btn');
  btn.disabled = true;
  btn.innerHTML = '<i data-feather="loader" class="h-4 w-4 animate-spin"></i> Scraping...';

  try {
    // Use a CORS-safe proxy to fetch the page content
    const normalizedUrl = url.replace(/^https?:\/\//, '');
    const proxyUrl = `https://r.jina.ai/http://${normalizedUrl}`;
    const response = await fetch(proxyUrl);

    if (!response.ok) {
      throw new Error('Failed to fetch URL');
    }

    const html = await response.text();

    // Extract horses from the page - look for fields table first
    const horses = extractHorsesFromText(html);

    if (horses.length === 0) {
      showNotification('Could not find horse data on this page. Try manual paste instead.', 'error', 'form-notifications');
      return;
    }

    // Populate the horses list
    const horsesList = document.getElementById('horses-list');
    horsesList.innerHTML = '';

    horses.forEach((horse, idx) => {
      const safeBarrier = (horse.barrier || '').toString().match(/\d+/)?.[0] || '';
      const horseRow = document.createElement('div');
      horseRow.className = 'horse-row';
      horseRow.innerHTML = buildHorseRowInner({
        number: horse.number || idx + 1,
        name: horse.name, trainer: horse.trainer, jockey: horse.jockey,
        barrier: safeBarrier, weight: horse.weight,
      });
      horsesList.appendChild(horseRow);
    });
    if (window.feather) feather.replace();

    // Clear the URL field
    document.getElementById('race-fields-url').value = '';
    showNotification(`Scraped ${horses.length} horses from URL!`, 'success', 'form-notifications');
  } catch (error) {
    console.error('Scraping error:', error);
    showNotification('Error scraping URL: ' + error.message, 'error', 'form-notifications');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i data-feather="download" class="h-4 w-4"></i> Scrape';
    feather.replace();
  }
}

function normalizeHorseName(value) {
  return (value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

function normalizeHorseNumber(value) {
  const match = (value || '').toString().trim().match(/^(\d+)([a-z])?/i);
  if (!match) {
    return '';
  }
  return `${match[1]}${match[2] ? match[2].toLowerCase() : ''}`;
}

function buildHorseRowIndex() {
  const rows = Array.from(document.querySelectorAll('#horses-list .horse-row'));
  const byNumber = new Map();
  const byName = new Map();

  rows.forEach(row => {
    const numberValue = normalizeHorseNumber(row.querySelector('.horse-no')?.value || '');
    const nameValue = normalizeHorseName(row.querySelector('.horse-name')?.value || '');
    if (numberValue) {
      byNumber.set(numberValue, row);
    }
    if (nameValue) {
      byName.set(nameValue, row);
    }
  });

  return { byNumber, byName };
}

function resolveHorseRowForEntry(entry, indexes, runnerNumberCounts) {
  const normalizedName = normalizeHorseName(entry.name || '');
  const normalizedNumber = normalizeHorseNumber(entry.number || '');

  if (normalizedName && indexes.byName.has(normalizedName)) {
    return indexes.byName.get(normalizedName);
  }

  // Only trust number fallback when the scraped runner list has a unique occurrence of that number.
  if (normalizedNumber && indexes.byNumber.has(normalizedNumber) && (runnerNumberCounts.get(normalizedNumber) || 0) === 1) {
    return indexes.byNumber.get(normalizedNumber);
  }

  return null;
}

function extractHorseNumberFromRow(row) {
  if (!row) {
    return '';
  }
  const firstCell = row.querySelector('td');
  if (!firstCell) {
    return '';
  }
  return normalizeHorseNumber(firstCell.textContent || '');
}

function extractRaceNumberFromText(value) {
  const text = (value || '').toString();
  const raceMatch = text.match(/\brace\s*([0-9]{1,2})\b/i);
  if (raceMatch?.[1]) {
    return parseInt(raceMatch[1], 10);
  }

  const shortMatch = text.match(/\br\s*([0-9]{1,2})\b/i);
  if (shortMatch?.[1]) {
    return parseInt(shortMatch[1], 10);
  }

  return null;
}

function extractRaceNumberFromPath(path) {
  const source = (path || '').toString();
  if (!source) return null;

  const patterns = [
    /(?:Race(?:No|Num|Number)?|R(?:ace)?)=([0-9]{1,2})/i,
    /(?:Race(?:No|Num|Number)?|R(?:ace)?)%3D([0-9]{1,2})/i,
    /[?&]r=([0-9]{1,2})\b/i,
    /[?&]Race([0-9]{1,2})\b/i
  ];

  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (match?.[1]) {
      return parseInt(match[1], 10);
    }
  }

  return null;
}

function inferRaceNumberFromLinkContext(link, row, path) {
  const fromPath = extractRaceNumberFromPath(path);
  if (fromPath) {
    return fromPath;
  }

  const contextCandidates = [];
  if (row) {
    contextCandidates.push(row.textContent || '');
  }

  const table = row?.closest('table') || link?.closest('table');
  if (table) {
    const caption = table.querySelector('caption');
    if (caption?.textContent) {
      contextCandidates.push(caption.textContent);
    }

    let prev = table.previousElementSibling;
    let checks = 0;
    while (prev && checks < 8) {
      contextCandidates.push(prev.textContent || '');
      prev = prev.previousElementSibling;
      checks += 1;
    }
  }

  const section = link?.closest('section, article, div');
  if (section?.textContent) {
    contextCandidates.push(section.textContent.slice(0, 200));
  }

  for (const candidate of contextCandidates) {
    const raceNumber = extractRaceNumberFromText(candidate);
    if (raceNumber) {
      return raceNumber;
    }
  }

  return null;
}

function getTargetRaceNumberForSilks() {
  const raceNameInput = document.getElementById('race-name')?.value || '';
  const selectedRaceTitle = document.getElementById('selected-race-title')?.textContent || '';
  return extractRaceNumberFromText(raceNameInput) || extractRaceNumberFromText(selectedRaceTitle);
}

function buildProxyUrls(targetUrl, preferRaw = false) {
  const jinaUrl       = `https://r.jina.ai/${targetUrl}`;
  // allorigins needs the full target URL encoded so its own ?url= param isn't split
  // by any ? or & in the target. encodeURIComponent handles already-encoded sequences
  // safely: %2C in the target becomes %252C in the outer URL, which allorigins decodes
  // back to %2C before forwarding — RA then decodes that to the actual comma.
  const allOriginsUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`;

  if (preferRaw) {
    return [allOriginsUrl, jinaUrl];
  }
  return [jinaUrl, allOriginsUrl];
}

// Fetch with an AbortController timeout so hung requests don't block forever.
async function fetchWithTimeout(url, timeoutMs = 25000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { signal: controller.signal, cache: 'no-store' });
    clearTimeout(timer);
    return resp;
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') throw new Error(`Timed out after ${timeoutMs / 1000}s`);
    throw err;
  }
}

window.fetchHtmlViaProxy = async function fetchHtmlViaProxy(targetUrl, contextLabel, preferRaw = false, validator = null) {
  const proxyUrls = buildProxyUrls(targetUrl, preferRaw);
  let lastError = null;

  for (const proxyUrl of proxyUrls) {
    try {
      console.log(`[${contextLabel}] Trying proxy:`, proxyUrl);
      const response = await fetchWithTimeout(proxyUrl, 25000);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const html = await response.text();
      console.log(`[${contextLabel}] Got response (${html.length} chars) from:`, proxyUrl);
      if (!html || html.length < 200) {
        throw new Error('Response too small / empty');
      }

      if (typeof validator === 'function' && !validator(html)) {
        throw new Error('Response missing required content');
      }

      return html;
    } catch (error) {
      console.warn(`[${contextLabel}] Proxy failed:`, proxyUrl, error.message || error);
      lastError = error;
    }
  }

  throw new Error(`All proxy fetch attempts failed for ${targetUrl}. Last error: ${lastError?.message || 'Unknown error'}`);
}

function extractNswRunnerEntriesFromHtml(html) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  const runnerLinks = Array.from(doc.querySelectorAll("a[onclick*='HorseFullForm.aspx']"));
  let runnerEntries = runnerLinks.map(link => {
    const row = link.closest('tr');
    const number = extractHorseNumberFromRow(row);
    const name = (link.textContent || '').trim();
    const rowHtml = row?.innerHTML || '';
    const rowSilkMatch = rowHtml.match(/JockeySilks\/(\d+)\.png/i);
    const silksIdFromRow = rowSilkMatch ? rowSilkMatch[1] : null;
    const onclick = link.getAttribute('onclick') || '';
    const match = onclick.match(/newPopup\('([^']*HorseFullForm\.aspx[^']*)'\)/i);
    const path = match ? match[1] : '';
    const raceNumber = inferRaceNumberFromLinkContext(link, row, path);
    return { name, number, path, silksIdFromRow, raceNumber };
  }).filter(entry => entry.path);

  // Fallback for transformed/proxied HTML where onclick anchors are stripped.
  if (runnerEntries.length === 0) {
    const pathMatches = [...html.matchAll(/HorseFullForm\.aspx\?[^\s"'<>`)]+/gi)]
      .map(m => m[0])
      .filter(Boolean);
    const uniquePaths = Array.from(new Set(pathMatches));
    runnerEntries = uniquePaths.map(path => ({
      name: '',
      number: '',
      path,
      silksIdFromRow: null,
      raceNumber: extractRaceNumberFromPath(path)
    }));
  }

  return { doc, runnerEntries, runnerLinkCount: runnerLinks.length };
}

async function fetchNswRunnerEntriesWithProxyFallback(targetUrl, contextLabel) {
  const proxyUrls = buildProxyUrls(targetUrl, true);
  let lastError = null;

  for (const proxyUrl of proxyUrls) {
    try {
      console.log(`[${contextLabel}] Trying NSW proxy:`, proxyUrl);
      const response = await fetch(proxyUrl, { cache: 'no-store' });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const html = await response.text();
      if (!html || html.length < 200) {
        throw new Error('Response too small / empty');
      }

      const hasNswSignals = /HorseFullForm\.aspx|Acceptances\.aspx|JockeySilks\/(\d+)\.png/i.test(html);
      if (!hasNswSignals) {
        throw new Error('Response missing NSW signals');
      }

      const parsed = extractNswRunnerEntriesFromHtml(html);
      if (parsed.runnerEntries.length > 0 || /StageMeeting\.aspx/i.test(targetUrl)) {
        return { html, ...parsed };
      }

      // Some proxy responses can include marker text but no runner data; keep trying.
      throw new Error('No runner entries extracted from proxy response');
    } catch (error) {
      console.warn(`[${contextLabel}] NSW proxy failed:`, proxyUrl, error.message || error);
      lastError = error;
    }
  }

  throw new Error(`All NSW proxy attempts failed for ${targetUrl}. Last error: ${lastError?.message || 'Unknown error'}`);
}

function buildNswXmlUrl(sourceUrl) {
  try {
    const parsed = new URL(sourceUrl);
    const key = parsed.searchParams.get('Key');
    if (!key) return null;
    return `https://racing.racingnsw.com.au/FreeFields/XML.aspx?Key=${encodeURIComponent(key)}&stage=Acceptances`;
  } catch (error) {
    return null;
  }
}

async function fetchNswRunnerEntriesFromXml(sourceUrl, contextLabel) {
  const xmlUrl = buildNswXmlUrl(sourceUrl);
  if (!xmlUrl) {
    return [];
  }

  const xmlText = await fetchHtmlViaProxy(xmlUrl, `${contextLabel}:xml`, true);
  const xmlDoc = new DOMParser().parseFromString(xmlText, 'text/xml');
  const raceNodes = Array.from(xmlDoc.getElementsByTagName('race'));
  const runnerEntries = [];

  raceNodes.forEach(raceNode => {
    const raceNumber = parseInt(raceNode.getAttribute('number') || '', 10);
    const nominationNodes = Array.from(raceNode.getElementsByTagName('nomination'));

    nominationNodes.forEach(nominationNode => {
      const horse = (nominationNode.getAttribute('horse') || '').trim();
      const number = (nominationNode.getAttribute('number') || '').trim();
      const jockeyNumber = (nominationNode.getAttribute('jockeynumber') || '').trim();

      if (!horse || !number || !jockeyNumber || jockeyNumber === '0') {
        return;
      }

      runnerEntries.push({
        name: horse,
        number,
        path: '',
        silksIdFromRow: jockeyNumber,
        raceNumber: Number.isFinite(raceNumber) ? raceNumber : null
      });
    });
  });

  return runnerEntries;
}

function buildNswXmlSilksLookup(xmlEntries) {
  const byNameAndNumber = new Map();
  const byName = new Map();
  const byNumber = new Map();

  const setUnique = (map, key, value) => {
    if (!key || !value) return;
    if (!map.has(key)) {
      map.set(key, value);
      return;
    }
    if (map.get(key) !== value) {
      map.set(key, '');
    }
  };

  for (const entry of xmlEntries) {
    const silksId = (entry.silksIdFromRow || '').trim();
    if (!silksId) continue;

    const normalizedName = normalizeHorseName(entry.name || '');
    const normalizedNumber = normalizeHorseNumber(entry.number || '');

    setUnique(byNameAndNumber, `${normalizedName}|${normalizedNumber}`, silksId);
    setUnique(byName, normalizedName, silksId);
    setUnique(byNumber, normalizedNumber, silksId);
  }

  return { byNameAndNumber, byName, byNumber };
}

function resolveSilksIdFromNswXml(entry, lookup) {
  const normalizedName = normalizeHorseName(entry.name || '');
  const normalizedNumber = normalizeHorseNumber(entry.number || '');

  const exactKey = `${normalizedName}|${normalizedNumber}`;
  const exact = lookup.byNameAndNumber.get(exactKey);
  if (exact) return exact;

  const byName = lookup.byName.get(normalizedName);
  if (byName) return byName;

  const byNumber = lookup.byNumber.get(normalizedNumber);
  if (byNumber) return byNumber;

  return null;
}

async function scrapeSilksFromUrl() {
  console.log('[scrapeSilksFromUrl] Starting...');
  const url = document.getElementById('race-silks-url').value;
  console.log('[scrapeSilksFromUrl] URL input:', url);
  
  if (!url) {
    console.warn('[scrapeSilksFromUrl] No URL provided');
    showNotification('Please enter a RacingNSW URL', 'error', 'form-notifications');
    return;
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch (error) {
    showNotification('Invalid URL. Please paste a full RacingNSW Acceptances/Form URL.', 'error', 'form-notifications');
    return;
  }

  const host = (parsedUrl.hostname || '').toLowerCase();
  const isRacingNswHost = host.includes('racing.racingnsw.com.au');
  if (!isRacingNswHost) {
    showNotification(
      'Unsupported URL for NSW silks. Use a racing.racingnsw.com.au Acceptances/Form URL, or use the Racing Australia silks tool for non-NSW.',
      'error',
      'form-notifications'
    );
    return;
  }

  const horseRows = document.querySelectorAll('#horses-list .horse-row');
  console.log('[scrapeSilksFromUrl] Found', horseRows.length, 'horse rows');
  
  if (horseRows.length === 0) {
    console.warn('[scrapeSilksFromUrl] No horse rows found');
    showNotification('Add horses first, then import silks.', 'error', 'form-notifications');
    return;
  }

  const btn = document.getElementById('scrape-silks-btn');
  btn.disabled = true;
  btn.innerHTML = '<i data-feather="loader" class="h-4 w-4 animate-spin"></i> Scraping...';

  try {
    const targetRaceNumber = getTargetRaceNumberForSilks();
    console.log('[scrapeSilksFromUrl] Target race number from form/title:', targetRaceNumber);

    const { html, runnerEntries: initialEntries, runnerLinkCount } = await fetchNswRunnerEntriesWithProxyFallback(
      url,
      'scrapeSilksFromUrl:list'
    );
    console.log('[scrapeSilksFromUrl] HTML length:', html.length);
    console.log('[scrapeSilksFromUrl] HTML parsed');

    let runnerEntries = initialEntries;
    console.log('[scrapeSilksFromUrl] Found', runnerLinkCount, 'runner links');
    if (runnerLinkCount > 0) {
      runnerEntries.forEach(entry => {
        console.log('[scrapeSilksFromUrl] Runner - Name:', entry.name, 'Number:', entry.number, 'Path found:', !!entry.path);
      });
    } else {
      console.log('[scrapeSilksFromUrl] Fallback runner path extraction found', runnerEntries.length, 'paths');
    }

    if (runnerEntries.length === 0 && /StageMeeting\.aspx/i.test(url)) {
      const acceptancesUrl = url.replace(/StageMeeting\.aspx/i, 'Acceptances.aspx');
      console.log('[scrapeSilksFromUrl] No runners on StageMeeting page. Trying Acceptances URL:', acceptancesUrl);

      const { runnerEntries: acceptancesEntries } = await fetchNswRunnerEntriesWithProxyFallback(
        acceptancesUrl,
        'scrapeSilksFromUrl:list:acceptances'
      );

      runnerEntries = acceptancesEntries;
      console.log('[scrapeSilksFromUrl] Acceptances fallback found', runnerEntries.length, 'runner entries');
    }

    if (runnerEntries.length === 0) {
      console.log('[scrapeSilksFromUrl] No HTML runner entries found. Trying XML fallback...');
      runnerEntries = await fetchNswRunnerEntriesFromXml(url, 'scrapeSilksFromUrl:list');
      console.log('[scrapeSilksFromUrl] XML fallback found', runnerEntries.length, 'runner entries');
    }

    if (targetRaceNumber) {
      const raceMatchedEntries = runnerEntries.filter(entry => entry.raceNumber === targetRaceNumber);
      if (raceMatchedEntries.length > 0) {
        console.log('[scrapeSilksFromUrl] Filtered to target race', targetRaceNumber, 'entries:', raceMatchedEntries.length);
        runnerEntries = raceMatchedEntries;
      } else {
        console.warn('[scrapeSilksFromUrl] No entries carried race number', targetRaceNumber, '- continuing with all matched entries');
      }
    }

    // Enrich with XML-derived IDs before any runner page fetches.
    const xmlEntriesForSilks = await fetchNswRunnerEntriesFromXml(url, 'scrapeSilksFromUrl:list:xml-enrich');
    if (xmlEntriesForSilks.length > 0) {
      const scopedXmlEntries = targetRaceNumber
        ? xmlEntriesForSilks.filter(entry => entry.raceNumber === targetRaceNumber)
        : xmlEntriesForSilks;
      const xmlLookup = buildNswXmlSilksLookup(scopedXmlEntries);

      let xmlEnrichedCount = 0;
      runnerEntries = runnerEntries.map(entry => {
        if (entry.silksIdFromRow) {
          return entry;
        }

        const xmlSilksId = resolveSilksIdFromNswXml(entry, xmlLookup);
        if (!xmlSilksId) {
          return entry;
        }

        xmlEnrichedCount += 1;
        return { ...entry, silksIdFromRow: xmlSilksId };
      });

      console.log('[scrapeSilksFromUrl] XML silk enrichment applied to', xmlEnrichedCount, 'runners');
    }

    console.log('[scrapeSilksFromUrl] Filtered to', runnerEntries.length, 'runners with paths');

    if (runnerEntries.length === 0) {
      console.warn('[scrapeSilksFromUrl] No valid runner entries found');
      showNotification('No runner links found on this page.', 'error', 'form-notifications');
      return;
    }

    const horseIndexes = buildHorseRowIndex();
    const runnerNumberCounts = new Map();
    for (const entry of runnerEntries) {
      const key = normalizeHorseNumber(entry.number || '');
      if (!key) continue;
      runnerNumberCounts.set(key, (runnerNumberCounts.get(key) || 0) + 1);
    }
    console.log('[scrapeSilksFromUrl] Built horse index - by number:', horseIndexes.byNumber.size, 'by name:', horseIndexes.byName.size);

    let updated = 0;
    let missing = 0;
    const assignedRows = new Set();

    for (const entry of runnerEntries) {
      console.log('[scrapeSilksFromUrl] Processing runner:', entry.name);
      let silksId = entry.silksIdFromRow;
      let runnerHtml = '';

      // Fast path: acceptances row already has silk image id.
      if (!silksId && entry.path) {
        const fullUrl = new URL(entry.path, 'https://racing.racingnsw.com.au').href;
        console.log('[scrapeSilksFromUrl] Full URL:', fullUrl);

        runnerHtml = await fetchHtmlViaProxy(fullUrl, `scrapeSilksFromUrl:runner:${entry.name}`, true);
        console.log('[scrapeSilksFromUrl] Runner HTML length:', runnerHtml.length);

        const silkMatch = runnerHtml.match(/JockeySilks\/(\d+)\.png/i);
        silksId = silkMatch ? silkMatch[1] : null;
        console.log('[scrapeSilksFromUrl] Silk ID found:', silksId || 'null');
      } else if (!silksId && !entry.path) {
        console.warn('[scrapeSilksFromUrl] No runner path available for:', entry.name);
      }

      if (!silksId) {
        console.warn('[scrapeSilksFromUrl] No silk ID found for:', entry.name);
        missing += 1;
        continue;
      }

      // If list-page parsing did not yield a horse name, extract one from the runner page.
      let entryName = (entry.name || '').trim();
      if (!entryName && runnerHtml) {
        const titleMatch = runnerHtml.match(/<title[^>]*>([^<]+)<\/title>/i);
        if (titleMatch?.[1]) {
          entryName = titleMatch[1]
            .replace(/\s*[-|].*$/g, '')
            .replace(/\s+Racing\s+NSW.*$/i, '')
            .trim();
        }
      }

      const row = resolveHorseRowForEntry({
        name: entryName || entry.name,
        number: entry.number
      }, horseIndexes, runnerNumberCounts);
      console.log('[scrapeSilksFromUrl] Horse row found:', !!row);

      if (!row) {
        console.warn('[scrapeSilksFromUrl] No matching horse row for:', entry.name);
        missing += 1;
        continue;
      }

      if (assignedRows.has(row)) {
        console.log('[scrapeSilksFromUrl] Row already assigned, skipping duplicate runner:', entryName || entry.name || '(unknown)');
        continue;
      }

      const silkIdInput = row.querySelector('.horse-silk-id');
      console.log('[scrapeSilksFromUrl] Silk ID input element found:', !!silkIdInput);
      
      if (silkIdInput) {
        silkIdInput.value = silksId;
        assignedRows.add(row);
        console.log('[scrapeSilksFromUrl] Set silksId:', silksId, 'for horse:', entryName || entry.name || '(unknown)');
        showNotification(`Silk found: ${entryName || entry.name || 'Horse'} (ID: ${silksId})`, 'success', 'form-notifications');
        updated += 1;
      } else {
        console.warn('[scrapeSilksFromUrl] No silk ID input element for:', entryName || entry.name || '(unknown)');
        missing += 1;
      }
    }

    console.log('[scrapeSilksFromUrl] Complete - Updated:', updated, 'Missing:', missing);
    document.getElementById('race-silks-url').value = '';
    showNotification(`Silks updated: ${updated}. Missing: ${missing}.`, 'success', 'form-notifications');
  } catch (error) {
    console.error('[scrapeSilksFromUrl] Fatal error:', error);
    showNotification('Error scraping silks: ' + error.message, 'error', 'form-notifications');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i data-feather="download" class="h-4 w-4"></i> Scrape Silks';
    feather.replace();
  }
}

window.scrapeSilksFromUrlRA = async function() {
  console.log('[scrapeSilksFromUrlRA] Starting...');
  const url = document.getElementById('race-silks-url-ra').value;
  console.log('[scrapeSilksFromUrlRA] URL input:', url);
  
  if (!url) {
    console.warn('[scrapeSilksFromUrlRA] No URL provided');
    showNotification('Please enter a Racing Australia URL', 'error', 'form-notifications');
    return;
  }

  const horseRows = document.querySelectorAll('#horses-list .horse-row');
  console.log('[scrapeSilksFromUrlRA] Found', horseRows.length, 'horse rows');
  
  if (horseRows.length === 0) {
    console.warn('[scrapeSilksFromUrlRA] No horse rows found');
    showNotification('Add horses first, then import silks.', 'error', 'form-notifications');
    return;
  }

  const btn = document.getElementById('scrape-silks-btn-ra');
  btn.disabled = true;
  btn.innerHTML = '<i data-feather="loader" class="h-4 w-4 animate-spin"></i> Scraping...';

  try {
    const html = await fetchHtmlViaProxy(url, 'scrapeSilksFromUrlRA:list', true);
    console.log('[scrapeSilksFromUrlRA] HTML length:', html.length);
    
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    console.log('[scrapeSilksFromUrlRA] HTML parsed');

    // Racing Australia uses different link format - look for horse names in table rows
    const runnerRows = Array.from(doc.querySelectorAll('table tr')).slice(1); // Skip header
    console.log('[scrapeSilksFromUrlRA] Found', runnerRows.length, 'runner rows');
    
    const runnerEntries = runnerRows
      .map(row => {
        const cells = Array.from(row.querySelectorAll('td'));
        if (cells.length < 2) return null;
        
        const number = normalizeHorseNumber((cells[0]?.textContent || '').trim());
        const nameCell = cells[1];
        const nameLink = nameCell?.querySelector('a');
        const name = (nameLink?.textContent || nameCell?.textContent || '').trim();
        const onclick = nameLink?.getAttribute('onclick') || '';
        
        // Extract horse ID from onclick handler
        const match = onclick.match(/HorseFullForm\.aspx\?([^']*)/i);
        const horseId = match ? match[1] : '';
        
        console.log('[scrapeSilksFromUrlRA] Runner - Name:', name, 'Number:', number, 'HorseID:', horseId);
        return { name, number, horseId };
      })
      .filter(entry => entry && entry.horseId);

    console.log('[scrapeSilksFromUrlRA] Filtered to', runnerEntries.length, 'runners with horse IDs');

    if (runnerEntries.length === 0) {
      console.warn('[scrapeSilksFromUrlRA] No valid runner entries found');
      showNotification('No runner links found on this page.', 'error', 'form-notifications');
      return;
    }

    const { byNumber, byName } = buildHorseRowIndex();
    console.log('[scrapeSilksFromUrlRA] Built horse index - by number:', byNumber.size, 'by name:', byName.size);
    
    let updated = 0;
    let missing = 0;

    for (const entry of runnerEntries) {
      console.log('[scrapeSilksFromUrlRA] Processing runner:', entry.name);
      
      const fullUrl = new URL(`FreeFields/HorseFullForm.aspx?${entry.horseId}`, 'https://www.racingaustralia.horse').href;
      console.log('[scrapeSilksFromUrlRA] Full URL:', fullUrl);

      const runnerHtml = await fetchHtmlViaProxy(fullUrl, `scrapeSilksFromUrlRA:runner:${entry.name}`);
      console.log('[scrapeSilksFromUrlRA] Runner HTML length:', runnerHtml.length);
      
      // Racing Australia uses JockeySilks path similar to RacingNSW
      const silkMatch = runnerHtml.match(/JockeySilks\/(\d+)\.png/i);
      console.log('[scrapeSilksFromUrlRA] Silk ID found:', silkMatch ? silkMatch[1] : 'null');
      
      if (!silkMatch) {
        console.warn('[scrapeSilksFromUrlRA] No silk ID found for:', entry.name);
        missing += 1;
        continue;
      }

      const silksId = silkMatch[1];
      const normalizedName = normalizeHorseName(entry.name);
      console.log('[scrapeSilksFromUrlRA] Looking for horse with normalized name:', normalizedName);
      
      const row = normalizedName && byName.get(normalizedName);
      console.log('[scrapeSilksFromUrlRA] Horse row found:', !!row);

      if (!row) {
        console.warn('[scrapeSilksFromUrlRA] No matching horse row for:', entry.name);
        missing += 1;
        continue;
      }

      const silkIdInput = row.querySelector('.horse-silk-id');
      console.log('[scrapeSilksFromUrlRA] Silk ID input element found:', !!silkIdInput);
      
      if (silkIdInput) {
        silkIdInput.value = silksId;
        console.log('[scrapeSilksFromUrlRA] Set silksId:', silksId, 'for horse:', entry.name);
        showNotification(`Silk found: ${entry.name} (ID: ${silksId})`, 'success', 'form-notifications');
        updated += 1;
      } else {
        console.warn('[scrapeSilksFromUrlRA] No silk ID input element for:', entry.name);
        missing += 1;
      }
    }

    console.log('[scrapeSilksFromUrlRA] Complete - Updated:', updated, 'Missing:', missing);
    document.getElementById('race-silks-url-ra').value = '';
    showNotification(`Silks updated: ${updated}. Missing: ${missing}.`, 'success', 'form-notifications');
  } catch (error) {
    console.error('[scrapeSilksFromUrlRA] Fatal error:', error);
    showNotification('Error scraping silks: ' + error.message, 'error', 'form-notifications');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i data-feather="download" class="h-4 w-4"></i> Scrape Silks';
    feather.replace();
  }
}

function extractHorsesFromText(rawText) {
  let text = rawText || '';
  if (text.includes('<html') || text.includes('<table') || text.includes('<body')) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(text, 'text/html');
    text = doc.body ? doc.body.innerText : text;
  }

  const lines = text.split('\n').map(line => line.trim()).filter(Boolean);
  const horses = [];
  const stripMarkdownLink = (value) => (value || '').replace(/\[([^\]]*)\]\(([^)]*)\)/g, '$1').trim();
  const cleanCell = (value) => stripMarkdownLink(value).replace(/~~|\*\*/g, '').replace(/\s+/g, ' ').trim();
  const normalizeNumber = (value) => {
    const match = value.match(/^(\d+)([a-z])?/i);
    if (!match) {
      return value;
    }
    return `${match[1]}${match[2] ? match[2].toLowerCase() : ''}`;
  };
  const normalizeBarrier = (value) => {
    const match = cleanCell(value).match(/\b(\d{1,2})\b/);
    return match ? match[1] : '';
  };
  const normalizeWeight = (value) => cleanCell(value).replace(/\s+/g, '');

  // Strategy 0: Parse markdown table rows (| No | Horse | Trainer | Jockey | Barrier | Weight |)
  const tableRows = lines.filter(line => line.startsWith('|') && line.includes('|'));
  if (tableRows.length > 0) {
    for (const row of tableRows) {
      if (/^\|\s*-/.test(row)) {
        continue; // header separator
      }

      const rawCells = row.split('|');
      const cells = rawCells.slice(1, -1).map(cell => cell.trim());
      if (cells.length < 5) {
        continue;
      }

      // Some rows can contain multiple records; chunk into 6 columns when possible.
      for (let i = 0; i + 5 < cells.length; i += 6) {
        const numberToken = cleanCell(cells[i] || '');
        if (!/\d/.test(numberToken)) {
          continue;
        }

        const number = normalizeNumber(numberToken);
        const name = cleanCell(cells[i + 1] || '');
        const trainer = cleanCell(cells[i + 2] || '');
        const jockey = cleanCell(cells[i + 3] || '');
        const barrier = normalizeBarrier(cells[i + 4] || '');
        const weight = normalizeWeight(cells[i + 5] || '');

        horses.push({
          number,
          name,
          trainer,
          jockey,
          barrier,
          weight,
          silk: ''
        });
      }
    }
  }

  if (horses.length > 0) {
    return horses;
  }

  // Strategy 1: Parse the fields table block (No Horse Trainer Jockey Barrier Weight)
  const headerIndex = lines.findIndex(line => /\bNo\b.*\bHorse\b.*\bTrainer\b.*\bJockey\b.*\bBarrier\b.*\bWeight\b/i.test(line));
  if (headerIndex !== -1) {
    const stopPattern = /\bOdds\b|\bBet Now\b|\bRandwick\b|\bFebruary\b|\bPM\b|\bAM\b/i;
    const tokens = [];

    for (let i = headerIndex + 1; i < lines.length; i++) {
      const line = lines[i];
      if (stopPattern.test(line)) {
        break;
      }
      if (!line) {
        continue;
      }

      const parts = line.split(/\t+|\s{2,}/).map(c => c.trim()).filter(Boolean);
      if (parts.length > 0) {
        tokens.push(...parts);
      }
    }

    for (let i = 0; i + 5 < tokens.length; i += 6) {
      const numberToken = tokens[i];
      if (!/^\d+\w*$/i.test(numberToken)) {
        continue;
      }

      const number = normalizeNumber(numberToken);
      const name = cleanCell(tokens[i + 1] || '');
      const trainer = cleanCell(tokens[i + 2] || '');
      const jockey = cleanCell(tokens[i + 3] || '');
      const barrier = normalizeBarrier(tokens[i + 4] || '');
      const weight = normalizeWeight(tokens[i + 5] || '');

      horses.push({
        number,
        name,
        trainer,
        jockey,
        barrier,
        weight,
        silk: ''
      });
    }
  }

  if (horses.length > 0) {
    return horses;
  }

  // Strategy 2: Fallback to odds-style parsing ("1. Horse (Barrier)")
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(/^(\d+)[.]?\s+(.+?)(?:\s+\((\d+)\))?$/);
    if (!match) {
      continue;
    }

    const number = match[1];
    const name = cleanCell(match[2] || '');
    const barrier = match[3] || '';
    let jockey = '';
    let trainer = '';
    let weight = '';

    for (let j = i + 1; j < Math.min(i + 8, lines.length); j++) {
      const nextLine = lines[j];
      if (/^\d+\./.test(nextLine)) {
        break;
      }
      if (/\bBet Now\b|\bOdds\b|\bPromos\b|\bRacing\b|\bHome Of\b/i.test(nextLine)) {
        break;
      }

      const weightMatch = nextLine.match(/(\d+\.?\d*)\s*kg/i);
      if (weightMatch) {
        weight = weightMatch[0].replace(/\s+/g, '');
      }

      const jMatch = nextLine.match(/^J[:]?\s*(.+)$/i);
      if (jMatch) {
        jockey = cleanCell(jMatch[1] || '');
      }

      const tMatch = nextLine.match(/^T[:]?\s*(.+)$/i);
      if (tMatch) {
        trainer = cleanCell(tMatch[1] || '');
      }
    }

    horses.push({
      number,
      name,
      trainer,
      jockey,
      barrier,
      weight,
      silk: ''
    });
  }

  return horses;
}

function parseHorseTable() {
  const tableText = document.getElementById('paste-table').value;
  const rows = tableText.split('\n').filter(r => r.trim());

  const horsesList = document.getElementById('horses-list');
  horsesList.innerHTML = '';

  rows.forEach(row => {
    const cols = row.split(/\s{2,}|\t/);
    if (cols.length >= 6) {
      const horseRow = document.createElement('div');
      horseRow.className = 'horse-row';
      horseRow.innerHTML = buildHorseRowInner({
        number: cols[0].trim(), name: cols[1].trim(), trainer: cols[2].trim(),
        jockey: cols[3].trim(), barrier: cols[4].trim().match(/\d+/)?.[0] || '',
        weight: cols[5].trim(),
      });
      horsesList.appendChild(horseRow);
    }
  });
  if (window.feather) feather.replace();

  if (horsesList.children.length === 0) {
    showNotification('No valid rows found. Ensure columns are separated by tabs or multiple spaces.', 'error', 'form-notifications');
  }
}

document.getElementById('race-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();

  const name = document.getElementById('race-name').value;
  const date = document.getElementById('race-date').value;
  const time = document.getElementById('race-time').value;
  const distance = document.getElementById('race-distance').value;
  const preview = document.getElementById('race-preview').value;

  // Collect horses
  const horses = {};
  document.querySelectorAll('#horses-list .horse-row').forEach((row, idx) => {
    const no = row.querySelector('.horse-no').value;
    const horseName = row.querySelector('.horse-name').value;
    const trainer = row.querySelector('.horse-trainer').value;
    const jockey = row.querySelector('.horse-jockey').value;
    const barrier = row.querySelector('.horse-barrier').value;
    const weight = row.querySelector('.horse-weight').value;
    const silksId     = row.querySelector('.horse-silk-id')?.value || '';
    const last10      = row.dataset.last10 || '';
    const prizemoney  = row.dataset.prizemoney || '';
    const formHistory = row.dataset.formHistory
      ? (() => { try { return JSON.parse(row.dataset.formHistory); } catch { return undefined; } })()
      : undefined;

    if (horseName) {
      const horseData = {
        number: no || idx + 1,
        name: horseName,
        trainer,
        jockey,
        barrier,
        weight,
        silksId,
        amt: 0
      };
      if (last10)             horseData.last10       = last10;
      if (prizemoney)         horseData.prizemoney   = prizemoney;
      if (formHistory?.length) horseData.formHistory = formHistory;
      horses[idx] = horseData;
    }
  });

  try {
    const { error } = await supabase.from('races').insert({
      id: crypto.randomUUID(),
      name,
      date,
      time,
      distance,
      preview,
      comp_id: selectedAdminCompId || null,
      horses
    });
    if (error) throw error;

    showNotification(`Race "${name}" created successfully!`, 'success', 'form-notifications');
    await loadRacesList();
    cancelForm();
  } catch (error) {
    console.error('Error saving race:', error);
    showNotification('Error saving race: ' + error.message, 'error', 'form-notifications');
  }
});

// ============ RACE DETAILS EDITING ============
async function updateRaceDate() {
  if (!currentRaceId) return;
  const newDate = document.getElementById('edit-race-date').value;
  try {
    const { error } = await supabase.from('races').update({ date: newDate }).eq('id', currentRaceId);
    if (error) throw error;
    allRaces = allRaces.map(r => r.id === currentRaceId ? { ...r, date: newDate } : r);
    showNotification('Date updated', 'success', 'race-notifications');
    await loadRacesList();
  } catch (error) {
    showNotification('Error updating date', 'error', 'race-notifications');
  }
}

async function updateRaceTime() {
  if (!currentRaceId) return;
  const newTime = document.getElementById('edit-race-time').value;
  try {
    const { error } = await supabase.from('races').update({ time: newTime }).eq('id', currentRaceId);
    if (error) throw error;
    allRaces = allRaces.map(r => r.id === currentRaceId ? { ...r, time: newTime } : r);
    showNotification('Time updated', 'success', 'race-notifications');
    await loadRacesList();
  } catch (error) {
    showNotification('Error updating time', 'error', 'race-notifications');
  }
}

async function updateRaceDistance() {
  if (!currentRaceId) return;
  const distance = document.getElementById('edit-race-distance').value;
  try {
    const { error } = await supabase.from('races').update({ distance }).eq('id', currentRaceId);
    if (error) throw error;
    showNotification('Distance updated', 'success', 'race-notifications');
  } catch (error) {
    showNotification('Error updating distance', 'error', 'race-notifications');
  }
}

async function updateRacePreview() {
  if (!currentRaceId) return;
  const preview = document.getElementById('edit-race-preview').value;
  try {
    const { error } = await supabase.from('races').update({ preview }).eq('id', currentRaceId);
    if (error) throw error;
    showNotification('Preview updated', 'success', 'race-notifications');
  } catch (error) {
    showNotification('Error updating preview', 'error', 'race-notifications');
  }
}

// ============ HORSES MANAGEMENT ============
async function loadRaceHorses(race) {
  const horsesList = document.getElementById('selected-horses-list');
  horsesList.innerHTML = '';

  if (!race.horses || Object.keys(race.horses).length === 0) {
    horsesList.innerHTML = '<tr><td colspan="8" class="text-center text-gray-400 py-4">No horses added</td></tr>';
    return;
  }

  const sortedHorses = Object.entries(race.horses).sort((a, b) => {
    const aNo = Number(a[1].no ?? a[1].number ?? 0);
    const bNo = Number(b[1].no ?? b[1].number ?? 0);
    return aNo - bNo;
  });

  sortedHorses.forEach(([idx, horse]) => {
    const horseNo = horse.no ?? horse.number ?? '';
    const tr = document.createElement('tr');
    const isScratched = !!horse.scratched;
    const isSubstitute = !!horse.substitute;
    tr.innerHTML = `
      <td><input type="text" value="${horseNo}" data-field="no" data-idx="${idx}" style="width: 60px;"></td>
      <td><input type="text" value="${horse.name}" data-field="name" data-idx="${idx}"></td>
      <td><input type="text" value="${horse.trainer || ''}" data-field="trainer" data-idx="${idx}"></td>
      <td><input type="text" value="${horse.jockey || ''}" data-field="jockey" data-idx="${idx}"></td>
      <td><input type="text" value="${horse.barrier || ''}" data-field="barrier" data-idx="${idx}"></td>
      <td><input type="text" value="${horse.weight || ''}" data-field="weight" data-idx="${idx}"></td>
      <td><input type="text" value="${horse.silkDesc || horse.silkId || ''}" data-field="silkDesc" data-idx="${idx}"></td>
      <td>
        <div class="flex flex-wrap gap-2 items-center">
          <button onclick="saveHorseChange(this)" class="btn-secondary" style="font-size: 0.75rem; padding: 6px 10px;">Save</button>
          ${isScratched
            ? '<button onclick="toggleHorseScratch(\'' + idx + '\', false)" class="btn-secondary" style="font-size: 0.75rem; padding: 6px 10px;">Unscratch</button><span class="text-red-400 text-xs font-semibold">SCRATCHED</span>'
            : '<button onclick="toggleHorseScratch(\'' + idx + '\', true)" class="btn-danger" style="font-size: 0.75rem; padding: 6px 10px;">Scratch</button>'
          }
          <button onclick="setSubstituteHorse('${idx}')" class="btn-secondary" style="font-size: 0.75rem; padding: 6px 10px;">
            ${isSubstitute ? 'Substitute (Current)' : 'Set Substitute'}
          </button>
          ${isSubstitute ? '<span class="text-yellow-400 text-xs font-semibold">SUB</span>' : ''}
        </div>
      </td>
    `;
    horsesList.appendChild(tr);
  });
}

async function saveHorseChange(btn) {
  if (!currentRaceId) return;

  const inputs = btn.closest('tr').querySelectorAll('input');
  const idx = inputs[0].dataset.idx;
  const horseNumber = inputs[0].value;
  const name = inputs[1].value;
  const trainer = inputs[2].value;
  const jockey = inputs[3].value;
  const barrier = inputs[4].value;
  const weight = inputs[5].value;
  const silkDesc = inputs[6].value;

  const race = allRaces.find(r => r.id === currentRaceId);
  const existingHorse = race?.horses?.[idx] || {};

  try {
    const race = allRaces.find(r => r.id === currentRaceId);
    const updatedHorses = { ...(race?.horses || {}) };
    updatedHorses[idx] = {
      ...(updatedHorses[idx] || {}),
      no: horseNumber, number: horseNumber, name, trainer, jockey, barrier, weight, silkDesc
    };
    const { error } = await supabase.from('races').update({ horses: updatedHorses }).eq('id', currentRaceId);
    if (error) throw error;
    showNotification('Horse updated', 'success', 'race-notifications');
    await refreshCurrentRaceData();
  } catch (error) {
    showNotification('Error updating horse', 'error', 'race-notifications');
  }
}

async function refreshCurrentRaceData() {
  if (!currentRaceId) return;

  const { data: raceData } = await supabase.from('races').select('*').eq('id', currentRaceId).single();
  if (!raceData) return;

  const updatedRace = { ...raceData, compId: raceData.comp_id };
  allRaces = allRaces.map(r => r.id === currentRaceId ? updatedRace : r);

  await loadRaceHorses(updatedRace);
  if (currentTab === 'results') {
    await loadResultsForm();
  }
}

async function toggleHorseScratch(horseIdx, shouldScratch) {
  if (!currentRaceId) return;

  const race = allRaces.find(r => r.id === currentRaceId);
  if (!race?.horses?.[horseIdx]) return;

  race.horses[horseIdx].scratched = shouldScratch;
  if (shouldScratch && race.horses[horseIdx].substitute) {
    race.horses[horseIdx].substitute = false;
  }

  try {
    const { error } = await supabase.from('races').update({ horses: race.horses }).eq('id', currentRaceId);
    if (error) throw error;
    showNotification(shouldScratch ? 'Horse scratched' : 'Horse unscratched', 'success', 'race-notifications');
    await refreshCurrentRaceData();
  } catch (error) {
    console.error('Error updating scratch status:', error);
    showNotification('Error updating horse status', 'error', 'race-notifications');
  }
}

async function setSubstituteHorse(horseIdx) {
  if (!currentRaceId) return;

  const race = allRaces.find(r => r.id === currentRaceId);
  if (!race?.horses?.[horseIdx]) return;
  if (race.horses[horseIdx].scratched) {
    showNotification('Cannot set a scratched horse as substitute', 'error', 'race-notifications');
    return;
  }

  Object.entries(race.horses).forEach(([id, horse]) => {
    race.horses[id].substitute = id === horseIdx;
  });

  try {
    const { error } = await supabase.from('races').update({ horses: race.horses }).eq('id', currentRaceId);
    if (error) throw error;
    showNotification('Substitute horse updated', 'success', 'race-notifications');
    await refreshCurrentRaceData();
  } catch (error) {
    console.error('Error setting substitute horse:', error);
    showNotification('Error setting substitute horse', 'error', 'race-notifications');
  }
}

async function addHorseToRace() {
  if (!currentRaceId) return;

  const race = allRaces.find(r => r.id === currentRaceId);
  const horses = race.horses || {};
  const numericKeys = Object.keys(horses)
    .map(key => Number(key))
    .filter(value => Number.isFinite(value));
  const newIdx = numericKeys.length ? String(Math.max(...numericKeys) + 1) : crypto.randomUUID();

  const updatedHorses = {
    ...horses,
    [newIdx]: {
      no: String(numericKeys.length ? Number(newIdx) + 1 : ''),
      number: String(numericKeys.length ? Number(newIdx) + 1 : ''),
      name: '', trainer: '', jockey: '', barrier: '', weight: '',
      silkDesc: '', amt: 0, scratched: false, substitute: false
    }
  };

  try {
    const { error } = await supabase.from('races').update({ horses: updatedHorses }).eq('id', currentRaceId);
    if (error) throw error;
    await refreshCurrentRaceData();
    showNotification('Horse added', 'success', 'race-notifications');
  } catch (error) {
    showNotification('Error adding horse', 'error', 'race-notifications');
  }
}

async function recalculateRaceHorseTipCounts() {
  if (!currentRaceId) {
    showNotification('Select a race first', 'error', 'race-notifications');
    return;
  }

  try {
    const { data: raceData } = await supabase.from('races').select('*').eq('id', currentRaceId).single();
    if (!raceData) { showNotification('Race not found', 'error', 'race-notifications'); return; }

    const horses = { ...(raceData.horses || {}) };
    const horseIds = Object.keys(horses);
    if (!horseIds.length) { showNotification('No horses in this race to recalculate', 'error', 'race-notifications'); return; }

    horseIds.forEach(id => { horses[id] = { ...horses[id], amt: 0 }; });

    const { data: tips } = await supabase.from('tips').select('horse_id').eq('race_id', currentRaceId);
    let countedTips = 0;
    for (const tip of (tips || [])) {
      const horseId = tip.horse_id ? String(tip.horse_id) : null;
      if (!horseId || !horses[horseId]) continue;
      horses[horseId].amt = (Number(horses[horseId].amt) || 0) + 1;
      countedTips++;
    }

    const { error } = await supabase.from('races').update({ horses }).eq('id', currentRaceId);
    if (error) throw error;
    await refreshCurrentRaceData();
    showNotification(`Recalculated horse tip counts from ${countedTips} tip(s)`, 'success', 'race-notifications');
  } catch (error) {
    console.error('Error recalculating horse tip counts:', error);
    showNotification('Error recalculating horse tip counts', 'error', 'race-notifications');
  }
}

async function archiveRace() {
  if (!currentRaceId) return;

  const race = allRaces.find(r => r.id === currentRaceId);
  if (!race) return;

  const confirmed = window.confirm(`Delete ${race.name || 'this race'}? This moves it to deletedRaces and removes it from active races.`);
  if (!confirmed) return;

  try {
    const { error } = await supabase.from('races').delete().eq('id', currentRaceId);
    if (error) throw error;

    allRaces = allRaces.filter(r => r.id !== currentRaceId);
    currentRaceId = null;

    document.getElementById('race-details-panel').classList.add('hidden');
    document.getElementById('new-race-panel').classList.add('hidden');
    document.getElementById('no-selection').classList.remove('hidden');

    await loadRacesList();
    alert('Race archived and hidden from active list.');
  } catch (error) {
    console.error('Error archiving race:', error);
    showNotification('Error deleting race', 'error', 'race-notifications');
  }
}

// ============ RESULTS ============
async function loadResultsForm() {
  const race = allRaces.find(r => r.id === currentRaceId);
  if (!race || !race.horses) return;

  const winnerSelect = document.getElementById('winner-horse-id');
  const place1Select = document.getElementById('place1-horse-id');
  const place2Select = document.getElementById('place2-horse-id');

  [winnerSelect, place1Select, place2Select].forEach(select => {
    select.innerHTML = '<option value="">Select horse...</option>';
    Object.entries(race.horses).forEach(([idx, horse]) => {
      if (horse.scratched) return;
      const option = document.createElement('option');
      option.value = idx;
      option.textContent = `${horse.no ?? horse.number ?? idx} - ${horse.name}`;
      select.appendChild(option);
    });
  });

  // Load existing results if any
  const { data: results } = await supabase.from('results').select('*').eq('race_id', currentRaceId);
  if (results?.length) {
    const result = results[0];
    const winnerIdx = result.winner?.idx || result.winning_horse_id || result.winningHorseId || '';
    const place1Idx = result.place1?.idx || result.place1_horse_id || result.place1HorseId || '';
    const place2Idx = result.place2?.idx || result.place2_horse_id || result.place2HorseId || '';

    if (winnerIdx) document.getElementById('winner-horse-id').value = winnerIdx;
    if (place1Idx) document.getElementById('place1-horse-id').value = place1Idx;
    if (place2Idx) document.getElementById('place2-horse-id').value = place2Idx;

    if (result.winner?.points || result.points) document.getElementById('winner-points').value = result.winner?.points || result.points;
    if (result.place1?.points || result.place1_points || result.place1Points) document.getElementById('place1-points').value = result.place1?.points || result.place1_points || result.place1Points;
    if (result.place2?.points || result.place2_points || result.place2Points) document.getElementById('place2-points').value = result.place2?.points || result.place2_points || result.place2Points;
  }
}

async function saveResults() {
  if (!currentRaceId) return;
  const race = allRaces.find(r => r.id === currentRaceId);
  if (!race) return;

  const winnerIdx = document.getElementById('winner-horse-id').value;
  const place1Idx = document.getElementById('place1-horse-id').value;
  const place2Idx = document.getElementById('place2-horse-id').value;
  const winnerPoints = parseInt(document.getElementById('winner-points').value) || 10;
  const place1Points = parseInt(document.getElementById('place1-points').value) || 5;
  const place2Points = parseInt(document.getElementById('place2-points').value) || 2;

  const btn = document.getElementById('save-results-btn');
  const statusEl = document.getElementById('save-results-status');
  const setStatus = (msg) => { if (statusEl) { statusEl.textContent = msg; statusEl.classList.remove('hidden'); } };

  if (btn) { btn.disabled = true; btn.innerHTML = '<i data-feather="loader" class="h-4 w-4 animate-spin inline-block mr-1"></i> Saving…'; if (window.feather) feather.replace(); }
  setStatus('Saving result…');

  try {

    const result = {
      id: currentRaceId,
      race_id: currentRaceId,
      race_name: race.name,
      winner: winnerIdx ? { idx: winnerIdx, name: race.horses[winnerIdx]?.name, points: winnerPoints } : null,
      place1: place1Idx ? { idx: place1Idx, name: race.horses[place1Idx]?.name, points: place1Points } : null,
      place2: place2Idx ? { idx: place2Idx, name: race.horses[place2Idx]?.name, points: place2Points } : null,
      winning_horse_id: winnerIdx || null,
      place1_horse_id: place1Idx || null,
      place2_horse_id: place2Idx || null,
      points: winnerPoints,
      place1_points: place1Points,
      place2_points: place2Points,
      comp_id: race.comp_id || race.compId || null,
      created_at: new Date().toISOString()
    };

    const { error: resultError } = await supabase.from('results').upsert(result);
    if (resultError) throw resultError;

    setStatus('Recalculating leaderboard…');
    // Recalculate points for this competition only
    await calculateAndSaveLeaderboard(race.compId || selectedAdminCompId || null);

    setStatus('Refreshing dashboard…');
    // Refresh dashboard cards after leaderboard update
    await loadDashboardStats(selectedAdminCompId);

    if (statusEl) statusEl.classList.add('hidden');
    showNotification('Results saved and leaderboard updated!', 'success', 'race-notifications');
  } catch (error) {
    console.error('Error saving results:', error);
    if (statusEl) statusEl.classList.add('hidden');
    showNotification('Error saving results: ' + error.message, 'error', 'race-notifications');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i data-feather="save" class="h-4 w-4 inline-block mr-1"></i> Save Results'; if (window.feather) feather.replace(); }
  }
}

// Canonical scoring rule: if a user's tipped horse was scratched, their points
// fall to the horse nominated as the race's substitute. Mirrors resultsdark.html
// so the leaderboard totals match what users see on the results page.
function resolveScoredHorseId(race, tippedHorseId) {
  if (race?.horses && tippedHorseId && race.horses[tippedHorseId]?.scratched) {
    const sub = Object.entries(race.horses).find(([, h]) => h.substitute);
    if (sub) return sub[0];
  }
  return tippedHorseId;
}

async function calculateAndSaveLeaderboard(compId) {
  try {
    const { data: results } = await supabase.from('results').select('*');
    const compLeaderboardMap = {};

    const raceCompIdMap = {};
    const raceById = {};
    allRaces.forEach(r => { raceCompIdMap[r.id] = r.comp_id || r.compId || null; raceById[r.id] = r; });

    for (const result of (results || [])) {
      const raceId = result.race_id || result.id;
      const { data: tips } = await supabase.from('tips').select('*').eq('race_id', raceId);

      const winnerHorseId = result.winning_horse_id || result.winner?.idx || null;
      const place1HorseId = result.place1_horse_id || result.place1?.idx || null;
      const place2HorseId = result.place2_horse_id || result.place2?.idx || null;
      const winnerPoints = Number(result.points ?? result.winner?.points ?? 0) || 0;
      const place1Points = Number(result.place1_points ?? result.place1?.points ?? 0) || 0;
      const place2Points = Number(result.place2_points ?? result.place2?.points ?? 0) || 0;

      for (const tip of (tips || [])) {
        const userId = tip.user_id;
        const tipCompId = tip.comp_id || raceCompIdMap[raceId] || null;
        if (!tipCompId || !userId) continue;

        if (!compLeaderboardMap[tipCompId]) compLeaderboardMap[tipCompId] = {};
        if (!compLeaderboardMap[tipCompId][userId]) compLeaderboardMap[tipCompId][userId] = { user_id: userId, points: 0, wins: 0 };

        // If the tipped horse was scratched, points fall to the nominated substitute.
        const scoredHorseId = resolveScoredHorseId(raceById[raceId], tip.horse_id);

        let pts = 0;
        let wasWin = false;
        if (winnerHorseId && scoredHorseId == winnerHorseId) { pts += winnerPoints; wasWin = true; }
        else if (place1HorseId && scoredHorseId == place1HorseId) pts += place1Points;
        else if (place2HorseId && scoredHorseId == place2HorseId) pts += place2Points;
        if (pts > 0 && tip.joker === true) pts *= 2;

        compLeaderboardMap[tipCompId][userId].points += pts;
        if (wasWin) compLeaderboardMap[tipCompId][userId].wins += 1;
      }
    }

    for (const [cId, usersMap] of Object.entries(compLeaderboardMap)) {
      const entries = Object.values(usersMap).sort((a, b) =>
        b.points !== a.points ? b.points - a.points : b.wins - a.wins
      );

      let lastPoints = null, lastWins = null, lastRank = 0;
      const upsertRows = entries.map((entry, idx) => {
        const rank = (entry.points === lastPoints && entry.wins === lastWins) ? lastRank : idx + 1;
        lastPoints = entry.points; lastWins = entry.wins; lastRank = rank;
        return {
          id: `${entry.user_id}_${cId}`,
          user_id: entry.user_id,
          comp_id: cId,
          points: entry.points,
          wins: entry.wins,
          rank,
          updated_at: new Date().toISOString()
        };
      });

      for (const row of upsertRows) {
        await supabase.from('user_comp_joinings')
          .update({ points: row.points, wins: row.wins, rank: row.rank, updated_at: row.updated_at })
          .eq('user_id', row.user_id)
          .eq('comp_id', row.comp_id);
      }
    }
  } catch (error) {
    console.error('Error calculating leaderboard:', error);
  }
}

// ============ TIPS DISPLAY ============
async function loadRaceTips(race) {
  try {
    const { data: tips } = await supabase.from('tips').select('*').eq('race_id', currentRaceId);

    const tipsCountEl = document.getElementById('race-tips-count');
    const tipsList    = document.getElementById('tips-list');
    if (!tipsCountEl || !tipsList) return;

    tipsList.innerHTML = '';

    const activeCompId = race?.comp_id || race?.compId || selectedAdminCompId || null;
    let joiningsQuery = supabase.from('user_comp_joinings').select('user_id').eq('payment_status', 'completed');
    if (activeCompId) joiningsQuery = joiningsQuery.eq('comp_id', activeCompId);
    const { data: joinings } = await joiningsQuery;
    const paidUsersSet = new Set((joinings || []).map(j => j.user_id));

    let paidTipsCount = 0;
    for (const tip of (tips || [])) {
      const isPaid = paidUsersSet.has(tip.user_id);
      if (isPaid) paidTipsCount++;

      const horse = race.horses?.[tip.horse_id];
      const horseNumber = horse?.no ?? horse?.number ?? '—';
      const { data: userData } = await supabase.from('users').select('team_name,email').eq('id', tip.user_id).single();
      const userName = userData?.team_name || userData?.email || 'Unknown User';

      const tipEl = document.createElement('div');
      tipEl.className = `bg-gray-700 p-3 rounded text-sm ${isPaid ? 'border-l-4 border-yellow-400' : ''}`;
      tipEl.innerHTML = `
        <div class="flex justify-between">
          <span class="font-semibold">${userName}</span>
          ${isPaid ? '<span class="text-yellow-400 text-xs">PAID</span>' : ''}
        </div>
        <div class="text-gray-300">${horse ? `${horseNumber} - ${horse.name}` : 'Unknown Horse'}</div>
      `;
      tipsList.appendChild(tipEl);
    }

    if (tipsCountEl) tipsCountEl.textContent = paidTipsCount;
  } catch (error) {
    console.error('Error loading tips:', error);
  }
}

// ============ TAB SWITCHING ============
function switchTab(tabName, triggerEl = null) {
  currentTab = tabName;

  // Hide all tabs
  document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
  document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));

  // Show selected tab
  document.getElementById(`${tabName}-tab`)?.classList.remove('hidden');
  const activeBtn = triggerEl || document.querySelector(`.tab-btn[data-tab="${tabName}"]`);
  activeBtn?.classList.add('active');

  // Load tab-specific data
  if (tabName === 'horses') {
    const race = allRaces.find(r => r.id === currentRaceId);
    if (race) loadRaceHorses(race);
  } else if (tabName === 'results') {
    loadResultsForm();
  }
}

// Expose global functions for onclick handlers
window.scrapeSilksFromUrl = scrapeSilksFromUrl;
window.scrapeHorsesFromUrl = scrapeHorsesFromUrl;
window.addManualHorse = addManualHorse;
window.parseHorseTable = parseHorseTable;
window.cancelForm = cancelForm;
window.selectRace = selectRace;
window.showNewRaceForm = showNewRaceForm;
window.updateRaceDate = updateRaceDate;
window.updateRaceTime = updateRaceTime;
window.updateRaceDistance = updateRaceDistance;
window.updateRacePreview = updateRacePreview;
window.moveRaceToComp = moveRaceToComp;
window.archiveRace = archiveRace;
window.saveHorseChange = saveHorseChange;
window.toggleHorseScratch = toggleHorseScratch;
window.setSubstituteHorse = setSubstituteHorse;
window.addHorseToRace = addHorseToRace;
window.recalculateRaceHorseTipCounts = recalculateRaceHorseTipCounts;
window.saveResults = saveResults;
window.switchTab = switchTab;
window.toggleMobileNav = toggleMobileNav;
window.toggleMobileSidebar = toggleMobileSidebar;

// ============ UTILITIES ============
function showNotification(message, type, containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const notification = document.createElement('div');
  notification.className = `notification ${type}`;
  notification.innerHTML = `
    <i data-feather="${type === 'success' ? 'check-circle' : 'alert-circle'}" class="h-5 w-5"></i>
    <span>${message}</span>
  `;

  container.appendChild(notification);
  feather.replace();

  setTimeout(() => notification.remove(), 4000);
}

async function handleLogout() {
  try {
    await supabase.auth.signOut();
    window.location.href = '/login.html';
  } catch (error) {
    console.error('Error logging out:', error);
  }
}

// ============ MOBILE NAVIGATION ============
function toggleMobileNav() {
  const mobileNav = document.getElementById('mobile-nav');
  mobileNav.classList.toggle('hidden');
  feather.replace();
}

function toggleMobileSidebar() {
  const overlay = document.getElementById('mobile-sidebar-overlay');
  if (!overlay) {
    return;
  }
  
  overlay.classList.toggle('show');
  
  // On first open, render the mobile list if empty
  if (overlay.classList.contains('show')) {
    const mobileList = document.getElementById('race-list-mobile');
    if (mobileList && mobileList.innerHTML === '') {
      // Only render if list is empty
      if (sortedDatesCache.length > 0) {
        renderRaceListByDate(racesByDateCache, sortedDatesCache, 'race-list-mobile');
      }
    }

    // Sync search values
    const desktopSearch = document.getElementById('race-search');
    const mobileSearch = document.getElementById('race-search-mobile');
    if (desktopSearch && mobileSearch) {
      mobileSearch.value = desktopSearch.value;
    }

    // Update selection highlight on mobile list
    updateRaceSelection();
  }
  
  feather.replace();
}

// Expose functions to window for onclick handlers
window.toggleMobileNav = toggleMobileNav;
window.toggleMobileSidebar = toggleMobileSidebar;
window.showNewRaceForm = showNewRaceForm;
window.cancelForm = cancelForm;
window.addManualHorse = addManualHorse;
window.parseHorseTable = parseHorseTable;
window.scrapeHorsesFromUrl = scrapeHorsesFromUrl;
window.updateRaceDate = updateRaceDate;
window.updateRaceTime = updateRaceTime;
window.updateRaceDistance = updateRaceDistance;
window.updateRacePreview = updateRacePreview;
window.addHorseToRace = addHorseToRace;
window.saveResults = saveResults;
window.switchTab = switchTab;
window.handleLogout = handleLogout;

// Placeholder functions for features not yet implemented
window.removeUnpaidFromLeaderboard = async function() {
  alert('This feature will be implemented soon.');
};

// Search functionality for both desktop and mobile
document.addEventListener('DOMContentLoaded', () => {
  const searchInputs = ['race-search', 'race-search-mobile'];
  searchInputs.forEach(id => {
    const input = document.getElementById(id);
    if (input) {
      input.addEventListener('input', (e) => {
        const searchTerm = e.target.value.toLowerCase();
        const isMobile = id.includes('mobile');
        const listId = isMobile ? 'race-list-mobile' : 'race-list';
        const list = document.getElementById(listId);
        if (!list) return;
        
        const dateGroups = list.querySelectorAll('.date-group');
        
        dateGroups.forEach(dateGroup => {
          const raceItems = dateGroup.querySelectorAll('.race-item');
          let hasVisibleRace = false;
          
          raceItems.forEach(item => {
            const text = item.textContent.toLowerCase();
            if (text.includes(searchTerm)) {
              item.style.display = '';
              hasVisibleRace = true;
            } else {
              item.style.display = 'none';
            }
          });
          
          // Show/hide entire date group based on whether it has visible races
          const dateHeader = dateGroup.querySelector('.date-header');
          const racesForDate = dateGroup.querySelector('.races-for-date');
          
          if (hasVisibleRace) {
            dateGroup.style.display = '';
            if (searchTerm) {
              // Auto-expand when searching
              racesForDate.classList.add('show');
              dateHeader.classList.add('expanded');
              const icon = dateHeader.querySelector('i');
              if (icon) {
                icon.style.transform = 'rotate(180deg)';
              }
            }
          } else {
            dateGroup.style.display = 'none';
          }
        });

        // Year groups: show + expand when they contain a visible date group,
        // hide otherwise. Collapse them again when the search is cleared.
        list.querySelectorAll('.year-group').forEach(yearGroup => {
          const yearContent = yearGroup.querySelector('.year-content');
          const yearHeader = yearGroup.querySelector('.year-header');
          const icon = yearHeader?.querySelector('i');
          const hasVisible = Array.from(yearGroup.querySelectorAll('.date-group'))
            .some(dg => dg.style.display !== 'none');

          if (!searchTerm) {
            // Reset to collapsed default
            yearGroup.style.display = '';
            yearContent?.classList.remove('show');
            yearHeader?.classList.remove('expanded');
            if (icon) icon.style.transform = 'rotate(0deg)';
          } else if (hasVisible) {
            yearGroup.style.display = '';
            yearContent?.classList.add('show');
            yearHeader?.classList.add('expanded');
            if (icon) icon.style.transform = 'rotate(180deg)';
          } else {
            yearGroup.style.display = 'none';
          }
        });

        feather.replace();
      });
    }
  });
});

// Initialize on load
window.addEventListener('load', () => {
  feather.replace();
});

// ============ COMPETITION SELECTOR ============
async function loadAllComps() {
  try {
    const { data: compsData } = await supabase.from('comps').select('*');
    const select = document.getElementById('admin-comp-select');

    if (!select) return;

    while (select.options.length > 1) select.remove(1);

    const comps = compsData || [];
    
    // Sort by status (active first) then by name
    comps.sort((a, b) => {
      if (a.status === 'active' && b.status !== 'active') return -1;
      if (a.status !== 'active' && b.status === 'active') return 1;
      return a.name.localeCompare(b.name);
    });
    
    allComps = comps;

    // Add each comp as an option
    allComps.forEach(comp => {
      const option = document.createElement('option');
      option.value = comp.id;
      option.textContent = comp.status === 'active' ? comp.name : `${comp.name} (closed)`;
      select.appendChild(option);
    });

    // Default to whichever comp is marked as the site-wide default, so the admin
    // dashboard matches what users are actually seeing. Fall back to the first
    // active comp if none is marked default, and never implicitly default to a
    // completed comp.
    const defaultComp = allComps.find(comp => comp.is_default && comp.status === 'active') || null;
    const firstActiveComp = allComps.find(comp => comp.status === 'active') || null;
    const initialComp = defaultComp || firstActiveComp;
    if (initialComp) {
      select.value = initialComp.id;
      selectedAdminCompId = initialComp.id;
    } else {
      select.value = '';
      selectedAdminCompId = null;
    }

    // Keep move selector in sync when comps are changed
    if (currentRaceId) {
      const race = allRaces.find(r => r.id === currentRaceId);
      await populateMoveRaceCompSelect(race?.compId || null);
    }

    populateAdminNotificationCompOptions();
  } catch (error) {
    console.error('Error loading competitions:', error);
  }
}

window.handleCompSelectionChange = async function() {
  const select = document.getElementById('admin-comp-select');
  const compId = select ? select.value : null;
  selectedAdminCompId = compId || null;
  
  // Reload stats with the selected comp filter
  await loadDashboardStats(selectedAdminCompId);
};

// ============ COMPETITIONS MANAGEMENT ============
window.switchMainTab = function(tab) {
  const racePanel = document.getElementById('race-details-panel');
  const noSelectionPanel = document.getElementById('no-selection');
  const newRacePanel = document.getElementById('new-race-panel');
  const compsPanel = document.getElementById('comps-panel');
  const notificationsPanel = document.getElementById('notifications-panel');
  const usersPanel = document.getElementById('users-panel');
  const leaderboardPanel = document.getElementById('leaderboard-panel');

  racePanel?.classList.add('hidden');
  noSelectionPanel?.classList.add('hidden');
  newRacePanel?.classList.add('hidden');
  compsPanel?.classList.add('hidden');
  notificationsPanel?.classList.add('hidden');
  usersPanel?.classList.add('hidden');
  leaderboardPanel?.classList.add('hidden');

  if (tab === 'comps') {
    compsPanel?.classList.remove('hidden');
    loadCompsManagement();
  } else if (tab === 'notifications') {
    notificationsPanel?.classList.remove('hidden');
    populateAdminNotificationCompOptions();
    loadAdminNotifications();
  } else if (tab === 'users') {
    usersPanel?.classList.remove('hidden');
    initUserAdminPanel();
  } else if (tab === 'leaderboard') {
    leaderboardPanel?.classList.remove('hidden');
    initLeaderboardPanel();
  } else {
    if (currentRaceId) {
      racePanel?.classList.remove('hidden');
    } else {
      noSelectionPanel?.classList.remove('hidden');
    }
  }
};

function populateAdminNotificationCompOptions() {
  const select = document.getElementById('admin-notif-comp');
  if (!select) return;

  select.innerHTML = '<option value="">All users</option>';
  allComps.forEach((comp) => {
    const option = document.createElement('option');
    option.value = comp.id;
    option.textContent = comp.name || comp.id;
    select.appendChild(option);
  });
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function downloadCsv(filename, header, rows) {
  const csv = header.join(',') + '\n' + rows.map(r => r.join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ============ USER ADMIN PANEL ============
let uaUsers = [];
let uaSelectedUserId = null;
let uaSelectedCompId = null;
let uaResultsCache = {};
let uaResultsLoaded = false;
let uaTipsByRace = {};
let uaFormBound = false;

async function initUserAdminPanel() {
  const select = document.getElementById('user-admin-comp');
  if (!select) return;

  const previousValue = select.value;
  select.innerHTML = '<option value="">Select competition...</option>';
  allComps.forEach(comp => {
    const option = document.createElement('option');
    option.value = comp.id;
    option.textContent = comp.name || comp.id;
    select.appendChild(option);
  });
  if (previousValue && allComps.some(c => c.id === previousValue)) {
    select.value = previousValue;
  }

  bindUserAdminForm();
}

function bindUserAdminForm() {
  if (uaFormBound) return;
  uaFormBound = true;

  document.getElementById('user-admin-edit-form').addEventListener('submit', async function(e) {
    e.preventDefault();
    if (!uaSelectedUserId) return;

    const email = document.getElementById('user-admin-edit-email').value;
    const firstName = document.getElementById('user-admin-edit-firstName').value;
    const lastName = document.getElementById('user-admin-edit-lastName').value;
    const teamName = document.getElementById('user-admin-edit-teamName').value;
    const paidForComp = document.getElementById('user-admin-edit-paid').checked;
    const jokersRemaining = Number(document.getElementById('user-admin-edit-joker').value) || 0;
    const statusEl = document.getElementById('user-admin-save-status');

    statusEl.textContent = 'Saving...';
    statusEl.className = 'text-sm text-yellow-400';

    try {
      await supabase.from('users').update({
        email, first_name: firstName, last_name: lastName, team_name: teamName
      }).eq('id', uaSelectedUserId);

      if (uaSelectedCompId) {
        await supabase.from('user_comp_joinings').upsert({
          id: `${uaSelectedUserId}_${uaSelectedCompId}`,
          user_id: uaSelectedUserId,
          comp_id: uaSelectedCompId,
          payment_status: paidForComp ? 'completed' : 'pending',
          jokers_remaining: jokersRemaining
        }, { onConflict: 'user_id,comp_id' });
      }

      const idx = uaUsers.findIndex(u => u.id === uaSelectedUserId);
      if (idx !== -1) {
        uaUsers[idx] = { ...uaUsers[idx], email, first_name: firstName, last_name: lastName, team_name: teamName };
      }
      window.filterUserAdminList();
      statusEl.textContent = 'Saved';
      statusEl.className = 'text-sm text-green-400';
    } catch (error) {
      console.error('Error saving user:', error);
      statusEl.textContent = 'Error saving';
      statusEl.className = 'text-sm text-red-400';
    } finally {
      setTimeout(() => {
        if (statusEl.textContent === 'Saved') statusEl.textContent = '';
      }, 2000);
    }
  });
}

window.handleUserAdminCompChange = async function() {
  const userSelect = document.getElementById('user-admin-user');
  uaSelectedCompId = document.getElementById('user-admin-comp')?.value || null;
  uaSelectedUserId = null;
  document.getElementById('user-admin-edit-section')?.classList.add('hidden');

  if (!uaSelectedCompId) {
    userSelect.innerHTML = '<option value="">Select a competition first</option>';
    userSelect.disabled = true;
    document.getElementById('user-admin-summary').textContent = 'Choose a competition and a user to begin editing.';
    return;
  }

  document.getElementById('user-admin-summary').textContent = 'Choose a user to begin editing.';
  await loadUsersForUserAdminComp(uaSelectedCompId);
};

async function loadUsersForUserAdminComp(compId) {
  const userSelect = document.getElementById('user-admin-user');
  userSelect.innerHTML = '<option value="">Loading users...</option>';
  userSelect.disabled = true;

  const { data: joinings } = await supabase.from('user_comp_joinings').select('user_id').eq('comp_id', compId);
  const userIds = [...new Set((joinings || []).map(j => j.user_id).filter(Boolean))];

  uaUsers = [];
  if (userIds.length) {
    const { data: usersData } = await supabase.from('users').select('*').in('id', userIds);
    uaUsers = usersData || [];
  }
  uaUsers.sort((a, b) => (a.team_name || a.email || a.id || '').toLowerCase().localeCompare((b.team_name || b.email || b.id || '').toLowerCase()));

  renderUserAdminOptions(uaUsers);
  userSelect.disabled = false;
}

function renderUserAdminOptions(list) {
  const userSelect = document.getElementById('user-admin-user');
  userSelect.innerHTML = '<option value="">Select user...</option>';
  list.forEach(user => {
    const option = document.createElement('option');
    option.value = user.id;
    const name = `${user.first_name || ''} ${user.last_name || ''}`.trim();
    option.textContent = `${user.team_name || '(No Team)'}${name ? ` (${name})` : ''} - ${user.email || user.id}`;
    userSelect.appendChild(option);
  });
}

window.filterUserAdminList = function() {
  const q = (document.getElementById('user-admin-search')?.value || '').trim().toLowerCase();
  const userSelect = document.getElementById('user-admin-user');
  if (!userSelect) return;
  const currentValue = userSelect.value;

  const filtered = uaUsers.filter(u => !q ||
    (u.email && u.email.toLowerCase().includes(q)) ||
    (u.first_name && u.first_name.toLowerCase().includes(q)) ||
    (u.last_name && u.last_name.toLowerCase().includes(q)) ||
    (u.team_name && u.team_name.toLowerCase().includes(q))
  );

  renderUserAdminOptions(filtered);
  if (currentValue && Array.from(userSelect.options).some(o => o.value === currentValue)) {
    userSelect.value = currentValue;
  }
};

window.handleUserAdminUserChange = async function() {
  const userId = document.getElementById('user-admin-user')?.value;
  if (!userId) {
    uaSelectedUserId = null;
    document.getElementById('user-admin-edit-section')?.classList.add('hidden');
    document.getElementById('user-admin-summary').textContent = 'Choose a user to begin editing.';
    return;
  }
  await selectUserAdminUser(userId);
};

async function selectUserAdminUser(userId) {
  uaSelectedUserId = userId;
  document.getElementById('user-admin-edit-section')?.classList.remove('hidden');
  document.getElementById('user-admin-save-status').textContent = '';

  const { data: userRow } = await supabase.from('users').select('*').eq('id', userId).single();
  const user = userRow || {};

  document.getElementById('user-admin-edit-email').value = user.email || '';
  document.getElementById('user-admin-edit-firstName').value = user.first_name || '';
  document.getElementById('user-admin-edit-lastName').value = user.last_name || '';
  document.getElementById('user-admin-edit-teamName').value = user.team_name || '';

  const { data: joining } = await supabase.from('user_comp_joinings')
    .select('*').eq('user_id', userId).eq('comp_id', uaSelectedCompId).single();
  document.getElementById('user-admin-edit-paid').checked = joining?.payment_status === 'completed';

  let jokersRemaining = joining?.jokers_remaining;
  if (jokersRemaining == null) {
    const { data: comp } = await supabase.from('comps').select('joker_allowance').eq('id', uaSelectedCompId).single();
    jokersRemaining = comp?.joker_allowance ?? 3;
  }
  document.getElementById('user-admin-edit-joker').value = jokersRemaining;

  const compName = allComps.find(c => c.id === uaSelectedCompId)?.name || uaSelectedCompId;
  document.getElementById('user-admin-summary').textContent =
    `Editing ${user.team_name || user.email || userId} in ${compName}`;

  await loadUserAdminTips(userId, uaSelectedCompId);
}

async function loadUaResultsCache() {
  if (uaResultsLoaded) return;
  uaResultsCache = {};
  const { data } = await supabase.from('results').select('*');
  (data || []).forEach(r => { uaResultsCache[r.race_id || r.id] = r; });
  uaResultsLoaded = true;
}

function calculateUaPoints(race, horseId, jokerUsed) {
  let points = 0;
  let matched = false;
  const result = race ? (uaResultsCache[race.id] || null) : null;
  // If the tipped horse was scratched, points fall to the nominated substitute.
  const scoredHorseId = resolveScoredHorseId(race, horseId);
  if (result && scoredHorseId) {
    if (result.winning_horse_id === scoredHorseId) { points += Number(result.points) || 0; matched = true; }
    if (result.place1_horse_id === scoredHorseId) { points += Number(result.place1_points) || 0; matched = true; }
    if (result.place2_horse_id === scoredHorseId) { points += Number(result.place2_points) || 0; matched = true; }
    if (matched && jokerUsed && points > 0) points *= 2;
  }
  return points;
}

async function loadUserAdminTips(userId, compId) {
  const tipsDiv = document.getElementById('user-admin-tips-list');
  if (!compId) {
    tipsDiv.innerHTML = '<div class="text-gray-400 text-sm">Select a competition to view tips.</div>';
    return;
  }

  tipsDiv.innerHTML = '<div class="text-gray-400 text-sm">Loading tips...</div>';
  await loadUaResultsCache();

  const { data: tipsData } = await supabase.from('tips').select('*').eq('user_id', userId).eq('comp_id', compId);
  uaTipsByRace = {};
  (tipsData || []).forEach(t => { uaTipsByRace[t.race_id] = t; });

  const compRaces = allRaces
    .filter(r => (r.compId || r.comp_id) === compId)
    .sort((a, b) => new Date(`${a.date}T${a.time}`) - new Date(`${b.date}T${b.time}`));

  if (!compRaces.length) {
    tipsDiv.innerHTML = '<div class="text-gray-400 text-sm">No races in this competition yet.</div>';
    return;
  }

  tipsDiv.innerHTML = compRaces.map(race => {
    const tip = uaTipsByRace[race.id];
    const horseId = tip ? (tip.horse_id || '') : '';
    const jokerUsed = tip ? tip.joker === true : false;
    const points = calculateUaPoints(race, horseId, jokerUsed);
    const horseOptions = Object.entries(race.horses || {})
      .filter(([, h]) => !h.scratched)
      .sort((a, b) => (a[1].number || 0) - (b[1].number || 0))
      .map(([hId, h]) => `<option value="${hId}" ${hId === horseId ? 'selected' : ''}>#${h.number} ${escapeHtml(h.name)}</option>`)
      .join('');

    return `
      <div class="bg-gray-800 rounded-lg border border-gray-700 p-3" data-race-row="${race.id}">
        <div class="flex items-center justify-between flex-wrap gap-2 mb-2">
          <div>
            <strong class="text-gray-100">${escapeHtml(race.name)}</strong>
            <div class="text-xs text-gray-500">${race.date} ${race.time}</div>
          </div>
          <span class="text-xs px-2 py-1 rounded-full ${points > 0 ? 'bg-green-900/40 text-green-300' : 'bg-gray-700 text-gray-400'}" data-points-for="${race.id}">
            ${points > 0 ? `Points: ${points}` : 'No points'}
          </span>
        </div>
        <div class="flex items-center flex-wrap gap-2">
          <select class="form-group !m-0 !w-auto" data-race-id="${race.id}">
            <option value="">No Tip</option>
            ${horseOptions}
          </select>
          <label class="text-sm text-gray-300 flex items-center gap-1">
            <input type="checkbox" class="joker-checkbox h-4 w-4" data-race-id="${race.id}" ${jokerUsed ? 'checked' : ''}>
            Joker
          </label>
          <button class="btn-secondary save-tip-btn" data-race-id="${race.id}">Save</button>
          <span class="text-xs text-gray-400" data-status-for="${race.id}"></span>
        </div>
      </div>
    `;
  }).join('');

  tipsDiv.onchange = async function(e) {
    if (e.target.matches('select[data-race-id], .joker-checkbox[data-race-id]')) {
      await saveUserAdminTip(e.target.dataset.raceId);
    }
  };
  tipsDiv.onclick = async function(e) {
    const btn = e.target.closest('.save-tip-btn');
    if (btn) await saveUserAdminTip(btn.dataset.raceId);
  };
}

async function saveUserAdminTip(raceId) {
  if (!raceId || !uaSelectedUserId || !uaSelectedCompId) return;
  const tipsDiv = document.getElementById('user-admin-tips-list');
  const row = tipsDiv.querySelector(`[data-race-row="${raceId}"]`);
  if (!row) return;

  const select = row.querySelector(`select[data-race-id="${raceId}"]`);
  const jokerCheckbox = row.querySelector(`.joker-checkbox[data-race-id="${raceId}"]`);
  const status = row.querySelector(`[data-status-for="${raceId}"]`);
  const pointsEl = row.querySelector(`[data-points-for="${raceId}"]`);

  const chosenHorseId = select ? select.value : '';
  const joker = jokerCheckbox ? jokerCheckbox.checked : false;

  status.textContent = 'Saving...';

  try {
    await supabase.from('tips').upsert({
      id: `${uaSelectedUserId}_${raceId}`,
      user_id: uaSelectedUserId,
      comp_id: uaSelectedCompId,
      race_id: raceId,
      horse_id: chosenHorseId || '',
      timestamp: Date.now(),
      joker
    }, { onConflict: 'user_id,race_id' });

    uaTipsByRace[raceId] = { user_id: uaSelectedUserId, comp_id: uaSelectedCompId, race_id: raceId, horse_id: chosenHorseId || '', joker };
    await recalculateUserAdminPoints(uaSelectedUserId, uaSelectedCompId);

    const points = calculateUaPoints(allRaces.find(r => r.id === raceId), chosenHorseId, joker);
    if (pointsEl) {
      pointsEl.textContent = points > 0 ? `Points: ${points}` : 'No points';
      pointsEl.className = `text-xs px-2 py-1 rounded-full ${points > 0 ? 'bg-green-900/40 text-green-300' : 'bg-gray-700 text-gray-400'}`;
    }
    status.textContent = 'Saved';
    setTimeout(() => { if (status.textContent === 'Saved') status.textContent = ''; }, 1500);
  } catch (error) {
    console.error('Error saving tip:', error);
    status.textContent = 'Error';
  }
}

async function recalculateUserAdminPoints(userId, compId) {
  if (!compId) return;
  await loadUaResultsCache();

  let totalPoints = 0;
  let totalWins = 0;
  for (const race of allRaces) {
    if ((race.compId || race.comp_id) !== compId) continue;
    const tip = uaTipsByRace[race.id];
    const horseId = tip?.horse_id;
    if (!tip || !horseId) continue;
    const result = uaResultsCache[race.id] || null;
    const scoredHorseId = resolveScoredHorseId(race, horseId);
    if (result?.winning_horse_id === scoredHorseId) totalWins += 1;
    totalPoints += calculateUaPoints(race, horseId, !!tip.joker);
  }

  await supabase.from('user_comp_joinings').upsert({
    id: `${userId}_${compId}`,
    user_id: userId,
    comp_id: compId,
    points: totalPoints,
    wins: totalWins
  }, { onConflict: 'user_id,comp_id' });
}

window.exportUsersCsv = async function() {
  if (!uaUsers.length) return;

  let paidSet = new Set();
  if (uaSelectedCompId) {
    const { data: joinings } = await supabase.from('user_comp_joinings')
      .select('user_id,payment_status').eq('comp_id', uaSelectedCompId);
    (joinings || []).forEach(j => { if (j.payment_status === 'completed') paidSet.add(j.user_id); });
  }

  const header = ['UserID', 'Email', 'First Name', 'Last Name', 'Team Name', 'Paid'];
  const rows = uaUsers.map(u => [
    `"${u.id}"`, `"${u.email || ''}"`, `"${u.first_name || ''}"`, `"${u.last_name || ''}"`,
    `"${u.team_name || ''}"`, paidSet.has(u.id) ? 'true' : 'false'
  ]);
  downloadCsv('users.csv', header, rows);
};

window.exportLadderCsv = async function() {
  let query = supabase.from('user_comp_joinings').select('user_id,points');
  if (uaSelectedCompId) query = query.eq('comp_id', uaSelectedCompId);
  const { data: joinings } = await query;
  const leaderboard = (joinings || []).sort((a, b) => Number(b.points || 0) - Number(a.points || 0));

  const userIds = [...new Set(leaderboard.map(j => j.user_id).filter(Boolean))];
  const teamNameById = {};
  if (userIds.length) {
    const { data: usersData } = await supabase.from('users').select('id,team_name').in('id', userIds);
    (usersData || []).forEach(u => { teamNameById[u.id] = u.team_name; });
  }

  const header = ['Rank', 'Team Name', 'Points'];
  const rows = leaderboard.map((entry, idx) => [
    idx + 1, `"${teamNameById[entry.user_id] || entry.user_id || ''}"`, Number(entry.points || 0)
  ]);
  downloadCsv('ladder.csv', header, rows);
};

// ============ LEADERBOARD PANEL ============
let lbSelectedCompId = null;
let lbWeekRaceMap = {};
let lbWeekList = [];
let lbWeekLeaderboard = {};

async function initLeaderboardPanel() {
  const select = document.getElementById('lb-comp-select');
  if (!select) return;

  const previousValue = select.value;
  select.innerHTML = '<option value="">Select a competition...</option>';
  allComps.forEach(comp => {
    const option = document.createElement('option');
    option.value = comp.id;
    option.textContent = `${comp.name || comp.id}${comp.status === 'active' ? '' : ' (closed)'}`;
    select.appendChild(option);
  });

  if (previousValue && allComps.some(c => c.id === previousValue)) {
    select.value = previousValue;
    lbSelectedCompId = previousValue;
    await loadLeaderboardData();
    return;
  }

  const firstActive = allComps.find(c => c.status === 'active') || allComps[0];
  if (firstActive) {
    select.value = firstActive.id;
    lbSelectedCompId = firstActive.id;
    await loadLeaderboardData();
  }
}

window.handleLeaderboardCompChange = async function() {
  lbSelectedCompId = document.getElementById('lb-comp-select')?.value || null;
  if (lbSelectedCompId) {
    await loadLeaderboardData();
  } else {
    document.getElementById('lb-leaderboard-body').innerHTML =
      '<tr><td colspan="3" class="text-center text-gray-400 py-6">Select a competition</td></tr>';
  }
};

window.handleLeaderboardWeekChange = function() {
  renderLeaderboardWeek(document.getElementById('lb-week-select')?.value);
};

function getLeaderboardWeekNumber(dateStr) {
  const d = new Date(dateStr);
  const jan1 = new Date(d.getFullYear(), 0, 1);
  const days = Math.floor((d - jan1) / 86400000);
  return Math.ceil((days + jan1.getDay() + 1) / 7);
}

async function loadLeaderboardData() {
  if (!lbSelectedCompId) return;
  const tbody = document.getElementById('lb-leaderboard-body');
  tbody.innerHTML = '<tr><td colspan="3" class="text-center text-gray-400 py-6">Loading...</td></tr>';

  const compRaces = allRaces.filter(r => (r.compId || r.comp_id) === lbSelectedCompId);
  lbWeekRaceMap = {};
  compRaces.forEach(race => {
    if (!race.date) return;
    const week = getLeaderboardWeekNumber(race.date);
    if (!lbWeekRaceMap[week]) lbWeekRaceMap[week] = [];
    lbWeekRaceMap[week].push(race.id);
  });
  lbWeekList = Object.keys(lbWeekRaceMap).map(Number).sort((a, b) => a - b);

  if (!lbWeekList.length) {
    document.getElementById('lb-week-select').innerHTML = '';
    tbody.innerHTML = '<tr><td colspan="3" class="text-center text-gray-400 py-6">No races in this competition yet.</td></tr>';
    return;
  }

  const { data: usersData } = await supabase.from('users').select('id,team_name,email');
  const userIdToTeam = {};
  (usersData || []).forEach(u => { userIdToTeam[u.id] = u.team_name || u.email || u.id; });

  const { data: tipsData } = await supabase.from('tips').select('*').eq('comp_id', lbSelectedCompId);
  const tips = tipsData || [];

  const { data: resultsData } = await supabase.from('results').select('*');
  const results = {};
  (resultsData || []).forEach(r => { results[r.race_id || r.id] = r; });

  lbWeekLeaderboard = {};
  for (const week of lbWeekList) {
    const raceIds = lbWeekRaceMap[week];
    const userPoints = {};
    for (const tip of tips) {
      if (!raceIds.includes(tip.race_id)) continue;
      if (!userPoints[tip.user_id]) userPoints[tip.user_id] = 0;
      const result = results[tip.race_id];
      if (!result) continue;
      // If the tipped horse was scratched, points fall to the nominated substitute.
      const scoredHorseId = resolveScoredHorseId(allRaces.find(r => r.id === tip.race_id), tip.horse_id);
      let points = 0;
      if (scoredHorseId === result.winning_horse_id) points += Number(result.points) || 0;
      if (scoredHorseId === result.place1_horse_id) points += Number(result.place1_points) || 0;
      if (scoredHorseId === result.place2_horse_id) points += Number(result.place2_points) || 0;
      if (tip.joker && points > 0) points *= 2;
      userPoints[tip.user_id] += points;
    }
    lbWeekLeaderboard[week] = Object.keys(userPoints)
      .map(userId => ({ user: userIdToTeam[userId] || userId, points: userPoints[userId] }))
      .sort((a, b) => b.points - a.points);
  }

  const weekSelect = document.getElementById('lb-week-select');
  const previousWeek = weekSelect.value;
  weekSelect.innerHTML = '';
  lbWeekList.forEach(week => {
    const option = document.createElement('option');
    option.value = week;
    option.textContent = `Week ${week}`;
    weekSelect.appendChild(option);
  });
  weekSelect.value = lbWeekList.includes(Number(previousWeek)) ? previousWeek : lbWeekList[0];

  renderLeaderboardWeek(weekSelect.value);
}

function renderLeaderboardWeek(week) {
  const tbody = document.getElementById('lb-leaderboard-body');
  const data = lbWeekLeaderboard[week] || [];
  if (!data.length) {
    tbody.innerHTML = '<tr><td colspan="3" class="text-center text-gray-400 py-6">No tips recorded for this week.</td></tr>';
    return;
  }
  tbody.innerHTML = data.map((entry, idx) => `
    <tr>
      <td>${idx + 1}</td>
      <td>${escapeHtml(entry.user)}</td>
      <td>${entry.points}</td>
    </tr>
  `).join('');
}

function getNotificationUserSearchText(user) {
  const firstName = user.firstName || '';
  const lastName = user.lastName || '';
  const displayName = user.displayName || '';
  const teamName = user.teamName || '';
  const fullName = `${firstName} ${lastName}`.trim();
  return `${firstName} ${lastName} ${displayName} ${teamName} ${fullName}`.toLowerCase();
}

function formatNotificationUserLabel(user) {
  if (!user) return '';
  const firstName = user.firstName || '';
  const lastName = user.lastName || '';
  const fullName = `${firstName} ${lastName}`.trim();
  return fullName || user.displayName || user.teamName || user.email || user.id;
}

async function ensureNotificationUsersCache() {
  if (notificationUsersCache.length) return;

  const { data: users } = await supabase.from('users').select('id,first_name,last_name,team_name,email');
  notificationUsersCache = (users || []).map(u => ({
    id: u.id,
    firstName: u.first_name || '',
    lastName: u.last_name || '',
    displayName: '',
    teamName: u.team_name || '',
    email: u.email || ''
  }));
}

function renderSelectedNotificationUser() {
  const selectedEl = document.getElementById('admin-notif-user-selected');
  if (!selectedEl) return;

  if (!selectedNotificationUser) {
    selectedEl.innerHTML = '';
    return;
  }

  selectedEl.innerHTML = `Targeting user: <strong>${escapeHtml(formatNotificationUserLabel(selectedNotificationUser))}</strong> <button class="btn-secondary" style="padding:4px 8px;font-size:12px;margin-left:8px;" onclick="window.clearNotificationUserSelection()">Clear</button>`;
}

window.searchNotificationUsers = async function() {
  const input = document.getElementById('admin-notif-user-search');
  const resultsEl = document.getElementById('admin-notif-user-results');
  if (!input || !resultsEl) return;

  const term = (input.value || '').trim().toLowerCase();
  if (term.length < 2) {
    resultsEl.innerHTML = '';
    return;
  }

  try {
    await ensureNotificationUsersCache();
    const matches = notificationUsersCache
      .filter((user) => getNotificationUserSearchText(user).includes(term))
      .slice(0, 8);

    if (!matches.length) {
      resultsEl.innerHTML = '<div class="text-xs text-gray-400">No users found.</div>';
      return;
    }

    resultsEl.innerHTML = matches.map((user) => `
      <button type="button" onclick="window.selectNotificationUser('${escapeHtml(user.id)}')" class="w-full text-left bg-gray-800 border border-gray-700 rounded px-3 py-2 hover:border-yellow-400 transition">
        <div class="text-sm text-gray-100">${escapeHtml(formatNotificationUserLabel(user))}</div>
        <div class="text-xs text-gray-400">${escapeHtml(user.email || user.id)}</div>
      </button>
    `).join('');
  } catch (error) {
    console.error('User search failed:', error);
    resultsEl.innerHTML = '<div class="text-xs text-red-300">User search failed.</div>';
  }
};

window.selectNotificationUser = function(userId) {
  selectedNotificationUser = notificationUsersCache.find((user) => user.id === userId) || null;
  const input = document.getElementById('admin-notif-user-search');
  const resultsEl = document.getElementById('admin-notif-user-results');
  if (input && selectedNotificationUser) {
    input.value = formatNotificationUserLabel(selectedNotificationUser);
  }
  if (resultsEl) {
    resultsEl.innerHTML = '';
  }
  renderSelectedNotificationUser();
};

window.clearNotificationUserSelection = function() {
  selectedNotificationUser = null;
  const input = document.getElementById('admin-notif-user-search');
  const resultsEl = document.getElementById('admin-notif-user-results');
  if (input) input.value = '';
  if (resultsEl) resultsEl.innerHTML = '';
  renderSelectedNotificationUser();
};

async function loadAdminNotifications() {
  const listEl = document.getElementById('admin-notifications-list');
  if (!listEl) return;

  try {
    // Notification IDs are random UUIDs, so ordering by id is not chronological.
    // The real timestamp lives in the JSONB payload as an ISO string, which sorts chronologically.
    const { data: rows } = await supabase.from('notifications').select('*').order('data->>createdAt', { ascending: false }).limit(30);

    if (!rows?.length) {
      listEl.innerHTML = '<div class="text-sm text-gray-400">No notifications sent yet.</div>';
      return;
    }

    listEl.innerHTML = '';
    (rows || []).forEach((notifRow) => {
      const n = notifRow.data || notifRow;
      const audienceType = n.audienceType || n.audience_type || 'all';
      const audience = audienceType === 'competition'
        ? `Comp: ${allComps.find(c => c.id === (n.compId || n.notif_comp_id))?.name || n.compId || 'Unknown'}`
        : audienceType === 'user'
          ? `User: ${n.userDisplayName || n.userEmail || n.userId || 'Unknown'}`
          : 'All users';
      const when = n.createdAt
        ? (typeof n.createdAt === 'string'
            ? DateTime.fromISO(n.createdAt).setZone('Australia/Sydney').toFormat('EEE d LLL, h:mm a')
            : 'Pending...')
        : 'Pending...';

      const row = document.createElement('div');
      row.className = 'bg-gray-800 rounded-lg border border-gray-700 p-3';
      row.innerHTML = `
        <div class="flex items-start justify-between gap-3">
          <div>
            <div class="font-semibold text-gray-100">${n.title || 'Notification'}</div>
            <div class="text-sm text-gray-300 mt-1">${n.body || ''}</div>
            <div class="text-xs text-gray-500 mt-2">${audience}</div>
            <div class="text-xs text-gray-500 mt-1" data-stats-for="${n.oneSignalId || ''}">${n.oneSignalId ? 'Loading delivery stats...' : ''}</div>
          </div>
          <div class="text-xs text-gray-500 whitespace-nowrap">${when}</div>
        </div>
      `;
      listEl.appendChild(row);
    });

    feather.replace();
    loadNotificationDeliveryStats(rows.slice(0, 10));
  } catch (error) {
    console.error('Error loading admin notifications:', error);
    listEl.innerHTML = '<div class="text-sm text-red-300">Could not load notifications.</div>';
  }
}

async function loadNotificationDeliveryStats(rows) {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) return;

  for (const notifRow of rows) {
    const n = notifRow.data || notifRow;
    if (!n.oneSignalId) continue;
    const statsEl = document.querySelector(`[data-stats-for="${n.oneSignalId}"]`);
    if (!statsEl) continue;

    try {
      const response = await fetch(`${SUPABASE_URL}/functions/v1/send-onesignal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ action: 'notification-stats', notificationId: n.oneSignalId }),
      });
      const stats = await response.json();
      if (!response.ok) throw new Error(stats?.error || 'Failed to load stats');

      statsEl.textContent = `Delivered ${stats.successful ?? 0} · Clicked ${stats.converted ?? 0}${stats.failed ? ` · Failed ${stats.failed}` : ''}`;
    } catch (error) {
      statsEl.textContent = '';
    }
  }
}

window.sendAdminNotification = async function() {
  const titleInput = document.getElementById('admin-notif-title');
  const bodyInput = document.getElementById('admin-notif-body');
  const compSelect = document.getElementById('admin-notif-comp');

  const title = titleInput?.value?.trim() || '';
  const body = bodyInput?.value?.trim() || '';
  const compId = compSelect?.value || '';
  const targetUser = selectedNotificationUser;

  if (!title || !body) {
    showNotification('Enter a title and message first', 'error', 'admin-notification-status');
    return;
  }

  const audienceType = targetUser ? 'user' : (compId ? 'competition' : 'all');

  try {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) throw new Error('Not authenticated');

    const response = await fetch(`${SUPABASE_URL}/functions/v1/send-onesignal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ title, body, audienceType, compId: compId || null, userId: targetUser?.id || null }),
    });
    const pushResult = await response.json();
    if (!response.ok) throw new Error(pushResult?.error || 'Failed to send push notification');

    const { error: notifError } = await supabase.from('notifications').insert({
      id: crypto.randomUUID(),
      data: {
        title,
        body,
        audienceType,
        compId: compId || null,
        userId: targetUser?.id || null,
        userDisplayName: targetUser ? formatNotificationUserLabel(targetUser) : null,
        userEmail: targetUser?.email || null,
        oneSignalId: pushResult.oneSignalId || null,
        createdAt: new Date().toISOString()
      }
    });
    if (notifError) throw notifError;

    titleInput.value = '';
    bodyInput.value = '';
    compSelect.value = '';
    window.clearNotificationUserSelection();

    showNotification(`Notification sent (${pushResult.targetUsers ?? 0} recipients)`, 'success', 'admin-notification-status');
    await loadAdminNotifications();
  } catch (error) {
    console.error('Error sending admin notification:', error);
    showNotification('Failed to send notification', 'error', 'admin-notification-status');
  }
};

async function loadCompsManagement() {
  try {
    const { data: compsData } = await supabase.from('comps').select('*');
    const comps = compsData || [];

    const metricsByCompId = {};
    await Promise.all(comps.map(async (comp) => {
      const [{ data: races }, { data: paid }] = await Promise.all([
        supabase.from('races').select('id').eq('comp_id', comp.id),
        supabase.from('user_comp_joinings').select('id').eq('comp_id', comp.id).eq('payment_status', 'completed')
      ]);
      metricsByCompId[comp.id] = { racesCount: (races || []).length, paidCount: (paid || []).length };
    }));

    allCompsForManagement = comps.map(comp => ({
      ...comp,
      metrics: metricsByCompId[comp.id] || { racesCount: 0, paidCount: 0 }
    }));

    renderCompsManagementList();
  } catch (error) {
    console.error('Error loading comps:', error);
    showNotification('Error loading competitions', 'error', 'comp-notifications');
  }
}

function getCompStatusMeta(status) {
  if (status === 'active') {
    return {
      badge: '<span class="inline-block bg-green-500/20 text-green-400 px-3 py-1 rounded-full text-xs font-semibold">Active</span>',
      sortOrder: 0
    };
  }
  if (status === 'closed') {
    return {
      badge: '<span class="inline-block bg-gray-500/20 text-gray-300 px-3 py-1 rounded-full text-xs font-semibold">Closed</span>',
      sortOrder: 1
    };
  }
  return {
    badge: '<span class="inline-block bg-red-500/20 text-red-300 px-3 py-1 rounded-full text-xs font-semibold">Deleted</span>',
    sortOrder: 2
  };
}

function renderCompsManagementList() {
  const compsList = document.getElementById('comps-list');
  if (!compsList) return;

  const searchTerm = (document.getElementById('comp-search')?.value || '').trim().toLowerCase();
  const statusFilter = (document.getElementById('comp-filter-status')?.value || 'all').toLowerCase();

  const filtered = allCompsForManagement
    .filter(comp => {
      const status = (comp.status || 'closed').toLowerCase();
      if (statusFilter !== 'all' && status !== statusFilter) return false;

      if (!searchTerm) return true;
      const haystack = `${comp.name || ''} ${comp.id || ''} ${comp.description || ''}`.toLowerCase();
      return haystack.includes(searchTerm);
    })
    .sort((a, b) => {
      const aMeta = getCompStatusMeta((a.status || 'closed').toLowerCase());
      const bMeta = getCompStatusMeta((b.status || 'closed').toLowerCase());
      if (aMeta.sortOrder !== bMeta.sortOrder) return aMeta.sortOrder - bMeta.sortOrder;
      return new Date(b.startDate || 0) - new Date(a.startDate || 0);
    });

  if (!filtered.length) {
    compsList.innerHTML = '<div class="text-center py-12 text-gray-400">No competitions match the current filters.</div>';
    return;
  }

  compsList.innerHTML = '';

  for (const comp of filtered) {
    const startDate = (comp.start_date || comp.startDate) ? DateTime.fromISO(comp.start_date || comp.startDate).toFormat('MMM d, yyyy') : 'N/A';
    const endDate = (comp.end_date || comp.endDate) ? DateTime.fromISO(comp.end_date || comp.endDate).toFormat('MMM d, yyyy') : 'N/A';
    const status = (comp.status || 'closed').toLowerCase();
    const statusMeta = getCompStatusMeta(status);
    const racesCount = comp.metrics?.racesCount || 0;
    const paidCount = comp.metrics?.paidCount || 0;

    const statusAction = status === 'deleted'
      ? `<button onclick="window.restoreCompetition('${comp.id}')" class="btn-secondary flex-1"><i data-feather="rotate-ccw" class="h-4 w-4"></i>Restore</button>`
      : `<button onclick="window.deleteCompetition('${comp.id}')" class="btn-danger flex-1"><i data-feather="archive" class="h-4 w-4"></i>Archive</button>`;

    const joinLinkAction = status === 'active'
      ? `<button onclick="window.copyCompetitionJoinLink('${comp.id}')" class="btn-secondary flex-1"><i data-feather="link" class="h-4 w-4"></i>Copy Join Link</button>`
      : `<button class="btn-secondary flex-1" disabled title="Only active competitions can be joined"><i data-feather="link" class="h-4 w-4"></i>Join Link</button>`;

    const isHidden = !!comp.is_hidden;
    const hiddenBadge = isHidden
      ? '<span class="inline-block bg-purple-500/20 text-purple-300 px-3 py-1 rounded-full text-xs font-semibold">Hidden from users</span>'
      : '';
    const visibilityAction = isHidden
      ? `<button onclick="window.toggleCompVisibility('${comp.id}', false)" class="btn-secondary flex-1"><i data-feather="eye" class="h-4 w-4"></i>Unhide</button>`
      : `<button onclick="window.toggleCompVisibility('${comp.id}', true)" class="btn-secondary flex-1"><i data-feather="eye-off" class="h-4 w-4"></i>Hide</button>`;

    const isDefault = !!comp.is_default;
    const defaultBadge = isDefault
      ? '<span class="inline-block bg-yellow-500/20 text-yellow-300 px-3 py-1 rounded-full text-xs font-semibold">Default competition</span>'
      : '';
    const defaultAction = isDefault
      ? ''
      : `<button onclick="window.setDefaultComp('${comp.id}')" class="btn-secondary flex-1" ${status === 'deleted' ? 'disabled' : ''}><i data-feather="star" class="h-4 w-4"></i>Set as Default</button>`;

    const card = document.createElement('div');
    card.className = 'card rounded-lg p-6';
    card.innerHTML = `
      <div class="flex justify-between items-start mb-4 gap-4">
        <div>
          <h3 class="text-lg font-bold text-gray-100">${comp.name}</h3>
          <p class="text-xs text-gray-500 mt-1">ID: ${comp.id}</p>
          <p class="text-sm text-gray-400 mt-2">${comp.description || 'No description'}</p>
        </div>
        <div class="flex flex-col items-end gap-2">
          ${statusMeta.badge}
          ${defaultBadge}
          ${hiddenBadge}
        </div>
      </div>
      <div class="grid grid-cols-2 md:grid-cols-6 gap-4 mb-4 py-4 border-t border-b border-gray-700">
        <div>
          <p class="text-xs text-gray-500">Entry Fee</p>
          <p class="text-lg font-semibold text-yellow-400">$${(comp.entry_fee || comp.entryFee || 0).toFixed(2)}</p>
        </div>
        <div>
          <p class="text-xs text-gray-500">Prize Pool</p>
          <p class="text-lg font-semibold text-green-400">$${(comp.prize_pool || comp.prizePool || 0).toFixed(2)}</p>
        </div>
        <div>
          <p class="text-xs text-gray-500">Participants</p>
          <p class="text-lg font-semibold">${paidCount}/${comp.max_participants || comp.maxParticipants || 1000}</p>
        </div>
        <div>
          <p class="text-xs text-gray-500">Races</p>
          <p class="text-lg font-semibold text-blue-300">${racesCount}</p>
        </div>
        <div class="md:col-span-2">
          <p class="text-xs text-gray-500">Dates</p>
          <p class="text-xs text-gray-300">${startDate} to ${endDate}</p>
        </div>
      </div>
      <div class="flex gap-2 flex-wrap md:flex-nowrap">
        ${joinLinkAction}
        <button onclick="window.editCompetition('${comp.id}')" class="btn-secondary flex-1" ${status === 'deleted' ? 'disabled' : ''}>
          <i data-feather="edit-2" class="h-4 w-4"></i>
          Edit
        </button>
        ${status === 'deleted' ? '' : visibilityAction}
        ${status === 'deleted' ? '' : defaultAction}
        ${statusAction}
      </div>
    `;
    compsList.appendChild(card);
  }

  feather.replace();
}

window.handleCompManagementFilterChange = function() {
  renderCompsManagementList();
};

function sanitizeCompId(value) {
  return (value || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32);
}

async function generateUniqueCompId(baseName) {
  const baseId = sanitizeCompId(baseName) || 'competition';
  let candidate = baseId;
  let suffix = 2;

  while (true) {
    const { data } = await supabase.from('comps').select('id').eq('id', candidate).single();
    if (!data) return candidate;
    candidate = `${baseId}-${suffix}`;
    suffix += 1;
  }
}

function validateCompetitionData(compData, isNew) {
  if (!compData.name) return 'Competition name is required';
  if (!compData.startDate || !compData.endDate) return 'Start and end dates are required';
  if (new Date(compData.endDate) < new Date(compData.startDate)) return 'End date must be on or after start date';
  if (compData.entryFee < 0) return 'Entry fee cannot be negative';
  if (compData.prizePool < 0) return 'Prize pool cannot be negative';
  if (!Number.isFinite(compData.maxParticipants) || compData.maxParticipants < 1) return 'Max participants must be at least 1';
  if (!isNew && !compData.id) return 'Competition ID is missing';
  return null;
}

window.showNewCompForm = function() {
  const formContainer = document.getElementById('comp-form-container');
  formContainer.classList.remove('hidden');
  document.getElementById('form-title').textContent = 'Create New Competition';
  document.getElementById('comp-form').reset();
  document.getElementById('comp-id').value = 'auto-generated';
  document.getElementById('comp-status').value = 'active';
  formContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

window.cancelCompForm = function() {
  document.getElementById('comp-form-container').classList.add('hidden');
  document.getElementById('comp-form').reset();
};

window.editCompetition = async function(compId) {
  try {
    const { data: comp } = await supabase.from('comps').select('*').eq('id', compId).single();
    if (!comp) { showNotification('Competition not found', 'error', 'comp-notifications'); return; }

    document.getElementById('form-title').textContent = `Edit: ${comp.name}`;
    const formContainer = document.getElementById('comp-form-container');
    formContainer.classList.remove('hidden');
    document.getElementById('comp-name').value = comp.name;
    document.getElementById('comp-status').value = comp.status;
    document.getElementById('comp-fee').value = comp.entry_fee || comp.entryFee || 0;
    document.getElementById('comp-prize').value = comp.prize_pool || comp.prizePool || 0;
    document.getElementById('comp-start').value = (comp.start_date || comp.startDate || '').split('T')[0];
    document.getElementById('comp-end').value = (comp.end_date || comp.endDate || '').split('T')[0];
    document.getElementById('comp-description').value = comp.description || '';
    document.getElementById('comp-max-participants').value = comp.max_participants || comp.maxParticipants || 1000;
    document.getElementById('comp-joker-allowance').value = comp.joker_allowance ?? 3;
    document.getElementById('comp-id').value = compId;
    formContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    console.error('Error editing competition:', error);
    showNotification('Error loading competition', 'error', 'comp-notifications');
  }
};

window.saveCompetition = async function() {
  try {
    const compId = document.getElementById('comp-id').value;
    const isNew = compId === 'auto-generated';
    const startDateRaw = document.getElementById('comp-start').value;
    const endDateRaw = document.getElementById('comp-end').value;

    const compData = {
      name: document.getElementById('comp-name').value.trim(),
      status: document.getElementById('comp-status').value,
      entry_fee: parseFloat(document.getElementById('comp-fee').value) || 0,
      prize_pool: parseFloat(document.getElementById('comp-prize').value) || 0,
      start_date: startDateRaw ? `${startDateRaw}T00:00:00Z` : '',
      end_date: endDateRaw ? `${endDateRaw}T23:59:59Z` : '',
      description: document.getElementById('comp-description').value.trim(),
      max_participants: parseInt(document.getElementById('comp-max-participants').value) || 1000,
      joker_allowance: parseInt(document.getElementById('comp-joker-allowance').value) ?? 3,
      updated_at: new Date().toISOString()
    };

    const validationError = validateCompetitionData({
      name: compData.name, startDate: compData.start_date, endDate: compData.end_date,
      entryFee: compData.entry_fee, prizePool: compData.prize_pool,
      maxParticipants: compData.max_participants, id: isNew ? null : compId
    }, isNew);
    if (validationError) {
      showNotification(validationError, 'error', 'comp-notifications');
      return;
    }

    const finalCompId = isNew ? await generateUniqueCompId(compData.name) : compId;

    if (isNew) {
      const { error } = await supabase.from('comps').insert({ id: finalCompId, ...compData, participant_count: 0, created_at: new Date().toISOString() });
      if (error) throw error;
      showNotification(`Competition "${compData.name}" created successfully!`, 'success', 'comp-notifications');
    } else {
      const { error } = await supabase.from('comps').update(compData).eq('id', compId);
      if (error) throw error;
      showNotification(`Competition "${compData.name}" updated successfully!`, 'success', 'comp-notifications');
    }

    document.getElementById('comp-form-container').classList.add('hidden');
    await loadCompsManagement();
    await loadAllComps();
    await loadDashboardStats(selectedAdminCompId);
  } catch (error) {
    console.error('Error saving competition:', error);
    showNotification('Error saving competition: ' + error.message, 'error', 'comp-notifications');
  }
};

window.deleteCompetition = async function(compId) {
  try {
    const { data: races } = await supabase.from('races').select('id').eq('comp_id', compId);
    const raceCount = (races || []).length;
    if (!confirm(`Archive this competition?${raceCount ? `\n\nThis comp currently has ${raceCount} race(s).` : ''}`)) return;

    const { error } = await supabase.from('comps').update({ status: 'deleted' }).eq('id', compId);
    if (error) throw error;
    showNotification('Competition archived', 'success', 'comp-notifications');
    await loadCompsManagement();
    await loadAllComps();
    await loadDashboardStats(selectedAdminCompId);
  } catch (error) {
    console.error('Error deleting competition:', error);
    showNotification('Error deleting competition', 'error', 'comp-notifications');
  }
}

window.setDefaultComp = async function(compId) {
  try {
    // Only one comp can be default at a time: clear it everywhere, then set the chosen one.
    const { error: clearError } = await supabase.from('comps').update({ is_default: false }).eq('is_default', true);
    if (clearError) throw clearError;

    const { error } = await supabase.from('comps').update({ is_default: true }).eq('id', compId);
    if (error) throw error;

    showNotification('Default competition updated', 'success', 'comp-notifications');
    await loadCompsManagement();
    await loadAllComps();
  } catch (error) {
    console.error('Error setting default competition:', error);
    showNotification('Error setting default competition', 'error', 'comp-notifications');
  }
};

window.toggleCompVisibility = async function(compId, hide) {
  try {
    const { error } = await supabase.from('comps').update({ is_hidden: hide }).eq('id', compId);
    if (error) throw error;
    showNotification(hide ? 'Competition hidden from users' : 'Competition visible to users again', 'success', 'comp-notifications');
    await loadCompsManagement();
    await loadAllComps();
  } catch (error) {
    console.error('Error toggling competition visibility:', error);
    showNotification('Error updating competition visibility', 'error', 'comp-notifications');
  }
};

window.restoreCompetition = async function(compId) {
  if (!confirm('Restore this competition as closed?')) {
    return;
  }

  try {
    const { error } = await supabase.from('comps').update({ status: 'closed', updated_at: new Date().toISOString() }).eq('id', compId);
    if (error) throw error;
    showNotification('Competition restored as closed', 'success', 'comp-notifications');
    await loadCompsManagement();
    await loadAllComps();
    await loadDashboardStats(selectedAdminCompId);
  } catch (error) {
    console.error('Error restoring competition:', error);
    showNotification('Error restoring competition', 'error', 'comp-notifications');
  }
};

window.copyCompetitionJoinLink = async function(compId) {
  try {
    const link = `${window.location.origin}/comps.html?joinCompId=${encodeURIComponent(compId)}&joinPrompt=1`;
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(link);
    } else {
      const tempInput = document.createElement('input');
      tempInput.value = link;
      document.body.appendChild(tempInput);
      tempInput.select();
      document.execCommand('copy');
      document.body.removeChild(tempInput);
    }
    showNotification('Competition join link copied to clipboard', 'success', 'comp-notifications');
  } catch (error) {
    console.error('Error copying join link:', error);
    showNotification('Could not copy link. Try again.', 'error', 'comp-notifications');
  }
};

// ============================================================
// RACING AUSTRALIA UNIFIED IMPORTER
// ============================================================

let raScrapedRaces = [];

window.loadRAMeeting = async function() {
  const rawUrl = (document.getElementById('ra-import-url')?.value || '').trim();
  if (!rawUrl) {
    showNotification('Please enter a Racing Australia URL', 'error', 'form-notifications');
    return;
  }
  // Strip any #fragment — it's a client-side anchor and causes proxy failures (413/CORS)
  const url = rawUrl.split('#')[0];

  const btn       = document.getElementById('ra-load-btn');
  const statusEl  = document.getElementById('ra-fetch-status');
  const msgEl     = document.getElementById('ra-fetch-msg');

  const setStatus = (msg) => { if (msgEl) msgEl.textContent = msg; };
  const showStatus = () => { statusEl?.classList.remove('hidden'); feather.replace(); };
  const hideStatus = () => statusEl?.classList.add('hidden');

  btn.disabled = true;
  btn.innerHTML = '<i data-feather="loader" class="h-4 w-4 animate-spin"></i> Loading...';
  document.getElementById('ra-race-picker')?.classList.add('hidden');
  showStatus();
  feather.replace();

  // Tick through status messages so the user can see live progress
  const phases = [
    [0,    'Fetching meeting page…'],
    [5000, 'Still fetching (can take up to 25s)…'],
    [12000,'Taking a while — trying fallback proxy…'],
    [20000,'Almost there…'],
  ];
  const phaseTimers = phases.map(([delay, msg]) => setTimeout(() => setStatus(msg), delay));
  const clearPhases = () => phaseTimers.forEach(clearTimeout);

  try {
    setStatus('Trying Jina AI proxy…');
    console.log('[ra-meeting] Fetching:', url);
    // Use Jina-first order (preferRaw=false) for the full meeting page —
    // corsproxy 413s on large pages and allorigins has CORS issues from localhost.
    const html = await fetchHtmlViaProxy(url, 'ra-meeting', false);

    clearPhases();
    setStatus(`Got response (${(html.length / 1024).toFixed(0)} KB) — parsing races…`);
    console.log('[ra-meeting] Response length:', html.length, 'chars');
    console.log('[ra-meeting] First 500 chars:\n', html.slice(0, 500));
    // Find first occurrence of "Race" to understand structure
    const raceIdx = html.search(/\bRace\s+\d/i);
    // Find the SECOND occurrence of "Race N" (first is nav bar) to see actual section structure
    const firstRaceIdx = html.search(/\bRace\s+\d/i);
    const secondRaceIdx = firstRaceIdx >= 0 ? html.slice(firstRaceIdx + 10).search(/\bRace\s+\d/i) : -1;
    const actualRaceIdx = secondRaceIdx >= 0 ? firstRaceIdx + 10 + secondRaceIdx : firstRaceIdx;
    if (actualRaceIdx >= 0) console.log('[ra-meeting] Race section context (chars', actualRaceIdx, '–', actualRaceIdx + 1500, '):\n', html.slice(actualRaceIdx, actualRaceIdx + 1500));
    else console.warn('[ra-meeting] No "Race N" pattern found anywhere in response');
    const races = parseRAMeetingPage(html, url);
    console.log('[ra-meeting] Parsed races:', races.length, races.map(r => `Race ${r.raceNum}: ${r.horses.length} horses`));

    if (!races.length) {
      showNotification('No races found on this page. Check the URL or try a different proxy.', 'error', 'form-notifications');
      return;
    }

    raScrapedRaces = races;
    renderRARacePicker(races);
    document.getElementById('ra-race-picker').classList.remove('hidden');
    showNotification(`Found ${races.length} race${races.length !== 1 ? 's' : ''} — select one below.`, 'success', 'form-notifications');
  } catch (err) {
    clearPhases();
    showNotification('Error loading meeting: ' + err.message, 'error', 'form-notifications');
    console.error('[loadRAMeeting]', err);
  } finally {
    clearPhases();
    hideStatus();
    btn.disabled = false;
    btn.innerHTML = '<i data-feather="search" class="h-4 w-4"></i> Load Races';
    feather.replace();
  }
};

function parseDateFromRAKey(dateStr) {
  // "2026Jun26" → "2026-06-26"
  const m = dateStr.match(/^(\d{4})([A-Za-z]{3})(\d{1,2})$/);
  if (m) {
    const mo = { jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',
                 jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12' }[m[2].toLowerCase()] || '01';
    return `${m[1]}-${mo}-${m[3].padStart(2,'0')}`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
  return '';
}

function parseTimeFrom12h(str) {
  const m = (str || '').match(/(\d{1,2}):(\d{2})\s*(am|pm)/i);
  if (!m) return '';
  let h = parseInt(m[1], 10);
  if (m[3].toLowerCase() === 'pm' && h < 12) h += 12;
  if (m[3].toLowerCase() === 'am' && h === 12) h = 0;
  return `${String(h).padStart(2,'0')}:${m[2]}`;
}

// Parses Jina AI plain-text output for a Racing Australia form page.
//
// Actual format (tab-separated, NOT markdown pipe tables):
//   Race 1 - 11:45AM RACE NAME (1000 METRES)
//   Of $30,000.1st $15,000, ...
//   No\tLast 10\tHorse\tTrainer\tJockey\tBarrier\tWeight\t...
//   1\t14\tSWEET LEAF          ← horse number, last10, name on one line
//   \tTrainer Name\tJockey (a2/55kg)\t10\t58.5kg\t...  ← continuation with tab prefix
//   2\t2x\tBIG LON
//   \tDavid Hatch\tGrody Spokes\t6\t57.5kg\t...
// Parses Acceptances.aspx markdown, which Jina renders as a pipe table:
//   | Race 1 - 4:15PM NAME (1800 METRES)... |
//   | No | Last 10 | Horse | Trainer | Jockey | Barrier | Weight | ... |
//   | 1 | 82 | [BON RIVIERE](url HorseFullForm.aspx?...) | [Tom Dougall](url) | ... |
// Horse names are links to HorseFullForm, so horseHref comes straight from here.
function parseRAAcceptancesFromMarkdown(md, meetingUrl) {
  const keyMatch = meetingUrl.match(/Key=([^&#]+)/i);
  const keyDecoded = decodeURIComponent(keyMatch?.[1] || '');
  const meetingDate = parseDateFromRAKey(keyDecoded.split(',')[0] || '');

  const RACE_HDR = /Race\s+(\d+)\s*[-–]\s*(\d{1,2}:\d{2}\s*(?:AM|PM))\s+(.*)/i;

  // Strip [text](url) → capture both; href is the full HorseFullForm URL when present
  const parseCell = (cell) => {
    const m = cell.match(/\[([^\]]*)\]\(([^)]*)\)/);
    if (m) {
      const url = m[2].trim();
      const isHorse = /HorseFullForm\.aspx/i.test(url);
      return { text: m[1].trim(), href: isHorse ? url : '' };
    }
    return { text: cell.trim(), href: '' };
  };

  const splitPipeRow = (line) => line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map(c => c.trim());

  const races = [];
  const lines = md.split('\n');
  let current = null;       // race being built
  let cols = null;          // header column index map

  for (const line of lines) {
    if (!line.includes('|')) continue;
    const cells = splitPipeRow(line);

    // Race heading row (single meaningful cell containing "Race N - TIME ...")
    const headText = cells.find(c => RACE_HDR.test(c));
    if (headText) {
      const hm = headText.match(RACE_HDR);
      if (hm) {
        if (current && current.horses.length) races.push(current);
        const raceNum = parseInt(hm[1], 10);
        const timeStr = hm[2].trim();
        let rest = hm[3].replace(/Times displayed.*$/i, '').trim();
        const distM = rest.match(/\((\d{3,5})\s*METRES?\)/i) || rest.match(/\b(\d{3,5})\s*m\b/i);
        const distance = distM ? distM[1] + 'm' : '';
        const name = rest.replace(/\s*\(\d{3,5}\s*METRES?\)\s*/i, '').trim();
        current = {
          raceNum, name: name || `Race ${raceNum}`, date: meetingDate,
          time: parseTimeFrom12h(timeStr), distance, prize: '',
          horses: [], sourceUrl: meetingUrl,
        };
        cols = null;
      }
      continue;
    }

    // Column header row
    if (/(^|\|)\s*No\s*(\||$)/i.test(line) && /Horse/i.test(line)) {
      cols = {};
      cells.forEach((c, i) => {
        const t = c.toLowerCase();
        if (t === 'no') cols.no = i;
        else if (t.includes('last')) cols.last10 = i;
        else if (t === 'horse') cols.horse = i;
        else if (t === 'trainer') cols.trainer = i;
        else if (t === 'jockey') cols.jockey = i;
        else if (t.includes('barrier')) cols.barrier = i;
        else if (t === 'weight') cols.weight = i;
      });
      continue;
    }

    // Data row — first cell is a runner number, and we have a race + columns
    if (current && cols && /^\d+[a-z]?$/i.test(cells[cols.no] || '')) {
      const number = (cells[cols.no] || '').trim();
      const horseCell = parseCell(cells[cols.horse] || '');
      const name = horseCell.text.replace(/\s*\(NZ\)\s*/gi, '').replace(/\s+/g, ' ').trim();
      if (!name) continue;
      const last10Raw = (cells[cols.last10] || '').trim();
      const last10 = /^[0-9xX.\s-]{1,12}$/.test(last10Raw) ? last10Raw : '';
      const trainer = parseCell(cells[cols.trainer] || '').text;
      const jockey = parseCell(cells[cols.jockey] || '').text.replace(/\s*\([^)]*\)\s*/g, '').trim();
      const barrier = ((cells[cols.barrier] || '').match(/\d+/) || [''])[0];
      const weight = (cells[cols.weight] || '').replace(/\s*kg\s*/gi, '').trim();
      current.horses.push({ number, name, last10, trainer, jockey, barrier, weight, horseHref: horseCell.href });
    }
  }

  if (current && current.horses.length) races.push(current);
  return races.sort((a, b) => a.raceNum - b.raceNum);
}

function parseRAMeetingFromMarkdown(md, meetingUrl) {
  const keyMatch = meetingUrl.match(/Key=([^&#]+)/i);
  const keyDecoded = decodeURIComponent(keyMatch?.[1] || '');
  const meetingDate = parseDateFromRAKey(keyDecoded.split(',')[0] || '');

  const races = [];
  const lines = md.split('\n');

  // Race heading: "Race N - HH:MMam NAME (DISTm)"
  // Note: navigation line "Race 1 Race 2 Race 3..." has no dash so won't match
  const RACE_HDR = /^Race\s+(\d+)\s*[-–]\s*(\d{1,2}:\d{2}\s*(?:AM|PM))\s+(.*)/i;
  const COL_HDR  = /^No\t/i;
  // Data row: starts with a number (possibly followed by letter), then tab
  const DATA_ROW = /^(\d+[a-z]?)\t([^\t]*)\t(.+)/i;
  // Continuation row: starts with a tab (trainer / jockey / barrier / weight)
  const CONT_ROW = /^\t(.+)/;

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const raceM = line.match(RACE_HDR);

    if (!raceM) { i++; continue; }

    // ── Found a race heading ──────────────────────────────────────────
    const raceNum  = parseInt(raceM[1], 10);
    const timeStr  = raceM[2].trim();
    const restHead = raceM[3].trim();

    // Distance: "(1000 METRES)" or "1000m" at the end of the heading
    const distM    = restHead.match(/\((\d{3,5})\s*METRES?\)/i) || restHead.match(/\b(\d{3,5})\s*m\b/i);
    const distance = distM ? distM[1] + 'm' : '';

    // Race name: everything in heading before the distance paren
    const raceName = restHead.replace(/\s*\(\d{3,5}\s*METRES?\)\s*/i, '').trim();

    // Prize: scan next ~6 lines for "Of $NN,NNN"
    let prize = '';
    for (let j = i + 1; j < Math.min(i + 7, lines.length); j++) {
      const pm = lines[j].match(/Of\s+\$([\d,]+)/i);
      if (pm) { prize = '$' + pm[1]; break; }
    }

    // Scan forward to find the column header row
    let tableStart = -1;
    for (let j = i + 1; j < Math.min(i + 20, lines.length); j++) {
      if (COL_HDR.test(lines[j])) { tableStart = j + 1; break; }
    }

    const horses = [];

    if (tableStart >= 0) {
      let j = tableStart;
      while (j < lines.length) {
        const dataM = lines[j].match(DATA_ROW);

        if (dataM) {
          const number  = dataM[1].trim();
          const last10  = dataM[2].trim();
          const namePart = dataM[3].trim()
            .replace(/\s*\(NZ\)\s*/gi, '')
            .replace(/\s+/g, ' ')
            .trim();

          // Look ahead for the continuation line (starts with tab)
          let trainer = '', jockey = '', barrier = '', weight = '';
          let k = j + 1;
          // Skip any blank lines between the name line and the continuation
          while (k < lines.length && lines[k] === '') k++;
          const contM = k < lines.length ? lines[k].match(CONT_ROW) : null;
          if (contM) {
            const parts = contM[1].split('\t');
            // parts: [trainer, jockey, barrier, weight, probable_weight?, ...]
            trainer = (parts[0] || '').trim();
            const jockeyRaw = (parts[1] || '').trim();
            jockey  = jockeyRaw.replace(/\s*\([^)]*\)\s*/g, '').trim();
            barrier = ((parts[2] || '').match(/\d+/) || [''])[0];
            weight  = (parts[3] || '').replace(/\s*kg\s*/gi, '').trim();
            j = k + 1; // advance past the continuation line
          } else {
            j++;
          }

          if (namePart) {
            horses.push({ number, name: namePart, last10, trainer, jockey, barrier, weight, horseHref: '' });
          }
        } else if (RACE_HDR.test(lines[j])) {
          // Hit the next race heading — stop parsing this race's horses
          break;
        } else {
          // Check for a horse detail card header (e.g. "1SWEET LEAF ..." — digit immediately followed by uppercase)
          const cardM = lines[j].match(/^(\d+[a-z]?)([A-Z])/);
          if (cardM) {
            const cardNum = cardM[1];
            for (let k = j + 1; k < Math.min(j + 15, lines.length); k++) {
              if (RACE_HDR.test(lines[k])) break;
              const pm = lines[k].match(/Prizemoney:\s*\$([\d,]+)/i);
              if (pm) {
                const h = horses.find(hh => hh.number === cardNum);
                if (h) h.prizemoney = '$' + pm[1];
                break;
              }
            }
          }
          j++;
        }
      }
      i = j; // resume outer loop from where inner loop stopped
    } else {
      i++;
    }

    if (horses.length) {
      races.push({
        raceNum,
        name: raceName || `Race ${raceNum}`,
        date: meetingDate,
        time: parseTimeFrom12h(timeStr),
        distance,
        prize,
        horses,
        sourceUrl: meetingUrl
      });
    }
  }

  return races.sort((a, b) => a.raceNum - b.raceNum);
}

function parseRAMeetingPage(html, meetingUrl) {
  // Jina AI proxy returns markdown, not HTML. Detect by absence of <html> tag.
  if (!/<html[\s>]/i.test(html)) {
    // Form.aspx renders as tab-separated markdown; Acceptances.aspx as a pipe table.
    let races = parseRAMeetingFromMarkdown(html, meetingUrl);
    if (!races.length) races = parseRAAcceptancesFromMarkdown(html, meetingUrl);
    return races;
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  const keyMatch = meetingUrl.match(/Key=([^&]+)/i);
  const keyDecoded = decodeURIComponent(keyMatch?.[1] || '');
  const meetingDate = parseDateFromRAKey(keyDecoded.split(',')[0] || '');

  const races = [];

  // Strategy 1: find named anchors <a name="RaceN"> or elements id="RaceN"
  const raceAnchors = Array.from(doc.querySelectorAll('a[name], [id]'))
    .filter(el => /^Race\d+$/i.test(el.getAttribute('name') || el.id || ''));

  for (const anchor of raceAnchors) {
    const idStr = anchor.getAttribute('name') || anchor.id;
    const raceNum = parseInt(idStr.replace(/\D/g, ''), 10);
    if (!raceNum) continue;

    let raceTitle = '';
    let raceTime = '';
    let raceDistance = '';
    let racePrize = '';
    let table = null;

    // Walk forward from the anchor looking for a heading then a table.
    // The anchor is often inline inside a heading, so start from its
    // parent and then move through siblings.
    const start = anchor.parentElement || anchor;
    let el = start.nextElementSibling || start.parentElement?.nextElementSibling;
    let steps = 0;

    while (el && steps < 20) {
      // Stop if we hit the next race section
      const elId = el.getAttribute?.('name') || el.id || '';
      if (/^Race\d+$/i.test(elId) && elId !== idStr) break;
      if (el.querySelector?.('a[name^="Race"]') &&
          el.querySelector('a[name^="Race"]') !== anchor) {
        const inner = el.querySelector('a[name^="Race"]');
        if ((inner.getAttribute('name') || '') !== idStr) break;
      }

      const tag = (el.tagName || '').toLowerCase();
      const text = el.textContent || '';

      if (/^h[1-6]$/.test(tag)) {
        if (!raceTime) {
          const tm = text.match(/(\d{1,2}:\d{2}\s*(?:am|pm))/i);
          if (tm) raceTime = parseTimeFrom12h(tm[1]);
        }
        if (!raceDistance) {
          const dm = text.match(/\b(\d{3,5})\s*[Mm]\b/);
          if (dm) raceDistance = dm[1] + 'm';
        }
        if (!racePrize) {
          const pm = text.match(/\$([\d,]+)/);
          if (pm) racePrize = '$' + pm[1];
        }
        if (!raceTitle) {
          // Heading text is typically: "Race N (N) TIME - RACE NAME - DISTm - $PRIZE"
          const parts = text.replace(/\s+/g, ' ').split(/\s*[-–]\s*/);
          const namePart = parts.find(p => {
            const t = p.trim();
            return t.length > 3
              && !/^\d+$/.test(t)
              && !/^\$/.test(t)
              && !/^\d+m$/i.test(t)
              && !/^\d{1,2}:\d{2}/.test(t)
              && !/^Race\s*\d/i.test(t);
          });
          if (namePart) raceTitle = namePart.trim();
        }
      }

      if (tag === 'table' && !table) {
        if (el.querySelectorAll('tr').length >= 3) table = el;
      }

      if (table) break;
      el = el.nextElementSibling;
      steps++;
    }

    if (!table) continue;
    const horses = parseRAHorsesFromTable(table);
    if (!horses.length) continue;

    races.push({
      raceNum,
      name: raceTitle || `Race ${raceNum}`,
      date: meetingDate,
      time: raceTime,
      distance: raceDistance,
      prize: racePrize,
      horses,
      sourceUrl: meetingUrl
    });
  }

  // Strategy 2: no anchors — scan all tables and infer race sections from
  // preceding headings.
  if (!races.length) {
    const tables = Array.from(doc.querySelectorAll('table'));
    for (const table of tables) {
      if (table.querySelectorAll('tr').length < 3) continue;

      let raceNum = races.length + 1;
      let raceTitle = '', raceTime = '', raceDistance = '', racePrize = '';
      let prev = table.previousElementSibling;
      let steps = 0;
      while (prev && steps < 6) {
        const txt = prev.textContent || '';
        const rm = txt.match(/\bRace\s*(\d+)\b/i);
        if (rm) {
          raceNum = parseInt(rm[1], 10);
          const tm = txt.match(/(\d{1,2}:\d{2}\s*(?:am|pm))/i);
          if (tm) raceTime = parseTimeFrom12h(tm[1]);
          const dm = txt.match(/\b(\d{3,5})\s*[Mm]\b/);
          if (dm) raceDistance = dm[1] + 'm';
          const pm = txt.match(/\$([\d,]+)/);
          if (pm) racePrize = '$' + pm[1];
          break;
        }
        prev = prev.previousElementSibling;
        steps++;
      }

      const horses = parseRAHorsesFromTable(table);
      if (!horses.length) continue;

      races.push({ raceNum, name: raceTitle || `Race ${raceNum}`, date: meetingDate,
                   time: raceTime, distance: raceDistance, prize: racePrize,
                   horses, sourceUrl: meetingUrl });
    }
  }

  return races.sort((a, b) => a.raceNum - b.raceNum);
}

function parseRAHorsesFromTable(table) {
  const horses = [];
  const rows = Array.from(table.querySelectorAll('tr'));

  // Detect header row
  const headerRow = rows.find(r => r.querySelectorAll('th').length > 0);
  const headers = headerRow
    ? Array.from(headerRow.querySelectorAll('th')).map(th => th.textContent.trim().toLowerCase())
    : [];

  // Map headers to column indices; fall back to positional defaults for RA layout:
  // [0]=No, [1]=Last10, [2]=Horse, [3]=Trainer, [4]=Jockey, [5]=Barrier, [6]=Weight
  const col = (patterns, fallback) => {
    const idx = headers.findIndex(h => patterns.some(p => p.test(h)));
    return idx >= 0 ? idx : fallback;
  };
  const cNo      = col([/^no\.?$/, /^#$/, /^num/],              0);
  const cLast10  = col([/last\s*10/, /\bl10\b/, /^form$/],      1);
  const cHorse   = col([/horse/, /^name$/],                      2);
  const cTrainer = col([/trainer/],                              3);
  const cJockey  = col([/jockey/, /rider/],                      4);
  const cBarrier = col([/barrier/, /\bgate\b/, /\bbar\b/],      5);
  const cWeight  = col([/\bweight\b/, /\bwgt\b/, /^kg$/],       6);

  const dataRows = rows.filter(r => r.querySelectorAll('td').length >= 3);

  for (const row of dataRows) {
    const cells = Array.from(row.querySelectorAll('td'));

    const number = normalizeHorseNumber((cells[cNo]?.textContent || '').trim());
    if (!number) continue;

    const last10Raw = (cells[cLast10]?.textContent || '').trim();
    // last10 is a short alphanumeric form string, not a horse name
    const last10 = /^[0-9xX.\s-]{1,12}$/.test(last10Raw) ? last10Raw : '';

    // Horse name — find the cell with a link to HorseFullForm
    let horseName = '';
    let horseHref = '';
    const horseCell = cells[cHorse];
    if (horseCell) {
      const link = horseCell.querySelector('a');
      if (link) {
        horseName = (link.textContent || '').trim().replace(/\s*\(NZ\)\s*/gi, '').replace(/\s+/g, ' ').trim();
        const href    = link.getAttribute('href') || '';
        const onclick = link.getAttribute('onclick') || '';
        const hm = (href + '|' + onclick).match(/HorseFullForm\.aspx\?([^"'\s|]*)/i);
        if (hm) horseHref = hm[1];
      } else {
        horseName = (horseCell.textContent || '').trim().replace(/\s*\(NZ\)\s*/gi, '').trim();
      }
    }
    if (!horseName) continue;

    const trainer = (cells[cTrainer]?.textContent || '').replace(/\s+/g, ' ').trim();

    // Jockey: "Nick Palmer (a2/55kg)" → strip the parenthetical
    const jockeyRaw = (cells[cJockey]?.textContent || '').trim();
    const jockey = jockeyRaw.replace(/\s*\([^)]*\)\s*/g, '').trim();

    const barrier = ((cells[cBarrier]?.textContent || '').match(/\d+/) || [''])[0];
    const weight  = (cells[cWeight]?.textContent || '').trim().replace(/\s*kg\s*/gi, '').trim();

    horses.push({ number, name: horseName, last10, trainer, jockey, barrier, weight, horseHref });
  }

  return horses;
}

function renderRARacePicker(races) {
  const grid = document.getElementById('ra-race-grid');
  grid.innerHTML = '';

  races.forEach((race, idx) => {
    const card = document.createElement('div');
    card.className = 'cursor-pointer rounded-lg p-3 border border-gray-600 bg-gray-800 hover:border-yellow-500 transition-all';
    card.innerHTML = `
      <div class="flex items-start gap-3">
        <div class="flex-shrink-0 w-9 h-9 rounded-full bg-gradient-to-br from-yellow-500 to-amber-600 flex items-center justify-center font-bold text-gray-900 text-sm">${race.raceNum}</div>
        <div class="flex-1 min-w-0">
          <p class="font-semibold text-gray-100 text-sm leading-snug">${escHtml(race.name)}</p>
          <div class="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
            ${race.time     ? `<span class="text-xs text-gray-400">${race.time}</span>` : ''}
            ${race.distance ? `<span class="text-xs text-blue-400">${race.distance}</span>` : ''}
            ${race.prize    ? `<span class="text-xs text-green-400">${race.prize}</span>` : ''}
          </div>
          <p class="text-xs text-gray-500 mt-1">${race.horses.length} runners</p>
        </div>
      </div>`;
    card.onclick = () => window.selectRARace(idx);
    grid.appendChild(card);
  });

  feather.replace();
}

function escHtml(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

window.selectRARace = function(idx) {
  const race = raScrapedRaces[idx];
  if (!race) return;

  // Highlight the selected card
  Array.from(document.querySelectorAll('#ra-race-grid > div')).forEach((c, i) => {
    const selected = i === idx;
    c.classList.toggle('border-yellow-500', selected);
    c.classList.toggle('bg-yellow-500/10', selected);
    c.classList.toggle('border-gray-600', !selected);
    c.classList.toggle('bg-gray-800', !selected);
  });

  // Fill race meta fields
  if (race.date)     document.getElementById('race-date').value     = race.date;
  if (race.time)     document.getElementById('race-time').value     = race.time;
  if (race.distance) document.getElementById('race-distance').value = race.distance;
  // Venue comes from the meeting URL key (date,state,venue) — insert it before the race name
  const venue = (() => {
    const keyM = (race.sourceUrl || '').match(/Key=([^&#]+)/i);
    return keyM ? (decodeURIComponent(keyM[1]).split(',')[2] || '').trim() : '';
  })();
  document.getElementById('race-name').value = venue
    ? `Race ${race.raceNum} - ${venue} - ${race.name}`
    : `Race ${race.raceNum} - ${race.name}`;

  // Build the horses list
  const horsesList = document.getElementById('horses-list');
  horsesList.innerHTML = '';

  race.horses.forEach(horse => {
    const row = document.createElement('div');
    row.className = 'horse-row';
    row.dataset.last10      = horse.last10 || '';
    row.dataset.horseHref   = horse.horseHref || '';
    row.dataset.prizemoney  = horse.prizemoney || '';
    row.innerHTML = buildHorseRowInner(horse);
    horsesList.appendChild(row);
  });
  if (window.feather) feather.replace();

  showNotification(`Race ${race.raceNum} loaded — fetching silks and form data in background…`, 'success', 'form-notifications');
  enrichRAHorsesInBackground(race.horses, race.sourceUrl);
};

// Fetch the raw meeting HTML and map each runner's normalized name → HorseFullForm
// query string (horseHref). Names are unique across a meeting, so this is collision-free.
async function fetchRAHorseHrefs(meetingUrl) {
  const html = await fetchHtmlViaProxy(meetingUrl.split('#')[0], 'ra-href-resolve', true);
  const map = new Map();

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  // Each runner name is an <a> linking to HorseFullForm.aspx (via href or onclick)
  const links = doc.querySelectorAll('a');
  for (const a of links) {
    const href    = a.getAttribute('href') || '';
    const onclick = a.getAttribute('onclick') || '';
    const m = (href + '|' + onclick).match(/HorseFullForm\.aspx\?([^"'\s|)]+)/i);
    if (!m) continue;
    const name = (a.textContent || '').trim();
    const key = normalizeHorseName(name);
    if (key && !map.has(key)) map.set(key, m[1]);
  }

  // Fallback for proxied HTML where anchors are flattened: pair each HorseFullForm
  // query with the nearest preceding capitalised horse name isn't reliable, so we
  // only use the anchor-based map above. If empty, the caller degrades gracefully.
  return map;
}

async function enrichRAHorsesInBackground(horses, sourceUrl) {
  const statusEl  = document.getElementById('ra-enrich-status');
  const msgEl     = document.getElementById('ra-enrich-msg');
  const barEl     = document.getElementById('ra-enrich-bar');

  // Races are parsed from Jina markdown, which has no horse links — so horseHref
  // is empty. Resolve it from the raw meeting HTML (allorigins) so we can fetch
  // each horse's form page for silks + prizemoney. Best-effort: if the raw proxy
  // is unavailable, silks simply won't populate but the rest still works.
  if (!horses.some(h => h.horseHref) && sourceUrl) {
    statusEl.classList.remove('hidden');
    if (msgEl) msgEl.textContent = 'Resolving horse links for silks…';
    feather.replace();
    try {
      const hrefByName = await fetchRAHorseHrefs(sourceUrl);
      for (const h of horses) {
        const key = normalizeHorseName(h.name);
        if (key && hrefByName.has(key)) h.horseHref = hrefByName.get(key);
      }
    } catch (err) {
      console.warn('[enrichRA] could not resolve horse hrefs:', err.message);
    }
  }

  const enrichable = horses.filter(h => h.horseHref);
  if (!enrichable.length) { statusEl.classList.add('hidden'); return; }

  statusEl.classList.remove('hidden');
  barEl.style.width = '0%';
  feather.replace();

  let done = 0;
  const total = enrichable.length;
  const updateProgress = () => {
    if (msgEl) msgEl.textContent = `Fetching silks & form… (${done} / ${total})`;
    if (barEl) barEl.style.width = `${Math.round((done / total) * 100)}%`;
  };
  updateProgress();

  const enrichOne = async (horse) => {
    try {
      // horseHref may be a full URL (from Acceptances markdown, path /InteractiveForm/…)
      // or just a query string (legacy HTML parse, path /FreeFields/…).
      const horseUrl = /^https?:\/\//i.test(horse.horseHref)
        ? horse.horseHref
        : new URL(`FreeFields/HorseFullForm.aspx?${horse.horseHref}`, 'https://www.racingaustralia.horse').href;
      // Jina-first (preferRaw=false): the silk image URL and prizemoney are present in
      // Jina's markdown, and this avoids the slow allorigins timeout that stalls
      // production when that proxy is down.
      const horseHtml = await fetchHtmlViaProxy(horseUrl, `ra-enrich:${horse.name}`, true);

      // Silk ID
      const silkM = horseHtml.match(/JockeySilks\/(\d+)\.png/i);
      if (silkM) horse.silksId = silkM[1];

      // Prizemoney — several label patterns used on RA pages
      const prizeM = horseHtml.match(/total\s+prize\s*money[^$\d]*\$([\d,]+)/i)
                  || horseHtml.match(/\$([\d,]+)\s+total\s+prize\s*money/i);
      if (prizeM) horse.prizemoney = '$' + prizeM[1].replace(/,/g, '');

      // Form history table (only parses when raw HTML is returned; harmless on markdown)
      horse.formHistory = parseRAHorseFormHistory(horseHtml);

    } catch (err) {
      console.warn(`[enrichRA] ${horse.name}:`, err.message);
    }

    // Update the matching DOM row
    const rows = Array.from(document.querySelectorAll('#horses-list .horse-row'));
    for (const row of rows) {
      const nameVal = row.querySelector('.horse-name')?.value || '';
      const noVal   = row.querySelector('.horse-no')?.value   || '';
      const nameMatch = normalizeHorseName(nameVal) === normalizeHorseName(horse.name);
      const noMatch   = normalizeHorseNumber(noVal) === normalizeHorseNumber(horse.number);
      if (!nameMatch && !noMatch) continue;

      const silkInput = row.querySelector('.horse-silk-id');
      if (silkInput && horse.silksId) silkInput.value = horse.silksId;
      row.dataset.last10       = horse.last10 || '';
      if (horse.prizemoney)    row.dataset.prizemoney   = horse.prizemoney;
      if (horse.formHistory?.length) row.dataset.formHistory = JSON.stringify(horse.formHistory);
      break;
    }

    done++;
    updateProgress();
  };

  // Fetch horses in parallel with a concurrency cap — fast without tripping rate limits.
  const CONCURRENCY = 3;
  const queue = [...enrichable];
  const workers = Array.from(
    { length: Math.min(CONCURRENCY, queue.length) },
    async () => { while (queue.length) await enrichOne(queue.shift()); }
  );
  await Promise.all(workers);

  barEl.style.width = '100%';
  msgEl.textContent = `Done — silks and form data loaded for ${done} horse${done !== 1 ? 's' : ''}.`;
  feather.replace();
  setTimeout(() => statusEl.classList.add('hidden'), 5000);
}

function parseRAHorseFormHistory(html) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const history = [];

  for (const table of doc.querySelectorAll('table')) {
    const headers = Array.from(table.querySelectorAll('th')).map(th => th.textContent.trim().toLowerCase());
    const hasDate = headers.some(h => h.includes('date'));
    const hasPos  = headers.some(h => /pos|place|fin|result/.test(h));
    if (!hasDate || !hasPos) continue;

    const dataRows = Array.from(table.querySelectorAll('tbody tr, tr'))
      .filter(r => r.querySelectorAll('td').length >= 4);

    for (const row of dataRows) {
      const cells = Array.from(row.querySelectorAll('td'));
      const entry = {};
      headers.forEach((h, i) => {
        const val = (cells[i]?.textContent || '').replace(/\s+/g, ' ').trim();
        if (h.includes('date'))                          entry.date    = val;
        else if (/venue|track|course/.test(h))          entry.track   = val;
        else if (h.includes('dist'))                     entry.dist    = val;
        else if (/pos|fin|place|result/.test(h))        entry.pos     = val;
        else if (/jockey|rider/.test(h))                entry.jockey  = val;
        else if (/weight|wgt/.test(h))                  entry.weight  = val;
        else if (/barrier|gate/.test(h))                entry.barrier = val;
        else if (h.includes('winner'))                  entry.winner  = val;
        else if (/margin|marg/.test(h))                 entry.margin  = val;
        else if (/class|grade/.test(h))                 entry.class   = val;
        else if (h.includes('prize') || h.includes('$')) entry.prize  = val;
      });
      if (entry.date) history.push(entry);
    }

    if (history.length) break;
  }

  return history.slice(0, 10);
}

// ── Racing Australia Meeting Browser ─────────────────────────────────────────

const RA_STATES = ['NSW','VIC','QLD','WA','SA','TAS','ACT','NT'];
let raBrowserMeetingsCache = null;
const STATE_COLOURS = {
  NSW:'#3b82f6', VIC:'#8b5cf6', QLD:'#ef4444', WA:'#f97316',
  SA:'#10b981',  TAS:'#06b6d4', ACT:'#ec4899', NT:'#f59e0b',
};

window.openRAMeetingBrowser = async function() {
  const modal = document.getElementById('ra-browser-modal');
  const statusEl = document.getElementById('ra-browser-status');
  const contentEl = document.getElementById('ra-browser-content');
  modal.style.display = 'block';
  contentEl.innerHTML = '';
  statusEl.textContent = 'Fetching meetings from Racing Australia…';
  feather.replace();

  try {
    const html = await fetchHtmlViaProxy('https://racingaustralia.horse/home.aspx', 'ra-browser', false);
    let meetings = parseRAHomeMeetings(html);
    if (!meetings.length) meetings = parseRAHomeMeetingsMarkdown(html);
    if (!meetings.length) { statusEl.textContent = 'No meetings found — try again shortly.'; return; }
    statusEl.textContent = '';
    raBrowserMeetingsCache = meetings;
    renderRAMeetingBrowser(meetings, contentEl);
    feather.replace();
  } catch (err) {
    statusEl.textContent = 'Failed to load meetings: ' + err.message;
  }
};

window.closeRAMeetingBrowser = function() {
  document.getElementById('ra-browser-modal').style.display = 'none';
};

function parseRAHomeMeetings(html) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const meetings = [];

  // Find the schedule table — has <th> links to Calendar.aspx for each state
  let table = null;
  for (const t of doc.querySelectorAll('table')) {
    if (t.querySelector('a[href*="Calendar.aspx?State="]')) { table = t; break; }
  }
  if (!table) return meetings;

  // Map column index → state from the header row
  const colState = {};
  const headerRow = table.querySelector('tr');
  if (headerRow) {
    headerRow.querySelectorAll('th,td').forEach((cell, i) => {
      const a = cell.querySelector('a[href*="State="]');
      if (a) {
        const m = a.href.match(/State=([A-Z]+)/);
        if (m) colState[i] = m[1];
      }
    });
  }

  // Walk data rows (class="rows")
  for (const row of table.querySelectorAll('tr.rows')) {
    const cells = Array.from(row.querySelectorAll('td'));
    if (!cells.length) continue;

    // First cell is the date
    const dateText = cells[0]?.querySelector('span')?.textContent?.trim() || cells[0]?.textContent?.trim() || '';
    if (!dateText) continue;

    // Each subsequent cell = one state column
    cells.slice(1).forEach((cell, idx) => {
      const colIdx = idx + 1;
      const state = colState[colIdx];
      if (!state) return;

      cell.querySelectorAll('a').forEach(a => {
        const venue = a.textContent.trim();
        if (!venue) return;
        // Use the href directly — already has the correct Form.aspx or Acceptances.aspx URL
        const href = a.getAttribute('href');
        const hasLink = href && (href.includes('Form.aspx') || href.includes('Acceptances.aspx'));
        const url = hasLink ? 'https://racingaustralia.horse' + href : null;
        const postponed = !hasLink;
        meetings.push({ date: dateText, state, venue, url, postponed });
      });
    });
  }

  return meetings;
}

function parseRAHomeMeetingsMarkdown(text) {
  // Jina returns markdown where links look like [VenueName](https://...Form.aspx?Key=...)
  // and state headers look like [NSW](/FreeFields/Calendar.aspx?State=NSW)
  const meetings = [];
  const lines = text.split(/\r?\n/);

  // Helper: extract text and URL from a markdown cell that may contain [text](url)
  const mdLinks = (cell) => {
    const results = [];
    const re = /\[([^\]]+)\]\(([^)]+)\)/g;
    let m;
    while ((m = re.exec(cell)) !== null) results.push({ text: m[1].trim(), url: m[2].trim() });
    if (!results.length) {
      // plain text, no link
      const t = cell.trim();
      if (t) results.push({ text: t, url: null });
    }
    return results;
  };

  // Extract plain text from a cell (strip markdown links)
  const cellText = (cell) => cell.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').trim();

  const hasPipeTable = lines.some(l => l.trim().startsWith('|'));
  if (!hasPipeTable) return meetings;

  const dateRe = /([A-Z]+DAY)\s+(\d{1,2})\s+([A-Z]{3})/i;

  let colState = {};   // col index → state abbreviation
  let currentDate = null;

  for (const line of lines) {
    const isPipeRow = line.trim().startsWith('|');

    // A non-pipe line that contains a date is a standalone date header
    if (!isPipeRow) {
      const dm = line.match(dateRe);
      if (dm) currentDate = line.replace(/[|*_#]/g, '').trim();
      continue;
    }

    // Split pipe row into cells (drop leading/trailing empties from the split)
    const rawCells = line.split('|').slice(1, -1);
    if (!rawCells.length) continue;
    if (rawCells.every(c => /^[-:\s]+$/.test(c))) continue; // separator row

    const texts = rawCells.map(c => cellText(c));

    // Header row: cells whose plain text matches state codes
    if (RA_STATES.some(s => texts.includes(s))) {
      colState = {};
      texts.forEach((t, i) => { if (RA_STATES.includes(t)) colState[i] = t; });
      continue;
    }

    // Data row — the date lives in the FIRST cell of the same row as the venues
    const firstCellDate = texts[0]?.match(dateRe);
    if (firstCellDate) currentDate = texts[0].trim();

    if (!currentDate || !Object.keys(colState).length) continue;

    rawCells.forEach((cell, i) => {
      const state = colState[i];
      if (!state) return; // skips the date column (index not in colState)
      mdLinks(cell).forEach(({ text: venue, url }) => {
        if (!venue || venue === '\\' || venue.length < 2) return;
        // A real meeting links to Form.aspx / Acceptances.aspx; postponed ones link to home.aspx
        let resolvedUrl = null;
        if (url && (url.includes('Form.aspx') || url.includes('Acceptances.aspx'))) {
          resolvedUrl = url.startsWith('http') ? url : 'https://racingaustralia.horse' + url;
        }
        meetings.push({ date: currentDate, state, venue: venue.replace(/\\$/, '').trim(), url: resolvedUrl, postponed: !resolvedUrl });
      });
    });
  }

  return meetings;
}

function buildRADateKey(day, mon) {
  // Returns e.g. "2026Jun26" from day="26" mon="JUN"
  const now = new Date();
  const year = now.getFullYear();
  const monCap = mon.charAt(0).toUpperCase() + mon.slice(1).toLowerCase();
  return `${year}${monCap}${String(day).padStart(2, '0')}`;
}

function buildRAFormUrl(dateKey, state, venue) {
  // Key format: 2026Jun26,NSW,Tamworth  (comma-separated, URL-encoded)
  const key = `${dateKey},${state},${venue}`;
  return `https://racingaustralia.horse/FreeFields/Form.aspx?Key=${encodeURIComponent(key)}`;
}

function renderRAMeetingBrowser(meetings, container) {
  // Group by date
  const byDate = {};
  const dateOrder = [];
  for (const m of meetings) {
    if (!byDate[m.date]) { byDate[m.date] = []; dateOrder.push(m.date); }
    byDate[m.date].push(m);
  }

  for (const date of dateOrder) {
    const group = byDate[date];

    const dayEl = document.createElement('div');
    dayEl.style.cssText = 'margin-bottom:20px;';

    const heading = document.createElement('div');
    heading.style.cssText = 'font-size:0.75rem;font-weight:700;letter-spacing:0.05em;color:#facc15;text-transform:uppercase;margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid rgba(75,85,99,0.3);';
    heading.textContent = date;
    dayEl.appendChild(heading);

    const grid = document.createElement('div');
    grid.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;';

    for (const m of group) {
      const btn = document.createElement('button');
      const stateColor = STATE_COLOURS[m.state] || '#6b7280';
      btn.style.cssText = `display:flex;align-items:center;gap:6px;padding:6px 12px;border-radius:6px;border:1px solid rgba(75,85,99,0.4);background:rgba(17,24,39,0.9);color:#e5e7eb;font-size:0.8125rem;cursor:pointer;transition:background 0.15s;`;
      if (m.postponed) {
        btn.style.opacity = '0.4';
        btn.style.cursor = 'default';
        btn.title = 'Meeting postponed';
      } else {
        btn.onmouseover = () => btn.style.background = 'rgba(55,65,81,0.9)';
        btn.onmouseout = () => btn.style.background = 'rgba(17,24,39,0.9)';
        btn.onclick = () => selectRAMeeting(m);
      }
      btn.innerHTML = `<span style="font-size:0.65rem;font-weight:700;padding:1px 5px;border-radius:3px;background:${stateColor};color:#fff;">${m.state}</span>${m.venue}${m.postponed ? ' <span style="font-size:0.65rem;color:#9ca3af;">(postponed)</span>' : ''}`;
      grid.appendChild(btn);
    }

    dayEl.appendChild(grid);
    container.appendChild(dayEl);
  }
}

async function selectRAMeeting(m) {
  const contentEl = document.getElementById('ra-browser-content');
  const statusEl  = document.getElementById('ra-browser-status');

  // Show loading state inside the modal with a back button
  contentEl.innerHTML = `
    <button onclick="reopenRAMeetingBrowser()" style="display:inline-flex;align-items:center;gap:6px;margin-bottom:16px;padding:6px 12px;border-radius:6px;border:1px solid rgba(75,85,99,0.4);background:rgba(17,24,39,0.9);color:#9ca3af;font-size:0.8125rem;cursor:pointer;">
      &#8592; Back to meetings
    </button>
    <div style="font-size:0.9rem;font-weight:600;color:#e5e7eb;margin-bottom:4px;">${m.venue} <span style="font-size:0.7rem;color:#9ca3af;">(${m.state})</span></div>
    <div style="font-size:0.75rem;color:#facc15;margin-bottom:16px;">${m.date}</div>
    <div id="ra-modal-race-status" style="color:#9ca3af;font-size:0.875rem;">Fetching races…</div>
  `;
  statusEl.textContent = '';
  feather.replace();

  try {
    const html = await fetchHtmlViaProxy(m.url.split('#')[0], 'ra-meeting-modal', false);
    const races = parseRAMeetingPage(html, m.url);

    const statusLine = document.getElementById('ra-modal-race-status');
    if (!races.length) {
      if (statusLine) statusLine.textContent = 'No races found for this meeting.';
      return;
    }
    if (statusLine) statusLine.remove();

    raScrapedRaces = races;

    // Also set the URL input so the existing flow still works
    const input = document.getElementById('ra-import-url');
    if (input) input.value = m.url;

    // Render race cards inside the modal
    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px;';

    races.forEach((race, idx) => {
      const card = document.createElement('div');
      card.style.cssText = 'cursor:pointer;border-radius:8px;padding:12px;border:1px solid rgba(75,85,99,0.5);background:rgba(31,41,55,0.9);transition:border-color 0.15s,background 0.15s;';
      card.onmouseover = () => { card.style.borderColor = '#facc15'; card.style.background = 'rgba(250,204,21,0.06)'; };
      card.onmouseout  = () => { card.style.borderColor = 'rgba(75,85,99,0.5)'; card.style.background = 'rgba(31,41,55,0.9)'; };
      card.innerHTML = `
        <div style="display:flex;align-items:flex-start;gap:10px;">
          <div style="flex-shrink:0;width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,#f59e0b,#d97706);display:flex;align-items:center;justify-content:center;font-weight:700;color:#111;font-size:0.875rem;">${race.raceNum}</div>
          <div style="flex:1;min-width:0;">
            <div style="font-weight:600;color:#f3f4f6;font-size:0.875rem;line-height:1.3;">${escHtml(race.name)}</div>
            <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:4px;">
              ${race.time     ? `<span style="font-size:0.7rem;color:#9ca3af;">${race.time}</span>` : ''}
              ${race.distance ? `<span style="font-size:0.7rem;color:#60a5fa;">${race.distance}</span>` : ''}
              ${race.prize    ? `<span style="font-size:0.7rem;color:#34d399;">${race.prize}</span>` : ''}
            </div>
            <div style="font-size:0.7rem;color:#6b7280;margin-top:2px;">${race.horses.length} runners</div>
          </div>
        </div>`;
      card.onclick = () => selectRARaceFromModal(idx);
      grid.appendChild(card);
    });

    contentEl.appendChild(grid);
  } catch (err) {
    const statusLine = document.getElementById('ra-modal-race-status');
    if (statusLine) statusLine.textContent = 'Error loading races: ' + err.message;
  }
}

window.reopenRAMeetingBrowser = function() {
  const contentEl = document.getElementById('ra-browser-content');
  const statusEl  = document.getElementById('ra-browser-status');
  if (raBrowserMeetingsCache) {
    contentEl.innerHTML = '';
    renderRAMeetingBrowser(raBrowserMeetingsCache, contentEl);
    statusEl.textContent = '';
    feather.replace();
  } else {
    openRAMeetingBrowser();
  }
};

function selectRARaceFromModal(idx) {
  closeRAMeetingBrowser();
  // Re-use the existing selectRARace logic
  window.selectRARace(idx);
}
