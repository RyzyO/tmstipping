import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js';
import { getAuth, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js';
import { getFirestore, collection, getDocs, doc, getDoc, setDoc, updateDoc, writeBatch, query, where, addDoc } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js';
import { getDatabase, ref, get } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-database.js';

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

// Global State
let currentRaceId = null;
let allRaces = [];
let currentTab = 'details';
let racesByDateCache = {};
let sortedDatesCache = [];

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

  // User is authenticated and is admin - load dashboard
  await loadDashboardStats();
  await loadRacesList();
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
async function loadDashboardStats() {
  try {
    const racesRef = collection(db, 'races');
    const racesSnap = await getDocs(racesRef);
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

    const usersRef = collection(db, 'users');
    const usersSnap = await getDocs(query(usersRef, where('isPaid', '==', true)));
    const paidUsers = usersSnap.size;

    document.getElementById('total-races').textContent = races.length;
    document.getElementById('upcoming-races').textContent = upcoming;
    document.getElementById('fully-tipped').textContent = fullyTipped;
    document.getElementById('paid-users').textContent = paidUsers;

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
  document.getElementById('race-details-panel').classList.remove('hidden');

  // Populate fields
  document.getElementById('selected-race-title').textContent = race.name || 'Race';
  document.getElementById('edit-race-date').value = race.date || '';
  document.getElementById('edit-race-time').value = race.time || '';
  document.getElementById('edit-race-distance').value = race.distance || '';
  document.getElementById('edit-race-preview').value = race.preview || '';

  // Load horses
  await loadRaceHorses(race);

  // Load tips count
  await loadRaceTips(race);

  // Reset tab
  switchTab('details');
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
      const horseRow = document.createElement('div');
      horseRow.className = 'horse-row';
      horseRow.innerHTML = `
        <input type="text" placeholder="No" class="horse-no" value="${horse.number || idx + 1}" style="width: 60px;">
        <input type="text" placeholder="Name" class="horse-name flex-1" value="${horse.name}">
        <input type="text" placeholder="Trainer" class="horse-trainer" value="${horse.trainer}" style="width: 120px;">
        <input type="text" placeholder="Jockey" class="horse-jockey" value="${horse.jockey}" style="width: 120px;">
        <input type="number" placeholder="Barrier" class="horse-barrier" value="${horse.barrier}" style="width: 80px;">
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

async function scrapeSilksFromUrl() {
  console.log('[scrapeSilksFromUrl] Starting...');
  const url = document.getElementById('race-silks-url').value;
  console.log('[scrapeSilksFromUrl] URL input:', url);
  
  if (!url) {
    console.warn('[scrapeSilksFromUrl] No URL provided');
    showNotification('Please enter a RacingNSW URL', 'error', 'form-notifications');
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
    const proxyUrl = `https://corsproxy.io/?url=${encodeURIComponent(url)}`;
    console.log('[scrapeSilksFromUrl] Proxy URL:', proxyUrl);
    
    const response = await fetch(proxyUrl);
    console.log('[scrapeSilksFromUrl] Fetch response status:', response.status);

    if (!response.ok) {
      throw new Error('Failed to fetch RacingNSW URL');
    }

    const html = await response.text();
    console.log('[scrapeSilksFromUrl] HTML length:', html.length);
    
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    console.log('[scrapeSilksFromUrl] HTML parsed');

    const runnerLinks = Array.from(doc.querySelectorAll("a[onclick*='HorseFullForm.aspx']"));
    console.log('[scrapeSilksFromUrl] Found', runnerLinks.length, 'runner links');
    
    const runnerEntries = runnerLinks.map(link => {
      const row = link.closest('tr');
      const number = extractHorseNumberFromRow(row);
      const name = (link.textContent || '').trim();
      const onclick = link.getAttribute('onclick') || '';
      const match = onclick.match(/newPopup\('([^']*HorseFullForm\.aspx[^']*)'\)/i);
      const path = match ? match[1] : '';
      console.log('[scrapeSilksFromUrl] Runner - Name:', name, 'Number:', number, 'Path found:', !!path);
      return { name, number, path };
    }).filter(entry => entry.path);

    console.log('[scrapeSilksFromUrl] Filtered to', runnerEntries.length, 'runners with paths');

    if (runnerEntries.length === 0) {
      console.warn('[scrapeSilksFromUrl] No valid runner entries found');
      showNotification('No runner links found on this page.', 'error', 'form-notifications');
      return;
    }

    const { byNumber, byName } = buildHorseRowIndex();
    console.log('[scrapeSilksFromUrl] Built horse index - by number:', byNumber.size, 'by name:', byName.size);
    
    let updated = 0;
    let missing = 0;

    for (const entry of runnerEntries) {
      console.log('[scrapeSilksFromUrl] Processing runner:', entry.name);
      
      const fullUrl = new URL(entry.path, 'https://racing.racingnsw.com.au').href;
      console.log('[scrapeSilksFromUrl] Full URL:', fullUrl);
      
      const runnerProxyUrl = `https://corsproxy.io/?url=${encodeURIComponent(fullUrl)}`;

      const runnerResponse = await fetch(runnerProxyUrl);
      console.log('[scrapeSilksFromUrl] Runner page fetch status:', runnerResponse.status);
      
      if (!runnerResponse.ok) {
        console.warn('[scrapeSilksFromUrl] Failed to fetch runner page for:', entry.name);
        missing += 1;
        continue;
      }

      const runnerHtml = await runnerResponse.text();
      console.log('[scrapeSilksFromUrl] Runner HTML length:', runnerHtml.length);
      
      const silkMatch = runnerHtml.match(/JockeySilks\/(\d+)\.png/i);
      console.log('[scrapeSilksFromUrl] Silk ID found:', silkMatch ? silkMatch[1] : 'null');
      
      if (!silkMatch) {
        console.warn('[scrapeSilksFromUrl] No silk ID found for:', entry.name);
        missing += 1;
        continue;
      }

      const silksId = silkMatch[1];
      const normalizedName = normalizeHorseName(entry.name);
      console.log('[scrapeSilksFromUrl] Looking for horse with normalized name:', normalizedName);
      
      const row = normalizedName && byName.get(normalizedName);
      console.log('[scrapeSilksFromUrl] Horse row found:', !!row);

      if (!row) {
        console.warn('[scrapeSilksFromUrl] No matching horse row for:', entry.name);
        missing += 1;
        continue;
      }

      const silkIdInput = row.querySelector('.horse-silk-id');
      console.log('[scrapeSilksFromUrl] Silk ID input element found:', !!silkIdInput);
      
      if (silkIdInput) {
        silkIdInput.value = silksId;
        console.log('[scrapeSilksFromUrl] Set silksId:', silksId, 'for horse:', entry.name);
        showNotification(`Silk found: ${entry.name} (ID: ${silksId})`, 'success', 'form-notifications');
        updated += 1;
      } else {
        console.warn('[scrapeSilksFromUrl] No silk ID input element for:', entry.name);
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

function extractHorsesFromText(rawText) {
  let text = rawText || '';
  if (text.includes('<html') || text.includes('<table') || text.includes('<body')) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(text, 'text/html');
    text = doc.body ? doc.body.innerText : text;
  }

  const lines = text.split('\n').map(line => line.trim()).filter(Boolean);
  const horses = [];
  const cleanCell = (value) => value.replace(/~~|\*\*/g, '').replace(/\s+/g, ' ').trim();
  const normalizeNumber = (value) => {
    const match = value.match(/^(\d+)([a-z])?/i);
    if (!match) {
      return value;
    }
    return `${match[1]}${match[2] ? match[2].toLowerCase() : ''}`;
  };

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
        const barrier = cleanCell(cells[i + 4] || '');
        const weight = cleanCell(cells[i + 5] || '').replace(/\s+/g, '');

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
      const name = tokens[i + 1] || '';
      const trainer = tokens[i + 2] || '';
      const jockey = tokens[i + 3] || '';
      const barrier = tokens[i + 4] || '';
      const weight = tokens[i + 5] || '';

      horses.push({
        number,
        name,
        trainer,
        jockey,
        barrier,
        weight: weight.replace(/\s+/g, ''),
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
    const name = match[2].trim();
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
        jockey = jMatch[1].trim();
      }

      const tMatch = nextLine.match(/^T[:]?\s*(.+)$/i);
      if (tMatch) {
        trainer = tMatch[1].trim();
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
        <input type="number" placeholder="Barrier" class="horse-barrier" value="${cols[4].trim()}" style="width: 80px;">
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
        silksId
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

  Object.entries(race.horses).forEach(([idx, horse]) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><input type="text" value="${horse.no}" data-field="no" data-idx="${idx}" style="width: 60px;"></td>
      <td><input type="text" value="${horse.name}" data-field="name" data-idx="${idx}"></td>
      <td><input type="text" value="${horse.trainer || ''}" data-field="trainer" data-idx="${idx}"></td>
      <td><input type="text" value="${horse.jockey || ''}" data-field="jockey" data-idx="${idx}"></td>
      <td><input type="text" value="${horse.barrier || ''}" data-field="barrier" data-idx="${idx}"></td>
      <td><input type="text" value="${horse.weight || ''}" data-field="weight" data-idx="${idx}"></td>
      <td><input type="text" value="${horse.silkDesc || ''}" data-field="silkDesc" data-idx="${idx}"></td>
      <td>
        <button onclick="saveHorseChange(this)" class="btn-secondary" style="font-size: 0.75rem; padding: 6px 10px;">Save</button>
      </td>
    `;
    horsesList.appendChild(tr);
  });
}

async function saveHorseChange(btn) {
  if (!currentRaceId) return;

  const inputs = btn.parentElement.parentElement.querySelectorAll('input');
  const idx = inputs[0].dataset.idx;
  const no = inputs[0].value;
  const name = inputs[1].value;
  const trainer = inputs[2].value;
  const jockey = inputs[3].value;
  const barrier = inputs[4].value;
  const weight = inputs[5].value;
  const silkDesc = inputs[6].value;

  try {
    const raceRef = doc(db, 'races', currentRaceId);
    await updateDoc(raceRef, {
      [`horses.${idx}`]: { no, name, trainer, jockey, barrier, weight, silkDesc }
    });
    showNotification('Horse updated', 'success', 'race-notifications');
  } catch (error) {
    showNotification('Error updating horse', 'error', 'race-notifications');
  }
}

async function addHorseToRace() {
  if (!currentRaceId) return;

  const race = allRaces.find(r => r.id === currentRaceId);
  const horses = race.horses || {};
  const newIdx = Math.max(...Object.keys(horses).map(Number), -1) + 1;

  try {
    await updateDoc(doc(db, 'races', currentRaceId), {
      [`horses.${newIdx}`]: { no: newIdx + 1, name: '', trainer: '', jockey: '', barrier: '', weight: '', silkDesc: '' }
    });

    const raceSnap = await getDoc(doc(db, 'races', currentRaceId));
    await loadRaceHorses(raceSnap.data());
    showNotification('Horse added', 'success', 'race-notifications');
  } catch (error) {
    showNotification('Error adding horse', 'error', 'race-notifications');
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
      const option = document.createElement('option');
      option.value = idx;
      option.textContent = `${horse.no} - ${horse.name}`;
      select.appendChild(option);
    });
  });

  // Load existing results if any
  const resultsRef = collection(db, 'results');
  const q = query(resultsRef, where('raceId', '==', currentRaceId));
  const snap = await getDocs(q);
  if (snap.docs.length > 0) {
    const result = snap.docs[0].data();
    if (result.winner) document.getElementById('winner-horse-id').value = result.winner.idx || '';
    if (result.place1) document.getElementById('place1-horse-id').value = result.place1.idx || '';
    if (result.place2) document.getElementById('place2-horse-id').value = result.place2.idx || '';
    if (result.winner?.points) document.getElementById('winner-points').value = result.winner.points;
    if (result.place1?.points) document.getElementById('place1-points').value = result.place1.points;
    if (result.place2?.points) document.getElementById('place2-points').value = result.place2.points;
  }
}

async function saveResults() {
  if (!currentRaceId) return;
  const race = allRaces.find(r => r.id === currentRaceId);
  if (!race) return;

  const winnerIdx = document.getElementById('winner-horse-id').value;
  const place1Idx = document.getElementById('place1-horse-id').value;
  const place2Idx = document.getElementById('place2-horse-id').value;

  try {
    const resultsRef = collection(db, 'results');
    const q = query(resultsRef, where('raceId', '==', currentRaceId));
    const snap = await getDocs(q);

    const result = {
      raceId: currentRaceId,
      raceName: race.name,
      winner: winnerIdx ? { idx: winnerIdx, name: race.horses[winnerIdx].name, points: parseInt(document.getElementById('winner-points').value) || 10 } : null,
      place1: place1Idx ? { idx: place1Idx, name: race.horses[place1Idx].name, points: parseInt(document.getElementById('place1-points').value) || 5 } : null,
      place2: place2Idx ? { idx: place2Idx, name: race.horses[place2Idx].name, points: parseInt(document.getElementById('place2-points').value) || 2 } : null,
      createdAt: new Date().toISOString()
    };

    if (snap.docs.length > 0) {
      await updateDoc(snap.docs[0].ref, result);
    } else {
      await setDoc(doc(resultsRef), result);
    }

    // Calculate leaderboard
    await calculateAndSaveLeaderboard();

    showNotification('Results saved and leaderboard updated!', 'success', 'race-notifications');
  } catch (error) {
    console.error('Error saving results:', error);
    showNotification('Error saving results: ' + error.message, 'error', 'race-notifications');
  }
}

async function calculateAndSaveLeaderboard() {
  try {
    const resultsRef = collection(db, 'results');
    const resultsSnap = await getDocs(resultsRef);
    const leaderboardMap = {};

    resultsSnap.docs.forEach(doc => {
      const result = doc.data();
      const tipsRef = collection(db, 'tips');
      getDocs(query(tipsRef, where('raceId', '==', result.raceId))).then(tipsSnap => {
        tipsSnap.docs.forEach(tipDoc => {
          const tip = tipDoc.data();
          const userId = tip.userId;

          if (!leaderboardMap[userId]) {
            leaderboardMap[userId] = { userId, points: 0, wins: 0 };
          }

          if (tip.horseId == result.winner?.idx) {
            leaderboardMap[userId].points += result.winner.points;
            leaderboardMap[userId].wins += 1;
          } else if (tip.horseId == result.place1?.idx || tip.horseId == result.place2?.idx) {
            leaderboardMap[userId].points += 3;
          }
        });
      });
    });

    const leaderboardRef = collection(db, 'leaderboard');
    const batch = writeBatch(db);

    Object.values(leaderboardMap).forEach(entry => {
      batch.set(doc(leaderboardRef, entry.userId), entry, { merge: true });
    });

    await batch.commit();
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
    const usersRef = collection(db, 'users');
    const usersSnap = await getDocs(query(usersRef, where('isPaid', '==', true)));
    usersSnap.docs.forEach(doc => paidUsersSet.add(doc.id));

    let paidTipsCount = 0;

    for (const tipDoc of tipsSnap.docs) {
      const tip = tipDoc.data();
      const isPaid = paidUsersSet.has(tip.userId);
      if (isPaid) paidTipsCount++;

      const horse = race.horses?.[tip.horseId];
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
          ${horse ? `${horse.no} - ${horse.name}` : 'Unknown Horse'}
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
function switchTab(tabName) {
  currentTab = tabName;

  // Hide all tabs
  document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
  document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));

  // Show selected tab
  document.getElementById(`${tabName}-tab`)?.classList.remove('hidden');
  event.target.classList.add('active');

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
window.saveHorseChange = saveHorseChange;
window.addHorseToRace = addHorseToRace;
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
