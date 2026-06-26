
// admin-leaderboard.js
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './supabase-config.js';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let weekRaceMap = {};
let weekList = [];
let weekLeaderboard = {};
let selectedCompId = null;
let allComps = [];

function getWeekNumber(dateStr) {
    const d = new Date(dateStr);
    const jan1 = new Date(d.getFullYear(), 0, 1);
    const days = Math.floor((d - jan1) / 86400000);
    return Math.ceil((days + jan1.getDay() + 1) / 7);
}

async function loadDataAndRender() {
    if (!selectedCompId) return;

    // 1. Fetch all races for this comp
    const { data: racesData } = await supabase.from('races').select('*').eq('comp_id', selectedCompId);
    weekRaceMap = {};
    const raceIdToWeek = {};
    (racesData || []).forEach(race => {
        if (!race.date) return;
        const week = getWeekNumber(race.date);
        if (!weekRaceMap[week]) weekRaceMap[week] = [];
        weekRaceMap[week].push(race.id);
        raceIdToWeek[race.id] = week;
    });
    weekList = Object.keys(weekRaceMap).map(Number).sort((a, b) => a - b);

    // 2. Fetch all users
    const { data: usersData } = await supabase.from('users').select('id,team_name,email');
    const userIdToTeam = {};
    (usersData || []).forEach(u => {
        userIdToTeam[u.id] = u.team_name || u.email || u.id;
    });

    // 3. Fetch all tips for this comp
    const { data: tipsData } = await supabase.from('tips').select('*').eq('comp_id', selectedCompId);
    const tips = tipsData || [];

    // 4. Fetch all results
    const { data: resultsData } = await supabase.from('results').select('*');
    const results = {};
    (resultsData || []).forEach(r => { results[r.race_id || r.id] = r; });

    // 5. Calculate leaderboard for each week
    weekLeaderboard = {};
    for (const week of weekList) {
        const raceIds = weekRaceMap[week];
        const userPoints = {};
        for (const tip of tips) {
            const raceId = tip.race_id;
            if (!raceIds.includes(raceId)) continue;
            const userId = tip.user_id;
            if (!userPoints[userId]) userPoints[userId] = 0;
            const result = results[raceId];
            if (!result) continue;
            let points = 0;
            if (tip.horse_id === result.winning_horse_id) points += Number(result.points) || 0;
            if (tip.horse_id === result.place1_horse_id) points += Number(result.place1_points) || 0;
            if (tip.horse_id === result.place2_horse_id) points += Number(result.place2_points) || 0;
            if (tip.joker && points > 0) points *= 2;
            userPoints[userId] += points;
        }
        const arr = Object.keys(userPoints).map(userId => ({
            user: userIdToTeam[userId] || userId,
            points: userPoints[userId]
        })).sort((a, b) => b.points - a.points);
        weekLeaderboard[week] = arr;
    }

    populateWeekDropdown();
    const weekSelect = document.getElementById('weekSelect');
    renderLeaderboard(weekSelect.value || weekList[0]);
    weekSelect.addEventListener('change', function() {
        renderLeaderboard(this.value);
    });
}

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

async function loadComps() {
    const compSelect = document.getElementById('compSelect');
    try {
        const { data } = await supabase.from('comps').select('*');
        allComps = data || [];

        allComps.sort((a, b) => {
            if (a.status === 'active' && b.status !== 'active') return -1;
            if (a.status !== 'active' && b.status === 'active') return 1;
            return a.name.localeCompare(b.name);
        });

        compSelect.innerHTML = '<option value="">-- Select a Competition --</option>';
        allComps.forEach(comp => {
            const option = document.createElement('option');
            option.value = comp.id;
            option.textContent = `${comp.name} (${comp.status === 'active' ? 'Active' : 'Closed'})`;
            compSelect.appendChild(option);
        });

        const firstActiveComp = allComps.find(comp => comp.status === 'active') || null;
        if (firstActiveComp) {
            selectedCompId = firstActiveComp.id;
            compSelect.value = selectedCompId;
            await loadDataAndRender();
        }
    } catch (error) {
        console.error('Error loading comps:', error);
        compSelect.innerHTML = '<option value="">Error loading competitions</option>';
    }
}

document.addEventListener('DOMContentLoaded', function() {
    loadComps();

    const compSelect = document.getElementById('compSelect');
    compSelect.addEventListener('change', async function() {
        selectedCompId = this.value;
        if (selectedCompId) {
            await loadDataAndRender();
        } else {
            document.getElementById('leaderboardBody').innerHTML = '<tr><td colspan="3" style="text-align:center;padding:2rem;">Please select a competition</td></tr>';
        }
    });
});
