import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js';
import { getAuth, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js';
import { getFirestore, collection, getDocs, doc, getDoc, setDoc, updateDoc, writeBatch, query, where } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js';
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

  // User is authenticated and is admin - load dashboard
  await loadDashboardStats();
  await loadRacesList();
  AOS.init();
});

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

    const raceList = document.getElementById('race-list');
    const raceListMobile = document.getElementById('race-list-mobile');
    raceList.innerHTML = '';
    if (raceListMobile) raceListMobile.innerHTML = '';

    allRaces.forEach(race => {
      // Desktop list
      const li = document.createElement('li');
      li.textContent = race.name || 'Unnamed Race';
      li.onclick = () => selectRace(race.id);
      raceList.appendChild(li);

      // Mobile list
      if (raceListMobile) {
        const liMobile = document.createElement('li');
        liMobile.textContent = race.name || 'Unnamed Race';
        liMobile.onclick = () => {
          selectRace(race.id);
          toggleMobileSidebar();
        };
        raceListMobile.appendChild(liMobile);
      }
    });

    if (currentRaceId) {
      updateRaceSelection();
    }
  } catch (error) {
    console.error('Error loading races:', error);
    showNotification('Error loading races', 'error', 'race-notifications');
  }
}

function updateRaceSelection() {
  const raceItems = document.querySelectorAll('.race-sidebar li');
  raceItems.forEach(item => item.classList.remove('selected'));

  const selectedItems = Array.from(raceItems).filter(
    item => allRaces.find(r => r.name === item.textContent)?.id === currentRaceId
  );
  selectedItems.forEach(item => item.classList.add('selected'));
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
  document.getElementById('edit-race-type').value = race.type || '';

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
    <input type="number" placeholder="No" class="horse-no" style="width: 60px;">
    <input type="text" placeholder="Name" class="horse-name flex-1">
    <input type="text" placeholder="Trainer" class="horse-trainer" style="width: 120px;">
    <input type="text" placeholder="Jockey" class="horse-jockey" style="width: 120px;">
    <input type="number" placeholder="Barrier" class="horse-barrier" style="width: 80px;">
    <input type="text" placeholder="Weight" class="horse-weight" style="width: 80px;">
    <input type="text" placeholder="Silk Desc" class="horse-silk-desc" style="width: 100px;">
    <button type="button" onclick="this.parentElement.remove()" class="btn-danger">Remove</button>
  `;
  horsesList.appendChild(horseRow);
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
        <input type="number" placeholder="No" class="horse-no" value="${cols[0].trim()}" style="width: 60px;">
        <input type="text" placeholder="Name" class="horse-name flex-1" value="${cols[1].trim()}">
        <input type="text" placeholder="Trainer" class="horse-trainer" value="${cols[2].trim()}" style="width: 120px;">
        <input type="text" placeholder="Jockey" class="horse-jockey" value="${cols[3].trim()}" style="width: 120px;">
        <input type="number" placeholder="Barrier" class="horse-barrier" value="${cols[4].trim()}" style="width: 80px;">
        <input type="text" placeholder="Weight" class="horse-weight" value="${cols[5].trim()}" style="width: 80px;">
        <input type="text" placeholder="Silk Desc" class="horse-silk-desc" style="width: 100px;">
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
  const type = document.getElementById('race-type').value;

  // Collect horses
  const horses = {};
  document.querySelectorAll('#horses-list .horse-row').forEach((row, idx) => {
    const no = row.querySelector('.horse-no').value;
    const horseName = row.querySelector('.horse-name').value;
    const trainer = row.querySelector('.horse-trainer').value;
    const jockey = row.querySelector('.horse-jockey').value;
    const barrier = row.querySelector('.horse-barrier').value;
    const weight = row.querySelector('.horse-weight').value;
    const silkDesc = row.querySelector('.horse-silk-desc').value;

    if (horseName) {
      horses[idx] = {
        number: no || idx + 1,
        name: horseName,
        trainer,
        jockey,
        barrier,
        weight,
        silkDesc: silkDesc || ''
      };
    }
  });

  try {
    await addDoc(collection(db, 'races'), {
      name,
      date,
      time,
      distance,
      type,
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

async function updateRaceType() {
  if (!currentRaceId) return;
  const type = document.getElementById('edit-race-type').value;

  try {
    await updateDoc(doc(db, 'races', currentRaceId), { type });
    showNotification('Type updated', 'success', 'race-notifications');
  } catch (error) {
    showNotification('Error updating type', 'error', 'race-notifications');
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
      <td><input type="number" value="${horse.no}" data-field="no" data-idx="${idx}" style="width: 60px;"></td>
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
  console.log('toggleMobileSidebar called');
  const overlay = document.getElementById('mobile-sidebar-overlay');
  if (!overlay) {
    console.error('Mobile sidebar overlay not found');
    return;
  }
  
  overlay.classList.toggle('show');
  console.log('Sidebar show state:', overlay.classList.contains('show'));
  
  // When opening, sync the race list
  if (overlay.classList.contains('show')) {
    const raceListMobile = document.getElementById('race-list-mobile');
    const raceList = document.getElementById('race-list');
    
    if (raceListMobile && raceList) {
      // Clear and rebuild mobile list
      raceListMobile.innerHTML = '';
      
      allRaces.forEach(race => {
        const li = document.createElement('li');
        li.textContent = race.name || 'Unnamed Race';
        li.className = currentRaceId === race.id ? 'selected' : '';
        li.onclick = () => {
          selectRace(race.id);
          toggleMobileSidebar();
        };
        raceListMobile.appendChild(li);
      });
      console.log('Populated', allRaces.length, 'races in mobile list');
    }
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
window.updateRaceDate = updateRaceDate;
window.updateRaceTime = updateRaceTime;
window.updateRaceDistance = updateRaceDistance;
window.updateRaceType = updateRaceType;
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
        const items = list.querySelectorAll('li');
        
        items.forEach(item => {
          const text = item.textContent.toLowerCase();
          if (text.includes(searchTerm)) {
            item.style.display = '';
          } else {
            item.style.display = 'none';
          }
        });
      });
    }
  });
});

// Initialize on load
window.addEventListener('load', () => {
  feather.replace();
});
