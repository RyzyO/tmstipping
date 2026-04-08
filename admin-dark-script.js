import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js';
import { getAuth, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js';
import { getFirestore, collection, getDocs, doc, getDoc, setDoc, updateDoc, deleteDoc, writeBatch, query, where, addDoc, serverTimestamp, orderBy, limit } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js';
import { getDatabase, ref, get } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-database.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-functions.js';

// Initialize Firebase
const firebaseConfig = {
  apiKey: "AIzaSyCrgNrA4n62hg1U3ujZMRCOYcbLcwT77ZA",
  authDomain: "tmstipping.firebaseapp.com",
  projectId: "tmstipping",
  storageBucket: "tmstipping.appspot.com",
  messagingSenderId: "401677933527",
  appId: "1:401677933527:web:2312ad4ef69aef6551c992",
  measurementId: "G-GXLRCHV687"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const rtdb = getDatabase(app);
const functions = getFunctions(app, 'us-central1');

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
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    alert("You must be logged in.");
    window.location.href = "login.html";
    return;
  }

  // Check admin status in Realtime Database
  const adminRef = ref(rtdb, `users/${user.uid}/admin`);
  const snapshot = await get(adminRef);

  if (!snapshot.exists() || snapshot.val() !== true) {
    alert("You are not authorized to access this page.");
    window.location.href = "login.html";
    return;
  }

  applyCachedAdminStats();
  currentAdminUser = user;

  // User is authenticated and is admin - load dashboard
  await loadAllComps();
  await loadDashboardStats(selectedAdminCompId);
  await loadRacesList();
  await loadAdminNotifications();
  AOS.init();
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
  } catch (error) {
    localStorage.removeItem(ADMIN_STATS_CACHE_KEY);
  }
}

function saveAdminStatsToCache({ totalRaces, upcoming, fullyTipped, paidUsers }) {
  localStorage.setItem(
    ADMIN_STATS_CACHE_KEY,
    JSON.stringify({ totalRaces, upcoming, fullyTipped, paidUsers, updatedAt: Date.now() })
  );
}

// ============ DASHBOARD STATS ============
async function loadDashboardStats(compId = null) {
  try {
    let racesSnap;
    
    // If compId is provided, filter by that comp
    if (compId) {
      racesSnap = await getDocs(query(collection(db, 'races'), where('compId', '==', compId)));
    } else {
      racesSnap = await getDocs(collection(db, 'races'));
    }
    
    const races = racesSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    const now = DateTime.now().setZone('Australia/Sydney');
    const upcoming = races.filter(r => {
      const raceTime = DateTime.fromFormat(`${r.date} ${r.time}`, 'yyyy-MM-dd HH:mm').setZone('Australia/Sydney');
      return raceTime > now;
    }).length;

    let fullyTipped = 0;
    for (const race of races) {
      if (race.horses && Object.keys(race.horses).length > 0) {
        fullyTipped += 1;
      }
    }

    // Calculate paid users for this comp
    let paidUsers = 0;
    let feesCollected = 0;
    
    if (compId) {
      // Filter to users who joined this comp and have paid
      const joiningsSnap = await getDocs(
        query(
          collection(db, 'userCompJoinings'),
          where('compId', '==', compId),
          where('paymentStatus', '==', 'completed')
        )
      );
      paidUsers = joiningsSnap.size;
      
      // Calculate fees collected for this comp
      const compDoc = await getDoc(doc(db, 'comps', compId));
      if (compDoc.exists()) {
        const entryFee = compDoc.data().entryFee || 0;
        feesCollected = paidUsers * entryFee;
      }
    } else {
      // Multi-comp global logic: unique users with a completed joining
      const joiningsSnap = await getDocs(
        query(collection(db, 'userCompJoinings'), where('paymentStatus', '==', 'completed'))
      );
      const paidUserIds = new Set();
      joiningsSnap.forEach(joinDoc => {
        const joining = joinDoc.data();
        if (joining?.userId) paidUserIds.add(joining.userId);
      });
      paidUsers = paidUserIds.size;
    }

    document.getElementById('total-races').textContent = races.length;
    document.getElementById('upcoming-races').textContent = upcoming;
    document.getElementById('fully-tipped').textContent = fullyTipped;
    document.getElementById('paid-users').textContent = paidUsers;
    document.getElementById('fees-collected').textContent = feesCollected > 0 ? `$${feesCollected.toFixed(2)}` : '$0.00';

    saveAdminStatsToCache({
      totalRaces: races.length,
      upcoming,
      fullyTipped,
      paidUsers
    });
  } catch (error) {
    console.error('Error loading dashboard stats:', error);
  }
}

// ============ RACES LIST ============
async function loadRacesList() {
  try {
    const racesRef = collection(db, 'races');
    const racesSnap = await getDocs(racesRef);
    allRaces = racesSnap.docs.map(d => ({
      id: d.id,
      ...d.data()
    })).sort((a, b) => {
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

function renderRaceListByDate(racesByDate, sortedDates, listId) {
  const raceList = document.getElementById(listId);
  if (!raceList) return;
  
  raceList.innerHTML = '';

  sortedDates.forEach(date => {
    const races = racesByDate[date];
    
    // Create date group
    const dateGroup = document.createElement('div');
    dateGroup.className = 'date-group';
    
    // Format date nicely
    const dt = DateTime.fromFormat(date, 'yyyy-MM-dd').setZone('Australia/Sydney');
    const formattedDate = dt.toFormat('EEE, LLL d');
    
    // Create date header
    const dateHeader = document.createElement('div');
    dateHeader.className = 'date-header';
    dateHeader.innerHTML = `
      <span>${formattedDate}</span>
      <i data-feather="chevron-down" class="h-4 w-4 transition-transform"></i>
    `;
    
    // Create races container for this date
    const racesForDate = document.createElement('div');
    racesForDate.className = 'races-for-date';
    
    // Sort races by time (earliest to latest)
    const sortedRaces = races.sort((a, b) => {
      const aTime = a.time || '00:00';
      const bTime = b.time || '00:00';
      return aTime.localeCompare(bTime);
    });
    
    // Add race items
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
    
    // Toggle date group expansion
    dateHeader.onclick = () => {
      const isExpanded = racesForDate.classList.contains('show');
      racesForDate.classList.toggle('show');
      dateHeader.classList.toggle('expanded');
      const icon = dateHeader.querySelector('i');
      if (icon) {
        icon.style.transform = isExpanded ? 'rotate(0deg)' : 'rotate(180deg)';
      }
      feather.replace();
    };
    
    dateGroup.appendChild(dateHeader);
    dateGroup.appendChild(racesForDate);
    raceList.appendChild(dateGroup);
    
    // Auto-expand if race in this date is selected
    if (races.some(r => r.id === currentRaceId)) {
      racesForDate.classList.add('show');
      dateHeader.classList.add('expanded');
      const icon = dateHeader.querySelector('i');
      if (icon) {
        icon.style.transform = 'rotate(180deg)';
      }
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
    // Move race document to target comp
    await updateDoc(doc(db, 'races', currentRaceId), {
      compId: targetCompId
    });

    // Keep existing race tips aligned with moved race competition.
    const tipsSnap = await getDocs(query(collection(db, 'tips'), where('raceId', '==', currentRaceId)));
    const tipsBatch = writeBatch(db);
    tipsSnap.forEach(tipDoc => {
      tipsBatch.update(doc(db, 'tips', tipDoc.id), { compId: targetCompId });
    });
    if (!tipsSnap.empty) {
      await tipsBatch.commit();
    }

    // Refresh local race cache
    allRaces = allRaces.map(r => r.id === currentRaceId ? { ...r, compId: targetCompId } : r);

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

function addManualHorse() {
  const horsesList = document.getElementById('horses-list');
  const horseRow = document.createElement('div');
  horseRow.className = 'horse-row';
  horseRow.innerHTML = `
    <input type="text" placeholder="No" class="horse-no" style="width: 60px;">
    <input type="text" placeholder="Name" class="horse-name flex-1">
    <input type="text" placeholder="Trainer" class="horse-trainer" style="width: 120px;">
    <input type="text" placeholder="Jockey" class="horse-jockey" style="width: 120px;">
    <input type="number" placeholder="Barrier" class="horse-barrier" style="width: 80px;">
    <input type="text" placeholder="Weight" class="horse-weight" style="width: 80px;">
    <input type="text" placeholder="Silk ID" class="horse-silk-id" style="width: 100px;" readonly>
    <button type="button" onclick="this.parentElement.remove()" class="btn-danger">Remove</button>
  `;
  horsesList.appendChild(horseRow);
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
      horseRow.innerHTML = `
        <input type="text" placeholder="No" class="horse-no" value="${horse.number || idx + 1}" style="width: 60px;">
        <input type="text" placeholder="Name" class="horse-name flex-1" value="${horse.name}">
        <input type="text" placeholder="Trainer" class="horse-trainer" value="${horse.trainer}" style="width: 120px;">
        <input type="text" placeholder="Jockey" class="horse-jockey" value="${horse.jockey}" style="width: 120px;">
        <input type="number" placeholder="Barrier" class="horse-barrier" value="${safeBarrier}" style="width: 80px;">
        <input type="text" placeholder="Weight" class="horse-weight" value="${horse.weight}" style="width: 80px;">
        <input type="text" placeholder="Silk ID" class="horse-silk-id" value="" style="width: 100px;" readonly>
        <button type="button" onclick="this.parentElement.remove()" class="btn-danger">Remove</button>
      `;
      horsesList.appendChild(horseRow);
    });

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
  const normalized = targetUrl.replace(/^https?:\/\//i, '');
  if (preferRaw) {
    return [
      `https://corsproxy.io/?${encodeURIComponent(targetUrl)}`,
      `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`,
      `https://r.jina.ai/http://${normalized}`
    ];
  }

  return [
    `https://r.jina.ai/http://${normalized}`,
    `https://corsproxy.io/?${encodeURIComponent(targetUrl)}`,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`
  ];
}

async function fetchHtmlViaProxy(targetUrl, contextLabel, preferRaw = false, validator = null) {
  const proxyUrls = buildProxyUrls(targetUrl, preferRaw);
  let lastError = null;

  for (const proxyUrl of proxyUrls) {
    try {
      console.log(`[${contextLabel}] Trying proxy:`, proxyUrl);
      const response = await fetch(proxyUrl, { cache: 'no-store' });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const html = await response.text();
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
      horseRow.innerHTML = `
        <input type="text" placeholder="No" class="horse-no" value="${cols[0].trim()}" style="width: 60px;">
        <input type="text" placeholder="Name" class="horse-name flex-1" value="${cols[1].trim()}">
        <input type="text" placeholder="Trainer" class="horse-trainer" value="${cols[2].trim()}" style="width: 120px;">
        <input type="text" placeholder="Jockey" class="horse-jockey" value="${cols[3].trim()}" style="width: 120px;">
        <input type="number" placeholder="Barrier" class="horse-barrier" value="${(cols[4].trim().match(/\d+/)?.[0] || '')}" style="width: 80px;">
        <input type="text" placeholder="Weight" class="horse-weight" value="${cols[5].trim()}" style="width: 80px;">
        <input type="text" placeholder="Silk ID" class="horse-silk-id" style="width: 100px;" readonly>
        <button type="button" onclick="this.parentElement.remove()" class="btn-danger">Remove</button>
      `;
      horsesList.appendChild(horseRow);
    }
  });

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
    const silksId = row.querySelector('.horse-silk-id')?.value || '';

    if (horseName) {
      horses[idx] = {
        number: no || idx + 1,
        name: horseName,
        trainer,
        jockey,
        barrier,
        weight,
        silksId,
        amt: 0
      };
    }
  });

  try {
    await addDoc(collection(db, 'races'), {
      name,
      date,
      time,
      distance,
      preview,
      compId: selectedAdminCompId || 'default-comp',
      horses
    });

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
  const race = allRaces.find(r => r.id === currentRaceId);
  if (!race) return;

  const raceTime = DateTime.fromISO(race.dateTime).setZone('Australia/Sydney');
  const [y, m, d] = newDate.split('-');
  const updated = raceTime.set({ year: parseInt(y), month: parseInt(m), day: parseInt(d) });

  try {
    await updateDoc(doc(db, 'races', currentRaceId), {
      dateTime: updated.toISO()
    });
    showNotification('Date updated', 'success', 'race-notifications');
    await loadRacesList();
  } catch (error) {
    showNotification('Error updating date', 'error', 'race-notifications');
  }
}

async function updateRaceTime() {
  if (!currentRaceId) return;
  const newTime = document.getElementById('edit-race-time').value;
  const race = allRaces.find(r => r.id === currentRaceId);
  if (!race) return;

  const raceTime = DateTime.fromISO(race.dateTime).setZone('Australia/Sydney');
  const [h, m] = newTime.split(':');
  const updated = raceTime.set({ hour: parseInt(h), minute: parseInt(m) });

  try {
    await updateDoc(doc(db, 'races', currentRaceId), {
      dateTime: updated.toISO()
    });
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
    await updateDoc(doc(db, 'races', currentRaceId), { distance });
    showNotification('Distance updated', 'success', 'race-notifications');
  } catch (error) {
    showNotification('Error updating distance', 'error', 'race-notifications');
  }
}

async function updateRacePreview() {
  if (!currentRaceId) return;
  const preview = document.getElementById('edit-race-preview').value;

  try {
    await updateDoc(doc(db, 'races', currentRaceId), { preview });
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
          <button onclick="setSubstituteHorse('\'' + idx + '\')" class="btn-secondary" style="font-size: 0.75rem; padding: 6px 10px;">
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

  const inputs = btn.parentElement.parentElement.querySelectorAll('input');
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
    const raceRef = doc(db, 'races', currentRaceId);
    await updateDoc(raceRef, {
      [`horses.${idx}`]: {
        ...existingHorse,
        no: horseNumber,
        number: horseNumber,
        name,
        trainer,
        jockey,
        barrier,
        weight,
        silkDesc
      }
    });
    showNotification('Horse updated', 'success', 'race-notifications');
    await refreshCurrentRaceData();
  } catch (error) {
    showNotification('Error updating horse', 'error', 'race-notifications');
  }
}

async function refreshCurrentRaceData() {
  if (!currentRaceId) return;

  const raceSnap = await getDoc(doc(db, 'races', currentRaceId));
  if (!raceSnap.exists()) return;

  const updatedRace = { id: currentRaceId, ...raceSnap.data() };
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
    await updateDoc(doc(db, 'races', currentRaceId), { horses: race.horses });
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
    await updateDoc(doc(db, 'races', currentRaceId), { horses: race.horses });
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
  const newIdx = numericKeys.length ? String(Math.max(...numericKeys) + 1) : doc(collection(db, '_')).id;

  try {
    await updateDoc(doc(db, 'races', currentRaceId), {
      [`horses.${newIdx}`]: {
        no: String(numericKeys.length ? Number(newIdx) + 1 : ''),
        number: String(numericKeys.length ? Number(newIdx) + 1 : ''),
        name: '',
        trainer: '',
        jockey: '',
        barrier: '',
        weight: '',
        silkDesc: '',
        amt: 0,
        scratched: false,
        substitute: false
      }
    });

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
    const raceRef = doc(db, 'races', currentRaceId);
    const raceSnap = await getDoc(raceRef);
    if (!raceSnap.exists()) {
      showNotification('Race not found', 'error', 'race-notifications');
      return;
    }

    const race = raceSnap.data() || {};
    const horses = { ...(race.horses || {}) };
    const horseIds = Object.keys(horses);
    if (!horseIds.length) {
      showNotification('No horses in this race to recalculate', 'error', 'race-notifications');
      return;
    }

    // Reset all counters to zero before counting tips.
    horseIds.forEach(horseId => {
      horses[horseId] = {
        ...horses[horseId],
        amt: 0
      };
    });

    const tipsSnap = await getDocs(query(collection(db, 'tips'), where('raceId', '==', currentRaceId)));
    let countedTips = 0;

    tipsSnap.forEach(tipDoc => {
      const tip = tipDoc.data() || {};
      const horseId = tip?.horseId ? String(tip.horseId) : null;
      if (!horseId || !horses[horseId]) return;

      const currentAmt = Number(horses[horseId].amt || 0);
      horses[horseId].amt = (Number.isFinite(currentAmt) ? currentAmt : 0) + 1;
      countedTips += 1;
    });

    await updateDoc(raceRef, { horses });
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
    const raceRef = doc(db, 'races', currentRaceId);
    const raceSnap = await getDoc(raceRef);
    if (!raceSnap.exists()) {
      showNotification('Race not found', 'error', 'race-notifications');
      return;
    }

    const archiveRef = doc(db, 'deletedRaces', currentRaceId);
    await setDoc(archiveRef, {
      ...raceSnap.data(),
      originalRaceId: currentRaceId,
      deletedAt: serverTimestamp(),
      deletedBy: auth.currentUser?.uid || null,
      deletedFrom: 'admin-dark'
    });

    await deleteDoc(raceRef);

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
  const resultsRef = collection(db, 'results');
  const q = query(resultsRef, where('raceId', '==', currentRaceId));
  const snap = await getDocs(q);
  if (snap.docs.length > 0) {
    const result = snap.docs[0].data();
    const winnerIdx = result.winner?.idx || result.winningHorseId || '';
    const place1Idx = result.place1?.idx || result.place1HorseId || '';
    const place2Idx = result.place2?.idx || result.place2HorseId || '';

    if (winnerIdx) document.getElementById('winner-horse-id').value = winnerIdx;
    if (place1Idx) document.getElementById('place1-horse-id').value = place1Idx;
    if (place2Idx) document.getElementById('place2-horse-id').value = place2Idx;

    if (result.winner?.points || result.points) document.getElementById('winner-points').value = result.winner?.points || result.points;
    if (result.place1?.points || result.place1Points) document.getElementById('place1-points').value = result.place1?.points || result.place1Points;
    if (result.place2?.points || result.place2Points) document.getElementById('place2-points').value = result.place2?.points || result.place2Points;
  }
}

async function saveResults() {
  if (!currentRaceId) return;
  const race = allRaces.find(r => r.id === currentRaceId);
  if (!race) return;

  const winnerIdx = document.getElementById('winner-horse-id').value;
  const place1Idx = document.getElementById('place1-horse-id').value;
  const place2Idx = document.getElementById('place2-horse-id').value;
  const winnerPoints = parseFloat(document.getElementById('winner-points').value) || 10;
  const place1Points = parseFloat(document.getElementById('place1-points').value) || 5;
  const place2Points = parseFloat(document.getElementById('place2-points').value) || 2;

  try {
    const resultsRef = collection(db, 'results');
    const q = query(resultsRef, where('raceId', '==', currentRaceId));
    const snap = await getDocs(q);

    const winnerPoints = parseInt(document.getElementById('winner-points').value) || 10;
    const place1Points = parseInt(document.getElementById('place1-points').value) || 5;
    const place2Points = parseInt(document.getElementById('place2-points').value) || 2;

    const result = {
      raceId: currentRaceId,
      raceName: race.name,
      winner: winnerIdx ? { idx: winnerIdx, name: race.horses[winnerIdx].name, points: winnerPoints } : null,
      place1: place1Idx ? { idx: place1Idx, name: race.horses[place1Idx].name, points: place1Points } : null,
      place2: place2Idx ? { idx: place2Idx, name: race.horses[place2Idx].name, points: place2Points } : null,
      // Canonical fields used by dark-mode pages and admin-script.js
      winningHorseId: winnerIdx || null,
      place1HorseId: place1Idx || null,
      place2HorseId: place2Idx || null,
      points: winnerPoints,
      place1Points: place1Points,
      place2Points: place2Points,
      createdAt: new Date().toISOString()
    };

    await setDoc(doc(db, 'results', currentRaceId), result, { merge: true });

    // Recalculate points for this competition only
    await calculateAndSaveLeaderboard(race.compId || selectedAdminCompId || null);

    // Refresh dashboard cards after leaderboard update
    await loadDashboardStats(selectedAdminCompId);

    showNotification('Results saved and leaderboard updated!', 'success', 'race-notifications');
  } catch (error) {
    console.error('Error saving results:', error);
    showNotification('Error saving results: ' + error.message, 'error', 'race-notifications');
  }
}

async function calculateAndSaveLeaderboard(compId) {
  try {
    const resultsRef = collection(db, 'results');
    const resultsSnap = await getDocs(resultsRef);
    const leaderboardMap = {};
    const compLeaderboardMap = {};

    const raceCompIdMap = {};
    allRaces.forEach(r => {
      raceCompIdMap[r.id] = r.compId || null;
    });

    for (const resultDoc of resultsSnap.docs) {
      const result = resultDoc.data();
      const raceId = result.raceId || resultDoc.id;
      const tipsRef = collection(db, 'tips');
      const tipsSnap = await getDocs(query(tipsRef, where('raceId', '==', raceId)));

      const winnerHorseId = result.winningHorseId || result.winner?.idx || null;
      const place1HorseId = result.place1HorseId || result.place1?.idx || null;
      const place2HorseId = result.place2HorseId || result.place2?.idx || null;

      const winnerPoints = Number(result.points ?? result.winner?.points ?? 0) || 0;
      const place1Points = Number(result.place1Points ?? result.place1?.points ?? 0) || 0;
      const place2Points = Number(result.place2Points ?? result.place2?.points ?? 0) || 0;

      tipsSnap.docs.forEach(tipDoc => {
        const tip = tipDoc.data();
        const userId = tip.userId;
        const compId = tip.compId || raceCompIdMap[raceId] || selectedAdminCompId || 'default-comp';

        if (!leaderboardMap[userId]) {
          leaderboardMap[userId] = { userId, points: 0, wins: 0 };
        }

        if (!compLeaderboardMap[compId]) {
          compLeaderboardMap[compId] = {};
        }
        if (!compLeaderboardMap[compId][userId]) {
          compLeaderboardMap[compId][userId] = { userId, points: 0, wins: 0 };
        }

        let points = 0;
        let wasWin = false;
        if (winnerHorseId && tip.horseId == winnerHorseId) {
          points += winnerPoints;
          wasWin = true;
        } else if (place1HorseId && tip.horseId == place1HorseId) {
          points += place1Points;
        } else if (place2HorseId && tip.horseId == place2HorseId) {
          points += place2Points;
        }

        if (points > 0 && tip.joker === true) {
          points *= 2;
        }

        leaderboardMap[userId].points += points;
        if (wasWin) leaderboardMap[userId].wins += 1;

        compLeaderboardMap[compId][userId].points += points;
        if (wasWin) compLeaderboardMap[compId][userId].wins += 1;
      });
    }

    const leaderboardRef = collection(db, 'leaderboard');
    const legacyBatch = writeBatch(db);

    Object.values(leaderboardMap).forEach(entry => {
      legacyBatch.set(doc(leaderboardRef, entry.userId), entry, { merge: true });
    });

    await legacyBatch.commit();

    // Update per-comp standings used by dark-mode leaderboard/profile pages.
    const compBatch = writeBatch(db);

    Object.entries(compLeaderboardMap).forEach(([compId, usersMap]) => {
      const entries = Object.values(usersMap).sort((a, b) => {
        if (b.points !== a.points) return b.points - a.points;
        return b.wins - a.wins;
      });

      let lastPoints = null;
      let lastWins = null;
      let lastRank = 0;

      entries.forEach((entry, idx) => {
        const rank = (entry.points === lastPoints && entry.wins === lastWins) ? lastRank : idx + 1;
        lastPoints = entry.points;
        lastWins = entry.wins;
        lastRank = rank;

        const joiningRef = doc(db, 'userCompJoinings', `${entry.userId}_${compId}`);
        compBatch.set(joiningRef, {
          userId: entry.userId,
          compId,
          points: entry.points,
          wins: entry.wins,
          rank,
          updatedAt: serverTimestamp()
        }, { merge: true });
      });
    });

    await compBatch.commit();
  } catch (error) {
    console.error('Error calculating leaderboard:', error);
  }
}

// ============ TIPS DISPLAY ============
async function loadRaceTips(race) {
  try {
    const tipsRef = collection(db, 'tips');
    const q = query(tipsRef, where('raceId', '==', currentRaceId));
    const tipsSnap = await getDocs(q);

    document.getElementById('race-tips-count').textContent = tipsSnap.size;

    const tipsList = document.getElementById('tips-list');
    tipsList.innerHTML = '';

    const paidUsersSet = new Set();
    const activeCompId = race?.compId || selectedAdminCompId || null;
    let joiningsSnap;

    if (activeCompId) {
      joiningsSnap = await getDocs(
        query(
          collection(db, 'userCompJoinings'),
          where('compId', '==', activeCompId),
          where('paymentStatus', '==', 'completed')
        )
      );
    } else {
      joiningsSnap = await getDocs(
        query(collection(db, 'userCompJoinings'), where('paymentStatus', '==', 'completed'))
      );
    }

    joiningsSnap.docs.forEach(joinDoc => {
      const joining = joinDoc.data();
      if (joining?.userId) paidUsersSet.add(joining.userId);
    });

    let paidTipsCount = 0;

    for (const tipDoc of tipsSnap.docs) {
      const tip = tipDoc.data();
      const isPaid = paidUsersSet.has(tip.userId);
      if (isPaid) paidTipsCount++;

      const horse = race.horses?.[tip.horseId];
      const horseNumber = horse?.no ?? horse?.number ?? '—';
      const userSnap = await getDoc(doc(db, 'users', tip.userId));
      const userName = userSnap.data()?.name || 'Unknown User';

      const tipEl = document.createElement('div');
      tipEl.className = `bg-gray-700 p-3 rounded text-sm ${isPaid ? 'border-l-4 border-yellow-400' : ''}`;
      tipEl.innerHTML = `
        <div class="flex justify-between">
          <span class="font-semibold">${userName}</span>
          ${isPaid ? '<span class="text-yellow-400 text-xs">PAID</span>' : ''}
        </div>
        <div class="text-gray-300">
          ${horse ? `${horseNumber} - ${horse.name}` : 'Unknown Horse'}
        </div>
      `;
      tipsList.appendChild(tipEl);
    }

    document.getElementById('race-tips-count').textContent = paidTipsCount;
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
    await signOut(auth);
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
    const compsSnap = await getDocs(collection(db, 'comps'));
    const select = document.getElementById('admin-comp-select');
    
    if (!select) return;
    
    // Clear existing options except the first one
    while (select.options.length > 1) {
      select.remove(1);
    }
    
    const comps = [];
    compsSnap.forEach(doc => {
      comps.push({ id: doc.id, ...doc.data() });
    });
    
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
      const statusBadge = comp.status === 'active' ? '🎯' : '✓';
      option.textContent = `${statusBadge} ${comp.name}`;
      select.appendChild(option);
    });

    // Default to first active comp so completed comps are never implicit defaults.
    const firstActiveComp = allComps.find(comp => comp.status === 'active') || null;
    if (firstActiveComp) {
      select.value = firstActiveComp.id;
      selectedAdminCompId = firstActiveComp.id;
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

  racePanel?.classList.add('hidden');
  noSelectionPanel?.classList.add('hidden');
  newRacePanel?.classList.add('hidden');
  compsPanel?.classList.add('hidden');
  notificationsPanel?.classList.add('hidden');
  
  if (tab === 'comps') {
    compsPanel?.classList.remove('hidden');
    loadCompsManagement();
  } else if (tab === 'notifications') {
    notificationsPanel?.classList.remove('hidden');
    populateAdminNotificationCompOptions();
    loadAdminNotifications();
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

  const usersSnap = await getDocs(collection(db, 'users'));
  notificationUsersCache = usersSnap.docs.map((docSnap) => {
    const data = docSnap.data() || {};
    return {
      id: docSnap.id,
      firstName: data.firstName || '',
      lastName: data.lastName || '',
      displayName: data.displayName || '',
      teamName: data.teamName || '',
      email: data.email || ''
    };
  });
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
    const snap = await getDocs(query(collection(db, 'notifications'), orderBy('createdAt', 'desc'), limit(30)));

    if (snap.empty) {
      listEl.innerHTML = '<div class="text-sm text-gray-400">No notifications sent yet.</div>';
      return;
    }

    listEl.innerHTML = '';
    snap.forEach((docSnap) => {
      const n = docSnap.data() || {};
      const audience = n.audienceType === 'competition'
        ? `Comp: ${allComps.find(c => c.id === n.compId)?.name || n.compId || 'Unknown'}`
        : n.audienceType === 'user'
          ? `User: ${n.userDisplayName || n.userEmail || n.userId || 'Unknown'}`
          : 'All users';
      const when = n.createdAt?.toDate
        ? DateTime.fromJSDate(n.createdAt.toDate()).setZone('Australia/Sydney').toFormat('EEE d LLL, h:mm a')
        : 'Pending...';

      const row = document.createElement('div');
      row.className = 'bg-gray-800 rounded-lg border border-gray-700 p-3';
      row.innerHTML = `
        <div class="flex items-start justify-between gap-3">
          <div>
            <div class="font-semibold text-gray-100">${n.title || 'Notification'}</div>
            <div class="text-sm text-gray-300 mt-1">${n.body || ''}</div>
            <div class="text-xs text-gray-500 mt-2">${audience}</div>
          </div>
          <div class="text-xs text-gray-500 whitespace-nowrap">${when}</div>
        </div>
      `;
      listEl.appendChild(row);
    });

    feather.replace();
  } catch (error) {
    console.error('Error loading admin notifications:', error);
    listEl.innerHTML = '<div class="text-sm text-red-300">Could not load notifications.</div>';
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

  try {
    const callSendAdminNotification = httpsCallable(functions, 'sendAdminNotification');
    await callSendAdminNotification({
      title,
      body,
      audienceType: targetUser ? 'user' : (compId ? 'competition' : 'all'),
      compId: compId || null,
      userId: targetUser?.id || null,
      userDisplayName: targetUser ? formatNotificationUserLabel(targetUser) : null,
      userEmail: targetUser?.email || null
    });

    titleInput.value = '';
    bodyInput.value = '';
    compSelect.value = '';
    window.clearNotificationUserSelection();

    showNotification('Notification sent', 'success', 'admin-notification-status');
    await loadAdminNotifications();
  } catch (error) {
    console.error('Error sending admin notification:', error);
    showNotification('Failed to send notification', 'error', 'admin-notification-status');
  }
};

async function loadCompsManagement() {
  try {
    const compsSnap = await getDocs(collection(db, 'comps'));
    const comps = [];
    compsSnap.forEach(docSnap => {
      comps.push({ id: docSnap.id, ...docSnap.data() });
    });
    
    const metricsByCompId = {};
    await Promise.all(comps.map(async (comp) => {
      const [racesSnap, paidSnap] = await Promise.all([
        getDocs(query(collection(db, 'races'), where('compId', '==', comp.id))),
        getDocs(query(collection(db, 'userCompJoinings'), where('compId', '==', comp.id), where('paymentStatus', '==', 'completed')))
      ]);
      metricsByCompId[comp.id] = {
        racesCount: racesSnap.size,
        paidCount: paidSnap.size
      };
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
    const startDate = comp.startDate ? DateTime.fromISO(comp.startDate).toFormat('MMM d, yyyy') : 'N/A';
    const endDate = comp.endDate ? DateTime.fromISO(comp.endDate).toFormat('MMM d, yyyy') : 'N/A';
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

    const card = document.createElement('div');
    card.className = 'card rounded-lg p-6';
    card.innerHTML = `
      <div class="flex justify-between items-start mb-4 gap-4">
        <div>
          <h3 class="text-lg font-bold text-gray-100">${comp.name}</h3>
          <p class="text-xs text-gray-500 mt-1">ID: ${comp.id}</p>
          <p class="text-sm text-gray-400 mt-2">${comp.description || 'No description'}</p>
        </div>
        ${statusMeta.badge}
      </div>
      <div class="grid grid-cols-2 md:grid-cols-6 gap-4 mb-4 py-4 border-t border-b border-gray-700">
        <div>
          <p class="text-xs text-gray-500">Entry Fee</p>
          <p class="text-lg font-semibold text-yellow-400">$${(comp.entryFee || 0).toFixed(2)}</p>
        </div>
        <div>
          <p class="text-xs text-gray-500">Prize Pool</p>
          <p class="text-lg font-semibold text-green-400">$${(comp.prizePool || 0).toFixed(2)}</p>
        </div>
        <div>
          <p class="text-xs text-gray-500">Participants</p>
          <p class="text-lg font-semibold">${paidCount}/${comp.maxParticipants || 1000}</p>
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
    const existing = await getDoc(doc(db, 'comps', candidate));
    if (!existing.exists()) {
      return candidate;
    }
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
  document.getElementById('comp-form-container').classList.remove('hidden');
  document.getElementById('form-title').textContent = 'Create New Competition';
  document.getElementById('comp-form').reset();
  document.getElementById('comp-id').value = 'auto-generated';
  document.getElementById('comp-status').value = 'active';
};

window.cancelCompForm = function() {
  document.getElementById('comp-form-container').classList.add('hidden');
  document.getElementById('comp-form').reset();
};

window.editCompetition = async function(compId) {
  try {
    const compSnap = await getDoc(doc(db, 'comps', compId));
    if (!compSnap.exists()) {
      showNotification('Competition not found', 'error', 'comp-notifications');
      return;
    }

    const comp = compSnap.data();
    document.getElementById('form-title').textContent = `Edit: ${comp.name}`;
    document.getElementById('comp-form-container').classList.remove('hidden');
    
    // Fill form
    document.getElementById('comp-name').value = comp.name;
    document.getElementById('comp-status').value = comp.status;
    document.getElementById('comp-fee').value = comp.entryFee || 0;
    document.getElementById('comp-prize').value = comp.prizePool || 0;
    document.getElementById('comp-start').value = comp.startDate.split('T')[0];
    document.getElementById('comp-end').value = comp.endDate.split('T')[0];
    document.getElementById('comp-description').value = comp.description || '';
    document.getElementById('comp-max-participants').value = comp.maxParticipants || 1000;
    document.getElementById('comp-id').value = compId;
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
      entryFee: parseFloat(document.getElementById('comp-fee').value) || 0,
      prizePool: parseFloat(document.getElementById('comp-prize').value) || 0,
      startDate: startDateRaw ? `${startDateRaw}T00:00:00Z` : '',
      endDate: endDateRaw ? `${endDateRaw}T23:59:59Z` : '',
      description: document.getElementById('comp-description').value.trim(),
      maxParticipants: parseInt(document.getElementById('comp-max-participants').value) || 1000,
      participantCount: isNew ? 0 : undefined,
      updatedAt: serverTimestamp()
    };

    const validationError = validateCompetitionData(compData, isNew);
    if (validationError) {
      showNotification(validationError, 'error', 'comp-notifications');
      return;
    }

    // Generate unique slug from name for new competitions.
    const finalCompId = isNew ? await generateUniqueCompId(compData.name) : compId;

    if (isNew) {
      compData.createdAt = serverTimestamp();
      compData.participantCount = 0;
      await setDoc(doc(db, 'comps', finalCompId), compData);
      showNotification(`Competition "${compData.name}" created successfully!`, 'success', 'comp-notifications');
    } else {
      delete compData.participantCount;
      await updateDoc(doc(db, 'comps', compId), compData);
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
    const racesSnap = await getDocs(query(collection(db, 'races'), where('compId', '==', compId)));
    if (!confirm(`Archive this competition?${racesSnap.size ? `\n\nThis comp currently has ${racesSnap.size} race(s).` : ''}`)) {
      return;
    }

    await updateDoc(doc(db, 'comps', compId), { status: 'deleted' });
    showNotification('Competition archived', 'success', 'comp-notifications');
    await loadCompsManagement();
    await loadAllComps();
    await loadDashboardStats(selectedAdminCompId);
  } catch (error) {
    console.error('Error deleting competition:', error);
    showNotification('Error deleting competition', 'error', 'comp-notifications');
  }
}

window.restoreCompetition = async function(compId) {
  if (!confirm('Restore this competition as closed?')) {
    return;
  }

  try {
    await updateDoc(doc(db, 'comps', compId), { status: 'closed', updatedAt: serverTimestamp() });
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
