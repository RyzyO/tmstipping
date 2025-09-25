// team.js
import { db } from "./firebase-config.js";
import { collection, getDocs } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";

export async function loadTeamRank(user) {
  const leaderboardSnap = await getDocs(collection(db, "leaderboard"));
  const userSnap = await getDocs(collection(db, "users"));
  let userTeamName = null;

  userSnap.forEach(doc => {
    if (doc.id === user.uid) {
      userTeamName = doc.data().teamName;
    }
  });

  const leaderboard = [];
  leaderboardSnap.forEach(doc => leaderboard.push({ id: doc.id, ...doc.data() }));
  leaderboard.sort((a, b) => b.points - a.points);

  const rank = leaderboard.findIndex(entry => entry.id === user.uid) + 1;

  document.getElementById("team-name").textContent = userTeamName || "Your Team";
  document.getElementById("team-rank").textContent = rank || "-";
}
