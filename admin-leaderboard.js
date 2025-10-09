
// admin-leaderboard.js
// Uses Firestore to fetch races, tips, and users, then calculates week-by-week leaderboard

import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import { getFirestore, collection, getDocs } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyCrgNrA4n62hg1U3ujZMRCOYcbLcwT77ZA",
    authDomain: "tmstipping.firebaseapp.com",
    projectId: "tmstipping",
    storageBucket: "tmstipping.appspot.com",
    messagingSenderId: "401677933527",
    appId: "1:401677933527:web:2312ad4ef69aef6551c992"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

let weekRaceMap = {}; // weekNum -> [raceIds]
let weekList = []; // sorted list of week numbers
let weekLeaderboard = {}; // weekNum -> [{user, points, teamName}]

function getWeekNumber(dateStr) {
    // dateStr: 'YYYY-MM-DD' (from race.date)
    const d = new Date(dateStr);
    const jan1 = new Date(d.getFullYear(), 0, 1);
    const days = Math.floor((d - jan1) / 86400000);
    return Math.ceil((days + jan1.getDay() + 1) / 7); // ISO week number
}

async function loadDataAndRender() {
    // 1. Fetch all races
    const racesSnap = await getDocs(collection(db, "races"));
    weekRaceMap = {};
    const raceIdToWeek = {};
    racesSnap.forEach(doc => {
        const race = doc.data();
        if (!race.date) return;
        const week = getWeekNumber(race.date);
        if (!weekRaceMap[week]) weekRaceMap[week] = [];
        weekRaceMap[week].push(doc.id);
        raceIdToWeek[doc.id] = week;
    });
    weekList = Object.keys(weekRaceMap).map(Number).sort((a, b) => a - b);

    // 2. Fetch all users
    const usersSnap = await getDocs(collection(db, "users"));
    const userIdToTeam = {};
    usersSnap.forEach(doc => {
        const data = doc.data();
        userIdToTeam[doc.id] = data.teamName || data.email || doc.id;
    });

    // 3. Fetch all tips
    const tipsSnap = await getDocs(collection(db, "tips"));
    const tips = [];
    tipsSnap.forEach(doc => tips.push(doc.data()));

    // 4. Fetch all results
    const resultsSnap = await getDocs(collection(db, "results"));
    const results = {};
    resultsSnap.forEach(doc => results[doc.id] = doc.data());

    // 5. Calculate leaderboard for each week
    weekLeaderboard = {};
    for (const week of weekList) {
        const raceIds = weekRaceMap[week];
        const userPoints = {};
        // For each tip, if tip.raceId is in this week, calculate points
        for (const tip of tips) {
            if (!raceIds.includes(tip.raceId)) continue;
            const userId = tip.userId;
            if (!userPoints[userId]) userPoints[userId] = 0;
            const result = results[tip.raceId];
            if (!result) continue;
            let points = 0;
            if (tip.horseId === result.winningHorseId) points += Number(result.points) || 0;
            if (tip.horseId === result.place1HorseId) points += Number(result.place1Points) || 0;
            if (tip.horseId === result.place2HorseId) points += Number(result.place2Points) || 0;
            if (tip.joker && points > 0) points *= 2;
            userPoints[userId] += points;
        }
        // Convert to array and sort
        const arr = Object.keys(userPoints).map(userId => ({
            user: userIdToTeam[userId] || userId,
            points: userPoints[userId]
        })).sort((a, b) => b.points - a.points);
        weekLeaderboard[week] = arr;
    }
    populateWeekDropdown();

function populateWeekDropdown() {
    const weekSelect = document.getElementById('weekSelect');
    weekSelect.innerHTML = '';
    weekList.forEach(week => {
        const option = document.createElement('option');
        option.value = week;
        option.textContent = `Week ${week}`;
        weekSelect.appendChild(option);
    });
}
    const weekSelect = document.getElementById('weekSelect');
    renderLeaderboard(weekSelect.value || weekList[0]);
    weekSelect.addEventListener('change', function() {
        renderLeaderboard(this.value);
    });
}

function renderLeaderboard(week) {
    const tbody = document.getElementById('leaderboardBody');
    tbody.innerHTML = '';
    const data = weekLeaderboard[week] || [];
    data.forEach((entry, idx) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${idx + 1}</td>
            <td>${entry.user}</td>
            <td>${entry.points}</td>
        `;

        tbody.appendChild(tr);
    });
}

document.addEventListener('DOMContentLoaded', function() {
    loadDataAndRender();
});
