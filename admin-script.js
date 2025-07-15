// Firebase setup
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import {
  getFirestore, collection, addDoc, doc, setDoc, getDocs,
  getDoc, updateDoc, deleteField, writeBatch
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import { getDatabase, ref, get } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-database.js";

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
const db = getFirestore(app);
const auth = getAuth(app);
const rtdb = getDatabase(app);

let racesCache = {};
let selectedRaceId = null;

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    alert("You must be logged in.");
    window.location.href = "index.html";
    return;
  }
  const adminRef = ref(rtdb, `users/${user.uid}/admin`);
  const snapshot = await get(adminRef);
  if (!snapshot.exists() || snapshot.val() !== true) {
    alert("You are not authorized to access this page.");
    window.location.href = "index.html";
  }
});

function addHorseRow(horse = {}) {
  const horsesList = document.getElementById('horses-list');
  const div = document.createElement('div');
  div.className = 'horse-row mb-2';
  div.innerHTML = `
    <input type="text" placeholder="No" class="form-control d-inline-block" style="width:60px;" value="${horse.number || ''}" required>
    <input type="text" placeholder="Horse Name" class="form-control d-inline-block" style="width:150px;" value="${horse.name || ''}" required>
    <input type="text" placeholder="Trainer" class="form-control d-inline-block" style="width:150px;" value="${horse.trainer || ''}">
    <input type="text" placeholder="Jockey" class="form-control d-inline-block" style="width:150px;" value="${horse.jockey || ''}">
    <input type="text" placeholder="Barrier" class="form-control d-inline-block" style="width:80px;" value="${horse.barrier || ''}">
    <input type="text" placeholder="Weight" class="form-control d-inline-block" style="width:80px;" value="${horse.weight || ''}">
    <button type="button" class="btn btn-danger btn-sm remove-horse-row">Remove</button>
  `;
  div.querySelector('.remove-horse-row').onclick = () => div.remove();
  horsesList.appendChild(div);
}

document.getElementById('parse-table-btn').onclick = () => {
  const text = document.getElementById('paste-table').value.trim();
  if (!text) return alert("Paste table data first.");

  const lines = text.split('\n').filter(line => line.trim() !== '');
  if (lines.length <= 1) return alert("Table must include at least one data row.");

  document.getElementById('horses-list').innerHTML = '';

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split('\t');
    if (cols.length >= 6) {
      const horse = {
        number: cols[0].trim(),
        name: cols[1].trim(),
        trainer: cols[2].trim(),
        jockey: cols[3].trim(),
        barrier: cols[4].trim(),
        weight: cols[5].trim()
      };
      addHorseRow(horse);
    }
  }
};

document.getElementById('race-form').onsubmit = async (e) => {
  e.preventDefault();
  const name = document.getElementById('race-name').value;
  const date = document.getElementById('race-date').value;
  const time = document.getElementById('race-time').value;
  const distance = document.getElementById('race-distance').value;

  const horses = {};
  document.querySelectorAll('#horses-list .horse-row').forEach(row => {
    const inputs = row.querySelectorAll('input');
    const horseId = doc(collection(db, '_')).id;
    horses[horseId] = {
      number: inputs[0].value,
      name: inputs[1].value,
      trainer: inputs[2].value,
      jockey: inputs[3].value,
      barrier: inputs[4].value,
      weight: inputs[5].value
    };
  });

  await addDoc(collection(db, 'races'), { name, date, time, distance, horses });
  document.getElementById('race-form-section').style.display = 'none';
  await loadRaces();
};

document.getElementById('save-results').onclick = async () => {
  const winnerId = document.getElementById('winner-horse-id').value.trim();
  const winnerPoints = parseInt(document.getElementById('winner-points').value);
  const place1Id = document.getElementById('place1-horse-id').value.trim();
  const place1Points = parseInt(document.getElementById('place1-points').value);
  const place2Id = document.getElementById('place2-horse-id').value.trim();
  const place2Points = parseInt(document.getElementById('place2-points').value);

  if (!winnerId || isNaN(winnerPoints) || !place1Id || isNaN(place1Points) || !place2Id || isNaN(place2Points)) {
    alert("All result fields must be completed.");
    return;
  }

  await setDoc(doc(db, 'results', selectedRaceId), {
    winningHorseId: winnerId,
    points: winnerPoints,
    place1HorseId: place1Id,
    place1Points: place1Points,
    place2HorseId: place2Id,
    place2Points: place2Points
  });

  alert("Results saved.");
};

document.getElementById('save-race-date').onclick = async () => {
  const newDate = document.getElementById('edit-race-date').value;
  if (!newDate) return;
  await updateDoc(doc(db, 'races', selectedRaceId), { date: newDate });
  await selectRace(selectedRaceId);
};

document.getElementById('save-race-time').onclick = async () => {
  const newTime = document.getElementById('edit-race-time').value;
  if (!newTime) return;
  await updateDoc(doc(db, 'races', selectedRaceId), { time: newTime });
  await selectRace(selectedRaceId);
};

document.getElementById('save-race-distance').onclick = async () => {
  const newDistance = document.getElementById('edit-race-distance').value;
  if (!newDistance) return;
  await updateDoc(doc(db, 'races', selectedRaceId), { distance: newDistance });
  await selectRace(selectedRaceId);
};

document.getElementById('add-horse-to-race').onclick = async () => {
  if (!selectedRaceId) return;
  const horseName = prompt("Horse name?");
  if (!horseName) return;
  const horseNumber = prompt("Horse number?");
  if (!horseNumber) return;

  const horseId = doc(collection(db, '_')).id;
  const raceRef = doc(db, 'races', selectedRaceId);
  const raceSnap = await getDoc(raceRef);
  const horses = raceSnap.data().horses || {};

  horses[horseId] = { name: horseName, number: horseNumber };
  await updateDoc(raceRef, { horses });
  await selectRace(selectedRaceId);
};

async function loadRaces() {
  const raceList = document.getElementById('race-list');
  raceList.innerHTML = '';
  const racesSnap = await getDocs(collection(db, 'races'));
  racesCache = {};

  racesSnap.forEach(docSnap => {
    const race = docSnap.data();
    racesCache[docSnap.id] = race;
    const li = document.createElement('li');
    li.textContent = `${race.name} (${race.date})`;
    li.dataset.raceId = docSnap.id;
    li.onclick = () => selectRace(docSnap.id);
    if (selectedRaceId === docSnap.id) li.classList.add('selected');
    raceList.appendChild(li);
  });
}

async function selectRace(raceId) {
  selectedRaceId = raceId;
  Array.from(document.querySelectorAll('#race-list li')).forEach(li => {
    li.classList.toggle('selected', li.dataset.raceId === raceId);
  });
  document.getElementById('race-form-section').style.display = 'none';
  document.getElementById('race-details-section').style.display = '';
  const raceDoc = await getDoc(doc(db, 'races', raceId));
  const race = raceDoc.data();

  document.getElementById('selected-race-title').textContent = race.name;
  document.getElementById('edit-race-date').value = race.date || '';
  document.getElementById('edit-race-time').value = race.time || '';
  document.getElementById('edit-race-distance').value = race.distance || '';

  renderHorsesList(race, raceId);
}

function renderHorsesList(race, raceId) {
  const horsesDiv = document.getElementById('selected-horses-list');
  horsesDiv.innerHTML = '';
  const horses = Object.entries(race.horses || {}).sort((a, b) => {
    return parseInt(a[1].number) - parseInt(b[1].number);
  });

  // Populate dropdowns for results
  const winnerSelect = document.getElementById('winner-horse-id');
  const place1Select = document.getElementById('place1-horse-id');
  const place2Select = document.getElementById('place2-horse-id');
  [winnerSelect, place1Select, place2Select].forEach(select => {
    select.innerHTML = '<option value="">Select horse</option>';
  });

  for (const [horseId, horse] of horses) {
    // Editable horse row
    const row = document.createElement('div');
    row.className = 'horse-row mb-2';
    row.innerHTML = `
      <input type="text" value="${horse.number}" placeholder="No" style="width:60px;">
      <input type="text" value="${horse.name}" placeholder="Name" style="width:150px;">
      <input type="text" value="${horse.trainer || ''}" placeholder="Trainer" style="width:150px;">
      <input type="text" value="${horse.jockey || ''}" placeholder="Jockey" style="width:150px;">
      <input type="text" value="${horse.barrier || ''}" placeholder="Barrier" style="width:80px;">
      <input type="text" value="${horse.weight || ''}" placeholder="Weight" style="width:80px;">
      <button class="btn btn-sm btn-outline-success">Save</button>
    `;
    row.querySelector('button').onclick = async () => {
      const inputs = row.querySelectorAll('input');
      const updatedHorse = {
        number: inputs[0].value,
        name: inputs[1].value,
        trainer: inputs[2].value,
        jockey: inputs[3].value,
        barrier: inputs[4].value,
        weight: inputs[5].value,
      };
      race.horses[horseId] = updatedHorse;
      await updateDoc(doc(db, 'races', raceId), { horses: race.horses });
      await selectRace(raceId);
    };
    horsesDiv.appendChild(row);

    // Add to dropdowns
    const option = new Option(`${horse.number} - ${horse.name}`, horseId);
    winnerSelect.appendChild(option.cloneNode(true));
    place1Select.appendChild(option.cloneNode(true));
    place2Select.appendChild(option.cloneNode(true));
  }
}

document.getElementById('new-race-btn').onclick = () => {
  selectedRaceId = null;
  document.getElementById('race-form-section').style.display = '';
  document.getElementById('race-details-section').style.display = 'none';
  document.getElementById('race-form').reset();
  document.getElementById('horses-list').innerHTML = '';
};

// Load races initially
loadRaces();