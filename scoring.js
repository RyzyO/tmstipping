/**
 * Pure scoring logic — testable, framework-agnostic.
 * Used by both frontend (admin-dark-script.js) and backend (tests, edge functions).
 */

export function resolveScoredHorseId(race, tippedHorseId) {
  if (race?.horses && tippedHorseId && race.horses[tippedHorseId]?.scratched) {
    const sub = Object.entries(race.horses).find(([, h]) => h.substitute);
    if (sub) return sub[0];
  }
  return tippedHorseId;
}

export function calculateTipPoints(race, result, horseId, jokerUsed) {
  if (!result || !horseId) return 0;
  const scoredHorseId = resolveScoredHorseId(race, horseId);

  let points = 0;
  const winnerPoints = Number(result.points ?? result.winner?.points ?? 0) || 0;
  const place1Points = Number(result.place1_points ?? result.place1?.points ?? 0) || 0;
  const place2Points = Number(result.place2_points ?? result.place2?.points ?? 0) || 0;

  if (scoredHorseId === (result.winning_horse_id ?? result.winner?.idx)) {
    points += winnerPoints;
  } else if (scoredHorseId === (result.place1_horse_id ?? result.place1?.idx)) {
    points += place1Points;
  } else if (scoredHorseId === (result.place2_horse_id ?? result.place2?.idx)) {
    points += place2Points;
  }

  if (jokerUsed && points > 0) points *= 2;
  return points;
}

export function calculateCompPoints(races, tips, results) {
  const userPoints = {};
  const userWins = {};

  // Build result map for O(1) lookups
  const resultMap = {};
  for (const result of (results || [])) {
    const raceId = result.race_id || result.id;
    resultMap[raceId] = result;
  }

  for (const tip of (tips || [])) {
    const race = races?.find?.(r => r.id === tip.race_id);
    const result = resultMap[tip.race_id];
    if (!race || !result) continue;

    const userId = tip.user_id;
    if (!userPoints[userId]) {
      userPoints[userId] = 0;
      userWins[userId] = 0;
    }

    const pts = calculateTipPoints(race, result, tip.horse_id, tip.joker === true);
    userPoints[userId] += pts;

    const scoredHorseId = resolveScoredHorseId(race, tip.horse_id);
    if (scoredHorseId === (result.winning_horse_id ?? result.winner?.idx)) {
      userWins[userId] += 1;
    }
  }

  return { userPoints, userWins };
}
