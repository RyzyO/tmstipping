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
  const winnerPoints = parseFloat(document.getElementById('winner-points').value);
  const place1Id = document.getElementById('place1-horse-id').value.trim();
  const place1Points = parseFloat(document.getElementById('place1-points').value);
  const place2Id = document.getElementById('place2-horse-id').value.trim();
  const place2Points = parseFloat(document.getElementById('place2-points').value);

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

await calculateAndSaveLeaderboard(); // ✅ safe, scoped, and correct

alert("Results saved.");

}

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

  // Collect races into array with id for sorting
  const racesArr = [];
  racesSnap.forEach(docSnap => {
    const race = docSnap.data();
    racesArr.push({ id: docSnap.id, ...race });
    racesCache[docSnap.id] = race;
  });

  // Sort by date and time (soonest first)
  racesArr.sort((a, b) => {
    const aDateTime = new Date(`${a.date}T${a.time}`);
    const bDateTime = new Date(`${b.date}T${b.time}`);
    return aDateTime - bDateTime;
  });

  for (const race of racesArr) {
    const li = document.createElement('li');
    li.textContent = `${race.name} (${race.date})`;
    li.dataset.raceId = race.id;
    li.onclick = () => selectRace(race.id);
    if (selectedRaceId === race.id) li.classList.add('selected');
    raceList.appendChild(li);
  }
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
    return parseFloat(a[1].number) - parseFloat(b[1].number);
  });

  // Find current substitute horseId (if any)
  let substituteHorseId = null;
  for (const [horseId, horse] of Object.entries(race.horses || {})) {
    if (horse.substitute) substituteHorseId = horseId;
  }

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
      ${horse.scratched ? '<span style="color:red;font-weight:bold;margin-left:8px;">SCRATCHED</span>' : `<button class="btn btn-sm btn-outline-danger scratch-horse-btn" style="margin-left:8px;">Scratch</button>`}
      <button class="btn btn-sm btn-outline-warning substitute-horse-btn" style="margin-left:8px;" ${horse.substitute ? 'disabled' : ''}>${horse.substitute ? 'Substitute (Current)' : 'Substitute'}</button>
      ${horse.substitute ? '<span style="color:orange;font-weight:bold;margin-left:8px;">SUB</span>' : ''}
    `;
    row.querySelector('button.btn-outline-success').onclick = async () => {
      const inputs = row.querySelectorAll('input');
      const updatedHorse = {
        number: inputs[0].value,
        name: inputs[1].value,
        trainer: inputs[2].value,
        jockey: inputs[3].value,
        barrier: inputs[4].value,
        weight: inputs[5].value,
        scratched: !!horse.scratched,
        substitute: !!horse.substitute
      };
      race.horses[horseId] = updatedHorse;
      await updateDoc(doc(db, 'races', raceId), { horses: race.horses });
      await selectRace(raceId);
    };
    // Add scratch handler if not already scratched
    if (!horse.scratched) {
      row.querySelector('.scratch-horse-btn').onclick = async () => {
        race.horses[horseId].scratched = true;
        await updateDoc(doc(db, 'races', raceId), { horses: race.horses });
        await selectRace(raceId);
      };
    }
    // Substitute handler
    row.querySelector('.substitute-horse-btn').onclick = async () => {
      // Remove substitute from all horses
      for (const [hId, h] of Object.entries(race.horses)) {
        if (h.substitute) delete h.substitute;
      }
      race.horses[horseId].substitute = true;
      await updateDoc(doc(db, 'races', raceId), { horses: race.horses });
      await selectRace(raceId);
    };
    horsesDiv.appendChild(row);

    // Add to dropdowns only if not scratched
    if (!horse.scratched) {
      const option = new Option(`${horse.number} - ${horse.name}`, horseId);
      winnerSelect.appendChild(option.cloneNode(true));
      place1Select.appendChild(option.cloneNode(true));
      place2Select.appendChild(option.cloneNode(true));
    }
  }
}

document.getElementById('new-race-btn').onclick = () => {
  selectedRaceId = null;
  document.getElementById('race-form-section').style.display = '';
  document.getElementById('race-details-section').style.display = 'none';
  document.getElementById('race-form').reset();
  document.getElementById('horses-list').innerHTML = '';
};
async function calculateAndSaveLeaderboard() {
  const userPoints = {};
  const userNames = {};
  const userWinners = {};

  // Load all users
  const usersSnap = await getDocs(collection(db, "users"));
  usersSnap.forEach(docSnap => {
    const data = docSnap.data();
    userPoints[docSnap.id] = 0;
    userNames[docSnap.id] = data.teamName || `${data.firstName || ''} ${data.lastName || ''}`.trim() || data.email || docSnap.id;
    userWinners[docSnap.id] = 0;
  });

  // Load race results
  const resultsSnap = await getDocs(collection(db, "results"));
  const raceWinners = {};
  resultsSnap.forEach(docSnap => {
    const data = docSnap.data();
    if (data.winningHorseId && data.points) {
      raceWinners[docSnap.id] = {
        winner: { horseId: data.winningHorseId, points: data.points },
        place1: { horseId: data.place1HorseId, points: data.place1Points },
        place2: { horseId: data.place2HorseId, points: data.place2Points }
      };
    }
  });

  // Load all races for substitute logic
  const racesSnap = await getDocs(collection(db, "races"));
  const racesMap = {};
  racesSnap.forEach(docSnap => {
    racesMap[docSnap.id] = docSnap.data();
  });

  // Load all tips
  const tipsSnap = await getDocs(collection(db, "tips"));
  tipsSnap.forEach(docSnap => {
    const tip = docSnap.data();
    const { raceId, userId, horseId } = tip;
    if (!(userId in userPoints)) return; // Skip if user not found

    // Substitute logic: if horse is scratched, and a substitute exists, use the substitute
    let effectiveHorseId = horseId;
    const race = racesMap[raceId];
    if (
      race &&
      race.horses &&
      horseId &&
      race.horses[horseId] &&
      race.horses[horseId].scratched
    ) {
      // Find substitute
      const subEntry = Object.entries(race.horses).find(([_, h]) => h.substitute);
      if (subEntry) {
        effectiveHorseId = subEntry[0];
      }
    }

    let points = 0;
    if (raceWinners[raceId]) {
      // Check for winner, place1, and place2
      if (raceWinners[raceId].winner && effectiveHorseId === raceWinners[raceId].winner.horseId) {
        points += Number(raceWinners[raceId].winner.points) || 0;
        userWinners[userId] += 1;
      }
      if (raceWinners[raceId].place1 && effectiveHorseId === raceWinners[raceId].place1.horseId) {
        points += Number(raceWinners[raceId].place1.points) || 0;
      }
      if (raceWinners[raceId].place2 && effectiveHorseId === raceWinners[raceId].place2.horseId) {
        points += Number(raceWinners[raceId].place2.points) || 0;
      }
    }
    userPoints[userId] += points;
  });

  // Prepare leaderboard array for ranking
  const leaderboardArr = Object.keys(userPoints).map(userId => ({
    userId,
    teamName: userNames[userId],
    points: userPoints[userId],
    winners: userWinners[userId]
  }));

  // Sort by points DESC, then winners DESC
  leaderboardArr.sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    return b.winners - a.winners;
  });

  // Assign ranks with ties (1,1,3)
  let lastPoints = null;
  let lastWinners = null;
  let lastRank = 0;
  let actualRank = 1;
  leaderboardArr.forEach((entry, idx) => {
    if (entry.points === lastPoints && entry.winners === lastWinners) {
      entry.rank = lastRank;
    } else {
      entry.rank = actualRank;
      lastRank = actualRank;
    }
    lastPoints = entry.points;
    lastWinners = entry.winners;
    actualRank++;
  });

  // Write leaderboard to Firestore
  const batch = writeBatch(db);
  const leaderboardRef = collection(db, "leaderboard");
  leaderboardArr.forEach(entry => {
    batch.set(doc(leaderboardRef, entry.userId), {
      userId: entry.userId,
      teamName: entry.teamName,
      points: entry.points,
      winners: entry.winners,
      rank: entry.rank
    });
  });

  await batch.commit();
  console.log("✅ Leaderboard updated.");
}

async function updateLeaderboardForRace(raceId, results) {
  // results: { winner: {horseId, points}, place1: {...}, place2: {...} }
  // 1. Get all tips for this race
  const tipsSnap = await getDocs(query(collection(db, "tips"), where("raceId", "==", raceId)));
  const leaderboardRef = collection(db, "leaderboard");

  // 2. For each tip, check if tipped horse matches winner/place1/place2
  for (const tipDoc of tipsSnap.docs) {
    const tip = tipDoc.data();
    let points = 0;
    if (tip.horseId === results.winner.horseId) points += Number(results.winner.points) || 0;
    if (tip.horseId === results.place1.horseId) points += Number(results.place1.points) || 0;
    if (tip.horseId === results.place2.horseId) points += Number(results.place2.points) || 0;
    if (points === 0) continue;

    // 3. Update/add leaderboard entry
    const userId = tip.userId;
    const leaderboardDocRef = doc(leaderboardRef, userId);
    const leaderboardDoc = await getDoc(leaderboardDocRef);

    if (leaderboardDoc.exists()) {
      // Update points
      const prevPoints = leaderboardDoc.data().points || 0;
      await updateDoc(leaderboardDocRef, {
        points: prevPoints + points,
        teamName: tip.teamName || leaderboardDoc.data().teamName || "",
        userID: userId
      });
    } else {
      // New user
      await setDoc(leaderboardDocRef, {
        points: points,
        teamName: tip.teamName || "",
        userID: userId
      });
    }
  }
}

// Load races initially
loadRaces();